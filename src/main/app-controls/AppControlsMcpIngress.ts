import type { Project, ProjectNotes, RemoteThreadCommand, Thread } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import type { RemoteProjectCommand, RemoteProjectCommandResult } from "@/shared/remote";
import type { ThreadExchange } from "@/shared/threadCollaboration";
import {
  StreamableHttpMcpIngress,
  type StreamableHttpMcpIngressInfo,
} from "../mcp/StreamableHttpMcpIngress";
import type { CreateAppThreadRequest, CreateAppThreadResult } from "../threads/appThreadLauncher";
import { ThreadStateBroker } from "../threads/threadStateBroker";
import { ThreadCollaborationService, ThreadControlAdapter } from "../thread-collaboration";
import { InterHarnessMessageBus } from "../thread-messaging/interHarnessMessageBus";
import {
  APP_CONTROLS_MCP_INSTRUCTIONS,
  APP_CONTROLS_MCP_SERVER_INFO,
  TOOLS,
  dispatchTool,
  formatToolResult,
  isKnownToolName,
  type AppControlsAppInfo,
  type AppControlsNotifyResult,
  type AppControlsSettingsGateway,
  type AppControlsSupervisorCaller,
  type AppControlsToolContext,
  type AppControlsUpdateCheck,
} from "./mcp/toolRegistry";

export type AppControlsMcpIngressInfo = StreamableHttpMcpIngressInfo;

/** Main-side seams the app-controls MCP server acts through. */
export interface AppControlsMcpIngressDeps {
  getThread(threadId: string): Thread | null;
  getThreads(): Thread[];
  getProjects(): Project[];
  getProject(projectId: string): Project | null;
  getProjectNotes(projectId: string): ProjectNotes | null;
  directoryExists(path: string): boolean;
  applyProjectCommand(command: RemoteProjectCommand): Promise<RemoteProjectCommandResult>;
  updateProject(project: Project): void;
  settings: AppControlsSettingsGateway;
  getAppInfo(): AppControlsAppInfo;
  supervisor: AppControlsSupervisorCaller;
  createThread(request: CreateAppThreadRequest): Promise<CreateAppThreadResult>;
  emitRemoteThreadCommand(command: RemoteThreadCommand): boolean;
  updateThreadRow(threadId: string, mutate: (thread: Thread) => Thread): void;
  openThreadInUi(threadId: string): boolean;
  notifyUser(input: { title: string; body: string; threadId: string }): AppControlsNotifyResult;
  checkForUpdate(): Promise<AppControlsUpdateCheck>;
  onExchangeChanged?(exchange: ThreadExchange): void;
  /**
   * Resolve an OpenCode provider session id (injected per tool call by the
   * in-process plugin) to its CraftStation thread row, so shared-sidecar
   * threads keep a correct caller identity on cross-thread tools.
   */
  resolveThreadIdBySessionId?(sessionId: string): string | null;
}

export class AppControlsMcpIngress {
  private readonly ingress: StreamableHttpMcpIngress<AppControlsToolContext>;
  /** Persistent live-status cache + wait surface, fed by {@link observeSupervisorEvent}. */
  private readonly threadStates = new ThreadStateBroker();
  private readonly threadControl: ThreadControlAdapter;
  private readonly threadCollaboration: ThreadCollaborationService;
  private readonly messageBus: InterHarnessMessageBus;

  constructor(deps: AppControlsMcpIngressDeps) {
    this.threadControl = new ThreadControlAdapter({
      getThread: deps.getThread,
      getThreads: deps.getThreads,
      getProject: deps.getProject,
      settings: () => deps.settings.read(),
      runtime: deps.supervisor,
      states: this.threadStates,
    });
    this.threadCollaboration = new ThreadCollaborationService({
      control: this.threadControl,
      ...(deps.onExchangeChanged ? { onExchangeChanged: deps.onExchangeChanged } : {}),
    });
    // Thin native-thread bus over the same control plane and durable ledger:
    // peer addresses, external-thread claims, and agent-facing messaging.
    // Claimed rows are mirrored to the renderer without launching a runtime
    // (launchRuntime:false) so binding never disturbs the real native thread.
    this.messageBus = new InterHarnessMessageBus({
      collaboration: this.threadCollaboration,
      control: this.threadControl,
      getProjectLocation: (projectId) => deps.getProject(projectId)?.location ?? null,
      listProjectLocations: () =>
        deps
          .getProjects()
          .map((project) => ({ projectId: project.id, location: project.location })),
      mirrorThreadToRenderer: (thread) => {
        deps.emitRemoteThreadCommand({
          kind: "start",
          threadId: thread.id,
          projectId: thread.projectId,
          agentKind: thread.agentKind,
          config: thread.config,
          prompt: "",
          title: thread.title,
          presentationMode: "gui",
          launchRuntime: false,
          focus: false,
        });
      },
      mirrorThreadDeletion: (threadId) => {
        deps.emitRemoteThreadCommand({ kind: "delete", threadId });
      },
      createThread: (request) => deps.createThread(request),
    });
    this.ingress = new StreamableHttpMcpIngress<AppControlsToolContext>({
      serverInfo: { ...APP_CONTROLS_MCP_SERVER_INFO },
      instructions: APP_CONTROLS_MCP_INSTRUCTIONS,
      tools: TOOLS,
      progressiveDisclosure: { enabled: true },
      isKnownToolName,
      buildContext: (identity) => ({
        ...deps,
        identity,
        threadStates: this.threadStates,
        threadControl: this.threadControl,
        threadCollaboration: this.threadCollaboration,
      }),
      ...(deps.resolveThreadIdBySessionId
        ? { resolveThreadIdBySessionId: deps.resolveThreadIdBySessionId }
        : {}),
      dispatchTool,
      formatToolResult,
    });
  }

  /** Wire into the supervisor event tap (main.ts / headless host `onEvent`). */
  observeSupervisorEvent(event: SupervisorEvent): void {
    this.threadStates.observe(event);
    this.threadCollaboration.observeSupervisorEvent(event);
  }

  /** Resume durable queued/correlating exchanges after the database and MCP are ready. */
  recoverThreadCollaboration(): Promise<void> {
    return this.threadCollaboration.recover();
  }

  getThreadCollaborationService(): ThreadCollaborationService {
    return this.threadCollaboration;
  }

  getInterHarnessMessageBus(): InterHarnessMessageBus {
    return this.messageBus;
  }

  start(): Promise<AppControlsMcpIngressInfo> {
    return this.ingress.start();
  }

  getInfo(): AppControlsMcpIngressInfo | null {
    return this.ingress.getInfo();
  }

  dispose(): void {
    this.ingress.dispose();
  }
}
