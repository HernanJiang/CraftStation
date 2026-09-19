// Mirror of src/shared/channel.ts for use by scripts/build-desktop-artifact.mjs.
// Keep field names identical to the TS module; src/shared/channel.config-parity.test.ts
// asserts they don't drift.

const CHANNELS = ["stable", "nightly"];

// Subdirectories under `dist/` that ship in the installer. A broad `dist/**/*`
// glob would sweep up stale `dist/win-unpacked` trees from prior packaging
// runs and recursively bloat the next installer.
const PACKAGED_DIST_DIRS = ["main", "renderer"];

const PACKAGED_DIST_FILES = PACKAGED_DIST_DIRS.flatMap((dir) => [
  `dist/${dir}/**/*`,
  `!dist/${dir}/**/*.map`,
]);

// 只排除 SQLite 重编译产生的中间文件；运行库、.node 与调试符号保持可打包。
// 这些文件不是运行时重建能力：安装包仍由 afterPack 校验并注入目标架构的 .node。
const PACKAGED_NATIVE_EXCLUDES = [
  "!node_modules/better-sqlite3/build/Release/obj/**/*",
  "!node_modules/better-sqlite3/build/deps/**/*",
  "!node_modules/better-sqlite3/build/**/*.{iobj,ipdb,obj,lib,exp,ilk,tlog,vcxproj,filters,sln,props,targets,gypi,mk,make}",
];

function normalizeChannel(value) {
  return value === "nightly" ? "nightly" : "stable";
}

function productNameFor(channel) {
  return channel === "nightly" ? "CraftStation Nightly" : "CraftStation";
}

function appIdFor(channel) {
  return channel === "nightly" ? "com.craftstation.app.nightly" : "com.craftstation.app";
}

function userDataDirNameFor(channel) {
  return channel === "nightly" ? ".craftstation-nightly" : ".craftstation";
}

function updaterChannelFor(channel) {
  return channel === "nightly" ? "nightly" : undefined;
}

function artifactPrefixFor(channel) {
  return channel === "nightly" ? "CraftStation-Nightly" : "CraftStation";
}

/**
 * Squirrel.Mac cannot relaunch when an update changes the outer bundle and
 * executable name: it moves the old bundle away, then tries to spawn its
 * relaunch helper from the path it just removed. Keep updater ZIPs on the
 * pre-rebrand executable name so both CraftStation and already-migrated CraftStation
 * installs update in place. DMGs remain fully CraftStation-branded.
 */
function macExecutableNameFor(channel, artifactKind) {
  if (artifactKind === "updater") {
    return channel === "nightly" ? "CraftStation Nightly" : "CraftStation";
  }
  return productNameFor(channel);
}

module.exports = {
  CHANNELS,
  PACKAGED_DIST_DIRS,
  PACKAGED_DIST_FILES,
  PACKAGED_NATIVE_EXCLUDES,
  normalizeChannel,
  productNameFor,
  appIdFor,
  userDataDirNameFor,
  updaterChannelFor,
  artifactPrefixFor,
  macExecutableNameFor,
};
