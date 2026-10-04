const ISSUE_CREATE_PATH = "/api/companies/{companyId}/issues";
const ISSUE_COMMENT_PATH = "/api/issues/{issueId}/comments";

export function pilotIssueUrl(
  baseUrl: string,
  companyId: string,
  issueId: string,
): string {
  return `${baseUrl}/${companyId}/issues/${issueId}`;
}

type Params = Record<string, string>;

/** A non-2xx response from Pilot. */
export class PilotApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Pilot API ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = "PilotApiError";
  }
}

/**
 * The request never got an answer: it may or may not have reached Pilot.
 * Callers must reconcile before retrying, never retry blind (§28).
 */
export class PilotNetworkError extends Error {
  constructor(
    readonly path: string,
    readonly cause: unknown,
  ) {
    super(`Pilot API unreachable on ${path}: ${String(cause)}`);
    this.name = "PilotNetworkError";
  }
}

/**
 * §28.4 retry classes. The bridge must not retry an authorization failure or
 * a paused project — those need a human, and looping hides the cause.
 */
export type FailureClass =
  | "retryable-transport"
  | "retryable-server"
  | "auth"
  | "project-paused"
  | "client-error";

export function classifyFailure(err: unknown): FailureClass {
  if (err instanceof PilotNetworkError) return "retryable-transport";
  if (err instanceof PilotApiError) {
    if (err.status === 401 || err.status === 403) return "auth";
    if (err.status === 409) return "project-paused";
    if (err.status >= 500) return "retryable-server";
    return "client-error";
  }
  return "client-error";
}

export function isRetryable(cls: FailureClass): boolean {
  return cls === "retryable-transport" || cls === "retryable-server";
}

/** Exponential backoff with full jitter (§28.4). */
export function backoffMs(attempt: number, baseMs = 500, capMs = 30_000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(Math.random() * ceiling);
}

/**
 * §49/§66 least privilege: the bridge must not hold a broad `standard` agent
 * key. A `task_bridge` key is bounded to projects (or a parent issue), so a
 * compromised bridge cannot write anywhere else in the company.
 */
export function scopeCoversProjects(
  keyScope: { kind: string; projectIds?: string[]; projectId?: string | null } | undefined,
  requiredProjectIds: string[],
): { ok: true } | { ok: false; reason: string } {
  if (!keyScope) return { ok: false, reason: "key scope is missing from /agents/me" };
  if (keyScope.kind !== "task_bridge") {
    return {
      ok: false,
      reason: `key is '${keyScope.kind}'-scoped; the bridge requires a task_bridge key bounded to its mapped projects`,
    };
  }
  const granted = new Set(
    [...(keyScope.projectIds ?? []), keyScope.projectId].filter(
      (v): v is string => typeof v === "string",
    ),
  );
  const missing = requiredProjectIds.filter((id) => !granted.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `key is not scoped to mapped project(s): ${missing.join(", ")}`,
    };
  }
  return { ok: true };
}

export class PilotClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async call(path: string, init: RequestInit): Promise<Response> {
    let resp: Response;
    try {
      resp = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...((init.headers as Params) ?? {}),
        },
      });
    } catch (err) {
      throw new PilotNetworkError(path, err);
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new PilotApiError(resp.status, path, body);
    }
    return resp;
  }

  async createIssue(input: {
    companyId: string;
    title: string;
    description: string;
    assigneeAgentId?: string;
    projectId?: string;
    goalId?: string;
    /**
     * Supplying a key makes the write safe to repeat: Pilot replays the
     * original issue instead of filing a duplicate, so a timed-out create is
     * retried rather than reconciled by search.
     */
    idempotencyKey?: string;
  }): Promise<{ id: string; url: string }> {
    const path = ISSUE_CREATE_PATH.replace("{companyId}", input.companyId);
    const body = JSON.stringify({
      title: input.title,
      description: input.description,
      ...(input.assigneeAgentId ? { assigneeAgentId: input.assigneeAgentId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.goalId ? { goalId: input.goalId } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });

    let resp: Response;
    try {
      resp = await this.call(path, { method: "POST", body });
    } catch (err) {
      // Only a keyed create is safe to repeat.
      if (!(err instanceof PilotNetworkError) || !input.idempotencyKey) throw err;
      resp = await this.call(path, { method: "POST", body });
    }
    const created = (await resp.json()) as { id: string; companyId?: string };
    const companyId = created.companyId ?? input.companyId;
    return { id: created.id, url: pilotIssueUrl(this.baseUrl, companyId, created.id) };
  }

  /**
   * Atomically claim an issue for the calling agent.
   *
   * A 409 is not a lost race: Pilot returns it when the issue's **project is
   * paused** (budget hard-stop). Reported as a distinct outcome so the bridge
   * surfaces "paused" instead of a generic failure.
   */
  async checkoutIssue(
    issueId: string,
  ): Promise<{ ok: true } | { ok: false; reason: "project-paused"; message: string }> {
    try {
      await this.call(`/api/issues/${issueId}/checkout`, { method: "POST" });
      return { ok: true };
    } catch (err) {
      if (err instanceof PilotApiError && err.status === 409) {
        let message = "Project is paused";
        try {
          const parsed = JSON.parse(err.body) as { error?: string };
          if (typeof parsed.error === "string") message = parsed.error;
        } catch {
          // keep the default message
        }
        return { ok: false, reason: "project-paused", message };
      }
      throw err;
    }
  }

  /** Pending approvals on an issue (PAT-1999). */
  async listIssueApprovals(issueId: string): Promise<
    Array<{ id: string; status?: string; requestedByAgentId?: string | null; decisionNote?: string | null }>
  > {
    const resp = await this.call(`/api/issues/${issueId}/approvals`, { method: "GET" });
    const body = (await resp.json()) as unknown;
    if (!Array.isArray(body)) return [];
    return (body as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? row.approvalId ?? ""),
      ...(typeof row.status === "string" ? { status: row.status } : {}),
      requestedByAgentId:
        typeof row.requestedByAgentId === "string" ? row.requestedByAgentId : null,
      decisionNote: typeof row.decisionNote === "string" ? row.decisionNote : null,
    }));
  }

  /** Read an approval (PAT-1987). */
  async getApproval(approvalId: string): Promise<{
    id: string;
    status?: string;
    companyId?: string;
    requestedByAgentId?: string | null;
  }> {
    const resp = await this.call(`/api/approvals/${approvalId}`, { method: "GET" });
    return (await resp.json()) as {
      id: string;
      status?: string;
      companyId?: string;
      requestedByAgentId?: string | null;
    };
  }

  /**
   * Apply an approval decision (PAT-1987). Pilot requires a board actor here,
   * so the bridge uses its board credential and the human's identity is
   * carried in the audit record, never silently replaced by "board".
   */
  async decideApproval(
    approvalId: string,
    decision: "approve" | "reject" | "request-revision",
    decisionNote?: string,
  ): Promise<void> {
    const path = {
      approve: `/api/approvals/${approvalId}/approve`,
      reject: `/api/approvals/${approvalId}/reject`,
      "request-revision": `/api/approvals/${approvalId}/request-revision`,
    }[decision];
    await this.call(path, {
      method: "POST",
      body: JSON.stringify(decisionNote ? { decisionNote } : {}),
    });
  }

  /** Read an issue. The edit policy needs its checkout state (§29). */
  async getIssue(issueId: string): Promise<{
    id: string;
    description?: string | null;
    assigneeAgentId?: string | null;
    status?: string;
    /** Present when the API returns the work tree; absent otherwise. */
    children?: Array<{ id: string; status?: string; assigneeAgentId?: string | null }>;
  }> {
    const resp = await this.call(`/api/issues/${issueId}`, { method: "GET" });
    return (await resp.json()) as {
      id: string;
      description?: string | null;
      assigneeAgentId?: string | null;
      status?: string;
      children?: Array<{ id: string; status?: string; assigneeAgentId?: string | null }>;
    };
  }

  /** Replace the issue description — only before the agent checks out (§29). */
  async updateIssueDescription(issueId: string, description: string): Promise<void> {
    await this.call(`/api/issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify({ description }),
    });
  }

  /** Read the issue's comments, for reconciliation before a retry. */
  async listIssueComments(issueId: string): Promise<Array<{ id: string; body?: string }>> {
    const resp = await this.call(`/api/issues/${issueId}/comments`, { method: "GET" });
    const body = (await resp.json()) as unknown;
    return Array.isArray(body) ? (body as Array<{ id: string; body?: string }>) : [];
  }

  /**
   * Post a comment, reconciling before any retry (§28): a timed-out POST may
   * have landed, so re-read the thread and treat an identical body as
   * delivered rather than posting it twice.
   */
  async addIssueComment(issueId: string, bodyText: string): Promise<void> {
    const path = ISSUE_COMMENT_PATH.replace("{issueId}", issueId);
    try {
      await this.call(path, {
        method: "POST",
        body: JSON.stringify({ body: bodyText }),
      });
      return;
    } catch (err) {
      if (!(err instanceof PilotNetworkError)) throw err;
      const existing = await this.listIssueComments(issueId);
      if (existing.some((c) => c.body === bodyText)) return;
      await this.call(path, {
        method: "POST",
        body: JSON.stringify({ body: bodyText }),
      });
    }
  }

  /** Company secret store (PAT-1979). Returns the created secret id. */
  async createSecret(input: {
    companyId: string;
    name: string;
    key: string;
    value: string;
    description?: string;
  }): Promise<{ id: string }> {
    const path = `/api/companies/${input.companyId}/secrets`;
    const resp = await this.call(path, {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        key: input.key,
        value: input.value,
        ...(input.description ? { description: input.description } : {}),
      }),
    });
    const body = (await resp.json()) as { id: string };
    return { id: body.id };
  }

  /**
   * Validate the bearer key against Pilot (PAT-1982 startup gate).
   * `/agents/me` requires agent-scope authentication, so a board key or a
   * revoked key fails here before the bridge publishes anything.
   */
  async whoami(): Promise<{
    id: string;
    companyId?: string;
    keyScope?: { kind: string; projectIds?: string[]; projectId?: string | null };
  }> {
    const resp = await this.call("/api/agents/me", { method: "GET" });
    return (await resp.json()) as {
      id: string;
      companyId?: string;
      keyScope?: { kind: string; projectIds?: string[]; projectId?: string | null };
    };
  }

  /**
   * Create a company skill from inline markdown (PAT-1981). Returns the
   * server-assigned id and slug; `key` is the handle the skill-sync call
   * wants, so we carry whatever the server returns.
   */
  async createCompanySkill(input: {
    companyId: string;
    name: string;
    markdown: string;
    description?: string;
    slug?: string;
    categories?: string[];
  }): Promise<{ id: string; slug: string; key?: string }> {
    const resp = await this.call(`/api/companies/${input.companyId}/skills`, {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        markdown: input.markdown,
        ...(input.description ? { description: input.description } : {}),
        ...(input.slug ? { slug: input.slug } : {}),
        ...(input.categories ? { categories: input.categories } : {}),
      }),
    });
    const body = (await resp.json()) as { id: string; slug?: string; key?: string };
    return {
      id: body.id,
      slug: body.slug ?? input.slug ?? input.name,
      ...(body.key ? { key: body.key } : {}),
    };
  }

  /**
   * Assign skills to an agent (PAT-1981). `mode: "add"` keeps any skill the
   * agent already carries; `"replace"` drops everything else, so this uses
   * `add` and never silently removes an operator's own assignments.
   */
  async syncAgentSkills(
    agentId: string,
    desiredSkills: string[],
    mode: "add" | "remove" | "replace" = "add",
  ): Promise<void> {
    await this.call(`/api/agents/${agentId}/skills/sync`, {
      method: "POST",
      body: JSON.stringify({ mode, desiredSkills }),
    });
  }

  async getAgent(agentId: string): Promise<{
    id: string;
    adapterConfig?: Record<string, unknown>;
  }> {
    const resp = await this.call(`/api/agents/${agentId}`, { method: "GET" });
    return (await resp.json()) as {
      id: string;
      adapterConfig?: Record<string, unknown>;
    };
  }

  /**
   * Merge entries into an agent's adapterConfig.env and PATCH the agent.
   * The server shallow-merges top-level adapterConfig keys, so a partial env
   * object would clobber the existing one — we read, merge, and write back
   * the complete env ourselves.
   * Values may be plain strings or secret_ref bindings:
   *   { type: "secret_ref", secretId: string }
   */
  async updateAgentEnv(
    agentId: string,
    entries: Record<string, string | { type: "secret_ref"; secretId: string }>,
  ): Promise<void> {
    const agent = await this.getAgent(agentId);
    const adapterConfig = { ...(agent.adapterConfig ?? {}) };
    const env = {
      ...((adapterConfig["env"] as Record<string, unknown> | undefined) ?? {}),
      ...entries,
    };
    adapterConfig["env"] = env;
    await this.call(`/api/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ adapterConfig }),
    });
  }

  /** Drop entries from an agent's adapterConfig.env (offboard hardening). */
  async removeAgentEnvKeys(agentId: string, keys: string[]): Promise<void> {
    const agent = await this.getAgent(agentId);
    const adapterConfig = { ...(agent.adapterConfig ?? {}) };
    const env = {
      ...((adapterConfig["env"] as Record<string, unknown> | undefined) ?? {}),
    };
    for (const key of keys) delete env[key];
    adapterConfig["env"] = env;
    await this.call(`/api/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ adapterConfig }),
    });
  }
}
