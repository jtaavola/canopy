import { execFile } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type WebFrameMain,
} from "electron";
import * as pty from "node-pty";
import icon from "../../resources/icon.png?asset";

const execFileAsync = promisify(execFile);

const terminals = new Map<string, pty.IPty>();
const terminalBuffers = new Map<string, string[]>();
const activeTerminalsByWebContents = new Map<number, string>();
const TERMINAL_BUFFER_CHUNK_LIMIT = 1000;

const EXCLUDED_TREE_ENTRIES = new Set([
  ".git",
  "build",
  "dist",
  "node_modules",
  "out",
]);

const FILE_PREVIEW_MAX_BYTES = 1024 * 1024;

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

type FilePreviewResult =
  | { status: "ok"; content: string }
  | { status: "binary" }
  | { status: "too-large"; maxBytes: number }
  | { status: "not-found" }
  | { status: "directory" }
  | { status: "unavailable"; message: string };

type ChangedFile = {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  unstaged: boolean;
};

type ChangedFilesResult =
  | { status: "ok"; files: ChangedFile[] }
  | { status: "not-git" }
  | { status: "error"; message: string };

type ChangedFileDiffResult =
  | { status: "ok"; patch: string }
  | { status: "not-git" }
  | { status: "not-found" }
  | { status: "error"; message: string };

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function hasBinaryBytes(buffer: Buffer): boolean {
  const bytesToCheck = Math.min(buffer.length, 8000);

  for (let index = 0; index < bytesToCheck; index += 1) {
    if (buffer[index] === 0) return true;
  }

  return false;
}

function mapGitStatus(code: string): ChangedFile["status"] {
  if (code === "R" || code === "C") return "renamed";
  if (code === "D") return "deleted";
  if (code === "A") return "added";
  if (code === "?") return "untracked";
  return "modified";
}

function parseGitStatus(output: string): ChangedFile[] {
  const records = output.split("\0").filter(Boolean);
  const files: ChangedFile[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const xy = record.slice(0, 2);
    const path = record.slice(3);
    const statusCode = xy.includes("?") ? "?" : xy.replaceAll(" ", "")[0];
    const file: ChangedFile = {
      path,
      status: mapGitStatus(statusCode ?? "M"),
      staged: xy[0] !== " " && xy[0] !== "?",
      unstaged: xy[1] !== " ",
    };

    if (file.status === "renamed") {
      file.oldPath = records[index + 1];
      index += 1;
    }

    files.push(file);
  }

  return files;
}

async function collectGitChanges(
  rootPath: string,
): Promise<ChangedFilesResult> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: rootPath, maxBuffer: 10 * 1024 * 1024 },
    );

    return { status: "ok", files: parseGitStatus(stdout) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git failed.";
    if (message.includes("not a git repository")) return { status: "not-git" };
    return { status: "error", message };
  }
}

async function getGitDiff(
  rootPath: string,
  filePath: string,
): Promise<ChangedFileDiffResult> {
  const changes = await collectGitChanges(rootPath);
  if (changes.status !== "ok") return changes;

  const change = changes.files.find(
    (file) => file.path === filePath || file.oldPath === filePath,
  );
  if (!change) return { status: "not-found" };

  const args =
    change.status === "untracked"
      ? [
          "diff",
          "--no-index",
          "--",
          os.platform() === "win32" ? "NUL" : "/dev/null",
          change.path,
        ]
      : ["diff", "HEAD", "--", change.oldPath ?? change.path, change.path];

  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: rootPath,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { status: "ok", patch: stdout };
  } catch (error) {
    const maybeExecError = error as { stdout?: string; message?: string };
    if (maybeExecError.stdout) {
      return { status: "ok", patch: maybeExecError.stdout };
    }
    const message = maybeExecError.message ?? "Unable to load diff.";
    if (message.includes("not a git repository")) return { status: "not-git" };
    return { status: "error", message };
  }
}

async function collectProjectPaths(rootPath: string): Promise<string[]> {
  const paths: string[] = [];

  async function walk(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (EXCLUDED_TREE_ENTRIES.has(entry.name)) continue;

      const absolutePath = join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        paths.push(relative(rootPath, absolutePath).split(sep).join("/"));
      }
    }
  }

  await walk(rootPath);

  return paths.sort((a, b) => a.localeCompare(b));
}

function getShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec ?? "powershell.exe";
  }

  return (
    process.env.SHELL ??
    (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")
  );
}

function cleanupTerminal(terminalId: string): void {
  const terminal = terminals.get(terminalId);

  if (terminal) {
    terminal.kill();
    terminals.delete(terminalId);
  }

  terminalBuffers.delete(terminalId);
}

function cleanupWebContentsTerminals(webContentsId: number): void {
  activeTerminalsByWebContents.delete(webContentsId);

  for (const terminalId of terminals.keys()) {
    cleanupTerminal(terminalId);
  }
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

function registerProjectIpc(): void {
  ipcMain.handle("project:open", async (event) => {
    if (!validateSender(event.senderFrame)) return null;

    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Open project",
      properties: ["openDirectory" as const],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) return null;

    return result.filePaths[0] ?? null;
  });
}

function registerFileTreeIpc(): void {
  ipcMain.handle("file-tree:list", async (event, rootPath?: unknown) => {
    if (!validateSender(event.senderFrame)) return [];
    if (typeof rootPath !== "string" || rootPath.length === 0) return [];

    return collectProjectPaths(rootPath);
  });

  ipcMain.handle(
    "file-tree:preview",
    async (
      event,
      options?: { rootPath?: unknown; filePath?: unknown },
    ): Promise<FilePreviewResult> => {
      if (!validateSender(event.senderFrame)) return { status: "not-found" };
      if (
        typeof options?.rootPath !== "string" ||
        options.rootPath.length === 0 ||
        typeof options.filePath !== "string" ||
        options.filePath.length === 0
      ) {
        return { status: "not-found" };
      }

      const rootPath = resolve(options.rootPath);
      const absoluteFilePath = resolve(rootPath, options.filePath);

      if (!isPathInsideRoot(rootPath, absoluteFilePath)) {
        return { status: "not-found" };
      }

      try {
        const [realRootPath, realFilePath] = await Promise.all([
          realpath(rootPath),
          realpath(absoluteFilePath),
        ]);

        if (!isPathInsideRoot(realRootPath, realFilePath)) {
          return { status: "not-found" };
        }

        const fileStat = await stat(realFilePath);

        if (fileStat.isDirectory()) return { status: "directory" };
        if (!fileStat.isFile()) return { status: "not-found" };
        if (fileStat.size > FILE_PREVIEW_MAX_BYTES) {
          return { status: "too-large", maxBytes: FILE_PREVIEW_MAX_BYTES };
        }

        const extensionStart = options.filePath.lastIndexOf(".");
        const extension =
          extensionStart >= 0
            ? options.filePath.toLowerCase().slice(extensionStart)
            : "";

        if (IMAGE_EXTENSIONS.has(extension)) return { status: "binary" };

        const contentBuffer = await readFile(realFilePath);

        if (hasBinaryBytes(contentBuffer)) return { status: "binary" };

        return { status: "ok", content: contentBuffer.toString("utf8") };
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          return { status: "not-found" };
        }

        return { status: "unavailable", message: "File is unavailable." };
      }
    },
  );
}

function registerGitChangesIpc(): void {
  ipcMain.handle("git-changes:list", async (event, rootPath?: unknown) => {
    if (!validateSender(event.senderFrame))
      return {
        status: "error",
        message: "Unauthorized",
      } satisfies ChangedFilesResult;
    if (typeof rootPath !== "string" || rootPath.length === 0)
      return { status: "not-git" } satisfies ChangedFilesResult;

    return collectGitChanges(rootPath);
  });

  ipcMain.handle(
    "git-changes:diff",
    async (event, options?: { rootPath?: unknown; filePath?: unknown }) => {
      if (!validateSender(event.senderFrame))
        return {
          status: "error",
          message: "Unauthorized",
        } satisfies ChangedFileDiffResult;
      if (
        typeof options?.rootPath !== "string" ||
        options.rootPath.length === 0 ||
        typeof options.filePath !== "string" ||
        options.filePath.length === 0
      ) {
        return { status: "not-found" } satisfies ChangedFileDiffResult;
      }

      return getGitDiff(options.rootPath, options.filePath);
    },
  );
}

function registerTerminalIpc(): void {
  ipcMain.handle(
    "terminal:start",
    (event, options?: { cols?: unknown; rows?: unknown; cwd?: unknown }) => {
      if (!validateSender(event.senderFrame)) return;

      const webContentsId = event.sender.id;
      const terminalId =
        typeof options?.cwd === "string" && options.cwd.length > 0
          ? options.cwd
          : os.homedir();

      activeTerminalsByWebContents.set(webContentsId, terminalId);

      const existingTerminal = terminals.get(terminalId);
      if (existingTerminal) {
        existingTerminal.resize(
          normalizeTerminalDimension(options?.cols, existingTerminal.cols),
          normalizeTerminalDimension(options?.rows, existingTerminal.rows),
        );
        for (const data of terminalBuffers.get(terminalId) ?? []) {
          if (event.sender.isDestroyed()) break;
          event.sender.send("terminal:data", data);
        }
        return;
      }

      const shellPath = getShell();
      const terminal = pty.spawn(shellPath, [], {
        name: "xterm-256color",
        cols: normalizeTerminalDimension(options?.cols, 80),
        rows: normalizeTerminalDimension(options?.rows, 24),
        cwd: terminalId,
        env: process.env,
      });

      terminals.set(terminalId, terminal);
      terminalBuffers.set(terminalId, []);

      terminal.onData((data) => {
        const buffer = terminalBuffers.get(terminalId) ?? [];
        buffer.push(data);
        if (buffer.length > TERMINAL_BUFFER_CHUNK_LIMIT) buffer.shift();
        terminalBuffers.set(terminalId, buffer);
        if (
          !event.sender.isDestroyed() &&
          activeTerminalsByWebContents.get(webContentsId) === terminalId
        ) {
          event.sender.send("terminal:data", data);
        }
      });

      terminal.onExit(({ exitCode, signal }) => {
        terminals.delete(terminalId);

        if (!event.sender.isDestroyed()) {
          event.sender.send("terminal:exit", { terminalId, exitCode, signal });
        }
      });
    },
  );

  ipcMain.on(
    "terminal:write",
    (event, options?: { terminalId?: unknown; data?: unknown }) => {
      if (!validateSender(event.senderFrame)) return;
      if (
        typeof options?.terminalId !== "string" ||
        typeof options.data !== "string"
      ) {
        return;
      }

      terminals.get(options.terminalId)?.write(options.data);
    },
  );

  ipcMain.on(
    "terminal:resize",
    (
      event,
      size?: { terminalId?: unknown; cols?: unknown; rows?: unknown },
    ) => {
      if (!validateSender(event.senderFrame)) return;
      if (typeof size?.terminalId !== "string") return;

      const terminal = terminals.get(size.terminalId);

      if (!terminal) return;

      const cols = normalizeTerminalDimension(size.cols, terminal.cols);
      const rows = normalizeTerminalDimension(size.rows, terminal.rows);

      terminal.resize(cols, rows);
    },
  );

  ipcMain.on("terminal:dispose", (event, terminalId?: unknown) => {
    if (!validateSender(event.senderFrame)) return;
    if (typeof terminalId !== "string") return;

    cleanupTerminal(terminalId);
  });
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 16 },
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  const mainWindowWebContentsId = mainWindow.webContents.id;

  mainWindow.on("closed", () => {
    cleanupWebContentsTerminals(mainWindowWebContentsId);
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

  registerProjectIpc();
  registerFileTreeIpc();
  registerGitChangesIpc();
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
