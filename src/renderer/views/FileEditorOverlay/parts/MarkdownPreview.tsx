import { createMathPlugin } from "@streamdown/math";
import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import type { AnchorHTMLAttributes } from "react";
import {
  normalizeLatexMathDelimiters,
  protectMathSpans,
} from "@/renderer/components/thread/ChatPane/parts/items/ItemMarkdown";

// Same KaTeX pair the chat renderer uses. remark-math only sees `$` / `$$`;
// the prepare step also accepts `\( \)` / `\[ \]` and rewrites `<` inside
// math to `\lt` so micromark doesn't take it as an HTML tag. Bare tags in
// the file stay raw — this preview opts into rehype-raw, unlike chat.
const markdownMathPlugin = createMathPlugin({ singleDollarTextMath: true });
const remarkPlugins = [remarkGfm, markdownMathPlugin.remarkPlugin];
const rehypePlugins = [markdownMathPlugin.rehypePlugin, rehypeRaw];

const components = {
  a: ({ children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    // eslint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- anchor rendered by react-markdown always has children via props spread
    <a
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        if (rest.href) window.open(rest.href, "_blank");
      }}
    >
      {children}
    </a>
  ),
};

export function MarkdownPreview(props: { content: string; compact?: boolean }) {
  return (
    <div className={`h-full overflow-auto ${props.compact ? "px-5 py-3" : "px-6 py-4"}`}>
      <div
        className={`craftstation-markdown-preview mx-auto w-full max-w-3xl ${props.compact ? "craftstation-markdown-preview--compact" : ""}`}
      >
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
        >
          {prepareMarkdownPreviewSource(props.content)}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function prepareMarkdownPreviewSource(content: string): string {
  return promoteStandaloneDisplayMath(protectMathSpans(normalizeLatexMathDelimiters(content)));
}

/**
 * remark-math only treats `$$` as display math when the delimiters are on
 * their own lines. A same-line `$$ ... $$` is inline, and `$$ formula` with
 * the rest of the formula on following lines drops the first line (it is read
 * as fence meta). Both are rewritten into a real display block. A line that
 * is only `$$` is left alone so an already-fenced formula is not touched.
 * Fenced code is skipped.
 */
function promoteStandaloneDisplayMath(text: string): string {
  const lines = text.split("\n");
  let inFence = false;
  let inMath = false;
  let changed = false;
  const out: string[] = [];

  for (const line of lines) {
    const carriage = line.endsWith("\r");
    const body = carriage ? line.slice(0, -1) : line;
    const cr = carriage ? "\r" : "";
    if (/^ {0,3}(?:```|~~~)/.test(body)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    if (/^[ \t]{0,3}\$\$[ \t]*$/.test(body)) {
      inMath = !inMath;
      out.push(line);
      continue;
    }

    if (inMath) {
      const trailing = /^(.*?)\$\$[ \t]*$/.exec(body);
      const math = trailing?.[1];
      if (trailing && math !== undefined && math.trim() !== "") {
        changed = true;
        inMath = false;
        out.push(`${math.trimEnd()}${cr}`);
        out.push(`$$${cr}`);
        continue;
      }
      out.push(line);
      continue;
    }

    const single = /^([ \t]{0,3})\$\$((?:(?!\$\$).)+)\$\$[ \t]*$/.exec(body);
    const singleMath = single?.[2];
    if (single && singleMath !== undefined && singleMath.trim() !== "") {
      changed = true;
      const indent = single[1] ?? "";
      out.push(`${indent}$$${cr}`);
      out.push(`${singleMath.trim()}${cr}`);
      out.push(`${indent}$$${cr}`);
      continue;
    }

    const opener = /^([ \t]{0,3})\$\$(.+)$/.exec(body);
    const openerMath = opener?.[2];
    if (opener && openerMath !== undefined && openerMath.trim() !== "") {
      changed = true;
      inMath = true;
      out.push(`${opener[1] ?? ""}$$${cr}`);
      out.push(`${openerMath.trim()}${cr}`);
      continue;
    }

    out.push(line);
  }

  return changed ? out.join("\n") : text;
}
