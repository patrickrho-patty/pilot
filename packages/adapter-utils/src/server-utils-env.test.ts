import { describe, expect, it } from "vitest";
import { sanitizeInheritedPilotEnv } from "./server-utils.js";

describe("sanitizeInheritedPilotEnv", () => {
  it("drops the host-only Pilot CLI command pointer", () => {
    expect(sanitizeInheritedPilotEnv({
      PILOTAI_CMD: "node /missing/pilotai/dist/index.js",
      PILOT_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PILOT_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });
});
