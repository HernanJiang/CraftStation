import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { chatGptPageScript, type ChatGptPageSnapshot } from "./pageDriver";

it("普通 HTML 交互回复无需 iframe 或专用标记也会自动映射，且不被压平成正文", () => {
  const dom = new JSDOM(
    `<textarea id="prompt-textarea"></textarea>
    <div data-testid="conversation-turn-1">
      <div data-message-author-role="assistant" data-message-id="answer-1">
        <div class="markdown"><p>给你做了几个小玩意。</p>
          <section><h2>解压点击器</h2><output>0</output><button>给我点！</button></section>
          <section><h2>心情调节器</h2><input type="range" min="0" max="100" /></section>
        </div>
      </div>
      <button aria-label="复制回复">复制</button>
    </div>`,
    { url: "https://chatgpt.com/c/widget-fixture", runScripts: "outside-only" },
  );
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    value: () => ({
      x: 20,
      y: 40,
      top: 40,
      left: 20,
      width: 500,
      height: 300,
      right: 520,
      bottom: 340,
    }),
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", { value: () => [{}] });
  const result = dom.window.eval(chatGptPageScript("read")) as ChatGptPageSnapshot;
  const answer = result.messages[0]!;
  expect(answer.widgets?.filter((w) => w.kind !== "response")).toHaveLength(2);
  expect(answer.widgets?.map((w) => w.title)).toContain("解压点击器");
  expect(answer.text).toContain("给你做了几个小玩意");
  expect(answer.text).not.toContain("解压点击器");
  expect(answer.text).not.toContain("心情调节器");
  dom.window.close();
});
