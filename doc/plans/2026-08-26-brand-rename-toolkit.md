# Brand Rename Toolkit — paperclip → (name TBD)

Date: 2026-08-26
Status: **tooling committed, execution blocked on final brand name** (Pilot is
under reconsideration; Patrick will announce the final name).

## What is already done

- **Blast-radius inventory** (measured 2026-08-25): ~27k case-insensitive
  occurrences across ~2.6k files. server 8,979 · packages 8,650 · doc 3,698 ·
  ui 3,169 · cli 2,099 · skills+.github+root ~600.
- **ast-grep toolkit proven end-to-end** on the real repo (see git history):
  rule `env-var-access-rename` matched exactly 1,368 sites; applied → 219
  files changed; controlled `tsc --noEmit` before/after showed **identical
  error sets (0 new)**; reverted cleanly. The `env-string-literal-rename`
  rule adds 290 more sites ("PAPERCLIP_X" string keys in spawn/env objects).

## Tooling (committed)

```
sgconfig.yml                      # ast-grep project config; rules are generated
scripts/rename/generate-rules.mjs # stamps <NAME>_ into rule templates
scripts/rename/rules/*.yml        # templates with __TARGET__ placeholder
.ast-grep-rules/                  # generated output (gitignored except .gitkeep)
```

When the name lands:

```sh
node scripts/rename/generate-rules.mjs <NAME>   # e.g. ACME → ACME_
ast-grep scan        # report only
ast-grep scan -U     # apply (clean tree, one category per commit)
```

## Tiered plan (execute in this order, one commit per category)

| # | Category | Tool | Notes |
|---|----------|------|-------|
| 1 | Docs + UI copy | fastmod | zero behavior risk |
| 2 | TS identifiers/symbols | tsserver rename / ts-morph | type-safe; ast-grep not enough here |
| 3 | Env var accesses + literal keys | ast-grep (rules above) | needs alias window first (see below) |
| 4 | On-disk paths (`~/.paperclip*`, `/paperclip`) | code + migration marker | follow the `mcp-global-migration-v1` pattern from patty-code |
| 5 | npm scope `@paperclipai/*` | publish new + `npm deprecate` old | deprecation message points to new name |
| 6 | GitHub org/repo | rename last | redirects cover links; fix `uses:` workflow refs first |

## Hard constraints learned from the blast-radius audit

- **365 distinct `PAPERCLIP_*` env vars** are runtime contracts read by 63
  adapter/plugin files, agent sandboxes mid-session, user scripts, the
  `pilot-secrets` k8s secret, and CI. A hard flip breaks all of them at once:
  ship a compat layer that reads `<NEW>_X ?? PAPERCLIP_X` for one release
  window before tier-3 rewrites land.
- **`/paperclip` mount holds live embedded-Postgres data** on the EBS PVC.
  Rename = data migration; do it last or never (mount path is chart-level and
  invisible to users).
- **`~/.pi/paperclips/`** holds pi-adapter session state; renaming breaks
  `--session` resume mid-run. Needs the same marker-migration treatment.
- **`paperclip_managed`** DB markers (36 refs) are persisted state — rename
  requires a migration, not a string change.
- **EKS deploy naming is already decoupled** (repo/namespace/release `pilot`,
  domain pilot.patty.io) and is independent of this codebase rename.

## Verification gates (per category commit)

1. `pnpm -r typecheck`
2. `pnpm test:run`
3. Controlled diff: error/test output before vs after must be identical
   beyond the intended change
4. For env tier: deploy to pilot EKS and confirm the pod boots with old
   secret names still set (alias window active)

## Method references

- ast-grep: https://ast-grep.github.io (rules in `scripts/rename/rules/`)
- Codemod discipline (negative tests, composition):
  https://martinfowler.com/articles/codemods-api-refactoring.html
- Precedent: patty-code-vscode commit 8c8f6e4 (categorized atomic rebrand);
  patty-code fresh-import method (rejected here — history + live state matter).
