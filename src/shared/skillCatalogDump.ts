/**
 * Grok (and similar ACP agents) sometimes echo the local skill catalog as an
 * assistant message immediately before MCP/tool calls. The dump is a wrap of
 * kebab-case skill ids with no prose — not a user-facing answer.
 *
 * The catalog often streams: first chunk is `Available skills:`, later chunks
 * are the id list. Classify so the mapper can hold prefixes and drop the dump
 * instead of painting it as a chat row.
 */

const SKILL_TOKEN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/iu;
const HEADER = /^(?:available\s+)?skills?\s*:?\s*$/iu;
const STOPWORD =
  /^(?:the|a|an|is|are|was|were|to|for|and|or|of|in|on|with|this|that|it|i|you|we|please|use|using|let|me|be|as|at|by|from|not|but|if|then|so|do|can|will|just|also|here|there)$/iu;
const SENTENCE_PUNCT = /[。？！.?!]/u;
const CJK = /[\u3400-\u9fff]/u;
const MIN_TOKENS = 6;

export type SkillCatalogTextKind = "dump" | "header" | "prefix" | "prose";

export function classifySkillCatalogText(text: string): SkillCatalogTextKind {
  const trimmed = text.trim();
  if (!trimmed) return "prose";
  if (SENTENCE_PUNCT.test(trimmed) || CJK.test(trimmed)) return "prose";

  const withoutFences = trimmed.replace(/```[\s\S]*?```/gu, " ").replace(/`([^`]+)`/gu, "$1");
  const lines = withoutFences
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "prose";
  if (lines.length === 1 && HEADER.test(lines[0]!)) return "header";

  const bodyLines = lines[0] && HEADER.test(lines[0]) ? lines.slice(1) : lines;
  if (bodyLines.length === 0) return "header";

  const tokens = bodyLines
    .flatMap((line) => line.replace(/^[-*]\s+/u, "").split(/[\s,，;；|/]+/u))
    .map((token) => token.replace(/^[-*`/$]+|[-*`]+$/gu, ""))
    .filter(Boolean);

  if (tokens.length === 0) return "header";
  if (tokens.some((token) => STOPWORD.test(token))) return "prose";
  if (!tokens.every((token) => SKILL_TOKEN.test(token))) return "prose";
  if (tokens.length >= MIN_TOKENS) return "dump";
  // Short unhyphenated words ("Hello", "Looking") are ordinary prose.
  // Hold only a catalog header or kebab-case skill ids while they stream in.
  const fromHeader = Boolean(lines[0] && HEADER.test(lines[0]));
  if (fromHeader || tokens.some((token) => token.includes("-"))) return "prefix";
  return "prose";
}

export function isSkillCatalogDump(text: string): boolean {
  const kind = classifySkillCatalogText(text);
  return kind === "dump" || kind === "header";
}

export function shouldHoldSkillCatalogChunk(text: string): boolean {
  const kind = classifySkillCatalogText(text);
  return kind === "dump" || kind === "header" || kind === "prefix";
}

function textFromContentBlocks(
  content: ReadonlyArray<{
    kind: string;
    text?: string | undefined;
    name?: string | undefined;
    invocation?: string | undefined;
  }>,
): string {
  return content
    .map((block) => {
      if (block.kind === "text") return block.text ?? "";
      if (block.kind === "skill") return block.invocation ?? block.name ?? "";
      return "";
    })
    .join(" ");
}

/**
 * A user bubble that is only a skill-catalog dump (dozens of skill chips /
 * kebab-case ids, no real prompt). Grok plan turns used to submit the local
 * slash-command catalog as the user message.
 */
export function isSkillCatalogUserContent(
  content:
    | ReadonlyArray<{
        kind: string;
        text?: string | undefined;
        name?: string | undefined;
        invocation?: string | undefined;
      }>
    | undefined,
  extraText?: string,
): boolean {
  if (!content || content.length === 0) {
    return extraText ? isSkillCatalogDump(extraText) : false;
  }
  if (
    content.some(
      (block) =>
        block.kind !== "text" &&
        block.kind !== "skill",
    )
  ) {
    return false;
  }
  const skillCount = content.filter((block) => block.kind === "skill").length;
  const text = `${textFromContentBlocks(content)} ${extraText ?? ""}`;
  if (skillCount >= MIN_TOKENS && classifySkillCatalogText(text) !== "prose") return true;
  return isSkillCatalogDump(text);
}

/**
 * Outbound turn gate: drop a catalog-only prompt, but keep a real user
 * request even when recipe/skill chips were attached beside it.
 */
export function isSkillCatalogOutboundTurn(
  prompt: string,
  content?: ReadonlyArray<{
    kind: string;
    text?: string | undefined;
    name?: string | undefined;
    invocation?: string | undefined;
  }>,
): boolean {
  if (isSkillCatalogDump(prompt)) return true;
  if (prompt.trim() && classifySkillCatalogText(prompt) === "prose") return false;
  return isSkillCatalogUserContent(content, prompt);
}
