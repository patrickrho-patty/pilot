import type { CLIAdapterModule } from "@pilotai/adapter-utils";
import { printClaudeStreamEvent } from "@pilotai/adapter-claude-local/cli";
import { printCodexStreamEvent } from "@pilotai/adapter-codex-local/cli";
import { printCursorStreamEvent } from "@pilotai/adapter-cursor-local/cli";
import { printCursorCloudEvent } from "@pilotai/adapter-cursor-cloud/cli";
import { printGeminiStreamEvent } from "@pilotai/adapter-gemini-local/cli";
import { printGrokStreamEvent } from "@pilotai/adapter-grok-local/cli";
import { printKimiStreamEvent } from "@pilotai/adapter-kimi-local/cli";
import { formatStdoutEvent as printHermesGatewayStreamEvent } from "@pilotai/hermes-pilot-adapter/gateway/cli";
import { printHermesStreamEvent } from "@pilotai/hermes-pilot-adapter/cli";
import { printOpenCodeStreamEvent } from "@pilotai/adapter-opencode-local/cli";
import { printPiStreamEvent } from "@pilotai/adapter-pi-local/cli";
import { printOpenClawGatewayStreamEvent } from "@pilotai/adapter-openclaw-gateway/cli";
import { processCLIAdapter } from "./process/index.js";
import { httpCLIAdapter } from "./http/index.js";

const claudeLocalCLIAdapter: CLIAdapterModule = {
  type: "claude_local",
  formatStdoutEvent: printClaudeStreamEvent,
};

const codexLocalCLIAdapter: CLIAdapterModule = {
  type: "codex_local",
  formatStdoutEvent: printCodexStreamEvent,
};

const openCodeLocalCLIAdapter: CLIAdapterModule = {
  type: "opencode_local",
  formatStdoutEvent: printOpenCodeStreamEvent,
};

const piLocalCLIAdapter: CLIAdapterModule = {
  type: "pi_local",
  formatStdoutEvent: printPiStreamEvent,
};

const cursorLocalCLIAdapter: CLIAdapterModule = {
  type: "cursor",
  formatStdoutEvent: printCursorStreamEvent,
};

const cursorCloudCLIAdapter: CLIAdapterModule = {
  type: "cursor_cloud",
  formatStdoutEvent: printCursorCloudEvent,
};

const geminiLocalCLIAdapter: CLIAdapterModule = {
  type: "gemini_local",
  formatStdoutEvent: printGeminiStreamEvent,
};

const grokLocalCLIAdapter: CLIAdapterModule = {
  type: "grok_local",
  formatStdoutEvent: printGrokStreamEvent,
};

const kimiLocalCLIAdapter: CLIAdapterModule = {
  type: "kimi_local",
  formatStdoutEvent: printKimiStreamEvent,
};

const hermesGatewayCLIAdapter: CLIAdapterModule = {
  type: "hermes_gateway",
  formatStdoutEvent: printHermesGatewayStreamEvent,
};

const hermesLocalCLIAdapter: CLIAdapterModule = {
  type: "hermes_local",
  formatStdoutEvent: printHermesStreamEvent,
};

const openclawGatewayCLIAdapter: CLIAdapterModule = {
  type: "openclaw_gateway",
  formatStdoutEvent: printOpenClawGatewayStreamEvent,
};

const adaptersByType = new Map<string, CLIAdapterModule>(
  [
    claudeLocalCLIAdapter,
    codexLocalCLIAdapter,
    openCodeLocalCLIAdapter,
    piLocalCLIAdapter,
    cursorLocalCLIAdapter,
    cursorCloudCLIAdapter,
    geminiLocalCLIAdapter,
    grokLocalCLIAdapter,
    kimiLocalCLIAdapter,
    hermesGatewayCLIAdapter,
    hermesLocalCLIAdapter,
    openclawGatewayCLIAdapter,
    processCLIAdapter,
    httpCLIAdapter,
  ].map((a) => [a.type, a]),
);

export function getCLIAdapter(type: string): CLIAdapterModule {
  return adaptersByType.get(type) ?? processCLIAdapter;
}
