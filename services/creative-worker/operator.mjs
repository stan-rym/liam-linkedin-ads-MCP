// Run only after stopping every worker process sharing this data directory.
import { Store } from './store.mjs';
const command = process.argv[2];
if (!['recover','resume'].includes(command) || process.argv[3] !== '--all-workers-stopped') throw new Error('Usage: operator.mjs recover|resume --all-workers-stopped');
const store = new Store(`${process.env.WORKER_DATA_DIR || '/data'}/worker.sqlite`);
store.recover();
if (command === 'resume') store.db.prepare('UPDATE control SET blocked=NULL WHERE id=1').run();
store.close();
console.log(command === 'resume' ? 'Block cleared after operator review. Request budgets are preserved.' : 'Crash lock recovered. Block state and request budgets are preserved.');
