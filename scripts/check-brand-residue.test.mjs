#!/usr/bin/env node
// Tests for the permanent brand-residue gate. Builds temporary tracked-style
// fixture trees and proves every rejection/acceptance behavior.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findContentFindings,
  findPathFindings,
  isBinaryContent,
  isMinified,
  resolveFindings,
} from "./check-brand-residue.mjs";

function fixtureFile(relativePath, content) {
  return { path: relativePath, content };
}

test("rejects full old-name content in any case", () => {
  for (const content of ["the paperclip app", "Paperclip App", "PAPERCLIP_ENV"]) {
    const findings = findContentFindings("src/example.ts", content);
    assert.equal(findings.length, 1, content);
  }
});

test("rejects legacy env and header families", () => {
  const env = findContentFindings("src/env.ts", 'process.env.PAPERCLIP_API_KEY ?? ""');
  assert.equal(env.length, 1);
  const header = findContentFindings("src/headers.ts", 'req.get("x-paperclip-company-id")');
  assert.equal(header.length, 1);
});

test("rejects PAP identifiers and standalone pap words, accepts PAPA-style tokens", () => {
  const ident = findContentFindings("doc/note.md", "see PAP-1234 for context");
  assert.equal(ident[0]?.rule, "pap-prefix");
  const word = findContentFindings("doc/note.md", "the pap file");
  assert.equal(word[0]?.rule, "pap-word");
  // PAPA-81 contains PAP followed by A: not the legacy prefix family.
  assert.equal(findContentFindings("doc/note.md", "PAPA-81 identifier").length, 0);
});

test("rejects product-owned short prefixes", () => {
  for (const line of [
    "const key = \"pcgt_x\";",
    "const key = \"pcgw_y\";",
    "const dir = \"pc-agent/\";",
    "const flag = pc-route-guard;",
  ]) {
    const findings = findContentFindings("src/legacy.ts", line);
    assert.equal(findings[0]?.rule, "short-prefix", line);
  }
});

test("rejects brand-bearing paths", () => {
  for (const p of [
    "ui/public/paperclip-thinking.svg",
    "docs/assets/pap-2189/shot.png",
    "skills/paperclip/SKILL.md",
    "src/pcgw_util.ts",
  ]) {
    assert.equal(findPathFindings(p).length, 1, p);
  }
  assert.equal(findPathFindings("src/pc-helpers-are-fine-but-this-is-not-a-prefix.ts").length, 1);
  // Neutral paths pass.
  assert.equal(findPathFindings("src/components/PilotCard.tsx").length, 0);
});

test("allowlist accepts only one exact path/value/context occurrence", () => {
  const findings = [
    ...findContentFindings("docs/guide.md", "the paperclip emoji shortcode table"),
    ...findContentFindings("docs/guide.md", "the paperclip emoji shortcode table"),
  ];
  const allowlist = [{
    path: "docs/guide.md",
    value: "paperclip",
    context: "the paperclip emoji shortcode table",
    reason: "Quoted third-party shortcode table",
  }];
  const { unresolved, stale } = resolveFindings(findings, allowlist);
  // First occurrence consumes the entry; second is unallowed; nothing stale.
  assert.equal(unresolved.length, 1);
  assert.equal(stale.length, 0);
});

test("rejects stale allowlist entries whose value no longer exists", () => {
  const allowlist = [{
    path: "docs/gone.md",
    value: "paperclip",
    context: "long deleted line",
    reason: "obsolete",
  }];
  const { unresolved, stale } = resolveFindings([], allowlist);
  assert.equal(unresolved.length, 0);
  assert.equal(stale.length, 1);
});

test("detects binary content and minified bundles", () => {
  assert.equal(isBinaryContent(Buffer.from("text\0binary")), true);
  assert.equal(isBinaryContent(Buffer.from("plain text")), false);
  assert.equal(isMinified("short line"), false);
  assert.equal(isMinified(`${"x".repeat(6000)}\n`), true);
});

test("path rule ignores neutral nested names", () => {
  assert.equal(findPathFindings("src/pilot/theme/paper-tones.css").length, 0);
});

test("end-to-end scan of a fixture tree", () => {
  const root = mkdtempSync(path.join(tmpdir(), "brand-gate-fixture-"));
  try {
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src", "clean.ts"), "export const pilot = true;\n");
    writeFileSync(path.join(root, "src", "dirty.ts"), "const legacy = \"paperclip\";\n");
    const findings = [
      ...findPathFindings("src/dirty.ts"),
      ...findContentFindings("src/dirty.ts", 'const legacy = "paperclip";'),
    ];
    const { unresolved } = resolveFindings(findings, []);
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0]?.path, "src/dirty.ts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
