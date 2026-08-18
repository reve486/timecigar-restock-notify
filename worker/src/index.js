const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return origin && origin === env.APP_ORIGIN ? origin : env.APP_ORIGIN;
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", allowedOrigin(request, env));
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(response.body, { status: response.status, headers });
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function absoluteUrl(request, path) {
  return new URL(path, request.url).toString();
}

async function resend(env, message) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, ...message }),
  });
  if (!response.ok) {
    throw new Error(`Resend returned ${response.status}`);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

async function subscribe(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  if (body.website || !validEmail(email)) return json({ error: "Invalid email." }, 400);

  const existing = await env.DB.prepare("SELECT status FROM subscribers WHERE email = ?1").bind(email).first();
  if (existing?.status === "active") return json({ ok: true }, 202);

  const token = crypto.randomUUID().replaceAll("-", "");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO subscribers (email, status, token, created_at, confirmed_at)
     VALUES (?1, 'pending', ?2, ?3, NULL)
     ON CONFLICT(email) DO UPDATE SET status = 'pending', token = excluded.token, created_at = excluded.created_at, confirmed_at = NULL`
  ).bind(email, token, now).run();

  const confirmUrl = absoluteUrl(request, `/api/confirm?token=${encodeURIComponent(token)}`);
  await resend(env, {
    to: [email],
    subject: "确认订阅：美纽杜雪茄管补货提醒",
    html: `<p>请确认订阅“美纽杜 雪茄管”的补货提醒。</p><p><a href="${confirmUrl}">确认订阅</a></p><p>若不是你本人订阅，请忽略此邮件。</p>`,
  });
  return json({ ok: true }, 202);
}

async function confirm(request, env) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length !== 32) return new Response("确认链接无效。", { status: 400 });
  const result = await env.DB.prepare(
    "UPDATE subscribers SET status = 'active', confirmed_at = ?1 WHERE token = ?2 AND status = 'pending'"
  ).bind(new Date().toISOString(), token).run();
  const page = result.meta.changes
    ? "订阅已确认。补货时将发送提醒邮件。"
    : "此确认链接已失效或已使用。";
  return new Response(`<!doctype html><meta charset="utf-8"><title>订阅确认</title><p>${page}</p>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function unsubscribe(request, env) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length !== 32) return new Response("取消订阅链接无效。", { status: 400 });
  await env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed' WHERE token = ?1").bind(token).run();
  return new Response("已取消订阅。", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function authenticated(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization === `Bearer ${env.MONITOR_TOKEN}`;
}

async function monitor(request, env) {
  if (!authenticated(request, env)) return json({ error: "Unauthorized" }, 401);
  let item;
  try { item = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { productKey, productName, productUrl, status, detail } = item;
  if (!productKey || !productName || !productUrl || !["in_stock", "out_of_stock", "unknown"].includes(status)) {
    return json({ error: "Invalid status payload" }, 400);
  }

  const previous = await env.DB.prepare("SELECT status FROM product_status WHERE product_key = ?1").bind(productKey).first();
  const now = new Date().toISOString();
  const persist = () => env.DB.prepare(
    `INSERT INTO product_status (product_key, status, checked_at, detail)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(product_key) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at, detail = excluded.detail`
  ).bind(productKey, status, now, String(detail || "")).run();

  if (status !== "in_stock" || previous?.status === "in_stock") {
    await persist();
    return json({ ok: true, notified: false });
  }

  const rows = await env.DB.prepare("SELECT email, token FROM subscribers WHERE status = 'active'").all();
  const subscribers = rows.results || [];
  for (const subscriber of subscribers) {
    const name = escapeHtml(productName);
    const url = escapeHtml(productUrl);
    const unsubscribeUrl = absoluteUrl(request, `/api/unsubscribe?token=${encodeURIComponent(subscriber.token)}`);
    await resend(env, {
      to: [subscriber.email],
      subject: `[补货提醒] ${productName}`,
      html: `<p><strong>${name}</strong> 可能已经补货。</p><p><a href="${url}">立即查看商品</a></p><p style="color:#666;font-size:12px">库存以商店页面为准。<br><a href="${unsubscribeUrl}">取消订阅</a></p>`,
    });
  }
  await persist();
  return json({ ok: true, notified: true, subscriberCount: subscribers.length });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), request, env);
    const url = new URL(request.url);
    try {
      let response;
      if (request.method === "GET" && url.pathname === "/api/health") response = json({ ok: true });
      else if (request.method === "POST" && url.pathname === "/api/subscribe") response = await subscribe(request, env);
      else if (request.method === "GET" && url.pathname === "/api/confirm") response = await confirm(request, env);
      else if (request.method === "GET" && url.pathname === "/api/unsubscribe") response = await unsubscribe(request, env);
      else if (request.method === "POST" && url.pathname === "/api/monitor") response = await monitor(request, env);
      else response = json({ error: "Not found" }, 404);
      return withCors(response, request, env);
    } catch (error) {
      console.error(error);
      return withCors(json({ error: "Service unavailable" }, 503), request, env);
    }
  },
};
