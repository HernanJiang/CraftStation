## v1.7.16

### Improved

- **Chat**: Mermaid diagrams and code blocks get a Codex-style look — rounded themed nodes, pill edge labels, and a card header with an expand button that opens a large viewer.

### Fixed

- **Chat**: Mermaid diagrams no longer blow up to fill the pane, tower over the message, or get stuck as raw source after a mid-stream parse hiccup — and multi-line node labels no longer clip.
- **Agents**: a thread that hit a network error no longer keeps failing on the same wedged session — retries now rebuild the session (Gemini/Antigravity `write tcp`/`request failed` shapes included), and a recovered turn clears the pinned error badge.
- **Composer**: pasting copied chat output or other rich text converts it to markdown-ish text — headings, lists, tables, code blocks and formulas survive instead of flattening into one character per line.
- **Chat**: formulas no longer dump raw LaTeX when a model leaves a stray `\right.` in the expression, and standalone formula lines center like display math.
- **Chat**: the context-quota popover stays anchored to its trigger under whole-app zoom.
- **Agents**: threads set to full access keep auto-approving — Devin's `bypass`, Factory's `auto-high` and other harness vocabularies are now recognized instead of silently reverting to approval prompts mid-run.
- **Chat**: the draft-home greeting follows the theme in light mode instead of rendering invisible white-on-white.
- **SSH**: building the remote runtime bundle no longer flashes a console window.
