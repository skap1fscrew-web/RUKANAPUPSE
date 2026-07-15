// Supabase Edge Function — прокси к WB Statistics API
// Получает заказы по дням и группирует по артикулу + дате.
//
// Деплой: supabase functions deploy wb-orders --no-verify-jwt
// (--no-verify-jwt чтобы разрешить вызов без Supabase-авторизации;
//  вместо этого авторизуемся ключом WB API, который передаёт клиент)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { apiKey, dateFrom } = await req.json();

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "apiKey обязателен" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const from = dateFrom || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    // Запрос к WB Statistics API
    const wbUrl = `https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${from}`;
    const wbResp = await fetch(wbUrl, {
      headers: { Authorization: apiKey },
    });

    if (!wbResp.ok) {
      const text = await wbResp.text();
      return new Response(JSON.stringify({ error: `WB API ${wbResp.status}: ${text}` }), {
        status: wbResp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orders = await wbResp.json();

    // Группируем: { "supplierArticle:YYYY-MM-DD": count }
    const counts = {};
    for (const order of orders) {
      if (!order.date || order.isCancel) continue;
      const date = order.date.slice(0, 10);
      const article = order.supplierArticle || String(order.nmId || "");
      const key1 = `${article}:${date}`;
      counts[key1] = (counts[key1] || 0) + 1;
      // Дублируем по nmId (артикулу ВБ) на случай если в таблице используется он
      if (order.nmId) {
        const key2 = `${order.nmId}:${date}`;
        counts[key2] = (counts[key2] || 0) + 1;
      }
    }

    return new Response(JSON.stringify(counts), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
