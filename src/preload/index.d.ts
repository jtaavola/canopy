import { ElectronAPI } from "@electron-toolkit/preload";

export type WorkspaceTree = {
  id: string;
  name: string;
  worktreePath: string;
  branchName: string;
};

export type WorkspaceProject = {
  id: string;
  name: string;
  rootPath: string;
  slug: string;
  trees: WorkspaceTree[];
};

export type WorkspaceState = {
  version: 1;
  projects: WorkspaceProject[];
  activeProjectId: string | null;
  activeTreeId: string | null;
};

export interface WorkspaceApi {
  load: () => Promise<WorkspaceState>;
  save: (state: WorkspaceState) => Promise<void>;
}

export interface ProjectApi {
  open: () => Promise<WorkspaceState | null>;
  createTree: (projectId: string) => Promise<WorkspaceState>;
  deleteTree: (projectId: string, treeId: string) => Promise<WorkspaceState>;
  remove: (projectId: string) => Promise<WorkspaceState>;
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
  write: (terminalId: string, data: string) => void;
  resize: (terminalId: string, size: { cols: number; rows: number }) => void;
  dispose: (terminalId: string) => void;
  onData: (callback: (data: string) => void) => () => void;
  onExit: (
    callback: (event: {
      terminalId: string;
      exitCode: number;
      signal?: number;
    }) => void,
  ) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      workspace: WorkspaceApi;
      project: ProjectApi;
      fileTree: FileTreeApi;
      gitChanges: GitChangesApi;
      terminal: TerminalApi;
    };
  }
}
