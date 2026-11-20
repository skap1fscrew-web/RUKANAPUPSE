// Supabase Edge Function — МойСклад: остатки по складам и себестоимость.
// POST { token, codes?: string[], store?: string } → { v, store, updatedAt, stores, count, items, errors, dbg }
//   items: [{ id, name, code, article, stock, reserve, inTransit, cost, salePrice, byStore: { склад: { stock, reserve } } }]
// Токен — «Настройки → Безопасность → Токены» в МойСклад. Деньги МойСклад отдаёт в копейках, здесь рубли.

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
const num = (x: unknown) => { const n = Number(x); return isFinite(n) ? n : 0; };
const idOf = (href: unknown) => String(href || "").split("?")[0].split("/").pop() || "";
const BASE = "https://api.moysklad.ru/api/remap/1.2";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const token = body && body.token;
    if (!token) return json({ error: "нужен токен МойСклад" }, 400);
    const H = { Authorization: "Bearer " + String(token).trim(), "Accept-Encoding": "gzip", Accept: "application/json;charset=utf-8" };
    const errors: string[] = [];
    const dbg: Record<string, unknown> = {};

    const getAll = async (path: string, query: string): Promise<Any[]> => {
      const out: Any[] = [];
      let offset = 0;
      for (let page = 0; page < 30; page++) {
        const r = await fetch(`${BASE}${path}?${query}&limit=1000&offset=${offset}`, { headers: H });
        const t = await r.text(); let j: Any = null; try { j = JSON.parse(t); } catch { /* */ }
        if (!r.ok) {
          const msg = j && j.errors && j.errors[0] ? j.errors[0].error : t.slice(0, 140);
          throw new Error(`${path} ${r.status}: ${msg}`);
        }
        const rows: Any[] = (j && j.rows) || [];
        out.push(...rows);
        const size = num(j && j.meta && j.meta.size);
        offset += rows.length;
        if (!rows.length || offset >= size) break;
      }
      return out;
    };

    let all: Any[] = [];
    try { all = await getAll("/report/stock/all", "groupBy=variant&stockMode=all"); }
    catch (e) { errors.push(String((e as Error).message || e)); try { all = await getAll("/report/stock/all", "stockMode=all"); } catch (e2) { errors.push(String((e2 as Error).message || e2)); } }

    let by: Any[] = [];
    try { by = await getAll("/report/stock/bystore", "groupBy=variant&stockMode=all"); }
    catch (e) { try { by = await getAll("/report/stock/bystore", "stockMode=all"); } catch (e2) { errors.push(String((e2 as Error).message || e2)); } }

    const STORE = String((body && body.store) || "НАШ СКЛАД / ОДЕЖДА");
    const want = Array.isArray(body && body.codes) && body.codes.length ? new Set<string>(body.codes.map((c: unknown) => String(c).trim())) : null;
    const baseOf = (c: string) => String(c || "").split("_")[0].trim();

    const items = new Map<string, Any>();
    for (const r of all) {
      const id = idOf(r.meta && r.meta.href);
      if (!id) continue;
      items.set(id, {
        id, name: r.name || "", code: r.code || "", article: r.article || "",
        stock: 0, reserve: 0, inTransit: 0,
        cost: num(r.price) / 100, costSrc: "report", salePrice: num(r.salePrice) / 100, byStore: {},
      });
    }
    const stores = new Set<string>();
    for (const r of by) {
      const id = idOf(r.meta && r.meta.href);
      if (!id) continue;
      let it = items.get(id);
      if (!it) { it = { id, name: r.name || "", code: r.code || "", article: r.article || "", stock: 0, reserve: 0, inTransit: 0, cost: 0, costSrc: "report", salePrice: 0, byStore: {} }; items.set(id, it); }
      for (const st of (r.stockByStore || [])) {
        const nm = String(st.name || idOf(st.meta && st.meta.href));
        stores.add(nm);
        if (nm === STORE) { it.stock = num(st.stock); it.reserve = num(st.reserve); it.inTransit = num(st.inTransit); it.byStore[nm] = { stock: it.stock, reserve: it.reserve }; }
      }
    }
    // только позиции нашего склада и только товары из сервиса
    const list = [...items.values()].filter((x) => x.byStore[STORE] && (!want || want.has(baseOf(x.code))));

    // себестоимость — цена в последней приёмке (supply) по коду модификации / товара
    const needCodes = new Set<string>();
    for (const x of list) { needCodes.add(x.code); needCodes.add(baseOf(x.code)); }
    const costs: Record<string, { p: number; d: string }> = {};
    try {
      for (let page = 0; page < 12; page++) {
        const r = await fetch(`${BASE}/entity/supply?order=moment,desc&limit=100&offset=${page * 100}&expand=positions.assortment`, { headers: H });
        const t = await r.text(); let j: Any = null; try { j = JSON.parse(t); } catch { /* */ }
        if (!r.ok) { errors.push("supply " + r.status + ": " + (j && j.errors && j.errors[0] ? j.errors[0].error : t.slice(0, 120))); break; }
        const rows: Any[] = (j && j.rows) || [];
        for (const sp of rows) {
          for (const pos of ((sp.positions && sp.positions.rows) || [])) {
            const c = String((pos.assortment && pos.assortment.code) || "").trim();
            if (c && needCodes.has(c) && !costs[c] && num(pos.price) > 0) costs[c] = { p: num(pos.price) / 100, d: String(sp.moment || "").slice(0, 10) };
          }
        }
        if (!rows.length || rows.length < 100) break;
        if (list.every((x) => costs[x.code] || costs[baseOf(x.code)])) break;
      }
    } catch (e) { errors.push("supply: " + String((e as Error).message || e)); }
    for (const x of list) {
      const c = costs[x.code] || costs[baseOf(x.code)];
      if (c) { x.cost = c.p; x.costSrc = "supply"; x.costAt = c.d; }
    }
    return json({ v: 2, store: STORE, updatedAt: new Date().toISOString(), stores: [...stores], count: list.length, items: list, errors, dbg });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
