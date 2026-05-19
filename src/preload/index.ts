import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer } from "electron";

// Custom APIs for renderer
const api = {
  workspace: {
    load: () =>
      ipcRenderer.invoke("workspace:load") as Promise<
        import("./index.d").WorkspaceState
      >,
    save: (state: import("./index.d").WorkspaceState) =>
      ipcRenderer.invoke("workspace:save", state) as Promise<void>,
  },
  project: {
    open: () =>
      ipcRenderer.invoke("project:open") as Promise<
        import("./index.d").WorkspaceState | null
      >,
    createTree: (projectId: string) =>
      ipcRenderer.invoke("project:create-tree", projectId) as Promise<
        import("./index.d").WorkspaceState
      >,
    deleteTree: (projectId: string, treeId: string) =>
      ipcRenderer.invoke("project:delete-tree", projectId, treeId) as Promise<
        import("./index.d").WorkspaceState
      >,
    remove: (projectId: string) =>
      ipcRenderer.invoke("project:remove", projectId) as Promise<
        import("./index.d").WorkspaceState
      >,
  },
  fileTree: {
    list: (rootPath: string) =>
      ipcRenderer.invoke("file-tree:list", rootPath) as Promise<string[]>,
    preview: (rootPath: string, filePath: string) =>
      ipcRenderer.invoke("file-tree:preview", {
        rootPath,
        filePath,
      }) as Promise<import("./index.d").FilePreviewResult>,
  },
  gitChanges: {
    list: (rootPath: string) =>
      ipcRenderer.invoke("git-changes:list", rootPath) as Promise<
        import("./index.d").ChangedFilesResult
      >,
    diff: (rootPath: string, filePath: string) =>
      ipcRenderer.invoke("git-changes:diff", {
        rootPath,
        filePath,
      }) as Promise<import("./index.d").ChangedFileDiffResult>,
  },
  external: {
    open: (url: string) =>
      ipcRenderer.invoke("external:open", url) as Promise<boolean>,
  },
  terminal: {
    start: (options: { cols: number; rows: number; cwd: string }) =>
      ipcRenderer.invoke("terminal:start", options),
    write: (terminalId: string, data: string) =>
      ipcRenderer.send("terminal:write", { terminalId, data }),
    resize: (terminalId: string, size: { cols: number; rows: number }) =>
      ipcRenderer.send("terminal:resize", { terminalId, ...size }),
    dispose: (terminalId: string) =>
      ipcRenderer.send("terminal:dispose", terminalId),
    onData: (callback: (data: string) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: string,
      ): void => callback(data);

      ipcRenderer.on("terminal:data", listener);

      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onExit: (
      callback: (event: {
        terminalId: string;
        exitCode: number;
        signal?: number;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        exitEvent: { terminalId: string; exitCode: number; signal?: number },
      ): void => callback(exitEvent);

      ipcRenderer.on("terminal:exit", listener);

      return () => ipcRenderer.removeListener("terminal:exit", listener);
    },
    onStatusChanged: (
      callback: (event: { terminalId: string; isWorking: boolean }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        statusEvent: { terminalId: string; isWorking: boolean },
      ): void => callback(statusEvent);

      ipcRenderer.on("terminal:status-changed", listener);

      return () =>
        ipcRenderer.removeListener("terminal:status-changed", listener);
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
  window.electron = electronAPI;
  window.api = api;
}
