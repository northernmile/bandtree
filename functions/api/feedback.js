/* band/tree feedback (Cloudflare Pages Function at /api/feedback).
   POST   { comment, kind, email, page, hp }   store one comment (hp is a hidden field only robots fill in)
   GET    header X-Admin-Key                   list everything, newest first (for our review page)
   PATCH  header X-Admin-Key, { id, status }   mark one as new / done / ignored

   Settings (Pages project > Settings > Variables and Secrets):
     D1 binding  DB                  the same database as the lookup cache
     Secret      ADMIN_KEY           a long password for the review page
     Secret      TURNSTILE_SECRET    optional, Cloudflare Turnstile secret; when set, every comment must pass it */

const out = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
let ready = false;
async function table(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, kind TEXT, comment TEXT,
    email TEXT, page TEXT, ua TEXT, who TEXT, status TEXT DEFAULT 'new', verified INTEGER DEFAULT 0)`).run();
  ready = true;
}
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const clip = (s, n) => String(s || '').trim().slice(0, n);
const isAdmin = (request, env) => env.ADMIN_KEY && request.headers.get('X-Admin-Key') === env.ADMIN_KEY;

export async function onRequest({ request, env }) {
  if (!env.DB) return out({ error: 'no database' }, 503);
  await table(env.DB);
  const m = request.method;

  if (m === 'POST') {
    let d; try { d = await request.json(); } catch { return out({ error: 'bad request' }, 400); }
    if (d.hp) return out({ ok: true });   // a robot filled the hidden field: pretend it worked
    const comment = clip(d.comment, 4000), email = clip(d.email, 200).toLowerCase(), kind = clip(d.kind, 40), page = clip(d.page, 300);
    if (comment.length < 3) return out({ error: 'Please write a little more.' }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return out({ error: 'That email doesn’t look right.' }, 400);
    if (env.TURNSTILE_SECRET) {
      const f = new FormData(); f.append('secret', env.TURNSTILE_SECRET); f.append('response', clip(d.ts, 4000));
      f.append('remoteip', request.headers.get('CF-Connecting-IP') || '');
      const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f }).then(r => r.json()).catch(() => ({}));
      if (!v.success) return out({ error: 'Couldn’t confirm you’re human. Please try again.' }, 400);
    }
    // Five comments an hour from one address is plenty; more is almost always a robot.
    const who = await sha((request.headers.get('CF-Connecting-IP') || '') + (env.ADMIN_KEY || 'bt'));
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE who = ? AND ts > ?').bind(who, Date.now() - 36e5).first();
    if ((n?.n || 0) >= 5) return out({ error: 'Thanks! That’s a lot at once, please try again in a bit.' }, 429);
    await env.DB.prepare('INSERT INTO feedback (ts, kind, comment, email, page, ua, who) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(Date.now(), kind, comment, email, page, clip(request.headers.get('User-Agent'), 300), who).run();
    return out({ ok: true });
  }

  if (!isAdmin(request, env)) return out({ error: 'not allowed' }, 401);
  if (m === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, ts, kind, comment, email, page, status, verified FROM feedback ORDER BY id DESC LIMIT 500').all();
    return out({ items: results });
  }
  if (m === 'PATCH') {
    let d; try { d = await request.json(); } catch { return out({ error: 'bad request' }, 400); }
    if (!['new', 'done', 'ignored'].includes(d.status)) return out({ error: 'bad status' }, 400);
    await env.DB.prepare('UPDATE feedback SET status = ? WHERE id = ?').bind(d.status, +d.id).run();
    return out({ ok: true });
  }
  return out({ error: 'method' }, 405);
}
