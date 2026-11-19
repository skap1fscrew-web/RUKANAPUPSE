// Supabase Edge Function — Озон: заказы по дням, «в пути», остатки (Seller API).
// POST { clientId, apiKey, days } → { v, updatedAt, orders, way, stock, errors, retStatuses }
// Деплой: supabase functions deploy oz-sum --no-verify-jwt

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
const dayMsk = (iso: string) => new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(0, 10);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { clientId, apiKey, days } = await req.json();
    if (!clientId || !apiKey) return json({ error: "нужны Client-Id и Api-Key Озона" }, 400);
    const span = Math.min(Math.max(Number(days) || 30, 1), 62);
    const H = { "Client-Id": String(clientId).trim(), "Api-Key": String(apiKey).trim(), "Content-Type": "application/json" };
    const errors: string[] = [];
    const post = async (path: string, body: unknown): Promise<Any> => {
      const r = await fetch("https://api-seller.ozon.ru" + path, { method: "POST", headers: H, body: JSON.stringify(body) });
      const t = await r.text(); let j: Any = null; try { j = JSON.parse(t); } catch { /* */ }
      if (!r.ok) throw new Error(`${path} ${r.status}: ${String((j && (j.message || j.error)) || t).slice(0, 140)}`);
      return j;
    };
    const nowIso = new Date().toISOString();
    const sinceOf = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

    // ---- отправления (FBO + FBS) ----
    const listFbo = async (since: string, status?: string): Promise<Any[]> => {
      const out: Any[] = [];
      for (const path of ["/v2/posting/fbo/list", "/v3/posting/fbo/list"]) {
        try {
          out.length = 0;
          for (let off = 0, i = 0; i < 20; i++, off += 1000) {
            const filter: Any = { since, to: nowIso }; if (status) filter.status = status;
            const j = await post(path, { dir: "DESC", filter, limit: 1000, offset: off, translit: false, with: { analytics_data: false, financial_data: false } });
            const arr: Any[] = Array.isArray(j?.result) ? j.result : (j?.result?.postings || []);
            out.push(...arr);
            if (arr.length < 1000) break;
          }
          return out;
        } catch (e) { errors.push((e as Error).message); }
      }
      return out;
    };
    const listFbs = async (since: string, status?: string): Promise<Any[]> => {
      const out: Any[] = [];
      try {
        for (let off = 0, i = 0; i < 20; i++, off += 1000) {
          const filter: Any = { since, to: nowIso }; if (status) filter.status = status;
          const j = await post("/v3/posting/fbs/list", { dir: "DESC", filter, limit: 1000, offset: off, with: {} });
          const arr: Any[] = j?.result?.postings || [];
          out.push(...arr);
          if (arr.length < 1000 || !j?.result?.has_next) break;
        }
      } catch (e) { errors.push((e as Error).message); }
      return out;
    };

    const fbo = await listFbo(sinceOf(span));
    const fbs = await listFbs(sinceOf(span));
    const orders: Record<string, { n: number; sum: number; p: Record<string, number> }> = {};
    const priceBy: Record<string, number> = {}; // offer_id / sku → цена
    const seen = new Set<string>();
    for (const po of [...fbo, ...fbs]) {
      const pn = String(po.posting_number || po.order_id || "");
      if (pn && seen.has(pn)) continue; seen.add(pn);
      const created = po.created_at || po.in_process_at || po.order_date;
      if (!created) continue;
      for (const p of (po.products || [])) {
        const q = num(p.quantity) || 1, price = num(p.price);
        if (p.offer_id) priceBy[String(p.offer_id)] = price || priceBy[String(p.offer_id)] || 0;
        if (p.sku) priceBy[String(p.sku)] = price || priceBy[String(p.sku)] || 0;
        if (String(po.status) === "cancelled") continue;
        const d = dayMsk(created);
        const o = orders[d] || (orders[d] = { n: 0, sum: 0, p: {} });
        o.n += q; o.sum += price * q;
        const nm = String(p.name || p.offer_id || p.sku || "Товар").slice(0, 80);
        o.p[nm] = (o.p[nm] || 0) + q;
      }
    }

    // ---- в пути к покупателю ----
    const way = { to: { n: 0, sum: 0, items: {} as Record<string, { n: number; sum: number }> }, from: { n: 0, sum: 0, items: {} as Record<string, { n: number; sum: number }> } };
    const addWay = (k: "to" | "from", name: string, q: number, sum: number) => {
      const w = way[k]; w.n += q; w.sum += sum;
      const it = w.items[name] || (w.items[name] = { n: 0, sum: 0 }); it.n += q; it.sum += sum;
    };
    const delFbo = await listFbo(sinceOf(90), "delivering");
    const delFbs = await listFbs(sinceOf(90), "delivering");
    const seen2 = new Set<string>();
    for (const po of [...delFbo, ...delFbs]) {
      const pn = String(po.posting_number || ""); if (pn && seen2.has(pn)) continue; seen2.add(pn);
      if (String(po.status) !== "delivering") continue;
      for (const p of (po.products || [])) { const q = num(p.quantity) || 1; addWay("to", String(p.name || p.offer_id || "Товар").slice(0, 80), q, num(p.price) * q); }
    }

    // ---- в пути от покупателя (возвраты) ----
    const retStatuses: Record<string, number> = {};
    try {
      let last = 0;
      for (let i = 0; i < 10; i++) {
        const j = await post("/v1/returns/list", { filter: {}, limit: 500, last_id: last });
        const arr: Any[] = j?.returns || [];
        for (const r of arr) {
          const st = String(r?.visual?.status?.display_name || r?.visual?.status?.sys_name || "?");
          retStatuses[st] = (retStatuses[st] || 0) + 1;
          if (/в пути|едет|везут|возвращается|перемещ|доставляется на склад/i.test(st) && !/получен|выдан|утилиз|принят|на складе/i.test(st)) {
            const pr = r.product || {}; const q = num(pr.quantity) || 1;
            addWay("from", String(pr.name || pr.offer_id || "Товар").slice(0, 80), q, num(pr.price?.price ?? pr.price) * q);
          }
          last = Math.max(last, num(r.id));
        }
        if (!j?.has_next || !arr.length) break;
      }
    } catch (e) { errors.push((e as Error).message); }

    // ---- остатки на складах Озон ----
    const stock = { n: 0, sum: 0, byWh: {} as Record<string, number>, items: {} as Record<string, { n: number; sum: number }> };
    try {
      for (let off = 0, i = 0; i < 30; i++, off += 1000) {
        const j = await post("/v2/analytics/stock_on_warehouses", { limit: 1000, offset: off, warehouse_type: "ALL" });
        const rows: Any[] = j?.result?.rows || [];
        for (const r of rows) {
          const q = num(r.free_to_sell_amount); if (!q) continue;
          const price = priceBy[String(r.item_code)] || priceBy[String(r.sku)] || 0;
          stock.n += q; stock.sum += price * q;
          const wh = String(r.warehouse_name || "Склад"); stock.byWh[wh] = (stock.byWh[wh] || 0) + q;
          const nm = String(r.item_name || r.item_code || "Товар").slice(0, 80);
          const it = stock.items[nm] || (stock.items[nm] = { n: 0, sum: 0 }); it.n += q; it.sum += price * q;
        }
        if (rows.length < 1000) break;
      }
    } catch (e) { errors.push((e as Error).message); }

    // если вообще ничего не получилось — отдаём ошибку, чтобы было видно причину
    const nothing = !Object.keys(orders).length && !way.to.n && !stock.n;
    if (nothing && errors.length && errors.every((e) => /\b(401|403)\b/.test(e))) return json({ error: "Озон отклонил ключ: " + errors[0] }, 502);
    return json({ v: 1, updatedAt: new Date().toISOString(), span, orders, way, stock, errors, retStatuses });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
