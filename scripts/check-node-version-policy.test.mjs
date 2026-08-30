import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checkerPath = new URL("./check-node-version-policy.mjs", import.meta.url);

test("node version policy skips machine-local directories", () => {
  const source = readFileSync(checkerPath, "utf8");
  const match = source.match(/const skippedDirectories = new Set\((\[[^\]]*\])\);/);

  assert.ok(match, "expected the canonical checker to declare skippedDirectories");

  const skippedDirectories = new Set(JSON.parse(match[1]));
  const requiredDirectories = [
    ".git",
    ".pilot",
    ".opencode",
    ".codegraph",
    ".worktrees",
    ".superpowers",
    "coverage",
    "data",
    "dist",
    "node_modules",
  ];
  const missingDirectories = requiredDirectories.filter((directory) => !skippedDirectories.has(directory));

  assert.deepEqual(missingDirectories, []);
});
