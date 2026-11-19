// Supabase Edge Function — рейтинг и число отзывов карточек WB (публичная карточка товара).
// POST { nmIds: [123, 456] } → { items: { "123": { r: 4.8, f: 1243 } }, via }
// Ключ WB не нужен. Адрес публичного API WB иногда меняется — пробуем несколько версий.
// Деплой: supabase functions deploy wb-rating --no-verify-jwt

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
    const { nmIds } = await req.json();
    const ids = (Array.isArray(nmIds) ? nmIds : []).map((x: unknown) => String(x).trim()).filter((x: string) => /^\d{5,}$/.test(x)).slice(0, 100);
    if (!ids.length) return json({ error: "нужны nmIds" }, 400);
    const q = ids.join(";");
    const urls = [
      `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&spp=30&lang=ru&nm=${q}`,
      `https://card.wb.ru/cards/v2/detail?appType=1&curr=rub&dest=-1257786&spp=30&lang=ru&nm=${q}`,
      `https://card.wb.ru/cards/detail?appType=1&curr=rub&dest=-1257786&spp=30&nm=${q}`,
    ];
    const errs: string[] = [];
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
        if (!r.ok) { errs.push(`${r.status}`); continue; }
        const j: Any = await r.json();
        const list: Any[] = j?.data?.products || j?.products || [];
        if (!list.length) { errs.push("пусто"); continue; }
        const items: Record<string, { r: number; f: number }> = {};
        for (const p of list) {
          const rating = Number(p.reviewRating ?? p.nmReviewRating ?? p.rating);
          const fb = Number(p.feedbacks ?? p.nmFeedbacks ?? 0);
          if (p.id && isFinite(rating)) items[String(p.id)] = { r: rating, f: isFinite(fb) ? fb : 0 };
        }
        if (Object.keys(items).length) return json({ items, via: u.split("/")[4] });
        errs.push("нет полей рейтинга");
      } catch (e) { errs.push((e as Error).message); }
    }
    return json({ error: "WB не отдал рейтинг: " + errs.join(", ") }, 502);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
