export interface AgentPluginSource {
  kind: string;
  assets: readonly string[];
  srcDir: string;
}

export interface SharedForwardRuntime {
  src: string;
  destRel: string;
}

export function discoverAgentPluginSources(sourceAgentsDir: string): AgentPluginSource[];

export function resolveSharedForwardRuntime(sourceAgentsDir: string): SharedForwardRuntime;

export function stageAgentPlugins(options: {
  sourceAgentsDir: string;
  destinationBase: string;
}): void;
