#!/usr/bin/env node
/**
 * Brand-rename rule generator for ast-grep.
 *
 * The target brand name is not final yet, so rule files are templates with a
 * __TARGET__ placeholder rather than concrete rewrites. This script stamps a
 * concrete name into a generated rules dir that `ast-grep scan` reads, so the
 * rename stays one command away without keeping half-renamed rules in-tree.
 *
 * Usage:
 *   node scripts/rename/generate-rules.mjs <NewName>   # e.g. Acme, Zephyr...
 *   ast-grep scan        # report only — never modifies files
 *   ast-grep scan -U     # apply all rewrites (git-clean tree first!)
 *
 * __TARGET___ is stamped as <NAME>_ (with the trailing underscore), so
 * `PAPERCLIP_HOME` -> `ACME_HOME`. The generated dir is gitignored.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.join(here, "rules");
const outDir = path.resolve(here, "../../.ast-grep-rules");

const name = process.argv[2];
if (!name || !/^[A-Z][A-Z0-9]*$/.test(name)) {
  console.error('Usage: node scripts/rename/generate-rules.mjs <NewName>  (UPPERCASE, letters+digits only)');
  console.error('Example: node scripts/rename/generate-rules.mjs ACME');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let count = 0;
for (const file of readdirSync(templatesDir).filter((f) => f.endsWith(".yml"))) {
  const rendered = readFileSync(path.join(templatesDir, file), "utf8").replaceAll("__TARGET___", `${name}_`);
  writeFileSync(path.join(outDir, file), rendered);
  count += 1;
}
console.log(`Generated ${count} rule file(s) into ${path.relative(process.cwd(), outDir)} with target "${name}_".`);
console.log("Next: ast-grep scan           (report only)");
console.log("      ast-grep scan --json    (machine-readable inventory)");
console.log("      ast-grep scan -U        (APPLY — commit or stash everything else first)");
