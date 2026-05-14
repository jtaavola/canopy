import os from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, ipcMain, shell, type WebFrameMain } from "electron";
import * as pty from "node-pty";
import icon from "../../resources/icon.png?asset";

const terminals = new Map<number, pty.IPty>();

function getShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec ?? "powershell.exe";
  }

  return (
    process.env.SHELL ??
    (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")
  );
}

function cleanupTerminal(webContentsId: number): void {
  const terminal = terminals.get(webContentsId);

  if (!terminal) return;

  terminal.kill();
  terminals.delete(webContentsId);
}

function normalizeTerminalDimension(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function validateSender(frame: WebFrameMain | null): boolean {
  if (!frame) return false;

  const trustedUrls = [
    ...(is.dev && process.env.ELECTRON_RENDERER_URL
      ? [new URL(process.env.ELECTRON_RENDERER_URL)]
      : []),
    pathToFileURL(join(__dirname, "../renderer/index.html")),
  ];

  try {
    const senderUrl = new URL(frame.url);

    return trustedUrls.some((trustedUrl) => {
      if (senderUrl.protocol !== trustedUrl.protocol) return false;

      if (senderUrl.protocol === "file:") {
        return senderUrl.href === trustedUrl.href;
      }

      return senderUrl.origin === trustedUrl.origin;
    });
  } catch {
    return false;
  }
}

function registerTerminalIpc(): void {
  ipcMain.handle(
    "terminal:start",
    (event, options?: { cols?: unknown; rows?: unknown }) => {
      if (!validateSender(event.senderFrame)) return;

      const webContentsId = event.sender.id;

      cleanupTerminal(webContentsId);

      const shellPath = getShell();
      const terminal = pty.spawn(shellPath, [], {
        name: "xterm-256color",
        cols: normalizeTerminalDimension(options?.cols, 80),
        rows: normalizeTerminalDimension(options?.rows, 24),
        cwd: os.homedir(),
        env: process.env,
      });

      terminals.set(webContentsId, terminal);

      terminal.onData((data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("terminal:data", data);
        }
      });

      terminal.onExit(({ exitCode, signal }) => {
        terminals.delete(webContentsId);

        if (!event.sender.isDestroyed()) {
          event.sender.send("terminal:exit", { exitCode, signal });
        }
      });
    },
  );

  ipcMain.on("terminal:write", (event, data: string) => {
    if (!validateSender(event.senderFrame)) return;

    terminals.get(event.sender.id)?.write(data);
  });

  ipcMain.on(
    "terminal:resize",
    (event, size?: { cols?: unknown; rows?: unknown }) => {
      if (!validateSender(event.senderFrame)) return;

      const terminal = terminals.get(event.sender.id);

      if (!terminal) return;

      const cols = normalizeTerminalDimension(size?.cols, terminal.cols);
      const rows = normalizeTerminalDimension(size?.rows, terminal.rows);

      terminal.resize(cols, rows);
    },
  );

  ipcMain.on("terminal:dispose", (event) => {
    if (!validateSender(event.senderFrame)) return;

    cleanupTerminal(event.sender.id);
  });
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("closed", () => {
    cleanupTerminal(mainWindow.webContents.id);
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerTerminalIpc();

  createWindow();

  app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
