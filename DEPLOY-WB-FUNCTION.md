# Деплой Edge Function для WB API

## Что это
Серверная функция в Supabase, которая проксирует запросы к WB Statistics API.
Приложение вызывает её → она ходит в WB → возвращает количество заказов по дням и артикулам.

## Установка Supabase CLI

### Mac:
```bash
brew install supabase/tap/supabase
```

### Или через npm (любая ОС):
```bash
npm install -g supabase
```

## Деплой функции

1. Залогиньтесь:
```bash
supabase login
```
Откроется браузер → авторизуйтесь через Supabase.

2. Свяжите проект:
```bash
cd rnp-app
supabase link --project-ref ubfqwbdvrynbmydmcysp
```

3. Задеплойте функцию:
```bash
supabase functions deploy wb-orders --no-verify-jwt
```

Готово! Функция появится в Supabase Dashboard → Edge Functions.

## Проверка
В приложении: Продвижение → ⚙ → вставьте WB API-ключ → «Сохранить и загрузить».
Заказы подтянутся в строку «Кол-во заказов» на Ганте.

## WB API-ключ
Кабинет ВБ → Настройки → Доступ к API → Создать ключ → категория «Статистика» → Скопировать.
