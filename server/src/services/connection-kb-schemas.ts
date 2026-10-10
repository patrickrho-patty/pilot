// Pinned from patty-kb-mcp e9485decaf9c250ccc4f1844a491300dcea81dc9, SDK JSON Schema conversion.
export const kbSchemas = {
  search_pages: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 1,
        description: "Search text",
      },
      space_id: {
        type: "string",
        minLength: 1,
        description: "Space UUID, slug, or name",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Page size, 1-100",
      },
      offset: {
        type: "integer",
        minimum: 0,
        description: "Result offset",
      },
    },
    required: ["query"],
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#",
  },
  get_page: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        minLength: 1,
        description: "Page UUID or slugId",
      },
      format: {
        type: "string",
        enum: ["markdown", "html", "json"],
        description: "Content format. Default markdown",
      },
    },
    required: ["page_id"],
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#",
  },
  semantic_search: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 1,
        maxLength: 1000,
        description: "What you are looking for, as a question or keywords",
      },
      space: {
        type: "string",
        minLength: 1,
        description:
          "Only this space: id, slug (e.g. WL), or name (e.g. Work Logs)",
      },
      under: {
        type: "string",
        minLength: 1,
        description:
          'Only this page and everything under it: page id, slugId, or a path like "Work Logs/patty-kb-mcp" (first segment is the space)',
      },
      created_after: {
        type: "string",
        minLength: 1,
        description:
          "Pages created on or after: YYYY-MM-DD (KST) or an ISO timestamp",
      },
      created_before: {
        type: "string",
        minLength: 1,
        description:
          "Pages created before: YYYY-MM-DD includes that whole KST day; an ISO timestamp is exclusive",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Passages to return, 1-50. Default 10",
      },
    },
    required: ["query"],
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#",
  },
} as const;
