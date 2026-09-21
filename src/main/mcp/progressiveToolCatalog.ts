import type { StreamableHttpMcpToolSpec } from "./StreamableHttpMcpIngress";

export const TOOL_SEARCH_NAME = "craftstation_tool_search";
export const TOOL_INVOKE_NAME = "craftstation_tool_invoke";

export interface ProgressiveToolDisclosureOptions {
  enabled: boolean;
  minToolCount?: number;
  maxInlineSchemaChars?: number;
  maxSearchResults?: number;
}

export interface ProgressiveToolPlan {
  deferred: boolean;
  visibleTools: readonly StreamableHttpMcpToolSpec[];
  availableTools: readonly StreamableHttpMcpToolSpec[];
  maxSearchResults: number;
}

const SEARCH_TOOL: StreamableHttpMcpToolSpec = {
  name: TOOL_SEARCH_NAME,
  description:
    "Search this CraftStation MCP server for relevant tools. Returns complete tool definitions that can be called through craftstation_tool_invoke.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const INVOKE_TOOL: StreamableHttpMcpToolSpec = {
  name: TOOL_INVOKE_NAME,
  description:
    "Invoke one tool returned by craftstation_tool_search. The original tool permission, disabled state, and argument schema are checked again.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1 },
      arguments: { type: "object" },
    },
    required: ["name", "arguments"],
    additionalProperties: false,
  },
};

export function planProgressiveToolDisclosure(
  tools: readonly StreamableHttpMcpToolSpec[],
  disabledTools: readonly string[],
  options: ProgressiveToolDisclosureOptions | undefined,
): ProgressiveToolPlan {
  const disabled = new Set(disabledTools);
  const availableTools = tools.filter((tool) => !disabled.has(tool.name));
  const minToolCount = options?.minToolCount ?? 24;
  const maxInlineSchemaChars = options?.maxInlineSchemaChars ?? 16_000;
  const schemaChars = availableTools.reduce((sum, tool) => sum + JSON.stringify(tool).length, 0);
  const deferred =
    options?.enabled === true &&
    availableTools.length >= minToolCount &&
    schemaChars > maxInlineSchemaChars;
  return {
    deferred,
    visibleTools: deferred ? [SEARCH_TOOL, INVOKE_TOOL] : availableTools,
    availableTools,
    maxSearchResults: Math.max(1, Math.min(20, options?.maxSearchResults ?? 5)),
  };
}

export function searchProgressiveTools(
  tools: readonly StreamableHttpMcpToolSpec[],
  query: string,
  limit: number,
): StreamableHttpMcpToolSpec[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];
  return tools
    .map((tool) => ({ tool, score: toolScore(tool, queryTerms) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name),
    )
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.tool);
}

function toolScore(tool: StreamableHttpMcpToolSpec, terms: readonly string[]): number {
  const nameTokens = new Set(tokenize(tool.name.replaceAll("_", " ")));
  const descriptionTokens = new Set(tokenize(tool.description));
  const schemaTokens = new Set(tokenize(JSON.stringify(tool.inputSchema)));
  return terms.reduce((score, term) => {
    if (nameTokens.has(term)) return score + 8;
    if (descriptionTokens.has(term)) return score + 3;
    if (schemaTokens.has(term)) return score + 1;
    return score;
  }, 0);
}

function tokenize(value: string): string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const words = normalized.match(/[a-z0-9]+/gu) ?? [];
  const hanRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const han = hanRuns.flatMap((run) => {
    const chars = [...run];
    if (chars.length <= 2) return [run];
    return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
  });
  return [...new Set([...words, ...han])];
}

export function validateToolArguments(
  schema: Record<string, unknown>,
  value: unknown,
): string | undefined {
  return validateSchemaValue(schema, value, "arguments");
}

function validateSchemaValue(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
): string | undefined {
  if (Object.hasOwn(schema, "const") && !Object.is(schema.const, value)) {
    return `${path} must equal the declared const value`;
  }
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const alternatives = schema[keyword];
    if (Array.isArray(alternatives)) {
      const matches = alternatives.filter(
        (alternative) =>
          alternative &&
          typeof alternative === "object" &&
          !Array.isArray(alternative) &&
          validateSchemaValue(alternative as Record<string, unknown>, value, path) === undefined,
      ).length;
      if (keyword === "anyOf" ? matches < 1 : matches !== 1) {
        return `${path} must match ${keyword === "anyOf" ? "at least one" : "exactly one"} schema`;
      }
      return undefined;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    return `${path} must be one of the declared enum values`;
  }
  const type = schema.type;
  if (Array.isArray(type)) {
    const errors = type.flatMap((candidate) =>
      typeof candidate === "string"
        ? [validateSchemaValue({ ...schema, type: candidate }, value, path)]
        : ["invalid schema type"],
    );
    return errors.some((error) => error === undefined) ? undefined : errors[0];
  }
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return `${path} must be an object`;
    const record = value as Record<string, unknown>;
    const properties =
      schema.properties &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, unknown>)
        : {};
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof required === "string" && !Object.hasOwn(record, required)) {
        return `${path}.${required} is required`;
      }
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(record).find((key) => !Object.hasOwn(properties, key));
      if (unknown) return `${path}.${unknown} is not allowed`;
    }
    for (const [key, child] of Object.entries(properties)) {
      if (
        !Object.hasOwn(record, key) ||
        !child ||
        typeof child !== "object" ||
        Array.isArray(child)
      ) {
        continue;
      }
      const error = validateSchemaValue(
        child as Record<string, unknown>,
        record[key],
        `${path}.${key}`,
      );
      if (error) return error;
    }
    return undefined;
  }
  if (type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      return `${path} must contain at least ${schema.minItems} items`;
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      return `${path} must contain at most ${schema.maxItems} items`;
    }
    const items = schema.items;
    if (items && typeof items === "object" && !Array.isArray(items)) {
      for (let index = 0; index < value.length; index += 1) {
        const error = validateSchemaValue(
          items as Record<string, unknown>,
          value[index],
          `${path}[${index}]`,
        );
        if (error) return error;
      }
    }
    return undefined;
  }
  if (type === "string") {
    if (typeof value !== "string") return `${path} must be a string`;
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      return `${path} is shorter than ${schema.minLength} characters`;
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      return `${path} is longer than ${schema.maxLength} characters`;
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern, "u").test(value))
          return `${path} does not match its pattern`;
      } catch {
        return `${path} has an invalid schema pattern`;
      }
    }
    return undefined;
  }
  if (type === "number" || type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${path} must be a number`;
    if (type === "integer" && !Number.isInteger(value)) return `${path} must be an integer`;
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return `${path} must be at least ${schema.minimum}`;
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return `${path} must be at most ${schema.maximum}`;
    }
    return undefined;
  }
  if (type === "boolean")
    return typeof value === "boolean" ? undefined : `${path} must be a boolean`;
  if (type === "null") return value === null ? undefined : `${path} must be null`;
  return undefined;
}
