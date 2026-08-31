const SECRET_KEY =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|password|secret|credential|private[_-]?key)/iu;
const SECRET_VALUE =
  /(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/giu;

export function redactPortableText(value: string): { text: string; redactions: number } {
  let redactions = 0;
  const text = value.replace(SECRET_VALUE, () => {
    redactions++;
    return "[REDACTED]";
  });
  return { text, redactions };
}

export function sanitizePortableRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePortableRecord);
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactPortableText(value).text : value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    result[key] = sanitizePortableRecord(entry);
  }
  return result;
}
