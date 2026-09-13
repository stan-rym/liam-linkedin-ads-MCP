/** One pump per process; the persistent store owner lock excludes other processes. */
export class Runner {
  constructor(store, collect) { this.store = store; this.collect = collect; this.active = false; }
  async tick() {
    if (this.active) return;
    this.active = true;
    try {
      const id = this.store.claim();
      if (!id) return;
      try { this.store.finish(id, await this.collect(id)); }
      catch (e) {
        if (e?.name === 'AdLibraryBlockedError') this.store.block('LinkedIn challenge or block detected. Collection disabled pending operator review.');
        this.store.fail(id, e?.name === 'AdLibraryBlockedError' ? 'Collection blocked' : 'Collection failed; no automatic retry for 24 hours');
      }
    } finally { this.active = false; }
  }
}
