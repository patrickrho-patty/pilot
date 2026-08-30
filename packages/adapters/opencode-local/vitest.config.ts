import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Remote-execution tests drive real child processes and routinely need
    // multiple seconds each under full-suite load.
    testTimeout: 30_000,
  },
});
