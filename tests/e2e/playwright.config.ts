import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Use a dedicated port so e2e tests always start their own server in local_trusted mode,
// even when the dev server is running on :3100 in authenticated mode.
const PORT = Number(process.env.PILOT_E2E_PORT ?? 3199);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PILOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-e2e-home-"));
const PILOT_INSTANCE_ID = "playwright-e2e";
const PILOT_CONFIG = path.join(PILOT_HOME, "instances", PILOT_INSTANCE_ID, "config.json");
const PILOT_AGENT_JWT_SECRET = process.env.PILOT_AGENT_JWT_SECRET ?? "playwright-e2e-agent-jwt-secret";
const PILOT_DECISION_SIGNING_SECRET =
  process.env.PILOT_DECISION_SIGNING_SECRET ?? "playwright-e2e-decision-signing-secret";
const PILOT_TOOL_ACTION_SIGNING_SECRET =
  process.env.PILOT_TOOL_ACTION_SIGNING_SECRET ?? "playwright-e2e-tool-action-signing-secret";
const PLAYWRIGHT_CHANNEL = process.env.PILOT_PLAYWRIGHT_CHANNEL;

process.env.PILOT_HOME = PILOT_HOME;
process.env.PILOT_CONFIG = PILOT_CONFIG;
// Specs that mint agent JWTs in-process (via createLocalAgentJwt) must derive
// the same per-instance signing key as the webServer, or verification fails
// with a 401 instead of authenticating as the agent.
process.env.PILOT_INSTANCE_ID = PILOT_INSTANCE_ID;
process.env.PILOT_AGENT_JWT_SECRET = PILOT_AGENT_JWT_SECRET;
process.env.PILOT_DECISION_SIGNING_SECRET = PILOT_DECISION_SIGNING_SECRET;
process.env.PILOT_TOOL_ACTION_SIGNING_SECRET = PILOT_TOOL_ACTION_SIGNING_SECRET;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  // These suites target dedicated multi-user configurations/ports and are
  // intentionally not part of the default local_trusted e2e run.
  testIgnore: ["multi-user.spec.ts", "multi-user-authenticated.spec.ts"],
  timeout: 60_000,
  retries: 0,
  // All specs share one throwaway server, and several toggle instance-level
  // state (the `enableConferenceRoomChat` experimental flag) that changes
  // which UI variant renders. Run files serially so a flag flip in one spec
  // can't change the wizard/thread under another spec mid-flight.
  workers: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        ...(PLAYWRIGHT_CHANNEL ? { channel: PLAYWRIGHT_CHANNEL } : {}),
      },
    },
  ],
  // The webServer directive bootstraps a throwaway instance and then starts it.
  // `onboard --yes --run` works in a non-interactive temp PILOT_HOME.
  webServer: {
    command: `pnpm pilotai onboard --yes --run`,
    url: `${BASE_URL}/api/health`,
    // Always boot a dedicated throwaway instance for e2e so browser tests
    // never attach to the developer's active Pilot home/server.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(PORT),
      PILOT_HOME,
      PILOT_INSTANCE_ID,
      PILOT_CONFIG,
      PILOT_AGENT_JWT_SECRET,
      PILOT_DECISION_SIGNING_SECRET,
      PILOT_TOOL_ACTION_SIGNING_SECRET,
      PILOT_BIND: "loopback",
      PILOT_DEPLOYMENT_MODE: "local_trusted",
      PILOT_DEPLOYMENT_EXPOSURE: "private",
    },
  },
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
});
