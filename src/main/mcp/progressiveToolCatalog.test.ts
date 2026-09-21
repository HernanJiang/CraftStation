import { describe, expect, it } from "vitest";
import {
  planProgressiveToolDisclosure,
  searchProgressiveTools,
  TOOL_INVOKE_NAME,
  TOOL_SEARCH_NAME,
  validateToolArguments,
} from "./progressiveToolCatalog";

const tools = Array.from({ length: 30 }, (_, index) => ({
  name: index === 7 ? "browser_open" : `tool_${index}`,
  description:
    index === 7 ? "Open a URL in the web browser" : `Utility ${index} ${"x".repeat(700)}`,
  inputSchema: {
    type: "object",
    properties: { url: { type: "string" } },
    required: index === 7 ? ["url"] : [],
    additionalProperties: false,
  },
}));

describe("progressive MCP tool disclosure", () => {
  it("replaces a large catalog with search/invoke while retaining the real registry", () => {
    const plan = planProgressiveToolDisclosure(tools, ["tool_3"], { enabled: true });
    expect(plan.deferred).toBe(true);
    expect(plan.visibleTools.map((tool) => tool.name)).toEqual([
      TOOL_SEARCH_NAME,
      TOOL_INVOKE_NAME,
    ]);
    expect(plan.availableTools.some((tool) => tool.name === "tool_3")).toBe(false);
  });

  it("finds Chinese and English intent without exposing unrelated definitions", () => {
    expect(searchProgressiveTools(tools, "open browser url", 3)[0]?.name).toBe("browser_open");
    const localized = [
      ...tools,
      { name: "capture", description: "截取浏览器页面截图", inputSchema: { type: "object" } },
    ];
    expect(searchProgressiveTools(localized, "浏览器截图", 3)[0]?.name).toBe("capture");
  });

  it("fails closed for required, unknown, and incorrectly typed arguments", () => {
    const schema = tools[7]!.inputSchema;
    expect(validateToolArguments(schema, {})).toContain("url is required");
    expect(validateToolArguments(schema, { url: 1 })).toContain("must be a string");
    expect(validateToolArguments(schema, { url: "https://example.com", extra: true })).toContain(
      "is not allowed",
    );
    expect(validateToolArguments(schema, { url: "https://example.com" })).toBeUndefined();
    expect(
      validateToolArguments(
        { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 5 } } },
        { limit: 6 },
      ),
    ).toContain("at most 5");
  });
});
