## CraftStation v1.7.10

CLI updates actually land, stale entries clear. Two fixes for the update menu.

- Devin updates no longer report success without changing anything — its built-in update command is advisory-only, so CraftStation now verifies the version actually changed and falls through to the official installer when it didn't.
- A CLI that updated outside the menu's own flow (background detection or an external install) no longer keeps listing as outdated — the update check re-runs whenever a detected installed version changes.

**Download (Windows x64)**

- [CraftStation-Setup-1.7.10-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.7.10/CraftStation-Setup-1.7.10-x64.exe) — installer
- [CraftStation-Portable-1.7.10-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.7.10/CraftStation-Portable-1.7.10-x64.exe) — portable
