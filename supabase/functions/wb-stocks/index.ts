// Supabase Edge Function — товары «в пути» (WB Seller Analytics API, отчёт по остаткам).
// POST { apiKey } → { v: 2, updatedAt, items: { "артикул": {to, from, toSum, fromSum, st, stSum}, "nmId": {...} } }
// st / stSum — текущие остатки на складах WB (stockCount / stockSum).
// to / from — штуки «в пути к клиенту» / «в пути от клиента» (toClientCount / fromClientCount).
// Суммы = штуки × цена товара (среднее currentPrice.minPrice/maxPrice) — оценка по цене продавца.
// WB: POST https://seller-analytics-api.wildberries.ru/api/v2/stocks-report/products/products (токен с доступом к «Аналитике»).
// Старый метод statistics /supplier/stocks WB отключил.
// Деплой: supabase functions deploy wb-stocks --no-verify-jwt

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { apiKey } = await req.json();
    if (!apiKey) return json({ error: "нужен apiKey" }, 400);
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // по Москве
    const items: Record<string, { to: number; from: number; toSum: number; fromSum: number; st: number; stSum: number }> = {};
    const LIMIT = 1000;
    for (let offset = 0, page = 0; page < 10; page++, offset += LIMIT) {
      const r = await fetch("https://seller-analytics-api.wildberries.ru/api/v2/stocks-report/products/products", {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPeriod: { start: today, end: today },
          stockType: "wb", // только склады WB (как в кабинете «Склад WB»); «mp» — свой склад продавца, он уже в МойСклад
          skipDeletedNm: true,
          orderBy: { field: "stockCount", mode: "desc" },
          availabilityFilters: [],
          limit: LIMIT,
          offset,
        }),
      });
      if (!r.ok) return json({ error: `WB ${r.status}: ${(await r.text()).slice(0, 300)}` }, 502);
      const j: Any = await r.json();
      const rows: Any[] = Array.isArray(j?.data?.items) ? j.data.items : Array.isArray(j?.data) ? j.data : [];
      for (const x of rows) {
        const m = x.metrics || {};
        const to = Number(m.toClientCount) || 0, from = Number(m.fromClientCount) || 0;
        const st = Number(m.stockCount) || 0;
        if (!to && !from && !st) continue;
        const cp = m.currentPrice || {};
        const price = ((Number(cp.minPrice) || 0) + (Number(cp.maxPrice) || Number(cp.minPrice) || 0)) / 2;
        const stSum = Number(m.stockSum) || Math.round(st * price);
        for (const key of [x.vendorCode, x.nmID]) {
          if (!key) continue;
          const k = String(key);
          const o = items[k] || (items[k] = { to: 0, from: 0, toSum: 0, fromSum: 0, st: 0, stSum: 0 });
          o.to += to; o.from += from; o.toSum += Math.round(to * price); o.fromSum += Math.round(from * price); o.st += st; o.stSum += Math.round(stSum);
        }
      }
      if (rows.length < LIMIT) break;
    }
    return json({ v: 2, updatedAt: new Date().toISOString(), items });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
