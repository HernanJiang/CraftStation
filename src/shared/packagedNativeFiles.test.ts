import { createRequire } from "node:module";
import micromatch from "micromatch";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { PACKAGED_NATIVE_EXCLUDES } = require("../../scripts/electron-builder.shared.cjs") as {
  PACKAGED_NATIVE_EXCLUDES: string[];
};

it("excludes build intermediates while preserving native loading, symbols and other runtimes", () => {
  const required = [
    "node_modules/better-sqlite3/lib/database.js",
    "node_modules/better-sqlite3/package.json",
    "node_modules/better-sqlite3/LICENSE",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.pdb",
    "node_modules/node-pty/prebuilds/win32-x64/conpty.node",
    "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
  ];
  const intermediates = [
    "node_modules/better-sqlite3/build/Release/better_sqlite3.iobj",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.ipdb",
    "node_modules/better-sqlite3/build/Release/sqlite3.lib",
    "node_modules/better-sqlite3/build/Release/obj/global_intermediate/sqlite3/sqlite3.c",
    "node_modules/better-sqlite3/build/deps/sqlite3.vcxproj",
  ];
  expect(
    micromatch([...required, ...intermediates], ["node_modules/**/*", ...PACKAGED_NATIVE_EXCLUDES]),
  ).toEqual(required);
});
