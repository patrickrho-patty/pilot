import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Bridge tests use real SQLite files under the OS temp dir and a stubbed
    // global fetch, so they are safe to run in parallel with the rest.
    include: ["src/**/*.test.ts"],
  },
});
