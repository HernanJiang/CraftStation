import type { editor as MonacoEditor } from "monaco-editor";
import type { LspIpcTransport } from "./ipcTransport";
import { getLanguageFromPath } from "../views/FileEditorOverlay/parts/FileEditorPane/FileEditorPane";

type IDisposable = { dispose(): void };

function getLspDocumentLanguageId(filePath: string): string {
  const fileName = filePath.split("/").pop()?.toLowerCase() ?? "";
  const ext = fileName.split(".").pop() ?? "";
  switch (ext) {
    case "tsx":
      return "typescriptreact";
    case "jsx":
      return "javascriptreact";
    default:
      return getLanguageFromPath(filePath);
  }
}

/**
 * Manages LSP document synchronization — sends didOpen, didChange, didClose,
 * didSave notifications to the language server.
 */
export class DocumentSyncManager {
  private openDocuments = new Set<string>();
  private changeListeners = new Map<string, IDisposable>();

  constructor(private readonly transport: LspIpcTransport) {}

  /** Notify the server that a document was opened. */
  didOpen(uri: string, content: string, filePath: string): void {
    if (this.openDocuments.has(uri)) return;
    this.openDocuments.add(uri);

    void this.transport.sendMessage({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri,
          languageId: getLspDocumentLanguageId(filePath),
          version: 1,
          text: content,
        },
      },
    });
  }

  /** Subscribe to model content changes and forward them as didChange. */
  watchModel(model: MonacoEditor.ITextModel): void {
    const uri = model.uri.toString();
    if (this.changeListeners.has(uri)) return;

    let version = 2;
    const listener = model.onDidChangeContent(() => {
      void this.transport.sendMessage({
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          textDocument: { uri, version: version++ },
          contentChanges: [{ text: model.getValue() }],
        },
      });
    });

    this.changeListeners.set(uri, listener);
  }

  /** Notify the server that a document was saved. */
  didSave(uri: string, content: string): void {
    if (!this.openDocuments.has(uri)) return;
    void this.transport.sendMessage({
      jsonrpc: "2.0",
      method: "textDocument/didSave",
      params: {
        textDocument: { uri },
        text: content,
      },
    });
  }

  /** Notify the server that a document was closed. */
  didClose(uri: string): void {
    if (!this.openDocuments.has(uri)) return;
    this.openDocuments.delete(uri);

    const listener = this.changeListeners.get(uri);
    if (listener) {
      listener.dispose();
      this.changeListeners.delete(uri);
    }

    void this.transport.sendMessage({
      jsonrpc: "2.0",
      method: "textDocument/didClose",
      params: { textDocument: { uri } },
    });
  }

  dispose(): void {
    for (const listener of this.changeListeners.values()) listener.dispose();
    this.changeListeners.clear();
    this.openDocuments.clear();
  }
}
