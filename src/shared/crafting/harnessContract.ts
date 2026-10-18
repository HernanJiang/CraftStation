import { z } from "zod";
import { CraftingError } from "./errors";
import type { Item } from "./types";

/**
 * 编译期 Harness 能力声明。和证据门控的 capability 报告分开：
 * 报告里没有 `permission: supported+integrated`，不代表产品没有审批界面。
 */
export const harnessApprovalSchema = z.enum(["ui", "terminal", "none"]);
export const harnessResumeSchema = z.enum(["native", "none"]);
export const harnessInstructionsSchema = z.enum(["delivered", "not-delivered"]);

export const harnessContractSchema = z.object({
  approval: harnessApprovalSchema,
  resume: harnessResumeSchema,
  instructions: harnessInstructionsSchema,
});
export type HarnessContract = z.infer<typeof harnessContractSchema>;

/** 缺哪一轴，Recipe 就不检查那一轴。 */
export const harnessContractRequirementSchema = harnessContractSchema.partial();
export type HarnessContractRequirement = z.infer<typeof harnessContractRequirementSchema>;

export const HARNESS_CONTRACTS: Record<string, HarnessContract> = {
  codex: { approval: "ui", resume: "native", instructions: "delivered" },
  grok: { approval: "ui", resume: "native", instructions: "delivered" },
  kimi: { approval: "ui", resume: "native", instructions: "delivered" },
  minimax: { approval: "ui", resume: "native", instructions: "delivered" },
  devin: { approval: "ui", resume: "native", instructions: "delivered" },
  antigravity: { approval: "ui", resume: "native", instructions: "delivered" },
  muse: { approval: "ui", resume: "native", instructions: "delivered" },
  opencode: { approval: "ui", resume: "native", instructions: "delivered" },
  claude: { approval: "ui", resume: "none", instructions: "delivered" },
  stepcode: { approval: "none", resume: "native", instructions: "delivered" },
  pi: { approval: "none", resume: "none", instructions: "delivered" },
  deepseek: { approval: "none", resume: "none", instructions: "delivered" },
  "deepseek-api": { approval: "none", resume: "none", instructions: "not-delivered" },
  zcode: { approval: "terminal", resume: "native", instructions: "not-delivered" },
};

/** 兼容桥换 Harness 时必须保住的能力。弱声明或没有声明都拒绝编译。 */
export const COMPATIBILITY_REQUIRED_CONTRACT: HarnessContractRequirement = {
  approval: "ui",
  resume: "native",
  instructions: "delivered",
};

/**
 * 只要求这份声明里真正有的轴，这样 Harness 自己的 Recipe 仍能编译。
 * `none` / `not-delivered` 不写成要求。
 */
export function requiredContractFor(kind: string): HarnessContractRequirement {
  const declared = HARNESS_CONTRACTS[kind];
  if (!declared) return {};
  const required: HarnessContractRequirement = {};
  if (declared.approval === "ui" || declared.approval === "terminal") {
    required.approval = declared.approval;
  }
  if (declared.resume === "native") required.resume = "native";
  if (declared.instructions === "delivered") required.instructions = "delivered";
  return required;
}

export function harnessContractComponent(
  kind: string,
): ({ kind: "harness_contract" } & HarnessContract) | undefined {
  const contract = HARNESS_CONTRACTS[kind];
  if (!contract) return undefined;
  return { kind: "harness_contract", ...contract };
}

function harnessKindOf(item: Item): string | undefined {
  const runtime = item.components.find((component) => component.kind === "harness_runtime");
  if (runtime && typeof runtime.harnessKind === "string" && runtime.harnessKind.length > 0) {
    return runtime.harnessKind;
  }
  const id = item.metadata.id.replace(/^harness:/, "");
  return id.length > 0 ? id : undefined;
}

/**
 * Item 上的 `harness_contract` 优先于内置表。显式组件解析失败时不回退到表，
 * 避免一份写坏的声明被静默换成更强的内置能力。
 */
export function declaredHarnessContract(item: Item): HarnessContract | undefined {
  const explicit = item.components.find((component) => component.kind === "harness_contract");
  if (explicit) {
    const parsed = harnessContractSchema.safeParse(explicit);
    return parsed.success ? parsed.data : undefined;
  }
  const kind = harnessKindOf(item);
  return kind ? HARNESS_CONTRACTS[kind] : undefined;
}

export function assertHarnessContract(
  item: Item,
  required: HarnessContractRequirement | undefined,
): void {
  if (!required) return;
  const axes = (["approval", "resume", "instructions"] as const).filter(
    (axis) => required[axis] !== undefined,
  );
  if (axes.length === 0) return;

  const declared = declaredHarnessContract(item);
  if (!declared) {
    throw CraftingError.compilationError(
      `目标 Harness「${item.metadata.name}」没有声明 Recipe 要求的能力，拒绝编译。`,
      { harnessId: item.id, required },
      "换用声明了这些能力的 Harness，或放宽这条 Recipe 的能力要求。",
    );
  }

  const missing: Record<string, { required: string; declared: string }> = {};
  for (const axis of axes) {
    const want = required[axis];
    const have = declared[axis];
    if (want !== undefined && want !== have) {
      missing[axis] = { required: want, declared: have };
    }
  }
  if (Object.keys(missing).length === 0) return;

  throw CraftingError.compilationError(
    `目标 Harness「${item.metadata.name}」没有声明 Recipe 要求的能力，拒绝编译。`,
    { harnessId: item.id, required, declared, missing },
    "换用声明了这些能力的 Harness，或放宽这条 Recipe 的能力要求。审批界面和终端确认不能互相顶替。",
  );
}
