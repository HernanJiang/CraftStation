import { toast } from "@heroui/react";
import { readBridge } from "@/renderer/bridge";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import { useUsageLoginStateStore } from "@/renderer/state/usageLoginStateStore";

/**
 * Volcengine Ark's OpenAI-compatible coding endpoint — the same surface the
 * usage collector probes (`VOLCENGINE_ARK_CHAT_COMPLETIONS_URL` in
 * `@craftstation/agents-usage`). Kept as a plain string here because the
 * collector module pulls `node:crypto` and must never enter the renderer
 * bundle.
 */
export const VOLCENGINE_ARK_CODING_BASE_URL = "https://ark.cn-beijing.volces.com/api/coding/v3";
export const VOLCENGINE_ARK_CHANNEL_LABEL = "Volcengine Ark";

/**
 * After a Volcengine login that included an Ark API key, auto-provision a
 * runnable model channel: stage the Ark coding endpoint as an
 * OpenAI-compatible account (real probe included) and import it into the
 * account pool, so 管理模型 and the homepage picker can list its models.
 *
 * Best-effort: quota login already succeeded at this point, so a failed
 * probe here only reports a warning — the login itself stays valid.
 */
export async function autoProvisionVolcengineArkChannel(input: {
  apiKey: string;
  model: string;
}): Promise<void> {
  const bridge = readBridge();
  const accounts = await bridge.listAccounts({});
  const exists = accounts.some(
    (account) =>
      account.provider === "openai-compatible" &&
      [account.providerAccountId, account.label, account.plan].some(
        (value) => value?.trim() === VOLCENGINE_ARK_CHANNEL_LABEL,
      ),
  );
  if (exists) return;
  let staged: Awaited<ReturnType<typeof bridge.submitOpenAiCompatibleCredentials>>;
  try {
    staged = await bridge.submitOpenAiCompatibleCredentials({
      baseUrl: VOLCENGINE_ARK_CODING_BASE_URL,
      apiKey: input.apiKey,
      providerName: VOLCENGINE_ARK_CHANNEL_LABEL,
      model: input.model,
    });
  } catch (error) {
    toast.warning(
      `额度已登录；自动创建火山方舟模型渠道失败（${error instanceof Error ? error.message : "验证未通过"}），可在「OpenAI 兼容 API」手动添加。`,
    );
    return;
  }
  if (!staged.ok) {
    toast.warning(
      `额度已登录；自动创建火山方舟模型渠道失败（${staged.error ?? "验证未通过"}），可在「OpenAI 兼容 API」手动添加。`,
    );
    return;
  }
  try {
    await bridge.importOpenAiCompatibleProfile({});
  } catch (error) {
    // 导入阶段失败最容易被误读为“显示成功但没有新渠道”：必须给出明确提示，
    // 不能静默吞掉。
    toast.warning(
      `额度已登录；火山方舟模型渠道导入失败（${error instanceof Error ? error.message : "导入未通过"}），可在「OpenAI 兼容 API」手动添加。`,
    );
    return;
  }
  const refreshed = await bridge.listAccounts({});
  useUsageAccountsStore.getState().setAccounts(refreshed);
  useUsageLoginStateStore.getState().setStored("openai-compatible", true);
  toast.success("已自动添加火山方舟模型渠道，可在「管理模型」中获取并勾选模型。");
}
