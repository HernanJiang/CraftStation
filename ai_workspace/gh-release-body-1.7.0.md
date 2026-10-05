# CraftStation v1.7.0

## User-facing

- **OpenCode quota card works on the new console**: accounts signed in with the newer `console_session` (whose legacy Zen cookie has expired) now show the real Go subscription meters — 5-hour rolling, weekly and monthly limits with usage and reset times — plus the prepaid balance, instead of an empty "暂无额度窗口" card.
- **Calmer sidebar**: project and worktree rows no longer show the git status badge icon. Branch and PR details stay in the Git panel, reachable from the row's context menu (git-review / create-pr).

## Implementation

- When `resolveOpenCodeSession` returns `live: true` without a `workspaceId` (new-console session), the collector now queries the console API: `/console/api/orgs` supplies the org id, then `/console/api/go/status` (with `x-org-id`) exposes `access.meters` (fiveHour/week/month, limit + used microCents + resetsAt) and `/console/api/billing/status` the prepaid balance — mapped onto the existing `UsageWindow` USD shape. The legacy Zen workspace path is unchanged.
- `GitBadge` and its `isActiveGit`/`onOpenGitReview` plumbing removed from the sidebar; the Git panel entry stays on the worktree context menu.

## Verification

- Real-account probe: Rolling 5h $12 / Weekly $30 / Monthly $60 (≈63% used) render as three usage windows.
- `agents-usage` 41 + `openCodeWebSession` 10 + usage-related 124 tests pass; sidebar suite 237 tests pass; typecheck and lint clean.
