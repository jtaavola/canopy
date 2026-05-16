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

export type ChangedFile = {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  unstaged: boolean;
};

export type ChangedFilesResult =
  | { status: "ok"; files: ChangedFile[] }
  | { status: "not-git" }
  | { status: "error"; message: string };

export type ChangedFileDiffResult =
  | { status: "ok"; patch: string }
  | { status: "not-git" }
  | { status: "not-found" }
  | { status: "error"; message: string };

export interface GitChangesApi {
  list: (rootPath: string) => Promise<ChangedFilesResult>;
  diff: (rootPath: string, filePath: string) => Promise<ChangedFileDiffResult>;
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
      gitChanges: GitChangesApi;
      terminal: TerminalApi;
    };
  }
}
