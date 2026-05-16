import { ElectronAPI } from "@electron-toolkit/preload";

export interface ProjectApi {
  open: () => Promise<string | null>;
}

export type FilePreviewResult =
  | { status: "ok"; content: string }
  | { status: "binary" }
  | { status: "too-large"; maxBytes: number }
  | { status: "not-found" }
  | { status: "directory" }
  | { status: "unavailable"; message: string };

export interface FileTreeApi {
  list: (rootPath: string) => Promise<string[]>;
  preview: (rootPath: string, filePath: string) => Promise<FilePreviewResult>;
}

export interface TerminalApi {
  start: (options: {
    cols: number;
    rows: number;
    cwd: string;
  }) => Promise<void>;
  write: (data: string) => void;
  resize: (size: { cols: number; rows: number }) => void;
  dispose: () => void;
  onData: (callback: (data: string) => void) => () => void;
  onExit: (
    callback: (event: { exitCode: number; signal?: number }) => void,
  ) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      project: ProjectApi;
      fileTree: FileTreeApi;
      terminal: TerminalApi;
    };
  }
}
