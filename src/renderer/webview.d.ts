/**
 * Electron's <webview> custom element. React already declares `<webview>` as
 * an intrinsic JSX element with `WebViewHTMLAttributes`; here we extend the
 * DOM `HTMLWebViewElement` interface with the runtime methods we use.
 */
declare global {
  interface HTMLWebViewElement extends HTMLElement {
    src: string;
    partition: string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    reloadIgnoringCache(): void;
    loadURL(
      url: string,
      options?: { httpReferrer?: string; userAgent?: string; extraHeaders?: string },
    ): Promise<void>;
    getWebContentsId(): number;
    getURL(): string;
    getTitle(): string;
    isLoading(): boolean;
    openDevTools(): void;
    closeDevTools(): void;
    isDevToolsOpened(): boolean;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
    focus(): void;
  }

  interface HTMLElementTagNameMap {
    webview: HTMLWebViewElement;
  }
}

export {};
