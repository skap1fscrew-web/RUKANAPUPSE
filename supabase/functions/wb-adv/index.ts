// Supabase Edge Function — прокси к WB Promotion API (внутренняя реклама)
// Два режима (POST, JSON):
//   { apiKey, action: "ids" }                      → { ids: [advertId, ...] }  (все кампании продавца)
//   { apiKey, ids: [≤50], from, to }               → { "nmId:YYYY-MM-DD": расход ₽, ... }  (период ≤ 31 день)
// Ключ WB — категория «Продвижение». Лимит WB на статистику: 3 запроса в минуту.
//
// Деплой: supabase functions deploy wb-adv --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

const BASE = "https://advert-api.wildberries.ru";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { apiKey, action, ids, from, to } = await req.json();
    if (!apiKey) return json({ error: "apiKey обязателен" }, 400);
    const headers = { Authorization: apiKey };

    // 1) список id всех кампаний
    if (action === "ids") {
      const r = await fetch(`${BASE}/adv/v1/promotion/count`, { headers });
      if (!r.ok) return json({ error: `WB API ${r.status}: ${await r.text()}` }, r.status);
      const data = await r.json();
      const out: number[] = [];
      for (const g of data.adverts || []) for (const a of g.advert_list || []) if (a.advertId) out.push(a.advertId);
      return json({ ids: out });
    }

    // 2) расход по nmId и дням для пачки кампаний
    if (!Array.isArray(ids) || !ids.length || !from || !to) return json({ error: "нужны ids, from, to" }, 400);
    const url = `${BASE}/adv/v3/fullstats?ids=${ids.slice(0, 50).join(",")}&beginDate=${from}&endDate=${to}`;
    const r = await fetch(url, { headers });
    if (!r.ok) return json({ error: `WB API ${r.status}: ${await r.text()}` }, r.status);
    const data = await r.json();

    const sums: Record<string, number> = {};
    for (const camp of Array.isArray(data) ? data : []) {
      for (const day of camp.days || []) {
        const date = String(day.date || "").slice(0, 10);
        if (!date) continue;
        for (const app of day.apps || []) {
          for (const nm of app.nms || app.nm || []) {
            const id = nm.nmId ?? nm.nmid;
            const sum = Number(nm.sum);
            if (!id || !isFinite(sum)) continue;
            const k = `${id}:${date}`;
            sums[k] = Math.round(((sums[k] || 0) + sum) * 100) / 100;
          }
        }
      }
    }
    return json(sums);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
