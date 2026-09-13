import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const digest = value => createHash('sha256').update(value).digest();
export function createWorkerServer(store, token, screenshotDir) {
  if (!token || token.length < 32) throw new Error('Worker token must contain at least 32 characters.');
  return createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req,res) => {
    const send = (status,body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (!timingSafeEqual(digest(req.headers.authorization || ''),digest(`Bearer ${token}`))) return send(401,{ error:'Unauthorized' });
    try {
      const url = new URL(req.url,'http://worker');
      const screenshot = url.pathname.match(/^\/v1\/creatives\/(\d{1,30})\/screenshot$/);
      if (req.method === 'GET' && screenshot) {
        const row = store.read([screenshot[1]]).creatives[0];
        if (row.status !== 'done' || !row.copy?.screenshotPath) return send(404,{ error:'Screenshot not available' });
        const data = await readFile(`${screenshotDir}/${screenshot[1]}.png`);
        res.writeHead(200, { 'Content-Type':'image/png','Cache-Control':'private, max-age=3600' }); return res.end(data);
      }
      if (url.pathname !== '/v1/creatives') return send(404,{ error:'Not found' });
      let ids;
      if (req.method === 'POST') {
        let body = ''; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 2048) { send(413,{ error:'Request too large' }); return; } body += chunk; }
        const value = JSON.parse(body);
        if (!value || Object.keys(value).some(k => k !== 'ids')) return send(400,{ error:'Only ids is accepted; worker limits cannot be overridden' });
        ids = value.ids;
      } else if (req.method === 'GET') ids = (url.searchParams.get('ids') || '').split(',');
      else return send(405,{ error:'Method not allowed' });
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || ids.some(id => typeof id !== 'string' || !/^\d{1,30}$/.test(id))) return send(400,{ error:'Provide 1 to 10 numeric ad IDs' });
      return send(200,req.method === 'POST' ? store.enqueue(ids) : store.read(ids));
    } catch { if (!res.headersSent) send(400,{ error:'Request could not be processed' }); }
  });
}
