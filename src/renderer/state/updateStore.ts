import { create } from "zustand";

export type UpdatePhase = "idle" | "checking" | "downloading" | "downloaded" | "error";

interface UpdateState {
  phase: UpdatePhase;
  version: string | null;
  downloadPercent: number;
  errorMessage: string | null;
  downloadTransferred: number | null;
  downloadTotal: number | null;
  downloadBytesPerSecond: number | null;
}

export type DownloadProgressPayload = {
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

interface UpdateActions {
  setChecking: () => void;
  beginUpdateDownload: (version: string) => void;
  setNotAvailable: () => void;
  setDownloading: (percent: number, progress?: DownloadProgressPayload) => void;
  setDownloaded: (version: string) => void;
  setError: (message: string) => void;
}

const clearedDownloadFields = {
  downloadTransferred: null as number | null,
  downloadTotal: null as number | null,
  downloadBytesPerSecond: null as number | null,
};

export const useUpdateStore = create<UpdateState & UpdateActions>()((set) => ({
  phase: "idle",
  version: null,
  downloadPercent: 0,
  errorMessage: null,
  ...clearedDownloadFields,

  setChecking: () =>
    set({
      phase: "checking",
      errorMessage: null,
      version: null,
      downloadPercent: 0,
      ...clearedDownloadFields,
    }),
  beginUpdateDownload: (version) =>
    set({
      phase: "downloading",
      version,
      downloadPercent: 0,
      errorMessage: null,
      ...clearedDownloadFields,
    }),
  setNotAvailable: () =>
    set({
      phase: "idle",
      errorMessage: null,
      version: null,
      downloadPercent: 0,
      ...clearedDownloadFields,
    }),
  setDownloading: (percent, progress) =>
    set({
      phase: "downloading",
      downloadPercent: percent,
      ...(progress
        ? {
            downloadTransferred: progress.transferred,
            downloadTotal: progress.total,
            downloadBytesPerSecond: progress.bytesPerSecond,
          }
        : {}),
    }),
  setDownloaded: (version) =>
    set({
      phase: "downloaded",
      version,
      downloadPercent: 100,
      ...clearedDownloadFields,
    }),
  setError: (message) =>
    set({
      phase: "error",
      errorMessage: message,
      version: null,
      downloadPercent: 0,
      ...clearedDownloadFields,
    }),
}));
