# Telegram-бот: запуск

Секрет ниже — любая случайная строка (защищает вебхук). Можно взять свою, главное везде одну и ту же.

1. **Бот.** В Telegram откройте @BotFather → `/newbot` → имя и username (оканчивается на `bot`). Он выдаст токен.
2. **Секреты** (терминал в папке проекта, токен подставьте сами):
   `npx supabase@latest secrets set TG_BOT_TOKEN=<токен> TG_WEBHOOK_SECRET=<секрет>`
3. **Деплой функций:**
   `npx supabase@latest functions deploy tg-webhook --no-verify-jwt`
   `npx supabase@latest functions deploy tg-tick --no-verify-jwt`
4. **Подключить вебхук** — один раз открыть в браузере:
   `https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/tg-webhook?setup=<секрет>`
   Должно вернуться `"ok":true` и имя бота.
5. **Расписание.** Supabase → Database → Extensions: включить `pg_cron` и `pg_net`. Затем SQL Editor:
   ```sql
   select cron.schedule('tg-tick', '* * * * *', $$
     select net.http_post(
       url := 'https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/tg-tick',
       headers := '{"Content-Type":"application/json","x-tick-secret":"<секрет>"}'::jsonb,
       body := '{}'::jsonb
     )
   $$);
   ```
6. **В приложении:** Настройки → Telegram → имя бота (без @) → «Привязать» → в Telegram «Запустить».

Первый запуск `tg-tick` только запоминает текущие задачи (без рассылки), поручения и напоминания пойдут дальше.
