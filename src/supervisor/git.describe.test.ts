import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { GitService } from "./git";

const dirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
}

function makeRepo(tag?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "craftstation-describe-"));
  dirs.push(dir);
  git(dir, "init");
  writeFileSync(join(dir, "file.txt"), "hello");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "initial");
  if (tag) git(dir, "tag", tag);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("GitService.describe (real git)", () => {
  it("returns the nearest tag and short HEAD sha", async () => {
    const service = new GitService();
    const result = await service.describe({ kind: "windows", path: makeRepo("v1.2.3") });
    expect(result.tag).toBe("v1.2.3");
    expect(result.sha).toMatch(/^[0-9a-f]{7}$/);
  });

  it("returns nulls (never throws) when no tag or commit exists", async () => {
    const service = new GitService();
    const tagless = await service.describe({ kind: "windows", path: makeRepo() });
    expect(tagless.tag).toBeNull();
    expect(tagless.sha).toMatch(/^[0-9a-f]{7}$/);

    const empty = mkdtempSync(join(tmpdir(), "craftstation-describe-empty-"));
    dirs.push(empty);
    git(empty, "init");
    await expect(
      service.describe({ kind: "windows", path: empty }),
    ).resolves.toEqual({ tag: null, sha: null });
  });
});
