export type JsonRpcId = string | number;

export interface JsonRpcRequest<TParams = unknown> {
  /** Optional in the official Codex stdio JSONL wire format. */
  jsonrpc?: "2.0" | undefined;
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  /** Optional in the official Codex stdio JSONL wire format. */
  jsonrpc?: "2.0" | undefined;
  method: string;
  params?: TParams;
}

export interface JsonRpcResponse<TResult = unknown> {
  /** Optional in the official Codex stdio JSONL wire format. */
  jsonrpc?: "2.0" | undefined;
  id: JsonRpcId;
  result?: TResult;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export interface CodexClientInfo {
  name: string;
  version: string;
}

export interface CodexInitializeParams {
  clientInfo: CodexClientInfo;
  capabilities?: {
    experimentalApi?: boolean;
    requestAttestation?: boolean;
    optOutNotificationMethods?: string[];
    extensions?: Record<string, unknown>;
  };
}

export interface CodexInitializeResult {
  userAgent?: string;
  codexHome?: string;
  platformFamily?: string;
  platformOs?: string;
  serverInfo?: {
    name: string;
    version: string;
  };
  capabilities?: Record<string, unknown>;
  platform?: {
    os: string;
    arch: string;
  };
  authStatus?: {
    authenticated: boolean;
    account?: string | null;
  };
}

export interface CodexModelInfo {
  id: string;
  displayName?: string;
  vendor?: string;
  contextWindow?: number;
  supportsStreaming?: boolean;
  supportsToolCalling?: boolean;
  inputModalities?: ("text" | "image" | "audio")[];
  reasoningEfforts?: string[];
  serviceTiers?: string[];
}

export interface CodexModelListResult {
  models: CodexModelInfo[];
  nextCursor?: string | null;
}

export interface CodexUserInputItem {
  type: "text" | "image" | "localImage" | "audio" | "localAudio" | "skill" | "mention";
  text?: string;
  url?: string;
  path?: string;
  name?: string;
}

export interface CodexThreadStartParams {
  sandbox?: string | undefined;
  cwd?: string | null | undefined;
  model?: string | null | undefined;
  modelProvider?: string | null | undefined;
  approvalPolicy?: string | null | Record<string, unknown> | undefined;
  approvalsReviewer?: string | null | undefined;
  serviceTier?: string | null | undefined;
}

export interface CodexThreadData {
  id: string;
  createdAt?: number;
  cwd?: string;
  modelProvider?: string;
  status?: Record<string, unknown> | string;
  preview?: string;
}

export interface CodexThreadStartResult {
  thread: CodexThreadData;
  model?: string;
  modelProvider?: string;
  cwd?: string;
  approvalPolicy?: unknown;
}

export interface CodexTurnStartParams {
  sandboxPolicy?: { type: "readOnly" | "workspaceWrite" | "dangerFullAccess" } | undefined;
  approvalsReviewer?: string | undefined;
  threadId: string;
  input: CodexUserInputItem[];
  turnId?: string | null | undefined;
  model?: string | null | undefined;
  effort?: string | null | undefined;
  serviceTier?: string | null | undefined;
  approvalPolicy?: string | null | Record<string, unknown> | undefined;
  cwd?: string | null | undefined;
  collaborationMode?: {
    mode: "default" | "plan";
    settings: {
      model: string;
      reasoning_effort: string | null;
      developer_instructions: string | null;
    };
  } | null;
}

export interface CodexTurnData {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  items?: unknown[];
  error?: {
    message: string;
    codexErrorInfo?: unknown;
  } | null;
}

export interface CodexTurnStartResult {
  turn: CodexTurnData;
}

export interface CodexTurnSteerParams {
  threadId: string;
  turnId?: string | null | undefined;
  input: CodexUserInputItem[];
}

export interface CodexTurnInterruptParams {
  threadId: string;
  turnId?: string | null | undefined;
}

export interface CodexApprovalDecisionParams {
  requestId: string;
  decision: "accept" | "decline" | "cancel";
  feedback?: string | null | undefined;
}

export type CodexServerNotificationHandler = (notification: JsonRpcNotification) => void;
export type CodexServerRequestHandler = (request: JsonRpcRequest) => Promise<unknown>;
