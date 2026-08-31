import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const BASE = {
  CREW_RELAY_URL: "wss://crew.patty.io",
  PILOT_BASE_URL: "https://pilot.patty.io",
  PILOT_API_KEY: "pak_test",
  CREW_GATEWAY_PRIVATE_KEY: "a".repeat(64),
  CREW_RELAY_ADMIN_KEY_PATH: "/tmp/admin-key.txt",
};

describe("loadConfig", () => {
  it("reads required vars", () => {
    const cfg = loadConfig(BASE, "/tmp/bridge.db");
    expect(cfg.relayUrl).toBe("wss://crew.patty.io");
    expect(cfg.pilotBaseUrl).toBe("https://pilot.patty.io");
    expect(cfg.pilotApiKey).toBe("pak_test");
    expect(cfg.gatewayPrivateKey).toBe("a".repeat(64));
    expect(cfg.port).toBe(3101);
    expect(cfg.admin.crewCliPath).toBe("crew");
    expect(cfg.admin.relayAdminKeyPath).toBe("/tmp/admin-key.txt");
  });

  it("rejects a short private key", () => {
    expect(() =>
      loadConfig({ ...BASE, CREW_GATEWAY_PRIVATE_KEY: "short" }, "/tmp/b.db"),
    ).toThrow(/CREW_GATEWAY_PRIVATE_KEY/);
  });

  it("trims trailing slash from pilot base url", () => {
    const cfg = loadConfig(
      { ...BASE, PILOT_BASE_URL: "https://pilot.patty.io/" },
      "/tmp/b.db",
    );
    expect(cfg.pilotBaseUrl).toBe("https://pilot.patty.io");
  });

  it("throws on missing required vars", () => {
    expect(() => loadConfig({} as never, "/tmp/b.db")).toThrow(/Missing env/);
  });
});
