## CraftStation v1.7.3

**Thread rename finally works, Gemini answers stop repeating, and Grok pool profiles stop wasting disk.**

### What's fixed

- **Gemini/Antigravity replies no longer render twice** — the CLI's closing `result` snapshot can fold already-streamed status lines into the middle of the final response (superseded draft → queued status notices → regenerated answer). The dedup only trimmed echoes at the start or end, so the whole blob — answer included — was appended a second time. Snapshots now cut at the last replayed stretch wherever it sits, keeping only the fresh tail. Verified against the real conversation payload.
- **Rename a thread for real this time** — when a thread shows up in more than one sidebar section (its project list, the Workspace inbox shortcut, or Pinned), every duplicate row used to open a rename input at once; the inputs raced for focus, the first blur committed nothing, and the whole edit cancelled within a frame — rename looked dead. Editing is now scoped to the row you actually clicked. Combined with v1.7.2's title provenance, a manual rename also survives any late-arriving auto-generated title.
- **Grok managed binaries stop duplicating** — each account-pool profile kept a full second copy of the CLI binary (~150 MB per profile) just for version sniffing. The versioned copy now hardlinks the canonical binary (free on NTFS, copy fallback elsewhere), and every update prunes superseded versions and parked `grok.exe.old-*` files. **~1.3 GB reclaimed** on a typical 8-profile setup.

### Downloads

| File                                  | Purpose                                |
| ------------------------------------- | -------------------------------------- |
| `CraftStation-Setup-1.7.3-x64.exe`    | NSIS installer                         |
| `CraftStation-Portable-1.7.3-x64.exe` | Portable build                         |
| `latest.yml` + `.blockmap`            | Auto-update feed & differential blocks |

Full changelog entry lives in `website/public/changelog.json` (in-app What's New).
