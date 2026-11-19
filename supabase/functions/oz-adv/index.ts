// Supabase Edge Function — Озон Performance (реклама): расход по дням.
// POST { clientId, clientSecret, days } → { v, updatedAt, ad: { "YYYY-MM-DD": ₽ }, errors }
// Деплой: supabase functions deploy oz-adv --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
type Any = any;
const num = (x: unknown) => { const n = Number(String(x ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const BASE = "https://api-performance.ozon.ru";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { clientId, clientSecret, days } = await req.json();
    if (!clientId || !clientSecret) return json({ error: "нужны Client-Id и Client-Secret Performance API" }, 400);
    const span = Math.min(Math.max(Number(days) || 30, 1), 60);
    const errors: string[] = [];
    const tr = await fetch(BASE + "/api/client/token", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: String(clientId).trim(), client_secret: String(clientSecret).trim(), grant_type: "client_credentials" }),
    });
    const tt = await tr.text(); let tj: Any = null; try { tj = JSON.parse(tt); } catch { /* */ }
    if (!tr.ok || !tj?.access_token) return json({ error: `Озон Performance: токен не выдан (${tr.status}) ${String(tj?.error_description || tj?.message || tt).slice(0, 120)}` }, 502);
    const H = { Authorization: "Bearer " + tj.access_token, Accept: "application/json" };
    const get = async (path: string) => {
      const r = await fetch(BASE + path, { headers: H }); const t = await r.text(); let j: Any = null; try { j = JSON.parse(t); } catch { /* */ }
      if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status}: ${String(j?.message || j?.error || t).slice(0, 120)}`);
      return j;
    };
    const cj = await get("/api/client/campaign");
    const ids: string[] = (cj?.list || []).map((c: Any) => String(c.id)).filter(Boolean);
    if (!ids.length) return json({ v: 1, updatedAt: new Date().toISOString(), ad: {}, errors: ["кампаний нет"] });
    const to = new Date(), from = new Date(Date.now() - span * 864e5);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const ad: Record<string, number> = {};
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      try {
        const q = chunk.map((x) => "campaignIds=" + x).join("&");
        const j = await get(`/api/client/statistics/daily/json?${q}&dateFrom=${ymd(from)}&dateTo=${ymd(to)}`);
        const rows: Any[] = Array.isArray(j) ? j : (j?.rows || j?.list || []);
        for (const r of rows) {
          const d = String(r.date || r.day || "").slice(0, 10); if (!d) continue;
          ad[d] = (ad[d] || 0) + num(r.moneySpent ?? r.spent ?? r.expense);
        }
      } catch (e) { errors.push((e as Error).message); }
    }
    if (!Object.keys(ad).length && errors.length) return json({ error: "Озон Performance: " + errors[0] }, 502);
    return json({ v: 1, updatedAt: new Date().toISOString(), ad, errors });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
