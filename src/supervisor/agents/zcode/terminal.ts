import type { TerminalStatusHint } from "../base";
import { stripAnsi } from "@/shared/ansi";

export function detectZCodeTerminalStatus(text: string): TerminalStatusHint | null {
  const normalized = stripAnsi(text).toLowerCase();
  if (/permission|allow once|deny|确认|允许/u.test(normalized)) {
    return { status: "working", attention: "needs_approval" };
  }
  if (/thinking|running tool|working|generating|思考|执行工具/u.test(normalized)) {
    return { status: "working", attention: "working" };
  }
  if (/type your message|enter.*send|输入消息|发送消息/u.test(normalized)) {
    return { status: "idle", attention: "none" };
  }
  if (/error:|failed:|错误：|失败：/u.test(normalized)) {
    return { status: "error", attention: "error" };
  }
  return null;
}
