import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { companies } from "./schema/companies.js";

describe("companies schema", () => {
  it("defaults new company issue identifiers to the Pilot prefix", () => {
    const issuePrefix = getTableConfig(companies).columns.find(
      (column) => column.name === "issue_prefix",
    );

    expect(issuePrefix?.default).toBe("PIL");
  });
});
