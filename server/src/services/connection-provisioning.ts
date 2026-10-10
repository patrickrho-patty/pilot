import { eq } from "drizzle-orm";
import { connectionOrganizationBindings, connectionWorkspaceBindings, type Db } from "@pilotai/db";
import { connectionWorkspaceBindingSchema } from "@pilotai/shared";
import { conflict } from "../errors.js";
const reservationSchema = connectionWorkspaceBindingSchema.omit({ enabled: true, createdAt: true, updatedAt: true });
/** Reserve an exact operator-verified organization/workspace mapping; activation is a separate lifecycle. */
export async function provisionConnectionWorkspace(db: Db, input: unknown) {
  const mapping = reservationSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx
      .insert(connectionOrganizationBindings)
      .values({ companyId: mapping.companyId, accountsOrganizationId: mapping.accountsOrganizationId })
      .onConflictDoNothing();
    const [org] = await tx
      .select()
      .from(connectionOrganizationBindings)
      .where(eq(connectionOrganizationBindings.companyId, mapping.companyId));
    if (org?.accountsOrganizationId !== mapping.accountsOrganizationId)
      throw conflict("Connection organization mapping conflicts");
    await tx
      .insert(connectionWorkspaceBindings)
      .values({ ...mapping, enabled: false })
      .onConflictDoNothing();
    const [binding] = await tx
      .select()
      .from(connectionWorkspaceBindings)
      .where(eq(connectionWorkspaceBindings.id, mapping.id));
    if (
      !binding ||
      binding.companyId !== mapping.companyId ||
      binding.accountsOrganizationId !== mapping.accountsOrganizationId ||
      binding.workspaceId !== mapping.workspaceId ||
      binding.communityId !== mapping.communityId ||
      binding.authorityUrl !== mapping.authorityUrl
    )
      throw conflict("Connection workspace mapping conflicts");
    return binding;
  });
}
