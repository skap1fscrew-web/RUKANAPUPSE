// Supabase Edge Function — сумма заказов по дням (WB Statistics API, заказы).
// POST { apiKey, dateFrom: "YYYY-MM-DD" } → { "артикул:YYYY-MM-DD": ₽, "nmId:YYYY-MM-DD": ₽,
//   "…:YYYY-MM-DD:f": ₽ (сумма finishedPrice — цена покупателя после СПП), "…:YYYY-MM-DD:n": число заказов }
// Сумма = priceWithDisc (цена с учётом скидки продавца, до СПП) по неотменённым заказам.
// WB: GET /api/v1/supplier/orders?dateFrom=…&flag=0. Лимит — 1 запрос в минуту.
// Деплой: supabase functions deploy wb-orders-sum --no-verify-jwt

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
    const { apiKey, dateFrom } = await req.json();
    if (!apiKey || !dateFrom) return json({ error: "нужны apiKey и dateFrom" }, 400);
    const r = await fetch(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${dateFrom}&flag=0`, {
      headers: { Authorization: apiKey },
    });
    if (!r.ok) return json({ error: `WB API ${r.status}: ${await r.text()}` }, r.status);
    const rows = await r.json();
    const out: Record<string, number> = {};
    for (const x of Array.isArray(rows) ? rows : []) {
      if (x.isCancel) continue;
      const date = String(x.date || "").slice(0, 10);
      if (!date || date < dateFrom) continue; // дни до dateFrom пришли неполными
      const sum = Number(x.priceWithDisc ?? x.finishedPrice);
      if (!isFinite(sum)) continue;
      const fin = Number(x.finishedPrice);
      for (const key of [x.supplierArticle, x.nmId]) {
        if (!key) continue;
        const k = `${key}:${date}`;
        out[k] = Math.round(((out[k] || 0) + sum) * 100) / 100;
        if (isFinite(fin)) out[k + ":f"] = Math.round(((out[k + ":f"] || 0) + fin) * 100) / 100;
        out[k + ":n"] = (out[k + ":n"] || 0) + 1;
      }
    }
    return json(out);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
