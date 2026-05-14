import { ElectronAPI } from "@electron-toolkit/preload";

export interface TerminalApi {
  start: (size: { cols: number; rows: number }) => Promise<void>;
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
      terminal: TerminalApi;
    };
  }
}
