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

export class PilotClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async call(path: string, init: RequestInit): Promise<Response> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...((init.headers as Params) ?? {}),
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Pilot API ${resp.status} on ${path}: ${body.slice(0, 200)}`,
      );
    }
    return resp;
  }

  async createIssue(input: {
    companyId: string;
    title: string;
    description: string;
    assigneeAgentId?: string;
  }): Promise<{ id: string; url: string }> {
    const path = ISSUE_CREATE_PATH.replace("{companyId}", input.companyId);
    const resp = await this.call(path, {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        ...(input.assigneeAgentId
          ? { assigneeAgentId: input.assigneeAgentId }
          : {}),
      }),
    });
    const body = (await resp.json()) as { id: string; companyId?: string };
    const companyId = body.companyId ?? input.companyId;
    return { id: body.id, url: pilotIssueUrl(this.baseUrl, companyId, body.id) };
  }

  async addIssueComment(issueId: string, bodyText: string): Promise<void> {
    const path = ISSUE_COMMENT_PATH.replace("{issueId}", issueId);
    await this.call(path, {
      method: "POST",
      body: JSON.stringify({ body: bodyText }),
    });
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
  async whoami(): Promise<{ id: string; companyId?: string }> {
    const resp = await this.call("/api/agents/me", { method: "GET" });
    return (await resp.json()) as { id: string; companyId?: string };
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
