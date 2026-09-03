import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensurePiModelConfiguredAndAvailable,
  listPiModels,
  resetPiModelsCacheForTests,
} from "./models.js";

describe("pi models", () => {
  afterEach(() => {
    delete process.env.PILOT_PI_COMMAND;
    resetPiModelsCacheForTests();
  });

  it("returns an empty list when discovery command is unavailable", async () => {
    process.env.PILOT_PI_COMMAND = "__pilot_missing_pi_command__";
    await expect(listPiModels()).resolves.toEqual([]);
  });

  it("rejects when model is missing", async () => {
    await expect(
      ensurePiModelConfiguredAndAvailable({ model: "" }),
    ).rejects.toThrow("Pi requires `adapterConfig.model`");
  });

  it("rejects when discovery cannot run for configured model", async () => {
    process.env.PILOT_PI_COMMAND = "__pilot_missing_pi_command__";
    await expect(
      ensurePiModelConfiguredAndAvailable({
        model: "xai/grok-4",
      }),
    ).rejects.toThrow();
  });

  it("parses the model table from stdout when stderr carries only advisories", async () => {
    // Current pi builds print the table to stdout and MCP advisories to stderr.
    const dir = mkdtempSync(join(tmpdir(), "pi-models-"));
    const script = join(dir, "fake-pi");
    writeFileSync(
      script,
      [
        "#!/bin/sh",
        'echo "MCP: 106 direct tools resolved." >&2',
        'echo "provider      model            context  max-out"',
        'echo "openai-codex  gpt-5.4          272K     128K"',
        'echo "deepseek      deepseek-v4-pro  1M       384K"',
        "",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
    try {
      process.env.PILOT_PI_COMMAND = script;
      const models = await listPiModels();
      expect(models.map((model) => model.id)).toEqual([
        "deepseek/deepseek-v4-pro",
        "openai-codex/gpt-5.4",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still parses the table from stderr for older pi versions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-models-"));
    const script = join(dir, "fake-pi");
    writeFileSync(
      script,
      [
        "#!/bin/sh",
        'echo "provider   model" >&2',
        'echo "xai        grok-4" >&2',
        "",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
    try {
      process.env.PILOT_PI_COMMAND = script;
      const models = await listPiModels();
      expect(models.map((model) => model.id)).toEqual(["xai/grok-4"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
