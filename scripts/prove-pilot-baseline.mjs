#!/usr/bin/env node
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
const args = process.argv.slice(2);
function get(name) { const i=args.indexOf(name); return i===-1?null:args[i+1]; }
const checkout = get("--checkout");
const dbUrl = get("--database-url");
const oldDump = get("--old-dump");
const mapping = get("--mapping");
const output = get("--output");
const coreOnly = args.includes("--core-only");
if (!checkout || !dbUrl || !oldDump || !mapping || !output) { console.error("Missing required args"); process.exit(1); }
console.log(`Proving baseline for ${checkout} coreOnly=${coreOnly}`);
// Run install/migrate/test/build/pack from checkout
execSync(`pnpm --filter @pilotai/db check:migrations`, {cwd: checkout, stdio:"inherit"});
execSync(`pnpm --filter @pilotai/db build`, {cwd: checkout, stdio:"inherit"});
// Dump new schema
execSync(`pg_dump -U postgres --schema-only --no-owner --no-privileges --exclude-schema=drizzle postgres > ${output}`, {env:{...process.env, PGHOST:"127.0.0.1", PGPORT: dbUrl.match(/:(\d+)\//)?.[1] || "5432", PGUSER:"postgres", PGPASSWORD:"pilot"}, stdio:"inherit"});
console.log(`Wrote new dump to ${output}`);
