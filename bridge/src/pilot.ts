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
}
