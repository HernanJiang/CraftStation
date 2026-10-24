// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({
  config: vi.fn<(config: unknown) => void>(),
  init: vi.fn<() => Promise<{ editor: object }>>(() => Promise.resolve({ editor: {} })),
}));
const captureRendererException = vi.hoisted(() =>
  vi.fn<(error: unknown, context?: unknown) => void>(),
);

class TestWorker extends EventTarget {
  constructor(readonly kind: string) {
    super();
  }
}

vi.mock("@monaco-editor/react", () => ({ loader }));
vi.mock("monaco-editor", () => ({ editor: {} }));
vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({
  default: class extends TestWorker {
    constructor() {
      super("editor");
    }
  },
}));
vi.mock("monaco-editor/esm/vs/language/css/css.worker?worker", () => ({
  default: class extends TestWorker {
    constructor() {
      super("css");
    }
  },
}));
vi.mock("monaco-editor/esm/vs/language/html/html.worker?worker", () => ({
  default: class extends TestWorker {
    constructor() {
      super("html");
    }
  },
}));
vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => ({
  default: class extends TestWorker {
    constructor() {
      super("json");
    }
  },
}));
vi.mock("monaco-editor/esm/vs/language/typescript/ts.worker?worker", () => ({
  default: class extends TestWorker {
    constructor() {
      super("typescript");
    }
  },
}));
vi.mock("@/renderer/diagnostics/sentry", () => ({ captureRendererException }));

describe("monacoRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("configures @monaco-editor/react with the bundled ESM instance", async () => {
    vi.resetModules();
    const { initializeMonaco } = await import("./monacoRuntime");

    await initializeMonaco();

    expect(loader.config).toHaveBeenCalledExactlyOnceWith({ monaco: { editor: {} } });
    expect(loader.config.mock.calls[0]?.[0]).not.toHaveProperty("paths");
  });

  it.each([
    ["json", "json"],
    ["css", "css"],
    ["scss", "css"],
    ["less", "css"],
    ["html", "html"],
    ["handlebars", "html"],
    ["razor", "html"],
    ["typescript", "typescript"],
    ["javascript", "typescript"],
    ["plaintext", "editor"],
    ["editorWorkerService", "editor"],
  ])("creates the bundled %s worker", async (label, expectedKind) => {
    const { createMonacoWorker, initializeMonaco } = await import("./monacoRuntime");
    await initializeMonaco();

    expect((createMonacoWorker(label) as unknown as TestWorker).kind).toBe(expectedKind);
  });
});
