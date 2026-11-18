// Supabase Edge Function — прокси к WB Statistics API (продажи/выкупы и возвраты).
// POST { apiKey, dateFrom: "YYYY-MM-DD" } → { "артикул:YYYY-MM-DD": [выкупов, возвратов], "nmId:YYYY-MM-DD": [...] }
// WB: GET /api/v1/supplier/sales?dateFrom=… (flag=0: всё, что менялось с даты). Лимит — 1 запрос в минуту.
// saleID на «S» — выкуп, на «R» — возврат. Деплой: supabase functions deploy wb-sales --no-verify-jwt

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
    const r = await fetch(`https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${dateFrom}&flag=0`, {
      headers: { Authorization: apiKey },
    });
    if (!r.ok) return json({ error: `WB API ${r.status}: ${await r.text()}` }, r.status);
    const rows = await r.json();
    const out: Record<string, [number, number]> = {};
    for (const x of Array.isArray(rows) ? rows : []) {
      const id = String(x.saleID || "");
      const isS = id.startsWith("S"), isR = id.startsWith("R");
      if (!isS && !isR) continue;
      const date = String(x.date || "").slice(0, 10);
      if (!date || date < dateFrom) continue; // дни до dateFrom пришли неполными
      for (const key of [x.supplierArticle, x.nmId]) {
        if (!key) continue;
        const k = `${key}:${date}`;
        if (!out[k]) out[k] = [0, 0];
        out[k][isS ? 0 : 1]++;
      }
    }
    return json(out);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
