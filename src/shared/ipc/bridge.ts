import type { CraftStationChannel } from "../channel";
import type { RemoteThreadCommand } from "../contracts";
import type { RemoteAccessPairingInfo } from "../remote";
import type { SharedSettings } from "../settings";
import type { GitStatePatch } from "../gitState";
import { createChannel } from "./core";
import {
  ipcProcedureMap,
  type IpcProcedureName,
  type IpcProcedurePayload,
  type IpcProcedureResult,
  type MainLocalProcedureName,
  type SupervisorProcedureName,
} from "./procedureMap";
import type {
  BrowserEvent,
  PrWatchMergedEvent,
  PrWatchStatusEvent,
  ProjectStateChangedEvent,
  SupervisorEvent,
  ThreadOpenRequestedEvent,
  UpdateStatus,
} from "./events";
import type { QuickComposerSubmission } from "./schemas";

export const CRAFTSTATION_WINDOW_KINDS = [
  "main",
  "browserExtract",
  "quickComposer",
  "temporaryChat",
] as const;
export type CraftStationWindowKind = (typeof CRAFTSTATION_WINDOW_KINDS)[number];

type ProcedureArgs<Name extends IpcProcedureName> =
  (typeof ipcProcedureMap)[Name]["__types"]["args"];

export type CraftStationInvokeBridge = {
  [Name in IpcProcedureName]: (...args: ProcedureArgs<Name>) => Promise<IpcProcedureResult<Name>>;
};

export type CraftStationBridge = CraftStationInvokeBridge & {
  platform: NodeJS.Platform;
  appVersion: string;
  arch: string;
  chromeVersion: string;
  isDev: boolean;
  windowKind: CraftStationWindowKind;
  channel: CraftStationChannel;
  /**
   * Host user home directory (`os.homedir()`). Used to resolve Grok session
   * media paths (`~/.grok/sessions/…`) for chat markdown images. Optional so
   * remote/mobile bridge shims can omit it.
   */
  homeDir?: string;
  electronVersion: string;
  nodeVersion: string;
  posthogEnableDev: boolean;
  posthogEnabled: boolean;
  posthogHost: string;
  posthogKey: string;
  sentryEnabled: boolean;
  getDroppedFilePaths(files: File[]): string[];
  onSupervisorEvent(listener: (event: SupervisorEvent) => void): () => void;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  onBrowserEvent(listener: (event: BrowserEvent) => void): () => void;
  /** Thread-metadata mutations issued by paired remote clients (mobile PWA). */
  onRemoteThreadCommand(listener: (command: RemoteThreadCommand) => void): () => void;
  /** Active remote-access code or paired-device state changed in main. */
  onRemoteAccessPairingChanged(listener: (info: RemoteAccessPairingInfo) => void): () => void;
  /** Shared settings rewritten outside this renderer (e.g. by a remote client). */
  onSharedSettingsChanged(listener: (settings: SharedSettings) => void): () => void;
  onProjectStateChanged(listener: (event: ProjectStateChangedEvent) => void): () => void;
  /** Unified schedule store changed (create/update/pause/resume/delete/run/settle). */
  onSchedulesChanged(listener: () => void): () => void;
  onGitStateChanged(listener: (patch: GitStatePatch) => void): () => void;
  onPrWatchMerged(listener: (event: PrWatchMergedEvent) => void): () => void;
  /** Live PR state observed by the PR-watch loop, so watched PRs stay fresh. */
  onPrWatchStatus(listener: (event: PrWatchStatusEvent) => void): () => void;
  onThreadOpenRequested(listener: (event: ThreadOpenRequestedEvent) => void): () => void;
  openTemporaryChat(): Promise<void>;
  getTemporaryChatThreadId(): Promise<string>;
  closeTemporaryChat(): Promise<void>;
  /** Hide the temporary chat without ending its prepared CLI. */
  hideTemporaryChat(): Promise<void>;
  /**
   * Delete the current temporary conversation, hide the window, and return the
   * next thread id. The hidden window prepares that id's CLI for the next open.
   */
  rearmTemporaryChat(): Promise<string>;
  /**
   * The temporary chat's CLI was closed after sitting unused.
   * `visible` is true when the window was opened again while that close finished.
   */
  onTemporaryChatIdleExpired(listener: (visible: boolean) => void): () => void;
  submitQuickComposer(submission: QuickComposerSubmission): Promise<void>;
  dismissQuickComposer(): Promise<void>;
  pickQuickComposerFiles(): Promise<string[] | null>;
  notifyQuickComposerMainReady(): Promise<void>;
  /** The user opened a thread — clear its taskbar completion badge (issue #12). */
  dismissTaskbarAttention(threadId: string): Promise<void>;
  reloadRenderer(): Promise<void>;
  onQuickComposerSubmit(listener: (submission: QuickComposerSubmission) => void): () => void;
  onQuickComposerDismissRequested(listener: () => void): () => void;
};

export function createInvokeBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): CraftStationInvokeBridge {
  return createProcedureBridge((name, args) => {
    const procedure = ipcProcedureMap[name];
    return invoke(procedure.channel, ...args);
  });
}

/** Builds every typed procedure method while preserving its canonical name. */
export function createProcedureBridge(
  invoke: (name: IpcProcedureName, args: unknown[]) => Promise<unknown>,
): CraftStationInvokeBridge {
  const bridge = {} as CraftStationInvokeBridge;
  const names = Object.keys(ipcProcedureMap) as IpcProcedureName[];
  for (const name of names) {
    (bridge as Record<IpcProcedureName, unknown>)[name] = (...args: unknown[]) =>
      invoke(name, args);
  }
  return bridge;
}

export function parseIpcProcedureArgs<Name extends IpcProcedureName>(
  name: Name,
  args: unknown[],
): IpcProcedurePayload<Name> {
  const procedure = ipcProcedureMap[name];
  return (procedure.parseArgs as (...args: unknown[]) => IpcProcedurePayload<Name>)(...args);
}

export type MainLocalIpcHandlerMap = {
  [Name in MainLocalProcedureName]: (
    payload: IpcProcedurePayload<Name>,
  ) => Promise<IpcProcedureResult<Name>> | IpcProcedureResult<Name>;
};

export type SupervisorIpcHandlerMap = {
  [Name in SupervisorProcedureName]: (
    payload: IpcProcedurePayload<Name>,
  ) => Promise<IpcProcedureResult<Name>> | IpcProcedureResult<Name>;
};

export function defineMainLocalIpcHandlers<THandlers extends MainLocalIpcHandlerMap>(
  handlers: THandlers,
): THandlers {
  return handlers;
}

export function defineSupervisorIpcHandlers<THandlers extends SupervisorIpcHandlerMap>(
  handlers: THandlers,
): THandlers {
  return handlers;
}

export const IPC_EVENT_CHANNELS = {
  supervisorEvent: createChannel("supervisorEvent"),
  updateStatus: createChannel("updateStatus"),
  browserEvent: createChannel("browserEvent"),
  remoteThreadCommand: createChannel("remoteThreadCommand"),
  remoteAccessPairingChanged: createChannel("remoteAccessPairingChanged"),
  sharedSettingsChanged: createChannel("sharedSettingsChanged"),
  projectStateChanged: createChannel("projectStateChanged"),
  schedulesChanged: createChannel("schedulesChanged"),
  gitStateChanged: createChannel("gitStateChanged"),
  prWatchMerged: createChannel("prWatchMerged"),
  prWatchStatus: createChannel("prWatchStatus"),
  threadOpenRequested: createChannel("threadOpenRequested"),
  quickComposerSubmit: createChannel("quickComposerSubmit"),
  quickComposerDismissRequested: createChannel("quickComposerDismissRequested"),
  temporaryChatIdleExpired: createChannel("temporaryChatIdleExpired"),
} as const;

export const IPC_WINDOW_CHANNELS = {
  temporaryChatOpen: createChannel("temporaryChatOpen"),
  temporaryChatContext: createChannel("temporaryChatContext"),
  temporaryChatClose: createChannel("temporaryChatClose"),
  temporaryChatHide: createChannel("temporaryChatHide"),
  temporaryChatRearm: createChannel("temporaryChatRearm"),
  quickComposerSubmit: createChannel("quickComposerWindowSubmit"),
  quickComposerDismiss: createChannel("quickComposerWindowDismiss"),
  quickComposerPickFiles: createChannel("quickComposerWindowPickFiles"),
  quickComposerMainReady: createChannel("quickComposerMainReady"),
  taskbarAttentionDismiss: createChannel("taskbarAttentionDismiss"),
  rendererReload: createChannel("rendererReload"),
} as const;
