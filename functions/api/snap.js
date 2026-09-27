/* band/tree saved copies of curated pages (Cloudflare Pages Function at /api/snap).
   A path's family tree takes about a minute of lookups to build. We build it once, keep it here, and every visitor after
   that gets it instantly. The page re-checks in the background now and then and sends a fresh copy if anything changed.

   GET  /api/snap?k=path:minor-threat      -> { ts, data } or 404
   PUT  /api/snap?k=path:minor-threat      body: the JSON to keep
   Keys are limited to curated page names, and a copy can only be replaced once it's a day old, so nobody can churn it. */

const KEY = /^(path|ms):[a-z0-9-]{1,60}$/;
const MAX = 600_000;
const out = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
let ready = false;
async function table(db) {
  if (ready) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS snaps (k TEXT PRIMARY KEY, data TEXT, ts INTEGER)').run();
  ready = true;
}

export async function onRequest({ request, env }) {
  if (!env.DB) return out('{"error":"no database"}', 503);
  const k = new URL(request.url).searchParams.get('k') || '';
  if (!KEY.test(k)) return out('{"error":"bad key"}', 400);
  await table(env.DB);
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT data, ts FROM snaps WHERE k = ?').bind(k).first();
    return row ? out(`{"ts":${row.ts},"data":${row.data}}`) : out('{"error":"none"}', 404);
  }
  if (request.method === 'PUT') {
    const text = await request.text();
    if (!text || text.length > MAX) return out('{"error":"size"}', 413);
    let d; try { d = JSON.parse(text); } catch { return out('{"error":"not json"}', 400); }
    if (!d || !d.rootId || !Array.isArray(d.bands) || !Array.isArray(d.people) || !d.people.length) return out('{"error":"shape"}', 400);
    const row = await env.DB.prepare('SELECT ts FROM snaps WHERE k = ?').bind(k).first();
    if (row && Date.now() - row.ts < 864e5) return out('{"ok":false,"why":"fresh"}');
    await env.DB.prepare('INSERT OR REPLACE INTO snaps (k, data, ts) VALUES (?, ?, ?)').bind(k, text, Date.now()).run();
    return out('{"ok":true}');
  }
  return out('{"error":"method"}', 405);
}
