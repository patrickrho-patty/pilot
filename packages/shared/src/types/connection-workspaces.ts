import type { z } from "zod";
import type {
  connectionAuthorityContextSchema,
  connectionAuthorityResponseSchema,
  connectionExecutionContextSchema,
  connectionIntrospectionRequestSchema,
  connectionManagementContextSchema,
  connectionWorkspaceBindingSchema,
  resolveConnectionAuthorityInputSchema,
} from "../validators/connection-workspaces.js";

/** Operator-owned external workspace mapping into the existing resource namespace. */
export type ConnectionWorkspaceBinding = z.infer<typeof connectionWorkspaceBindingSchema>;
/** Current signed-control identity; it does not itself grant resource consent. */
export type ConnectionManagementContext = z.infer<typeof connectionManagementContextSchema>;
/** Current durable Crew turn identity, without synthetic Pilot agent or run rows. */
export type ConnectionExecutionContext = z.infer<typeof connectionExecutionContextSchema>;
export type ConnectionAuthorityContext = z.infer<typeof connectionAuthorityContextSchema>;
export type ConnectionAuthorityResponse = z.infer<typeof connectionAuthorityResponseSchema>;
export type ConnectionIntrospectionRequest = z.infer<typeof connectionIntrospectionRequestSchema>;
export type ResolveConnectionAuthorityInput = z.infer<typeof resolveConnectionAuthorityInputSchema>;

/** Both the storage namespace and externally verified identity are authoritative. */
export interface ResolvedConnectionAuthority {
  binding: ConnectionWorkspaceBinding;
  context: ConnectionAuthorityContext;
}
