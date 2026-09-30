/* band/lines broken-image log (Cloudflare Pages Function at /api/imgerr).
   The page reports a photo that failed to load on a Milestones page or a band header, so we can fix it.
   POST   { src, page, where }                  log one failure (one row per image address, counted)
   GET    header X-Admin-Key                    list open ones, most recent first (shown on #review)
   PATCH  header X-Admin-Key, { src, status }   mark one as open / fixed / ignored
   Uses the same D1 binding (DB) and ADMIN_KEY as /api/feedback. */

const out = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
let ready = false;
async function table(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS imgerr (src TEXT PRIMARY KEY, page TEXT, place TEXT, n INTEGER DEFAULT 1,
    first INTEGER, last INTEGER, status TEXT DEFAULT 'open')`).run();
  ready = true;
}
const clip = (s, n) => String(s || '').trim().slice(0, n);
const isAdmin = (request, env) => env.ADMIN_KEY && request.headers.get('X-Admin-Key') === env.ADMIN_KEY;

export async function onRequest({ request, env }) {
  if (!env.DB) return out({ error: 'no database' }, 503);
  await table(env.DB);
  const m = request.method;
  if (m === 'POST') {
    let d; try { d = await request.json(); } catch { return out({ error: 'bad request' }, 400); }
    const src = clip(d.src, 1000), page = clip(d.page, 300), place = clip(d.where, 200), now = Date.now();
    if (!/^https?:\/\//.test(src)) return out({ ok: true });
    // A fixed image that breaks again reopens; an ignored one stays ignored.
    await env.DB.prepare(`INSERT INTO imgerr (src, page, place, n, first, last) VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(src) DO UPDATE SET n = n + 1, last = excluded.last, page = excluded.page, place = excluded.place,
      status = CASE WHEN status = 'fixed' THEN 'open' ELSE status END`).bind(src, page, place, now, now).run();
    return out({ ok: true });
  }
  if (!isAdmin(request, env)) return out({ error: 'not allowed' }, 401);
  if (m === 'GET') {
    const { results } = await env.DB.prepare('SELECT src, page, place, n, first, last, status FROM imgerr ORDER BY last DESC LIMIT 500').all();
    return out({ items: results });
  }
  if (m === 'PATCH') {
    let d; try { d = await request.json(); } catch { return out({ error: 'bad request' }, 400); }
    if (!['open', 'fixed', 'ignored'].includes(d.status)) return out({ error: 'bad status' }, 400);
    await env.DB.prepare('UPDATE imgerr SET status = ? WHERE src = ?').bind(d.status, clip(d.src, 1000)).run();
    return out({ ok: true });
  }
  return out({ error: 'method' }, 405);
}
