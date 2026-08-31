import Database from "better-sqlite3";

export type ThreadIssueLink = {
  issueId: string;
  issueUrl: string;
  companyId: string;
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

  close(): void {
    this.db.close();
  }
}
