# РНП — ассортимент, продвижение, план отгрузок, закупки

React + Vite + Tailwind. База — Supabase. Хостинг — Timeweb Cloud App Platform.
Вход по e-mail (magic-link), доступ ограничен списком адресов, realtime-синхронизация.

---

## Что понадобится

| Сервис | Зачем | Стоимость |
|--------|-------|-----------|
| **GitHub** | хранение кода, автодеплой | бесплатно |
| **Supabase** | база данных, авторизация, realtime | бесплатно (Free tier) |
| **Timeweb Cloud** | хостинг приложения по ссылке | от 0 ₽ (App Platform) |

Время на настройку: ~20 минут.

---

## Шаг 1. GitHub — загрузить код

1. Зарегистрируйтесь на github.com (если ещё нет).
2. Нажмите **New repository** → имя `rnp-app`, Private, → **Create**.
3. Распакуйте этот zip на компьютер.
4. В терминале (или GitHub Desktop):
   ```bash
   cd rnp-app
   git init
   git add .
   git commit -m "initial"
   git branch -M main
   git remote add origin https://github.com/ВАШ-ЮЗЕРНЕЙМ/rnp-app.git
   git push -u origin main
   ```

## Шаг 2. Supabase — создать базу

1. Зайдите на **supabase.com** → **New project**.
2. Задайте имя, пароль базы, регион (EU West или ближайший).
3. Дождитесь создания (~1 мин).

### 2.1 Создать таблицы

1. **SQL Editor** → **New query**.
2. Вставьте содержимое файла `schema.sql`.
3. **Замените** три адреса `user1@example.com` на реальные e-mail ваших пользователей.
4. Нажмите **Run**.

### 2.2 Настроить вход

1. **Authentication → Providers → Email**: убедитесь, что включён.
2. **Authentication → URL Configuration**:
   - **Site URL**: пока `http://localhost:5173` (потом замените на адрес Timeweb).
   - **Redirect URLs**: добавьте `http://localhost:5173` и будущий адрес Timeweb.

### 2.3 Взять ключи

**Project Settings → API**:
- **Project URL** → `VITE_SUPABASE_URL`
- **anon public** ключ → `VITE_SUPABASE_ANON_KEY`

## Шаг 3. Timeweb Cloud — задеплоить

1. Зарегистрируйтесь на **timeweb.cloud**.
2. В панели слева → **App Platform** → **Создать**.
3. Тип приложения: **React** (или Frontend → React).
4. Подключите **GitHub** → выберите репозиторий `rnp-app`.
5. Ветка: `main`.
6. **Переменные окружения** — добавьте:
   - `VITE_SUPABASE_URL` = ваш Project URL из Supabase
   - `VITE_SUPABASE_ANON_KEY` = ваш anon ключ
7. Команда сборки: `npm run build` (обычно определяется автоматически).
8. Директория сборки: `dist`.
9. Нажмите **Запустить деплой**.
10. После деплоя получите ссылку вида `https://rnp-app-xxxxx.twc1.net`.

### 3.1 Вернуться в Supabase — добавить адрес

**Authentication → URL Configuration**:
- **Site URL**: вставьте адрес Timeweb (`https://rnp-app-xxxxx.twc1.net`)
- **Redirect URLs**: добавьте его же

Без этого ссылка из письма при входе не сработает.

---

## Готово!

Дайте ссылку троим. Каждый вводит e-mail → получает письмо → переходит по ссылке → работает.

Дальнейшие обновления интерфейса: правите код → push в GitHub → Timeweb автоматически передеплоит. Данные в Supabase остаются нетронутыми.

---

## Локальный запуск (для разработки)

```bash
npm install
cp .env.example .env   # впишите ключи
npm run dev
```

## Добавить / убрать пользователя

Supabase → SQL Editor:
```sql
insert into public.allowed_emails (email) values ('new@company.com');
delete from public.allowed_emails where email = 'old@company.com';
```

## Резервные копии

- Бесплатный Supabase: автобэкапов нет → периодически жмите «Экспорт CSV» в приложении.
- Supabase Pro ($25/мес): ежедневные бэкапы, без авто-паузы.
- Бесплатный проект засыпает после 7 дней без запросов. При регулярной работе — не проблема.
