import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Store } from '../store.mjs';
import { createWorkerServer } from '../server.mjs';

test('authenticated API queues only IDs, status reads do not enqueue, limits cannot be overridden', async t => {
  const store = new Store(':memory:'); const token = 'x'.repeat(32);
  const server = createWorkerServer(store,token,'/unused');
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=> { server.closeAllConnections(); await new Promise(r=>server.close(r)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}/v1/creatives`;
  const headers = {Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  assert.equal((await fetch(`${base}?ids=1`)).status,401);
  let res = await fetch(`${base}?ids=1`,{headers}); assert.equal((await res.json()).creatives[0].status,'missing');
  assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify({ids:['1'],concurrency:100})})).status,400);
  res = await fetch(base,{method:'POST',headers,body:JSON.stringify({ids:['1']})}); assert.equal((await res.json()).creatives[0].status,'pending');
  store.block('Operator review required');
  res = await fetch(base,{method:'POST',headers,body:JSON.stringify({ids:['2']})}); const blocked = await res.json();
  assert.equal(blocked.blocked,true); assert.equal(blocked.creatives[0].status,'missing');
  assert.equal((await fetch(`${base}/1/screenshot`,{headers})).status,404);
  assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify({ids:['http://localhost']})})).status,400);
});
