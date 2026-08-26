import { describe, expect, it, vi } from "vitest";
import { DocumentSyncManager } from "./documentSync";
import type { LspIpcTransport } from "./ipcTransport";

function createTransport() {
  const messages: unknown[] = [];
  const transport = {
    sendMessage: vi.fn<(message: unknown) => Promise<unknown>>(async (message) => {
      messages.push(message);
      return undefined;
    }),
  } as unknown as LspIpcTransport;
  return { transport, messages };
}

describe("DocumentSyncManager", () => {
  it("uses React-flavored TypeScript language IDs for TSX documents", () => {
    const { transport, messages } = createTransport();
    const sync = new DocumentSyncManager(transport);

    sync.didOpen("file:///repo/src/App.tsx", "export function App() {}", "src/App.tsx");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: "file:///repo/src/App.tsx",
          languageId: "typescriptreact",
        },
      },
    });
  });
});
