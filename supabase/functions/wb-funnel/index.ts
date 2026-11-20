// Supabase Edge Function — заказы по товарам и дням из аналитики WB (воронка продаж) — те же цифры, что в кабинете.
// POST { apiKey, nmIds: number[], start: "YYYY-MM-DD", end: "YYYY-MM-DD" } (период ≤ 7 дней)
//   → { "nmId:YYYY-MM-DD": ₽ (orderSum), "артикул:YYYY-MM-DD": ₽, "…:n": заказов (orderCount) }
// WB: POST seller-analytics-api …/api/analytics/v3/sales-funnel/products/history (до 20 nmId за запрос, лимит 3 запроса в минуту).
// Деплой: supabase functions deploy wb-funnel --no-verify-jwt

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { apiKey, nmIds, start, end } = await req.json();
    if (!apiKey || !Array.isArray(nmIds) || !nmIds.length || !start || !end) return json({ error: "нужны apiKey, nmIds, start, end" }, 400);
    const ids = [...new Set(nmIds.map((n: unknown) => Number(n)).filter((n: number) => n > 0))];
    const out: Record<string, number> = {};
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      let rows: Any[] | null = null;
      for (let a = 0; a < 3 && !rows; a++) {
        const r = await fetch("https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products/history", {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ selectedPeriod: { start, end }, nmIds: chunk, skipDeletedNm: false, aggregationLevel: "day" }),
        });
        if (r.status === 429) { await sleep(21000); continue; }
        if (!r.ok) return json({ error: `WB ${r.status}: ${(await r.text()).slice(0, 300)}` }, 502);
        const j: Any = await r.json();
        rows = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
      }
      if (!rows) return json({ error: "WB 429: слишком много запросов" }, 429);
      for (const row of rows) {
        const p = row.product || {};
        for (const h of (row.history || [])) {
          const date = String(h.date || "").slice(0, 10);
          if (!date) continue;
          const sum = Number(h.orderSum) || 0, n = Number(h.orderCount) || 0;
          for (const key of [p.nmId, p.vendorCode]) {
            if (!key) continue;
            const k = `${key}:${date}`;
            out[k] = Math.round(((out[k] || 0) + sum) * 100) / 100;
            out[k + ":n"] = (out[k + ":n"] || 0) + n;
          }
        }
      }
      if (i + 20 < ids.length) await sleep(21000); // лимит 3 запроса в минуту
    }
    return json(out);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
