## CraftStation 1.7.4

One-fix patch for Gemini/Antigravity replies that visually ended mid-sentence.

### Fixed

- **Antigravity/Gemini — answer could look cut off mid-token**: the CLI can rewrite its answer mid-turn, sending a snapshot of the revised variant (same opening, edited middle) that sometimes arrives truncated mid-token (observed cut: `### 三、… \n\n1. *`). The remainder/dedup logic treated it as new content and appended it after the already-complete streamed answer — so the reply displayed `[complete answer][second opening dying at "1. *"]` and looked truncated. The embedded-echo cut now detects a same-document re-render — when the slice about to be appended replays the stream's unechoed edge text, or its own tail is a stretch the stream already showed — and appends nothing, keeping the complete answer intact.
- Coincidental short head/tail overlaps (a shared `*` or digit) no longer slice characters off a delta: both overlap scans now require a minimum-length match.

Verified against the real conversation payload (`421235c2`): the persisted message now stops at the true ending `…随时欢迎交流！` instead of the mid-token `1. *`.

### Downloads

- Windows installer (x64): `CraftStation-Setup-1.7.4-x64.exe`
- Windows portable (x64): `CraftStation-Portable-1.7.4-x64.exe`

Auto-update: `latest.yml` ships in this release; 1.7.3 installs will pick 1.7.4 up on next check.
