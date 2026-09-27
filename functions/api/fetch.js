/* band/tree lookup pass-through (Cloudflare Pages Function at /api/fetch).
   The page asks for /api/fetch?u=<source URL>; we fetch it once, keep the answer, and hand the same answer to everyone
   who asks after that. Two layers of saved copies: Cloudflare's edge cache (fast, per region, can be dropped) and a D1
   database table (permanent until it goes stale). Keys stay here, never in the page.

   Settings in the Cloudflare dashboard (Pages project > Settings):
     D1 binding  DB              a D1 database (the table is created on first use)
     Secret      DISCOGS_TOKEN   optional, a Discogs personal access token
     Secret      CONTACT         optional, contact URL or email for the User-Agent MusicBrainz asks for */

const HOSTS = {
  'musicbrainz.org': 21, 'api.discogs.com': 21, 'www.wikidata.org': 21, 'query.wikidata.org': 14,
  'en.wikipedia.org': 14, 'itunes.apple.com': 7,
};   // days to keep a copy
const MAX_ROW = 1_500_000;   // D1 rows are capped near 2 MB; bigger answers only go in the edge cache

const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tableReady = false;
async function table(db) {
  if (tableReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, status INTEGER, type TEXT, body TEXT, ts INTEGER)').run();
  tableReady = true;
}
const reply = (body, status, type, from) => new Response(body, { status, headers: {
  'Content-Type': type || 'application/json; charset=utf-8', 'X-BT-Cache': from, 'Cache-Control': 'no-store' } });

export async function onRequest({ request, env, waitUntil }) {
  const method = request.method;
  if (method !== 'GET' && method !== 'POST') return reply('{"error":"method"}', 405, null, 'none');
  let target;
  try { target = new URL(new URL(request.url).searchParams.get('u') || ''); } catch { return reply('{"error":"bad url"}', 400, null, 'none'); }
  const days = HOSTS[target.hostname];
  if (!days || target.protocol !== 'https:') return reply('{"error":"host not allowed"}', 403, null, 'none');

  // Discogs: our own token (if set) replaces whatever the page sent, and never becomes part of the saved key.
  if (target.hostname === 'api.discogs.com') { target.searchParams.delete('token'); }
  const body = method === 'POST' ? await request.text() : '';
  const key = await sha(`${method} ${target.href} ${body}`);
  const edgeKey = new Request(`https://bandtree-cache.internal/${key}`);
  const maxAge = days * 86400;

  // 1. Edge cache.
  const edge = await caches.default.match(edgeKey);
  if (edge) { const r = new Response(edge.body, edge); r.headers.set('X-BT-Cache', 'hit-edge'); return r; }

  // 2. The database.
  if (env.DB) {
    try {
      await table(env.DB);
      const row = await env.DB.prepare('SELECT status, type, body, ts FROM cache WHERE k = ?').bind(key).first();
      if (row && Date.now() - row.ts < maxAge * 1000) {
        const r = reply(row.body, row.status, row.type, 'hit-db');
        waitUntil(caches.default.put(edgeKey, new Response(row.body, { status: row.status, headers: { 'Content-Type': row.type, 'Cache-Control': `max-age=${maxAge}` } })));
        return r;
      }
    } catch (e) { /* database trouble: fall through to the source */ }
  }

  // 3. The source itself.
  const headers = { 'User-Agent': `bandtree/1.0 ( ${env.CONTACT || 'https://bandtree.northernmile.com'} )`, Accept: request.headers.get('Accept') || 'application/json' };
  if (method === 'POST') headers['Content-Type'] = request.headers.get('Content-Type') || 'application/x-www-form-urlencoded';
  const url = new URL(target);
  if (url.hostname === 'api.discogs.com' && env.DISCOGS_TOKEN) headers.Authorization = `Discogs token=${env.DISCOGS_TOKEN}`;
  else if (url.hostname === 'api.discogs.com') { const t = new URL(new URL(request.url).searchParams.get('u')).searchParams.get('token'); if (t) url.searchParams.set('token', t); }
  // Local testing only: send the request to a stand-in server instead of the real source.
  const go = env.DEV_UPSTREAM ? new URL(url.pathname + url.search, env.DEV_UPSTREAM) : url;
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { res = await fetch(go, { method, headers, body: body || undefined }); } catch { res = null; }
    if (res && res.status !== 503 && res.status !== 429) break;
    await sleep(1100 * (attempt + 1));   // MusicBrainz allows about one request a second from us
  }
  if (!res) return reply('{"error":"source unreachable"}', 502, null, 'miss');
  const text = await res.text(), type = res.headers.get('Content-Type') || 'application/json; charset=utf-8';
  // Keep good answers and "not found"s (so we don't keep asking); never keep errors.
  if (res.ok || res.status === 404) {
    const keep = res.ok ? maxAge : 86400;
    waitUntil(caches.default.put(edgeKey, new Response(text, { status: res.status, headers: { 'Content-Type': type, 'Cache-Control': `max-age=${keep}` } })));
    if (env.DB && res.ok && text.length < MAX_ROW) waitUntil(table(env.DB).then(() =>
      env.DB.prepare('INSERT OR REPLACE INTO cache (k, status, type, body, ts) VALUES (?, ?, ?, ?, ?)').bind(key, res.status, type, text, Date.now()).run()).catch(() => {}));
  }
  return reply(text, res.status, type, 'miss');
}
