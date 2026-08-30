#!/usr/bin/env node
import { runServer } from "./index.js";

void runServer().catch((error) => {
  console.error("Failed to start Pilot MCP server:", error);
  process.exit(1);
});
