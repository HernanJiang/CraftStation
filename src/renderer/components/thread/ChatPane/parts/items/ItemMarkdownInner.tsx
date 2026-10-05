import { Link, Modal, Tooltip, toast } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { CodeXml, ExternalLink, Maximize2 } from "lucide-react";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Streamdown,
  defaultRehypePlugins,
  defaultUrlTransform,
  type Components as StreamdownComponents,
  type UrlTransform,
} from "streamdown";
import remarkGfm from "remark-gfm";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";
import "katex/dist/katex.min.css";
import { openExternalWithFeedback } from "@/renderer/utils/openExternal";
import {
  resolveMarkdownImageUrl,
  rewriteMarkdownLocalImageUrls,
} from "@/shared/markdownLocalImages";
import { resolveLocalImageDisplayUrl } from "@/shared/localImageDisplay";
import { friendlyError } from "@/shared/messages";
import { getBasename } from "@/shared/pathUtils";
import { getProjectFsPath } from "@/shared/wsl";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { normalizeChatProjectPath } from "../../chatPathUtils";
import { CodeBlock } from "./CodeBlock";
import { CopyTextButton } from "./CopyTextButton";
import { ImageCard } from "./ImageCard";
import { InlineFilePathChip } from "./InlineFilePathChip";
import { InlineFolderPathChip } from "./InlineFolderPathChip";
import { LC_SELECTOR_LANG, tryParseSelectorPayload } from "./SelectorBadge";
import {
  escapeBareAngleTags,
  normalizeDisplayMathClosers,
  normalizeGfmTableSeparators,
  normalizeLatexMathDelimiters,
  normalizeMathDollarRuns,
  normalizeMermaidFenceLanguages,
  normalizeShortCodeFenceClosers,
  protectMathSpans,
  repairMathSyntax,
} from "./ItemMarkdown";
import { imageViewSourceFromMarkdownImage } from "./imageViewSource";
import { normalizeHighlightLanguage } from "./languageDetect";
import { parseProjectPathRef, type ProjectPathRef } from "./parseProjectPathRef";
import {
  AUTO_PATH_FILE_PREFIX,
  AUTO_PATH_FILE_HREF_PREFIX,
  AUTO_PATH_FOLDER_PREFIX,
  AUTO_PATH_FOLDER_HREF_PREFIX,
  remarkAutolinkProjectPaths,
} from "./remarkAutolinkProjectPaths";

type RemarkPlugins = NonNullable<ComponentProps<typeof Streamdown>["remarkPlugins"]>;
type RehypePlugins = NonNullable<ComponentProps<typeof Streamdown>["rehypePlugins"]>;

const markdownMathPlugin = createMathPlugin({ singleDollarTextMath: true });

/**
 * Mermaid paints into an inline `<svg>` inside our DOM, so a `themeCSS`
 * override can reference the app's CSS variables directly — the diagram
 * follows light/dark and custom theme presets live, with no re-render.
 */
const MERMAID_THEME_CSS = [
  // Text: htmlLabels render real <div>/<span>/<p> inside foreignObject
  // (color); the non-html path uses <text>/<tspan> (fill). `fill` must stay
  // off container classes — it inherits into label background rects.
  "text, tspan, .nodeLabel, .edgeLabel .label, .edgeLabel span, .edgeLabel p, .clusterLabel, .cluster-label, .messageText, .noteText, .labelText, .loopText, .titleText { fill: var(--foreground) !important; }",
  ".label, .label div, .label span, .label p, .nodeLabel, .edgeLabel, .edgeLabel div, .edgeLabel span, .edgeLabel p, .clusterLabel, .cluster-label, .cluster-label div, .messageText, .noteText, .labelText, .loopText, .legend, .titleText { color: var(--foreground) !important; }",
  // Codex-style chrome: generously rounded elevated nodes, pill edge
  // labels, accent-filled sequence actors, muted thin connectors.
  ".node rect, .node circle, .node ellipse, .node polygon, .node > path, .basic label-container, .note, .messageBox, .labelBox { fill: var(--surface-secondary) !important; stroke: var(--border) !important; color: var(--foreground) !important; }",
  ".node rect, .node .basic.label-container, .note, .cluster rect { rx: 12px; ry: 12px; }",
  ".edgeLabel rect, .labelBox { rx: 8px; ry: 8px; }",
  ".edgeLabel { background: var(--surface-secondary) !important; }",
  // Keep app typography (prose p margins, leading-snug) out of label
  // internals: mermaid sizes node rects from the label boxes it measures at
  // layout time, so inflated margins/line-height clip the rendered text.
  ".nodeLabel div, .nodeLabel p, .edgeLabel p, .clusterLabel div, .clusterLabel p, foreignObject p { margin: 0 !important; line-height: 1.35 !important; white-space: normal !important; }",
  // htmlLabel edge labels put a translucent theme-tinted div.labelBkg behind
  // the pill span — clear it, and give the span the pill chrome instead.
  ".labelBkg { background: transparent !important; }",
  "span.edgeLabel { background: var(--surface-secondary) !important; border: 1px solid var(--border) !important; border-radius: 6px !important; padding: 1px 8px !important; }",
  "span.edgeLabel *, .labelBkg * { background: transparent !important; }",
  "span.edgeLabel:empty { display: none !important; }",
  ".actor rect, rect.actor, rect.actor-top, rect.actor-bottom { fill: var(--accent) !important; stroke: none !important; rx: 8px; ry: 8px; }",
  ".actor text, .actor tspan, text.actor { fill: var(--accent-foreground) !important; }",
  ".actor, .actor div, .actor span { color: var(--accent-foreground) !important; }",
  ".cluster rect { fill: color-mix(in oklab, var(--foreground) 5%, transparent) !important; stroke: var(--border) !important; }",
  ".edgePath path, .edgePaths path, .flowchart-link, .transition, .messageLine0, .messageLine1, .actor-line, .loopLine { stroke: var(--muted) !important; }",
  "marker path, marker circle, .arrowheadPath { fill: var(--muted) !important; stroke: var(--muted) !important; }",
  ".activation0, .activation1, .activation2 { fill: var(--surface-tertiary) !important; }",
].join("\n");

const markdownMermaidPlugin = createMermaidPlugin({
  config: {
    startOnLoad: false,
    // "antiscript" keeps htmlLabels on so <br> in node labels renders as a
    // real line break — "strict" disables htmlLabels and shows <br> literally.
    // Script tags are still stripped, unlike "loose".
    securityLevel: "antiscript",
    suppressErrorRendering: true,
    theme: "base",
    fontFamily:
      '"Geist", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Segoe UI Variable", "Segoe UI", "Inter", system-ui, sans-serif',
    fontSize: 12,
    // Tighter than the 50px defaults so diagrams stay card-sized; padding
    // keeps multi-line labels from kissing the node edge.
    flowchart: { nodeSpacing: 30, rankSpacing: 34, padding: 8 },
    themeVariables: {
      background: "transparent",
    },
    themeCSS: MERMAID_THEME_CSS,
  },
});

// Eagerly initialize mermaid so the first diagram doesn't pay init cost.
markdownMermaidPlugin.getMermaid({});

// Streamdown bundles `rehype-harden`, which rewrites links whose href fails its
// allowlist into `<span>…[blocked]</span>`. During streaming, partial hrefs
// (e.g. `https://sent`) routinely trip it, producing a "[blocked]" flash on
// otherwise valid URLs. We control external opens through `MdAnchor` and gate
// file/folder hrefs there too, so harden is redundant here.
function buildRehypePlugins(remoteLocalImageUrl?: (url: string) => string): RehypePlugins {
  return Object.entries(defaultRehypePlugins)
    .filter(([key]) => key !== "harden")
    .flatMap(([key, plugin]) =>
      key === "sanitize"
        ? [[rehypeLocalImageUrls, { remoteLocalImageUrl }], allowLocalImageProtocol(plugin)]
        : [plugin],
    ) as RehypePlugins;
}

interface ItemMarkdownInnerProps {
  text: string;
}

/**
 * Heavy markdown renderer (lazy-loaded). Uses Streamdown which handles
 * incomplete syntax during streaming (unclosed fences, half-formed links,
 * dangling bold/italic) and memoizes blocks internally so re-renders during
 * streaming only re-parse the trailing block.
 */
export default function ItemMarkdownInner({ text }: ItemMarkdownInnerProps) {
  const actions = useChatPaneActions();
  const rootNames = actions?.projectRootNames;
  const rehypePlugins = useMemo(
    () => buildRehypePlugins(actions?.remoteLocalImageUrl),
    [actions?.remoteLocalImageUrl],
  );
  // Escape the React Compiler: the plugin tuple captures `rootNames`, which
  // the compiler conservatively re-creates each render. Streaming chats
  // re-render on every chunk, so anchor the array to `rootNames` identity.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional escape hatch
  const remarkPlugins = useMemo<RemarkPlugins>(
    () => [
      remarkGfm,
      [
        remarkAutolinkProjectPaths,
        {
          cacheKey: JSON.stringify({
            projectLocation: actions?.projectLocation ?? null,
            rootNames: rootNames ? [...rootNames].sort() : null,
          }),
          parsePathRef: (token: string) => {
            const ref = parseProjectPathRef(token, { rootNames });
            if (ref || !actions) return ref;
            const normalized = normalizeChatProjectPath(token, actions.projectLocation);
            return normalized === token ? null : parseProjectPathRef(normalized, { rootNames });
          },
          parseLinkRef: (href: string) => (actions ? parseHrefProjectPathRef(href, actions) : null),
        },
      ],
    ],
    [actions, rootNames],
  );
  const projectRoot = actions?.projectLocation
    ? getProjectFsPath(actions.projectLocation)
    : undefined;
  const extraRoots = actions?.markdownImageRoots;
  const markdownText = rewriteMarkdownLocalImageUrls(
    normalizeIncompleteProjectLinkTail(
      normalizeMermaidFenceLanguages(
        normalizeGfmTableSeparators(
          protectMathSpans(
            repairMathSyntax(
              normalizeLatexMathDelimiters(
                normalizeMathDollarRuns(
                  normalizeDisplayMathClosers(
                    normalizeShortCodeFenceClosers(escapeBareAngleTags(text)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    {
      ...(projectRoot ? { projectRoot } : {}),
      ...(extraRoots?.length ? { extraRoots } : {}),
    },
  );
  return (
    <div className="lc-chat-markdown prose max-w-none text-[length:var(--lc-chat-font-size)] leading-snug text-foreground prose-headings:text-[length:var(--lc-chat-font-size)] prose-p:text-[length:var(--lc-chat-font-size)] prose-p:whitespace-pre-wrap prose-li:text-[length:var(--lc-chat-font-size)] prose-pre:my-2 prose-pre:rounded prose-pre:border-0 prose-pre:bg-foreground/10 prose-pre:px-[0.5em] prose-pre:py-[0.25em] prose-pre:font-mono prose-pre:text-[0.875em] prose-pre:leading-snug prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:overflow-x-hidden prose-code:before:content-none prose-code:after:content-none prose-a:text-foreground prose-a:no-underline prose-a:text-[length:inherit] hover:prose-a:underline hover:prose-a:decoration-1 prose-a:underline-offset-2">
      <Streamdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={MD_COMPONENTS}
        urlTransform={transformMarkdownUrl}
        plugins={{ math: markdownMathPlugin, mermaid: markdownMermaidPlugin }}
        controls={{ mermaid: { copy: true, download: false, fullscreen: false, panZoom: false } }}
        parseIncompleteMarkdown
      >
        {markdownText}
      </Streamdown>
    </div>
  );
}

const MD_COMPONENTS: StreamdownComponents = {
  pre({ children }) {
    const codeChild = findCodeChild(children);
    const codeProps = codeChild?.props as { className?: string; children?: ReactNode } | undefined;
    const rawLang = extractRawLangFromClassName(codeProps?.className);
    if (rawLang === LC_SELECTOR_LANG) {
      const text = flattenMdChildren(codeProps?.children).replace(/\r?\n$/, "");
      if (tryParseSelectorPayload(text)) return null;
    }
    if (codeChild) {
      const language = normalizeHighlightLanguage(codeProps?.className);
      if (rawLang === "mermaid") {
        const text = flattenMdChildren(codeProps?.children).replace(/\r?\n$/, "");
        return (
          <MdCodeBlockFrame text={text} lang="mermaid">
            <MdMermaidDiagram code={text} />
          </MdCodeBlockFrame>
        );
      }
      if (language) {
        const text = flattenMdChildren(codeProps?.children).replace(/\r?\n$/, "");
        return (
          <MdCodeBlockFrame
            text={text}
            lang={extractRawLangFromClassName(codeProps?.className) ?? language}
          >
            <CodeBlock text={text} lang={language} className={markdownCodeBlockInnerClass} />
          </MdCodeBlockFrame>
        );
      }
    }
    return (
      <MdCodeBlockFrame
        text={flattenMdChildren(children).replace(/\r?\n$/, "")}
        lang={extractRawLangFromClassName(codeProps?.className) ?? "text"}
      >
        <pre className={markdownCodeBlockInnerClass}>{markCodeChildAsBlock(children)}</pre>
      </MdCodeBlockFrame>
    );
  },
  p({ children }) {
    if (isStructuredArchitectureProse(flattenMdChildren(children))) {
      return <div className={markdownCodeBlockClass}>{children}</div>;
    }
    // A paragraph consisting solely of math (one or several inline formulas
    // separated by line breaks) is display math typographically — center it
    // like `katex-display` blocks instead of leaving it left-aligned.
    if (isMathOnlyParagraph(children)) {
      return <p className="text-center">{children}</p>;
    }
    return <p>{children}</p>;
  },
  code({ className, children, ...rest }) {
    const isBlock =
      ("data-block" in rest && rest["data-block"] === "true") ||
      (typeof className === "string" && className.includes("language-"));
    return (
      <MdCode className={className ?? ""} isBlock={isBlock}>
        {children}
      </MdCode>
    );
  },
  a({ href, children }) {
    return <MdAnchor href={href ?? ""}>{children}</MdAnchor>;
  },
  img({ alt, className, src, width, height }) {
    if (typeof src !== "string" || src.length === 0) return null;
    return (
      <ImageCard
        source={imageViewSourceFromMarkdownImage({
          src,
          alt: alt ?? "",
          width,
          height,
        })}
        className="not-prose my-2"
        isBlock
        {...(className ? { imageClassName: className } : {})}
      />
    );
  },
  // Render a clean native table with HeroUI-themed styling. Override
  // Streamdown's default wrapper (which includes copy/download/fullscreen
  // controls) and replace its memoized sub-components with native HTML
  // elements so `<thead>`, `<tr>`, etc. compose correctly.
  table({ children }) {
    return (
      <div className="not-prose my-4 min-w-0 max-w-full overflow-x-auto border border-border bg-[var(--surface-secondary)]/50">
        <table className="w-full border-collapse text-[length:var(--lc-chat-font-size)] leading-snug">
          {children}
        </table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="[&_th]:border-b [&_th]:border-foreground/10">{children}</thead>;
  },
  tbody({ children }) {
    return (
      <tbody className="[&_tr:not(:last-child)_td]:border-b [&_tr:not(:last-child)_td]:border-foreground/5">
        {children}
      </tbody>
    );
  },
  tr({ children }) {
    return <tr>{children}</tr>;
  },
  th({ children }) {
    return <th className="px-4 py-1 text-left font-medium text-muted">{children}</th>;
  },
  td({ children }) {
    return <td className="px-4 py-1 align-middle text-foreground">{children}</td>;
  },
};

const inlineCodeChipClass =
  "rounded border-0 bg-foreground/10 px-[0.35em] py-[0.1em] font-mono text-[0.875em] leading-none align-baseline text-foreground [overflow-wrap:anywhere]";
const markdownCodeBlockClass =
  "lc-md-code-block not-prose my-2 min-w-0 overflow-x-hidden rounded px-[0.75em] py-[0.5em] font-mono text-[0.875em] leading-snug text-foreground";
// Same body styling minus margin/radius — used inside MdCodeBlockFrame, whose
// header+container owns the card chrome.
const markdownCodeBlockInnerClass =
  "lc-md-code-block not-prose min-w-0 overflow-x-hidden px-[0.75em] py-[0.5em] font-mono text-[0.875em] leading-snug text-foreground";
const transformMarkdownUrl: UrlTransform = (url, key, node) =>
  key === "src" && node.tagName === "img" && url.startsWith("craftstation-local://")
    ? url
    : defaultUrlTransform(url, key, node);

interface MarkdownHastNode {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownHastNode[];
}

function rehypeLocalImageUrls(options?: { remoteLocalImageUrl?: (url: string) => string }) {
  return (tree: MarkdownHastNode) => {
    rewriteLocalImageUrls(tree, options?.remoteLocalImageUrl);
  };
}

function rewriteLocalImageUrls(
  node: MarkdownHastNode,
  remoteLocalImageUrl?: (url: string) => string,
): void {
  const src = node.properties?.src;
  // Fallback for absolute paths that skip the pre-parse rewrite (e.g. HTML
  // <img>). Relative project paths need projectRoot and are handled only there.
  if (node.tagName === "img" && typeof src === "string") {
    const rewritten = resolveMarkdownImageUrl(src);
    if (rewritten) node.properties!.src = rewritten;
    // Remote PWA: swap craftstation-local sources for the desktop's authenticated
    // HTTP image endpoint. A no-op inside the desktop Electron app, which
    // never installs a resolver (see shared/localImageDisplay.ts).
    const localUrl = node.properties!.src as string;
    node.properties!.src =
      localUrl.startsWith("craftstation-local://") && remoteLocalImageUrl
        ? remoteLocalImageUrl(localUrl) || localUrl
        : resolveLocalImageDisplayUrl(localUrl);
  }
  node.children?.forEach((child) => rewriteLocalImageUrls(child, remoteLocalImageUrl));
}

function allowLocalImageProtocol(plugin: RehypePlugins[number]): RehypePlugins[number] {
  if (!Array.isArray(plugin)) return plugin;
  const [transformer, rawSchema] = plugin;
  const schema = rawSchema as {
    protocols?: Record<string, readonly string[] | null | undefined>;
  };
  const protocols = schema.protocols ?? {};
  return [
    transformer,
    {
      ...schema,
      protocols: {
        ...protocols,
        src: [...(protocols.src ?? []), "craftstation-local"],
      },
    },
  ] as RehypePlugins[number];
}

/**
 * Wraps a fenced code block with a header row — language label on the left,
 * always-visible copy button on the right — above the body. The floating
 * hover-reveal button used to sit on top of the first content line and was
 * easy to miss. Kept outside `CodeBlock` so command-output viewports (which
 * reuse `CodeBlock`) are not affected.
 */
function MdCodeBlockFrame({
  text,
  lang,
  children,
}: {
  text: string;
  lang?: string | undefined;
  children?: ReactNode;
}) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  if (text.length === 0) return <>{children}</>;

  const headerLabel = (
    <span className="flex select-none items-center gap-1.5 text-muted">
      <CodeXml className="size-3.5" />
      <span className="font-mono text-[11px] leading-none">{lang ?? "text"}</span>
    </span>
  );
  return (
    <>
      {/* Codex-style floating card: rounded, elevated surface, icon header. */}
      <div className="not-prose my-2 min-w-0 overflow-hidden rounded-xl bg-[var(--surface-secondary)] ring-1 ring-foreground/5">
        <div className="lc-md-code-header flex items-center justify-between gap-2 px-3 py-1.5">
          {headerLabel}
          <div className="flex items-center gap-0.5">
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  aria-label={t`Expand`}
                  className="flex size-5 items-center justify-center rounded text-muted/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpanded(true);
                  }}
                >
                  <Maximize2 className="size-3" />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content placement="top">{t`Expand`}</Tooltip.Content>
            </Tooltip>
            <CopyTextButton text={text} label={t`Copy code`} />
          </div>
        </div>
        {children}
      </div>
      <Modal.Backdrop
        isOpen={expanded}
        onOpenChange={(open) => {
          if (!open) setExpanded(false);
        }}
      >
        <Modal.Container placement="center" size="lg" scroll="inside">
          <Modal.Dialog className="overflow-hidden">
            <Modal.Body className="p-0">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                {headerLabel}
                <CopyTextButton text={text} label={t`Copy code`} />
              </div>
              <div className="max-h-[75vh] overflow-auto">{children}</div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}

let mermaidRenderSeq = 0;

/**
 * Mermaid emits `<svg width="100%" height="N" style="max-width:Wpx">` when
 * useMaxWidth is on. If the inline style is ever lost the svg upscales to fill
 * the pane, so pin the viewBox's natural width on the `width` attribute and
 * drop the fixed `height` — CSS (`max-w-full h-auto`) then handles shrink only.
 */
function normalizeMermaidSvgSize(svg: string): string {
  const viewBox = /viewBox="[\d. -]+?\s([\d.]+)\s[\d.]+"/.exec(svg);
  if (!viewBox) return svg;
  const naturalWidth = Number.parseFloat(viewBox[1] ?? "");
  if (!Number.isFinite(naturalWidth) || naturalWidth <= 0) return svg;
  return svg
    .replace(/<svg([^>]*?)\swidth="100%"/, `<svg$1 width="${naturalWidth}"`)
    .replace(/<svg([^>]*?)\sheight="[\d.]+"/, "<svg$1");
}

/**
 * Renders a ````mermaid` fence as an actual diagram. Streamdown dispatches
 * diagram plugins inside its default `code` component, which our overrides
 * replace — so mermaid fences would otherwise fall back to raw source. On
 * render failure the source is shown like any other code block body.
 */
function MdMermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Debounce while the fenced block is still streaming: partial code almost
    // always fails to parse, and re-rendering on every chunk is wasted work.
    const timer = setTimeout(() => {
      const id = `lc-mermaid-${mermaidRenderSeq++}`;
      // Fonts still loading skew mermaid's label measurement (fallback metrics
      // are shorter/taller than the final font), leaving text clipped inside
      // undersized nodes — wait for fonts before laying out the diagram.
      const fontsReady = document.fonts?.ready ?? Promise.resolve();
      void fontsReady
        .catch(() => undefined)
        .then(() =>
          cancelled ? Promise.reject() : markdownMermaidPlugin.getMermaid().render(id, code),
        )
        .then((result) => {
          if (cancelled || !result) return;
          setSvg(normalizeMermaidSvgSize(result.svg));
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code]);

  if (svg) {
    return (
      <div
        className="lc-md-mermaid max-h-[min(60vh,32rem)] overflow-auto px-[0.75em] py-[0.5em] [&_svg]:mx-auto [&_svg]:max-w-full [&_svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  if (failed) {
    return (
      <pre className={markdownCodeBlockInnerClass}>
        <code>{code}</code>
      </pre>
    );
  }
  return <div aria-hidden className="px-[0.75em] py-[0.5em]" />;
}

function MdCode(props: { className: string; isBlock?: boolean; children?: ReactNode }) {
  const actions = useChatPaneActions();
  const isBlock =
    props.isBlock || (typeof props.className === "string" && props.className.includes("language-"));
  const text = flattenMdChildren(props.children).replace(/\n$/, "");
  if (isBlock) {
    return <code className={props.className || undefined}>{props.children}</code>;
  }
  if (actions) {
    const ref = parseProjectPathRef(text, { rootNames: actions.projectRootNames });
    if (ref) {
      return renderPathChip(ref, actions);
    }
  }
  return <code className={inlineCodeChipClass}>{props.children}</code>;
}

/**
 * Tag the fenced-block `<code>` child with `data-block` so the `code` override
 * can distinguish fenced blocks (no language) from inline code, which never
 * passes through a `<pre>`.
 */
function markCodeChildAsBlock(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    return cloneElement(child as ReactElement<Record<string, unknown>>, { "data-block": "true" });
  });
}

function extractRawLangFromClassName(className: string | undefined): string | null {
  if (!className) return null;
  for (const token of className.split(/\s+/)) {
    if (token.startsWith("language-")) return token.slice("language-".length).toLowerCase();
    if (token.startsWith("lang-")) return token.slice("lang-".length).toLowerCase();
  }
  return null;
}

/**
 * Architecture summaries are often emitted as a single prose paragraph rather
 * than a fenced block. Keep this deliberately narrow: require an arrow chain
 * with at least two stages and recognizable model/pipeline terminology so
 * ordinary prose (and all explicit markdown fences) retain their existing path.
 */
function isStructuredArchitectureProse(text: string): boolean {
  if (!/(?:->|→)/u.test(text)) return false;
  const stages = text.split(/\s*(?:->|→)\s*/u).filter(Boolean);
  if (stages.length < 3) return false;
  return /(?:model|modality|router|lora|clip|linear|encoder|decoder|pipeline)/iu.test(text);
}

/**
 * True when every meaningful child of a paragraph is math: KaTeX spans
 * (`.katex`, `.katex-display`, `math-inline`/`math-display` wrappers), line
 * breaks, or whitespace-only text. Such a paragraph is display math — the
 * caller centers it.
 */
function isMathOnlyParagraph(children: ReactNode): boolean {
  const nodes = Children.toArray(children);
  let sawMath = false;
  for (const node of nodes) {
    if (typeof node === "string") {
      if (!/^\s*$/.test(node)) return false;
      continue;
    }
    if (!isValidElement(node)) return false;
    if (node.type === "br" || node.type === "wbr") continue;
    const props = node.props as { className?: unknown; children?: ReactNode };
    const className = typeof props.className === "string" ? props.className : "";
    if (/katex|math-(?:inline|display)/.test(className)) {
      sawMath = true;
      continue;
    }
    // One level of wrapper (e.g. a plain <span> around .katex) still counts.
    if (isMathOnlyParagraph(props.children)) {
      sawMath = true;
      continue;
    }
    return false;
  }
  return sawMath;
}

function findCodeChild(children: ReactNode): ReactElement | null {
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue;
    const props = child.props as { className?: string; children?: ReactNode };
    if (child.type === "code" || typeof props.className === "string") {
      return child as ReactElement;
    }
    const nested = findCodeChild(props.children);
    if (nested) return nested;
  }
  return null;
}

function MdAnchor(props: { href: string; children?: ReactNode }) {
  const actions = useChatPaneActions();
  const href = props.href?.trim() ?? "";
  if (!href) return <span>{props.children}</span>;

  if (
    actions &&
    (href.startsWith(AUTO_PATH_FILE_PREFIX) || href.startsWith(AUTO_PATH_FILE_HREF_PREFIX))
  ) {
    const rest = decodeAutoPathHref(
      href.startsWith(AUTO_PATH_FILE_HREF_PREFIX)
        ? href.slice(AUTO_PATH_FILE_HREF_PREFIX.length)
        : href.slice(AUTO_PATH_FILE_PREFIX.length),
    );
    const lineMatch = rest.match(/^(.+):(\d+)(?:-(\d+))?$/);
    const path = lineMatch ? lineMatch[1]! : rest;
    const ref: ProjectPathRef = lineMatch
      ? {
          kind: "file",
          path,
          line: Number.parseInt(lineMatch[2]!, 10),
          ...(lineMatch[3] ? { endLine: Number.parseInt(lineMatch[3], 10) } : {}),
        }
      : { kind: "file", path };
    return renderPathChip(ref, actions);
  }
  if (
    actions &&
    (href.startsWith(AUTO_PATH_FOLDER_PREFIX) || href.startsWith(AUTO_PATH_FOLDER_HREF_PREFIX))
  ) {
    const path = decodeAutoPathHref(
      href.startsWith(AUTO_PATH_FOLDER_HREF_PREFIX)
        ? href.slice(AUTO_PATH_FOLDER_HREF_PREFIX.length)
        : href.slice(AUTO_PATH_FOLDER_PREFIX.length),
    );
    return renderPathChip({ kind: "folder", path }, actions);
  }

  if (/^(https?|mailto):/i.test(href)) {
    return (
      <Link
        href={href}
        rel="noreferrer noopener"
        className="text-[length:inherit] text-foreground no-underline hover:underline hover:decoration-1 underline-offset-2 [display:inline] [width:auto] [overflow-wrap:anywhere] [word-break:break-word]"
        onClick={(event) => {
          event.preventDefault();
          openExternalWithFeedback(href);
        }}
      >
        {props.children}
        <ExternalLink
          className="ml-[0.2em] inline-block size-[0.85em] align-[-0.1em]"
          aria-hidden
        />
      </Link>
    );
  }
  if (actions) {
    const ref = parseHrefProjectPathRef(href, actions);
    if (ref?.kind === "folder") {
      const folderPath = normalizeChatProjectPath(ref.path, actions.projectLocation);
      return (
        <button
          type="button"
          className="inline cursor-pointer rounded border-0 bg-foreground/10 px-[0.35em] py-[0.1em] font-mono text-[0.875em] leading-none align-baseline text-accent underline-offset-2 [overflow-wrap:anywhere] hover:bg-foreground/15 hover:underline"
          onClick={() => actions.revealProjectFolderInTree(folderPath)}
        >
          {props.children}
        </button>
      );
    }
    if (ref?.kind === "file") {
      return (
        <button
          type="button"
          className="inline cursor-pointer rounded border-0 bg-foreground/10 px-[0.35em] py-[0.1em] font-mono text-[0.875em] leading-none align-baseline text-accent underline-offset-2 [overflow-wrap:anywhere] hover:bg-foreground/15 hover:underline"
          onClick={() => {
            void actions
              .openProjectRelativePath(
                normalizeChatProjectPath(ref.path, actions.projectLocation),
                ref.line,
              )
              .catch((error: unknown) => {
                toast.danger(`无法打开 ${getBasename(ref.path)}：${friendlyError(error)}`);
              });
          }}
        >
          {props.children}
        </button>
      );
    }
  }
  // Remaining hrefs can never open: the window hardening denies every
  // window.open, and the main-side openExternal allowlist only accepts
  // http(s)/mailto (handled above). Render plain text instead of a dead link.
  return <span>{props.children}</span>;
}

function decodeAutoPathHref(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function normalizeIncompleteProjectLinkTail(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\((?:\/|file:[^\s)]*)?$/u, "$1");
}

function parseHrefProjectPathRef(
  href: string,
  actions: NonNullable<ReturnType<typeof useChatPaneActions>>,
): ProjectPathRef | null {
  const rootNames = actions.projectRootNames;
  // URI 转义只在显式链接边界解码一次。普通路径的 %20 可能就是文件名，
  // file: 的解码由 normalizeChatProjectPath 负责，不能重复解码 %2520。
  const path = /^file:\/\//i.test(href)
    ? normalizeChatProjectPath(href, actions.projectLocation)
    : decodeAutoPathHref(href);
  const direct = parseProjectPathRef(path, { rootNames, allowSpaces: true });
  if (direct) return direct;

  const normalized = normalizeChatProjectPath(path, actions.projectLocation);
  if (normalized === path) return null;
  return parseProjectPathRef(normalized, { rootNames, allowSpaces: true });
}

function renderPathChip(
  ref: ProjectPathRef,
  actions: NonNullable<ReturnType<typeof useChatPaneActions>>,
) {
  const normalized = normalizeChatProjectPath(ref.path, actions.projectLocation);
  if (ref.kind === "file") {
    return (
      <InlineFilePathChip
        path={normalized}
        line={ref.line}
        endLine={ref.endLine}
        onOpen={actions.openProjectRelativePath}
      />
    );
  }
  return (
    <InlineFolderPathChip
      path={normalized}
      onRevealInTree={actions.revealProjectFolderInTree}
      onShowInExplorer={actions.showProjectEntryInExplorer}
    />
  );
}

function flattenMdChildren(node: ReactNode): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenMdChildren).join("");
  if (isValidElement(node)) {
    const p = node.props as { children?: ReactNode };
    return flattenMdChildren(p.children);
  }
  return "";
}
