import { DatabaseSync } from 'node:sqlite';

export const LIMITS = Object.freeze({ perJob: 10, pagesPerDay: 50, requestsPerDay: 500, gapMs: 15000, cacheMs: 7 * 86400000, queueSize: 100 });
export class Store {
  constructor(path, now = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated INTEGER NOT NULL, copy TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS visits (kind TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS visits_at ON visits(at);
      CREATE TABLE IF NOT EXISTS control (id INTEGER PRIMARY KEY CHECK(id=1), blocked TEXT, owner TEXT);
      INSERT OR IGNORE INTO control(id) VALUES(1);`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  // Deliberately no expiring lease: a crashed worker requires operator recovery,
  // rather than risking overlapping browsers after a network partition.
  acquire(owner) {
    const result = this.db.prepare('UPDATE control SET owner=? WHERE id=1 AND owner IS NULL').run(owner);
    if (!result.changes) throw new Error('Worker already locked. After a crash, stop all replicas before operator recovery.');
  }
  release(owner) { this.db.prepare('UPDATE control SET owner=NULL WHERE owner=?').run(owner); }
  blocked() { return this.db.prepare('SELECT blocked FROM control WHERE id=1').get().blocked; }
  block(reason) { this.db.prepare('UPDATE control SET blocked=? WHERE id=1').run(reason); }
  enqueue(ids) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > LIMITS.perJob || ids.some(id => typeof id !== 'string' || !/^\d{1,30}$/.test(id))) throw new Error('Provide 1 to 10 numeric ad IDs.');
    this.transaction(() => {
      if (this.blocked()) return;
      for (const id of new Set(ids)) {
        const old = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
        if (old && (['pending', 'running'].includes(old.status) || this.now() - old.updated < (old.status === 'done' ? LIMITS.cacheMs : 86400000))) continue;
        const queued = this.db.prepare("SELECT count(*) AS n FROM jobs WHERE status IN ('pending','running')").get().n;
        if (queued >= LIMITS.queueSize) throw new Error('Creative queue is full. Read existing job status instead.');
        this.db.prepare("INSERT INTO jobs(id,status,updated) VALUES(?,'pending',?) ON CONFLICT(id) DO UPDATE SET status='pending', updated=excluded.updated, copy=NULL, error=NULL").run(id, this.now());
      }
    });
    return this.read(ids);
  }
  read(ids) {
    return { blocked: Boolean(this.blocked()), note: this.blocked() || 'Results are cached for seven days. Pending work is subject to rolling budgets.', creatives: [...new Set(ids)].map(id => {
      const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
      if (!row) return { id, status: 'missing' };
      return { id, status: row.status, ...(row.copy ? { copy: JSON.parse(row.copy), collectedAt: new Date(row.updated).toISOString() } : {}), ...(row.error ? { error: row.error } : {}) };
    }) };
  }
  reserveRequest() {
    return this.transaction(() => {
      if (this.blocked()) return false;
      const n = this.db.prepare("SELECT count(*) AS n FROM visits WHERE kind='request' AND at>?").get(this.now()-86400000).n;
      if (n >= LIMITS.requestsPerDay) return false;
      this.db.prepare("INSERT INTO visits VALUES('request',?)").run(this.now());
      return true;
    });
  }
  claim() {
    return this.transaction(() => {
      if (this.blocked()) return;
      const now = this.now();
      this.db.prepare('DELETE FROM visits WHERE at<=?').run(now-86400000);
      const counts = this.db.prepare('SELECT kind,count(*) AS n,max(at) AS last FROM visits GROUP BY kind').all();
      const pages = counts.find(c => c.kind === 'page');
      const requests = counts.find(c => c.kind === 'request');
      if ((pages && (pages.n >= LIMITS.pagesPerDay || now-pages.last < LIMITS.gapMs)) || (requests && requests.n >= LIMITS.requestsPerDay)) return;
      const job = this.db.prepare("SELECT id FROM jobs WHERE status='pending' ORDER BY updated,id LIMIT 1").get();
      if (!job) return;
      this.db.prepare("INSERT INTO visits VALUES('page',?)").run(now);
      this.db.prepare("UPDATE jobs SET status='running', updated=? WHERE id=?").run(now,job.id);
      return job.id;
    });
  }
  finish(id, copy) {
    this.db.prepare("UPDATE jobs SET status='done',copy=?,error=NULL,updated=? WHERE id=?").run(JSON.stringify(copy),this.now(),id);
  }
  fail(id, error) {
    this.db.prepare("UPDATE jobs SET status='failed',error=?,updated=? WHERE id=?").run(error,this.now(),id);
  }
  recover() {
    this.transaction(() => {
      this.db.prepare('UPDATE control SET owner=NULL WHERE id=1').run();
      this.db.prepare("UPDATE jobs SET status='failed', error='Interrupted job; no automatic retry',updated=? WHERE status='running'").run(this.now());
    });
  }
  close() { this.db.close(); }
}
