# Озон в сводке — подключение

1. Кабинет Озон → Настройки → Seller API → сгенерировать ключ (Client-Id + Api-Key).
2. (для рекламы) Озон Performance → Настройки → Ключи API → Client-Id + Client-Secret.
3. В приложении: Настройки → Озон → вставить ключи → «Сохранить и загрузить».
4. Задеплоить функции (из папки проекта):

```
npx supabase@latest functions deploy oz-sum --no-verify-jwt
npx supabase@latest functions deploy oz-adv --no-verify-jwt
```

Сводка → переключатель WB / Озон / Всё вместе.
Если «в пути от покупателя» показывает 0, а возвраты есть — в ответе oz-sum поле `retStatuses`
содержит названия статусов возвратов: по ним уточняется фильтр в `oz-sum/index.ts`.
