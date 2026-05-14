import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer } from "electron";

// Custom APIs for renderer
const api = {
  fileTree: {
    list: () => ipcRenderer.invoke("file-tree:list") as Promise<string[]>,
  },
  terminal: {
    start: (size: { cols: number; rows: number }) =>
      ipcRenderer.invoke("terminal:start", size),
    write: (data: string) => ipcRenderer.send("terminal:write", data),
    resize: (size: { cols: number; rows: number }) =>
      ipcRenderer.send("terminal:resize", size),
    dispose: () => ipcRenderer.send("terminal:dispose"),
    onData: (callback: (data: string) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: string,
      ): void => callback(data);

      ipcRenderer.on("terminal:data", listener);

      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onExit: (
      callback: (event: { exitCode: number; signal?: number }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        exitEvent: { exitCode: number; signal?: number },
      ): void => callback(exitEvent);

      ipcRenderer.on("terminal:exit", listener);

      return () => ipcRenderer.removeListener("terminal:exit", listener);
    },
  },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error (define in dts)
  window.electron = electronAPI;
  // @ts-expect-error (define in dts)
  window.api = api;
}
