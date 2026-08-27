import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PAPERCLIP_ISSUE_PERF_PORT ?? 3201);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PILOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-issue-perf-home-"));
const PILOT_INSTANCE_ID = "playwright-issue-perf";
const PILOT_CONFIG = path.join(PILOT_HOME, "instances", PILOT_INSTANCE_ID, "config.json");

process.env.PAPERCLIP_HOME = PILOT_HOME;
process.env.PAPERCLIP_CONFIG = PILOT_CONFIG;

export default defineConfig({
  testDir: ".",
  testMatch: "issue-detail.perf.spec.ts",
  timeout: 30 * 60_000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "pnpm paperclipai onboard --yes --run",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(PORT),
      PAPERCLIP_HOME,
      PAPERCLIP_INSTANCE_ID,
      PAPERCLIP_CONFIG,
      PAPERCLIP_AGENT_JWT_SECRET: "playwright-issue-perf-agent-jwt-secret",
      PAPERCLIP_TOOL_ACTION_SIGNING_SECRET: "playwright-issue-perf-tool-action-signing-secret",
      PAPERCLIP_BIND: "loopback",
      PAPERCLIP_DEPLOYMENT_MODE: "local_trusted",
      PAPERCLIP_DEPLOYMENT_EXPOSURE: "private",
    },
  },
  outputDir: "../../../test-results/issue-detail-perf/playwright",
  reporter: [["list"]],
});
