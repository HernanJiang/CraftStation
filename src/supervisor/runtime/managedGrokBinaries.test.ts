import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  grokBinVersionFromDir,
  listManagedGrokBinDirs,
  syncManagedGrokBinaries,
} from "./managedGrokBinaries";

const BIN = process.platform === "win32" ? "grok.exe" : "grok";
const EXT = process.platform === "win32" ? ".exe" : "";

const tmpDirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "grok-managed-"));
  tmpDirs.push(dir);
  return dir;
}
function makeProfile(accountsRoot: string, name: string, versions: string[]): string {
  const bin = join(accountsRoot, name, "bin");
  mkdirSync(bin, { recursive: true });
  for (const version of versions) {
    writeFileSync(join(bin, `grok-${version}${EXT}`), `v${version}`);
  }
  writeFileSync(join(bin, BIN), versions.length > 0 ? `v${versions.at(-1)}` : "canonical");
  return bin;
}
function makeSourceHome(versions: string[]): string {
  const home = makeDir();
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  for (const version of versions) {
    writeFileSync(join(bin, `grok-${version}${EXT}`), `v${version}`);
  }
  writeFileSync(join(bin, BIN), `v${versions.at(-1)}`);
  return home;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("listManagedGrokBinDirs", () => {
  it("returns only profile bin dirs that actually hold a grok binary", () => {
    const root = makeDir();
    makeProfile(root, "profile-a", ["1.0.5"]);
    makeProfile(root, "profile-b", ["1.0.25"]);
    // Pending-login dirs and profiles with only ripgrep must be ignored.
    mkdirSync(join(root, "grok-pending-x", "bin"), { recursive: true });
    mkdirSync(join(root, "profile-kimi", "bin"), { recursive: true });
    writeFileSync(join(root, "profile-kimi", "bin", "rg.exe"), "rg");

    expect(listManagedGrokBinDirs(root).sort()).toEqual(
      [join(root, "profile-a", "bin"), join(root, "profile-b", "bin")].sort(),
    );
  });

  it("returns [] when the accounts root does not exist", () => {
    expect(listManagedGrokBinDirs(join(makeDir(), "missing"))).toEqual([]);
  });
});

describe("grokBinVersionFromDir", () => {
  it("picks the newest versioned filename", () => {
    const dir = makeDir();
    writeFileSync(join(dir, `grok-1.0.5${EXT}`), "a");
    writeFileSync(join(dir, `grok-1.0.46${EXT}`), "b");
    writeFileSync(join(dir, `grok-1.0.9${EXT}`), "c");
    writeFileSync(join(dir, BIN), "canon");
    writeFileSync(join(dir, "rg.exe"), "other");
    expect(grokBinVersionFromDir(dir)).toBe("1.0.46");
  });
});

describe("syncManagedGrokBinaries", () => {
  it("copies the source version + canonical into every stale managed profile", () => {
    const accountsRoot = makeDir();
    const stale = makeProfile(accountsRoot, "profile-old", ["1.0.5"]);
    const fresh = makeProfile(accountsRoot, "profile-new", ["1.0.46"]);
    const sourceHome = makeSourceHome(["1.0.44", "1.0.46"]);

    const report = syncManagedGrokBinaries({ accountsRoot, sourceHome });

    expect(report.sourceVersion).toBe("1.0.46");
    expect(report.synced).toEqual(["profile-old"]);
    expect(report.current).toEqual(["profile-new"]);
    expect(report.stale).toEqual([]);
    expect(readFileSync(join(stale, `grok-1.0.46${EXT}`), "utf8")).toBe("v1.0.46");
    expect(readFileSync(join(stale, BIN), "utf8")).toBe("v1.0.46");
    expect(readFileSync(join(fresh, BIN), "utf8")).toBe("v1.0.46");
  });

  it("shares the binary via hardlink and drops superseded copies", () => {
    const accountsRoot = makeDir();
    const binDir = makeProfile(accountsRoot, "profile-old", ["1.0.5", "1.0.25"]);
    writeFileSync(join(binDir, `${BIN}.old-abc`), "parked");
    const sourceHome = makeSourceHome(["1.0.46"]);

    const report = syncManagedGrokBinaries({ accountsRoot, sourceHome });

    expect(report.synced).toEqual(["profile-old"]);
    expect(existsSync(join(binDir, `grok-1.0.5${EXT}`))).toBe(false);
    expect(existsSync(join(binDir, `grok-1.0.25${EXT}`))).toBe(false);
    expect(existsSync(join(binDir, `${BIN}.old-abc`))).toBe(false);
    // Hardlinked files share an inode; on filesystems without hardlink
    // support the copy fallback leaves nlink === 1 on both.
    const versioned = statSync(join(binDir, `grok-1.0.46${EXT}`));
    const canonical = statSync(join(binDir, BIN));
    expect(versioned.nlink === 1 || canonical.ino === versioned.ino).toBe(true);
  });

  it("no-ops when the source home has no versioned binary", () => {
    const accountsRoot = makeDir();
    makeProfile(accountsRoot, "profile-a", ["1.0.5"]);
    const sourceHome = makeDir();
    mkdirSync(join(sourceHome, "bin"), { recursive: true });

    const report = syncManagedGrokBinaries({ accountsRoot, sourceHome });

    expect(report.sourceVersion).toBeUndefined();
    expect(report.synced).toEqual([]);
  });

  it("reports a profile stale when the target files cannot be written", () => {
    const accountsRoot = makeDir();
    const binDir = makeProfile(accountsRoot, "profile-locked", ["1.0.5"]);
    const sourceHome = makeSourceHome(["1.0.46"]);
    // A directory where the versioned binary belongs makes every write into
    // this profile fail deterministically on all platforms — the same path a
    // locked `grok.exe` takes, minus the OS-specific locking.
    mkdirSync(join(binDir, `grok-1.0.46${EXT}`));

    const report = syncManagedGrokBinaries({ accountsRoot, sourceHome });

    expect(report.synced).toEqual([]);
    expect(report.stale).toHaveLength(1);
    expect(report.stale[0]?.profile).toBe("profile-locked");
    expect(report.stale[0]?.error).toBeTruthy();
  });
});
