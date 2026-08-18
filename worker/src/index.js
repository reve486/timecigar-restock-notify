const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8" },
});

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  if (request.headers.get("Origin") === env.APP_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", env.APP_ORIGIN);
    headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Vary", "Origin");
  }
  return new Response(response.body, { status: response.status, headers });
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isMonitor(request, env) {
  return request.headers.get("Authorization") === `Bearer ${env.MONITOR_TOKEN}`;
}

async function subscribe(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "请求格式无效。" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const inviteCode = String(body.inviteCode || "").trim();
  if (body.website || !validEmail(email)) return json({ error: "请输入有效的邮箱地址。" }, 400);
  if (!env.SUBSCRIPTION_CODE || inviteCode !== env.SUBSCRIPTION_CODE) {
    return json({ error: "邀请码不正确。" }, 403);
  }

  const token = crypto.randomUUID().replaceAll("-", "");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO subscribers (email, status, token, created_at)
     VALUES (?1, 'active', ?2, ?3)
     ON CONFLICT(email) DO UPDATE SET status = 'active'`
  ).bind(email, token, now).run();
  return json({ ok: true }, 202);
}

async function listSubscribers(request, env) {
  if (!isMonitor(request, env)) return json({ error: "Unauthorized" }, 401);
  const rows = await env.DB.prepare(
    "SELECT email, token FROM subscribers WHERE status = 'active' ORDER BY created_at ASC LIMIT 50"
  ).all();
  const origin = new URL(request.url).origin;
  return json({
    subscribers: (rows.results || []).map((row) => ({
      email: row.email,
      unsubscribe_url: `${origin}/api/unsubscribe?token=${encodeURIComponent(row.token)}`,
    })),
  });
}

async function unsubscribe(request, env) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length !== 32) return new Response("取消订阅链接无效。", { status: 400 });
  await env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed' WHERE token = ?1").bind(token).run();
  return new Response("已取消订阅。", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), request, env);
    const path = new URL(request.url).pathname;
    try {
      let response;
      if (request.method === "GET" && path === "/api/health") response = json({ ok: true });
      else if (request.method === "POST" && path === "/api/subscribe") response = await subscribe(request, env);
      else if (request.method === "GET" && path === "/api/subscribers") response = await listSubscribers(request, env);
      else if (request.method === "GET" && path === "/api/unsubscribe") response = await unsubscribe(request, env);
      else response = json({ error: "Not found" }, 404);
      return withCors(response, request, env);
    } catch (error) {
      console.error(error);
      return withCors(json({ error: "服务暂时不可用。" }, 503), request, env);
    }
  },
};
