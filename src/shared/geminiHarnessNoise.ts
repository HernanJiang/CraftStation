/**
 * Gemini CLI / Antigravity injects async-tool wait receipts and
 * `<system_information>` blocks into the model stream. Those are harness
 * protocol, not assistant or thinking text — painting them in chat is the
 * "format exploded / wrap-up garbage" failure.
 *
 * Leave ordinary text (including in-stream whitespace) untouched.
 */

const SYSTEM_INFORMATION_BLOCK = /<system_information\b[^>]*>[\s\S]*?(?:<\/system_information>|$)/i;
const ASYNC_TASK_COMPLETED = /An async task has completed\.[^\n]*/i;
const WAIT_FOR_TASK_HEADER = /Wait for\b[\s\S]*?Task id\s+"[^"]+"\s+finished with result:/i;

export function stripGeminiHarnessNoise(text: string): string | undefined {
  if (!text) return undefined;
  if (
    !SYSTEM_INFORMATION_BLOCK.test(text) &&
    !ASYNC_TASK_COMPLETED.test(text) &&
    !WAIT_FOR_TASK_HEADER.test(text)
  ) {
    return text;
  }
  let next = text
    .replace(new RegExp(SYSTEM_INFORMATION_BLOCK, "gi"), "")
    .replace(new RegExp(ASYNC_TASK_COMPLETED, "gi"), "");
  next = stripWaitForTaskReceipts(next).replace(/\n{3,}/g, "\n\n");
  return next.trim().length > 0 ? next.trim() : undefined;
}

function stripWaitForTaskReceipts(text: string): string {
  let remaining = text;
  let output = "";
  while (remaining.length > 0) {
    const header = remaining.match(WAIT_FOR_TASK_HEADER);
    if (!header || header.index === undefined) {
      output += remaining;
      break;
    }
    output += remaining.slice(0, header.index);
    let rest = remaining.slice(header.index + header[0].length).replace(/^\s+/, "");
    if (/^The command exited with code\b/i.test(rest)) {
      const logLine = /\nLog:\s+\S+[^\n]*/.exec(rest);
      rest = logLine ? rest.slice(logLine.index + logLine[0].length) : "";
    }
    remaining = rest;
  }
  return output;
}
