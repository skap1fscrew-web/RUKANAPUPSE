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
// цена бывает числом, строкой или объектом { amount, currency }
const pr = (x: Any) => num(x && typeof x === "object" ? (x.amount ?? x.price ?? x.value) : x);
// артикул товара из offer_id: «06186_L» → «06186»
const codeOf = (offer: unknown) => String(offer ?? "").trim().split("_")[0];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { clientId, apiKey, days } = await req.json();
    if (!clientId || !apiKey) return json({ error: "нужны Client-Id и Api-Key Озона" }, 400);
    const span = Math.min(Math.max(Number(days) || 30, 1), 62);
    const H = { "Client-Id": String(clientId).trim(), "Api-Key": String(apiKey).trim(), "Content-Type": "application/json" };
    const errors: string[] = [];
    const notes: string[] = [];
    const dbg: Record<string, unknown> = {};
    const post = async (path: string, body: unknown): Promise<Any> => {
      const r = await fetch("https://api-seller.ozon.ru" + path, { method: "POST", headers: H, body: JSON.stringify(body) });
      const t = await r.text(); let j: Any = null; try { j = JSON.parse(t); } catch { /* */ }
      if (!r.ok) throw new Error(`${path} ${r.status}: ${String((j && (j.message || j.error)) || t).slice(0, 140)}`);
      return j;
    };
    const nowIso = new Date().toISOString();
    const sinceOf = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

    // ---- отправления FBO: v3 с курсором (за 90 дней одним списком) ----
    const fbo: Any[] = [];
    try {
      let cursor = "";
      for (let i = 0; i < 150; i++) {
        const body: Any = { dir: "DESC", filter: { since: sinceOf(90), to: nowIso }, limit: 100, with: { analytics_data: false, financial_data: false } };
        if (cursor) body.cursor = cursor;
        const j = await post("/v3/posting/fbo/list", body);
        const arr: Any[] = j?.postings || j?.result?.postings || (Array.isArray(j?.result) ? j.result : []);
        fbo.push(...arr);
        cursor = j?.cursor || j?.result?.cursor || "";
        if (!(j?.has_next ?? j?.result?.has_next) || !cursor || !arr.length) break;
      }
    } catch (e) { errors.push((e as Error).message); }
    dbg.fboTotal = fbo.length;

    type Bag = { n: number; sum: number; items: Record<string, { n: number; sum: number }>; codes: Record<string, number> };
    const bag = (): Bag => ({ n: 0, sum: 0, items: {}, codes: {} });
    const orders: Record<string, { n: number; sum: number; p: Record<string, number> }> = {};
    const priceBy: Record<string, number> = {};
    const way = { to: bag(), from: bag() };
    const addTo = (w: Bag, name: string, offer: unknown, q: number, sum: number) => {
      w.n += q; w.sum += sum;
      const it = w.items[name] || (w.items[name] = { n: 0, sum: 0 }); it.n += q; it.sum += sum;
      const c = codeOf(offer); if (c) w.codes[c] = (w.codes[c] || 0) + q;
    };
    const spanFrom = dayMsk(sinceOf(span));
    const stCount: Record<string, number> = {};
    const seen = new Set<string>();
    for (const po of fbo) {
      const pn = String(po.posting_number || po.order_id || "");
      if (pn && seen.has(pn)) continue; seen.add(pn);
      const st = String(po.status || "?"); stCount[st] = (stCount[st] || 0) + 1;
      const created = po.created_at || po.in_process_at || po.order_date;
      for (const p of (po.products || [])) {
        const q = num(p.quantity) || 1, price = pr(p.price);
        if (p.offer_id) priceBy[String(p.offer_id)] = price || priceBy[String(p.offer_id)] || 0;
        if (p.sku) priceBy[String(p.sku)] = price || priceBy[String(p.sku)] || 0;
        if (st === "cancelled") continue;
        const nm = String(p.name || p.offer_id || p.sku || "Товар").slice(0, 80);
        if (st === "delivering") addTo(way.to, nm, p.offer_id, q, price * q);
        if (!created) continue;
        const d = dayMsk(created);
        if (d < spanFrom) continue;
        const o = orders[d] || (orders[d] = { n: 0, sum: 0, p: {} });
        o.n += q; o.sum += price * q;
        o.p[nm] = (o.p[nm] || 0) + q;
      }
    }
    dbg.statuses = stCount;

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
            const rp = r.product || {}; const q = num(rp.quantity) || 1;
            addTo(way.from, String(rp.name || rp.offer_id || "Товар").slice(0, 80), rp.offer_id, q, pr(rp.price) * q);
          }
          last = Math.max(last, num(r.id));
        }
        if (!j?.has_next || !arr.length) break;
      }
    } catch (e) { errors.push((e as Error).message); }

    // цены из каталога (для суммы остатков)
    try {
      let last = "";
      for (let i = 0; i < 20; i++) {
        const j = await post("/v5/product/info/prices", { filter: { visibility: "ALL" }, limit: 1000, cursor: last });
        const items: Any[] = j?.items || [];
        for (const it of items) { const p0 = pr(it?.price); if (p0 && it.offer_id && !priceBy[String(it.offer_id)]) priceBy[String(it.offer_id)] = p0; if (p0 && it.product_id) priceBy[String(it.product_id)] = priceBy[String(it.product_id)] || p0; }
        last = j?.cursor || "";
        if (!last || items.length < 1000) break;
      }
    } catch (e) { notes.push((e as Error).message); }

    // ---- остатки на складах Озон ----
    const stock = { ...bag(), byWh: {} as Record<string, number> };
    try {
      for (let off = 0, i = 0; i < 30; i++, off += 1000) {
        const j = await post("/v2/analytics/stock_on_warehouses", { limit: 1000, offset: off, warehouse_type: "ALL" });
        const rows: Any[] = j?.result?.rows || [];
        for (const r of rows) {
          const q = num(r.free_to_sell_amount); if (!q) continue;
          const price = priceBy[String(r.item_code)] || priceBy[String(r.sku)] || 0;
          const wh = String(r.warehouse_name || "Склад"); stock.byWh[wh] = (stock.byWh[wh] || 0) + q;
          addTo(stock, String(r.item_name || r.item_code || "Товар").slice(0, 80), r.item_code, q, price * q);
        }
        if (rows.length < 1000) break;
      }
    } catch (e) { errors.push((e as Error).message); }

    const nothing = !Object.keys(orders).length && !way.to.n && !stock.n;
    if (nothing && errors.length && errors.every((e) => /\b(401|403)\b/.test(e))) return json({ error: "Озон отклонил ключ: " + errors[0] }, 502);
    return json({ v: 2, updatedAt: new Date().toISOString(), span, orders, way, stock, errors, notes, dbg, retStatuses });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
