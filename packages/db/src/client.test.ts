import { createHash } from "node:crypto";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  applyPendingMigrations,
  inspectMigrations,
  resetPostgresDatabase,
} from "./client.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createTempDatabase(): Promise<string> {
  const db = await startEmbeddedPostgresTestDatabase("pilot-db-client-");
  cleanups.push(db.cleanup);
  return db.connectionString;
}

async function migrationHash(migrationFile: string): Promise<string> {
  const content = await fs.promises.readFile(
    new URL(`./migrations/${migrationFile}`, import.meta.url),
    "utf8",
  );
  return createHash("sha256").update(content).digest("hex");
}

const userVisibleUpdatedAtTables = new Set([
  "companies",
  "heartbeat_runs",
  "issue_comments",
  "issues",
  "routine_runs",
  "routines",
]);

const migrationUpdatedAtUpdateAllowlist = new Map<string, ReadonlySet<string>>([
  [
    "0105_instance_scoped_environments.sql",
    new Set(["issues"]),
  ],
  [
    "0131_repair_run_responsible_user_context_refs.sql",
    new Set(["heartbeat_runs"]),
  ],
  [
    "0135_repair_run_responsible_user_updated_at_sweep.sql",
    new Set(["companies", "heartbeat_runs", "issues", "routine_runs", "routines"]),
  ],
]);

function findUserVisibleUpdatedAtBackfillViolations(
  migrationFile: string,
  content: string,
): string[] {
  const allowedTables = migrationUpdatedAtUpdateAllowlist.get(migrationFile) ?? new Set<string>();
  const violations: string[] = [];

  for (const statement of content.split("--> statement-breakpoint")) {
    const updateMatch = statement.match(/\bUPDATE\s+"([^"]+)"/i);
    if (!updateMatch) continue;

    const tableName = updateMatch[1];
    if (!userVisibleUpdatedAtTables.has(tableName)) continue;
    if (!/\bSET\b[\s\S]*"updated_at"\s*=/i.test(statement)) continue;
    if (allowedTables.has(tableName)) continue;

    violations.push(`${migrationFile}: UPDATE "${tableName}" sets updated_at`);
  }

  return violations;
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres migration tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("resetPostgresDatabase", () => {
  it("recreates an existing database so stale tables are removed", async () => {
    const connectionString = await createTempDatabase();
    const adminUrl = new URL(connectionString);
    const databaseName = adminUrl.pathname.replace(/^\//, "");
    adminUrl.pathname = "/postgres";

    const setupSql = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      await setupSql.unsafe(`CREATE TABLE stale_reseed_target_only (id integer PRIMARY KEY)`);
    } finally {
      await setupSql.end();
    }

    await resetPostgresDatabase(adminUrl.toString(), databaseName);

    const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      const rows = await verifySql.unsafe<{ stale_table: string | null }[]>(
        `SELECT to_regclass('public.stale_reseed_target_only')::text AS stale_table`,
      );
      expect(rows[0]?.stale_table).toBeNull();
    } finally {
      await verifySql.end();
    }
  }, 30_000);
});

describeEmbeddedPostgres("applyPendingMigrations", () => {
  it("rejects unallowlisted migration backfills that bump updated_at on user-visible tables", async () => {
    const entries = await fs.promises.readdir(new URL("./migrations", import.meta.url), {
      withFileTypes: true,
    });
    const violations: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
      const content = await fs.promises.readFile(
        new URL(`./migrations/${entry.name}`, import.meta.url),
        "utf8",
      );
      violations.push(...findUserVisibleUpdatedAtBackfillViolations(entry.name, content));
    }

    expect(violations).toEqual([]);
    expect(
      findUserVisibleUpdatedAtBackfillViolations(
        "9999_bad_backfill.sql",
        `
          UPDATE "issues" AS i
          SET "responsible_user_id" = 'owner-user',
              "updated_at" = now()
          WHERE i."responsible_user_id" IS NULL;
        `,
      ),
    ).toEqual(['9999_bad_backfill.sql: UPDATE "issues" sets updated_at']);
  });



  it(
    "enforces a unique board_api_keys.key_hash after migration 0044",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(`
          INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
          VALUES ('user-1', 'User One', 'user@example.com', true, now(), now())
        `);
        await sql.unsafe(`
          INSERT INTO "board_api_keys" ("id", "user_id", "name", "key_hash", "created_at")
          VALUES ('00000000-0000-0000-0000-000000000001', 'user-1', 'Key One', 'dup-hash', now())
        `);
        await expect(
          sql.unsafe(`
            INSERT INTO "board_api_keys" ("id", "user_id", "name", "key_hash", "created_at")
            VALUES ('00000000-0000-0000-0000-000000000002', 'user-1', 'Key Two', 'dup-hash', now())
          `),
        ).rejects.toThrow();
      } finally {
        await sql.end();
      }
    },
    20_000,
  );









});
