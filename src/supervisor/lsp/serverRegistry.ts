/**
 * Language server configuration registry.
 * Each entry describes how to find and launch a language server for a given language.
 * Adding a new language = adding a new config here. Zero changes to shared code.
 */

export interface LanguageServerConfig {
  languageId: string;
  /** Command candidates in preference order. First found wins. */
  commands: { command: string; args: string[] }[];
  /** File extensions this server handles (with leading dot) */
  fileExtensions: string[];
  /** LSP initialization options passed to the server */
  initializationOptions?: unknown;
}

const typescriptConfig: LanguageServerConfig = {
  languageId: "typescript",
  commands: [
    // Project-local (most common for TS projects)
    { command: "node_modules/.bin/typescript-language-server", args: ["--stdio"] },
    // Global install
    { command: "typescript-language-server", args: ["--stdio"] },
  ],
  fileExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
};

const pythonConfig: LanguageServerConfig = {
  languageId: "python",
  commands: [
    { command: "pyright-langserver", args: ["--stdio"] },
    { command: "pylsp", args: [] },
  ],
  fileExtensions: [".py", ".pyi"],
};

const goConfig: LanguageServerConfig = {
  languageId: "go",
  commands: [{ command: "gopls", args: ["serve"] }],
  fileExtensions: [".go"],
};

const cssConfig: LanguageServerConfig = {
  languageId: "css",
  commands: [
    { command: "node_modules/.bin/vscode-css-language-server", args: ["--stdio"] },
    { command: "vscode-css-language-server", args: ["--stdio"] },
    { command: "css-languageserver", args: ["--stdio"] },
  ],
  fileExtensions: [".css", ".scss", ".less"],
};

const htmlConfig: LanguageServerConfig = {
  languageId: "html",
  commands: [
    { command: "node_modules/.bin/vscode-html-language-server", args: ["--stdio"] },
    { command: "vscode-html-language-server", args: ["--stdio"] },
    { command: "html-languageserver", args: ["--stdio"] },
  ],
  fileExtensions: [".html", ".htm"],
};

const jsonConfig: LanguageServerConfig = {
  languageId: "json",
  commands: [
    { command: "node_modules/.bin/vscode-json-language-server", args: ["--stdio"] },
    { command: "vscode-json-language-server", args: ["--stdio"] },
  ],
  fileExtensions: [".json", ".jsonc"],
};

const rustConfig: LanguageServerConfig = {
  languageId: "rust",
  commands: [{ command: "rust-analyzer", args: [] }],
  fileExtensions: [".rs"],
};

const configs: LanguageServerConfig[] = [
  typescriptConfig,
  pythonConfig,
  goConfig,
  cssConfig,
  htmlConfig,
  jsonConfig,
  rustConfig,
];

/** Find the language server config for a given file extension (with leading dot). */
export function getConfigForExtension(ext: string): LanguageServerConfig | undefined {
  return configs.find((c) => c.fileExtensions.includes(ext));
}

/** Find the language server config for a given language ID. */
export function getConfigForLanguage(languageId: string): LanguageServerConfig | undefined {
  return configs.find((c) => c.languageId === languageId);
}
