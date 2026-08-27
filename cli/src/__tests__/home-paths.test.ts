import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeLocalInstancePaths,
  expandHomePrefix,
  resolvePilotHomeDir,
  resolvePilotInstanceId,
} from "../config/home.js";

const ORIGINAL_ENV = { ...process.env };

describe("home path resolution", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to ~/.paperclip and default instance", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-home-paths-"));
    process.env.PILOT_HOME = home;
    delete process.env.PILOT_INSTANCE_ID;

    const paths = describeLocalInstancePaths();
    expect(paths.homeDir).toBe(home);
    expect(paths.instanceId).toBe("default");
    expect(paths.configPath).toBe(path.resolve(home, "instances", "default", "config.json"));
  });

  it("supports PAPERCLIP_HOME and explicit instance ids", () => {
    process.env.PILOT_HOME = "~/paperclip-home";

    const home = resolvePilotHomeDir();
    expect(home).toBe(path.resolve(os.homedir(), "paperclip-home"));
    expect(resolvePilotInstanceId("dev_1")).toBe("dev_1");
  });

  it("rejects invalid instance ids", () => {
    expect(() => resolvePilotInstanceId("bad/id")).toThrow(/Invalid PAPERCLIP_INSTANCE_ID/);
  });

  it("expands ~ prefixes", () => {
    expect(expandHomePrefix("~")).toBe(os.homedir());
    expect(expandHomePrefix("~/x/y")).toBe(path.resolve(os.homedir(), "x/y"));
  });
});
