import Database from "better-sqlite3";

export type ThreadIssueLink = {
  issueId: string;
  issueUrl: string;
  companyId: string;
};

/** §58 audit record: everything a SIEM needs to join Crew to Pilot. */
export type AuditEntry = {
  at: string;
  action: string;
  /** Gateway correlation id, also embedded in the issue description. */
  correlationId: string | null;
  crewEventId: string | null;
  crewChannelId: string | null;
  crewThreadRoot: string | null;
  senderPubkey: string | null;
  issueId: string | null;
  issueUrl: string | null;
  agentId: string | null;
  detail: string | null;
};

/** §28.5 dead-letter row. Never carries raw message content. */
export type DlqEntry = {
  eventId: string;
  channelId: string | null;
  threadRoot: string | null;
  senderPubkey: string | null;
  targetMapping: string | null;
  failureClass: string;
  attemptCount: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
  diagnostic: string;
  replayStatus: "pending" | "replayed" | "abandoned";
};

export class BridgeStore {
  private db: Database.Database;
  private hasSeen!: Database.Statement;
  private insertSeen!: Database.Statement;
  private linkStmt!: Database.Statement;
  private lookupStmt!: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS seen_events (
        id TEXT PRIMARY KEY
      );      CREATE TABLE IF NOT EXISTS thread_issue (
        thread_root TEXT PRIMARY KEY,
        crew_channel_id TEXT NOT NULL,
        issue_id TEXT NOT NULL,
        issue_url TEXT NOT NULL,
        company_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS message_issue (
        event_id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        issue_url TEXT NOT NULL,
        company_id TEXT NOT NULL,
        thread_root TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate_window (
        key TEXT NOT NULL,
        window_start TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (key, window_start)
      );
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        action TEXT NOT NULL,
        correlation_id TEXT,
        crew_event_id TEXT,
        crew_channel_id TEXT,
        crew_thread_root TEXT,
        sender_pubkey TEXT,
        issue_id TEXT,
        issue_url TEXT,
        agent_id TEXT,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS audit_at ON audit (at);
      CREATE TABLE IF NOT EXISTS dlq (
        event_id TEXT PRIMARY KEY,
        channel_id TEXT,
        thread_root TEXT,
        sender_pubkey TEXT,
        target_mapping TEXT,
        failure_class TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        first_attempt_at TEXT NOT NULL,
        last_attempt_at TEXT NOT NULL,
        diagnostic TEXT NOT NULL,
        replay_status TEXT NOT NULL
      );
    `);

    // Retention (PAT-2007) needs an age on every row it prunes. CREATE TABLE
    // IF NOT EXISTS cannot add a column to a database that already exists, so
    // the columns are added explicitly for pre-existing bridge DBs.
    for (const [table, column] of [
      ["seen_events", "created_at"],
      ["thread_issue", "created_at"],
      ["message_issue", "created_at"],
    ] as const) {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) {
        this.db.exec(
          `ALTER TABLE ${table} ADD COLUMN ${column} TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'`,
        );
      }
    }
    this.hasSeen = this.db.prepare("SELECT 1 FROM seen_events WHERE id = ?");
    this.insertSeen = this.db.prepare(
      "INSERT INTO seen_events (id, created_at) VALUES (?, ?)",
    );
    this.linkStmt = this.db.prepare(
      "INSERT OR REPLACE INTO thread_issue (thread_root, crew_channel_id, issue_id, issue_url, company_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.lookupStmt = this.db.prepare(
      "SELECT issue_id, issue_url, company_id FROM thread_issue WHERE thread_root = ?",
    );
  }


  seen(eventId: string): boolean {
    return this.hasSeen.get(eventId) !== undefined;
  }

  markSeen(eventId: string): void {
    this.insertSeen.run(eventId, new Date().toISOString());
  }


  linkThread(
    threadRoot: string,
    crewChannelId: string,
    issueId: string,
    issueUrl: string,
    companyId: string,
  ): void {
    this.linkStmt.run(
      threadRoot,
      crewChannelId,
      issueId,
      issueUrl,
      companyId,
      new Date().toISOString(),
    );
  }

  /** Append a §58 audit record. Never carries message content. */
  recordAudit(entry: Omit<AuditEntry, "at"> & { at?: string }): void {
    this.db
      .prepare(
        `INSERT INTO audit (at, action, correlation_id, crew_event_id, crew_channel_id,
                            crew_thread_root, sender_pubkey, issue_id, issue_url, agent_id, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.at ?? new Date().toISOString(),
        entry.action,
        entry.correlationId,
        entry.crewEventId,
        entry.crewChannelId,
        entry.crewThreadRoot,
        entry.senderPubkey,
        entry.issueId,
        entry.issueUrl,
        entry.agentId,
        entry.detail,
      );
  }

  /** Audit records at or after `since` (ISO), oldest first — the SIEM export. */
  listAudit(since?: string, limit = 1000): AuditEntry[] {
    const rows = (
      since
        ? this.db
            .prepare("SELECT * FROM audit WHERE at >= ? ORDER BY id LIMIT ?")
            .all(since, limit)
        : this.db.prepare("SELECT * FROM audit ORDER BY id LIMIT ?").all(limit)
    ) as Array<Record<string, string | number | null>>;
    return rows.map((r) => ({
      at: String(r.at),
      action: String(r.action),
      correlationId: (r.correlation_id as string | null) ?? null,
      crewEventId: (r.crew_event_id as string | null) ?? null,
      crewChannelId: (r.crew_channel_id as string | null) ?? null,
      crewThreadRoot: (r.crew_thread_root as string | null) ?? null,
      senderPubkey: (r.sender_pubkey as string | null) ?? null,
      issueId: (r.issue_id as string | null) ?? null,
      issueUrl: (r.issue_url as string | null) ?? null,
      agentId: (r.agent_id as string | null) ?? null,
      detail: (r.detail as string | null) ?? null,
    }));
  }

  /**
   * Link every Crew message that maps to an issue, not just the thread root:
   * an edit event (kind 40003) names the message it edits, which may be a
   * follow-up rather than the root (§29 edit race).
   */
  linkMessage(
    eventId: string,
    issueId: string,
    issueUrl: string,
    companyId: string,
    threadRoot: string,
  ): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO message_issue (event_id, issue_id, issue_url, company_id, thread_root, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(eventId, issueId, issueUrl, companyId, threadRoot, new Date().toISOString());
  }

  issueForMessage(eventId: string): ThreadIssueLink | null {
    const row = this.db
      .prepare("SELECT issue_id, issue_url, company_id FROM message_issue WHERE event_id = ?")
      .get(eventId) as
      | { issue_id: string; issue_url: string; company_id: string }
      | undefined;
    return row
      ? { issueId: row.issue_id, issueUrl: row.issue_url, companyId: row.company_id }
      : null;
  }

  /**
   * Per-sender/per-channel rate limit counter (§29, §67 P1). Persisted per
   * window so a restart cannot reset the budget.
   */
  bumpRateWindow(key: string, windowStart: string): number {
    this.db
      .prepare(
        "INSERT INTO rate_window (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1",
      )
      .run(key, windowStart);
    const row = this.db
      .prepare("SELECT count FROM rate_window WHERE key = ? AND window_start = ?")
      .get(key, windowStart) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /**
   * §50/PAT-2007 retention. Deletes bridge-side rows older than `before` and
   * reports what it removed. Only identifiers and metadata live here — no
   * message bodies are stored, so nothing customer-authored is deleted.
   */
  pruneRetention(before: string): Record<string, number> {
    const targets: Array<[string, string]> = [
      ["seen_events", "created_at"],
      ["thread_issue", "created_at"],
      ["message_issue", "created_at"],
      ["audit", "at"],
      ["rate_window", "window_start"],
    ];
    const removed: Record<string, number> = {};
    const run = this.db.transaction(() => {
      for (const [table, column] of targets) {
        const info = this.db
          .prepare(`DELETE FROM ${table} WHERE ${column} < ?`)
          .run(before);
        removed[table] = Number(info.changes);
      }
    });
    run();
    return removed;
  }

  /**
   * Run `fn` in a single SQLite transaction. Throwing rolls the whole thing
   * back, which is how `retention prune --dry-run` reports real counts
   * without writing.
   */
  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }

  /**
   * §50/PAT-2007 retention for channel-scoped rows. `retentionDays` differs
   * per channel, so each channel gets its own cutoff.
   */
  pruneChannelRetention(channelId: string, before: string): Record<string, number> {
    const removed: Record<string, number> = {};
    const run = this.db.transaction(() => {
      removed.thread_issue = Number(
        this.db
          .prepare("DELETE FROM thread_issue WHERE crew_channel_id = ? AND created_at < ?")
          .run(channelId, before).changes,
      );
      removed.message_issue = Number(
        this.db
          .prepare(
            "DELETE FROM message_issue WHERE thread_root IN (SELECT thread_root FROM thread_issue WHERE crew_channel_id = ?) AND created_at < ?",
          )
          .run(channelId, before).changes,
      );
    });
    run();
    return removed;
  }

  /** Drop rate windows older than the given instant. */
  pruneRateWindows(before: string): void {
    this.db.prepare("DELETE FROM rate_window WHERE window_start < ?").run(before);
  }

  issueForThread(threadRoot: string): ThreadIssueLink | null {
    const row = this.lookupStmt.get(threadRoot) as
      | { issue_id: string; issue_url: string; company_id: string }
      | undefined;
    return row
      ? { issueId: row.issue_id, issueUrl: row.issue_url, companyId: row.company_id }
      : null;
  }

  /**
   * Record or bump a dead-letter row (§28.5). Attempt count and first-attempt
   * time survive repeated failures of the same event.
   */
  recordFailure(entry: Omit<DlqEntry, "attemptCount" | "firstAttemptAt" | "lastAttemptAt">): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO dlq (event_id, channel_id, thread_root, sender_pubkey, target_mapping,
                          failure_class, attempt_count, first_attempt_at, last_attempt_at,
                          diagnostic, replay_status)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO UPDATE SET
           attempt_count = attempt_count + 1,
           last_attempt_at = excluded.last_attempt_at,
           failure_class = excluded.failure_class,
           diagnostic = excluded.diagnostic`,
      )
      .run(
        entry.eventId,
        entry.channelId,
        entry.threadRoot,
        entry.senderPubkey,
        entry.targetMapping,
        entry.failureClass,
        now,
        now,
        entry.diagnostic.slice(0, 500),
        entry.replayStatus,
      );
  }

  /** Dead letters awaiting replay, oldest first. */
  listFailures(status: DlqEntry["replayStatus"] = "pending"): DlqEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM dlq WHERE replay_status = ? ORDER BY first_attempt_at")
      .all(status) as Array<Record<string, string | number | null>>;
    return rows.map((r) => ({
      eventId: String(r.event_id),
      channelId: (r.channel_id as string | null) ?? null,
      threadRoot: (r.thread_root as string | null) ?? null,
      senderPubkey: (r.sender_pubkey as string | null) ?? null,
      targetMapping: (r.target_mapping as string | null) ?? null,
      failureClass: String(r.failure_class),
      attemptCount: Number(r.attempt_count),
      firstAttemptAt: String(r.first_attempt_at),
      lastAttemptAt: String(r.last_attempt_at),
      diagnostic: String(r.diagnostic),
      replayStatus: r.replay_status as DlqEntry["replayStatus"],
    }));
  }

  /** Clear a dead letter for replay: the receipt must not block reprocessing. */
  markForReplay(eventId: string): void {
    this.db
      .prepare("UPDATE dlq SET replay_status = 'pending' WHERE event_id = ?")
      .run(eventId);
    this.db.prepare("DELETE FROM seen_events WHERE id = ?").run(eventId);
  }

  markReplayed(eventId: string): void {
    this.db
      .prepare("UPDATE dlq SET replay_status = 'replayed' WHERE event_id = ?")
      .run(eventId);
  }

  close(): void {
    this.db.close();
  }
}
