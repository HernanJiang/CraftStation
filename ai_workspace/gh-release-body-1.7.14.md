## v1.7.14

### Fixed

- **Antigravity**: a regenerated second answer no longer gets appended after the real reply — the terminal `result` response now replaces the assistant stream (`content.set`), so retracted text is dropped instead of lingering after the authoritative answer.
- **Chat**: `<br>` tags inside markdown table cells render as real line breaks instead of literal text.
- **Chat**: display-math blocks whose closing `$$` is glued to the last content line (`…\end{bmatrix}$$`) render through KaTeX instead of leaking raw `$$` source.
