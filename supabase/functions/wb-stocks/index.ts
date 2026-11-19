// Supabase Edge Function — товары «в пути» (WB Statistics API, остатки).
// POST { apiKey } → { updatedAt, items: { "артикул": {to, from, toSum, fromSum}, "nmId": {...} } }
// to / from — штуки «в пути к клиенту» / «в пути от клиента»; суммы = штуки × Price × (1 − Discount/100) (цена продавца, до СПП).
// WB: GET /api/v1/supplier/stocks?dateFrom=2019-06-20. Лимит — 1 запрос в минуту.
// Деплой: supabase functions deploy wb-stocks --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { apiKey } = await req.json();
    if (!apiKey) return json({ error: "нужен apiKey" }, 400);
    const r = await fetch("https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2019-06-20", { headers: { Authorization: apiKey } });
    if (!r.ok) return json({ error: `WB API ${r.status}: ${await r.text()}` }, r.status);
    const rows = await r.json();
    const items: Record<string, { to: number; from: number; toSum: number; fromSum: number }> = {};
    for (const x of Array.isArray(rows) ? rows : []) {
      const to = Number(x.inWayToClient) || 0, from = Number(x.inWayFromClient) || 0;
      if (!to && !from) continue;
      const price = (Number(x.Price) || 0) * (1 - (Number(x.Discount) || 0) / 100);
      for (const key of [x.supplierArticle, x.nmId]) {
        if (!key) continue;
        const k = String(key);
        const o = items[k] || (items[k] = { to: 0, from: 0, toSum: 0, fromSum: 0 });
        o.to += to; o.from += from; o.toSum += Math.round(to * price); o.fromSum += Math.round(from * price);
      }
    }
    return json({ updatedAt: new Date().toISOString(), items });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
