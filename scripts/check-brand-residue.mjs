#!/usr/bin/env node
// Permanent brand-residue gate: rejects legacy product identity across tracked
// content and paths (and, with --include-ignored, across generated output).
// The only accepted exceptions are exact allowlist entries that still exist.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const includeIgnored = argv.includes("--include-ignored");
const rootIndex = argv.indexOf("--root");
const repoRoot = rootIndex === -1 ? process.cwd() : path.resolve(argv[rootIndex + 1]);

const ALLOWLIST_PATH = "scripts/brand-residue-allowlist.json";
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".codegraph",
  "data",
  "coverage",
  ".worktrees",
  ".superpowers",
]);
// The gate's own sources must quote the forbidden patterns to define them.
const SELF_EXEMPT = new Set([
  "scripts/check-brand-residue.mjs",
  "scripts/check-brand-residue.test.mjs",
  "scripts/brand-residue-allowlist.json",
]);
// Minified bundles inline third-party tables (emoji shortcodes, Lezer parser
// states) whose incidental substrings are not product identity. Their paths
// are still scanned; only their content is beyond the gate's resolution.
const MINIFIED_LINE_LIMIT = 5000;

// Content families: full old name (any case), env/header families, PAP
// identifiers/prefixes, and product-owned short prefixes.
const CONTENT_RULES = [
  { id: "full-name", re: /paperclip/i },
  { id: "env-family", re: /PAPERCLIP_[A-Z0-9_]+/ },
  { id: "header-family", re: /x-paperclip-[a-z0-9-]+/i },
  { id: "pap-prefix", re: /(^|[^A-Za-z0-9])PAP-[0-9]+/ },
  { id: "pap-word", re: /(^|[^A-Za-z0-9])pap([^A-Za-z0-9]|$)/i },
  { id: "short-prefix", re: /(^|[^a-z0-9_])_?pc(gt_|gw_|_[a-z0-9][a-z0-9_]*|-|:(agent|route)\/)/ },
];

const PATH_RULE = /paperclip|(^|\/)pap(-[0-9]+)?(\/|$)|(^|\/)_?pc(gt_|gw_|_[a-z0-9][a-z0-9_]*|-|:(agent|route)\/)/i;

export function loadAllowlist(root = repoRoot) {
  const absolute = path.join(root, ALLOWLIST_PATH);
  if (!existsSync(absolute)) return [];
  return JSON.parse(readFileSync(absolute, "utf8"));
}

export function isBinaryContent(buffer) {
  for (let i = 0; i < Math.min(buffer.length, 8000); i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export function trackedFiles(root = repoRoot) {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf8");
  return out.split("\0").filter(Boolean);
}

export function walkFiles(root = repoRoot) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        queue.push(absolute);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }
  return files;
}

export function findContentFindings(relativePath, content) {
  const findings = [];
  const lines = content.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const rule of CONTENT_RULES) {
      const match = rule.re.exec(line);
      if (match) {
        findings.push({
          path: relativePath,
          line: lineIndex + 1,
          rule: rule.id,
          value: match[0],
          context: line.trim().slice(0, 200),
        });
        break;
      }
    }
  }
  return findings;
}

export function findPathFindings(relativePath) {
  return PATH_RULE.test(relativePath)
    ? [{ path: relativePath, line: 0, rule: "path", value: relativePath, context: "" }]
    : [];
}

export function isMinified(content) {
  return content.split("\n").some((line) => line.length > MINIFIED_LINE_LIMIT);
}

export function allowlistAllows(entry, finding) {
  return entry.path === finding.path
    && entry.value === finding.value
    && typeof entry.context === "string"
    && entry.context.length > 0
    && finding.context.includes(entry.context)
    && typeof entry.reason === "string"
    && entry.reason.length > 0;
}

export function scan({ root = repoRoot, ignored = false, tracked = null } = {}) {
  const files = ignored ? walkFiles(root) : (tracked ?? trackedFiles(root));
  const findings = [];
  for (const relativePath of files) {
    if (SELF_EXEMPT.has(relativePath)) continue;
    findings.push(...findPathFindings(relativePath));
    let buffer;
    try {
      buffer = readFileSync(path.join(root, relativePath));
    } catch {
      continue;
    }
    if (isBinaryContent(buffer)) continue;
    const content = buffer.toString("utf8");
    if (ignored && isMinified(content)) continue;
    findings.push(...findContentFindings(relativePath, content));
  }
  return findings;
}

export function resolveFindings(findings, allowlist) {
  const used = new Set();
  const unresolved = [];
  for (const finding of findings) {
    const matched = allowlist.find(
      (entry) => allowlistAllows(entry, finding) && !used.has(entry),
    );
    if (matched) used.add(matched);
    else unresolved.push(finding);
  }
  const stale = allowlist.filter((entry) => !used.has(entry));
  return { unresolved, stale };
}

function main() {
  const allowlist = loadAllowlist();
  const findings = scan({ ignored: includeIgnored });
  const { unresolved, stale } = resolveFindings(findings, allowlist);

  if (unresolved.length > 0) {
    console.error(`Brand residue gate found ${unresolved.length} unallowed finding(s):`);
    for (const finding of unresolved.slice(0, 50)) {
      console.error(
        `  [${finding.rule}] ${finding.path}${finding.line ? `:${finding.line}` : ""} value=${JSON.stringify(finding.value)}`,
      );
    }
    if (unresolved.length > 50) console.error(`  ... and ${unresolved.length - 50} more`);
  }

  if (stale.length > 0) {
    console.error(`Brand residue allowlist has ${stale.length} stale entr(ies) whose value no longer exists:`);
    for (const entry of stale) {
      console.error(`  ${entry.path} value=${JSON.stringify(entry.value)}`);
    }
  }

  if (unresolved.length > 0 || stale.length > 0) process.exitCode = 1;
  else console.log("Brand residue gate passed.");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
