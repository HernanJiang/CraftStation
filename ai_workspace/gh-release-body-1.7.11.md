## CraftStation v1.7.11

Update success is verified, shadowed CLIs heal. CLI updates now prove the resolved binary actually changed before reporting success.

- An update that exits 0 without changing the resolved binary no longer reports success — the post-update version probe reports an honest failure, so entries stay listed instead of pretending they landed.
- CLIs shadowed by a stale foreign executable in the npm global folder now self-heal: Windows resolves the orphan `.exe` ahead of the managed `.cmd` shim, so package updates never took effect — the orphan is removed so the managed binary answers.

**Download (Windows x64)**

- [CraftStation-Setup-1.7.11-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.7.11/CraftStation-Setup-1.7.11-x64.exe) — installer
- [CraftStation-Portable-1.7.11-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.7.11/CraftStation-Portable-1.7.11-x64.exe) — portable
