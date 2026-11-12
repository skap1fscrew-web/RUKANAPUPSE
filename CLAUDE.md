# РНП про — заметки для Claude

Русскоязычное веб-приложение для селлера WB: ассортимент, закупки, задачи, стратегия, функционал.

## Стек
React 18 + Vite + Tailwind + Supabase (Auth, Postgres, Realtime). Деплой: Timeweb собирает ветку `main` из GitHub автоматически.

## Структура
- `src/AssortmentTable.jsx` — почти весь интерфейс (один большой файл)
- `src/lib/cloud.js` — работа с Supabase (products, settings, jobs, realtime)
- `src/lib/supabase.js` — клиент (ключи из `.env`: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- `src/App.jsx` — вход по почте и шапка
- `schema.sql`, `supabase/` — база и edge-функция

## Данные
- `products(id, data)`, `settings(key, value)`, `jobs(id, data, updated_at)` — задачи хранятся построчно
- RLS: доступ только для почт из `allowed_emails` (функция `is_allowed()`)
- Задачи в корзине — это jobs с полем `deletedAt` (хранятся 30 дней)

## Как работать
- Запуск: `npm install`, затем `npm run dev` (http://localhost:5173)
- Проверка сборки: `npm run build`
- Сначала показываем макет, после согласования собираем
- После деплоя всем нужен Ctrl+Shift+R
- Интерфейс и коммиты — на русском
