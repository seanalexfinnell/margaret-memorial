/// <reference types="@cloudflare/workers-types" />
/**
 * margaret.memorial Worker.
 * Serves the static Astro build and a small API for shared memories.
 * Every submission is stored as "pending" and only appears after a family member approves it.
 */

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  PHOTOS: R2Bucket;
  TURNSTILE_SECRET: string;
  ACCESS_TEAM_DOMAIN: string; // e.g. "cairns-family.cloudflareaccess.com"
  ACCESS_AUD: string; // Access application audience tag
  DEV_ADMIN?: string;
  ADMIN_PASSWORD?: string; // simple alternative to Cloudflare Access: browser sign-in prompt, any username
  SITE_PASSWORD?: string; // family password for the whole site (a secret, never in this public repo). Unset = site locked.
}

const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // photos are resized in the browser first
const MAX_BODY_CHARS = 5000;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    try {
      // The whole site sits behind one family password until the family decides to open it.
      if (pathname === "/__enter" && req.method === "POST") return await enter(req, env);
      if (!(await hasPass(req, env))) return gatePage(false, pathname.startsWith("/api/") ? 401 : 200);

      if (pathname === "/admin" || pathname === "/admin/" || pathname === "/admin.html") {
        if (!(await requireAdmin(req, env))) return askForPassword(env);
        return env.ASSETS.fetch(req);
      }
      if (pathname === "/api/memories" && req.method === "GET") return await listApproved(env);
      if (pathname === "/api/memories" && req.method === "POST") return await submit(req, env);
      if (pathname.startsWith("/api/photo/") && req.method === "GET")
        return await servePhoto(decodeURIComponent(pathname.slice("/api/photo/".length)), env, false);

      if (pathname.startsWith("/api/admin/")) {
        const reviewer = await requireAdmin(req, env);
        if (!reviewer) return env.ADMIN_PASSWORD ? askForPassword(env) : json({ error: "Sign in through Cloudflare Access to review memories." }, 401);
        if (pathname === "/api/admin/memories" && req.method === "GET") return await listAll(env);
        if (pathname.startsWith("/api/admin/photo/") && req.method === "GET")
          return await servePhoto(decodeURIComponent(pathname.slice("/api/admin/photo/".length)), env, true);
        const m = pathname.match(/^\/api\/admin\/memories\/([\w-]+)$/);
        if (m && req.method === "POST") return await review(m[1], req, env, reviewer);
        return json({ error: "Not found" }, 404);
      }

      if (pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
      return env.ASSETS.fetch(req);
    } catch (err) {
      console.error(err);
      return json({ error: "Something went wrong on our side. Please try again in a moment." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

/* ---------- public ---------- */

async function listApproved(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.created_at, m.name, m.relation, m.place, m.body,
            (SELECT json_group_array(json_object('key', p.key, 'caption', p.caption, 'w', p.width, 'h', p.height))
               FROM photos p WHERE p.memory_id = m.id) AS photos
       FROM memories m WHERE m.status = 'approved' ORDER BY m.created_at DESC LIMIT 300`
  ).all();
  return json(results.map((r: any) => ({ ...r, photos: JSON.parse(r.photos || "[]") })));
}

async function submit(req: Request, env: Env) {
  const form = await req.formData();

  const token = clean(form.get("cf-turnstile-response"), 4096);
  if (!(await verifyTurnstile(token, req, env)))
    return json({ error: "We couldn't confirm you're not a robot. Please reload the page and try again." }, 400);

  // Honeypot: real people never see this field.
  if (clean(form.get("website"), 200)) return json({ ok: true });

  const name = clean(form.get("name"), 120);
  const body = clean(form.get("body"), MAX_BODY_CHARS);
  if (!name || !body) return json({ error: "Please add your name and a memory." }, 400);

  const id = crypto.randomUUID();
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_PHOTOS);
  const captions = form.getAll("captions").map((c) => clean(c, 200));
  const dims = form.getAll("dims").map((d) => clean(d, 20));

  const stmts = [
    env.DB.prepare(`INSERT INTO memories (id, name, relation, place, body) VALUES (?, ?, ?, ?, ?)`).bind(
      id, name, clean(form.get("relation"), 120) || null, clean(form.get("place"), 120) || null, body
    ),
  ];

  for (const [i, file] of files.entries()) {
    if (file.size > MAX_PHOTO_BYTES || !/^image\/(jpeg|png|webp)$/.test(file.type))
      return json({ error: "Photos need to be JPEG, PNG or WebP and under 4 MB each." }, 400);
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = `${id}/${i}.${ext}`;
    await env.PHOTOS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    const [w, h] = (dims[i] || "").split("x").map((n) => parseInt(n, 10) || null);
    stmts.push(
      env.DB.prepare(`INSERT INTO photos (key, memory_id, caption, width, height) VALUES (?, ?, ?, ?, ?)`).bind(
        key, id, captions[i] || null, w ?? null, h ?? null
      )
    );
  }

  await env.DB.batch(stmts);
  return json({ ok: true });
}

async function servePhoto(key: string, env: Env, admin: boolean) {
  if (!/^[\w-]+\/\d\.(jpg|png|webp)$/.test(key)) return new Response("Not found", { status: 404 });
  if (!admin) {
    const row = await env.DB.prepare(
      `SELECT 1 FROM photos p JOIN memories m ON m.id = p.memory_id WHERE p.key = ? AND m.status = 'approved'`
    ).bind(key).first();
    if (!row) return new Response("Not found", { status: 404 });
  }
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "image/jpeg",
      "cache-control": admin ? "private, no-store" : "public, max-age=3600",
    },
  });
}

async function verifyTurnstile(token: string, req: Request, env: Env) {
  if (!token) return false;
  // Local development only: Cloudflare's always-pass test secret, without calling out to Turnstile.
  if (env.DEV_ADMIN === "1" && env.TURNSTILE_SECRET === "1x0000000000000000000000000000000AA") return true;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  const ip = req.headers.get("CF-Connecting-IP");
  if (ip) body.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const data = (await res.json()) as { success: boolean };
  return data.success === true;
}

/* ---------- admin ---------- */

async function listAll(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT m.*, (SELECT json_group_array(json_object('key', p.key, 'caption', p.caption))
                    FROM photos p WHERE p.memory_id = m.id) AS photos
       FROM memories m ORDER BY CASE m.status WHEN 'pending' THEN 0 ELSE 1 END, m.created_at DESC LIMIT 500`
  ).all();
  return json(results.map((r: any) => ({ ...r, photos: JSON.parse(r.photos || "[]") })));
}

async function review(id: string, req: Request, env: Env, reviewer: string) {
  const input = (await req.json()) as { status?: string; body?: string; name?: string };
  if (input.status && !["approved", "hidden", "pending"].includes(input.status))
    return json({ error: "Unknown status" }, 400);
  await env.DB.prepare(
    `UPDATE memories SET status = COALESCE(?, status), body = COALESCE(?, body), name = COALESCE(?, name),
            reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).bind(
    input.status ?? null,
    input.body?.slice(0, MAX_BODY_CHARS) ?? null,
    input.name?.slice(0, 120) ?? null,
    reviewer,
    id
  ).run();
  return json({ ok: true });
}

/**
 * Cloudflare Access puts a signed JWT on every request it lets through.
 * We verify it ourselves so the admin API is safe even if someone reaches the Worker directly.
 */
async function requireAdmin(req: Request, env: Env): Promise<string | null> {
  if (env.DEV_ADMIN === "1") return "local-dev";
  if (env.ADMIN_PASSWORD) return passwordOk(req, env.ADMIN_PASSWORD) ? "family" : null;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;

  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const header = JSON.parse(b64urlText(h));
  const payload = JSON.parse(b64urlText(p));

  const certs = (await (
    await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } } as RequestInit)
  ).json()) as { keys: JsonWebKey[] & { kid: string }[] };
  const jwk = certs.keys.find((k: any) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD) || payload.exp < now) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  return payload.email || "family";
}

function b64urlBytes(s: string) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const b64urlText = (s: string) => new TextDecoder().decode(b64urlBytes(s));

function askForPassword(env: Env) {
  if (!env.ADMIN_PASSWORD && !env.ACCESS_AUD) return new Response("Admin is not set up yet.", { status: 403 });
  return new Response("Password required.", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Margaret memorial admin", charset="UTF-8"', "cache-control": "no-store" },
  });
}

function passwordOk(req: Request, expected: string) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  let given = "";
  try {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), (c) => c.charCodeAt(0)));
    given = decoded.slice(decoded.indexOf(":") + 1);
  } catch {
    return false;
  }
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

/* ---------- family password gate ---------- */

const GATE_COOKIE = "mm_pass";

async function passToken(env: Env) {
  const data = new TextEncoder().encode("margaret.memorial|" + (env.SITE_PASSWORD || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hasPass(req: Request, env: Env) {
  if (!env.SITE_PASSWORD) return false;
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp("(?:^|;\\s*)" + GATE_COOKIE + "=([a-f0-9]{64})"));
  return !!m && m[1] === (await passToken(env));
}

async function enter(req: Request, env: Env) {
  const form = await req.formData().catch(() => null);
  const given = clean(form?.get("password"), 200).toLowerCase();
  if (!env.SITE_PASSWORD || given !== env.SITE_PASSWORD.toLowerCase()) return gatePage(true, 401);
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "set-cookie": `${GATE_COOKIE}=${await passToken(env)}; Path=/; Max-Age=${60 * 60 * 24 * 90}; HttpOnly; Secure; SameSite=Lax`,
      "cache-control": "no-store",
    },
  });
}

function gatePage(wrong: boolean, status: number) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#f8f3ee"><title>Margaret</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;1,6..96,400&family=EB+Garamond:ital,wght@0,400;1,400&family=Jost:wght@500&display=swap">
<style>
*{box-sizing:border-box}html,body{height:100%}body{margin:0;display:grid;place-items:center;background:#f8f3ee;color:#241c25;font:400 1.2rem/1.6 "EB Garamond",Georgia,serif;padding:24px}
main{display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px;width:100%;max-width:22rem;animation:rise .9s cubic-bezier(.2,.7,.2,1) both}
.lady{font:italic 400 clamp(1.3rem,2.4vw,1.8rem)/1 "Bodoni Moda",Georgia,serif;color:#7a6180;margin-bottom:-10px}
h1{margin:0;font:400 clamp(3.4rem,14vw,6rem)/.9 "Bodoni Moda",Georgia,serif;letter-spacing:-.02em;font-weight:400}
p{margin:12px 0 4px;color:#5a4f5b}
form{display:flex;flex-direction:column;gap:12px;width:100%;margin-top:8px}
input{font:inherit;text-align:center;padding:12px 14px;border:1px solid #e4dad5;background:#fdfbf9;color:inherit;border-radius:2px}
input:focus{outline:2px solid #7a6180;outline-offset:2px}
button{font:500 .78rem/1 Jost,system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;padding:15px;border:0;background:#241c25;color:#f8f3ee;border-radius:2px;cursor:pointer}
.err{color:#b0522e;font-style:italic;margin:0}
@keyframes rise{from{opacity:0;transform:translateY(16px)}}
@media (prefers-reduced-motion:reduce){main{animation:none}}
</style></head><body><main>
<span class="lady">Lady</span><h1>Margaret</h1>
<p>This page is for family and friends for now.</p>
<form method="post" action="/__enter"><label for="pw" style="position:absolute;left:-9999px">Password</label>
<input id="pw" name="password" type="password" placeholder="Password" autocomplete="current-password" autofocus required>
${wrong ? '<p class="err">That isn’t it. Try again.</p>' : ""}
<button type="submit">Enter</button></form></main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
