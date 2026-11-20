// Supabase Edge Function — МойСклад: остатки по складам и себестоимость.
// POST { token } → { v, updatedAt, stores, items, errors, dbg }
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
    const { token } = await req.json();
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
    dbg.allSample = all.slice(0, 3);

    let by: Any[] = [];
    try { by = await getAll("/report/stock/bystore", "groupBy=variant&stockMode=all"); }
    catch (e) { try { by = await getAll("/report/stock/bystore", "stockMode=all"); } catch (e2) { errors.push(String((e2 as Error).message || e2)); } }
    dbg.byStoreSample = by.slice(0, 2);

    const items = new Map<string, Any>();
    for (const r of all) {
      const id = idOf(r.meta && r.meta.href);
      if (!id) continue;
      items.set(id, {
        id, name: r.name || "", code: r.code || "", article: r.article || "",
        stock: num(r.stock), reserve: num(r.reserve), inTransit: num(r.inTransit),
        cost: num(r.price) / 100, salePrice: num(r.salePrice) / 100, byStore: {},
      });
    }
    const stores = new Set<string>();
    for (const r of by) {
      const id = idOf(r.meta && r.meta.href);
      if (!id) continue;
      let it = items.get(id);
      if (!it) { it = { id, name: r.name || "", code: r.code || "", article: r.article || "", stock: 0, reserve: 0, inTransit: 0, cost: 0, salePrice: 0, byStore: {} }; items.set(id, it); }
      for (const s of (r.stockByStore || [])) {
        const nm = String(s.name || idOf(s.meta && s.meta.href));
        stores.add(nm);
        it.byStore[nm] = { stock: num(s.stock), reserve: num(s.reserve) };
      }
    }
    const list = [...items.values()].filter((x) => x.stock || x.reserve || x.inTransit || Object.keys(x.byStore).length);
    return json({ v: 1, updatedAt: new Date().toISOString(), stores: [...stores], count: list.length, items: list, errors, dbg });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
