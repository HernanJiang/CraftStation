import { rmSync } from "node:fs";
import { resolve } from "node:path";

const roots = [
  resolve(import.meta.dirname, "..", "dist", "main"),
  resolve(import.meta.dirname, "..", "dist", "renderer"),
];

async function* walk(dir) {
  let entries;
  try {
    entries = await import("node:fs/promises").then(({ readdir }) =>
      readdir(dir, { withFileTypes: true }),
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile() && path.endsWith(".map")) {
      yield path;
    }
  }
}

for (const root of roots) {
  for await (const file of walk(root)) {
    rmSync(file);
  }
}
