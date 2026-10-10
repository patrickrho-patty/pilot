import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { companies, connectionOrganizationBindings, connectionWorkspaceBindings, createDb } from "@pilotai/db";
import { provisionConnectionWorkspace } from "../services/connection-provisioning.js";
import { companyService } from "../services/companies.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("operator workspace reservations", () => {
  let db: ReturnType<typeof createDb>, temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    temp = await startEmbeddedPostgresTestDatabase("pilot-connection-provision-");
    db = createDb(temp.connectionString);
  });
  afterAll(async () => {
    await temp?.cleanup();
  });
  async function mapping() {
    const [company] = await db
      .insert(companies)
      .values({ name: "Crew resources", issuePrefix: randomUUID() })
      .returning();
    return {
      id: randomUUID(),
      companyId: company.id,
      accountsOrganizationId: randomUUID(),
      workspaceId: randomUUID(),
      communityId: randomUUID(),
      authorityUrl: "https://crew.example/api/connections/introspect",
    };
  }
  it("reserves exact mappings once, disabled, and denies identity substitution", async () => {
    const m = await mapping();
    const results = await Promise.all([provisionConnectionWorkspace(db, m), provisionConnectionWorkspace(db, m)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].enabled).toBe(false);
    expect(
      await db.select().from(connectionWorkspaceBindings).where(eq(connectionWorkspaceBindings.companyId, m.companyId)),
    ).toHaveLength(1);
    await expect(provisionConnectionWorkspace(db, { ...m, workspaceId: randomUUID() })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      provisionConnectionWorkspace(db, { ...m, accountsOrganizationId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(companyService(db).remove(m.companyId)).rejects.toMatchObject({ status: 409 });
  });
  it("organization-only reservations also block native company deletion", async () => {
    const m = await mapping();
    await db
      .insert(connectionOrganizationBindings)
      .values({ companyId: m.companyId, accountsOrganizationId: m.accountsOrganizationId });
    await expect(companyService(db).remove(m.companyId)).rejects.toMatchObject({ status: 409 });
  });
  it("a reservation winning the company row lock prevents concurrent deletion", async () => {
    const m = await mapping();
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      ready = new Promise<void>((r) => (locked = r));
    const writer = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM companies WHERE id=${m.companyId} FOR UPDATE`);
      await tx
        .insert(connectionOrganizationBindings)
        .values({ companyId: m.companyId, accountsOrganizationId: m.accountsOrganizationId });
      locked();
      await gate;
    });
    await ready;
    const removal = db.delete(companies).where(eq(companies.id, m.companyId));
    const denied = expect(removal).rejects.toThrow();
    release();
    await writer;
    await denied;
    expect(await db.select().from(companies).where(eq(companies.id, m.companyId))).toHaveLength(1);
  });
});
