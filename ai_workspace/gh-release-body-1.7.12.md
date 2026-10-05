## CraftStation v1.7.12

Locked-CLI updates land; cleaner update feedback.

- Devin can finally update — its installer downloads ~180MB and ends by overwriting a running exe, so the 5-minute timeout killed the download and the copy failed on the file lock. Downloads now get 30 minutes, and the staged build is swapped in via rename while the process keeps running — the new version takes effect on the next launch.
- Update failure messages no longer show raw terminal escape sequences as garbage characters.
- Running an update against a CLI that is already at the latest version no longer reports a failure — the no-op is recognized as success.

**Download (Windows x64)**

- [CraftStation-Setup-1.7.12-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.7.12/CraftStation-Setup-1.7.12-x64.exe) — installer
- [CraftStation-Portable-1.7.12-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.7.12/CraftStation-Portable-1.7.12-x64.exe) — portable
