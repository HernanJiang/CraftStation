/**
 * Some agent MCP bridges (observed with OpenCode) JSON.stringify nested
 * object/array tool arguments into strings before sending tools/call, so the
 * receiving validators fail with "expected object, received string". These
 * helpers unwrap that server-side, keyed off the tool's DECLARED inputSchema:
 * a parameter is only converted when the schema says it is an object/array,
 * so a string-typed parameter that happens to hold valid JSON text is never
 * mangled.
 */

/**
 * Parse a stringified-JSON argument back into its value, passing anything
 * else (non-strings, invalid JSON) through untouched. Suitable as a zod
 * `z.preprocess` for object/array params an agent bridge may have stringified.
 */
export function tryParseStringifiedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Schema-aware unwrapping for a whole tools/call arguments bag: convert only
 * parameters whose declared inputSchema type is object/array (directly, as a
 * type-union member, or in any oneOf/anyOf branch) and whose text starts with
 * `{`/`[` and parses as JSON. Everything else is returned untouched.
 */
export function coerceStringifiedJsonArgs(
  args: Record<string, unknown>,
  inputSchema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const properties =
    inputSchema && typeof inputSchema === "object"
      ? (inputSchema as { properties?: unknown }).properties
      : undefined;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return args;
  let next: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    if (!declaresObjectOrArray((properties as Record<string, unknown>)[key])) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      next ??= { ...args };
      next[key] = parsed;
    } catch {
      // Not valid JSON after all — keep the original string so the tool's own
      // validation reports the type mismatch against the declared schema.
    }
  }
  return next ?? args;
}

function declaresObjectOrArray(schema: unknown): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const node = schema as { type?: unknown; oneOf?: unknown; anyOf?: unknown };
  if (node.type === "object" || node.type === "array") return true;
  if (Array.isArray(node.type) && (node.type.includes("object") || node.type.includes("array"))) {
    return true;
  }
  for (const unionKey of ["oneOf", "anyOf"] as const) {
    const branches = node[unionKey];
    if (Array.isArray(branches) && branches.some((branch) => declaresObjectOrArray(branch))) {
      return true;
    }
  }
  return false;
}
