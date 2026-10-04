import Database from "better-sqlite3";

export type ThreadIssueLink = {
  issueId: string;
  issueUrl: string;
  companyId: string;
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
      );
      CREATE TABLE IF NOT EXISTS thread_issue (
        thread_root TEXT PRIMARY KEY,
        crew_channel_id TEXT NOT NULL,
        issue_id TEXT NOT NULL,
        issue_url TEXT NOT NULL,
        company_id TEXT NOT NULL
      );
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
    this.hasSeen = this.db.prepare("SELECT 1 FROM seen_events WHERE id = ?");
    this.insertSeen = this.db.prepare("INSERT INTO seen_events (id) VALUES (?)");
    this.linkStmt = this.db.prepare(
      "INSERT OR REPLACE INTO thread_issue (thread_root, crew_channel_id, issue_id, issue_url, company_id) VALUES (?, ?, ?, ?, ?)",
    );
    this.lookupStmt = this.db.prepare(
      "SELECT issue_id, issue_url, company_id FROM thread_issue WHERE thread_root = ?",
    );
  }


  seen(eventId: string): boolean {
    return this.hasSeen.get(eventId) !== undefined;
  }

  markSeen(eventId: string): void {
    this.insertSeen.run(eventId);
  }


  linkThread(
    threadRoot: string,
    crewChannelId: string,
    issueId: string,
    issueUrl: string,
    companyId: string,
  ): void {
    this.linkStmt.run(threadRoot, crewChannelId, issueId, issueUrl, companyId);
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
