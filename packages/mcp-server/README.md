# Pilot MCP Server

Model Context Protocol server for Pilot.

This package is a thin MCP wrapper over the existing Pilot REST API. It does
not talk to the database directly and it does not reimplement business logic.

## Authentication

The server reads its configuration from environment variables:

- `PILOT_API_URL` - Pilot base URL, for example `http://localhost:3100`
- `PILOT_API_KEY` - bearer token used for `/api` requests
- `PILOT_COMPANY_ID` - optional default company for company-scoped tools
- `PILOT_AGENT_ID` - optional default agent for checkout helpers
- `PILOT_RUN_ID` - optional run id forwarded on mutating requests

## Usage

```sh
npx -y @pilotai/mcp-server
```

Or locally in this repo:

```sh
pnpm --filter @pilotai/mcp-server build
node packages/mcp-server/dist/stdio.js
```

## Tool Surface

Read tools:

- `pilotMe`
- `pilotInboxLite`
- `pilotListAgents`
- `pilotGetAgent`
- `pilotListIssues`
- `pilotGetIssue`
- `pilotGetHeartbeatContext`
- `pilotListComments`
- `pilotGetComment`
- `pilotListIssueApprovals`
- `pilotListDocuments`
- `pilotGetDocument`
- `pilotListDocumentRevisions`
- `pilotListProjects`
- `pilotGetProject`
- `pilotGetIssueWorkspaceRuntime`
- `pilotWaitForIssueWorkspaceService`
- `pilotListGoals`
- `pilotGetGoal`
- `pilotListApprovals`
- `pilotGetApproval`
- `pilotGetApprovalIssues`
- `pilotListApprovalComments`

Write tools:

- `pilotCreateIssue`
- `pilotUpdateIssue`
- `pilotCheckoutIssue`
- `pilotReleaseIssue`
- `pilotAddComment`
- `pilotSuggestTasks`
- `pilotAskUserQuestions`
- `pilotRequestConfirmation`
- `pilotUpsertIssueDocument`
- `pilotRestoreIssueDocumentRevision`
- `pilotControlIssueWorkspaceServices`
- `pilotCreateApproval`
- `pilotLinkIssueApproval`
- `pilotUnlinkIssueApproval`
- `pilotApprovalDecision`
- `pilotAddApprovalComment`

Escape hatch:

- `pilotApiRequest`

`pilotApiRequest` is limited to paths under `/api` and JSON bodies. It is
meant for endpoints that do not yet have a dedicated MCP tool.
