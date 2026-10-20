# 1.11.9 远程网页唤醒/休眠（2026-10-20）

## 用户可见

- 远程浏览器线程（ChatGPT 网页等）切换标签页或线程后不再每次重新加载：30 分钟内切回秒开、页面状态完整保留；离开超过 30 分钟无交互后自动休眠释放内存，下次打开才重新加载。

## 实现

- `src/main/chatGptWeb/runtime.ts`：选中网页的保活信号由 4 秒宽限改为 30 分钟闲置超时（`VIEW_IDLE_TIMEOUT_MS`）。页面打开期间轮询持续续期；切走后 webview 转入既有离屏 background 宿主保持挂载，超时后才卸载（休眠），复用 `BrowserHost` 既有 background/hidden 模式与 `BrowserPanelManager` automation session 机制，渲染层零改动。

## 验证

- `pnpm typecheck` 通过，`oxlint` 0 警告 0 错误；隔离实例 changed 范围 mock 冒烟通过。

---

# 1.11.9 Remote webpage wake/sleep (2026-10-20)

## User-facing

- Remote browser threads (ChatGPT web and similar) no longer reload on every tab/thread switch: revisiting within 30 minutes is instant with full page state preserved; after 30 minutes without interaction the page sleeps to free memory and only reloads on the next open.

## Implementation

- `src/main/chatGptWeb/runtime.ts`: the selected webpage keep-alive signal changed from a 4-second grace to a 30-minute idle timeout (`VIEW_IDLE_TIMEOUT_MS`). Read polling re-arms it while the page is open; after switching away the webview stays mounted in the existing off-screen background host and only unmounts (sleeps) once the timeout elapses. Reuses the existing `BrowserHost` background/hidden modes and `BrowserPanelManager` automation sessions with zero renderer changes.

## Verification

- `pnpm typecheck` passed, `oxlint` reported 0 warnings and 0 errors; changed-scope mock smoke run passed on an isolated instance.
