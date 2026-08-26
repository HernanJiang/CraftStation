import type { ThreadConfig } from "@/shared/contracts";

function cursorCliEffortSuffix(model: string, effort: string | undefined): string | undefined {
  if (!effort) return undefined;
  if (effort === "xhigh") {
    return model.startsWith("gpt-5.5") ? "extra-high" : "xhigh";
  }
  return effort;
}

function insertCursorThinkingSuffix(model: string): string {
  if (/-thinking(?:-fast)?$/i.test(model)) return model;
  const opus47 = /^(claude-opus-4-7)(?:-(none|low|medium|high|xhigh|max))?(-fast)?$/i.exec(model);
  if (opus47?.[2]) {
    return `${opus47[1]}-thinking-${opus47[2]}${opus47[3] ?? ""}`;
  }
  if (/-fast$/i.test(model)) return model.replace(/-fast$/i, "-thinking-fast");
  return `${model}-thinking`;
}

export function resolveCursorCliModel(config: ThreadConfig): string {
  if (!config.model || config.model === "auto") {
    return config.model || "auto";
  }

  const suffix = cursorCliEffortSuffix(config.model, config.effort);
  const withEffort =
    suffix && !new RegExp(`-${suffix}$`, "i").test(config.model)
      ? `${config.model}-${suffix}`
      : config.model;

  if (config.fast === true && !/-fast$/i.test(withEffort)) {
    const withFast = `${withEffort}-fast`;
    return config.thinking === true ? insertCursorThinkingSuffix(withFast) : withFast;
  }
  return config.thinking === true ? insertCursorThinkingSuffix(withEffort) : withEffort;
}

export function buildCursorArgs(
  config: ThreadConfig,
  prompt: string,
  resumeSessionId?: string,
): string[] {
  const args: string[] = [];

  if (resumeSessionId) {
    args.push(`--resume=${resumeSessionId}`);
  }
  args.push("--model", resolveCursorCliModel(config));
  if (config.mode === "plan") {
    args.push("--mode", "plan");
  }
  if (config.approvalPolicy === "never") {
    args.push("--yolo");
  }
  if (prompt.trim().length > 0) {
    args.push(prompt);
  }

  return args;
}
