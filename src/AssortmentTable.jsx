import { useState, useEffect, useLayoutEffect, useRef, useMemo, memo, Fragment } from "react";
import rnpLogo from "./logo.png";
import { fetchAll, upsertProduct, deleteProductRow, upsertSetting, upsertJobRow, deleteJobRow, subscribe } from "./lib/cloud";
import {
  Plus, Trash2, ImagePlus, Settings2, X, Check, Download,
  ChevronRight, ChevronDown, ChevronUp, Minus, ArrowRight, ArrowLeftRight, Copy, ExternalLink, Paperclip, Pencil,
  Target, Focus, ChevronLeft, Flag, AlertTriangle, GitBranch, ArrowUpRight, ZoomIn, ZoomOut, Maximize2, Minimize2, Undo2, Redo2, Square, CalendarPlus, Wand2, ListChecks, LayoutTemplate, Repeat, Users, Star, Filter, GripVertical, Columns3, List as ListIcon, Calendar as CalendarIcon, GanttChart, ClipboardCheck, PackagePlus, Megaphone, ShoppingCart, Box, FileText, Eye, EyeOff, History, Search, CalendarCheck, Camera, LogOut, User,
} from "lucide-react";

/* ----------------------------------------------------------------------------
   Конфигурация
---------------------------------------------------------------------------- */

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Затраты одной записи: обычные cost-поля + сумма включённого условного выкупа.
function calcRecordCost(fields, e) {
  return (fields || []).reduce((a, f) => {
    if (f.type === "cost") return a + (parseFloat(String(e[f.id] ?? "").replace(/\s/g, "").replace(",", ".")) || 0);
    if (f.type === "condCost" && e[f.toggleId]) return a + (parseFloat(String(e[f.amountId] ?? "").replace(/\s/g, "").replace(",", ".")) || 0);
    return a;
  }, 0);
}

// Фиксированная (примороженная) левая часть таблицы.
const FROZEN = [
  { id: "actions", label: "", width: 32 },
  { id: "image", label: "Фото", width: 48 },
  { id: "code", label: "Код", width: 68 },
  { id: "wb", label: "Артикул", width: 118 },
  { id: "subject", label: "Предмет", width: 120 },
  { id: "name", label: "Наименование", width: 180 },
  { id: "status", label: "Статус", width: 120 },
];
// Колонки списка «Товары», которые можно двигать / менять ширину / фильтровать.
const DCOL = {
  image: { label: "Фото", w: 48, filter: null, field: null },
  code: { label: "Код", w: 72, filter: "text", field: "code" },
  wb: { label: "Артикул", w: 120, filter: "text", field: "wb" },
  subject: { label: "Предмет", w: 130, filter: "text", field: "subject" },
  name: { label: "Наименование", w: 220, filter: "text", field: "name" },
  status: { label: "Статус", w: 130, filter: "status", field: "status" },
  del: { label: "Удалить", w: 70, filter: null, field: null },
};
const DCOL_ORDER = ["image", "code", "name", "subject", "wb", "status", "del"];
const DCOL_ORDER_OLD = ["image", "code", "wb", "subject", "name", "status"]; // прежний порядок по умолчанию
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Задачи: приоритеты и дефолтные колонки Канбана
const PRIORITIES = {
  high: { label: "Высокий", color: "#ef4444", bg: "#fef0f0", soft: "#fdf5f5" },
  med: { label: "Средний", color: "#f59e0b", bg: "#fef7eb", soft: "#fdf8ef" },
  low: { label: "Низкий", color: "#a3a3a3", bg: "#fafafa", soft: "#fafafa" },
};
const KANBAN_DEFAULT = [
  { id: "backlog", name: "Бэклог", color: "#94a3b8" },
  { id: "doing", name: "В работе", color: "#f59e0b" },
  { id: "done", name: "Готово", color: "#10b981" },
];
// Статусы задачи (этап работы)
const STAGES = {
  wait: { label: "Ожидает", color: "#94a3b8", bg: "#f1f5f9" },
  progress: { label: "В процессе", color: "#c77d1a", bg: "#fff4e5" },
  done: { label: "Готово", color: "#059669", bg: "#ecfdf5" },
};
const STAGE_ORDER = ["wait", "progress", "done"];
// текущий статус задачи (с миграцией из флага done)
const stageOf = (j) => (j && STAGES[j.stage]) ? j.stage : (j && j.done ? "done" : "wait");
// применить статус к задаче, синхронизируя флаг done (для Ганта/Календаря)
const applyStage = (j, stage) => ({ ...j, stage, done: stage === "done" });
// тип задачи-джоба: purchase | project | product (операционные живут отдельно в opTypes).
// по умолчанию выводим из привязок: партия → закупки, товар → товар, иначе — проектная.
const JOB_TYPES = {
  purchase: { label: "Закупки", section: "Закупки" },
  project: { label: "Проектная", section: "Проектные" },
  product: { label: "Товар", section: "Задачи по товарам" },
};
// тип «Закупки» упразднён: старые задачи-закупки и задачи с партией считаются проектными (привязка к партии — поле batchId)
const jobType = (j) => (j && j.type && j.type !== "purchase" && JOB_TYPES[j.type]) ? j.type : (j && j.productId ? "product" : "project");
// В видах задач товар виден контекстно (строка/колонка/карточка/столбец «Товар»),
// поэтому из названия убираем хвост «· Название товара», если он есть (старый формат автозадач).
function stripProdSuffix(title, name) {
  const t = String(title == null ? "" : title);
  if (!name) return t;
  const re = new RegExp("\\s*[·•]\\s*" + String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$");
  return t.replace(re, "").trim() || t;
}
// ---- Метки проектных задач (эмодзи, по умолчанию без метки) ----
const JOB_MARKS = [["urgent", "⚡️"], ["edu", "🎓"], ["long", "🔨"]];
const markIcon = (m) => { const f = JOB_MARKS.find((x) => x[0] === m); return f ? f[1] : ""; };

// ---- Логи задач: запись событий (история внутри карточки) ----
const JOB_LOG_MAX = 500; // хранить последние N событий на задачу
const mkLog = (kind, extra, by) => ({ id: uid(), ts: new Date().toISOString(), kind, by: by === undefined ? null : by, ...(extra || {}) });
function diffJobEvents(prev, next, by) {
  const ev = [];
  if (!prev) { ev.push(mkLog("created", {}, by)); return ev; }
  const sp = stageOf(prev), sn = stageOf(next);
  if (sp !== sn) {
    if (sn === "done") ev.push(mkLog("done", {}, by));
    else if (sp === "done") ev.push(mkLog("reopen", { to: sn }, by));
    else ev.push(mkLog("status", { from: sp, to: sn }, by));
  }
  if ((prev.priority || "") !== (next.priority || "")) ev.push(mkLog("prio", { to: next.priority || "" }, by));
  if ((prev.assignee || "") !== (next.assignee || "")) ev.push(mkLog("assignee", { to: next.assignee || "" }, by));
  if ((prev.date || "") !== (next.date || "")) ev.push(mkLog("date", { to: next.date || "" }, by));
  const pc = Array.isArray(prev.checklist) ? prev.checklist : [];
  const nc = Array.isArray(next.checklist) ? next.checklist : [];
  const pMap = Object.fromEntries(pc.map((c) => [c.id, c]));
  const nMap = Object.fromEntries(nc.map((c) => [c.id, c]));
  nc.forEach((c) => { const old = pMap[c.id]; if (old && !old.done && c.done && (c.text || "").trim()) ev.push(mkLog("sub_done", { text: c.text, cid: c.id }, by)); });
  pc.forEach((c) => { if (!nMap[c.id] && (c.text || "").trim()) ev.push(mkLog("sub_del", { text: c.text }, by)); });
  return ev;
}

// Критерии аналитики карточки (общие для всех карточек, настраиваются)
const ANALYTICS_CRIT_DEFAULT = [
  { id: "comp", name: "Конкуренты с таким же изделием" },
  { id: "wow", name: "Вау-эффект" },
  { id: "utp", name: "УТП" },
  { id: "price", name: "Цена" },
  { id: "nuance", name: "Нюансы типа изделия" },
];
// светофорная оценка: зелёный=2 балла, оранжевый=1, красный=0
const TL_META = {
  green: { color: "#16a34a", bg: "#dcfce7", points: 2, label: "хорошо" },
  orange: { color: "#d97706", bg: "#fef3c7", points: 1, label: "средне" },
  red: { color: "#dc2626", bg: "#fee2e2", points: 0, label: "плохо" },
};
const TL_LEVELS = ["green", "orange", "red"];
// рейтинг карточки: сумма баллов / максимум → 0..10
const analyticsScore = (crits, ratings) => {
  const r = ratings || {};
  const list = Array.isArray(crits) ? crits : [];
  const counts = { green: 0, orange: 0, red: 0 };
  let got = 0, rated = 0;
  list.forEach((c) => { const lv = r[c.id]; if (lv && TL_META[lv]) { counts[lv]++; got += TL_META[lv].points; rated++; } });
  const max = list.length * 2;
  const score10 = max > 0 ? Math.round((got / max) * 10) : 0;
  return { got, max, score10, counts, rated, total: list.length };
};
// пресеты размерных рядов для дашборда «Размеры»
const SIZE_PRESETS = [
  { label: "RU 40–52", sizes: ["40", "42", "44", "46", "48", "50", "52"] },
  { label: "RU 42–56", sizes: ["42", "44", "46", "48", "50", "52", "54", "56"] },
  { label: "S · M · L · XL", sizes: ["S", "M", "L", "XL"] },
  { label: "XS–XXL", sizes: ["XS", "S", "M", "L", "XL", "XXL"] },
  { label: "Школа 122–164", sizes: ["122", "128", "134", "140", "146", "152", "158", "164"] },
];
const scoreVerdict = (sc) => {
  if (!sc.rated) return { text: "Ещё не оценено", color: "#94a3b8" };
  if (sc.score10 >= 8) return { text: "Отлично — брать в работу", color: "#16a34a" };
  if (sc.score10 >= 6) return { text: "Хорошо — можно брать в работу", color: "#16a34a" };
  if (sc.score10 >= 4) return { text: "Средне — есть риски", color: "#d97706" };
  return { text: "Слабо — высокий риск", color: "#dc2626" };
};

// Группы. tab — к какой вкладке относится группа. kind:
//   "columns" — добавляет столбцы к каждой строке товара (как Юнит);
//   "matrix"  — раскрывается под строкой товара (метрики × интеграции, как Внешка).
// масштаб интерфейса (CSS zoom на <html>): vh внутри масштабированного контента нужно компенсировать
const uiZ = () => { try { const z = parseFloat(document.documentElement.style.zoom); return z > 0 ? z : 1; } catch { return 1; } };
const zvh = (n) => (n / uiZ()) + "vh";
const TABS = [
  { id: "assortment", label: "Товары" },
  { id: "rnp", label: "РНП" },
  { id: "summary", label: "Сводка" },
  { id: "purchases", label: "Закупки" },
  { id: "tasks", label: "Задачи" },
  { id: "strategy", label: "Карты" },
  { id: "agents", label: "ИИ-агенты" },
  { id: "content", label: "Контент" },
  { id: "duties", label: "Функционал" },
  { id: "base", label: "База" },
];

// Задачи диаграммы Ганта (общие для всех товаров). kind задаёт поведение строки.
// Схемы полей окна записи. type: text | link | bool | triple | choice | cost.
// Поля type:"cost" суммируются в затраты записи (и далее в ячейку затрат дня).
const VYKUP_FIELDS = [
  { id: "who", label: "Исполнитель", type: "text" },
  { id: "goods", label: "Товар у нас", type: "bool" },
  { id: "money", label: "ДС переведены", type: "bool" },
  { id: "review", label: "Отзыв прошёл", type: "triple", options: ["да", "нет", "не оставлял"] },
  { id: "note", label: "Примечание", type: "text" },
  { id: "cost", label: "Затраты, ₽", type: "cost" },
];
const BLOGGER_STATUSES = [
  { value: "новый", color: "#6366f1" },
  { value: "работаем", color: "#10b981" },
  { value: "не работаем", color: "#a3a3a3" },
];
const REVIEW_OPTIONS = ["не оставила отзыв", "отзыв прошёл", "отзыв не прошёл"];
const BLOGGER_FIELDS = [
  { id: "who", label: "Исполнитель", type: "ref", source: "bloggerDB" },
  { id: "link", label: "Ссылка на пост", type: "link" },
  { id: "format", label: "Формат", type: "choice", options: ["инста пост", "инста сторис", "рилс", "тг пост", "тикток"] },
  { id: "integ", label: "Интеграция, ₽", type: "cost" },
  { id: "delivery", label: "Доставка, ₽", type: "cost" },
  { id: "prod", label: "Товар, ₽", type: "cost" },
  { id: "buyout", label: "Выкупит товар", type: "condCost", toggleId: "buyoutOn", amountId: "buyoutSum", amountLabel: "Сумма выкупа, ₽" },
  { id: "review", label: "Оставит отзыв", type: "condChoice", toggleId: "reviewOn", valueId: "reviewStatus", options: REVIEW_OPTIONS },
  { id: "note", label: "Примечание", type: "text" },
];

const RAZDACHI_FIELDS = [
  { id: "who", label: "Клиент", type: "text" },
  { id: "review", label: "Отзыв прошёл", type: "triple", options: ["да", "нет", "не оставлял"] },
  { id: "cashback", label: "Кешбек, %", type: "text" },
  { id: "cost", label: "Затраты", type: "cost" },
  { id: "note", label: "Примечание", type: "text" },
];
const STARS_FIELDS = [
  { id: "start", label: "Начало", type: "date" },
  { id: "end", label: "Конец", type: "date" },
  { id: "cost", label: "Стоимость", type: "cost" },
  { id: "goal", label: "Цель отзывов", type: "text" },
];
const AB_FIELDS = [
  { id: "start", label: "Начало", type: "date" },
  { id: "end", label: "Конец", type: "date" },
  { id: "images", label: "Кол-во изображений", type: "text" },
];

const RNP_TASKS = [
  { id: "orders",   label: "Заказы", kind: "wbOrders" },
  { id: "orderSum", label: "Сумма заказов", kind: "wbOrders", src: "orderSum" },
  { id: "priceBefore", label: "Цена до СПП", kind: "wbOrders", src: "pBefore" },
  { id: "priceAfter",  label: "Цена после СПП", kind: "wbOrders", src: "pAfter" },
  { id: "priceDisc",   label: "Скидка МП", kind: "wbOrders", src: "pDisc" },
  { id: "sales",    label: "Выкупы", kind: "wbOrders", src: "sales" },
  { id: "internal", label: "Внутренняя реклама", kind: "singleCost", cost: true },
  { id: "drr",      label: "ДРРвз", kind: "wbOrders", src: "drr" },
  { id: "vykupy",   label: "Самовыкупы", kind: "twoRow", top: "entries", cost: true, fields: VYKUP_FIELDS },
  { id: "bloggers", label: "Блогеры", kind: "twoRow", top: "entries", cost: true, fields: BLOGGER_FIELDS },
  { id: "razdachi", label: "Раздачи", kind: "twoRow", top: "entries", cost: true, fields: RAZDACHI_FIELDS },
  { id: "stars",    label: "Баллы за отзывы", kind: "rangeTask", cost: true, fields: STARS_FIELDS },
  { id: "wibes",    label: "Wibes", kind: "twoRow", top: "entries", cost: true, fields: VYKUP_FIELDS },
  { id: "promo",    label: "Акция", kind: "checkbox" },
  { id: "ab",       label: "А/Б тесты", kind: "rangeTask", cost: false, fields: AB_FIELDS },
];
const RNP_COST_TASKS = RNP_TASKS.filter((t) => t.cost);
// Фактический расход внутренней рекламы из WB API: { "nmId:YYYY-MM-DD": ₽ } и дни, по которым данные получены.
// Обновляются из компонента-приложения при каждом рендере (см. App), чтобы расчёты фонда видели факт.
let RNP_AD = {}, RNP_ADMETA = {};
// Выкупы/возвраты из WB: { "артикул|nmId:YYYY-MM-DD": [выкупов, возвратов] }
let RNP_SALES = {};
function rnpSalesVal(product, dkey) { return RNP_SALES[`${product.code || product.wb || ""}:${dkey}`] || RNP_SALES[`${product.wb}:${dkey}`] || null; }
// Число в строке «Заказы» / «Выкупы WB» за день
let RNP_ORDSUM = {}; // сумма заказов по дням из WB: { "артикул|nmId:YYYY-MM-DD": ₽ }
function rnpOrderSum(product, dkey) { return RNP_ORDSUM[`${product.code || product.wb || ""}:${dkey}`] || RNP_ORDSUM[`${product.wb}:${dkey}`] || 0; }
// Цена до/после СПП = сумма заказов / число заказов (по неотменённым заказам WB), скидка МП — разница между ними в %
function rnpOrdN(product, dkey) { return RNP_ORDSUM[`${product.code || product.wb || ""}:${dkey}:n`] || RNP_ORDSUM[`${product.wb}:${dkey}:n`] || 0; }
function rnpOrdSumF(product, dkey) { return RNP_ORDSUM[`${product.code || product.wb || ""}:${dkey}:f`] || RNP_ORDSUM[`${product.wb}:${dkey}:f`] || 0; }
function rnpPriceVal(src, product, dkey) {
  const n = rnpOrdN(product, dkey); if (!n) return 0;
  const before = rnpOrderSum(product, dkey) / n, after = rnpOrdSumF(product, dkey) / n;
  if (src === "pBefore") return before;
  if (src === "pAfter") return after;
  return before > 0 && after > 0 ? (before - after) / before * 100 : 0;
}
// Формат значения строки: сумма компактно, ДРРвз в процентах
function rnpWbFmt(task, n) {
  if (!n) return "";
  if (task.src === "pBefore" || task.src === "pAfter") return Math.round(n).toLocaleString("ru-RU");
  if (task.src === "pDisc") return (Math.round(n * 10) / 10).toLocaleString("ru-RU") + "%";
  if (task.src === "orderSum") return n >= 10000 ? (Math.round(n / 100) / 10).toLocaleString("ru-RU") + "к" : Math.round(n).toLocaleString("ru-RU");
  if (task.src === "drr") return (Math.round(n * 10) / 10).toLocaleString("ru-RU") + "%";
  return String(n);
}
function rnpWbTip(task, product, dkey) {
  if (task.src === "sales") { const v = rnpSalesVal(product, dkey); return v ? `Выкупов: ${v[0]}, возвратов: ${v[1]}` : undefined; }
  if (task.src === "pBefore" || task.src === "pAfter" || task.src === "pDisc") {
    const n = rnpOrdN(product, dkey); if (!n) return undefined;
    const b = rnpPriceVal("pBefore", product, dkey), a = rnpPriceVal("pAfter", product, dkey);
    return `Заказов: ${n}. Цена до СПП: ${Math.round(b).toLocaleString("ru-RU")} ₽, после СПП: ${Math.round(a).toLocaleString("ru-RU")} ₽`;
  }
  if (task.src === "orderSum") { const n = rnpOrderSum(product, dkey); return n ? `Сумма заказов: ${Math.round(n).toLocaleString("ru-RU")} ₽` : undefined; }
  if (task.src === "drr") { const n = rnpOrderSum(product, dkey), ad = rnpInternalDay(RNP_TASKS.find((t) => t.id === "internal"), product, dkey); return n && ad ? `ДРР ко всем заказам: реклама ${Math.round(ad).toLocaleString("ru-RU")} ₽ / заказы ${Math.round(n).toLocaleString("ru-RU")} ₽` : undefined; }
  return undefined;
}
function rnpWbCount(task, product, dkey, wbOrders) {
  if (task.src === "orderSum") return rnpOrderSum(product, dkey);
  if (task.src === "pBefore" || task.src === "pAfter" || task.src === "pDisc") return rnpPriceVal(task.src, product, dkey);
  if (task.src === "drr") { const n = rnpOrderSum(product, dkey), ad = rnpInternalDay(RNP_TASKS.find((t) => t.id === "internal"), product, dkey); return n > 0 && ad > 0 ? ad / n * 100 : 0; }
  if (task.src === "sales") { const v = rnpSalesVal(product, dkey); return v ? v[0] : 0; }
  const code = product.code || product.wb || "";
  return wbOrders[`${code}:${dkey}`] || wbOrders[`${product.wb}:${dkey}`] || 0;
}
function rnpAdDay(product, dkey) {
  const nm = String(product?.wb || "").trim();
  if (!nm || !RNP_ADMETA[dkey]) return undefined; // по дню данных от WB ещё нет — работает ручной ввод
  return RNP_AD[`${nm}:${dkey}`] || 0;
}
function rnpInternalDay(task, product, dkey) {
  const ad = task.id === "internal" ? rnpAdDay(product, dkey) : undefined;
  if (ad !== undefined) return ad;
  const n = toNum((product.rnp?.cells || {})[`${task.id}:cost:${dkey}`]);
  return isNaN(n) ? 0 : n;
}
function rnpSingleTotal(task, product) {
  const pre = task.id + ":cost:"; let sum = 0; const seen = new Set();
  if (task.id === "internal") for (const d of Object.keys(RNP_ADMETA)) { const ad = rnpAdDay(product, d); if (ad !== undefined) { sum += ad; seen.add(d); } }
  for (const [k, v] of Object.entries(product.rnp?.cells || {})) if (k.startsWith(pre) && !seen.has(k.slice(pre.length))) { const n = toNum(v); if (!isNaN(n)) sum += n; }
  return sum;
}
const RNP_COLORS = { orders: "#16a34a", orderSum: "#16a34a", priceBefore: "#16a34a", priceAfter: "#16a34a", priceDisc: "#16a34a", drr: "#b45309", sales: "#0d9488", internal: "#2563eb", vykupy: "#16a34a", bloggers: "#db2777", razdachi: "#d97706", stars: "#7c3aed", wibes: "#0891b2", promo: "#ea580c", ab: "#64748b" };
// дашборд «Контент» — чек-лист готовности карточки
const CONTENT_ITEMS = [
  { id: "main", label: "Главный слайд" },
  { id: "sizegrid", label: "Размерная сетка" },
  { id: "extra", label: "Доп. слайды" },
  { id: "desc", label: "Описание" },
  { id: "specs", label: "Характеристики" },
  { id: "rich", label: "Рич-контент" },
  { id: "variants", label: "Варианты главной" },
  { id: "video", label: "Видео" },
  { id: "bundle", label: "Связка" },
];

// Сумма затрат по строке РНП за весь период (для превью «Фонд / Затраты / Остаток»)
function rnpTaskTotal(task, product) {
  const entries = product.rnp?.entries || {};
  const cells = product.rnp?.cells || {};
  const rec = (e) => calcRecordCost(task.fields, e);
  if (task.kind === "rangeTask") return (entries[`${task.id}:_ranges`] || []).reduce((a, e) => a + rec(e), 0);
  if (task.kind === "singleCost") return rnpSingleTotal(task, product);
  return task.top === "entries"
    ? Object.entries(entries).reduce((a, [k, arr]) => a + (k.startsWith(task.id + ":") && !k.endsWith(":_ranges") ? (arr || []).reduce((s, e) => s + rec(e), 0) : 0), 0)
    : Object.entries(cells).reduce((a, [k, v]) => { if (k.startsWith(task.id + ":cost:")) { const n = toNum(v); if (!isNaN(n)) return a + n; } return a; }, 0);
}
// Фонд маркетинга по партиям: на РНП выбираем партию (фонд считается в карточке: кол-во × цена × ДРР)
// и дату начала реализации. Затраты с этой даты (до старта следующего фонда) списываются из фонда.
let RNP_BATCHES = [];
function rnpFundAmount(product, batchId) {
  const b = RNP_BATCHES.find((x) => x.id === batchId);
  const it = b && (b.items || []).find((i) => i.productId === product.id);
  if (!it) return 0;
  const q = toNum(it.qty), d = toNum(it.mktDrr), pr = toNum(it.mktPlanPrice);
  return (!isNaN(q) && !isNaN(d) && !isNaN(pr)) ? q * pr * d / 100 : 0;
}
function rnpFunds(product) {
  return (product.rnp?.funds || []).filter((f) => f && f.batchId && f.start).slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
// Все затраты по строкам-расходам за период [from, to) — to = null: без верхней границы
function rnpCostBetween(product, from, to) {
  const inR = (d) => d >= from && (!to || d < to);
  const entries = product.rnp?.entries || {}, cells = product.rnp?.cells || {};
  let sum = 0;
  for (const t of RNP_COST_TASKS) {
    if (t.kind === "singleCost") {
      const days = new Set(); const pre = t.id + ":cost:";
      for (const k of Object.keys(cells)) if (k.startsWith(pre)) days.add(k.slice(pre.length));
      if (t.id === "internal") for (const d of Object.keys(RNP_ADMETA)) days.add(d);
      for (const d of days) if (inR(d)) sum += rnpInternalDay(t, product, d);
    } else if (t.kind === "rangeTask") {
      for (const e of entries[`${t.id}:_ranges`] || []) if (e.start && inR(e.start)) sum += calcRecordCost(t.fields, e);
    } else if (t.top === "entries") {
      const pre = t.id + ":";
      for (const [k, arr] of Object.entries(entries)) if (k.startsWith(pre) && !k.endsWith(":_ranges") && inR(k.slice(pre.length))) sum += (arr || []).reduce((a, e) => a + calcRecordCost(t.fields, e), 0);
    }
  }
  return sum;
}
function rnpBudget(product) {
  const funds = rnpFunds(product);
  if (funds.length) {
    const n = new Date(); const t = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    let i = -1; funds.forEach((f, k) => { if (f.start <= t) i = k; });
    const upcoming = i < 0; if (upcoming) i = 0;
    const f = funds[i], next = funds[i + 1];
    const allocated = rnpFundAmount(product, f.batchId);
    const spent = rnpCostBetween(product, f.start, next ? next.start : null);
    const b = RNP_BATCHES.find((x) => x.id === f.batchId);
    return { allocated, spent, ostatok: allocated - spent, fund: { start: f.start, batchName: (b && b.name) || "", upcoming } };
  }
  const alc = toNum(product.rnp?.budget?.allocated);
  const allocated = isNaN(alc) ? 0 : alc;
  const spent = RNP_COST_TASKS.reduce((a, t) => a + rnpTaskTotal(t, product), 0);
  return { allocated, spent, ostatok: allocated - spent };
}
// Затраты по строке за конкретный день (для суммы затрат за день в календаре)
function rnpDayCost(task, product, dkey) {
  const entries = product.rnp?.entries || {};
  const cells = product.rnp?.cells || {};
  if (task.kind === "singleCost") return rnpInternalDay(task, product, dkey);
  if (task.kind === "twoRow" && task.top === "entries") return (entries[`${task.id}:${dkey}`] || []).reduce((s, e) => s + calcRecordCost(task.fields, e), 0);
  return 0;
}
// Активность по строке за день (для чипов): null если ничего нет
function rnpDayActivity(task, product, dkey, wbOrders = {}) {
  const entries = product.rnp?.entries || {};
  const cells = product.rnp?.cells || {};
  const flags = product.rnp?.flags || {};
  if (task.kind === "wbOrders") { const c = rnpWbCount(task, product, dkey, wbOrders); return c > 0 ? { count: c, cost: 0 } : null; }
  if (task.kind === "singleCost") { const n = rnpInternalDay(task, product, dkey); return n > 0 ? { count: 0, cost: n } : null; }
  if (task.kind === "twoRow" && task.top === "entries") { const arr = entries[`${task.id}:${dkey}`] || []; return arr.length ? { count: arr.length, cost: arr.reduce((s, e) => s + calcRecordCost(task.fields, e), 0) } : null; }
  if (task.kind === "checkbox") return flags[`${task.id}:${dkey}`] ? { count: 0, cost: 0 } : null;
  if (task.kind === "rangeTask") { const act = (entries[`${task.id}:_ranges`] || []).some((r) => r.start <= dkey && r.end >= dkey); return act ? { count: 0, cost: 0 } : null; }
  return null;
}

const FILL_COLORS = ["#bbf7d0", "#fed7aa", "#fde68a", "#fecaca", "#e9d5ff", "#bae6fd"];

// Календарь производства: палитра полос этапов и дефолтный набор этапов
const CAL_STAGE_COLORS = ["#93c5fd", "#c4b5fd", "#fcd34d", "#86efac", "#fca5a5", "#f9a8d4", "#5eead4", "#a5b4fc"];
// Процесс «Логистика» — последовательные компоненты с длительностью в днях.
const DEFAULT_CAL_COMPONENTS = [
  { name: "Формирование заказа", days: 3 },
  { name: "Производство", days: 14 },
  { name: "Контроль качества", days: 2 },
  { name: "Доставка", days: 7 },
];
const makeDefaultCalendar = () => ({
  entry: "",   // точка входа (дедлайн, старт продаж)
  start: "",   // дата старта процесса «Логистика»
  name: "Логистика",
  buffer: 0,   // запас до входа, дней (быть на полке за N дней до сезона)
  components: DEFAULT_CAL_COMPONENTS.map((c, i) => ({ id: uid(), name: c.name, days: c.days, color: CAL_STAGE_COLORS[i % CAL_STAGE_COLORS.length] })),
});
// Привести календарь к новой схеме (процесс с компонентами)
const normalizeCalendar = (c) => {
  if (c && Array.isArray(c.components)) {
    return { entry: c.entry || "", start: c.start || "", name: c.name || "Логистика", buffer: Math.max(0, parseInt(c.buffer) || 0), components: c.components };
  }
  return makeDefaultCalendar();
};

const DEFAULT_WAREHOUSES = [
  { id: uid(), name: "Подольск", region: "Центральный" },
  { id: uid(), name: "Тула", region: "Центральный" },
  { id: uid(), name: "Электросталь", region: "Центральный" },
  { id: uid(), name: "Шушары", region: "Северо-Западный" },
  { id: uid(), name: "Казань", region: "Приволжский" },
  { id: uid(), name: "Новосемейкино", region: "Приволжский" },
  { id: uid(), name: "Краснодар", region: "Южный" },
  { id: uid(), name: "Невинномысск", region: "Южный" },
  { id: uid(), name: "Перспективный", region: "Уральский / Сибирский" },
  { id: uid(), name: "Владивосток", region: "Дальневосточный" },
  { id: uid(), name: "Волгоград", region: "Южный" },
];

const GROUPS = [
  {
    id: "unit",
    label: "Юнит ВБ",
    accent: "#7c3aed",
    tab: "card",
    kind: "columns",
    // Формулы юнит-экономики ВБ — как в таблице «Ассортимент»:
    //   Цена после СПП = Цена*(1−СПП)
    //   Итоговая логистика = (Баз.лог*КФ склада)/%выкупа + (Баз.лог/%выкупа − Баз.лог)
    //   Общие затраты = Себес + Цена*Эквайринг + Цена*Комиссия + Итог.лог + ЦенаПослеСПП*Налог + Цена*ДРР
    //   ЧП = Цена − Общие затраты · Рента = ЧП/Себес · Маржа = ЧП/Цена
    columns: [
      { id: "cost",       label: "Факт. себес",        field: "cost",       type: "input" },
      { id: "price",      label: "Цена",               field: "price",      type: "priceStack", w: 72,
        sub: (p) => { const pr = toNum(p.price), sp = toNum(p.spp); return isNaN(pr) ? NaN : (isNaN(sp) ? pr : pr * (1 - sp / 100)); } },
      { id: "spp",        label: "СПП, %",             field: "spp",        type: "input", suffix: "%" },
      { id: "commission", label: "Комиссия, %",        type: "calc", suffix: "%",
        fn: (p) => { const c = toNum(p.commission); return isNaN(c) ? NaN : c; } },
      { id: "buyback",    label: "% выкупа",            field: "buyback",    type: "input", suffix: "%" },
      { id: "drr",        label: "ДРР, %",              field: "drr",        type: "input", suffix: "%" },
      { id: "logistics",  label: "Базовая логистика",   field: "logistics",  type: "input" },
      { id: "logisticsFull", label: "Итоговая логистика", type: "calc",
        fn: (p) => {
          const base = toNum(p.logistics), coeff = toNum(p.whCoeff), bb = toNum(p.buyback);
          if (isNaN(base) || isNaN(bb) || bb <= 0) return NaN;
          const n = bb / 100, o = isNaN(coeff) ? 1 : coeff / 100; // КФ склада — проценты (170% = 1.7)
          return (base * o) / n + (base / n - base);
        } },
      { id: "totalCosts", label: "Общие затраты",       type: "calc",
        fn: (p, cols) => {
          const cost = toNum(p.cost), price = toNum(p.price), spp = toNum(p.spp), comm = toNum(p.commission), acq = toNum(p.acquiring), tax = toNum(p.taxRate), drr = toNum(p.drr);
          if (isNaN(cost) || isNaN(price)) return NaN;
          const commRub = !isNaN(comm) ? price * comm / 100 : 0;
          const acqRub = !isNaN(acq) ? price * acq / 100 : 0;
          const priceAfterSpp = !isNaN(spp) ? price * (1 - spp / 100) : price;
          const taxRub = !isNaN(tax) ? priceAfterSpp * tax / 100 : 0;
          const drrRub = !isNaN(drr) ? price * drr / 100 : 0;
          const logCol = cols.find((c) => c.id === "logisticsFull");
          const logVal = logCol ? logCol.fn(p) : 0;
          const log = isNaN(logVal) ? 0 : logVal;
          return cost + commRub + acqRub + log + taxRub + drrRub;
        } },
      { id: "profit",     label: "ЧП",                  type: "calc",
        fn: (p, cols) => {
          const price = toNum(p.price);
          const tcCol = cols.find((c) => c.id === "totalCosts");
          const tc = tcCol ? tcCol.fn(p, cols) : NaN;
          return (!isNaN(price) && !isNaN(tc)) ? price - tc : NaN;
        } },
      { id: "renta",      label: "Рента",               type: "calc", suffix: "%",
        fn: (p, cols) => {
          const cost = toNum(p.cost);
          const prCol = cols.find((c) => c.id === "profit");
          const pr = prCol ? prCol.fn(p, cols) : NaN;
          return (!isNaN(pr) && !isNaN(cost) && cost > 0) ? (pr / cost) * 100 : NaN;
        } },
      { id: "margin",     label: "Маржа",               type: "calc", suffix: "%",
        fn: (p, cols) => {
          const price = toNum(p.price);
          const prCol = cols.find((c) => c.id === "profit");
          const pr = prCol ? prCol.fn(p, cols) : NaN;
          return (!isNaN(pr) && !isNaN(price) && price > 0) ? (pr / price) * 100 : NaN;
        } },
    ],
  },
  {
    id: "unitoz",
    label: "Юнит Озон",
    accent: "#2563eb",
    tab: "card",
    kind: "columns",
    // Озон: себес — общий (p.cost). Итог.логистика без КФ склада.
    //   Итог.лог = Баз.лог/%выкупа + (Баз.лог/%выкупа − Баз.лог)
    //   Общие затраты = Себес + ЦенаПослеСПП*Эквайринг + Цена*Комиссия + Итог.лог + ЦенаПослеСПП*Налог + Цена*ДРР
    columns: [
      { id: "priceOz",    label: "Цена",               field: "priceOz",    type: "priceStack", w: 72,
        sub: (p) => { const pr = toNum(p.priceOz), sp = toNum(p.sppOz); return isNaN(pr) ? NaN : (isNaN(sp) ? pr : pr * (1 - sp / 100)); } },
      { id: "sppOz",      label: "СПП, %",             field: "sppOz",      type: "input", suffix: "%" },
      { id: "commissionOz", label: "Комиссия, %",      field: "commissionOz", type: "input", suffix: "%" },
      { id: "buybackOz",  label: "% выкупа",            field: "buybackOz",  type: "input", suffix: "%" },
      { id: "drrOz",      label: "ДРР, %",              field: "drrOz",      type: "input", suffix: "%" },
      { id: "logisticsOz", label: "Логистика",          field: "logisticsOz", type: "input" },
      { id: "logisticsFullOz", label: "Итоговая логистика", type: "calc",
        fn: (p) => {
          const base = toNum(p.logisticsOz), bb = toNum(p.buybackOz);
          if (isNaN(base) || isNaN(bb) || bb <= 0) return NaN;
          const n = bb / 100;
          return base / n + (base / n - base);
        } },
      { id: "totalCostsOz", label: "Общие затраты",     type: "calc",
        fn: (p, cols) => {
          const cost = toNum(p.cost), price = toNum(p.priceOz), spp = toNum(p.sppOz), comm = toNum(p.commissionOz), acq = toNum(p.acquiringOz), tax = toNum(p.taxRateOz), drr = toNum(p.drrOz);
          if (isNaN(cost) || isNaN(price)) return NaN;
          const priceAfterSpp = !isNaN(spp) ? price * (1 - spp / 100) : price;
          const commRub = !isNaN(comm) ? price * comm / 100 : 0;
          const acqRub = !isNaN(acq) ? priceAfterSpp * acq / 100 : 0;
          const taxRub = !isNaN(tax) ? priceAfterSpp * tax / 100 : 0;
          const drrRub = !isNaN(drr) ? price * drr / 100 : 0;
          const logCol = cols.find((c) => c.id === "logisticsFullOz");
          const logVal = logCol ? logCol.fn(p) : 0;
          const log = isNaN(logVal) ? 0 : logVal;
          return cost + acqRub + commRub + log + taxRub + drrRub;
        } },
      { id: "profitOz",   label: "ЧП",                  type: "calc",
        fn: (p, cols) => {
          const price = toNum(p.priceOz);
          const tcCol = cols.find((c) => c.id === "totalCostsOz");
          const tc = tcCol ? tcCol.fn(p, cols) : NaN;
          return (!isNaN(price) && !isNaN(tc)) ? price - tc : NaN;
        } },
      { id: "rentaOz",    label: "Рента",               type: "calc", suffix: "%",
        fn: (p, cols) => {
          const cost = toNum(p.cost);
          const prCol = cols.find((c) => c.id === "profitOz");
          const pr = prCol ? prCol.fn(p, cols) : NaN;
          return (!isNaN(pr) && !isNaN(cost) && cost > 0) ? (pr / cost) * 100 : NaN;
        } },
      { id: "marginOz",   label: "Маржа",               type: "calc", suffix: "%",
        fn: (p, cols) => {
          const price = toNum(p.priceOz);
          const prCol = cols.find((c) => c.id === "profitOz");
          const pr = prCol ? prCol.fn(p, cols) : NaN;
          return (!isNaN(pr) && !isNaN(price) && price > 0) ? (pr / price) * 100 : NaN;
        } },
    ],
  },
  {
    id: "gantt",
    label: "РНП",
    accent: "#ea580c",
    tab: "promotion",
    kind: "gantt",
  },
  {
    id: "calendar",
    label: "Календарь",
    accent: "#0ea5e9",
    tab: "calendar",
    kind: "calendar",
  },
  {
    id: "shipment",
    label: "План отгрузок",
    accent: "#16a34a",
    tab: "shipment",
    kind: "plan",
  },
];

const MATRIX_GROUPS = GROUPS.filter((g) => g.kind === "matrix");

const DEFAULT_STATUSES = [
  { name: "Новинка", color: "#6366f1" },
  { name: "В продаже", color: "#10b981" },
  { name: "Хит", color: "#f59e0b" },
  { name: "Снят", color: "#a3a3a3" },
];

// Производственный цикл заказа: этапы по умолчанию + правила автозадач
const CYCLE_STAGE_COLORS = ["#6366f1", "#f59e0b", "#0ea5e9", "#8b5cf6", "#10b981", "#ef4444", "#84cc16", "#ec4899"];
const DEFAULT_CYCLE = {
  stages: [
    { id: "form", name: "Формирование заказа", days: 2, task: { enabled: true, text: "Формирование фонда маркетинга по партии «{партия}»", scope: "batch", when: "enter", priority: "med", assignee: null } },
    { id: "prod", name: "Производство", days: 14, task: { enabled: false, text: "", scope: "batch", when: "complete", priority: null, assignee: null } },
    { id: "qc", name: "Контроль качества", days: 3, task: { enabled: true, text: "Проверить фото/видео брака по партии «{партия}»", scope: "batch", when: "complete", priority: "high", assignee: null } },
    { id: "ship", name: "Отправка в РФ", days: 15, task: { enabled: false, text: "", scope: "batch", when: "complete", priority: null, assignee: null } },
    { id: "accept", name: "Приёмка", days: 3, task: { enabled: true, text: "Сверить приёмку с заказом по партии «{партия}»", scope: "product", when: "complete", priority: "med", assignee: null } },
  ],
};
function normCycle(v) {
  const src = (v && Array.isArray(v.stages) && v.stages.length) ? v.stages : DEFAULT_CYCLE.stages;
  const stages = src.filter((s) => s && typeof s === "object").map((s) => {
    const t = (s.task && typeof s.task === "object") ? s.task : {};
    return {
      id: s.id || uid(),
      name: s.name || "Этап",
      days: Math.max(0, parseInt(s.days) || 0),
      task: {
        enabled: !!t.enabled,
        text: t.text || "",
        scope: t.scope === "product" ? "product" : "batch",
        when: t.when === "complete" ? "complete" : "enter",
        priority: (t.priority === "high" || t.priority === "med" || t.priority === "low") ? t.priority : null,
        assignee: t.assignee || null,
        hasDate: !!t.hasDate,
        durDays: Math.max(1, parseInt(t.durDays) || 1),
      },
    };
  });
  const fin = stages.length ? stages : DEFAULT_CYCLE.stages.map((s) => ({ ...s, task: { ...s.task } }));
  const known = new Set(fin.map((s) => s.id));
  let cycles = (v && Array.isArray(v.cycles) ? v.cycles : []).filter((c) => c && typeof c === "object").map((c) => ({
    id: c.id || uid(), name: c.name || "Цикл",
    stages: (Array.isArray(c.stages) ? c.stages : []).filter((x) => x && known.has(x.id)).map((x) => ({ id: x.id, days: Math.max(0, parseInt(x.days) || 0) })),
  }));
  if (!cycles.length) cycles = [{ id: "main", name: "Основной цикл", stages: fin.map((s) => ({ id: s.id, days: s.days })) }];
  return { stages: fin, cycles };
}
// план дат этапов партии из даты старта и длительностей
function cycleStageDates(startISO, stages) {
  const out = {}; if (!startISO) return out;
  const base = new Date(startISO + "T00:00:00"); if (isNaN(base.getTime())) return out;
  let acc = 0;
  (stages || []).forEach((s) => {
    const d = Math.max(0, parseInt(s.days) || 0);
    const st = new Date(base); st.setDate(st.getDate() + acc);
    const en = new Date(base); en.setDate(en.getDate() + acc + Math.max(0, d - 1));
    const f = (x) => `${String(x.getDate()).padStart(2, "0")}.${String(x.getMonth() + 1).padStart(2, "0")}`;
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    out[s.id] = { start: st, end: en, startStr: f(st), endStr: f(en), startISO: iso(st), endISO: iso(en) };
    acc += d;
  });
  return out;
}
// нормализация правил «Задачи по триггерам» для смены статуса товара
// миграция старого offsetDays → hasDate + durDays (как у этапов цикла)
function normTaskTriggers(arr) {
  return (Array.isArray(arr) ? arr : []).filter((r) => r && typeof r === "object").map((r) => {
    const hasDate = r.hasDate != null ? !!r.hasDate : (r.offsetDays != null && r.offsetDays !== "");
    const durDays = r.durDays != null ? Math.max(1, parseInt(r.durDays) || 1) : Math.max(1, parseInt(r.offsetDays) || 1);
    return {
      id: r.id || uid(),
      enabled: r.enabled !== false,
      statusName: r.statusName || "",
      text: r.text || "",
      taskType: r.taskType === "project" ? "project" : "product",
      assignee: r.assignee || null,
      priority: (r.priority === "high" || r.priority === "med" || r.priority === "low") ? r.priority : "low",
      hasDate, durDays,
    };
  });
}
// нормализация правил «Задачи по триггерам» для этапов цикла (плоский список)
function normCycleTriggers(arr) {
  return (Array.isArray(arr) ? arr : []).filter((r) => r && typeof r === "object").map((r) => ({
    id: r.id || uid(),
    enabled: r.enabled !== false,
    stageId: r.stageId || "",
    when: r.when === "complete" ? "complete" : "enter",
    scope: r.scope === "product" ? "product" : "batch",
    text: r.text || "",
    priority: (r.priority === "high" || r.priority === "med" || r.priority === "low") ? r.priority : null,
    assignee: r.assignee || null,
    hasDate: !!r.hasDate,
    dateFrom: r.dateFrom === "end" ? "end" : "start",
    durDays: Math.max(1, parseInt(r.durDays) || 1),
  }));
}
// миграция старых автозадач этапов (prodCycle.stages[].task) → плоский cycleTriggers
function cycleTriggersFromCycle(cyc) {
  const out = [];
  ((cyc && cyc.stages) || []).forEach((s) => {
    const t = s && s.task;
    if (t && t.enabled && String(t.text || "").trim()) {
      const when = t.when === "complete" ? "complete" : "enter";
      out.push({
        id: "cyc_" + s.id + "_" + when, enabled: true, stageId: s.id, when,
        scope: t.scope === "product" ? "product" : "batch", text: t.text,
        priority: (t.priority === "high" || t.priority === "med" || t.priority === "low") ? t.priority : null,
        assignee: t.assignee || null, hasDate: !!t.hasDate, durDays: Math.max(1, parseInt(t.durDays) || 1),
      });
    }
  });
  return out;
}

// даты задачи этапа: старт = плановое начало этапа, дедлайн = старт + длительность задачи
// даты задачи по триггеру этапа партии. Всегда от факта: начало этапа = факт окончания предыдущего
// (у первого — старт цикла), конец этапа = его факт. Если факта ещё нет — берётся плановая дата.
// from: "start" — старт задачи = начало этапа, "end" — старт задачи = конец этапа
function stageTaskDates(bc, stageId, durDays, from = "start") {
  const stages = (bc && bc.stages) || [];
  const dts = cycleStageDates(bc && bc.startDate, stages);
  const sd = dts[stageId]; if (!sd) return { start: null, date: null };
  const idx = stages.findIndex((x) => x.id === stageId);
  const cur = stages[idx], prev = idx > 0 ? stages[idx - 1] : null;
  const startISO = prev && prev.actualDate ? prev.actualDate : sd.startISO;
  const endISO = cur && cur.actualDate ? cur.actualDate : sd.endISO;
  const base = from === "end" ? endISO : startISO;
  const e = new Date(base + "T00:00:00"); e.setDate(e.getDate() + Math.max(1, parseInt(durDays) || 1) - 1);
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { start: base, date: iso(e) };
}

const DEFAULT_METRICS_BY_GROUP = Object.fromEntries(
  MATRIX_GROUPS.map((g) => [g.id, g.metrics.map((label) => ({ id: uid(), label }))])
);

const SWATCHES = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444",
  "#0ea5e9", "#ec4899", "#84cc16", "#a3a3a3",
];

// --- Профили пользователей (исполнители задач, привязанные к логину) ---
// Раскладка логин → имя (для первичной привязки существующих исполнителей).
const KNOWN_LOGINS = {
  "jabulani2000@yandex.ru": "Андрей",
  "fbrk6263@mail.ru": "Роман",
  "anastasi.mezhueva@yandex.ru": "Анастасия",
  "skap1fscrew@gmail.com": "Сергей",
};
// Канон имени: «Рома»/«Роман» → один ключ, регистр не важен.
const canonName = (s) => {
  const n = String(s || "").trim().toLowerCase();
  if (n.startsWith("ром")) return "роман";
  return n;
};
const LOGIN_BY_NAME = Object.fromEntries(Object.entries(KNOWN_LOGINS).map(([email, name]) => [canonName(name), email.toLowerCase()]));
function normProfiles(v) {
  return Array.isArray(v)
    ? v.filter((p) => p && typeof p === "object").map((p) => ({
        id: p.id || uid(),
        email: String(p.email || "").toLowerCase().trim(),
        name: p.name || "",
        color: p.color || "#64748b",
        photo: typeof p.photo === "string" ? p.photo : "",
      }))
    : [];
}
// Имя для показа: ник профиля, иначе часть логина до @.
const profileLabel = (p) => (p && (p.name || (p.email ? p.email.split("@")[0] : ""))) || "Исполнитель";
// Общая аватарка: фото, иначе цветной кружок с буквой. size в px.
function PersonAvatar({ p, size = 24, ring = false, title }) {
  const s = size, st = { width: s, height: s };
  const cls = "inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden " + (ring ? "ring-2 ring-white " : "");
  const tt = title || (p ? profileLabel(p) : "");
  if (p && p.photo) return <span className={cls} style={st} title={tt}><img src={p.photo} alt="" className="h-full w-full object-cover" /></span>;
  return (
    <span className={cls + "font-bold text-white"} style={{ ...st, background: p ? p.color : "#cfcfd6", fontSize: Math.round(s * 0.42) }} title={tt}>
      {(profileLabel(p)[0] || "?").toUpperCase()}
    </span>
  );
}
// Исполнители задачи: до двух. Поле assignees — массив, assignee — первый (для совместимости).
const jobAssignees = (j) => (j && Array.isArray(j.assignees) && j.assignees.length ? j.assignees : (j && j.assignee ? [j.assignee] : [])).filter(Boolean);
// Выбор исполнителей: компактные чипы с аватаркой (max — сколько можно выбрать)
function AssigneePicker({ people = [], value = [], onChange, max = 2 }) {
  const sel = value || [];
  const full = sel.length >= max;
  const toggle = (id) => {
    if (sel.includes(id)) onChange(sel.filter((x) => x !== id));
    else if (max === 1) onChange([id]);
    else if (!full) onChange([...sel, id]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {people.map((pp) => { const on = sel.includes(pp.id); const dis = !on && full && max > 1; return (
          <button key={pp.id} type="button" onClick={() => toggle(pp.id)} disabled={dis} title={profileLabel(pp)}
            className={"inline-flex items-center gap-1.5 rounded-full border-[1.5px] py-[3px] pl-[3px] pr-2.5 text-[13px] font-semibold transition " + (on ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300") + (dis ? " cursor-not-allowed opacity-40" : "")}>
            <PersonAvatar p={pp} size={22} />{profileLabel(pp)}
          </button>
        ); })}
      </div>
    </div>
  );
}
// Аватарки исполнителей (одна или две внахлёст)
function AssigneeAvatars({ j, personById, size = 20, ringAlways = false }) {
  const list = jobAssignees(j).map((id) => personById[id]).filter(Boolean);
  if (!list.length) return null;
  // обёртки — flex, а не строчные: иначе аватарка с фото и аватарка с буквой садятся на базовую линию по-разному и «прыгают» по вертикали
  // первый исполнитель всегда сверху (z-index убывает), второй выглядывает из-под него
  return <span className="ml-auto inline-flex items-center">{list.map((pr, i) => <span key={pr.id} className={"relative flex shrink-0 leading-none " + (i ? "-ml-1.5" : "")} style={{ zIndex: list.length - i }}>{i ? <span className="relative flex overflow-hidden rounded-full" style={{ width: size, height: size }}><span className="absolute rounded-full bg-white" style={{ width: size + 3, height: size + 3, left: 4.5 - size, top: -1.5 }} /><span className="relative flex"><PersonAvatar p={pr} size={size} /></span></span> : <PersonAvatar p={pr} size={size} ring={ringAlways} />}</span>)}</span>;
}
// Ужать изображение (File) до data-URL ~квадрат maxPx, jpeg.
function fileToAvatarDataURL(file, maxPx = 256) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        const cv = document.createElement("canvas");
        cv.width = maxPx; cv.height = maxPx;
        const ctx = cv.getContext("2d");
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxPx, maxPx);
        resolve(cv.toDataURL("image/jpeg", 0.82));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}


/* ----------------------------------------------------------------------------
   Утилиты
---------------------------------------------------------------------------- */

const toNum = (v) => {
  if (v === "" || v == null) return NaN;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? NaN : n;
};

const money = (n) =>
  isNaN(n)
    ? "—"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(
        Math.round(n)
      ) + " ₽";

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function buildDays(startISO, count) {
  const out = [];
  const base = new Date(startISO + "T00:00:00");
  if (isNaN(base.getTime())) return out;
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      day: d.getDate(),
      month: d.getMonth(),
      wd: WEEKDAYS[d.getDay()],
      weekend: d.getDay() === 0 || d.getDay() === 6,
      firstOfMonth: d.getDate() === 1 || i === 0,
    });
  }
  return out;
}

const normalizeProduct = (p) => {
  const blocks = {};
  for (const g of MATRIX_GROUPS) {
    const existing = p?.blocks?.[g.id]?.entries;
    // миграция со старой схемы Внешки (external.integrations)
    const legacy = g.id === "external" ? p?.external?.integrations : null;
    blocks[g.id] = { entries: existing || legacy || [] };
  }
  return {
    image: null, code: "", wb: "", subject: "", name: "", status: "", cost: "",
    ...p,
    purchase: p?.purchase || { link: "", param: "", priceCny: "", weightG: "", qty: "" },
    id: p?.id || uid(),
    external: undefined,
    blocks,
    plan: { sizes: p?.plan?.sizes || [], oneSize: !!p?.plan?.oneSize, oneLabel: p?.plan?.oneLabel || "ONE SIZE" },
    rnp: p?.rnp || { cells: {}, entries: {}, fills: {}, flags: {}, budget: { allocated: "" } },
    calendar: normalizeCalendar(p?.calendar),
    tasks: Array.isArray(p?.tasks) ? p.tasks : [],
    competitors: Array.isArray(p?.competitors) ? p.competitors : [],
    seasonality: p?.seasonality || null,
    analytics: (p?.analytics && typeof p.analytics === "object")
      ? { ratings: p.analytics.ratings || {}, comments: p.analytics.comments || {} }
      : { ratings: {}, comments: {} },
  };
};

function fileToThumb(file, max = 240) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}
// Любое изображение (data URL/ссылка) → чистый JPEG data URL + размеры. null, если не удалось (битое/CORS).
function imgToJpeg(src, maxSide = 220) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      if (!/^data:/.test(src)) img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
          if (!iw || !ih) return resolve(null);
          const k = Math.min(1, maxSide / Math.max(iw, ih));
          const cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(iw * k)); cv.height = Math.max(1, Math.round(ih * k));
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          const dataUrl = cv.toDataURL("image/jpeg", 0.85);
          resolve(/^data:image\/jpeg/.test(dataUrl) ? { dataUrl, w: cv.width, h: cv.height } : null);
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    } catch { resolve(null); }
  });
}
function fileToDataURL(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
}
function humanSize(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " Б";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " КБ";
  return (Math.round((n / 1024 / 1024) * 10) / 10) + " МБ";
}
const FILE_BADGE_COLORS = { PDF: "#ef4444", DOC: "#2563eb", DOCX: "#2563eb", XLS: "#16a34a", XLSX: "#16a34a", CSV: "#16a34a", PPT: "#ea580c", PPTX: "#ea580c", ZIP: "#a16207", RAR: "#a16207", TXT: "#737373" };
function fileExt(name) { const e = (String(name || "").split(".").pop() || "").toUpperCase(); return e && e.length <= 4 ? e : "ФАЙЛ"; }

/* ----------------------------------------------------------------------------
   Генератор .xlsx без зависимостей (store-zip + OOXML + встроенные картинки)
---------------------------------------------------------------------------- */
const _CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = _CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder();
  const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const parts = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : enc.encode(f.data);
    const crc = crc32(data), size = data.length;
    const lh = [0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)];
    parts.push(new Uint8Array(lh), name, data);
    central.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += lh.length + name.length + size;
  }
  const cStart = offset; let cLen = 0;
  for (const c of central) { parts.push(c); cLen += c.length; }
  parts.push(new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cLen), ...u32(cStart), ...u16(0)]));
  let total = 0; for (const p of parts) total += p.length;
  const out = new Uint8Array(total); let p = 0; for (const c of parts) { out.set(c, p); p += c.length; }
  return out;
}
function _b64bytes(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
const _xe = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function _colRef(n) { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
// header: [строки], rows: [[ячейки]] (число → числовая, иначе текст), images: [{row(0-based data), col, dataUrl}]
function buildXlsx({ sheetName = "Лист1", title = "", subtitle = "", header = [], rows = [], totalsRow = null, images = [], colWidths = [], imgColWidthPx = 64, imgRowHeightPx = 56 }) {
  const EMU = 9525; // px → EMU
  sheetName = (String(sheetName || "").replace(/[\\/?*\[\]:]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31)) || "Лист1"; // Excel запрещает \ / ? * [ ] : в имени листа
  const ncols = Math.max(header.length, ...rows.map((r) => r.length), 1);
  // Стили: 1=заголовок(крупный жирный), 2=подзаголовок(серый), 3=шапка(жирн+заливка+рамка), 4=итоги(жирн+верх.рамка)
  const cell = (ref, v, s) => {
    const sa = s ? ` s="${s}"` : "";
    if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${sa}><v>${v}</v></c>`;
    const t = v == null ? "" : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
    if (t === "") return `<c r="${ref}"${sa}/>`;
    return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${_xe(t)}</t></is></c>`;
  };
  // Порядок строк: [заголовок][подзаголовок] шапка данные [итоги]
  const pre = [];
  if (title) pre.push({ text: title, style: 1, ht: 26 });
  if (subtitle) pre.push({ text: subtitle, style: 2, ht: 17 });
  const preRows = pre.length;
  const headerRow0 = preRows;            // 0-based индекс строки шапки
  const dataStart0 = preRows + 1;        // 0-based индекс первой строки данных
  const imgRows = new Set(images.map((im) => dataStart0 + im.row));
  let sd = "";
  // заголовок/подзаголовок (сливаются по всем колонкам)
  pre.forEach((p, i) => { sd += `<row r="${i + 1}" ht="${p.ht}" customHeight="1">` + cell(_colRef(0) + (i + 1), p.text, p.style) + `</row>`; });
  // шапка
  sd += `<row r="${headerRow0 + 1}" ht="20" customHeight="1">` + header.map((h, c) => cell(_colRef(c) + (headerRow0 + 1), h, 3)).join("") + `</row>`;
  // данные
  rows.forEach((row, ri) => {
    const r0 = dataStart0 + ri;
    const ht = imgRows.has(r0) ? ` ht="${Math.round(imgRowHeightPx * 0.75)}" customHeight="1"` : "";
    sd += `<row r="${r0 + 1}"${ht}>` + row.map((v, c) => cell(_colRef(c) + (r0 + 1), v)).join("") + `</row>`;
  });
  // итоги
  if (totalsRow) {
    const r0 = dataStart0 + rows.length;
    sd += `<row r="${r0 + 1}" ht="20" customHeight="1">` + totalsRow.map((v, c) => cell(_colRef(c) + (r0 + 1), v, 4)).join("") + `</row>`;
  }
  const merges = pre.length
    ? `<mergeCells count="${pre.length}">` + pre.map((p, i) => `<mergeCell ref="A${i + 1}:${_colRef(ncols - 1)}${i + 1}"/>`).join("") + `</mergeCells>`
    : "";
  const cols = colWidths.length
    ? `<cols>` + colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + `</cols>`
    : "";
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${cols}<sheetData>${sd}</sheetData>${merges}${images.length ? '<drawing r:id="rId1"/>' : ""}</worksheet>`;

  const media = images.map((im, i) => ({ name: `xl/media/image${i + 1}.jpeg`, data: _b64bytes(im.dataUrl.slice(im.dataUrl.indexOf(",") + 1)) }));
  const anchors = images.map((im, i) => {
    const boxW = imgColWidthPx - 8, boxH = imgRowHeightPx - 4;
    const k = (im.w && im.h) ? Math.min(boxW / im.w, boxH / im.h) : 1;
    const cx = Math.round(((im.w && im.h) ? im.w * k : boxW) * EMU), cy = Math.round(((im.w && im.h) ? im.h * k : boxH) * EMU);
    return `<xdr:oneCellAnchor><xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>${Math.round(4 * EMU)}</xdr:colOff><xdr:row>${dataStart0 + im.row}</xdr:row><xdr:rowOff>${Math.round(2 * EMU)}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="img${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
  }).join("");
  const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
  const drawingRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${images.map((im, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.jpeg"/>`).join("")}</Relationships>`;

  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${images.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${_xe(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="15"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF8A8A90"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="3"><border/><border><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border><border><top style="medium"><color rgb="FF333333"/></top></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/></cellXfs></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml },
  ];
  if (images.length) {
    files.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>` });
    files.push({ name: "xl/drawings/drawing1.xml", data: drawingXml });
    files.push({ name: "xl/drawings/_rels/drawing1.xml.rels", data: drawingRels });
    media.forEach((m) => files.push(m));
  }
  return zipStore(files);
}

/* ----------------------------------------------------------------------------
   Главный компонент
---------------------------------------------------------------------------- */

const SubjectsDatalist = memo(function SubjectsDatalist({ subjects }) {
  return (
    <datalist id="subjects-datalist">
      {(subjects || []).map((s) => (<option key={s.id || s.name} value={s.name} />))}
    </datalist>
  );
});

export default function AssortmentTable({ userEmail = null, onSignOut }) {
  const [allProducts, setProducts] = useState([]); // все товары, включая лежащие в корзине (для синхронизации)
  const products = useMemo(() => allProducts.filter((p) => p && !p.deletedAt), [allProducts]); // без корзины
  const trashProducts = useMemo(() => allProducts.filter((p) => p && p.deletedAt).sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))), [allProducts]);
  const [statuses, setStatuses] = useState(DEFAULT_STATUSES);
  const [metricsByGroup, setMetricsByGroup] = useState(DEFAULT_METRICS_BY_GROUP);
  const [warehouses, setWarehouses] = useState(DEFAULT_WAREHOUSES);
  const [purchases, setPurchases] = useState([]);
  const [purchaseBatches, setPurchaseBatches] = useState([]); // блок «Закупки» — партии [{id,name,status,cny,usd,cargo,items:[{id,productId,priceCny,qty}]}]
  const [jobs, setJobs] = useState([]); // блок «Задачи» — задачи с датой [{id,title,date,done,labelId,productId}]
  const liveJobs = useMemo(() => jobs.filter((j) => j && !j.deletedAt), [jobs]); // без корзины
  const trashJobs = useMemo(() => jobs.filter((j) => j && j.deletedAt).sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))), [jobs]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashSec, setTrashSec] = useState("jobs"); // раздел корзины при открытии
  const [undoDel, setUndoDel] = useState(null); // {id,title,kind} — плашка «Вернуть»; kind: job | product | function
  const [jobEditor, setJobEditor] = useState(null); // {id?...} открытое окно задачи
  const meRef = useRef(userEmail); meRef.current = userEmail; // автор ручных правок в логах задач — логин авторизованного пользователя
  const [rnpStartDate, setRnpStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10);
  });
  const [rnpDays, setRnpDays] = useState(28);
  const [hiddenTasks, setHiddenTasks] = useState({});
  const [rnpOrder, setRnpOrder] = useState([]); // порядок строк РНП (массив id)
  const [hiddenCols, setHiddenCols] = useState({}); // скрытые столбцы юнита: { "unit:spp": true }
  const [colFilterOpen, setColFilterOpen] = useState(false);
  const [unitConst, setUnitConst] = useState({ tax: "8", acqWb: "2.5", acqOz: "1.5", whCoeffWb: "170", cny: "", usd: "", cargo: "", commission: "", insurance: "" }); // единые для всех товаров
  const [subjects, setSubjects] = useState([]); // предметы с комиссией ВБ — [{id, name, commission}]
  const [enabled, setEnabled] = useState({ unit: true, unitoz: true, external: true, razdachi: true, vykupy: true, shipment: true });
  const [activeTab, setActiveTab] = useState("assortment");
  const [purchFocusId, setPurchFocusId] = useState(null); // партия, на которую перешли из Фокуса
  useEffect(() => { if (activeTab !== "purchases") setPurchFocusId(null); }, [activeTab]);
  const [productsView, setProductsView] = useState("list"); // list | tiles
  const [tileSize, setTileSize] = useState("m"); // xs | s | m — размер плиток
  const [expanded, setExpanded] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // личная настройка быстрого доступа к блокам: порядок + скрытые (уходят в меню «⋯»)
  const [navCfg, setNavCfg] = useState(() => { try { const r = JSON.parse(localStorage.getItem("rnp-navtabs") || "null"); return r && typeof r === "object" ? r : { order: [], hidden: {} }; } catch { return { order: [], hidden: {} }; } });
  useEffect(() => { try { localStorage.setItem("rnp-navtabs", JSON.stringify(navCfg)); } catch {} }, [navCfg]);
  const [navMoreOpen, setNavMoreOpen] = useState(false);
  // личный масштаб интерфейса (по умолчанию 80%)
  const [mq, setMq] = useState(() => { try { const r = JSON.parse(localStorage.getItem("rnp-marquee") || "null"); return r && typeof r === "object" ? { on: r.on !== false, speed: [1, 2, 3].includes(r.speed) ? r.speed : 2, text: typeof r.text === "string" ? r.text : "Работаем, братья!" } : { on: true, speed: 2, text: "Работаем, братья!" }; } catch { return { on: true, speed: 2, text: "Работаем, братья!" }; } });
  useEffect(() => { try { localStorage.setItem("rnp-marquee", JSON.stringify(mq)); } catch {} }, [mq]);
  const [uiZoom, setUiZoom] = useState(() => { try { const z = parseFloat(localStorage.getItem("rnp-uizoom")); return z >= 0.6 && z <= 1.2 ? z : 0.8; } catch { return 0.8; } });
  useEffect(() => { try { localStorage.setItem("rnp-uizoom", String(uiZoom)); } catch {} document.documentElement.style.zoom = uiZoom === 1 ? "" : String(uiZoom); return () => { document.documentElement.style.zoom = ""; }; }, [uiZoom]);
  const navTabs = (() => { const ord = (navCfg.order || []).filter((id) => TABS.some((t) => t.id === id)); const all = [...ord, ...TABS.map((t) => t.id).filter((id) => !ord.includes(id))]; return all.map((id) => TABS.find((t) => t.id === id)); })();
  const navShown = navTabs.filter((t) => !(navCfg.hidden || {})[t.id] || t.id === activeTab);
  const navRest = navTabs.filter((t) => !navShown.includes(t));
  const [defaultTasks, setDefaultTasks] = useState([]); // задачи по умолчанию (общие) — [{id, text, labelId}]
  const [taskLabels, setTaskLabels] = useState([]); // метки задач (общие) — [{id, name, color}]
  const [taskTags, setTaskTags] = useState([]); // теги задач — [{id, name, color}], несколько на задачу
  const [taskTriggers, setTaskTriggers] = useState([]); // задачи по триггерам (статус товара) — [{id, enabled, statusName, text, taskType, assignee, priority, offsetDays}]
  const [cycleTriggers, setCycleTriggers] = useState([]); // задачи по триггерам (этап партии) — [{id, enabled, stageId, when, scope, text, priority, assignee, hasDate, durDays}]
  const [analyticsCriteria, setAnalyticsCriteria] = useState(() => ANALYTICS_CRIT_DEFAULT.slice()); // критерии аналитики (общие) — [{id, name}]
  const [kanbanCols, setKanbanCols] = useState(() => KANBAN_DEFAULT.slice()); // колонки Канбана — [{id, name, color}]
  const [opTypes, setOpTypes] = useState([]); // операционные задачи (регулярные строки Ганта) — [{id, name, recur}]
  const [opDone, setOpDone] = useState({}); // отметки выполнения операционных задач — {opId:{"YYYY-MM-DD":true}}
  const [opEditor, setOpEditor] = useState(null); // открытая настройка операционной задачи (из Ганта)
  const [purchActiveId, setPurchActiveId] = useState(null); // id открытой партии закупки (для экспорта)
  const [ganttModal, setGanttModal] = useState(null);
  const [cardModal, setCardModal] = useState(null); // id товара для окна «Задачи по карточке»
  const [supplyMenu, setSupplyMenu] = useState(null); // выбор партии для добавления товара { productId, x, y }
  const [toast, setToast] = useState(null); // всплывающее подтверждение
  const [codeFilter, setCodeFilter] = useState("");
  const [prodSearchOpen, setProdSearchOpen] = useState(false); // лупа поиска по товарам развёрнута
  const [statusFilter, setStatusFilter] = useState([]); // выбранные статусы (мультивыбор); пусто = все
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  // настраиваемые колонки списка «Товары»: порядок, ширина, фильтры (per-device, localStorage)
  const [colOrder, setColOrder] = useState(() => { const s = lsGet("rnp.listOrder", null); const base = DCOL_ORDER.slice(); if (Array.isArray(s) && JSON.stringify(s) !== JSON.stringify(DCOL_ORDER_OLD)) { const r = s.filter((x) => DCOL[x]); base.forEach((x) => { if (!r.includes(x)) r.push(x); }); return r; } return base; });
  const [colW, setColW] = useState(() => lsGet("rnp.listWidths", {}));
  const [colFilters, setColFilters] = useState(() => lsGet("rnp.listFilters", {}));
  const [colMenu, setColMenu] = useState(null); // id колонки с открытым фильтром
  const dragColRef = useRef(null);
  const resizeColRef = useRef(null);
  useEffect(() => lsSet("rnp.listOrder", colOrder), [colOrder]);
  useEffect(() => lsSet("rnp.listWidths", colW), [colW]);
  useEffect(() => lsSet("rnp.listFilters", colFilters), [colFilters]);
  useEffect(() => {
    const mv = (e) => { const r = resizeColRef.current; if (!r) return; const nw = Math.max(40, Math.min(640, r.w + (e.clientX - r.x))); setColW((w) => ({ ...w, [r.id]: nw })); };
    const up = () => { if (resizeColRef.current) { resizeColRef.current = null; document.body.style.cursor = ""; } };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
  }, []);
  const startColResize = (e, id) => { e.preventDefault(); e.stopPropagation(); resizeColRef.current = { id, x: e.clientX, w: colW[id] || DCOL[id].w }; document.body.style.cursor = "col-resize"; };
  const reorderCol = (from, to) => { if (!from || from === to) return; setColOrder((o) => { const a = o.filter((x) => x !== from); const idx = a.indexOf(to); a.splice(idx < 0 ? a.length : idx, 0, from); return a; }); };
  const resetCols = () => { setColOrder(DCOL_ORDER.slice()); setColW({}); setColFilters({}); setColMenu(null); };
  const [bloggerDB, setBloggerDB] = useState([]);
  const [razdachDB, setRazdachDB] = useState([]);
  const [dbOpen, setDbOpen] = useState(false);
  const [dbActive, setDbActive] = useState("blogger"); // blogger | razdach | <customId>
  const [dbColumns, setDbColumns] = useState({}); // свои колонки базы: {typeId: [...]}
  const [customDBs, setCustomDBs] = useState([]); // пользовательские виды базы — [{id, name, rows:[]}]
  const [strategy, setStrategy] = useState(() => normStrategy(null)); // блок «Стратегия» — карты холстов
  const [duties, setDuties] = useState(() => normDuties(null)); // блок «Обязанности» — области/функции/подфункции/исполнители (СПРАВОЧНИК, не связан с назначением задач)
  const [agents, setAgents] = useState(() => defaultAgents()); // реестр ИИ-агентов
  const [profiles, setProfiles] = useState([]); // профили пользователей — исполнители задач, привязанные к логину
  const [myProfileOpen, setMyProfileOpen] = useState(false); // окно личных настроек профиля
  const [profileMenuOpen, setProfileMenuOpen] = useState(false); // меню профиля в верхней шапке
  const [prodCycle, setProdCycle] = useState(() => normCycle(null)); // производственный цикл — этапы и правила автозадач по умолчанию
  const [colSettings, setColSettings] = useState(false);
  const [wbApiKey, setWbApiKey] = useState("");
  const [focusLine, setFocusLine] = useState(""); // устаревшее: прежняя общая строка (оставлена для переноса)
  const [focusLines, setFocusLines] = useState({}); // «Главный фокус» у каждого пользователя свой: { profileId: текст }
  const [wbOrders, setWbOrders] = useState({}); // { "articleCode:YYYY-MM-DD": count }
  const [wbOrdersMeta, setWbOrdersMeta] = useState({}); // { "YYYY-MM-DD": "дата когда забрали" }
  const [wbSales, setWbSales] = useState({}); // { "артикул|nmId:YYYY-MM-DD": [выкупов, возвратов] }
  const [wbSalesMeta, setWbSalesMeta] = useState({});
  const [wbRating, setWbRating] = useState({}); // { nmId: { r: рейтинг, f: отзывов, t: когда обновлено } }
  const ratingTriedRef = useRef({});
  useEffect(() => {
    // рейтинг и отзывы открытой карточки — с публичной карточки WB (обновляем не чаще раза в 6 часов)
    if (!cardModal || !loaded) return;
    const p = products.find((x) => x.id === cardModal);
    const nm = String((p && p.wb) || "").trim();
    if (!/^\d{5,}$/.test(nm)) return;
    const c = wbRating[nm];
    if (c && c.t && Date.now() - new Date(c.t).getTime() < 6 * 3600e3) return;
    if (Date.now() - (ratingTriedRef.current[nm] || 0) < 5 * 60e3) return;
    ratingTriedRef.current[nm] = Date.now();
    (async () => {
      try {
        const resp = await fetch("https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/wb-rating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nmIds: [nm] }) });
        const d = await resp.json().catch(() => null);
        if (!resp.ok || !d || !d.items || !d.items[nm]) return;
        const it = d.items[nm];
        const next = { ...wbRating, [nm]: { r: it.r, f: it.f, t: new Date().toISOString() } };
        setWbRating(next);
        try { await upsertSetting("wbRating", next); } catch (_) {}
      } catch (_) {}
    })();
  }, [cardModal, loaded, products, wbRating]);
  const [tgLinks, setTgLinks] = useState({}); // { profileId: chatId } — пишет только функция tg-webhook
  const [tgBot, setTgBot] = useState(""); // имя Telegram-бота (без @)
  const saveTgBot = (v) => { const n = String(v || "").trim().replace(/^@/, ""); setTgBot(n); upsertSetting("tgBot", n).catch(() => {}); };
  const [wbOrdSum, setWbOrdSum] = useState({}); // сумма заказов по дням { "артикул|nmId:YYYY-MM-DD": ₽ }
  const [wbOrdSumMeta, setWbOrdSumMeta] = useState({});
  const [wbAdKey, setWbAdKey] = useState(""); // ключ WB, категория «Продвижение»
  const [wbWay, setWbWay] = useState(null); // товары «в пути»: { updatedAt, items: { "артикул|nmId": {to, from, toSum, fromSum} } }
  const [wayLoading, setWayLoading] = useState(false);
  const [wayMsg, setWayMsg] = useState("");
  const wayTriedRef = useRef(0);
  const fetchWbWay = async () => {
    const key = wbApiKey || wbAdKey;
    if (!key) { setWayMsg("Нет API-ключа WB (Настройки → API ВБ)"); return; }
    setWayLoading(true); setWayMsg("");
    try {
      const resp = await fetch("https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/wb-stocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: key }) });
      if (resp.status === 429) { setWayMsg("WB ограничил частоту запросов — повторите через минуту"); return; }
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error((data && data.error) || ("wb-stocks " + resp.status));
      if (!data || !data.items) throw new Error("пустой ответ");
      setWbWay(data);
      try { await upsertSetting("wbWay", data); } catch (_) {}
    } catch (e) { setWayMsg("Не удалось загрузить: " + (e.message || e)); }
    finally { setWayLoading(false); }
  };
  useEffect(() => {
    if (activeTab !== "summary" || !loaded || wayLoading) return;
    const stale = !wbWay || !wbWay.updatedAt || wbWay.v !== 2 || Date.now() - new Date(wbWay.updatedAt).getTime() > 30 * 60 * 1000;
    if (stale && Date.now() - wayTriedRef.current > 5 * 60 * 1000 && (wbApiKey || wbAdKey)) { wayTriedRef.current = Date.now(); fetchWbWay(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, loaded, wbWay, wbApiKey, wbAdKey]);
  const [ozCfg, setOzCfg] = useState({}); // ключи Озона: { clientId, apiKey, perfId, perfSecret }
  const [ozData, setOzData] = useState(null); // кэш oz-sum
  const [ozAd, setOzAd] = useState(null); // кэш oz-adv
  const [ozLoading, setOzLoading] = useState(false);
  const [ozMsg, setOzMsg] = useState("");
  const ozTriedRef = useRef(0);
  const fetchOz = async () => {
    const c = ozCfg || {};
    if (!c.clientId || !c.apiKey) { setOzMsg("Нет ключей Озона (Настройки → Озон)"); return; }
    setOzLoading(true); setOzMsg("");
    try {
      const resp = await fetch("https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/oz-sum", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: c.clientId, apiKey: c.apiKey, days: 30 }) });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error((data && data.error) || ("oz-sum " + resp.status));
      if (!data || !data.orders) throw new Error("пустой ответ");
      setOzData(data);
      try { await upsertSetting("ozSum", data); } catch (_) {}
      if (data.errors && data.errors.length) setOzMsg("Частично: " + String(data.errors[0]).slice(0, 140));
    } catch (e) { setOzMsg("Озон: " + (e.message || e)); }
    if (c.perfId && c.perfSecret) {
      try {
        const resp = await fetch("https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/oz-adv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: c.perfId, clientSecret: c.perfSecret, days: 30 }) });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) throw new Error((data && data.error) || ("oz-adv " + resp.status));
        if (data && data.ad) { setOzAd(data); try { await upsertSetting("ozAd", data); } catch (_) {} }
      } catch (e) { setOzMsg((m) => m || ("Реклама Озон: " + (e.message || e))); }
    }
    setOzLoading(false);
  };
  useEffect(() => {
    if (activeTab !== "summary" || !loaded || ozLoading) return;
    const c = ozCfg || {};
    if (!c.clientId || !c.apiKey) return;
    const stale = !ozData || !ozData.updatedAt || Date.now() - new Date(ozData.updatedAt).getTime() > 30 * 60 * 1000;
    if (stale && Date.now() - ozTriedRef.current > 5 * 60 * 1000) { ozTriedRef.current = Date.now(); fetchOz(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, loaded, ozData, ozCfg]);
  const [msCfg, setMsCfg] = useState({}); // МойСклад: { token }
  const [msData, setMsData] = useState(null); // кэш ms-stock
  const [msLoading, setMsLoading] = useState(false);
  const [msMsg, setMsMsg] = useState("");
  const fetchMs = async () => {
    const c = msCfg || {};
    if (!c.token) { setMsMsg("Нет токена МойСклад"); return; }
    setMsLoading(true); setMsMsg("");
    try {
      const resp = await fetch("https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/ms-stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: c.token, codes: [...new Set((products || []).map((x) => String(x.code || "").trim()).filter(Boolean))] }) });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error((data && data.error) || ("ms-stock " + resp.status));
      if (!data || !data.items) throw new Error("пустой ответ");
      setMsData(data);
      try { await upsertSetting("msStock", data); } catch (_) {}
      setMsMsg(data.errors && data.errors.length ? "Частично: " + String(data.errors[0]).slice(0, 140) : "✓ загружено позиций: " + data.count + " (склад: " + (data.store || "") + ")");
    } catch (e) { setMsMsg("МойСклад: " + (e.message || e)); }
    setMsLoading(false);
  };
  const msTriedRef = useRef(0);
  useEffect(() => {
    if (!loaded || msLoading || !(msCfg && msCfg.token)) return;
    const stale = !msData || msData.v !== 2 || !msData.updatedAt || Date.now() - new Date(msData.updatedAt).getTime() > 60 * 60 * 1000;
    if (stale && Date.now() - msTriedRef.current > 5 * 60 * 1000) { msTriedRef.current = Date.now(); fetchMs(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, msData, msCfg]);
  const [wbAdSpend, setWbAdSpend] = useState({}); // { "nmId:YYYY-MM-DD": ₽ } факт внутренней рекламы
  const [wbAdMeta, setWbAdMeta] = useState({}); // { "YYYY-MM-DD": "дата когда забрали" }
  const [wbAdLoading, setWbAdLoading] = useState(false);
  const [wbAdMsg, setWbAdMsg] = useState("");
  RNP_AD = wbAdSpend; RNP_ADMETA = wbAdMeta; RNP_BATCHES = purchaseBatches; RNP_SALES = wbSales; RNP_ORDSUM = wbOrdSum;
  const [wbLoading, setWbLoading] = useState(false);
  const [wbProgress, setWbProgress] = useState(null);
  const [settingsTab, setSettingsTab] = useState("statuses"); // стартовая вкладка окна настроек
  const [panelW, setPanelW] = useState(0);

  const fileInputRef = useRef(null);
  const profilePhotoInputRef = useRef(null);
  const uploadTarget = useRef(null);
  const scrollRef = useRef(null);

  const syncedRef = useRef({ products: new Map(), settings: {} });
  const dirtyRef = useRef({ products: new Set(), settings: new Set() });
  const desiredRef = useRef({ settings: {} }); // последнее желаемое значение каждого ключа (для защиты от гонки эха)
  // Задачи хранятся построчно (таблица jobs). Рефы для diff-записи и защиты от эха.
  const syncedJobsRef = useRef({}); // id -> JSON последней синхронизированной версии задачи
  const desiredJobsRef = useRef({}); // id -> JSON последнего желаемого значения
  const dirtyJobsRef = useRef(new Set()); // id задач с несохранённой локальной правкой
  const listSettingsRef = useRef({ bloggerDB: [], razdachDB: [], purchases: [], purchaseBatches: [], jobs: [], opTypes: [], subjects: [], customDBs: [], dbColumns: {} });
  listSettingsRef.current = { bloggerDB, razdachDB, purchases, purchaseBatches, jobs, opTypes, subjects, customDBs, dbColumns };

  // UI-настройки (личные) — localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("rnp-ui");
      if (raw) { const ui = JSON.parse(raw); if (ui.enabled) setEnabled((e) => ({ ...e, ...ui.enabled })); if (ui.activeTab && TABS.some((t) => t.id === ui.activeTab)) setActiveTab(ui.activeTab); if (ui.hiddenTasks) setHiddenTasks(ui.hiddenTasks); if (Array.isArray(ui.rnpOrder)) setRnpOrder(ui.rnpOrder); if (ui.hiddenCols) setHiddenCols(ui.hiddenCols); if (ui.productsView) setProductsView(ui.productsView); if (["xs", "s", "m"].includes(ui.tileSize)) setTileSize(ui.tileSize); }
      // Разовая установка строк РНП по умолчанию: показаны только Кол-во заказов / Блогеры / Раздачи
      if (!localStorage.getItem("rnp-rows-v2")) {
        const def = {}; RNP_TASKS.forEach((t) => { if (!["orders", "bloggers", "razdachi"].includes(t.id)) def[t.id] = true; });
        setHiddenTasks(def);
        localStorage.setItem("rnp-rows-v2", "1");
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("rnp-ui", JSON.stringify({ enabled, activeTab, hiddenTasks, rnpOrder, hiddenCols, productsView, tileSize })); } catch {}
  }, [enabled, activeTab, hiddenTasks, rnpOrder, hiddenCols, productsView, tileSize]);

  // загрузка из Supabase
  useEffect(() => {
    (async () => {
      try {
        const { products: prods, settings, jobs: jobRows } = await fetchAll();
        const norm = (prods || []).map(normalizeProduct);
        // у старых товаров нет даты добавления — проставляем по текущему порядку списка (сверху самый старый)
        const base = Date.now() - (norm.length + 1) * 1000;
        const stamped = norm.map((p, i) => (p.createdAt ? p : { ...p, createdAt: base + i * 1000 }));
        setProducts(stamped);
        norm.forEach((p) => syncedRef.current.products.set(p.id, JSON.stringify(p)));
        if (Array.isArray(settings.statuses) && settings.statuses.length) { setStatuses(settings.statuses); syncedRef.current.settings.statuses = JSON.stringify(settings.statuses); }
        if (Array.isArray(settings.warehouses) && settings.warehouses.length) { setWarehouses(settings.warehouses); syncedRef.current.settings.warehouses = JSON.stringify(settings.warehouses); }
        if (Array.isArray(settings.purchases)) { setPurchases(settings.purchases); syncedRef.current.settings.purchases = JSON.stringify(settings.purchases); }
        if (Array.isArray(settings.purchaseBatches)) { setPurchaseBatches(settings.purchaseBatches); syncedRef.current.settings.purchaseBatches = JSON.stringify(settings.purchaseBatches); }
        // Задачи: из таблицы jobs, если там есть строки; иначе фолбэк на старый блоб settings.jobs (до миграции).
        const loadedJobs = (Array.isArray(jobRows) && jobRows.length) ? jobRows : (Array.isArray(settings.jobs) ? settings.jobs : []);
        setJobs(loadedJobs);
        syncedJobsRef.current = {}; loadedJobs.forEach((j) => { if (j && j.id) syncedJobsRef.current[j.id] = JSON.stringify(j); });
        if (Array.isArray(settings.bloggerDB)) { setBloggerDB(settings.bloggerDB); syncedRef.current.settings.bloggerDB = JSON.stringify(settings.bloggerDB); }
        if (Array.isArray(settings.razdachDB)) { setRazdachDB(settings.razdachDB); syncedRef.current.settings.razdachDB = JSON.stringify(settings.razdachDB); }
        if (Array.isArray(settings.defaultTasks)) { setDefaultTasks(settings.defaultTasks); syncedRef.current.settings.defaultTasks = JSON.stringify(settings.defaultTasks); }
        if (Array.isArray(settings.taskLabels)) { setTaskLabels(settings.taskLabels); syncedRef.current.settings.taskLabels = JSON.stringify(settings.taskLabels); }
        if (Array.isArray(settings.taskTags)) { setTaskTags(settings.taskTags); syncedRef.current.settings.taskTags = JSON.stringify(settings.taskTags); }
        if (Array.isArray(settings.taskTriggers)) { const tt = normTaskTriggers(settings.taskTriggers); setTaskTriggers(tt); syncedRef.current.settings.taskTriggers = JSON.stringify(tt); }
        if (Array.isArray(settings.analyticsCriteria) && settings.analyticsCriteria.length) { setAnalyticsCriteria(settings.analyticsCriteria); syncedRef.current.settings.analyticsCriteria = JSON.stringify(settings.analyticsCriteria); }
        if (Array.isArray(settings.kanbanCols) && settings.kanbanCols.length) { setKanbanCols(settings.kanbanCols); syncedRef.current.settings.kanbanCols = JSON.stringify(settings.kanbanCols); }
        if (Array.isArray(settings.opTypes)) { setOpTypes(settings.opTypes); syncedRef.current.settings.opTypes = JSON.stringify(settings.opTypes); }
        if (settings.opDone && typeof settings.opDone === "object") { setOpDone(settings.opDone); syncedRef.current.settings.opDone = JSON.stringify(settings.opDone); }
        if (Array.isArray(settings.subjects)) { setSubjects(settings.subjects); syncedRef.current.settings.subjects = JSON.stringify(settings.subjects); }
        if (settings.dbColumns && typeof settings.dbColumns === "object") { setDbColumns(settings.dbColumns); syncedRef.current.settings.dbColumns = JSON.stringify(settings.dbColumns); }
        if (Array.isArray(settings.customDBs)) { setCustomDBs(settings.customDBs); syncedRef.current.settings.customDBs = JSON.stringify(settings.customDBs); }
        if (settings.strategy && typeof settings.strategy === "object") { const ns = normStrategy(settings.strategy); setStrategy(ns); syncedRef.current.settings.strategy = JSON.stringify(ns); }
        if (Array.isArray(settings.agents)) { setAgents(settings.agents); syncedRef.current.settings.agents = JSON.stringify(settings.agents); }
        if (settings.duties && typeof settings.duties === "object") { const nd = normDuties(settings.duties); setDuties(nd); syncedRef.current.settings.duties = JSON.stringify(nd); }
        if (settings.wbWay && typeof settings.wbWay === "object") setWbWay(settings.wbWay);
        if (settings.wbRating && typeof settings.wbRating === "object") setWbRating(settings.wbRating);
        if (settings.tgLinks && typeof settings.tgLinks === "object") setTgLinks(settings.tgLinks);
        if (typeof settings.tgBot === "string") setTgBot(settings.tgBot);
        if (Array.isArray(settings.profiles)) { const np = normProfiles(settings.profiles); setProfiles(np); syncedRef.current.settings.profiles = JSON.stringify(np); }
        if (settings.prodCycle && typeof settings.prodCycle === "object") { const nc = normCycle(settings.prodCycle); setProdCycle(nc); syncedRef.current.settings.prodCycle = JSON.stringify(nc); }
        // cycleTriggers: загрузка готового списка либо одноразовая миграция из старых автозадач этапов
        if (Array.isArray(settings.cycleTriggers)) {
          const ct = normCycleTriggers(settings.cycleTriggers); setCycleTriggers(ct); syncedRef.current.settings.cycleTriggers = JSON.stringify(ct);
        } else {
          const nc = (settings.prodCycle && typeof settings.prodCycle === "object") ? normCycle(settings.prodCycle) : normCycle(null);
          const ct = cycleTriggersFromCycle(nc); setCycleTriggers(ct);
          // перенос ключей дедупа в партиях: уже сработавшие этапы не должны создать задачи повторно
          if (Array.isArray(settings.purchaseBatches)) {
            let touched = false;
            const migB = settings.purchaseBatches.map((b) => {
              const f = b && b.cycle && b.cycle.fired;
              if (!f || typeof f !== "object") return b;
              const nf = { ...f }; let ch = false;
              Object.keys(f).forEach((k) => { const m = /^(.+):(e|c)$/.exec(k); if (m && f[k]) { const nk = "cyc_" + m[1] + "_" + (m[2] === "c" ? "complete" : "enter"); if (!nf[nk]) { nf[nk] = true; ch = true; } } });
              if (ch) { touched = true; return { ...b, cycle: { ...b.cycle, fired: nf } }; }
              return b;
            });
            if (touched) setPurchaseBatches(migB);
          }
        }
        if (settings.unitConst && typeof settings.unitConst === "object") { setUnitConst((c) => ({ ...c, ...settings.unitConst })); syncedRef.current.settings.unitConst = JSON.stringify(settings.unitConst); }
        if (settings.rnp) {
          if (settings.rnp.startDate) setRnpStartDate(settings.rnp.startDate);
          if (settings.rnp.days) setRnpDays(settings.rnp.days);
          syncedRef.current.settings.rnp = JSON.stringify(settings.rnp);
        }
        if (settings.focusLines && typeof settings.focusLines === "object") { setFocusLines(settings.focusLines); syncedRef.current.settings.focusLines = JSON.stringify(settings.focusLines); }
        if (typeof settings.focusLine === "string") { setFocusLine(settings.focusLine); syncedRef.current.settings.focusLine = JSON.stringify(settings.focusLine); }
        if (settings.wbApiKey) { setWbApiKey(settings.wbApiKey); syncedRef.current.settings.wbApiKey = JSON.stringify(settings.wbApiKey); }
        if (settings.wbOrders && typeof settings.wbOrders === "object") { setWbOrders(settings.wbOrders); syncedRef.current.settings.wbOrders = JSON.stringify(settings.wbOrders); }
        if (settings.wbSales && typeof settings.wbSales === "object") { setWbSales(settings.wbSales); syncedRef.current.settings.wbSales = JSON.stringify(settings.wbSales); }
        if (settings.wbOrdSum && typeof settings.wbOrdSum === "object") { setWbOrdSum(settings.wbOrdSum); syncedRef.current.settings.wbOrdSum = JSON.stringify(settings.wbOrdSum); }
        if (settings.wbOrdSumMeta && typeof settings.wbOrdSumMeta === "object") { setWbOrdSumMeta(settings.wbOrdSumMeta); syncedRef.current.settings.wbOrdSumMeta = JSON.stringify(settings.wbOrdSumMeta); }
        if (settings.wbSalesMeta && typeof settings.wbSalesMeta === "object") { setWbSalesMeta(settings.wbSalesMeta); syncedRef.current.settings.wbSalesMeta = JSON.stringify(settings.wbSalesMeta); }
        if (settings.ozCfg && typeof settings.ozCfg === "object") { setOzCfg(settings.ozCfg); syncedRef.current.settings.ozCfg = JSON.stringify(settings.ozCfg); }
        if (settings.ozSum && typeof settings.ozSum === "object") setOzData(settings.ozSum);
        if (settings.msCfg && typeof settings.msCfg === "object") { setMsCfg(settings.msCfg); syncedRef.current.settings.msCfg = JSON.stringify(settings.msCfg); }
        if (settings.msStock && typeof settings.msStock === "object") setMsData(settings.msStock);
        if (settings.ozAd && typeof settings.ozAd === "object") setOzAd(settings.ozAd);
        if (settings.wbAdKey) { setWbAdKey(settings.wbAdKey); syncedRef.current.settings.wbAdKey = JSON.stringify(settings.wbAdKey); }
        if (settings.wbAdSpend && typeof settings.wbAdSpend === "object") { setWbAdSpend(settings.wbAdSpend); syncedRef.current.settings.wbAdSpend = JSON.stringify(settings.wbAdSpend); }
        if (settings.wbAdMeta && typeof settings.wbAdMeta === "object") { setWbAdMeta(settings.wbAdMeta); syncedRef.current.settings.wbAdMeta = JSON.stringify(settings.wbAdMeta); }
        if (settings.wbOrdersMeta && typeof settings.wbOrdersMeta === "object") { setWbOrdersMeta(settings.wbOrdersMeta); syncedRef.current.settings.wbOrdersMeta = JSON.stringify(settings.wbOrdersMeta); }
        setLoaded(true); // включаем сохранение ТОЛЬКО после успешной загрузки
      } catch (e) {
        console.error("Ошибка загрузки — сохранение отключено, чтобы не затереть базу:", e);
        // намеренно НЕ ставим loaded=true: пустой стартовый стейт не должен перезаписать БД
      }
    })();
  }, []);

  // сохранение товаров (построчно, только изменённые)
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      const cur = new Map(allProducts.map((p) => [p.id, p]));
      for (const p of allProducts) {
        const js = JSON.stringify(p);
        if (syncedRef.current.products.get(p.id) !== js) {
          dirtyRef.current.products.add(p.id);
          const { error } = await upsertProduct(p);
          if (!error) { syncedRef.current.products.set(p.id, js); dirtyRef.current.products.delete(p.id); }
        }
      }
      for (const id of Array.from(syncedRef.current.products.keys())) {
        if (!cur.has(id)) {
          const { error } = await deleteProductRow(id);
          if (!error) syncedRef.current.products.delete(id);
        }
      }
    }, 600);
    return () => clearTimeout(t);
  }, [allProducts, loaded]);

  // задачи по триггерам этапов партии создаются только вручную — кнопкой «Создать задачи этапа» (createCycleStageTasks)

  // авто-создание задач по триггеру «смена статуса товара»
  // создаётся ОДИН раз при входе в статус (флаг product.trgDone[ruleId]);
  // удаление задачи её не воскрешает; флаг сбрасывается, когда товар выходит
  // из статуса → при повторном входе задача создаётся снова
  useEffect(() => {
    if (!loaded) return;
    const rules = (taskTriggers || []).filter((r) => r && r.enabled && String(r.text || "").trim() && r.statusName);
    if (!rules.length) return;
    let changed = false; const newJobs = [];
    const next = (products || []).map((p) => {
      // учитываем и старый флаг trgFired (миграция), и новый trgDone
      const done = { ...(p.trgFired || {}), ...(p.trgDone || {}) }; let local = false;
      rules.forEach((r) => {
        if (p.status !== r.statusName) { if (done[r.id]) { delete done[r.id]; local = true; } return; }
        if (done[r.id]) return; // этот заход в статус уже обработан
        const title = String(r.text).replace(/\{товар\}/g, p.name || "товар").replace(/\{статус\}/g, r.statusName);
        const type = r.taskType || "product";
        const exists = (jobs || []).some((j) => {
          if (!j || j.deletedAt) return false; // задачи из корзины дублями не считаются
          if (type === "product") return j.productId === p.id && (j.trgId === r.id || j.title === title);
          return jobType(j) !== "product" && j.title === title;
        });
        if (!exists) {
          let date = null, start = null;
          if (r.hasDate) { const s0 = new Date(); const e0 = new Date(); e0.setDate(e0.getDate() + Math.max(1, Number(r.durDays) || 1) - 1); start = isoYMD(s0); date = isoYMD(e0); }
          newJobs.push({ id: uid(), title, type, productId: type === "product" ? p.id : null, trgId: r.id, date, start, done: false, labelId: null, priority: r.priority || "low", assignee: r.assignee || null, tags: [], stage: "wait", checklist: [], note: `Триггер: статус «${r.statusName}»`, createdAt: isoYMD(new Date()), log: [mkLog("created", {}, "system")] });
        }
        done[r.id] = true; local = true; // помечаем заход обработанным (создали или задача уже была)
      });
      if (local) { changed = true; const { trgFired, ...rest } = p; return { ...rest, trgDone: done }; }
      return p;
    });
    if (newJobs.length) setJobs((js) => [...js, ...newJobs]);
    if (changed) { const byId = Object.fromEntries(next.map((x) => [x.id, x])); setProducts((ps) => ps.map((x) => byId[x.id] || x)); } // сливаем в полный список — товары из корзины не теряем
  }, [products, taskTriggers, loaded]);

  // ручное создание задач по этапу (кнопка «создать задачу» в цикле) — в обход дедупа
  const createCycleStageTasks = (batchId, stageId) => {
    const b = (purchaseBatches || []).find((x) => x.id === batchId); if (!b) return;
    const rules = (cycleTriggers || []).filter((r) => r.enabled && r.stageId === stageId && String(r.text || "").trim());
    if (!rules.length) { setToast({ text: "Для этого этапа не настроена автозадача" }); return; }
    const newJobs = []; const firedKeys = [];
    rules.forEach((r) => {
      const title = String(r.text).replace(/\{партия\}/g, b.name || "партия");
      const dd = r.hasDate ? stageTaskDates(b.cycle, stageId, r.durDays, r.dateFrom) : { start: null, date: null };
      const common = { date: dd.date, start: dd.start, done: false, labelId: null, priority: r.priority || "low", assignee: r.assignee || null, tags: [], stage: "wait", checklist: [], note: `Партия: «${b.name || ""}»`, createdAt: isoYMD(new Date()) };
      if (r.scope === "product") (b.items || []).forEach((it) => {
        const jt = String(title).trim();
        const legacy = `${jt} · ${(products.find((p) => p.id === it.productId) || {}).name || ""}`.trim();
        const dup = (jobs || []).some((j) => j && !j.deletedAt && j.productId === it.productId && (j.title === jt || j.title === legacy)) || newJobs.some((j) => j.productId === it.productId && (j.title === jt || j.title === legacy));
        if (!dup) newJobs.push({ id: uid(), title: jt, type: "product", productId: it.productId || null, ...common, log: [mkLog("created", {}, "system")] });
      });
      else {
        // проектная задача с партией в названии (если её там ещё нет)
        const bn = String(b.name || "партия").trim(); const full = title.includes(bn) ? title : `${title} · ${bn}`;
        const dup = (jobs || []).some((j) => j && !j.deletedAt && j.batchId === b.id && (j.title === full || j.title === title)) || newJobs.some((j) => j.batchId === b.id && (j.title === full || j.title === title));
        if (!dup) newJobs.push({ id: uid(), title: full, type: "project", batchId: b.id, productId: null, ...common, log: [mkLog("created", {}, "system")] });
      }
      firedKeys.push(r.id);
    });
    if (!newJobs.length) { setToast({ text: "Задачи этого этапа уже созданы" }); return; }
    setJobs((js) => [...js, ...newJobs]);
    setPurchaseBatches((bs) => bs.map((x) => {
      if (x.id !== batchId) return x;
      const cyc0 = x.cycle || {};
      const f = { ...(cyc0.fired || {}) }; firedKeys.forEach((k) => { f[k] = true; });
      return { ...x, cycle: { ...cyc0, fired: f } };
    }));
    setToast({ text: `Создано задач: ${newJobs.length} · во вкладке «Задачи»` });
  };

  // сохранение общих настроек
  useEffect(() => {
    if (!loaded) return;
    const items = { statuses, warehouses, purchases, purchaseBatches, bloggerDB, razdachDB, defaultTasks, taskLabels, taskTags, taskTriggers, cycleTriggers, analyticsCriteria, kanbanCols, opTypes, opDone, subjects, customDBs, dbColumns, focusLine, focusLines, strategy, duties, agents, profiles, prodCycle, unitConst, wbApiKey, ozCfg, msCfg, wbOrders, wbOrdersMeta, wbAdKey, wbAdSpend, wbAdMeta, wbSales, wbSalesMeta, wbOrdSum, wbOrdSumMeta, rnp: { startDate: rnpStartDate, days: rnpDays } };

    // Сразу (синхронно) помечаем изменённые ключи «грязными», чтобы входящее
    // realtime-эхо старого значения не затёрло свежую правку до её записи в БД.
    for (const [key, value] of Object.entries(items)) {
      try {
        const js = JSON.stringify(value);
        desiredRef.current.settings[key] = js; // фиксируем последнее желаемое значение
        if (syncedRef.current.settings[key] !== js) {
          dirtyRef.current.settings.add(key);
        }
      } catch {}
    }

    const t = setTimeout(async () => {
      for (const [key, value] of Object.entries(items)) {
        try {
          const js = JSON.stringify(value);
          if (syncedRef.current.settings[key] !== js) {
            // Барьер: не затираем непустое сохранённое значение пустым.
            // Спасает данные, если стейт неожиданно опустел (краш/сбой загрузки).
            const prev = syncedRef.current.settings[key];
            const nowEmpty = js === "[]" || js === "{}" || js === '""';
            const prevNonEmpty = prev && prev !== "[]" && prev !== "{}" && prev !== '""' && prev !== "null";
            if (nowEmpty && prevNonEmpty) {
              console.warn(`[Настройки] пропускаю обнуление «${key}» — в базе есть данные, а стейт пуст.`);
              continue;
            }
            dirtyRef.current.settings.add(key);
            const { error } = await upsertSetting(key, value);
            // Снимаем «грязное» только если за время сохранения значение не изменилось,
            // иначе эхо старого значения могло бы затереть свежую правку.
            if (!error) { syncedRef.current.settings[key] = js; if (desiredRef.current.settings[key] === js) dirtyRef.current.settings.delete(key); }
            else console.error(`[Настройки] не сохранилось «${key}»:`, error.message || error, `(размер ${js.length} симв.)`);
          } else {
            dirtyRef.current.settings.delete(key);
          }
        } catch (err) {
          console.error(`[Настройки] сбой при сохранении «${key}»:`, err);
        }
      }
    }, 600);
    return () => clearTimeout(t);
  }, [statuses, warehouses, purchases, purchaseBatches, bloggerDB, razdachDB, defaultTasks, taskLabels, taskTags, taskTriggers, cycleTriggers, analyticsCriteria, kanbanCols, opTypes, opDone, subjects, customDBs, dbColumns, focusLine, focusLines, strategy, duties, agents, profiles, prodCycle, unitConst, wbApiKey, ozCfg, msCfg, wbOrders, wbOrdersMeta, wbAdKey, wbAdSpend, wbAdMeta, wbSales, wbSalesMeta, wbOrdSum, wbOrdSumMeta, rnpStartDate, rnpDays, loaded]);

  // Построчное сохранение задач (таблица jobs). Пишем только изменённые строки,
  // удаляем только исчезнувшие — чужая старая копия массива больше не затирает соседние задачи.
  useEffect(() => {
    if (!loaded) return;
    // синхронно помечаем изменённые/удалённые задачи «грязными» (защита от realtime-эха)
    const cur = {};
    (jobs || []).forEach((j) => { if (j && j.id) cur[j.id] = JSON.stringify(j); });
    desiredJobsRef.current = cur;
    for (const id in cur) { if (syncedJobsRef.current[id] !== cur[id]) dirtyJobsRef.current.add(id); }
    for (const id in syncedJobsRef.current) { if (!(id in cur)) dirtyJobsRef.current.add(id); }

    const t = setTimeout(async () => {
      // upsert изменённых/новых
      for (const j of (jobs || [])) {
        if (!j || !j.id) continue;
        const js = JSON.stringify(j);
        if (syncedJobsRef.current[j.id] === js) continue;
        try {
          const { error } = await upsertJobRow(j);
          if (!error) { syncedJobsRef.current[j.id] = js; if (desiredJobsRef.current[j.id] === js) dirtyJobsRef.current.delete(j.id); }
          else console.error("[Задачи] не сохранилась", j.id, error.message || error);
        } catch (e) { console.error("[Задачи] сбой сохранения", j.id, e); }
      }
      // удаление исчезнувших строк — с барьером против катастрофического обнуления
      const prevCount = Object.keys(syncedJobsRef.current).length;
      const nowCount = Object.keys(desiredJobsRef.current).length;
      if (prevCount > 0 && nowCount === 0) {
        console.warn("[Задачи] пропускаю удаление всех строк — список внезапно пуст (вероятно сбой стейта).");
      } else {
        for (const id of Object.keys(syncedJobsRef.current)) {
          if (id in desiredJobsRef.current) continue;
          try {
            const { error } = await deleteJobRow(id);
            if (!error) { delete syncedJobsRef.current[id]; dirtyJobsRef.current.delete(id); }
            else console.error("[Задачи] не удалилась", id, error.message || error);
          } catch (e) { console.error("[Задачи] сбой удаления", id, e); }
        }
      }
    }, 500);
    return () => clearTimeout(t);
  }, [jobs, loaded]);

  // Миграция/привязка профилей: создаём профили известных пользователей (по раскладке),
  // переиспользуя id существующих исполнителей (чтобы уже проставленные назначения задач не слетели),
  // и гарантируем профиль текущего вошедшего пользователя. Идемпотентно.
  useEffect(() => {
    if (!loaded) return;
    setProfiles((prev) => {
      const list = Array.isArray(prev) ? prev.map((p) => ({ ...p })) : [];
      const hasEmail = (em) => list.some((p) => (p.email || "").toLowerCase() === String(em || "").toLowerCase());
      const peopleByCanon = {};
      (duties.people || []).forEach((p) => { const k = canonName(p.name); if (!(k in peopleByCanon)) peopleByCanon[k] = p; });
      // 1) известные аккаунты из раскладки
      Object.entries(KNOWN_LOGINS).forEach(([email, dispName]) => {
        if (hasEmail(email)) return;
        const src = peopleByCanon[canonName(dispName)];
        list.push({ id: src ? src.id : uid(), email: email.toLowerCase(), name: src ? (src.name || dispName) : dispName, color: src ? (src.color || SWATCHES[list.length % SWATCHES.length]) : SWATCHES[list.length % SWATCHES.length], photo: "" });
      });
      // 2) текущий пользователь (если ещё не заведён)
      if (userEmail && !hasEmail(userEmail)) {
        list.push({ id: uid(), email: String(userEmail).toLowerCase(), name: String(userEmail).split("@")[0], color: SWATCHES[list.length % SWATCHES.length], photo: "" });
      }
      return JSON.stringify(list) === JSON.stringify(prev) ? prev : list;
    });
  }, [loaded, duties, userEmail]);

  // realtime — чужие изменения
  useEffect(() => {
    const unsub = subscribe({
      onProduct: (p) => {
        const np = normalizeProduct(p);
        const js = JSON.stringify(np);
        if (syncedRef.current.products.get(np.id) === js) return;
        if (dirtyRef.current.products.has(np.id)) return;
        syncedRef.current.products.set(np.id, js);
        setProducts((prev) => { const i = prev.findIndex((x) => x.id === np.id); if (i === -1) return [...prev, np]; const c = prev.slice(); c[i] = np; return c; });
      },
      onProductDelete: (id) => { if (dirtyRef.current.products.has(id)) return; syncedRef.current.products.delete(id); setProducts((prev) => prev.filter((x) => x.id !== id)); },
      onJob: (j) => {
        if (!j || !j.id) return;
        const js = JSON.stringify(j);
        if (syncedJobsRef.current[j.id] === js) return;
        if (dirtyJobsRef.current.has(j.id)) return; // своя несохранённая правка — не трогаем
        syncedJobsRef.current[j.id] = js;
        setJobs((prev) => { const i = prev.findIndex((x) => x.id === j.id); if (i === -1) return [...prev, j]; const c = prev.slice(); c[i] = j; return c; });
      },
      onJobDelete: (id) => { if (dirtyJobsRef.current.has(id)) return; delete syncedJobsRef.current[id]; setJobs((prev) => prev.filter((x) => x.id !== id)); },
      onSetting: (key, value) => {
        const js = JSON.stringify(value);
        if (syncedRef.current.settings[key] === js) return;
        if (dirtyRef.current.settings.has(key)) return;
        // Защита: не даём входящему пустому/обрезанному значению затереть непустой
        // локальный список. Это ловит и эхо старого состояния, и усечённый realtime —
        // Supabase присылает value=null, когда запись больше лимита (крупные таблицы,
        // например комиссии ВБ на тысячи предметов).
        const liveLists = listSettingsRef.current;
        if (key in liveLists) {
          const incoming = Array.isArray(value) ? value : [];
          if (incoming.length === 0 && (liveLists[key] || []).length > 0) return;
        }
        // Нормализуемые настройки сверяем и храним в syncedRef в НОРМАЛИЗОВАННОМ виде.
        // Иначе (норм. ≠ сырое) каждая вкладка пере-сохраняет только что полученное,
        // начинается шторм эха между вкладками — правки лагают и затираются.
        if (key === "strategy") { if (value && typeof value === "object") { const ns = normStrategy(value); syncedRef.current.settings.strategy = JSON.stringify(ns); setStrategy(ns); } return; }
        if (key === "agents") { if (Array.isArray(value)) { syncedRef.current.settings.agents = JSON.stringify(value); setAgents(value); } return; }
        if (key === "duties") { if (value && typeof value === "object") { const nd = normDuties(value); syncedRef.current.settings.duties = JSON.stringify(nd); setDuties(nd); } return; }
        if (key === "wbWay") { if (value && typeof value === "object") setWbWay(value); return; }
        if (key === "wbRating") { if (value && typeof value === "object") setWbRating(value); return; }
        if (key === "tgLinks") { if (value && typeof value === "object") setTgLinks(value); return; }
        if (key === "tgBot") { if (typeof value === "string") setTgBot(value); return; }
        if (key === "profiles") { if (Array.isArray(value)) { const np = normProfiles(value); syncedRef.current.settings.profiles = JSON.stringify(np); setProfiles(np); } return; }
        if (key === "prodCycle") { if (value && typeof value === "object") { const nc = normCycle(value); syncedRef.current.settings.prodCycle = JSON.stringify(nc); setProdCycle(nc); } return; }
        syncedRef.current.settings[key] = js;
        if (key === "statuses") setStatuses(value);
        else if (key === "warehouses") setWarehouses(value);
        else if (key === "purchases") setPurchases(value);
        else if (key === "purchaseBatches") setPurchaseBatches(value || []);
        else if (key === "bloggerDB") setBloggerDB(value);
        else if (key === "razdachDB") setRazdachDB(value);
        else if (key === "defaultTasks") setDefaultTasks(value || []);
        else if (key === "taskLabels") setTaskLabels(value || []);
        else if (key === "taskTags") setTaskTags(value || []);
        else if (key === "taskTriggers") setTaskTriggers(normTaskTriggers(value));
        else if (key === "cycleTriggers") setCycleTriggers(normCycleTriggers(value));
        else if (key === "analyticsCriteria") { if (Array.isArray(value) && value.length) setAnalyticsCriteria(value); }
        else if (key === "kanbanCols") { if (Array.isArray(value) && value.length) setKanbanCols(value); }
        else if (key === "opTypes") setOpTypes(value || []);
        else if (key === "opDone") setOpDone(value || {});
        else if (key === "subjects") setSubjects(value || []);
        else if (key === "customDBs") setCustomDBs(value || []);
        else if (key === "dbColumns") setDbColumns(value || {});
        else if (key === "unitConst") setUnitConst((c) => ({ ...c, ...(value || {}) }));
        else if (key === "wbApiKey") setWbApiKey(value);
        else if (key === "focusLines") setFocusLines(value && typeof value === "object" ? value : {});
        else if (key === "focusLine") setFocusLine(typeof value === "string" ? value : "");
        else if (key === "wbOrders") setWbOrders(value || {});
        else if (key === "wbOrdersMeta") setWbOrdersMeta(value || {});
        else if (key === "wbSales") setWbSales(value || {});
        else if (key === "wbSalesMeta") setWbSalesMeta(value || {});
        else if (key === "wbOrdSum") setWbOrdSum(value || {});
        else if (key === "wbOrdSumMeta") setWbOrdSumMeta(value || {});
        else if (key === "wbAdKey") setWbAdKey(value);
        else if (key === "ozCfg") setOzCfg(value && typeof value === "object" ? value : {});
        else if (key === "ozSum") setOzData(value && typeof value === "object" ? value : null);
        else if (key === "msCfg") setMsCfg(value && typeof value === "object" ? value : {});
        else if (key === "msStock") setMsData(value && typeof value === "object" ? value : null);
        else if (key === "ozAd") setOzAd(value && typeof value === "object" ? value : null);
        else if (key === "wbAdSpend") setWbAdSpend(value || {});
        else if (key === "wbAdMeta") setWbAdMeta(value || {});
        else if (key === "rnp") { if (value.startDate) setRnpStartDate(value.startDate); if (value.days) setRnpDays(value.days); }
      },
    });
    return unsub;
  }, []);

  // ширина видимой области для раскрытой панели
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setPanelW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // авто-скрытие всплывающего подтверждения
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2800); return () => clearTimeout(t); }, [toast]);

  /* --- товары --- */
  const addProduct = () =>
    setProducts((p) => [
      ...p,
      normalizeProduct({ status: statuses[0]?.name || "", createdAt: Date.now() }),
    ]);

  // добавить товар в выбранную партию закупки
  const addProductToBatch = (batchId, productId) => {
    const prod = products.find((x) => x.id === productId);
    setPurchaseBatches((bs) => bs.map((b) => {
      if (b.id !== batchId) return b;
      if ((b.items || []).some((it) => it.productId === productId)) return b; // уже есть
      return { ...b, items: [...(b.items || []), { id: uid(), productId, priceCny: "", qty: "" }] };
    }));
    const bn = purchaseBatches.find((b) => b.id === batchId)?.name || "партию";
    setToast({ text: `«${prod?.name || "Товар"}» добавлен в «${bn}»` });
    setSupplyMenu(null);
  };
  // создать новую партию сразу с товаром
  const addBatchWithProduct = (productId) => {
    const prod = products.find((x) => x.id === productId);
    const id = uid();
    const b = { id, name: `Партия #${purchaseBatches.length + 1}`, status: "draft", cny: unitConst.cny || "", usd: unitConst.usd || "", cargo: unitConst.cargo || "", commission: unitConst.commission || "", insurance: unitConst.insurance || "", items: [{ id: uid(), productId, priceCny: "", qty: "" }], payments: [] };
    setPurchaseBatches((bs) => [...bs, b]);
    setToast({ text: `«${prod?.name || "Товар"}» добавлен в «${b.name}»` });
    setSupplyMenu(null);
  };
  // патч полей товара внутри партии (фонд маркетинга: mktDrr, mktPlanPrice, mktSpent)
  const setBatchItemFields = (batchId, productId, patch) =>
    setPurchaseBatches((bs) => bs.map((b) => {
      if (b.id !== batchId) return b;
      return { ...b, items: (b.items || []).map((it) => (it.productId === productId ? { ...it, ...patch } : it)) };
    }));
  const updateProduct = (id, field, value) =>
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, [field]: value } : x)));
  const setProductTasks = (id, tasks) =>
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, tasks } : x)));
  const setProductCompetitors = (id, competitors) =>
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, competitors } : x)));
  const setProductSeasonality = (id, seasonality) =>
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, seasonality } : x)));
  const setProductAnalytics = (id, analytics) =>
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, analytics } : x)));
  const upsertJob = (job) => setJobs((js) => {
    const i = js.findIndex((j) => j.id === job.id);
    const prev = i === -1 ? null : js[i];
    if (prev && prev.deletedAt) return js; // задача в корзине — правки (в т.ч. запоздалый автосейв редактора) не воскрешают её
    const events = diffJobEvents(prev, job, meRef.current || null); // автор ручной правки — текущий пользователь (или «Вы»)
    const baseLog = (prev && Array.isArray(prev.log) ? prev.log : (Array.isArray(job.log) ? job.log : [])); // лог ведём от сохранённого — автосейв по клавише не теряет события
    const nextJob = events.length ? { ...job, log: [...baseLog, ...events].slice(-JOB_LOG_MAX) } : { ...job, log: baseLog };
    if (i === -1) return [...js, nextJob];
    const c = js.slice(); c[i] = nextJob; return c;
  });
  const removeJob = (id) => setJobs((js) => js.filter((j) => j.id !== id));
  // Корзина: задача не стирается, а помечается deletedAt (хранится 30 дней, видна всем)
  const trashJob = (id) => {
    const j = jobs.find((x) => x.id === id);
    setJobs((js) => js.map((x) => x.id === id ? { ...x, deletedAt: new Date().toISOString(), deletedBy: (myProfile && myProfile.id) || userEmail || null } : x));
    if (j) setUndoDel({ id, title: j.title || "Без названия" });
  };
  const restoreJob = (id) => setJobs((js) => js.map((x) => { if (x.id !== id) return x; const { deletedAt, deletedBy, ...rest } = x; return rest; }));
  useEffect(() => { if (!undoDel) return; const t = setTimeout(() => setUndoDel(null), 8000); return () => clearTimeout(t); }, [undoDel]);
  // автоочистка: старше 30 дней удаляем окончательно
  useEffect(() => {
    if (!loaded) return;
    const lim = Date.now() - 30 * 86400000;
    const old = jobs.filter((j) => j && j.deletedAt && new Date(j.deletedAt).getTime() < lim).map((j) => j.id);
    if (old.length) setJobs((js) => js.filter((j) => !old.includes(j.id)));
    const oldP = allProducts.filter((p) => p && p.deletedAt && new Date(p.deletedAt).getTime() < lim).map((p) => p.id);
    if (oldP.length) setProducts((ps) => ps.filter((p) => !oldP.includes(p.id)));
    setDuties((d0) => { const keep = (d0.functions || []).filter((f) => !(f.deletedAt && new Date(f.deletedAt).getTime() < lim)); return keep.length === (d0.functions || []).length ? d0 : { ...d0, functions: keep }; });
  }, [loaded]); // eslint-disable-line
  const upsertOpType = (o) => setOpTypes((list) => { const i = (list || []).findIndex((x) => x.id === o.id); if (i === -1) return [...(list || []), o]; const c = list.slice(); c[i] = o; return c; });
  const removeOpType = (id) => setOpTypes((list) => (list || []).filter((x) => x.id !== id));
  const toggleOpDone = (opId, ds) => setOpDone((m) => { const day = { ...((m || {})[opId] || {}) }; if (day[ds]) delete day[ds]; else day[ds] = true; return { ...(m || {}), [opId]: day }; });
  // Корзина товаров: не стираем, а помечаем deletedAt (хранится 30 дней, видна всем)
  const removeProduct = (id) => {
    const pr = allProducts.find((x) => x.id === id);
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, deletedAt: new Date().toISOString(), deletedBy: (myProfile && myProfile.id) || userEmail || null } : x)));
    if (pr) setUndoDel({ id, title: pr.name || "Товар", kind: "product" });
  };
  const restoreProduct = (id) => setProducts((p) => p.map((x) => { if (x.id !== id) return x; const { deletedAt, deletedBy, ...rest } = x; return rest; }));
  const purgeProducts = (ids) => setProducts((p) => p.filter((x) => !ids.includes(x.id)));
  // Корзина функций (лежат внутри справочника обязанностей)
  // Блоки сервиса: рисуются и во вкладке, и в окне из «Рабочей среды» задачи
  const blockEl = (id) => {
    if (id === "agents") return (
          <AgentsBoard
            agents={agents}
            onChange={setAgents}
            people={profiles}
            onCreateTask={(payload) => {
              const p = payload || {};
              const id = uid();
              const job = { id, title: (p.title || "Задача").slice(0, 200), date: null, start: null, done: false, labelId: null, productId: null, priority: "med", tags: [], stage: "wait", note: p.note || "", createdAt: isoYMD(new Date()), checklist: Array.isArray(p.checklist) ? p.checklist.map((c) => ({ id: uid(), text: (c && c.text) || "", done: !!(c && c.done) })).filter((c) => c.text) : [] };
              upsertJob(job); setActiveTab("tasks"); setJobEditor({ ...job });
              return id;
            }}
            onOpenTask={(id) => { const job = liveJobs.find((j) => j.id === id); if (!job) return false; setActiveTab("tasks"); setJobEditor({ ...job }); return true; }}
          />
    );
    if (id === "duties") return (
          <DutiesBoard
            duties={duties}
            onChange={setDuties}
            deletedBy={(myProfile && myProfile.id) || userEmail || null}
            onTrashed={(f) => setUndoDel({ id: f.id, title: f.name || "Функция", kind: "function" })}
            opNames={(opTypes || []).map((o) => o.name)}
            onAddOp={(name, recur) => {
              const t = (name || "").trim();
              if (!t) return "empty";
              if ((opTypes || []).some((o) => o.name === t)) return "exists";
              setOpTypes((list) => [...(list || []), { id: uid(), name: t, recur: normRecur(recur) }]);
              return "added";
            }}
          />
    );
    if (id === "strategy") return (
          <StrategySection
            strategy={strategy}
            onChange={setStrategy}
            onCreateTask={(payload) => {
              const p = payload || {};
              const id = uid();
              const job = { id, title: (p.title || "Задача").slice(0, 200), date: p.date || null, start: null, done: false, labelId: null, productId: null, priority: "low", tags: [], stage: "wait", note: p.note || "", createdAt: isoYMD(new Date()), checklist: Array.isArray(p.checklist) ? p.checklist.map((c) => ({ id: uid(), text: (c && c.text) || "", done: !!(c && c.done) })).filter((c) => c.text) : [] };
              upsertJob(job); setActiveTab("tasks"); setJobEditor({ ...job });
              return id;
            }}
            onOpenTask={(id) => { const job = liveJobs.find((j) => j.id === id); if (!job) return false; setActiveTab("tasks"); setJobEditor({ ...job }); return true; }}
          />
    );
    return null;
  };
  const [workWin, setWorkWin] = useState(null); // окно блока/карты, открытое из задачи
  const trashFunctions = useMemo(() => ((duties && duties.functions) || []).filter((f) => f && f.deletedAt).sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))), [duties]);
  const restoreFunction = (id) => setDuties((d0) => ({ ...d0, functions: d0.functions.map((f) => { if (f.id !== id) return f; const { deletedAt, deletedBy, ...rest } = f; return { ...rest, areaId: d0.areas.some((a) => a.id === rest.areaId) ? rest.areaId : null }; }) }));
  const purgeFunctions = (ids) => setDuties((d0) => ({ ...d0, functions: d0.functions.filter((f) => !ids.includes(f.id)) }));
  const openTrash = (sec) => { setTrashSec(sec); setTrashOpen(true); };

  /* --- картинки --- */
  const triggerUpload = (id) => {
    uploadTarget.current = id;
    fileInputRef.current?.click();
  };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    const id = uploadTarget.current;
    e.target.value = "";
    if (!file || !id) return;
    try {
      updateProduct(id, "image", await fileToThumb(file));
    } catch {}
  };

  /* --- блоки-матрицы: записи по товару (entries) --- */
  const editEntries = (pid, gid, fn) =>
    setProducts((ps) =>
      ps.map((p) => {
        if (p.id !== pid) return p;
        const block = p.blocks[gid] || { entries: [] };
        return { ...p, blocks: { ...p.blocks, [gid]: { entries: fn(block.entries) } } };
      })
    );
  const addEntry = (pid, gid) =>
    editEntries(pid, gid, (es) => [...es, { id: uid(), values: {} }]);
  const removeEntry = (pid, gid, eid) =>
    editEntries(pid, gid, (es) => es.filter((e) => e.id !== eid));
  const setEntryVal = (pid, gid, eid, mid, val) =>
    editEntries(pid, gid, (es) =>
      es.map((e) => (e.id === eid ? { ...e, values: { ...e.values, [mid]: val } } : e))
    );

  /* --- метрики блока (общие для всех товаров) --- */
  const editMetrics = (gid, fn) =>
    setMetricsByGroup((m) => ({ ...m, [gid]: fn(m[gid] || []) }));
  const addMetric = (gid) =>
    editMetrics(gid, (ms) => [...ms, { id: uid(), label: "Новая метрика" }]);
  const removeMetric = (gid, mid) =>
    editMetrics(gid, (ms) => ms.filter((x) => x.id !== mid));
  const renameMetric = (gid, mid, label) =>
    editMetrics(gid, (ms) => ms.map((x) => (x.id === mid ? { ...x, label } : x)));

  /* --- план отгрузок: размеры (по товару) --- */
  const editSizes = (pid, fn) =>
    setProducts((ps) => ps.map((p) => (p.id === pid ? { ...p, plan: { ...(p.plan || {}), sizes: fn(p.plan?.sizes || []) } } : p)));
  const addSize = (pid) =>
    editSizes(pid, (ss) => [...ss, { id: uid(), name: "", total: "", toShip: "", qty: {} }]);
  const removeSize = (pid, sid) => editSizes(pid, (ss) => ss.filter((s) => s.id !== sid));
  const setSize = (pid, sid, field, val) =>
    editSizes(pid, (ss) => ss.map((s) => (s.id === sid ? { ...s, [field]: val } : s)));
  const setSizes = (pid, arr) => editSizes(pid, () => arr);
  const setPlanField = (pid, field, val) =>
    setProducts((ps) => ps.map((p) => (p.id === pid ? { ...p, plan: { ...(p.plan || {}), [field]: val } } : p)));
  const setSizeQty = (pid, sid, whid, qty) =>
    editSizes(pid, (ss) => ss.map((s) => (s.id === sid ? { ...s, qty: { ...s.qty, [whid]: qty } } : s)));

  /* --- склады (общие) --- */
  const addWarehouse = () => setWarehouses((w) => [...w, { id: uid(), name: "Новый склад", region: "" }]);
  const removeWarehouse = (id) => setWarehouses((w) => w.filter((x) => x.id !== id));
  const setWarehouse = (id, field, val) =>
    setWarehouses((w) => w.map((x) => (x.id === id ? { ...x, [field]: val } : x)));

  /* --- закупки (отдельный список) --- */
  const addPurchase = () => setPurchases((p) => [...p, { id: uid(), image: null, subject: "", name: "" }]);
  const updatePurchase = (id, field, val) =>
    setPurchases((p) => p.map((x) => (x.id === id ? { ...x, [field]: val } : x)));
  const removePurchase = (id) => setPurchases((p) => p.filter((x) => x.id !== id));
  const transferPurchase = (id) => {
    const item = purchases.find((x) => x.id === id);
    if (!item) return;
    setProducts((ps) => [...ps, normalizeProduct({ image: item.image, name: item.name, status: statuses[0]?.name || "", createdAt: Date.now() })]);
    setPurchases((p) => p.filter((x) => x.id !== id));
  };

  /* --- РНП / Гант (данные по товару) --- */
  const editRnp = (pid, fn) =>
    setProducts((ps) => ps.map((p) => (p.id !== pid ? p : { ...p, rnp: fn(p.rnp) })));
  const setRnpCell = (pid, key, val) =>
    editRnp(pid, (r) => ({ ...r, cells: { ...r.cells, [key]: val } }));
  const setRnpEntries = (pid, key, arr) =>
    editRnp(pid, (r) => ({ ...r, entries: { ...r.entries, [key]: arr } }));
  const setRnpFill = (pid, key, color) =>
    editRnp(pid, (r) => {
      const fills = { ...r.fills };
      if (color) fills[key] = color; else delete fills[key];
      return { ...r, fills };
    });
  const setRnpFlag = (pid, flag, val) =>
    editRnp(pid, (r) => ({ ...r, flags: { ...r.flags, [flag]: val } }));
  const setRnpFunds = (pid, funds) => editRnp(pid, (r) => ({ ...r, funds }));
  const setRnpBudget = (pid, val) =>
    editRnp(pid, (r) => ({ ...r, budget: { ...r.budget, allocated: val } }));

  /* --- Календарь производства (данные по товару): процесс «Логистика» с компонентами --- */
  const editCal = (pid, fn) =>
    setProducts((ps) => ps.map((p) => (p.id !== pid ? p : { ...p, calendar: fn(normalizeCalendar(p.calendar)) })));
  const setCalEntry = (pid, val) => editCal(pid, (c) => ({ ...c, entry: val }));
  const setCalStart = (pid, val) => editCal(pid, (c) => ({ ...c, start: val }));
  const setCalName = (pid, val) => editCal(pid, (c) => ({ ...c, name: val }));
  const setCalBuffer = (pid, val) => editCal(pid, (c) => ({ ...c, buffer: val }));
  const setCalComponents = (pid, components) => editCal(pid, (c) => ({ ...c, components }));
  // копировать календарь из товара-источника в целевой (одинаковые модели разных цветов)
  const copyCalendarFrom = (targetPid, sourcePid) => {
    const src = products.find((x) => x.id === sourcePid);
    if (!src) return;
    const c = normalizeCalendar(src.calendar);
    editCal(targetPid, () => ({
      entry: c.entry || "",
      start: c.start || "",
      name: c.name || "Логистика",
      buffer: c.buffer || 0,
      components: (c.components || []).map((s) => ({ ...s, id: uid() })),
    }));
  };

  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  // Сколько раз блогер встречается в записях «Блогеры» по всем товарам
  const bloggerIntegrationCount = (name) => {
    const target = (name || "").trim();
    if (!target) return 0;
    let n = 0;
    for (const p of products) {
      const entries = p.rnp?.entries || {};
      for (const [k, arr] of Object.entries(entries)) {
        if (!k.startsWith("bloggers:") || k.endsWith(":_ranges")) continue;
        for (const e of arr || []) if ((e.who || "").trim() === target) n++;
      }
    }
    return n;
  };

  // Загрузка выкупов и возвратов из WB (статистика продаж): один запрос на весь период, лимит WB — 1 в минуту
  const fetchWbSales = async () => {
    const key = wbApiKey || wbAdKey;
    if (!key) return;
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const addD = (ds, n) => { const d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
    const today = new Date(); today.setHours(0, 0, 0, 0); const todayStr = iso(today);
    const allDays = []; { const cur = new Date(rnpStartDate + "T00:00:00"); for (let i = 0; i < rnpDays && cur <= today; i++) { allDays.push(iso(cur)); cur.setDate(cur.getDate() + 1); } }
    const todo = allDays.filter((day) => !(wbSalesMeta[day] && wbSalesMeta[day] >= addD(day, 3)));
    if (!todo.length) return;
    const dateFrom = todo[0];
    try {
      let data = null;
      for (let a = 0; a < 2 && !data; a++) {
        const resp = await fetch("https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/wb-sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: key, dateFrom }) });
        if (resp.status === 429) { await new Promise((r) => setTimeout(r, 62000)); continue; }
        if (!resp.ok) throw new Error("wb-sales " + resp.status);
        data = await resp.json();
      }
      if (!data) return;
      const next = {}; for (const [k, v] of Object.entries(wbSales)) { if ((k.split(":")[1] || "") < dateFrom) next[k] = v; }
      Object.assign(next, data);
      const meta = { ...wbSalesMeta }; for (const d of allDays) if (d >= dateFrom) meta[d] = todayStr;
      setWbSales(next); setWbSalesMeta(meta);
      try { await Promise.all([upsertSetting("wbSales", next), upsertSetting("wbSalesMeta", meta)]); syncedRef.current.settings.wbSales = JSON.stringify(next); syncedRef.current.settings.wbSalesMeta = JSON.stringify(meta); } catch (_) {}
    } catch (e) { console.warn("[WB] выкупы не загрузились:", e); }
  };

  // Сумма заказов по дням из WB (заказы, priceWithDisc): один запрос на весь период, лимит WB — 1 в минуту
  const fetchWbOrdSum = async () => {
    const key = wbApiKey || wbAdKey;
    if (!key) return;
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const addD = (ds, n) => { const d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
    const today = new Date(); today.setHours(0, 0, 0, 0); const todayStr = iso(today);
    const allDays = []; { const cur = new Date(rnpStartDate + "T00:00:00"); for (let i = 0; i < rnpDays && cur <= today; i++) { allDays.push(iso(cur)); cur.setDate(cur.getDate() + 1); } }
    const oldFmt = wbOrdSumMeta.__v !== 3; // v3: сумма и число заказов из аналитики WB (как в кабинете) — один раз перезагружаем весь период
    const todo = allDays.filter((day) => oldFmt || !(wbOrdSumMeta[day] && wbOrdSumMeta[day] >= addD(day, 3)));
    if (!todo.length) return;
    const dateFrom = todo[0];
    try {
      let data = null;
      for (let a = 0; a < 3 && !data; a++) {
        const resp = await fetch("https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/wb-orders-sum", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: key, dateFrom }) });
        if (resp.status === 429) { await new Promise((r) => setTimeout(r, 62000)); continue; }
        if (!resp.ok) throw new Error("wb-orders-sum " + resp.status);
        data = await resp.json();
      }
      if (!data) return;
      // сумма и число заказов — из аналитики WB (воронка продаж), как в кабинете; статистика WB неполная и без отменённых
      let funnelOk = false;
      try {
        const nmIds = [...new Set(products.map((p) => parseInt(p.wb)).filter((n) => n > 0))];
        if (nmIds.length) {
          const fdata = {}; let ws = dateFrom > addD(todayStr, -7) ? dateFrom : addD(todayStr, -7); /* аналитика WB отдаёт историю только за последние 7 дней */
          while (ws <= todayStr) {
            let we = addD(ws, 6); if (we > todayStr) we = todayStr;
            let part = null;
            for (let a = 0; a < 2 && !part; a++) {
              const fr = await fetch("https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/wb-funnel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: key, nmIds, start: ws, end: we }) });
              if (fr.status === 429) { await new Promise((r) => setTimeout(r, 30000)); continue; }
              if (!fr.ok) throw new Error("wb-funnel " + fr.status);
              part = await fr.json();
            }
            if (!part) throw new Error("wb-funnel: нет ответа");
            Object.assign(fdata, part);
            ws = addD(we, 1);
          }
          Object.assign(data, fdata); funnelOk = Object.keys(fdata).length > 0;
        }
      } catch (e) { console.warn("[WB] воронка заказов не загрузилась:", e); }
      const next = {}; for (const [k, v] of Object.entries(wbOrdSum)) { if ((k.split(":")[1] || "") < dateFrom) next[k] = v; }
      Object.assign(next, data);
      const meta = { ...wbOrdSumMeta }; if (funnelOk) meta.__v = 3; /* v3 только если воронка загрузилась */ for (const d of allDays) if (d >= dateFrom) meta[d] = todayStr;
      setWbOrdSum(next); setWbOrdSumMeta(meta);
      try { await Promise.all([upsertSetting("wbOrdSum", next), upsertSetting("wbOrdSumMeta", meta)]); syncedRef.current.settings.wbOrdSum = JSON.stringify(next); syncedRef.current.settings.wbOrdSumMeta = JSON.stringify(meta); } catch (_) {}
    } catch (e) { console.warn("[WB] сумма заказов не загрузилась:", e); }
  };

  // Загрузка заказов из WB API
  const fetchWbOrders = async () => {
    if (!wbApiKey) { setSettingsTab("wbapi"); setSettingsOpen(true); return; }
    const nmIdList = products.map((p) => parseInt(p.wb)).filter((n) => n > 0);
    if (nmIdList.length === 0) { alert("Нет артикулов ВБ — заполните столбец «Артикул ВБ»."); return; }

    const iso = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    // прибавить N дней к строке "YYYY-MM-DD" → строка
    const addDaysStr = (dayStr, n) => {
      const d = new Date(dayStr + "T00:00:00");
      d.setDate(d.getDate() + n);
      return iso(d);
    };

    // список дней: от начала РНП до сегодня (не дальше)
    const allDays = [];
    const cur = new Date(rnpStartDate + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = iso(today);
    for (let i = 0; i < rnpDays && cur <= today; i++) {
      allDays.push(iso(cur));
      cur.setDate(cur.getDate() + 1);
    }
    if (allDays.length === 0) { alert("Нечего загружать: период начинается в будущем."); return; }

    const merged = { ...wbOrders };
    const meta = { ...wbOrdersMeta };

    // Сколько дней после даты заказа WB считается «дозаполняющим»
    // статистику. Пока не прошло — день не финальный.
    const STALE_DAYS = 3;

    // День финальный (можно доверять кешу навсегда), только если:
    //  1) он есть в кеше,
    //  2) его цифру мы забрали не раньше, чем через STALE_DAYS после самой даты дня.
    // Это не зависит от того, как давно вы заходили: незрелый день
    // перезапросится хоть через день, хоть через месяц — до тех пор,
    // пока не будет получен «созревшим».
    const isFinal = (day) => {
      if (nmIdList.some((nm) => merged[`${nm}:${day}`] === undefined)) return false;
      const fetchedOn = meta[day];
      if (!fetchedOn) return false; // старый кеш без метки — перепроверить
      return fetchedOn >= addDaysStr(day, STALE_DAYS);
    };

    const daysToFetch = allDays.filter((day) => !isFinal(day));
    if (daysToFetch.length === 0) { fetchWbSales(); fetchWbOrdSum(); return; }

    setWbLoading(true);

    // Дожимаем дни в несколько проходов: WB иногда режет по rate-limit,
    // и часть дней падает. Повторяем, пока все не заполнятся или не кончатся попытки.
    let queue = [...daysToFetch];
    const totalPlanned = queue.length;
    let doneCount = 0;
    setWbProgress({ done: 0, total: totalPlanned });

    for (let pass = 0; pass < 4 && queue.length > 0; pass++) {
      const stillFailed = [];
      const pauseBase = 250 + pass * 300; // с каждым проходом бережнее к лимиту

      for (const day of queue) {
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try {
            const resp = await fetch("https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/wb-orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ apiKey: wbApiKey, day, nmIds: nmIdList }),
            });
            if (resp.status === 429) { await new Promise((r) => setTimeout(r, 2500)); continue; }
            if (resp.ok) {
              Object.assign(merged, await resp.json());
              meta[day] = todayStr;
              setWbOrders({ ...merged });
              ok = true;
            }
          } catch (_) { /* сеть — попробуем в следующем проходе */ }
        }
        if (ok) { doneCount++; setWbProgress({ done: doneCount, total: totalPlanned }); }
        else stillFailed.push(day);
        await new Promise((r) => setTimeout(r, pauseBase));
      }

      queue = stillFailed;
      if (queue.length > 0) await new Promise((r) => setTimeout(r, 1500)); // пауза между проходами
    }

    const failed = queue; // что не добрали за все проходы

    setWbOrdersMeta({ ...meta });
    setWbLoading(false);
    setWbProgress(null);

    // Сохраняем кеш и метки сразу, не полагаясь на debounce автосохранения
    try {
      const [r1, r2] = await Promise.all([
        upsertSetting("wbOrders", merged),
        upsertSetting("wbOrdersMeta", meta),
      ]);
      if (r1.error) console.error("[WB] кеш заказов не сохранился:", r1.error.message || r1.error);
      else syncedRef.current.settings.wbOrders = JSON.stringify(merged);
      if (r2.error) console.error("[WB] метки дат не сохранились:", r2.error.message || r2.error);
      else syncedRef.current.settings.wbOrdersMeta = JSON.stringify(meta);
    } catch (e) {
      console.error("[WB] кеш заказов не сохранился:", e);
    }

    fetchWbSales(); fetchWbOrdSum(); // заодно обновляем выкупы и сумму заказов
    if (failed.length) {
      console.warn(`[WB] не добрали ${failed.length} дней после 4 проходов: ${failed.join(", ")}`);
    }
  };
  const expandAll = () => setExpanded(Object.fromEntries(products.map((p) => [p.id, true])));
  const collapseAll = () => setExpanded({});
  const statusColor = (name) => statuses.find((s) => s.name === name)?.color || "#a3a3a3";

  // Загрузка фактического расхода внутренней рекламы из WB (ключ «Продвижение»)
  const fetchWbAd = async () => {
    if (!wbAdKey) { setSettingsTab("wbapi"); setSettingsOpen(true); return; }
    if (wbAdLoading) return;
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const addD = (ds, n) => { const d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
    const today = new Date(); today.setHours(0, 0, 0, 0); const todayStr = iso(today);
    const allDays = []; { const cur = new Date(rnpStartDate + "T00:00:00"); for (let i = 0; i < rnpDays && cur <= today; i++) { allDays.push(iso(cur)); cur.setDate(cur.getDate() + 1); } }
    // день «созрел», если забрали его не раньше чем через 3 дня после даты
    const todo = allDays.filter((day) => !(wbAdMeta[day] && wbAdMeta[day] >= addD(day, 3)));
    if (!todo.length) { setWbAdMsg("Всё актуально"); return; }
    setWbAdLoading(true); setWbAdMsg("Загружаю…");
    const FN = "https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/wb-adv";
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const call = async (body) => {
      for (let a = 0; a < 4; a++) {
        const resp = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: wbAdKey, ...body }) });
        if (resp.status === 429) { await sleep(25000); continue; }
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || ("Ошибка " + resp.status));
        return data;
      }
      throw new Error("WB ограничил частоту запросов, попробуйте через минуту");
    };
    try {
      const { ids = [] } = await call({ action: "ids" });
      const spend = { ...wbAdSpend }; const meta = { ...wbAdMeta };
      const first = todo[0], last = todo[todo.length - 1];
      const windows = []; for (let s0 = first; s0 <= last; s0 = addD(s0, 31)) { const e0 = addD(s0, 30); windows.push([s0, e0 > last ? last : e0]); }
      let calls = 0; const totalCalls = windows.length * Math.max(1, Math.ceil(ids.length / 50));
      for (const [from, to] of windows) {
        const acc = {};
        for (let i = 0; i < Math.max(1, Math.ceil(ids.length / 50)); i++) {
          const batch = ids.slice(i * 50, i * 50 + 50);
          if (batch.length) { if (calls > 0) await sleep(21000); const r = await call({ ids: batch, from, to }); for (const [k, v] of Object.entries(r)) acc[k] = Math.round(((acc[k] || 0) + v) * 100) / 100; }
          calls++; setWbAdMsg(`Загружаю… ${calls} из ${totalCalls}`);
        }
        const dset = new Set(); for (let d = from; d <= to; d = addD(d, 1)) dset.add(d);
        for (const k of Object.keys(spend)) if (dset.has(k.split(":")[1])) delete spend[k];
        Object.assign(spend, acc); for (const d of dset) meta[d] = todayStr;
        setWbAdSpend({ ...spend }); setWbAdMeta({ ...meta });
      }
      try { await Promise.all([upsertSetting("wbAdSpend", spend), upsertSetting("wbAdMeta", meta)]); syncedRef.current.settings.wbAdSpend = JSON.stringify(spend); syncedRef.current.settings.wbAdMeta = JSON.stringify(meta); } catch (_) {}
      setWbAdMsg("✓ Реклама загружена");
    } catch (e) { setWbAdMsg("Ошибка: " + (e.message || e)); }
    setWbAdLoading(false);
  };
  const fetchWbAdRef = useRef(fetchWbAd); fetchWbAdRef.current = fetchWbAd;
  const adAutoRef = useRef(false);
  useEffect(() => {
    if (!loaded || adAutoRef.current || !wbAdKey) return;
    if (!products.some((p) => parseInt(p.wb) > 0)) return;
    adAutoRef.current = true; fetchWbAdRef.current();
  }, [loaded, wbAdKey, products]);

  // Автообновление заказов при открытии: один раз после загрузки данных,
  // если задан ключ и есть товары. Свежие дни перезапросятся, старые — из кеша.
  const fetchWbRef = useRef(fetchWbOrders);
  fetchWbRef.current = fetchWbOrders;
  const autoRefreshedRef = useRef(false);
  useEffect(() => {
    if (!loaded || autoRefreshedRef.current) return;
    if (!wbApiKey) return;
    if (!products.some((p) => parseInt(p.wb) > 0)) return;
    autoRefreshedRef.current = true;
    fetchWbRef.current();
  }, [loaded, wbApiKey, products]);

  /* --- группы / раскладка --- */
  const tabGroups = GROUPS.filter((g) => g.tab === activeTab);
  const visibleGroups = tabGroups.filter((g) => g.kind === "gantt" || g.kind === "calendar" || enabled[g.id]);
  const columnGroups = visibleGroups.filter((g) => g.kind === "columns");
  // единые константы (из шестерёнки) подставляются в каждый товар перед расчётом
  const subjMap = useMemo(() => { const m = new Map(); (subjects || []).forEach((s) => m.set(s.name, s.commission)); return m; }, [subjects]);
  const subjectComm = (name) => (subjMap.has(name) ? subjMap.get(name) : "");
  const withConst = (p) => ({ ...p, commission: subjectComm(p.subject), acquiring: unitConst.acqWb, acquiringOz: unitConst.acqOz, whCoeff: unitConst.whCoeffWb, taxRate: unitConst.tax, taxRateOz: unitConst.tax, cny: unitConst.cny, usd: unitConst.usd, cargo: unitConst.cargo });
  // с учётом скрытых столбцов (фильтр столбцов)
  const columnGroupsView = columnGroups
    .map((g) => ({ ...g, allCols: g.columns, columns: g.columns.filter((c) => !hiddenCols[g.id + ":" + c.id]) }))
    .filter((g) => g.columns.length > 0);
  const matrixGroups = visibleGroups.filter((g) => g.kind === "matrix");
  const planGroup = visibleGroups.find((g) => g.kind === "plan");
  const ganttGroup = visibleGroups.find((g) => g.kind === "gantt");
  const expandableGroups = visibleGroups.filter((g) => g.kind === "matrix" || g.kind === "plan" || g.kind === "gantt" || g.kind === "calendar");
  const hasExpandable = expandableGroups.length > 0;
  const allOpen = hasExpandable && products.length > 0 && products.every((p) => expanded[p.id]);
  const entryCount = (p) =>
    expandableGroups.reduce(
      (n, g) => n + (g.kind === "matrix" ? (p.blocks[g.id]?.entries.length || 0) : g.kind === "plan" ? (p.plan?.sizes.length || 0) : g.kind === "calendar" ? (p.calendar?.components?.length || 0) : 0),
      0
    );
  // есть ли переключаемые группы для выпадашки «Группы столбцов» (гант и календарь показываются всегда)
  const toggleableGroups = tabGroups.filter((g) => g.kind !== "gantt" && g.kind !== "calendar");

  const dataFrozen = colOrder.map((id) => ({ id, label: DCOL[id].label, width: colW[id] || DCOL[id].w }));
  const frozenCols = [
    ...(hasExpandable ? [{ id: "expander", label: "", width: 40 }] : []),
    ...dataFrozen,
  ];

  const filteredProducts = products.filter((p) => {
    if (codeFilter.trim()) { const q = codeFilter.trim().toLowerCase(); if (!(p.code || "").toLowerCase().includes(q) && !(p.name || "").toLowerCase().includes(q)) return false; }
    if (statusFilter.length && !statusFilter.includes(p.status)) return false;
    for (const id of colOrder) {
      const meta = DCOL[id];
      if (meta.filter === "text") { const q = (colFilters[id] || "").trim().toLowerCase(); if (q && !String(p[meta.field] || "").toLowerCase().includes(q)) return false; }
    }
    return true;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // новые товары сверху, старые снизу

  const lefts = [];
  let acc = 0;
  for (const f of frozenCols) {
    lefts.push(acc);
    acc += f.width;
  }
  const lastFrozen = frozenCols.length - 1;
  const totalCols =
    frozenCols.length + columnGroupsView.reduce((a, g) => a + g.columns.length, 0);

  const frozenCell = (i) => ({
    position: "sticky",
    left: lefts[i],
    width: frozenCols[i].width,
    minWidth: frozenCols[i].width,
    maxWidth: frozenCols[i].width,
    ...(i === lastFrozen
      ? { borderRight: "1px solid #e5e5e5", boxShadow: "6px 0 10px -8px rgba(15,23,42,.25)" }
      : {}),
  });

  /* --- экспорт --- */
  // Экспорт текущей партии закупки в .xlsx (с картинками и кол-вом по размерам)
  const exportPurchaseXlsx = async () => {
    const b = (purchaseBatches || []).find((x) => x.id === purchActiveId) || (purchaseBatches || [])[0];
    if (!b) return;
    const cny = toNum(b.cny), usd = toNum(b.usd), cargo = toNum(b.cargo);
    const feeMul = 1 + ((toNum(b.commission) || 0) + (toNum(b.insurance) || 0)) / 100;
    const items = b.items || [];
    // размерные колонки — объединение имён размеров по всем позициям
    const sizeCols = []; const seen = new Set();
    items.forEach((it) => {
      const p = products.find((x) => x.id === it.productId) || {}; const pl = p.plan || {};
      if (pl.oneSize) { const nm = pl.oneLabel || "One size"; if (!seen.has(nm)) { seen.add(nm); sizeCols.push(nm); } }
      else (pl.sizes || []).forEach((s) => { const nm = s.name || "—"; if (!seen.has(nm)) { seen.add(nm); sizeCols.push(nm); } });
    });
    const header = ["Фото", "Код", "Товар", "Предмет", "Примечание", "Цена ¥/ед", "Вес, г", "Цена ₽/ед", ...sizeCols, "Кол-во", "Сумма ¥", "Сумма ₽", "Ссылка"];
    const rows = []; const images = []; const imgSrc = [];
    let totQty = 0, totWeightKg = 0, totCny = 0, totRub = 0;
    items.forEach((it, ri) => {
      const p = products.find((x) => x.id === it.productId) || {}; const pl = p.plan || {};
      const w = toNum(p?.purchase?.weightG), pc = toNum(it.priceCny), q = toNum(it.qty);
      const rubUnit = (isNaN(cny) ? 0 : cny) * (isNaN(pc) ? 0 : pc) * feeMul + (isNaN(cargo) ? 0 : cargo) * ((isNaN(w) ? 0 : w) / 1000) * (isNaN(usd) ? 0 : usd);
      const qn = isNaN(q) ? 0 : q, pcn = isNaN(pc) ? 0 : pc, wn = isNaN(w) ? 0 : w;
      totQty += qn; totWeightKg += (wn * qn) / 1000; totCny += pcn * qn; totRub += Math.round(rubUnit * qn);
      const sizeMap = {};
      if (pl.oneSize) sizeMap[pl.oneLabel || "One size"] = isNaN(q) ? "" : q;
      else (pl.sizes || []).forEach((s) => { const v = toNum((it.qtyBySize || {})[s.id]); sizeMap[s.name || "—"] = isNaN(v) ? "" : v; });
      rows.push([
        "", p.code || "", p.name || "", p.subject || "", it.note || "",
        isNaN(pc) ? "" : pc, isNaN(w) ? "" : w, isNaN(pc) ? "" : Math.round(rubUnit),
        ...sizeCols.map((nm) => (nm in sizeMap ? sizeMap[nm] : "")),
        isNaN(q) ? "" : q,
        (isNaN(pc) || isNaN(q)) ? "" : pc * q,
        (isNaN(pc) || isNaN(q)) ? "" : Math.round(rubUnit * q),
        p?.purchase?.link || "",
      ]);
      if (p.image && typeof p.image === "string") imgSrc.push({ row: ri, src: p.image });
    });
    // Каждое фото перекодируем в настоящий JPEG (в базе могут быть PNG/WebP — Excel их под видом jpeg удаляет как «нечитаемое»)
    for (const c of imgSrc) { const j = await imgToJpeg(c.src); if (j) images.push({ row: c.row, col: 0, dataUrl: j.dataUrl, w: j.w, h: j.h }); }
    const colWidths = [10, 10, 34, 16, 22, 10, 8, 10, ...sizeCols.map(() => 6), 8, 10, 11, 26];
    // строка «Итого»
    const totalsRow = new Array(header.length).fill("");
    totalsRow[1] = "Итого";
    totalsRow[6] = Math.round(totWeightKg * 10) / 10; // вес, кг (сумма) — в колонке «Вес, г», подпись в заголовке
    const qtyCol = 8 + sizeCols.length;
    totalsRow[qtyCol] = totQty;
    totalsRow[qtyCol + 1] = Math.round(totCny);
    totalsRow[qtyCol + 2] = Math.round(totRub);
    const fmtNum = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n));
    const title = `Закупка · ${b.name || "Партия"}`;
    const subtitle = `${items.length} поз. · ${fmtNum(totQty)} шт · ${fmtNum(totWeightKg)} кг · ${fmtNum(totCny)} ¥ · ${fmtNum(totRub)} ₽ · выгружено ${new Date().toLocaleDateString("ru-RU")}`;
    const bytes = buildXlsx({ sheetName: (b.name || "Заказ").slice(0, 31), title, subtitle, header, rows, totalsRow, images, colWidths, imgColWidthPx: 64, imgRowHeightPx: 56 });
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "zakaz_" + (String(b.name || "").replace(/[^0-9A-Za-zА-Яа-яЁё-]+/g, "_") || "partiya") + ".xlsx";
    a.click(); URL.revokeObjectURL(a.href);
  };

  const exportCsv = () => {
    if (activeTab === "purchases") { exportPurchaseXlsx(); return; }
    let head, rows, fname;
    if (activeTab === "duties") {
      head = ["Область", "Функция", "Подфункция", "Исполнитель", "Периодичность"];
      const areaName = (id) => (duties.areas.find((a) => a.id === id) || {}).name || "";
      const personName = (id) => (duties.people.find((p) => p.id === id) || {}).name || "Не назначен";
      rows = (duties.functions || []).filter((f) => !f.deletedAt).flatMap((f) => {
        const base = [[areaName(f.areaId), f.name, "", personName(f.assignee), describeRecur(f.recur)]];
        const subs = (f.subs || []).map((s) => [areaName(f.areaId), f.name, s.name, personName(s.assignee), describeRecur(s.recur)]);
        return [...base, ...subs];
      });
      fname = "obyazannosti";
    } else if (planGroup) {
      // План отгрузок: строка на каждый размер, столбцы складов = штуки
      head = ["Код", "Наименование", "Размер", "Общее кол-во", "Кол-во к поставке", ...warehouses.map((w) => w.name), "Сумма"];
      rows = products.flatMap((p) =>
        (p.plan?.sizes || []).map((s) => {
          const sum = warehouses.reduce((a, w) => a + (toNum(s.qty[w.id]) || 0), 0);
          return [p.code, p.name, s.name, s.total, s.toShip, ...warehouses.map((w) => s.qty[w.id] ?? ""), sum];
        })
      );
      fname = "shipment";
    } else if (matrixGroups.length) {
      // Продвижение: длинный формат — строка на каждое значение
      head = ["Код", "Наименование", "Блок", "№", "Метрика", "Значение"];
      rows = products.flatMap((p) =>
        matrixGroups.flatMap((g) =>
          (p.blocks[g.id]?.entries || []).flatMap((entry, idx) =>
            (metricsByGroup[g.id] || []).map((m) => [
              p.code, p.name, g.label, idx + 1, m.label, entry.values[m.id] ?? "",
            ])
          )
        )
      );
      fname = "promotion";
    } else if (activeTab === "calendar") {
      head = ["Код", "Наименование", "Точка входа", "Старт логистики", "Компонент", "Дней", "Начало", "Конец"];
      const pad2 = (n) => String(n).padStart(2, "0");
      const addD = (ds, n) => { const d = new Date(ds + "T00:00:00"); if (isNaN(d.getTime())) return ""; d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
      rows = products.flatMap((p) => {
        const c = p.calendar || {};
        const comps = c.components || [];
        const st = c.start || "";
        const ent = c.entry || "";
        if (!comps.length) return [[p.code, p.name, ent, st, "", "", "", ""]];
        let acc = 0;
        return comps.map((comp) => {
          const days = Math.max(1, parseInt(comp.days) || 1);
          const cStart = st ? addD(st, acc) : "";
          const cEnd = st ? addD(st, acc + days - 1) : "";
          acc += days;
          return [p.code, p.name, ent, st, comp.name, days, cStart, cEnd];
        });
      });
      fname = "calendar";
    } else {
      head = [
        "Код", "Артикул ВБ", "Предмет", "Наименование", "Статус",
        ...columnGroups.flatMap((g) => g.columns.map((c) => `${g.label}: ${c.label}`)),
      ];
      rows = products.map((p) => {
        const pe = withConst(p);
        const right = columnGroups.flatMap((g) =>
          g.columns.map((col) => {
            if (col.type === "input" || col.type === "priceStack") return p[col.field] ?? "";
            const v = col.fn(pe, g.columns);
            return isNaN(v) ? "" : Math.round(v * 100) / 100;
          })
        );
        return [p.code, p.wb, p.subject || "", p.name, p.status, ...right];
      });
      fname = "assortment";
    }
    const csv = [head, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ---------------------------------------------------------------------- */

  // Профиль текущего вошедшего пользователя (для личных настроек имени/фото)
  const myProfile = (profiles || []).find((p) => (p.email || "").toLowerCase() === String(userEmail || "").toLowerCase()) || null;
  const patchMyProfile = (patch) => { if (!myProfile) return; setProfiles((list) => list.map((p) => (p.id === myProfile.id ? { ...p, ...patch } : p))); };

  return (
    <div
      style={{ fontFamily: '"Manrope", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', minHeight: (100 / uiZoom) + "vh" }}
      className="w-full bg-neutral-100 text-neutral-900"
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');`}</style>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <div className="mx-auto max-w-full px-4 pb-4 pt-3 sm:px-6 sm:pb-6 sm:pt-3">
        {/* Шапка */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl inline-flex border border-neutral-200 bg-white p-1">
              {navShown.map((t) => {
                const on = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className="rounded-lg px-4 py-1.5 text-sm font-semibold transition"
                    style={on ? { background: "#171717", color: "#fff" } : { color: "#737373" }}
                  >
                    {t.label}
                  </button>
                );
              })}
              {navRest.length > 0 && (
                <div className="relative">
                  <button onClick={() => setNavMoreOpen((v) => !v)} title="Остальные блоки" className={"rounded-lg px-3 py-1.5 text-sm font-black tracking-tighter transition " + (navMoreOpen ? "bg-neutral-100 text-neutral-900" : "text-neutral-500 hover:bg-neutral-100")}>⋯</button>
                  {navMoreOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setNavMoreOpen(false)} />
                      <div className="absolute left-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl">
                        {navRest.map((t) => (
                          <button key={t.id} onClick={() => { setActiveTab(t.id); setNavMoreOpen(false); }} className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold text-neutral-700 hover:bg-neutral-100">{t.label}</button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <span className="text-sm text-neutral-400">{activeTab === "duties" ? `${(duties.functions || []).filter((f) => !f.deletedAt).length} функций` : ""}</span>
          </div>
        {mq.on && mq.text.split("\n").map((x) => x.trim()).filter(Boolean).length > 0 && (() => {
            const ph = mq.text.split("\n").map((x) => x.trim()).filter(Boolean);
            const w = ph.reduce((a, x) => a + x.length * 9 + 44, 0);
            const rep = Math.max(1, Math.ceil(2600 / w));
            const half = Array.from({ length: rep }).flatMap(() => ph);
            const dur = Math.max(12, (w * rep) / (40 + mq.speed * 30));
            const row = (k) => <span key={k} className="inline-flex shrink-0 items-center">{half.map((x, i) => <span key={i} className="inline-flex items-center"><span className="font-semibold text-neutral-700">{x}</span><span className="mx-5 text-[9px] text-blue-600">●</span></span>)}</span>;
            return (
              <div className="rnp-mq min-w-[120px] flex-1 overflow-hidden whitespace-nowrap" style={{ WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)", maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)" }}>
                <div className="rnp-mq-track inline-flex" style={{ animationDuration: dur + "s" }}>{row(0)}{row(1)}</div>
              </div>
            );
          })()}
          <div className="ml-auto flex items-center gap-2">
            {activeTab !== "base" && hasExpandable && products.length > 0 && (
              <button onClick={allOpen ? collapseAll : expandAll} className="rounded-xl inline-flex items-center gap-1.5 border border-neutral-200 bg-white h-[42px] px-3.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                {allOpen ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                {allOpen ? "Свернуть всё" : "Развернуть всё"}
              </button>
            )}
            {activeTab === "purchases" && (
            <button onClick={exportCsv} title={activeTab === "purchases" ? "Выгрузка партии в Excel (с фото)" : "Экспорт CSV"} className="rounded-xl inline-flex items-center justify-center border border-neutral-200 bg-white h-[42px] w-[42px] text-neutral-700 hover:bg-neutral-50">
              <Download size={16} />
            </button>
            )}
            {(activeTab === "tasks" || activeTab === "assortment" || activeTab === "duties") && (
            <button onClick={() => openTrash(activeTab === "assortment" ? "products" : activeTab === "duties" ? "functions" : "jobs")} title="Корзина" className="relative rounded-xl inline-flex h-[42px] w-[42px] items-center justify-center border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50">
              <Trash2 size={16} />
            </button>
            )}
            <button onClick={() => { setSettingsTab("statuses"); setSettingsOpen(true); }} title="Настройки" className="rounded-xl inline-flex h-[42px] items-center gap-1.5 border border-neutral-200 bg-white px-3.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              <Settings2 size={15} /> Настройки
            </button>
        <div className="relative">
          <button onClick={() => setProfileMenuOpen((v) => !v)} className="inline-flex h-[42px] items-center gap-2 rounded-xl border border-neutral-200 bg-white pl-1.5 pr-3 hover:bg-neutral-50">
            <PersonAvatar p={myProfile} size={28} />
            <span className="text-sm font-medium text-neutral-800">{myProfile ? profileLabel(myProfile) : "Профиль"}</span>
            <ChevronDown size={13} className="text-neutral-400" />
          </button>
          {profileMenuOpen && (
            <>
              <button className="fixed inset-0 z-[70] cursor-default" onClick={() => setProfileMenuOpen(false)} aria-label="Закрыть меню" />
              <div className="absolute right-0 top-10 z-[71] w-60 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl">
                <div className="mb-1.5 flex items-center gap-2.5 border-b border-neutral-100 px-2 pb-2.5 pt-1">
                  <PersonAvatar p={myProfile} size={34} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-neutral-800">{myProfile ? profileLabel(myProfile) : "Профиль"}</div>
                    <div className="truncate text-[11px] text-neutral-400">{userEmail}</div>
                  </div>
                </div>
                <button onClick={() => { setProfileMenuOpen(false); setMyProfileOpen(true); }} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] text-neutral-700 hover:bg-neutral-50"><Settings2 size={15} className="text-neutral-400" />Мой профиль</button>
                <div className="my-1 h-px bg-neutral-100" />
                <button onClick={() => { setProfileMenuOpen(false); onSignOut && onSignOut(); }} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] font-medium text-red-600 hover:bg-red-50"><LogOut size={15} />Выйти</button>
              </div>
            </>
          )}
        </div>
          </div>
        </div>

        {/* Группы столбцов текущей вкладки — компактный dropdown */}
        {activeTab !== "assortment" && (toggleableGroups.length > 0 || activeTab === "promotion") && (
          <div className="mb-3 relative inline-block">
            <button
              onClick={() => setColSettings((v) => !v)}
              className="rounded-lg inline-flex items-center gap-1.5 border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <Settings2 size={14} />
              {activeTab === "promotion" ? "Блоки" : activeTab === "shipment" ? "Разделы" : "Группы столбцов"}
              <ChevronDown size={14} className="text-neutral-400" />
            </button>
            {colSettings && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setColSettings(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-neutral-200 bg-white py-1 shadow-xl">
                  {toggleableGroups.map((g) => {
                    const on = !!enabled[g.id];
                    return (
                      <label key={g.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-neutral-50">
                        <input type="checkbox" checked={on} onChange={() => setEnabled((e) => ({ ...e, [g.id]: !on }))} className="h-3.5 w-3.5 accent-orange-600" />
                        <span className="font-medium text-neutral-700">{g.label}</span>
                      </label>
                    );
                  })}
                  {activeTab === "promotion" && ganttGroup && (
                    <>
                      <div className="mx-3 my-1 border-t border-neutral-100" />
                      {RNP_TASKS.map((task) => {
                        const on = !hiddenTasks[task.id];
                        return (
                          <label key={task.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-neutral-50">
                            <input type="checkbox" checked={on} onChange={() => setHiddenTasks((h) => ({ ...h, [task.id]: on }))} className="h-3.5 w-3.5 accent-orange-600" />
                            <span className={on ? "text-neutral-700" : "text-neutral-400"}>{task.label}</span>
                          </label>
                        );
                      })}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Товары: подшапка — вид (список / плитки), поиск, статусы, «+ Товар» */}
        {activeTab === "assortment" && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-neutral-100 p-0.5">
              <button onClick={() => setProductsView("list")} className={"h-7 rounded-md px-3.5 text-xs font-bold transition " + (productsView === "list" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>Список</button>
              <button onClick={() => setProductsView("tiles")} className={"h-7 rounded-md px-3.5 text-xs font-bold transition " + (productsView === "tiles" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>Плитки</button>
            </div>
            {productsView === "tiles" && (
              <div className="inline-flex rounded-lg bg-neutral-100 p-0.5" title="Размер плиток">
                {["xs", "s", "m"].map((k) => (
                  <button key={k} onClick={() => setTileSize(k)} className={"h-7 min-w-[34px] rounded-md px-2.5 text-xs font-bold uppercase transition " + (tileSize === k ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>{k}</button>
                ))}
              </div>
            )}
            {activeTab === "assortment" && (
              (prodSearchOpen || codeFilter) ? (
                <div className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-900 bg-white px-2.5" style={{ width: 230 }}>
                  <Search size={14} className="shrink-0 text-neutral-400" />
                  <input
                    autoFocus
                    value={codeFilter}
                    onChange={(e) => setCodeFilter(e.target.value)}
                    onBlur={() => { if (!codeFilter.trim()) setProdSearchOpen(false); }}
                    onKeyDown={(e) => { if (e.key === "Escape") { setCodeFilter(""); setProdSearchOpen(false); } }}
                    placeholder="Код или название…"
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-neutral-800 outline-none placeholder:text-neutral-400"
                  />
                  <button onClick={() => { setCodeFilter(""); setProdSearchOpen(false); }} className="shrink-0 text-neutral-300 hover:text-neutral-600" title="Очистить"><X size={14} /></button>
                </div>
              ) : (
                <button onClick={() => setProdSearchOpen(true)} title="Поиск по коду и названию" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"><Search size={15} /></button>
              )
            )}
            {activeTab === "assortment" && (
              <div className="relative inline-block">
                <button
                  onClick={() => setStatusFilterOpen((v) => !v)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                  style={statusFilter.length ? { borderColor: "#fdba74", color: "#c2410c", background: "#fff7ed" } : { borderColor: "#e5e5e5" }}
                >
                  {statusFilter.length ? `Статусы: ${statusFilter.length}` : "Все статусы"}
                  <ChevronDown size={14} className="text-neutral-400" />
                </button>
                {statusFilterOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setStatusFilterOpen(false)} />
                    <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-neutral-200 bg-white py-1 shadow-xl">
                      {statuses.map((s) => {
                        const on = statusFilter.includes(s.name);
                        return (
                          <label key={s.name} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-neutral-50">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => setStatusFilter((cur) => (on ? cur.filter((x) => x !== s.name) : [...cur, s.name]))}
                              className="h-3.5 w-3.5 accent-orange-600"
                            />
                            <span className="inline-flex items-center gap-1.5">
                              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: s.color }} />
                              <span className="text-neutral-700">{s.name}</span>
                            </span>
                          </label>
                        );
                      })}
                      {statusFilter.length > 0 && (
                        <>
                          <div className="mx-3 my-1 border-t border-neutral-100" />
                          <button onClick={() => setStatusFilter([])} className="w-full px-3 py-1.5 text-left text-xs font-medium text-neutral-500 hover:bg-neutral-50">Сбросить</button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              {productsView === "list" && (JSON.stringify(colOrder) !== JSON.stringify(DCOL_ORDER) || Object.keys(colW).length > 0 || Object.values(colFilters).some((v) => (v || "").trim())) && (
                <button onClick={resetCols} className="inline-flex h-8 items-center rounded-lg border border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-500 hover:bg-neutral-50">Сбросить колонки</button>
              )}
              <button onClick={addProduct} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-xs font-bold text-white hover:bg-neutral-800"><Plus size={14} strokeWidth={2.5} /> Товар</button>
            </div>
          </div>
        )}

        {/* Таблица товаров — вид «Список» */}
        {activeTab === "assortment" && productsView === "list" && (
        <div ref={scrollRef} className="rounded-xl overflow-auto border border-neutral-200 bg-white shadow-sm">
          <SubjectsDatalist subjects={subjects} />
          <table className="text-sm" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
            <thead>
              <tr>
                {frozenCols.map((f, i) => {
                  const meta = DCOL[f.id];
                  const canFilter = meta && meta.filter;
                  const filterOn = f.id === "status" ? statusFilter.length > 0 : !!(colFilters[f.id] || "").trim();
                  return (
                  <th
                    key={f.id}
                    rowSpan={2}
                    draggable={!!meta}
                    onDragStart={meta ? (e) => { dragColRef.current = f.id; e.dataTransfer.effectAllowed = "move"; } : undefined}
                    onDragOver={meta ? (e) => e.preventDefault() : undefined}
                    onDrop={meta ? (e) => { e.preventDefault(); reorderCol(dragColRef.current, f.id); dragColRef.current = null; } : undefined}
                    className="relative bg-neutral-50 px-2 py-2 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-neutral-500"
                    style={{ ...frozenCell(i), top: 0, zIndex: 40, borderBottom: "1px solid #e5e5e5", cursor: meta ? "grab" : "default" }}
                  >
                    <div className="flex items-center gap-1">
                      {meta && <GripVertical size={11} className="shrink-0 text-neutral-300" />}
                      <span className="truncate">{f.label}</span>
                      {canFilter && (
                        <button onClick={(e) => { e.stopPropagation(); setColMenu((m) => (m === f.id ? null : f.id)); }} className={"ml-auto shrink-0 rounded p-0.5 " + (filterOn ? "text-orange-600" : "text-neutral-300 hover:text-neutral-600")} title="Фильтр по столбцу"><Filter size={12} /></button>
                      )}
                    </div>
                    {colMenu === f.id && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setColMenu(null)} />
                        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-neutral-200 bg-white p-2 text-left shadow-xl" onClick={(e) => e.stopPropagation()}>
                          {meta.filter === "text" ? (
                            <>
                              <input autoFocus value={colFilters[f.id] || ""} onChange={(e) => setColFilters((c) => ({ ...c, [f.id]: e.target.value }))} placeholder={`Фильтр: ${f.label.toLowerCase()}…`} className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm normal-case text-neutral-700 focus:outline-none focus:ring-2 focus:ring-orange-200" />
                              {(colFilters[f.id] || "").trim() && <button onClick={() => { setColFilters((c) => ({ ...c, [f.id]: "" })); }} className="mt-1.5 text-[11px] font-semibold text-neutral-400 hover:text-red-500">Сбросить</button>}
                            </>
                          ) : (
                            <div className="max-h-56 overflow-auto">
                              <div className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Статусы</div>
                              {statuses.map((s) => { const on = statusFilter.includes(s.name); return (
                                <button key={s.name} onClick={() => setStatusFilter((arr) => (on ? arr.filter((x) => x !== s.name) : [...arr, s.name]))} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm normal-case hover:bg-neutral-50">
                                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded border" style={{ background: on ? "#ea580c" : "#fff", borderColor: on ? "#ea580c" : "#d4d4d4", color: "#fff" }}>{on && <Check size={9} strokeWidth={3} />}</span>
                                  <span className="text-neutral-700">{s.name}</span>
                                </button>
                              ); })}
                              {statusFilter.length > 0 && <button onClick={() => setStatusFilter([])} className="mt-1 px-1.5 text-[11px] font-semibold text-neutral-400 hover:text-red-500">Сбросить</button>}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    {meta && <div onPointerDown={(e) => startColResize(e, f.id)} onDragStart={(e) => e.preventDefault()} className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-orange-300/60" title="Потяните — ширина колонки" />}
                  </th>
                  );
                })}
                {columnGroupsView.map((g) => (
                  <th
                    key={g.id}
                    colSpan={g.columns.length}
                    className="px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide"
                    style={{ position: "sticky", top: 0, zIndex: 30, background: g.accent + "14", color: g.accent, borderBottom: "1px solid " + g.accent + "33", borderLeft: "1px solid " + g.accent + "22" }}
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              <tr>
                {columnGroupsView.map((g) =>
                  g.columns.map((col, ci) => (
                    <th
                      key={g.id + col.id}
                      className="px-1 py-1.5 text-right text-[11px] font-medium leading-tight text-neutral-500 align-bottom"
                      style={{ position: "sticky", top: 33, zIndex: 30, background: "#fafafa", borderBottom: "1px solid #e5e5e5", borderLeft: ci === 0 ? "1px solid " + g.accent + "33" : "none", width: col.w || 54, minWidth: col.w || 54, maxWidth: col.w || 54, whiteSpace: "normal" }}
                    >
                      {col.label}
                    </th>
                  ))
                )}
              </tr>
            </thead>

            <tbody>
              {filteredProducts.map((p) => {
                const sc = statusColor(p.status);
                const isOpen = hasExpandable && !!expanded[p.id];
                const intCount = entryCount(p);
                return (
                  <FragmentRow key={p.id}>
                    <tr className="group">
                      {frozenCols.map((f, i) => {
                        const base = { ...frozenCell(i), zIndex: 20, background: "#fff", borderBottom: isOpen ? "none" : "1px solid #f5f5f5" };
                        if (f.id === "expander")
                          return (
                            <td key="exp" className="text-center" style={base}>
                              <button onClick={() => toggleExpand(p.id)} className="relative mx-auto flex h-7 w-7 items-center justify-center text-neutral-400 hover:bg-orange-50 hover:text-orange-600" title="Продвижение">
                                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                {intCount > 0 && (
                                  <span className="rounded-full absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center bg-orange-600 px-1 font-bold text-white" style={{ fontSize: 9 }}>{intCount}</span>
                                )}
                              </button>
                            </td>
                          );
                        if (f.id === "actions")
                          return (
                            <td key="act" className="text-center" style={base}>
                              <button onClick={() => removeProduct(p.id)} title="Удалить товар" className="p-1.5 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100">
                                <Trash2 size={15} />
                              </button>
                            </td>
                          );
                        if (f.id === "del")
                          return (
                            <td key="del" className="text-center" style={base}>
                              <button onClick={() => removeProduct(p.id)} title="Удалить товар" className="rounded-md p-1.5 text-neutral-300 transition hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
                            </td>
                          );
                        if (f.id === "image")
                          return (
                            <td key="img" style={base}>
                              <button onClick={() => triggerUpload(p.id)} className="rounded-lg mx-auto flex h-9 w-9 items-center justify-center overflow-hidden border border-neutral-200 bg-neutral-50 text-neutral-400 hover:border-neutral-200 hover:text-neutral-600" title="Загрузить фото">
                                {p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={15} />}
                              </button>
                            </td>
                          );
                        if (f.id === "code")
                          return <td key="code" style={base}><CellInput value={p.code} onChange={(v) => updateProduct(p.id, "code", v)} placeholder="—" /></td>;
                        if (f.id === "wb")
                          return (
                            <td key="wb" style={base}>
                              <div className="group relative flex items-center">
                                <CellInput value={p.wb} onChange={(v) => updateProduct(p.id, "wb", v)} placeholder="—" mono />
                                {String(p.wb || "").trim() && (
                                  <a
                                    href={`https://global.wildberries.ru/catalog/${String(p.wb).trim()}/detail.aspx`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded absolute right-1 top-1/2 -translate-y-1/2 bg-white/90 p-0.5 text-neutral-400 opacity-0 transition hover:text-sky-600 group-hover:opacity-100"
                                    title="Открыть карточку на WB"
                                  >
                                    <ExternalLink size={13} />
                                  </a>
                                )}
                              </div>
                            </td>
                          );
                        if (f.id === "subject")
                          return (
                            <td key="subject" style={base}>
                              <input
                                list="subjects-datalist"
                                value={p.subject || ""}
                                onChange={(e) => updateProduct(p.id, "subject", e.target.value)}
                                placeholder="—"
                                className="w-full bg-transparent px-2 py-1.5 text-sm text-neutral-800 placeholder:text-neutral-300 focus:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-400"
                              />
                            </td>
                          );
                        if (f.id === "name") {
                          return (
                            <td key="name" style={base}>
                              <button onClick={() => setCardModal(p.id)} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-sm text-neutral-900 hover:text-orange-700" title="Открыть задачи по карточке">
                                <span className="min-w-0 flex-1 truncate">{p.name || <span className="text-neutral-400">Название товара</span>}</span>
                              </button>
                            </td>
                          );
                        }
                        if (f.id === "status")
                          return (
                            <td key="status" style={base}>
                              <select value={p.status} onChange={(e) => updateProduct(p.id, "status", e.target.value)} className="w-full cursor-pointer rounded-md border-0 px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2" style={{ background: sc + "1f", color: sc }}>
                                {!statuses.some((s) => s.name === p.status) && p.status && (<option value={p.status}>{p.status}</option>)}
                                {statuses.map((s) => (<option key={s.name} value={s.name} style={{ color: "#171717" }}>{s.name}</option>))}
                              </select>
                            </td>
                          );
                        return null;
                      })}

                      {columnGroupsView.map((g) =>
                        g.columns.map((col, ci) => {
                          const isInput = col.type === "input";
                          const isStack = col.type === "priceStack";
                          const pe = withConst(p);
                          const val = isInput || isStack ? (p[col.field] ?? "") : col.fn(pe, g.allCols);
                          const fmt = (n) => isNaN(n) ? "—" : (col.suffix === "%" ? n.toFixed(2).replace(/\.?0+$/, "") + "%" : money(n));
                          return (
                            <td
                              key={g.id + col.id}
                              className="px-0.5 py-1 text-right"
                              style={{ borderBottom: isOpen ? "none" : "1px solid #f5f5f5", borderLeft: ci === 0 ? "1px solid " + g.accent + "33" : "none", background: (isInput || isStack) ? g.accent + "06" : "#fff" }}
                            >
                              {isStack ? (
                                <div className="flex flex-col items-end leading-tight">
                                  <input value={val} onChange={(e) => updateProduct(p.id, col.field, e.target.value)} inputMode="decimal" placeholder="0" className="w-full bg-transparent px-0.5 py-0 text-right text-sm font-medium text-neutral-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-400" style={{ fontVariantNumeric: "tabular-nums", minWidth: 40 }} />
                                  <span className="px-0.5 text-[11px] text-neutral-400" style={{ fontVariantNumeric: "tabular-nums" }}>{(() => { const n = col.sub(p); return isNaN(n) ? "—" : money(n); })()}</span>
                                </div>
                              ) : isInput ? (
                                <input value={val} onChange={(e) => updateProduct(p.id, col.field, e.target.value)} inputMode="decimal" placeholder="0" className="w-full bg-transparent px-0.5 py-0.5 text-right text-xs text-neutral-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-400" style={{ fontVariantNumeric: "tabular-nums", minWidth: 40 }} />
                              ) : (
                                <span className="text-xs text-neutral-600" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(val)}</span>
                              )}
                            </td>
                          );
                        })
                      )}
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={totalCols} style={{ padding: 0, background: "#fafafa", borderBottom: "2px solid #e5e5e5" }}>
                          <div style={{ position: "sticky", left: 0, width: panelW || "100%" }}>
                            <div className="space-y-4 p-3">
                              {expandableGroups.map((g) =>
                                g.kind === "matrix" ? (
                                  <MatrixBlock
                                    key={g.id}
                                    group={g}
                                    metrics={metricsByGroup[g.id] || []}
                                    entries={p.blocks[g.id]?.entries || []}
                                    onAddEntry={() => addEntry(p.id, g.id)}
                                    onRemoveEntry={(eid) => removeEntry(p.id, g.id, eid)}
                                    onSetVal={(eid, mid, val) => setEntryVal(p.id, g.id, eid, mid, val)}
                                    onAddMetric={() => addMetric(g.id)}
                                    onRemoveMetric={(mid) => removeMetric(g.id, mid)}
                                    onRenameMetric={(mid, label) => renameMetric(g.id, mid, label)}
                                  />
                                ) : g.kind === "plan" ? (
                                  <PlanBlock
                                    key={g.id}
                                    group={g}
                                    warehouses={warehouses}
                                    sizes={p.plan?.sizes || []}
                                    onAddSize={() => addSize(p.id)}
                                    onRemoveSize={(sid) => removeSize(p.id, sid)}
                                    onSetSize={(sid, field, val) => setSize(p.id, sid, field, val)}
                                    onSetQty={(sid, whid, qty) => setSizeQty(p.id, sid, whid, qty)}
                                    onAddWarehouse={addWarehouse}
                                    onRemoveWarehouse={removeWarehouse}
                                    onSetWarehouse={setWarehouse}
                                  />
                                ) : g.kind === "calendar" ? (
                                  <CalendarBlock
                                    key={g.id}
                                    product={p}
                                    productList={products}
                                    onSetEntry={(v) => setCalEntry(p.id, v)}
                                    onSetStart={(v) => setCalStart(p.id, v)}
                                    onSetName={(v) => setCalName(p.id, v)}
                                    onSetComponents={(comps) => setCalComponents(p.id, comps)}
                                    onCopyFrom={(sourceId) => copyCalendarFrom(p.id, sourceId)}
                                  />
                                ) : (
                                  <GanttBlock
                                    key={g.id}
                                    product={p}
                                    hiddenTasks={hiddenTasks}
                                    startDate={rnpStartDate}
                                    days={rnpDays}
                                    onSetStartDate={setRnpStartDate}
                                    onSetDays={setRnpDays}
                                    onSetCell={(k, v) => setRnpCell(p.id, k, v)}
                                    onSetEntries={(k, arr) => setRnpEntries(p.id, k, arr)}
                                    onSetFill={(k, c) => setRnpFill(p.id, k, c)}
                                    onSetFlag={(f, v) => setRnpFlag(p.id, f, v)}
                                    onSetBudget={(v) => setRnpBudget(p.id, v)}
                                    onOpenPopup={(task, dateKey) => setGanttModal({ productId: p.id, mode: "popup", task, dateKey })}
                                    onOpenDB={(task) => setGanttModal({ productId: p.id, mode: "db", task })}
                                    wbOrders={wbOrders}
                                    wbLoading={wbLoading}
                                    wbProgress={wbProgress}
                                    onFetchWb={fetchWbOrders}
                                  />
                                )
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}

              {/* добавить товар */}
              <tr>
                <td colSpan={totalCols} className="p-0" style={{ position: "sticky", left: 0 }}>
                  <button onClick={addProduct} className="rounded-md flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-100">
                    <span className="flex h-5 w-5 items-center justify-center bg-neutral-900 text-white"><Plus size={14} strokeWidth={3} /></span>
                    Добавить товар
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          {products.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-neutral-400">Пока нет товаров. Нажмите «Добавить товар», чтобы начать.</div>
          )}
        </div>
        )}

        {/* Товары — вид «Плитки» (акцент на фото) */}
        {activeTab === "assortment" && productsView === "tiles" && (
          <div className={tileSize === "xs" ? "grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10" : tileSize === "s" ? "grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8" : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"}>
            {filteredProducts.map((p) => {
              const sc = statusColor(p.status);
              const compact = tileSize !== "m";
              return (
                <div key={p.id} className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:shadow-md">
                  <div className="relative aspect-square w-full overflow-hidden bg-neutral-50">
                    <button onClick={() => setCardModal(p.id)} className="block h-full w-full" title="Открыть карточку">
                      {p.image
                        ? <img src={p.image} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                        : <div className="flex h-full w-full items-center justify-center text-neutral-300"><ImagePlus size={28} /></div>}
                    </button>
                    {p.status && (compact
                      ? <span className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white" style={{ background: sc }} title={p.status} />
                      : <span className="absolute left-2 top-2 inline-flex items-center justify-center rounded-[7px] px-2.5 py-1 text-[11px] font-extrabold leading-none text-white shadow-sm" style={{ background: sc }}>{p.status}</span>)}
                    {tileSize !== "xs" && <button onClick={() => triggerUpload(p.id)} className="rounded-lg absolute bottom-2 left-2 bg-white/90 p-1.5 text-neutral-500 opacity-0 shadow transition hover:text-neutral-800 group-hover:opacity-100" title="Загрузить фото"><ImagePlus size={14} /></button>}
                    {(() => { const inSupply = (purchaseBatches || []).some((b) => (b.items || []).some((it) => it.productId === p.id)); return (
                      <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setSupplyMenu({ productId: p.id, x: r.right, y: r.bottom }); }} className={"rounded-md absolute right-2 top-2 p-1 shadow transition " + (inSupply ? "bg-teal-600 text-white opacity-100" : "bg-white/90 text-neutral-500 opacity-0 hover:text-teal-700 group-hover:opacity-100")} title="Добавить в поставку"><PackagePlus size={14} /></button>
                    ); })()}
                    {tileSize !== "xs" && <button onClick={() => removeProduct(p.id)} className="rounded-md absolute right-2 bottom-2 bg-white/90 p-1 text-neutral-400 opacity-0 shadow transition hover:text-red-500 group-hover:opacity-100" title="Удалить"><Trash2 size={14} /></button>}
                    {tileSize === "xs" && <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-5 text-[10px] leading-tight text-white opacity-0 transition group-hover:opacity-100"><div className="font-semibold">{p.code || "—"}</div><div className="truncate">{p.name}</div></div>}
                  </div>
                  {tileSize !== "xs" && <button onClick={() => setCardModal(p.id)} className={"block w-full text-left " + (tileSize === "s" ? "px-2 py-1" : "px-3 py-2")}>
                    <div className={"flex items-center gap-1.5 truncate text-neutral-400 " + (tileSize === "s" ? "text-[10px]" : "text-[11px]")} title={p.name || ""}>
                      <span className="font-semibold text-neutral-500">{p.code || "—"}</span>
                      {p.subject && <span className="truncate">· {p.subject}</span>}
                    </div>
                    {tileSize === "m" && <div className="mt-0.5 text-sm font-medium text-neutral-800 group-hover:text-orange-700" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.name || <span className="text-neutral-400">Без названия</span>}</div>}
                  </button>}
                </div>
              );
            })}
            <button onClick={addProduct} className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 text-neutral-400 transition hover:border-orange-300 hover:bg-orange-50/30 hover:text-orange-600">
              <Plus size={22} /> {tileSize !== "xs" && <span className="text-sm font-medium">Добавить товар</span>}
            </button>
          </div>
        )}

        {activeTab === "purchases" && (
          <PurchasesBoard
            focusId={purchFocusId}
            batches={purchaseBatches}
            onChange={setPurchaseBatches}
            products={products}
            defaultRates={{ cny: unitConst.cny, usd: unitConst.usd, cargo: unitConst.cargo }}
            onOpenCard={(id) => setCardModal(id)}
            onActiveChange={setPurchActiveId}
            cycleStages={prodCycle.stages}
            cycles={prodCycle.cycles}
            cycleTriggers={cycleTriggers}
            onCreateStageTask={createCycleStageTasks}
            jobs={liveJobs}
            people={profiles}
            onOpenJob={(job) => setJobEditor({ ...job })}
            onAddJob={(preset) => setJobEditor({ id: uid(), title: "", date: null, start: null, done: false, labelId: null, productId: null, priority: "low", assignee: null, tags: [], stage: "wait", note: "", checklist: [], createdAt: isoYMD(new Date()), _new: true, ...preset })}
          />
        )}

        {activeTab === "tasks" && (
          <TasksView
            onOpenBatch={(id) => { setPurchFocusId(id); setActiveTab("purchases"); }}
            focusLine={myProfile ? (focusLines[myProfile.id] || "") : ""}
            onFocusLine={(t) => { if (myProfile) setFocusLines((m) => ({ ...m, [myProfile.id]: t })); }}
            jobs={liveJobs}
            taskLabels={taskLabels}
            taskTags={taskTags}
            people={profiles}
            myId={myProfile ? myProfile.id : null}
            onUpdateJob={upsertJob}
            products={products}
            batches={purchaseBatches}
            opTypes={opTypes}
            opDone={opDone}
            onToggleDone={toggleOpDone}
            onEditOp={(op) => setJobEditor({ id: op.id, type: "op", title: op.name, recur: op.recur, assignee: op.assignee || null, tags: [], checklist: [], note: "", date: null, start: null, stage: "wait", done: false })}
            onAddJob={(preset) => setJobEditor({ id: uid(), title: "", date: null, start: null, done: false, labelId: null, productId: null, priority: "low", assignee: null, tags: [], stage: "wait", note: "", checklist: [], createdAt: isoYMD(new Date()), _new: true, ...preset })}
            onOpen={(job) => setJobEditor({ ...job })}
          />
        )}

        {activeTab === "summary" && <SummaryTab products={products} wbOrders={wbOrders} way={wbWay} wayLoading={wayLoading} wayMsg={wayMsg} onRefreshWay={fetchWbWay} oz={ozData} ozAd={ozAd} ozReady={!!(ozCfg && ozCfg.clientId && ozCfg.apiKey)} ozLoading={ozLoading} ozMsg={ozMsg} onRefreshOz={fetchOz} />}
        {activeTab === "rnp" && <RnpOverview products={products} statuses={statuses} wbOrders={wbOrders} purchaseBatches={purchaseBatches} onOpen={(id) => setCardModal(id)} onOpenPopup={(pid, task, dateKey) => setGanttModal({ productId: pid, mode: "popup", task, dateKey })} onOpenDB={(pid, task) => setGanttModal({ productId: pid, mode: "db", task })} onSetCell={(pid, k, v) => setRnpCell(pid, k, v)} onSetFlag={(pid, f, v) => setRnpFlag(pid, f, v)} onSetBudget={(pid, v) => setRnpBudget(pid, v)} onSetFunds={(pid, f) => setRnpFunds(pid, f)} />}

        {activeTab === "strategy" && blockEl("strategy")}

        {activeTab === "content" && (
          <ContentBoard
            products={products}
            batches={purchaseBatches}
            statuses={statuses}
            onToggle={(pid, itemId) => { const pr = products.find((x) => x.id === pid); if (!pr) return; const cur = (pr.content && typeof pr.content === "object") ? pr.content : {}; updateProduct(pid, "content", { ...cur, [itemId]: !cur[itemId] }); }}
            onOpen={(id) => setCardModal(id)}
          />
        )}

        {activeTab === "duties" && blockEl("duties")}

        {activeTab === "agents" && blockEl("agents")}
      </div>

      {jobEditor && (
        <JobEditor
          job={jobEditor}
          maps={(strategy && strategy.maps) || []}
          onOpenWork={(w) => { if (w.kind === "map") { if (!((strategy && strategy.maps) || []).some((m) => m.id === w.ref)) return; setStrategy((cur) => ({ ...cur, activeId: w.ref })); } setWorkWin(w); }}
          onCreateMap={(name) => { const m = makeTemplatedMap("mind", name); setStrategy((cur) => ({ ...cur, maps: [...((cur && cur.maps) || []), m], activeId: m.id })); return m.id; }}
          liveLog={(jobs.find((x) => x.id === jobEditor.id) || {}).log || jobEditor.log || []}
          taskLabels={taskLabels}
          taskTags={taskTags}
          people={profiles}
          products={products}
          opTypes={opTypes}
          batches={purchaseBatches}
          onDuplicate={(src) => { const { _new, ...rest } = src; const copy = { ...rest, id: uid(), title: (src.title || "Задача") + " (копия)", createdAt: isoYMD(new Date()), stage: "wait", done: false, files: Array.isArray(src.files) ? src.files : [] }; if (copy.type === "op") return; upsertJob(copy); removeOpType(copy.id); setJobEditor({ ...copy }); }}
          onChange={(j) => {
            const { _new, ...rest } = j;
            if (!rest.title.trim()) return;
            if (rest.type === "op") {
              upsertOpType({ id: rest.id, name: rest.title, recur: normRecur(rest.recur), assignee: rest.assignee || null });
              removeJob(rest.id);
            } else {
              upsertJob(rest);
              removeOpType(rest.id);
            }
          }}
          onDelete={(id) => { if (jobs.some((x) => x.id === id)) trashJob(id); removeOpType(id); setJobEditor(null); }}
          onOpenProduct={(pid) => { if (pid) { setJobEditor(null); setCardModal(pid); } }}
          onClose={() => setJobEditor(null)}
        />
      )}

      {workWin && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-3" onClick={() => setWorkWin(null)}>
          <div className="flex h-[92vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-neutral-100 bg-neutral-50 px-5 py-3">
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-extrabold text-violet-700">{workWin.kind === "map" ? "Карта" : "Блок"}</span>
              <div className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-neutral-900">{workWin.title}</div>
              <button onClick={() => setWorkWin(null)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-bold text-neutral-500 hover:bg-neutral-200">Вернуться в задачу <X size={14} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-neutral-50">{blockEl(workWin.kind === "map" ? "strategy" : workWin.ref)}</div>
          </div>
        </div>
      )}

      {opEditor && (
        <OpTypeModal
          opType={opEditor}
          onSave={(o) => { upsertOpType(o); setOpEditor(null); }}
          onDelete={(id) => { removeOpType(id); setOpEditor(null); }}
          onClose={() => setOpEditor(null)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          tgLinks={tgLinks}
          tgBot={tgBot}
          saveTgBot={saveTgBot}
          myProfileId={myProfile ? myProfile.id : null}
          statuses={statuses}
          setStatuses={setStatuses}
          defaultTasks={defaultTasks}
          setDefaultTasks={setDefaultTasks}
          taskLabels={taskLabels}
          setTaskLabels={setTaskLabels}
          taskTags={taskTags}
          setTaskTags={setTaskTags}
          opTypes={opTypes}
          setOpTypes={setOpTypes}
          subjects={subjects}
          setSubjects={setSubjects}
          prodCycle={prodCycle}
          setProdCycle={setProdCycle}
          taskTriggers={taskTriggers}
          setTaskTriggers={setTaskTriggers}
          cycleTriggers={cycleTriggers}
          setCycleTriggers={setCycleTriggers}
          taskPeople={profiles}
          unitConst={unitConst}
          setUnitConst={setUnitConst}
          initialTab={settingsTab}
          navCfg={navCfg}
          setNavCfg={setNavCfg}
          uiZoom={uiZoom}
          setUiZoom={setUiZoom}
          mq={mq}
          setMq={setMq}
          wbApiKey={wbApiKey}
          setWbApiKey={setWbApiKey}
          wbAdKey={wbAdKey} setWbAdKey={setWbAdKey} onFetchAd={fetchWbAd} adLoading={wbAdLoading} adMsg={wbAdMsg}
          ozCfg={ozCfg} setOzCfg={setOzCfg} onFetchOz={() => { fetchOz(); }} ozLoading={ozLoading} ozMsg={ozMsg} msCfg={msCfg} setMsCfg={setMsCfg} onFetchMs={() => { fetchMs(); }} msLoading={msLoading} msMsg={msMsg} msData={msData}
          onFetchWb={() => { setSettingsOpen(false); fetchWbOrders(); }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {cardModal && (() => {
        const cp = products.find((x) => x.id === cardModal);
        if (!cp) return null;
        return (
          <CardTasksModal
            msData={msData} msReady={!!(msCfg && msCfg.token)} msLoading={msLoading} onFetchMs={() => { fetchMs(); }} ozStockData={ozData} wbWayData={wbWay}
            product={withConst(cp)}
            rating={wbRating[String(cp.wb || "").trim()] || null}
            statuses={statuses}
            onSetName={(v) => updateProduct(cp.id, "name", v)}
            onSetTasks={(tasks) => setProductTasks(cp.id, tasks)}
            allJobs={liveJobs}
            onCardAddTask={(title) => { const t = String(title || "").trim(); if (!t) return; upsertJob({ id: uid(), title: t.slice(0, 200), type: "product", productId: cp.id, date: null, start: null, done: false, priority: "low", assignee: null, tags: [], stage: "wait", note: "", checklist: [], createdAt: isoYMD(new Date()) }); }}
            onOpenJob={(job) => setJobEditor({ ...job })}
            onUpdateJob={upsertJob}
            onSetCompetitors={(c) => setProductCompetitors(cp.id, c)}
            onSetSeasonality={(s) => setProductSeasonality(cp.id, s)}
            analyticsCriteria={analyticsCriteria}
            onSetCriteria={setAnalyticsCriteria}
            onSetAnalytics={(a) => setProductAnalytics(cp.id, a)}
            onSizesSet={(arr) => setSizes(cp.id, arr)}
            onSetOneSize={(v) => setPlanField(cp.id, "oneSize", v)}
            onSetOneLabel={(v) => setPlanField(cp.id, "oneLabel", v)}
            onSetField={(f, v) => updateProduct(cp.id, f, v)}
            subjects={subjects}
            unitConst={unitConst}
            onSetUnitConst={(patch) => setUnitConst((c) => ({ ...c, ...patch }))}
            productList={products}
            onCalEntry={(v) => setCalEntry(cp.id, v)}
            onCalStart={(v) => setCalStart(cp.id, v)}
            onCalName={(v) => setCalName(cp.id, v)}
            onCalComponents={(c) => setCalComponents(cp.id, c)}
            onCalBuffer={(v) => setCalBuffer(cp.id, v)}
            onCalCopyFrom={(sid) => copyCalendarFrom(cp.id, sid)}
            hiddenTasks={hiddenTasks}
            onToggleTask={(id) => setHiddenTasks((h) => ({ ...h, [id]: !h[id] }))}
            rnpOrder={rnpOrder}
            onSetRnpOrder={setRnpOrder}
            rnpStartDate={rnpStartDate}
            rnpDays={rnpDays}
            onSetRnpStartDate={setRnpStartDate}
            onSetRnpDays={setRnpDays}
            onSetRnpCell={(k, v) => setRnpCell(cp.id, k, v)}
            onSetRnpEntries={(k, arr) => setRnpEntries(cp.id, k, arr)}
            onSetRnpFill={(k, c) => setRnpFill(cp.id, k, c)}
            onSetRnpFlag={(f, v) => setRnpFlag(cp.id, f, v)}
            onSetRnpBudget={(v) => setRnpBudget(cp.id, v)}
            purchaseBatches={purchaseBatches}
            onSetBatchItemFields={(batchId, patch) => setBatchItemFields(batchId, cp.id, patch)}
            onOpenPopup={(task, dateKey) => setGanttModal({ productId: cp.id, mode: "popup", task, dateKey })}
            onOpenDB={(task) => setGanttModal({ productId: cp.id, mode: "db", task })}
            wbOrders={wbOrders}
            wbLoading={wbLoading}
            wbProgress={wbProgress}
            onFetchWb={fetchWbOrders}
            onClose={() => setCardModal(null)}
          />
        );
      })()}

      {/* Выпадающий список поставок для «Добавить в поставку» */}
      {supplyMenu && (() => {
        const prod = products.find((x) => x.id === supplyMenu.productId);
        if (!prod) return null;
        return (
          <>
            <div className="fixed inset-0 z-[80]" onClick={() => setSupplyMenu(null)} />
            <div className="fixed z-[81] w-60 overflow-hidden rounded-xl border border-neutral-200 bg-white p-1 shadow-xl" style={{ left: Math.max(8, Math.min(supplyMenu.x - 240, window.innerWidth - 248)), top: supplyMenu.y + 6 }}>
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Добавить в поставку</div>
              <div className="max-h-64 overflow-auto">
                {(purchaseBatches || []).length === 0 && <div className="px-2.5 py-2 text-xs text-neutral-400">Партий ещё нет — создайте ниже.</div>}
                {(purchaseBatches || []).map((b) => {
                  const has = (b.items || []).some((it) => it.productId === supplyMenu.productId);
                  const stColor = { draft: "#94a3b8", paid: "#10b981", transit: "#f59e0b", received: "#3b82f6" }[b.status] || "#94a3b8";
                  return (
                    <button key={b.id} disabled={has} onClick={() => addProductToBatch(b.id, supplyMenu.productId)} className={"flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm " + (has ? "cursor-default text-neutral-400" : "text-neutral-700 hover:bg-neutral-50")}>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stColor }} />
                      <span className="min-w-0 flex-1 truncate">{b.name}</span>
                      {has ? <Check size={14} className="shrink-0 text-teal-600" /> : <Plus size={14} className="shrink-0 text-neutral-300" />}
                    </button>
                  );
                })}
              </div>
              <div className="my-1 h-px bg-neutral-100" />
              <button onClick={() => addBatchWithProduct(supplyMenu.productId)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-neutral-700 hover:bg-neutral-50"><Plus size={14} className="text-neutral-400" /> Новая партия</button>
            </div>
          </>
        );
      })()}

      {undoDel && (
        <div className="fixed left-1/2 bottom-6 z-[96] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-xl">
          <Trash2 size={15} className="shrink-0 text-neutral-400" />
          <span className="max-w-[260px] truncate">«{undoDel.title}» — в корзине</span>
          <button onClick={() => { (undoDel.kind === "product" ? restoreProduct : undoDel.kind === "function" ? restoreFunction : restoreJob)(undoDel.id); setUndoDel(null); }} className="shrink-0 font-bold text-amber-300 hover:underline">Вернуть</button>
        </div>
      )}
      {trashOpen && <TrashPanel jobs={trashJobs} people={profiles} products={allProducts} trashProducts={trashProducts} trashFunctions={trashFunctions} areas={duties.areas} startSection={trashSec} onRestoreProduct={restoreProduct} onPurgeProducts={purgeProducts} onRestoreFunction={restoreFunction} onPurgeFunctions={purgeFunctions} myId={myProfile ? myProfile.id : null} userEmail={userEmail} onRestore={restoreJob} onPurge={(ids) => setJobs((js) => js.filter((j) => !ids.includes(j.id)))} onClose={() => setTrashOpen(false)} />}

      {/* Всплывающее подтверждение */}
      {toast && (
        <div className="fixed left-1/2 bottom-6 z-[90] flex -translate-x-1/2 items-center gap-2.5 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-xl">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-500"><Check size={13} strokeWidth={3} /></span>
          <span>{toast.text}</span>
          <button onClick={() => { setToast(null); setActiveTab("purchases"); }} className="ml-1 shrink-0 font-semibold text-sky-300 hover:underline">Открыть закупки</button>
        </div>
      )}

      {ganttModal && (() => {
        const gp = products.find((x) => x.id === ganttModal.productId);
        if (!gp) return null;
        const close = () => setGanttModal(null);
        if (ganttModal.mode === "popup")
          return (
            <GanttPopup
              state={{ task: ganttModal.task, dateKey: ganttModal.dateKey }}
              cells={gp.rnp.cells || {}}
              entries={gp.rnp.entries || {}}
              refSources={{ bloggerDB: bloggerDB.filter((r) => !r.deletedAt), razdachDB: razdachDB.filter((r) => !r.deletedAt) }}
              onSetCell={(k, v) => setRnpCell(gp.id, k, v)}
              onSetEntries={(k, arr) => setRnpEntries(gp.id, k, arr)}
              onClose={close}
            />
          );
        return (
          <EntriesDB
            task={ganttModal.task}
            entries={gp.rnp.entries || {}}
            startDate={rnpStartDate}
            refSources={{ bloggerDB: bloggerDB.filter((r) => !r.deletedAt), razdachDB: razdachDB.filter((r) => !r.deletedAt) }}
            onSetEntries={(k, arr) => setRnpEntries(gp.id, k, arr)}
            onClose={close}
          />
        );
      })()}

      {activeTab === "base" && (() => {
        const BLOGGER_FIELDS_DB = [
          { id: "image", label: "Фото", type: "image" },
          { id: "name", label: "Исполнитель", type: "text" },
          { id: "status", label: "Статус", type: "select", options: BLOGGER_STATUSES },
          { id: "inst", label: "Инстаграм", type: "link" },
          { id: "tg", label: "Телеграм", type: "link" },
          { id: "tiktok", label: "Тикток", type: "link" },
          { id: "count", label: "Кол-во интеграций", type: "calc", fn: (r) => bloggerIntegrationCount(r.name) },
          { id: "rating", label: "Рейтинг", type: "stars" },
          { id: "price", label: "Стоимость поста", type: "num" },
        ];
        const RAZDACH_FIELDS_DB = [
          { id: "image", label: "Фото", type: "image" },
          { id: "name", label: "Инстаграм", type: "text" },
          { id: "rating", label: "Рейтинг", type: "stars" },
          { id: "comment", label: "Комментарий", type: "text" },
        ];
        const CUSTOM_FIELDS_DB = [
          { id: "image", label: "Фото", type: "image" },
          { id: "name", label: "Название", type: "text" },
          { id: "link", label: "Ссылка", type: "link" },
          { id: "contact", label: "Контакт", type: "text" },
          { id: "rating", label: "Рейтинг", type: "stars" },
          { id: "comment", label: "Комментарий", type: "text" },
        ];
        const active = (customDBs || []).some((c) => c.id === dbActive) ? dbActive
          : dbActive === "razdach" ? "razdach" : "blogger";
        const activeCustom = (customDBs || []).find((c) => c.id === active);
        const cfg = active === "blogger"
          ? { title: "Блогеры", fields: BLOGGER_FIELDS_DB, rows: bloggerDB, setRows: setBloggerDB }
          : active === "razdach"
          ? { title: "Раздачницы", fields: RAZDACH_FIELDS_DB, rows: razdachDB, setRows: setRazdachDB }
          : {
              title: activeCustom?.name || "База",
              fields: CUSTOM_FIELDS_DB,
              rows: activeCustom?.rows || [],
              setRows: (upd) => setCustomDBs((list) => (list || []).map((c) => (c.id === active ? { ...c, rows: typeof upd === "function" ? upd(c.rows || []) : upd } : c))),
            };
        const addType = () => { const n = (typeof window !== "undefined" && window.prompt("Название нового вида базы:") || "").trim(); if (!n) return; const id = uid(); setCustomDBs((list) => [...(list || []), { id, name: n, rows: [] }]); setDbActive(id); };
        const removeType = (id) => { if (typeof window !== "undefined" && !window.confirm("Удалить этот вид базы со всеми записями?")) return; setCustomDBs((list) => (list || []).filter((c) => c.id !== id)); setDbActive("blogger"); };
        const types = [
          { id: "blogger", name: "Блогеры", count: bloggerDB.filter((r) => !r.deletedAt).length },
          { id: "razdach", name: "Раздачницы", count: razdachDB.filter((r) => !r.deletedAt).length },
          ...(customDBs || []).map((c) => ({ id: c.id, name: c.name, custom: true, count: (c.rows || []).filter((r) => !r.deletedAt).length })),
        ];
        const usage = active === "blogger" ? (r) => {
          const nm = (r.name || "").trim(); if (!nm) return [];
          const out = [];
          for (const pr of products) {
            const entries = pr.rnp?.entries || {};
            for (const [k, arr] of Object.entries(entries)) {
              if (!k.startsWith("bloggers:") || k.endsWith(":_ranges")) continue;
              for (const e of arr || []) if ((e.who || "").trim() === nm) out.push({ id: pr.id + k + (e.id || ""), name: pr.name || "", code: pr.code || "", image: pr.photo || "", date: k.slice(9), cost: calcRecordCost(BLOGGER_FIELDS, e) || 0 });
            }
          }
          return out.sort((x, y) => String(y.date).localeCompare(String(x.date)));
        } : null;
        const createDbTask = (title) => upsertJob({ id: uid(), title, date: null, start: null, done: false, labelId: null, productId: null, priority: "low", assignee: null, tags: [], stage: "wait", note: "Из базы", checklist: [], createdAt: isoYMD(new Date()) });
        return (
          <RefDB
            key={active}
            typeId={active}
            title={cfg.title}
            types={types}
            activeId={active}
            onSelect={setDbActive}
            onAddType={addType}
            onRemoveType={removeType}
            fields={cfg.fields}
            rows={cfg.rows}
            setRows={cfg.setRows}
            extraCols={dbColumns[active] || []}
            setExtraCols={(cols) => setDbColumns((d) => ({ ...d, [active]: cols }))}
            usage={usage}
            onCreateTask={createDbTask}
            embedded
            onClose={() => setActiveTab("assortment")}
          />
        );
      })()}

      {myProfileOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-neutral-900/40 p-4" onClick={() => setMyProfileOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900">Мой профиль</h2>
              <button onClick={() => setMyProfileOpen(false)} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
            </div>
            {!myProfile ? (
              <div className="py-8 text-center text-sm text-neutral-400">Профиль загружается…</div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <PersonAvatar p={myProfile} size={64} />
                    <button onClick={() => profilePhotoInputRef.current && profilePhotoInputRef.current.click()} title="Загрузить фото" className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm hover:text-neutral-800"><Camera size={13} /></button>
                    <input ref={profilePhotoInputRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return; try { const url = await fileToAvatarDataURL(f); patchMyProfile({ photo: url }); } catch { /* фото не загрузилось — пропускаем */ } }} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-neutral-800">{profileLabel(myProfile)}</div>
                    <div className="truncate text-xs text-neutral-400">{myProfile.email}</div>
                    {myProfile.photo && <button onClick={() => patchMyProfile({ photo: "" })} className="mt-1 text-[11px] font-semibold text-neutral-400 hover:text-red-500">Убрать фото</button>}
                  </div>
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-neutral-500">Имя</span>
                  <input value={myProfile.name} onChange={(e) => patchMyProfile({ name: e.target.value })} placeholder={myProfile.email ? myProfile.email.split("@")[0] : "Ваше имя"} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-400 focus:outline-none" />
                </label>
                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-neutral-500">Цвет</span>
                  <div className="flex flex-wrap gap-1.5">{SWATCHES.map((c) => <button key={c} onClick={() => patchMyProfile({ color: c })} className="h-6 w-6 rounded-full" style={{ background: c, boxShadow: myProfile.color === c ? `0 0 0 2px #fff, 0 0 0 3px ${c}` : "none" }} />)}</div>
                </div>
                <div className="flex justify-end pt-1">
                  <button onClick={() => setMyProfileOpen(false)} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800">Готово</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

function FragmentRow({ children }) {
  return <>{children}</>;
}

/* ----------------------------------------------------------------------------
   Вкладка «Закупки» — отдельный список планируемых к закупке товаров
---------------------------------------------------------------------------- */

/* ============================ Блок «Обязанности» ============================ */
function seedDuties() {
  const a1 = uid(), a2 = uid(), p1 = uid(), p2 = uid(), p3 = uid();
  const mkFn = (areaId, name, assignee, wds, subs) => ({ id: uid(), areaId, name, assignee, recur: normRecur({ mode: "weekly", weekdays: wds }), subs: subs || [] });
  const mkSub = (name, assignee, wds) => ({ id: uid(), name, assignee, recur: normRecur({ mode: "weekly", weekdays: wds }) });
  return {
    areas: [{ id: a1, name: "Закупки", color: "#2563eb" }, { id: a2, name: "Продажи", color: "#10b981" }],
    people: [{ id: p1, name: "Аня", color: "#ef4444" }, { id: p2, name: "Игорь", color: "#f59e0b" }, { id: p3, name: "Марина", color: "#8b5cf6" }],
    functions: [
      mkFn(a1, "Работа с поставщиками", p1, [1, 4], [mkSub("Поиск новых поставщиков", p1, [1]), mkSub("Запрос цен и образцов", p1, [1, 4])]),
      mkFn(a1, "Логистика и приёмка", p2, [1, 2, 3, 4, 5, 6, 0], []),
      mkFn(a2, "Контент и карточки", p3, [2, 5], []),
      mkFn(a2, "Реклама и аналитика", null, [1, 2, 3, 4, 5, 6, 0], []),
    ],
  };
}
function normDuties(v) {
  if (!v || typeof v !== "object") return seedDuties();
  const areas = Array.isArray(v.areas) ? v.areas.filter((a) => a && typeof a === "object").map((a) => ({ id: a.id || uid(), name: a.name || "Область", color: a.color || "#6366f1" })) : [];
  const people = Array.isArray(v.people) ? v.people.filter((p) => p && typeof p === "object").map((p) => ({ id: p.id || uid(), name: p.name || "Исполнитель", color: p.color || "#64748b" })) : [];
  const normSub = (s) => ({ id: s.id || uid(), name: s.name || "", assignee: s.assignee || null, recur: normRecur(s.recur) });
  const functions = Array.isArray(v.functions) ? v.functions.filter((f) => f && typeof f === "object").map((f) => ({ id: f.id || uid(), areaId: f.areaId || null, name: f.name || "", assignee: f.assignee || null, recur: normRecur(f.recur), subs: Array.isArray(f.subs) ? f.subs.map(normSub) : [], ...(f.deletedAt ? { deletedAt: f.deletedAt, deletedBy: f.deletedBy || null } : {}) })) : [];
  return { areas, people, functions };
}

// ===== ИИ-агенты: реестр всех агентов в разных видах (карточки / таблица / по этапам) =====
const AGENT_TYPES = { alert: { n: "Алерт", c: "bg-red-100 text-red-600" }, func: { n: "Функция", c: "bg-blue-100 text-blue-700" }, acct: { n: "Учёт", c: "bg-green-100 text-green-700" }, report: { n: "Отчёт", c: "bg-purple-100 text-purple-700" }, rule: { n: "Автоправило", c: "bg-amber-100 text-amber-700" }, query: { n: "Быстрый запрос", c: "bg-neutral-200 text-neutral-700" } };
const AGENT_STAGES = [["idea", "Идея", "#a3a3a3"], ["data", "Проверка данных", "#f59e0b"], ["dev", "Разработка", "#3b82f6"], ["live", "Работает", "#16a34a"]];
function defaultAgents() {
  const A = (name, type, stage, desc, extra) => ({ id: uid(), name, type, stage, desc: desc || "", schedule: "", assignees: [], data: [], steps: [], taskId: null, ...(extra || {}) });
  const D = (name, ok) => ({ id: uid(), name, ok });
  const S = (text, done) => ({ id: uid(), text, done: !!done });
  return [
    // — Алерты —
    A("Заканчивается остаток + срочно заказать", "alert", "data", "Считает запас в днях по WB, Озон и складу, пишет в Telegram, что срочно заказать.", { schedule: "Ежедневно 10:00", data: [D("Остатки WB", true), D("Остатки Озон", true), D("Склад (МойСклад)", true), D("История продаж", false)], steps: [S("Проверка данных: что есть и чего не хватает"), S("Свести остатки WB + Озон + склад по коду товара"), S("Заполнить справочники: срок пополнения, страховой запас"), S("Собрать агента и сверить расчёт по 5 товарам")] }),
    A("Рекламная кампания тратит деньги без заказов", "alert", "idea", "За 7 дней расход выше порога при нуле заказов: сообщение и предложение поставить на паузу."),
    A("Подключены ненужные инструменты продвижения", "alert", "idea", "Например, сбор видеоотзывов. Находит включённые инструменты, которые не нужны."),
    A("Выросла доля отмен по товару", "alert", "idea", "Следит за долей отмен по каждому товару и пишет, если она резко выросла."),
    A("Продаём товар в 0", "alert", "idea", "Находит товары, которые продаются без прибыли или в минус."),
    A("Оценка испортилась", "alert", "idea", "Сообщает, когда у товара заметно упала средняя оценка."),
    A("Оборачиваемость и платное хранение", "alert", "idea", "Видно, какие товары скоро начнут платить за долгое хранение на FBO."),
    A("Цена ушла ниже минимальной", "alert", "idea", "Сравнивает цену на площадках с минимальной по товару и сообщает о выходе за порог."),
    A("Возвраты: причины, состояние товара, что вернулось на склад", "alert", "idea", "Разбирает причины возвратов, состояние товара и что реально вернулось на склад."),
    A("Частые жалобы, расхождения с описанием", "alert", "idea", "Собирает повторяющиеся жалобы покупателей и расхождения карточки с реальным товаром."),
    A("Эластичность цены по каждому товару", "alert", "idea", "По истории видно, как продажи реагировали на изменение цены. С бритвой минус 18% к цене дали ×3 к продажам. Находит товары, где цену можно поднять без потери заказов, и товары, где небольшая скидка резко добавит продаж."),
    // — Функции —
    A("Ответы на отзывы и вопросы", "func", "idea", "Готовит ответы, человек одобряет. Нужен доступ к отзывам и вопросам WB и Озон."),
    A("Распределение поставок / план закупок", "func", "data", "Предлагает, сколько и каких размеров отправить в каждый кластер Озон, учитывая остатки, продажи и динамику роста категории.", { data: [D("Остатки", true), D("Продажи Озон по кластерам", false)] }),
    A("Понять, что делать", "func", "idea", "Скилл в Claude, который анализирует задачи и подсказывает, что делать дальше."),
    A("Поиск товара на 1688", "func", "idea", "Ищет поставщиков и аналоги товара на 1688."),
    A("Изменение цен (в том числе после приёмки)", "func", "idea", "Предлагает новые цены, когда меняется себестоимость или остаток."),
    // — Учёт —
    A("Себестоимость и автозагрузка в МС", "acct", "dev", "Делит карго и расходы на единицы, загружает приёмку в МойСклад с полной себестоимостью.", { schedule: "При каждой поставке", data: [D("МойСклад (токен)", true), D("Инвойсы 1688", false), D("Счета карго", false)], steps: [S("Данные: инвойс, карго, курс", true), S("Правило распределения", true), S("Проверка человеком"), S("Загрузка приёмки в МС"), S("Сверка на 3 поставках")] }),
    A("Сверка по заказам", "acct", "idea", "Сверяет заказы между кабинетами, сервисом и складом."),
    A("Сверка по движению товаров", "acct", "idea", "Сверяет приёмки, отгрузки и списания."),
    A("Фин. отчёт по каждому товару и по всему кабинету", "acct", "idea", "Финансовый отчёт в разрезе товара и по кабинету в целом."),
    A("PnL", "acct", "idea", "Отчёт о прибылях и убытках."),
    A("Потери на складах Ozon", "acct", "idea", "Сверяет отгружённое в поставках с тем, что Ozon принял и продал, и находит расхождения, по которым положена компенсация."),
    A("Прогноз выплат", "acct", "idea", "Когда и сколько Ozon переведёт, с учётом удержаний и возвратов."),
    A("Остатки по всем складам и капитализация", "acct", "idea", "Сводит остатки по всем складам и считает, сколько денег лежит в товаре."),
    A("Сверка логистики", "acct", "idea", "Ozon считает логистику по объёму и весу. Если габариты в карточке завышены или Ozon перемерил товар, вы переплачиваете с каждой продажи. Сравнивает фактические удержания с тарифом по каждому SKU."),
    A("Бухгалтерия и отчётность", "acct", "idea", "Подготовка данных для бухгалтерии и отчётности."),
    A("Отчёт о реализации за месяц для бухгалтера", "acct", "idea", "Отчёт в удобном виде для бухгалтера, а также сверка: сколько Ozon начислил и сколько реально перевёл."),
    // — Отчёты —
    A("Сколько брака за месяц", "report", "idea", "Отчёт по браку за месяц."),
    A("Проверка изменений до и после", "report", "idea", "Меняете фото или цену и через 2 недели получаете сравнение «до и после» по заказам и CTR."),
    A("Индекс локализации", "report", "idea", "Если товар едет к покупателю из другого кластера, Ozon берёт доплату. Считает, сколько вы на этом теряете в месяц и какие товары стоит развезти по складам."),
    // — Автоправила —
    A("Автоправила для кампаний", "rule", "idea", "Например: если за 7 дней расход больше X при 0 заказов, кампанию на паузу; если ДРР ниже 5%, бюджет больше. Нужен рекламный ключ с правом записи."),
    // — Быстрые запросы —
    A("Скажи, какой маркет приносит больше денег", "query", "idea", "Быстрый вопрос агенту: сравнение площадок по деньгам."),
    A("Какой товар неликвидный", "query", "idea", "Быстрый вопрос агенту: список неликвидных товаров."),
  ];
}
function AgentsBoard({ agents, onChange, people = [], onCreateTask, onOpenTask }) {
  const list = Array.isArray(agents) ? agents : [];
  const [view, setViewRaw] = useState(() => { const v = lsGet("rnp.agentsView", "cards"); return ["cards", "table", "stages"].includes(v) ? v : "cards"; });
  const setView = (v) => { setViewRaw(v); lsSet("rnp.agentsView", v); };
  const [fType, setFType] = useState("all");
  const [fPerson, setFPerson] = useState("all");
  const [selId, setSelId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const listRef = useRef(list); listRef.current = list;
  const personName = (id) => { const p = people.find((x) => x.id === id); return p ? profileLabel(p) : ""; };
  const initials = (id) => (personName(id) || "?").slice(0, 1).toUpperCase();
  const patch = (id, p) => onChange(listRef.current.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const add = () => { const a = { id: uid(), name: "Новый агент", type: "func", stage: "idea", desc: "", schedule: "", assignees: [], data: [], steps: [], taskId: null }; onChange([...listRef.current, a]); setSelId(a.id); };
  const del = (id) => { onChange(listRef.current.filter((a) => a.id !== id)); setSelId(null); setConfirmDel(false); };
  const shown = list.filter((a) => (fType === "all" || a.type === fType) && (fPerson === "all" || (a.assignees || []).includes(fPerson)));
  const stageOf = (a) => AGENT_STAGES.find((s) => s[0] === a.stage) || AGENT_STAGES[0];
  const prog = (a) => { const st = a.steps || []; return st.length ? Math.round((st.filter((s) => s.done).length / st.length) * 100) : 0; };
  const sel = list.find((a) => a.id === selId) || null;
  const cnt = (t) => list.filter((a) => t === "all" || a.type === t).length;
  const live = list.filter((a) => a.stage === "live").length, dev = list.filter((a) => a.stage === "dev").length;
  const Pill = ({ a }) => <span className={"inline-block rounded-full px-2 py-0.5 text-[11px] font-extrabold " + (AGENT_TYPES[a.type] || AGENT_TYPES.func).c}>{(AGENT_TYPES[a.type] || AGENT_TYPES.func).n}</span>;
  const Stage = ({ a }) => { const s = stageOf(a); return <span className="inline-flex items-center gap-1.5 text-xs font-bold text-neutral-600"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s[2] }} />{s[1]}</span>; };
  const Avs = ({ a }) => <span className="ml-auto flex -space-x-1">{(a.assignees || []).map((id) => <span key={id} title={personName(id)} className="flex h-6 w-6 items-center justify-center rounded-full border border-white bg-orange-100 text-[10px] font-extrabold text-orange-700">{initials(id)}</span>)}</span>;
  const dataTxt = (a) => (a.data || []).length ? (a.data || []).map((d) => d.name + (d.ok ? " ✓" : " ✗")).join(" · ") : "—";
  return (
    <div className="mx-auto max-w-[1200px] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-2xl font-extrabold text-neutral-900">ИИ-агенты</div>
        <span className="text-sm text-neutral-400">{list.length} агентов · {live} работают · {dev} в разработке</span>
        <div className="ml-auto flex rounded-xl bg-neutral-100 p-0.5">
          {[["cards", "Карточки"], ["table", "Таблица"], ["stages", "По этапам"]].map(([k, n]) => <button key={k} onClick={() => setView(k)} className={"rounded-lg px-3 py-1.5 text-sm font-bold transition " + (view === k ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>{n}</button>)}
        </div>
        <button onClick={add} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-600">+ Агент</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {[["all", "Все"], ["alert", "Алерты"], ["func", "Функции"], ["acct", "Учёт"], ["report", "Отчёты"], ["rule", "Автоправила"], ["query", "Быстрые запросы"]].map(([k, n]) => <button key={k} onClick={() => setFType(k)} className={"rounded-full border px-3 py-1 text-xs font-bold " + (fType === k ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50")}>{n} {cnt(k)}</button>)}
        <select value={fPerson} onChange={(e) => setFPerson(e.target.value)} className="ml-auto rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs font-semibold text-neutral-600">
          <option value="all">Исполнитель: все</option>
          {people.map((p) => <option key={p.id} value={p.id}>{profileLabel(p)}</option>)}
        </select>
      </div>

      {view === "cards" && (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((a) => (
            <button key={a.id} onClick={() => { setSelId(a.id); setConfirmDel(false); }} className={"rounded-2xl border bg-white p-4 text-left transition hover:shadow-md " + (a.stage === "dev" ? "border-orange-200 bg-gradient-to-b from-white to-orange-50/50" : "border-neutral-200")}>
              <Pill a={a} />
              <div className="mt-2 text-[15px] font-extrabold text-neutral-900">{a.name}</div>
              <div className="mt-1 line-clamp-3 text-[12.5px] leading-snug text-neutral-500">{a.desc || "Описание не заполнено"}</div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-200"><div className="h-full rounded-full bg-orange-500" style={{ width: prog(a) + "%" }} /></div>
              <div className="mt-3 flex items-center"><Stage a={a} /><Avs a={a} /></div>
            </button>
          ))}
          <button onClick={add} className="flex min-h-[120px] items-center justify-center rounded-2xl border border-dashed border-neutral-300 text-sm font-extrabold text-neutral-400 hover:bg-neutral-50">+ Добавить агента</button>
        </div>
      )}

      {view === "table" && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead><tr className="text-left text-[10.5px] font-extrabold tracking-wide text-neutral-400">{["АГЕНТ", "ТИП", "ЭТАП", "ДАННЫЕ", "ЗАПУСК", "ИСПОЛНИТЕЛЬ"].map((h) => <th key={h} className="px-3.5 py-2.5">{h}</th>)}</tr></thead>
            <tbody>{shown.map((a) => (
              <tr key={a.id} onClick={() => { setSelId(a.id); setConfirmDel(false); }} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50">
                <td className="px-3.5 py-3 font-bold text-neutral-900">{a.name}</td>
                <td className="px-3.5 py-3"><Pill a={a} /></td>
                <td className="px-3.5 py-3"><Stage a={a} /></td>
                <td className="px-3.5 py-3 text-xs text-neutral-600">{dataTxt(a)}</td>
                <td className="px-3.5 py-3 text-xs text-neutral-600">{a.schedule || "—"}</td>
                <td className="px-3.5 py-3 text-xs text-neutral-600">{(a.assignees || []).map(personName).filter(Boolean).join(", ") || "—"}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      {view === "stages" && (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          {AGENT_STAGES.map(([k, n, col]) => { const items = shown.filter((a) => a.stage === k); return (
            <div key={k} className="rounded-2xl bg-neutral-100 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-neutral-500"><i className="inline-block h-2 w-2 rounded-full" style={{ background: col }} />{n.toUpperCase()} · {items.length}</div>
              {items.map((a) => (
                <button key={a.id} onClick={() => { setSelId(a.id); setConfirmDel(false); }} className="mb-2 block w-full rounded-xl border border-neutral-200 bg-white p-3 text-left hover:shadow-md">
                  <Pill a={a} />
                  <div className="mt-1 text-sm font-extrabold text-neutral-900">{a.name}</div>
                  <div className="mt-2 flex items-center"><Avs a={a} /></div>
                </button>))}
              {!items.length && <div className="p-1.5 text-xs text-neutral-400">пока пусто</div>}
            </div>); })}
        </div>
      )}

      {sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setSelId(null)}>
          <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <input value={sel.name} onChange={(e) => patch(sel.id, { name: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 text-xl font-extrabold text-neutral-900 hover:border-neutral-200 focus:border-orange-400 focus:outline-none" />
              <button onClick={() => setSelId(null)} className="rounded-lg px-2 py-1 text-neutral-400 hover:bg-neutral-100">✕</button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select value={sel.type} onChange={(e) => patch(sel.id, { type: e.target.value })} className="rounded-lg border border-neutral-200 px-2 py-1 text-sm font-semibold">{Object.entries(AGENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.n}</option>)}</select>
              <select value={sel.stage} onChange={(e) => patch(sel.id, { stage: e.target.value })} className="rounded-lg border border-neutral-200 px-2 py-1 text-sm font-semibold">{AGENT_STAGES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
              <input value={sel.schedule || ""} onChange={(e) => patch(sel.id, { schedule: e.target.value })} placeholder="Когда запускается" className="min-w-[160px] flex-1 rounded-lg border border-neutral-200 px-2 py-1 text-sm" />
            </div>
            <textarea value={sel.desc || ""} onChange={(e) => patch(sel.id, { desc: e.target.value })} rows={3} placeholder="Что делает агент" className="mt-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none" />
            <div className="mt-3">
              <div className="text-[10.5px] font-extrabold tracking-wide text-neutral-400">ИСПОЛНИТЕЛИ</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{people.map((p) => { const on = (sel.assignees || []).includes(p.id); return <button key={p.id} onClick={() => patch(sel.id, { assignees: on ? sel.assignees.filter((x) => x !== p.id) : [...(sel.assignees || []), p.id] })} className={"rounded-full border px-2.5 py-1 text-xs font-bold " + (on ? "border-orange-300 bg-orange-100 text-orange-700" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50")}>{profileLabel(p)}</button>; })}</div>
            </div>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <div>
                <div className="text-[10.5px] font-extrabold tracking-wide text-neutral-400">ШАГИ · {prog(sel)}%</div>
                <div className="mt-1.5 space-y-1">{(sel.steps || []).map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={!!s.done} onChange={() => patch(sel.id, { steps: sel.steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })} />
                    <input value={s.text} onChange={(e) => patch(sel.id, { steps: sel.steps.map((x) => (x.id === s.id ? { ...x, text: e.target.value } : x)) })} className={"min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-sm hover:border-neutral-200 focus:border-orange-400 focus:outline-none " + (s.done ? "text-neutral-400 line-through" : "")} />
                    <button onClick={() => patch(sel.id, { steps: sel.steps.filter((x) => x.id !== s.id) })} className="text-neutral-300 hover:text-red-500">✕</button>
                  </div>))}
                  <button onClick={() => patch(sel.id, { steps: [...(sel.steps || []), { id: uid(), text: "Новый шаг", done: false }] })} className="text-xs font-bold text-orange-600 hover:underline">+ шаг</button>
                </div>
              </div>
              <div>
                <div className="text-[10.5px] font-extrabold tracking-wide text-neutral-400">ДАННЫЕ И ДОСТУПЫ</div>
                <div className="mt-1.5 space-y-1">{(sel.data || []).map((d) => (
                  <div key={d.id} className="flex items-center gap-2">
                    <button onClick={() => patch(sel.id, { data: sel.data.map((x) => (x.id === d.id ? { ...x, ok: !x.ok } : x)) })} className={"w-12 shrink-0 rounded-md px-1.5 py-0.5 text-xs font-extrabold " + (d.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600")}>{d.ok ? "есть" : "нет"}</button>
                    <input value={d.name} onChange={(e) => patch(sel.id, { data: sel.data.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)) })} className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-sm hover:border-neutral-200 focus:border-orange-400 focus:outline-none" />
                    <button onClick={() => patch(sel.id, { data: sel.data.filter((x) => x.id !== d.id) })} className="text-neutral-300 hover:text-red-500">✕</button>
                  </div>))}
                  <button onClick={() => patch(sel.id, { data: [...(sel.data || []), { id: uid(), name: "Источник данных", ok: false }] })} className="text-xs font-bold text-orange-600 hover:underline">+ источник</button>
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4">
              {sel.taskId && onOpenTask && <button onClick={() => { if (onOpenTask(sel.taskId)) setSelId(null); else patch(sel.id, { taskId: null }); }} className="rounded-xl border border-neutral-200 px-3 py-1.5 text-sm font-bold text-neutral-700 hover:bg-neutral-50">Открыть задачу</button>}
              {!sel.taskId && onCreateTask && <button onClick={() => { const id = onCreateTask({ title: "ИИ-агент: " + sel.name, note: sel.desc || "", checklist: (sel.steps || []).map((s) => ({ text: s.text, done: s.done })) }); patch(sel.id, { taskId: id }); setSelId(null); }} className="rounded-xl border border-neutral-200 px-3 py-1.5 text-sm font-bold text-neutral-700 hover:bg-neutral-50">Создать задачу</button>}
              <span className="ml-auto" />
              {!confirmDel ? <button onClick={() => setConfirmDel(true)} className="text-sm font-bold text-neutral-400 hover:text-red-500">Удалить агента</button>
                : <button onClick={() => del(sel.id)} className="rounded-xl bg-red-500 px-3 py-1.5 text-sm font-extrabold text-white">Точно удалить</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DutiesBoard({ duties, onChange, onAddOp, opNames, deletedBy = null, onTrashed }) {
  const dAll = duties && duties.areas ? duties : normDuties(duties);
  const d = useMemo(() => ({ ...dAll, functions: dAll.functions.filter((f) => !f.deletedAt) }), [dAll]); // без корзины
  const [expanded, setExpanded] = useState(() => new Set());
  const dragFnRef = useRef(null);
  const [overArea, setOverArea] = useState(undefined);
  const [filterArea, setFilterArea] = useState(null);
  const [filterPerson, setFilterPerson] = useState(null);
  const [fpOpen, setFpOpen] = useState(false);
  const [asgKey, setAsgKey] = useState(null);
  const [recKey, setRecKey] = useState(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [groupBy, setGroupByRaw] = useState(() => (lsGet("rnp.dutiesGroup", "area") === "person" ? "person" : "area")); // area | person
  const [gbOpen, setGbOpen] = useState(false);
  const setGroupBy = (v) => { setGroupByRaw(v); lsSet("rnp.dutiesGroup", v); };
  const byPerson = groupBy === "person";
  const personById = Object.fromEntries(d.people.map((p) => [p.id, p]));
  // Все мутации читают АКТУАЛЬНОЕ состояние из рефа, а не из устаревшего замыкания —
  // иначе быстрый ввод и перерисовки от облачного эха могли бы затирать правки.
  const stateRef = useRef(dAll); stateRef.current = dAll;
  const save = (next) => { stateRef.current = next; onChange(next); };
  const patchFn = (fid, p) => { const c = stateRef.current; save({ ...c, functions: c.functions.map((f) => (f.id === fid ? { ...f, ...p } : f)) }); };
  const patchSub = (fid, sid, p) => { const c = stateRef.current; save({ ...c, functions: c.functions.map((f) => (f.id === fid ? { ...f, subs: f.subs.map((s) => (s.id === sid ? { ...s, ...p } : s)) } : f)) }); };
  const addFunction = () => { const c = stateRef.current; const areaId = filterArea || c.areas[0]?.id || null; const id = uid(); save({ ...c, functions: [...c.functions, { id, areaId, name: "", assignee: null, recur: normRecur(null), subs: [] }] }); setExpanded((s) => new Set(s).add(id)); };
  const addFunctionTo = (areaId, assignee = null) => { const c = stateRef.current; const id = uid(); save({ ...c, functions: [...c.functions, { id, areaId: areaId ?? c.areas[0]?.id ?? null, name: "", assignee, recur: normRecur(null), subs: [] }] }); setExpanded((s) => new Set(s).add(id)); };
  const removeFunction = (fid) => { const c = stateRef.current; const fn = c.functions.find((f) => f.id === fid); save({ ...c, functions: c.functions.map((f) => (f.id === fid ? { ...f, deletedAt: new Date().toISOString(), deletedBy } : f)) }); if (fn && onTrashed) onTrashed(fn); };
  const addSub = (fid) => { const c = stateRef.current; save({ ...c, functions: c.functions.map((f) => (f.id === fid ? { ...f, subs: [...f.subs, { id: uid(), name: "", assignee: f.assignee, recur: normRecur(f.recur) }] } : f)) }); setExpanded((s) => new Set(s).add(fid)); };
  const removeSub = (fid, sid) => { const c = stateRef.current; save({ ...c, functions: c.functions.map((f) => (f.id === fid ? { ...f, subs: f.subs.filter((s) => s.id !== sid) } : f)) }); };
  const addArea = () => { const c = stateRef.current; save({ ...c, areas: [...c.areas, { id: uid(), name: "Новая область", color: SWATCHES[c.areas.length % SWATCHES.length] }] }); };
  const patchArea = (aid, p) => { const c = stateRef.current; save({ ...c, areas: c.areas.map((a) => (a.id === aid ? { ...a, ...p } : a)) }); };
  const removeArea = (aid) => { const c = stateRef.current; save({ ...c, areas: c.areas.filter((a) => a.id !== aid), functions: c.functions.map((f) => (f.areaId === aid ? { ...f, areaId: null } : f)) }); };
  const addPerson = () => { const c = stateRef.current; save({ ...c, people: [...c.people, { id: uid(), name: "Новый", color: SWATCHES[c.people.length % SWATCHES.length] }] }); };
  const patchPerson = (pid, p) => { const c = stateRef.current; save({ ...c, people: c.people.map((x) => (x.id === pid ? { ...x, ...p } : x)) }); };
  const removePerson = (pid) => { const c = stateRef.current; save({ ...c, people: c.people.filter((x) => x.id !== pid), functions: c.functions.map((f) => ({ ...f, assignee: f.assignee === pid ? null : f.assignee, subs: f.subs.map((s) => ({ ...s, assignee: s.assignee === pid ? null : s.assignee })) })) }); };

  // нагрузка
  const load = {}; d.people.forEach((p) => (load[p.id] = 0)); let unassigned = 0;
  d.functions.forEach((f) => {
    if (f.assignee && load[f.assignee] != null) load[f.assignee]++; else unassigned++;
    f.subs.forEach((s) => { if (s.assignee && load[s.assignee] != null) load[s.assignee]++; else unassigned++; });
  });
  const maxLoad = Math.max(1, ...d.people.map((p) => load[p.id]), unassigned);

  // группировка по областям
  const orphan = d.functions.filter((f) => !d.areas.some((a) => a.id === f.areaId));
  const unassignedFns = d.functions.filter((f) => !d.people.some((p) => p.id === f.assignee));
  let groups = byPerson
    ? [...d.people.map((p) => ({ person: p, fns: d.functions.filter((f) => f.assignee === p.id) })), ...(unassignedFns.length ? [{ person: null, fns: unassignedFns }] : [])]
    : [...d.areas.map((a) => ({ area: a, fns: d.functions.filter((f) => f.areaId === a.id) })), ...(orphan.length ? [{ area: null, fns: orphan }] : [])];
  if (!byPerson && filterArea) groups = groups.filter((g) => g.area && g.area.id === filterArea);
  if (byPerson && filterPerson) groups = groups.filter((g) => g.person && g.person.id === filterPerson);
  const fpMatch = (f) => !filterPerson || f.assignee === filterPerson || f.subs.some((s) => s.assignee === filterPerson);

  const Avatar = ({ p, sm }) => <span className={"flex items-center justify-center rounded-full font-bold text-white " + (sm ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]")} style={{ background: p ? p.color : "#cfcfd6" }}>{p ? (p.name[0] || "?").toUpperCase() : "?"}</span>;

  const Pill = ({ who, k, onPick, compact }) => {
    const p = who ? personById[who] : null; const open = asgKey === k;
    return (
      <span className="relative shrink-0">
        <button onClick={(e) => { e.stopPropagation(); setAsgKey(open ? null : k); setRecKey(null); }} title={compact ? (p ? p.name : "Не назначен") : undefined} className={compact ? "flex items-center rounded-full ring-offset-1 transition hover:ring-2 hover:ring-neutral-200" : "inline-flex items-center gap-1.5 rounded-full border border-neutral-200 py-0.5 pl-0.5 pr-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"}>
          <Avatar p={p} sm />{!compact && <><span className={p ? "" : "text-neutral-400"}>{p ? p.name : "Не назначен"}</span><ChevronDown size={11} className="text-neutral-300" /></>}
        </button>
        {open && <><div className="fixed inset-0 z-10" onClick={() => setAsgKey(null)} /><div className={"absolute z-20 mt-1 w-44 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg " + (compact ? "left-0" : "right-0")}>
          <button onClick={() => { onPick(null); setAsgKey(null); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-400 hover:bg-neutral-50"><Avatar p={null} sm />Не назначен</button>
          {d.people.map((pp) => <button key={pp.id} onClick={() => { onPick(pp.id); setAsgKey(null); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50"><Avatar p={pp} sm />{pp.name}</button>)}
          <div className="mt-1 border-t border-neutral-100 pt-1"><button onClick={() => { setManageOpen(true); setAsgKey(null); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-neutral-400 hover:bg-neutral-50"><Users size={12} /> Управление</button></div>
        </div></>}
      </span>
    );
  };
  const RecBadge = ({ recur, k, onChange: onRec }) => {
    const open = recKey === k;
    return (
      <span className="relative shrink-0">
        <button onClick={(e) => { e.stopPropagation(); setRecKey(open ? null : k); setAsgKey(null); }} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-200"><Repeat size={11} className="text-neutral-400" /><span className="max-w-[160px] truncate">{describeRecur(recur)}</span></button>
        {open && <><div className="fixed inset-0 z-10" onClick={() => setRecKey(null)} /><div className="absolute right-0 z-20 mt-1 w-[320px] rounded-xl border border-neutral-200 bg-white p-4 shadow-lg">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Периодичность</div>
          <RecurEditor recur={recur} onChange={onRec} />
        </div></>}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* основная таблица */}
      <div className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-3">
          <span className="text-sm font-bold text-neutral-800">Функциональные обязанности</span>
          <div className="relative ml-auto">
            <button onClick={() => setFpOpen((o) => !o)} title="Фильтры: области и исполнители" className={"relative inline-flex items-center justify-center rounded-lg border p-2 transition " + ((filterArea || filterPerson) ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50")}>
              <Filter size={15} />
              {(filterArea || filterPerson) && <span className="absolute -right-1.5 -top-1.5 min-w-[16px] rounded-full bg-orange-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{(filterArea ? 1 : 0) + (filterPerson ? 1 : 0)}</span>}
            </button>
            {fpOpen && <><div className="fixed inset-0 z-10" onClick={() => setFpOpen(false)} /><div className="absolute right-0 z-20 mt-1.5 w-60 rounded-xl border border-neutral-200 bg-white p-2 shadow-xl">
              <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Область</div>
              <button onClick={() => setFilterArea(null)} className={"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-neutral-50 " + (!filterArea ? "font-semibold text-neutral-900" : "text-neutral-600")}>Все области{!filterArea && <Check size={13} className="ml-auto text-neutral-500" />}</button>
              {d.areas.map((a) => <button key={a.id} onClick={() => setFilterArea(filterArea === a.id ? null : a.id)} className={"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-neutral-50 " + (filterArea === a.id ? "font-semibold text-neutral-900" : "text-neutral-600")}><span className="h-2.5 w-2.5 rounded-sm" style={{ background: a.color }} />{a.name}{filterArea === a.id && <Check size={13} className="ml-auto text-neutral-500" />}</button>)}
              <div className="mt-1 border-t border-neutral-100 px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Исполнитель</div>
              <button onClick={() => setFilterPerson(null)} className={"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-neutral-50 " + (!filterPerson ? "font-semibold text-neutral-900" : "text-neutral-600")}>Все исполнители{!filterPerson && <Check size={13} className="ml-auto text-neutral-500" />}</button>
              {d.people.map((pp) => <button key={pp.id} onClick={() => setFilterPerson(filterPerson === pp.id ? null : pp.id)} className={"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-neutral-50 " + (filterPerson === pp.id ? "font-semibold text-neutral-900" : "text-neutral-600")}><Avatar p={pp} sm />{pp.name}{filterPerson === pp.id && <Check size={13} className="ml-auto text-neutral-500" />}</button>)}
              {(filterArea || filterPerson) && <button onClick={() => { setFilterArea(null); setFilterPerson(null); }} className="mt-1 w-full rounded-lg border-t border-neutral-100 px-2 pt-2 text-left text-xs font-semibold text-neutral-400 hover:text-neutral-700">Сбросить фильтры</button>}
            </div></>}
          </div>
          <div className="relative">
            <button onClick={() => setGbOpen((o) => !o)} title="Группировка: по областям или по исполнителям" className={"inline-flex items-center justify-center rounded-lg border p-2 transition " + (gbOpen ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50")}><Columns3 size={15} /></button>
            {gbOpen && <><div className="fixed inset-0 z-10" onClick={() => setGbOpen(false)} /><div className="absolute right-0 z-20 mt-1.5 w-52 rounded-xl border border-neutral-200 bg-white p-2 shadow-xl">
              <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Группировать</div>
              {[["area", "По областям"], ["person", "По исполнителям"]].map(([v, l]) => <button key={v} onClick={() => { setGroupBy(v); setGbOpen(false); }} className={"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-neutral-50 " + (groupBy === v ? "font-semibold text-neutral-900" : "text-neutral-600")}>{l}{groupBy === v && <Check size={13} className="ml-auto text-neutral-500" />}</button>)}
            </div></>}
          </div>
          <button onClick={() => setManageOpen(true)} title="Управление: области и исполнители" className="inline-flex items-center justify-center rounded-lg border border-neutral-200 p-2 text-neutral-500 transition hover:bg-neutral-50"><Settings2 size={15} /></button>
        </div>
        {/* группы по областям */}
        {(
          <div className="grid gap-3 p-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
            {groups.map((g) => {
              const aid = byPerson ? (g.person ? "p:" + g.person.id : "p:none") : (g.area ? g.area.id : null); const fns = g.fns.filter(fpMatch).filter((f) => !byPerson || !filterArea || f.areaId === filterArea);
              const accent = byPerson ? (g.person ? g.person.color : "#a3a3a3") : (g.area ? g.area.color : "#a3a3a3");
              const droppable = byPerson ? true : !!g.area;
              return (
                <div key={aid || "none"}
                  onDragOver={(e) => { if (dragFnRef.current && droppable) { e.preventDefault(); setOverArea(aid); } }}
                  onDragLeave={() => setOverArea((o) => (o === aid ? undefined : o))}
                  onDrop={(e) => { e.preventDefault(); if (dragFnRef.current && droppable) patchFn(dragFnRef.current, byPerson ? { assignee: g.person ? g.person.id : null } : { areaId: aid }); dragFnRef.current = null; setOverArea(undefined); }}
                  className="flex min-w-0 flex-col rounded-2xl border p-2.5 transition" style={{ borderColor: overArea === aid ? accent : "#ececef", background: overArea === aid ? accent + "14" : "#fafafa" }}>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    {byPerson ? <Avatar p={g.person} sm /> : <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: accent }} />}
                    <span className="truncate text-xs font-bold uppercase tracking-wide text-neutral-600">{byPerson ? (g.person ? g.person.name : "Не назначено") : (g.area ? g.area.name : "Без области")}</span>
                    <span className="rounded-full bg-neutral-200/70 px-1.5 text-[11px] font-bold text-neutral-500">{fns.length}</span>
                    {(byPerson || g.area) && !filterPerson && <button onClick={() => (byPerson ? addFunctionTo(filterArea || null, g.person ? g.person.id : null) : addFunctionTo(aid))} title="Добавить функцию" className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-700"><Plus size={15} /></button>}
                  </div>
                  <div className="flex min-h-[40px] flex-col gap-1.5">
                    {fns.map((f) => {
                      const isOpen = expanded.has(f.id);
                      const toggle = () => setExpanded((st) => { const n = new Set(st); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; });
                      return (
                        <div key={f.id} id={"fncard-" + f.id} onClick={(e) => { if (e.target.closest("input,textarea,button,[draggable=true]")) return; toggle(); }} className="group relative cursor-pointer rounded-[10px] border border-neutral-200 bg-white px-2.5 py-1.5 transition hover:shadow-md">
                          <div className="absolute -right-1.5 -top-2 z-[1] flex items-center gap-0.5 rounded-full border border-neutral-200 bg-white px-1 py-0.5 opacity-0 shadow-sm transition group-hover:opacity-100">
                            <span draggable onDragStart={(e) => { dragFnRef.current = f.id; const el = document.getElementById("fncard-" + f.id); if (el && e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setDragImage(el, 12, 12); } }} onDragEnd={() => { dragFnRef.current = null; setOverArea(undefined); }} className="cursor-grab text-neutral-400 hover:text-neutral-700" title="Перетащить в другую область"><GripVertical size={13} /></span>
                            <button onClick={() => removeFunction(f.id)} className="text-neutral-400 hover:text-red-500" title="Удалить функцию"><X size={12} /></button>
                          </div>
                          <div className="flex items-center gap-2">
                            <Pill compact who={f.assignee} k={`f:${f.id}`} onPick={(pid) => patchFn(f.id, { assignee: pid })} />
                            {byPerson && (() => { const ar = d.areas.find((a) => a.id === f.areaId); return ar ? <span title={ar.name} className="h-2 w-2 shrink-0 rounded-sm" style={{ background: ar.color }} /> : null; })()}
                            <textarea value={f.name} rows={1} onChange={(e) => patchFn(f.id, { name: e.target.value })} ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }} placeholder="Название функции…" className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-0.5 text-[13px] font-semibold leading-snug text-neutral-800 focus:outline-none" />
                            <button onClick={toggle} className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-neutral-100 px-1.5 text-[11px] font-bold text-neutral-500 hover:bg-neutral-200" title="Подфункции">{f.subs.length > 0 ? f.subs.length : <Plus size={11} />}{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
                          </div>
                          {isOpen && (
                            <div className="mt-1.5 flex flex-col gap-0.5 border-t border-dashed border-neutral-200 pt-1.5">
                              {f.subs.map((sb) => (
                                <div key={sb.id} className="flex items-center gap-1.5 py-0.5">
                                  <Pill compact who={sb.assignee} k={`s:${f.id}:${sb.id}`} onPick={(pid) => patchSub(f.id, sb.id, { assignee: pid })} />
                                  <input value={sb.name} onChange={(e) => patchSub(f.id, sb.id, { name: e.target.value })} placeholder="Подфункция…" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-neutral-700 focus:outline-none" />
                                  <button onClick={() => removeSub(f.id, sb.id)} className="shrink-0 text-neutral-300 hover:text-red-500"><X size={12} /></button>
                                </div>
                              ))}
                              <button onClick={() => addSub(f.id)} className="inline-flex w-fit items-center gap-1 pt-0.5 text-[12px] font-semibold text-neutral-400 hover:text-neutral-600"><Plus size={12} /> Подфункция</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {fns.length === 0 && <div className="rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-xs text-neutral-300">Пусто</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {d.areas.length === 0 && d.functions.length === 0 && <div className="px-4 py-12 text-center text-sm text-neutral-400">Нет областей. Откройте «Управление», чтобы добавить области и исполнителей.</div>}
      </div>

      {/* сводка нагрузки */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm lg:w-[300px] lg:shrink-0">
        <div className="px-4 pb-0.5 pt-4 text-sm font-bold text-neutral-800">Нагрузка по исполнителям</div>
        <div className="px-4 pb-3 text-[11px] text-neutral-400">по числу функций и подфункций</div>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {d.people.map((p) => (
            <div key={p.id}>
              <div className="flex items-center gap-2"><Avatar p={p} /><span className="text-[13px] font-semibold text-neutral-700">{p.name}</span><span className="ml-auto text-xs font-bold text-neutral-800">{load[p.id]}</span></div>
              <div className="mt-1.5 ml-8 h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full" style={{ width: `${Math.round((load[p.id] / maxLoad) * 100)}%`, background: p.color }} /></div>
            </div>
          ))}
          <div>
            <div className="flex items-center gap-2"><Avatar p={null} /><span className="text-[13px] font-semibold text-neutral-400">Не назначено</span><span className="ml-auto text-xs font-bold text-neutral-500">{unassigned}</span></div>
            <div className="mt-1.5 ml-8 h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-300" style={{ width: `${Math.round((unassigned / maxLoad) * 100)}%` }} /></div>
          </div>
        </div>
        <div className="border-t border-neutral-100 px-4 py-2.5"><button onClick={() => setManageOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-400 hover:text-neutral-700"><Users size={13} /> Исполнители и области</button></div>
      </div>

      {/* модалка управления */}
      {manageOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-900/40 p-4 pt-16" onClick={() => setManageOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold text-neutral-900">Исполнители и области</h2><button onClick={() => setManageOpen(false)} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button></div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {[{ title: "Исполнители", items: d.people, add: addPerson, patch: patchPerson, remove: removePerson }, { title: "Области", items: d.areas, add: addArea, patch: patchArea, remove: removeArea }].map((col) => (
                <div key={col.title}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{col.title}</div>
                  <div className="flex flex-col gap-2">
                    {col.items.map((it) => (
                      <div key={it.id} className="rounded-lg border border-neutral-100 p-2">
                        <div className="flex items-center gap-2">
                          <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: it.color }} />
                          <input value={it.name} onChange={(e) => col.patch(it.id, { name: e.target.value })} className="min-w-0 flex-1 bg-transparent text-sm font-medium text-neutral-800 focus:outline-none" />
                          <button onClick={() => col.remove(it.id)} className="shrink-0 text-neutral-300 hover:text-red-500"><Trash2 size={13} /></button>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1 pl-6">{SWATCHES.map((c) => <button key={c} onClick={() => col.patch(it.id, { color: c })} className="h-4 w-4 rounded-full" style={{ background: c, boxShadow: it.color === c ? `0 0 0 2px #fff, 0 0 0 3px ${c}` : "none" }} />)}</div>
                      </div>
                    ))}
                    <button onClick={col.add} className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"><Plus size={14} /> Добавить</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Статусы партии закупки
const PU_STATUS = { draft: { label: "Черновик", cls: "bg-neutral-100 text-neutral-500" }, paid: { label: "Оплачено", cls: "bg-emerald-50 text-emerald-600" }, transit: { label: "В пути", cls: "bg-amber-50 text-amber-600" }, received: { label: "Получено", cls: "bg-blue-50 text-blue-600" } };

// Блок «Закупки» — партии (как карты в «Стратегии»); внутри партии товары из каталога.
// выпадающий список этапов из справочника (названия этапов в партии не вводятся вручную)
function StagePicker({ label, current, options, onPick, dashed = false }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className={dashed ? "flex w-full items-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-left text-[13px] font-bold text-neutral-500 hover:bg-slate-100" : "flex max-w-full items-center gap-1.5 rounded-md border border-transparent px-1 py-0 text-left text-[13.5px] font-semibold text-neutral-800 hover:border-neutral-200"}>
        <span className="min-w-0 truncate">{label}</span><ChevronDown size={12} className="shrink-0 text-neutral-400" />
      </button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
        <div className="absolute left-0 top-full z-40 mt-1 max-h-[260px] w-[260px] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl">
          {current && <div className="rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[13px] font-semibold text-neutral-800">✓ {current}</div>}
          {options.length === 0 && <div className="px-2.5 py-2 text-xs text-neutral-400">Других этапов нет — все уже в цикле</div>}
          {options.map((o) => <button key={o.id} type="button" onClick={() => { onPick(o); setOpen(false); }} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold text-neutral-800 hover:bg-neutral-100">{o.name}</button>)}
        </div>
      </>)}
    </div>
  );
}

function PurchasesBoard({ focusId = null, batches, onChange, products, defaultRates, onOpenCard, onActiveChange, cycleStages = [], cycles = [], cycleTriggers = [], onCreateStageTask, jobs = [], people = [], onOpenJob, onAddJob }) {
  const list = Array.isArray(batches) ? batches : [];
  const [activeId, setActiveId] = useState((focusId && list.some((b) => b.id === focusId)) ? focusId : (list[0]?.id || null));
  useEffect(() => { if (focusId && list.some((b) => b.id === focusId)) setActiveId(focusId); }, [focusId]);
  const [editingId, setEditingId] = useState(null);
  const [picker, setPicker] = useState(false);
  const [pickerUp, setPickerUp] = useState(false); // открывать выпадашку товаров вверх, если снизу мало места
  const addBtnRef = useRef(null);
  const [pq, setPq] = useState("");
  const [stOpen, setStOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cycOpen, setCycOpen] = useState(false);
  const [durOpen, setDurOpen] = useState(false);
  const [dragSt, setDragSt] = useState(null);
  const [cycMore, setCycMore] = useState(false);
  const [factOpen, setFactOpen] = useState(false);
  const [stagePop, setStagePop] = useState(null); // id этапа, у которого открыто окошко дат
  const cycFresh = useRef({ cyc: null, patch: null }); // свежий цикл и patchCyc для кнопок в уведомлениях (замыкания устаревают)
  const [stageToasts, setStageToasts] = useState([]); // уведомления после ввода факта: [{id, text, actions:[{label, primary, fn}], sticky}]
  const [ratesOpen, setRatesOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false); // поповер «Задачи по партии»
  const [qtyPop, setQtyPop] = useState(null); // мини-окно размеров: {id, top, right, up}
  const qtyOpen = qtyPop ? { [qtyPop.id]: true } : {};
  const toggleQty = (iid, el) => setQtyPop((cur) => {
    if (cur && cur.id === iid) return null;
    const r = el ? el.getBoundingClientRect() : { bottom: 0, top: 0, right: 0 };
    const below = window.innerHeight - r.bottom;
    return { id: iid, right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6, bottom: window.innerHeight - r.top + 6, up: below < 260 && r.top > below };
  });
  useEffect(() => {
    if (!qtyPop) return;
    const close = () => setQtyPop(null);
    const key = (e) => { if (e.key === "Escape") close(); };
    const arm = setTimeout(() => window.addEventListener("scroll", close, true), 250); // не реагируем на скролл от автофокуса
    window.addEventListener("resize", close); window.addEventListener("keydown", key);
    return () => { clearTimeout(arm); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); window.removeEventListener("keydown", key); };
  }, [qtyPop]);
  const active = list.find((b) => b.id === activeId) || list[0] || null;
  useEffect(() => { onActiveChange && onActiveChange(active ? active.id : null); }, [active && active.id]);

  const addBatch = () => { const id = uid(); const b = { id, name: `Партия #${list.length + 1}`, status: "draft", cny: defaultRates.cny || "", usd: defaultRates.usd || "", cargo: defaultRates.cargo || "", commission: "", insurance: "", items: [], payments: [] }; onChange([...list, b]); setActiveId(id); };
  const dupBatch = (id) => { const src = list.find((b) => b.id === id); if (!src) return; const nid = uid(); const copy = JSON.parse(JSON.stringify({ ...src, id: nid, name: `${src.name} (копия)`, items: (src.items || []).map((it) => ({ ...it, id: uid() })) })); const at = list.findIndex((b) => b.id === id); const next = list.slice(); next.splice(at + 1, 0, copy); onChange(next); setActiveId(nid); };
  const renameBatch = (id, name) => onChange(list.map((b) => (b.id === id ? { ...b, name: name.trim() || "Партия" } : b)));
  const removeBatch = (id) => { const rest = list.filter((b) => b.id !== id); onChange(rest); if (id === activeId) setActiveId(rest[0]?.id || null); };
  const patchBatch = (p) => onChange(list.map((b) => (b.id === active.id ? { ...b, ...p } : b)));
  // производственный цикл партии
  const cyc = active && active.cycle;
  const cycStarted = !!(cyc && cyc.started && Array.isArray(cyc.stages));
  const cycSt = cycStarted ? cyc.stages.map((s) => { const L = (cycleStages || []).find((x) => x.id === s.id); return L ? { ...s, name: L.name } : s; }) : [];
  const [cycPick, setCycPick] = useState(null);
  const curIdx = cycSt.findIndex((s) => !s.done);
  const curStage = curIdx >= 0 ? cycSt[curIdx] : null;
  const cycDates = cycStarted ? cycleStageDates(cyc.startDate, cycSt) : {};
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const buildCycleStages = (cy, old = []) => (cy ? cy.stages : (cycleStages || []).map((x) => ({ id: x.id, days: x.days }))).map((x) => { const L = (cycleStages || []).find((y) => y.id === x.id); if (!L) return null; const o = old.find((z) => z.id === x.id); return { id: L.id, name: L.name, days: Math.max(0, parseInt(x.days) || 0), done: !!(o && o.done), ...(o && o.actualDate ? { actualDate: o.actualDate } : {}) }; }).filter(Boolean);
  const pickedCycle = (cycles || []).find((c) => c.id === cycPick) || (cycles || [])[0] || null;
  const startCycle = () => { patchBatch({ cycle: { started: true, startDate: todayISO(), fired: {}, cycleId: pickedCycle ? pickedCycle.id : null, stages: buildCycleStages(pickedCycle) } }); setCycOpen(true); };
  const switchCycle = (id) => { const cy = (cycles || []).find((c) => c.id === id); if (!cy) return; if (!window.confirm(`Заменить этапы партии этапами цикла «${cy.name}»? Отметки «пройдено» сохранятся для совпадающих этапов.`)) return; patchCyc({ cycleId: id, stages: buildCycleStages(cy, cycSt) }); };
  const swapCycStage = (oldId, L) => patchCyc({ stages: cycSt.map((s) => (s.id === oldId ? { ...s, id: L.id, name: L.name } : s)) });
  const patchCyc = (p) => patchBatch({ cycle: { ...(active.cycle || {}), ...p } });
  cycFresh.current = { cyc: active && active.cycle, patch: patchCyc };
  const renameCycStage = (id, name) => patchCyc({ stages: cycSt.map((s) => (s.id === id ? { ...s, name } : s)) });
  const moveCycStageTo = (from, to) => { if (from == null || from === to || to < 0 || to >= cycSt.length) return; const a = cycSt.slice(); const [it] = a.splice(from, 1); a.splice(to, 0, it); patchCyc({ stages: a }); };
  const removeCycStage = (id) => { const st = cycSt.find((x) => x.id === id); if (!st) return; if (cycSt.length <= 1) { alert("В цикле должен остаться хотя бы один этап."); return; } if (!window.confirm(`Удалить этап «${st.name}» из цикла этой партии?`)) return; patchCyc({ stages: cycSt.filter((x) => x.id !== id) }); };
  const addCycStage = (L) => { if (!L || cycSt.some((x) => x.id === L.id)) return; patchCyc({ stages: [...cycSt, { id: L.id, name: L.name, days: Math.max(0, parseInt(L.days) || 1), done: false }] }); };
  const resetCycStages = () => { const cy = (cycles || []).find((c) => c.id === (cyc && cyc.cycleId)) || (cycles || [])[0] || null; if (!window.confirm("Вернуть этапы выбранного цикла? Длительности этой партии будут заменены, отметки «пройдено» сохранятся для совпадающих этапов.")) return; patchCyc({ stages: buildCycleStages(cy, cycSt) }); };
  const toggleCycStage = (id) => patchCyc({ stages: cycSt.map((s) => (s.id === id ? { ...s, done: !s.done } : s)) });
  const setCycDays = (id, v) => patchCyc({ stages: cycSt.map((s) => (s.id === id ? { ...s, days: Math.max(0, parseInt(v) || 0) } : s)) });
  // мультиступенчатый переключатель: клик по этапу i → предыдущие «пройдены», этот текущий
  // факт-дата: у пройденного этапа = день прохождения (можно поправить вручную); конец этапа = начало следующего
  const setCycToStage = (i) => patchCyc({ stages: cycSt.map((s, j) => ({ ...s, done: j < i, actualDate: j < i ? (s.actualDate || todayISO()) : null })) });
  const advanceCyc = () => { if (curIdx < 0) return; patchCyc({ stages: cycSt.map((s, j) => (j === curIdx ? { ...s, done: true, actualDate: s.actualDate || todayISO() } : s)) }); };
  const regressCyc = () => { const target = curIdx < 0 ? cycSt.length - 1 : curIdx - 1; if (target < 0) return; patchCyc({ stages: cycSt.map((s, j) => (j === target ? { ...s, done: false, actualDate: null } : s)) }); };
  const setCycActual = (id, v) => patchCyc({ stages: cycSt.map((s) => (s.id === id ? { ...s, actualDate: v || null } : s)) });
  // ——— этапы: у каждого две даты окончания (план / факт) ———
  const isoDiff = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
  const pushToast = (t) => { const id = uid(); setStageToasts((l) => [...l, { ...t, id }]); if (!t.sticky) setTimeout(() => setStageToasts((l) => l.filter((x) => x.id !== id)), 15000); };
  const closeToast = (id) => setStageToasts((l) => l.filter((x) => x.id !== id));
  // плановая дата окончания этапа i → длительность (дни хранятся как раньше); следующие этапы остаются на своих датах
  const setStagePlan = (i, iso) => {
    if (!iso || !cyc.startDate) return;
    const prevEnd = i > 0 ? (cycDates[cycSt[i - 1].id] || {}).endISO : null;
    const nd = i > 0 ? isoDiff(prevEnd, iso) : isoDiff(cyc.startDate, iso) + 1;
    if (!(nd >= 0)) return;
    const delta = nd - (parseInt(cycSt[i].days, 10) || 0);
    patchCyc({ stages: cycSt.map((s, j) => (j === i ? { ...s, days: nd } : j === i + 1 ? { ...s, days: Math.max(0, (parseInt(s.days, 10) || 0) - delta) } : s)) });
  };
  // сдвинуть плановые даты всех следующих этапов на n дней
  const shiftFollowing = (i, n) => { const { cyc: c, patch } = cycFresh.current; if (!c || !patch) return; patch({ stages: (c.stages || []).map((s, j) => (j === i + 1 ? { ...s, days: Math.max(0, (parseInt(s.days, 10) || 0) + n) } : s)) }); };
  // фактическая дата окончания этапа i: пусто — вернуть в работу; дата — этап закрыт
  const setStageFact = (i, iso) => {
    const s0 = cycSt[i]; if (!s0) return;
    if (!iso) return; // закрытый этап в работу не возвращается: дату факта можно только поменять
    const stages = cycSt.map((s, j) => (j === i ? { ...s, done: true, actualDate: iso } : j < i && !s.done ? { ...s, done: true, actualDate: s.actualDate || iso } : s));
    patchCyc({ stages });
    const planEnd = (cycDates[s0.id] || {}).endISO;
    const late = planEnd ? isoDiff(planEnd, iso) : 0;
    if (late > 0 && i < cycSt.length - 1) pushToast({ text: `Опоздание ${late} дн. Сдвинуть плановые даты следующих этапов?`, actions: [{ label: "Сдвинуть", primary: true, fn: () => shiftFollowing(i, late) }, { label: "Нет" }] });
  };
  // снять отметку «факт»: этап (и следующие за ним) возвращаются в работу
  const clearStageFact = (i) => {
    const s0 = cycSt[i]; if (!s0) return;
    const stages = cycSt.map((s, j) => { if (j < i) return s; const n = { ...s, done: false }; delete n.actualDate; return n; });
    patchCyc({ stages });
    setStagePop(null);
  };
  const fmtDM = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0"); };
  const stageDev = (s) => { const d = cycDates[s.id]; if (!s.actualDate || !d || !d.endISO) return null; return Math.round((new Date(s.actualDate) - new Date(d.endISO)) / 86400000); }; // >0 позже плана
  const addItem = (productId) => { patchBatch({ items: [...(active.items || []), { id: uid(), productId, priceCny: "", qty: "" }] }); setPicker(false); setPq(""); };
  const setItem = (iid, k, v) => patchBatch({ items: active.items.map((it) => (it.id === iid ? { ...it, [k]: v } : it)) });
  const removeItem = (iid) => patchBatch({ items: active.items.filter((it) => it.id !== iid) });
  // количество по размерам: обновляем qtyBySize и пересчитываем общий qty = сумма
  const setItemSizeQty = (iid, sid, v) => patchBatch({ items: active.items.map((it) => {
    if (it.id !== iid) return it;
    const qbs = { ...(it.qtyBySize || {}), [sid]: v };
    const sum = Object.values(qbs).reduce((a, x) => a + (isNaN(toNum(x)) ? 0 : toNum(x)), 0);
    return { ...it, qtyBySize: qbs, qty: String(sum) };
  }) });
  // фактическая оплата поставщику частями
  const addPayment = () => patchBatch({ payments: [...(active.payments || []), { id: uid(), amount: "", note: "", date: new Date().toISOString().slice(0, 10) }] });
  const setPayment = (pid, k, v) => patchBatch({ payments: (active.payments || []).map((p) => (p.id === pid ? { ...p, [k]: v } : p)) });
  const removePayment = (pid) => patchBatch({ payments: (active.payments || []).filter((p) => p.id !== pid) });

  const fmtRub = (n) => (isNaN(n) ? "—" : Math.round(n).toLocaleString("ru-RU") + " ₽");
  const fmtCny = (n) => (isNaN(n) ? "—" : (Math.round(n * 100) / 100).toLocaleString("ru-RU") + " ¥");

  if (!active) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-white py-16 text-center">
        <div className="text-sm text-neutral-400">Пока нет ни одной партии закупки.</div>
        <button onClick={addBatch} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800"><Plus size={14} /> Партия</button>
      </div>
    );
  }

  const cny = toNum(active.cny), usd = toNum(active.usd), cargo = toNum(active.cargo);
  const comm = toNum(active.commission), ins = toNum(active.insurance);
  const feeMul = 1 + ((isNaN(comm) ? 0 : comm) + (isNaN(ins) ? 0 : ins)) / 100; // комиссия + страховка к сумме за товар в юанях
  const prodById = Object.fromEntries((products || []).map((p) => [p.id, p]));
  const rows = (active.items || []).map((it) => {
    const p = prodById[it.productId] || {};
    const w = toNum(p?.purchase?.weightG), pc = toNum(it.priceCny), q = toNum(it.qty);
    const hasUnit = !isNaN(pc);
    const rubUnit = (isNaN(cny) ? 0 : cny) * (isNaN(pc) ? 0 : pc) * feeMul + (isNaN(cargo) ? 0 : cargo) * ((isNaN(w) ? 0 : w) / 1000) * (isNaN(usd) ? 0 : usd);
    return { it, p, w, rubUnit: hasUnit ? rubUnit : NaN, sumCny: (!isNaN(pc) && !isNaN(q)) ? pc * q : NaN, sumRub: (hasUnit && !isNaN(q)) ? rubUnit * q : NaN, wkg: (isNaN(w) ? 0 : w) / 1000 * (isNaN(q) ? 0 : q) };
  });
  const tot = rows.reduce((a, r) => ({ qty: a.qty + (isNaN(toNum(r.it.qty)) ? 0 : toNum(r.it.qty)), cnySum: a.cnySum + (isNaN(r.sumCny) ? 0 : r.sumCny), rubSum: a.rubSum + (isNaN(r.sumRub) ? 0 : r.sumRub), wkg: a.wkg + r.wkg }), { qty: 0, cnySum: 0, rubSum: 0, wkg: 0 });
  const payments = active.payments || [];
  const paidRub = payments.reduce((a, p) => a + (isNaN(toNum(p.amount)) ? 0 : toNum(p.amount)), 0); // фактически оплачено, ₽

  const inBatch = new Set((active.items || []).map((it) => it.productId));
  const q = pq.trim().toLowerCase();
  const pcands = (products || []).filter((p) => !inBatch.has(p.id)).filter((p) => !q || (p.code || "").toLowerCase().includes(q) || (p.name || "").toLowerCase().includes(q));
  const stCur = PU_STATUS[active.status] || PU_STATUS.draft;
  const rate = (label, k, suffix) => (
    <label className="flex items-center justify-between gap-2 text-xs text-neutral-500">{label}
      <span className="flex items-center gap-1">
        <input value={active[k] ?? ""} onChange={(e) => patchBatch({ [k]: e.target.value })} inputMode="decimal" className="w-20 rounded-md border border-neutral-200 px-2 py-1 text-right text-sm text-neutral-800 focus:outline-none focus:ring-2 focus:ring-orange-200" />
        <span className="w-6 text-neutral-400">{suffix}</span>
      </span>
    </label>
  );

  // активные партии (цикл запущен и не завершён) — в начале; остальные после разделителя
  const isActiveBatch = (b) => !!(b.cycle && b.cycle.started && Array.isArray(b.cycle.stages) && b.cycle.stages.some((x) => !x.done));
  const batchLate = (b) => { const cur = b.cycle.stages.find((x) => !x.done); const dd = cur ? cycleStageDates(b.cycle.startDate, b.cycle.stages)[cur.id] : null; return !!(dd && dd.endISO < todayISO()); };
  const nActiveB = list.filter(isActiveBatch).length;
  const tabList = [...list.filter(isActiveBatch), ...list.filter((b) => !isActiveBatch(b))];
  const shortName = (n) => { const t = String(n || ""); return t.length > 15 ? t.slice(0, 15).trimEnd() + "…" : t; };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {tabList.map((b, bi) => {
          const on = b.id === active.id;
          const act = isActiveBatch(b);
          const sepBefore = bi === nActiveB && nActiveB > 0;
          if (editingId === b.id) return <input key={b.id} autoFocus defaultValue={b.name} onBlur={(e) => { renameBatch(b.id, e.target.value); setEditingId(null); }} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); else if (e.key === "Escape") setEditingId(null); }} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-800 focus:outline-none" style={{ width: 160 }} />;
          return (
            <Fragment key={b.id}>
            {sepBefore && <span className="mx-1 h-6 w-px self-center bg-neutral-200" />}
            <button onClick={() => setActiveId(b.id)} onDoubleClick={() => setEditingId(b.id)} title={`${b.name || "Без названия"} — клик: открыть · двойной клик: переименовать` + (act ? (batchLate(b) ? " · этап просрочен" : " · активная партия") : "")} className={"inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition " + (on ? "bg-neutral-900 text-white" : act ? "bg-neutral-100 text-neutral-700 hover:bg-neutral-200" : "bg-neutral-100 text-neutral-500 opacity-80 hover:bg-neutral-200 hover:opacity-100")}>
              {act && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: batchLate(b) ? "#ef4444" : "#f59e0b" }} />}
              <span>{shortName(b.name) || "Без названия"}</span>
              {on && (<><Pencil size={12} className="opacity-70 hover:opacity-100" onClick={(e) => { e.stopPropagation(); setEditingId(b.id); }} /><Trash2 size={12} className="opacity-70 hover:opacity-100 hover:text-red-300" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Удалить партию «${b.name}»?`)) removeBatch(b.id); }} /></>)}
            </button>
            </Fragment>
          );
        })}
        <button onClick={addBatch} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"><Plus size={14} /> Партия</button>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 px-4 py-3">
          {(() => { const curEnd = curStage && cycDates[curStage.id] ? cycDates[curStage.id].endISO : null; const late = !!(curEnd && curEnd < todayISO()); return (
          <button onClick={() => setCycOpen((o) => !o)} title={!cycStarted ? "Запустить производственный цикл" : curStage ? "Текущий этап цикла" + (curEnd ? " · до " + curEnd.slice(8, 10) + "." + curEnd.slice(5, 7) + (late ? " (просрочено)" : "") : "") : "Все этапы цикла пройдены"} className="inline-flex min-w-[230px] flex-col gap-[5px] rounded-xl border border-neutral-200 bg-white px-3.5 pb-2 pt-[7px] text-left transition hover:bg-neutral-50">
            <span className="flex items-center gap-2 text-[12.5px] font-extrabold" style={{ color: !cycStarted ? "#737373" : "#262626" }}>
              {!cycStarted ? "Запустить цикл" : curStage ? curStage.name : "Готово"}
              <span className="ml-auto text-[10.5px] font-bold" style={{ color: late ? "#dc2626" : "#a3a3a3" }}>
                {!cycStarted ? "" : curStage ? (late ? "просрочен на " + Math.max(1, Math.round((new Date(todayISO()) - new Date(curEnd)) / 86400000)) + " д" : "") : "все этапы пройдены"}
              </span>
              <ChevronDown size={11} className={"opacity-50 transition " + (cycOpen ? "rotate-180" : "")} />
            </span>
            <span className="flex gap-[3px]">
              {(cycStarted && cycSt.length ? cycSt : [null, null, null, null, null]).map((x, xi) => <i key={xi} className="block h-1 flex-1 rounded-full" style={{ background: !cycStarted ? "#e5e5e5" : !curStage ? "#16a34a" : xi < curIdx ? "#16a34a" : xi === curIdx ? (late ? "#ef4444" : "#f59e0b") : "#e5e5e5" }} />)}
            </span>
          </button>
          ); })()}
          <div className="relative">
            <button onClick={() => setRatesOpen((o) => !o)} title="Ставки партии" className={"inline-flex h-[42px] items-center gap-1.5 rounded-xl border px-3.5 text-[12.5px] font-bold transition " + (ratesOpen ? "border-neutral-800 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50")}>
              Ставки
              <ChevronDown size={12} className={"transition " + (ratesOpen ? "rotate-180" : "")} />
            </button>
            {ratesOpen && (<><div className="fixed inset-0 z-10" onClick={() => setRatesOpen(false)} />
              <div className="absolute left-0 z-20 mt-1.5 w-60 rounded-xl border border-neutral-200 bg-white p-2.5 shadow-xl">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Ставки партии</div>
                <div className="space-y-1.5">{rate("Курс ¥", "cny", "₽")}{rate("Курс $", "usd", "₽")}{rate("Карго", "cargo", "$/кг")}{rate("Комиссия", "commission", "%")}{rate("Страховка", "insurance", "%")}</div>
              </div></>)}
          </div>
          {(() => {
            const batchJobs = (jobs || []).filter((j) => j.batchId === active.id);
            const personById = Object.fromEntries((people || []).map((p) => [p.id, p]));
            const fmtD = (d) => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : "";
            return (
              <div className="relative">
                <button onClick={() => setTasksOpen((o) => !o)} title="Задачи по партии" className={"inline-flex h-[42px] items-center gap-1.5 rounded-xl border px-3.5 text-[12.5px] font-bold transition " + (tasksOpen ? "border-cyan-400 bg-cyan-50 text-cyan-700" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50")}>
                  Задачи
                  <span className={"inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold " + (batchJobs.length ? "bg-cyan-600 text-white" : "bg-neutral-100 text-neutral-500")}>{batchJobs.length}</span>
                  <ChevronDown size={12} className={"transition " + (tasksOpen ? "rotate-180" : "")} />
                </button>
                {tasksOpen && (<><div className="fixed inset-0 z-10" onClick={() => setTasksOpen(false)} />
                  <div className="absolute left-0 z-20 mt-1.5 w-[420px] max-w-[88vw] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl">
                    <div className="flex items-center gap-2.5 border-b border-neutral-100 px-4 py-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600"><ListChecks size={15} /></span>
                      <div className="min-w-0"><div className="text-[13px] font-bold text-neutral-900">Задачи по партии</div><div className="truncate text-[11px] text-neutral-400">{active.name || "Партия"} · {batchJobs.length} {batchJobs.length === 1 ? "задача" : batchJobs.length >= 2 && batchJobs.length <= 4 ? "задачи" : "задач"}</div></div>
                      <button onClick={() => setTasksOpen(false)} className="ml-auto rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><X size={16} /></button>
                    </div>
                    <div className="max-h-[340px] overflow-auto p-2.5">
                      <div className="space-y-1.5">
                        {batchJobs.map((j) => { const pr = personById[j.assignee]; const st = STAGES[stageOf(j)]; const done = stageOf(j) === "done"; return (
                          <button key={j.id} onClick={() => { setTasksOpen(false); onOpenJob && onOpenJob(j); }} className="flex w-full items-center gap-2.5 rounded-xl border border-neutral-200 px-3 py-2 text-left transition hover:border-cyan-300 hover:bg-cyan-50/40">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: st ? st.color : "#d4d4d8" }} />
                            <span className={"min-w-0 flex-1 truncate text-[13.5px] " + (done ? "text-neutral-400 line-through" : "text-neutral-700")}>{j.title || "Без названия"}</span>
                            {j.date && <span className="shrink-0 text-[11px] text-neutral-400">{fmtD(j.date)}</span>}
                            {pr && <PersonAvatar p={pr} size={20} />}
                          </button>
                        ); })}
                        {batchJobs.length === 0 && <p className="px-1 py-6 text-center text-[12px] text-neutral-400">Задач по этой партии ещё нет</p>}
                      </div>
                      <button onClick={() => { setTasksOpen(false); onAddJob && onAddJob({ type: "project", batchId: active.id, note: `Партия: «${active.name || ""}»` }); }} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:border-cyan-400 hover:text-cyan-700"><Plus size={14} /> Задача по партии</button>
                    </div>
                  </div></>)}
              </div>
            );
          })()}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {[["Позиций", rows.length], ["Кол-во", tot.qty.toLocaleString("ru-RU")], ["Вес", (Math.round(tot.wkg * 10) / 10).toLocaleString("ru-RU") + " кг"], ["Сумма ¥", fmtCny(tot.cnySum)], ["Сумма ₽", fmtRub(tot.rubSum)]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-neutral-50 px-3 py-1.5"><div className="text-[10px] uppercase tracking-wide text-neutral-400">{k}</div><div className="text-sm font-bold text-neutral-800">{v}</div></div>
            ))}
            <button onClick={() => setPayOpen((o) => !o)} title="Фактическая оплата — показать транзакции" className={"rounded-lg border px-3 py-1.5 text-left transition " + (payOpen ? "border-emerald-300 bg-emerald-50" : "border-emerald-200/70 bg-white hover:bg-emerald-50")}>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-neutral-400">Оплачено <ChevronDown size={11} className={"text-neutral-400 transition " + (payOpen ? "rotate-180" : "")} /></div>
              <div className="text-sm font-bold text-emerald-600">{fmtRub(paidRub)}</div>
            </button>
          </div>
        </div>

        {payOpen && (
          <div className="border-b border-neutral-100 bg-neutral-50/40 px-4 py-3">
            <div className="space-y-1.5">
              {payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2">
                  <input type="date" value={p.date || ""} onChange={(e) => setPayment(p.id, "date", e.target.value)} className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 focus:outline-none focus:ring-2 focus:ring-orange-200" />
                  <div className="relative"><input value={p.amount} onChange={(e) => setPayment(p.id, "amount", e.target.value)} inputMode="decimal" placeholder="0" className="w-32 rounded-md border border-neutral-200 bg-white px-2 py-1 pr-6 text-right text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" /><span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400">₽</span></div>
                  <input value={p.note} onChange={(e) => setPayment(p.id, "note", e.target.value)} placeholder="пояснение к транзакции (за что / как передали)…" className="min-w-[200px] flex-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
                  <button onClick={() => removePayment(p.id)} className="shrink-0 rounded p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить транзакцию"><X size={14} /></button>
                </div>
              ))}
              {payments.length === 0 && <p className="text-xs text-neutral-400">Пока нет транзакций. Добавьте первый платёж поставщику.</p>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button onClick={addPayment} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"><Plus size={14} /> Транзакция</button>
              <span className="text-xs text-neutral-500">Всего оплачено: <b className="text-neutral-800">{fmtRub(paidRub)}</b></span>
              {payments.length > 0 && <span className="text-xs text-neutral-400">Транзакций: {payments.length}</span>}
            </div>
          </div>
        )}

        {cycOpen && (
          <div className="border-b border-neutral-100 bg-neutral-50/40 px-4 py-3">
            {!cycStarted ? (
              <div className="flex flex-wrap items-center gap-3">
                {(cycles || []).length > 1 && <select value={pickedCycle ? pickedCycle.id : ""} onChange={(e) => setCycPick(e.target.value)} className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-neutral-800 focus:outline-none focus:ring-2 focus:ring-orange-200">{cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
                <button onClick={startCycle} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800"><Plus size={14} /> Запустить цикл</button>
                <span className="text-xs text-neutral-500">{(cycles || []).length > 1 ? "Выберите цикл и запустите." : "Возьмётся набор этапов цикла."} Дальше этапы и их длительность настраиваются под эту партию кнопкой ⚙.</span>
              </div>
            ) : (
              <>
                {/* этапы одной полосой: у каждого этапа две даты окончания — план и факт; клик по этапу открывает окошко с датами */}
                <div className="relative flex items-start gap-2 pt-1">
                  <div className="flex min-w-0 flex-1 gap-[3px]">
                    {cycSt.map((s, i) => { const done = s.done; const cur = i === curIdx; const d = cycDates[s.id]; const dev = done && s.actualDate ? stageDev(s) : null; const wgt = Math.max(3, parseInt(s.days, 10) || 1); const isOpen = stagePop === s.id; return (
                      <div key={s.id} className="relative min-w-[64px]" style={{ flex: wgt + " 1 0%" }}>
                        <button onClick={() => setStagePop(isOpen ? null : s.id)} title={s.name + " — даты этапа"} className="block w-full text-left">
                          <div className="flex h-7 items-center overflow-hidden whitespace-nowrap rounded-md px-2.5 text-[12px] font-bold transition hover:brightness-95" style={done ? { background: "#dcfce7", color: "#166534" } : cur ? { background: "#ffedd5", color: "#9a3412" } : { background: "#f4f4f5", color: "#a3a3a3" }}>
                            <span className="truncate">{s.name}</span>
                          </div>
                          <div className={"mt-1 truncate text-[11px] font-semibold " + (done ? "text-green-700" : cur ? "text-orange-700" : "text-neutral-400")}>
                            {done ? <>{s.actualDate ? fmtDM(s.actualDate) : "готово"}{dev != null && dev !== 0 && <span className={"ml-1 font-extrabold " + (dev > 0 ? "text-red-600" : "text-emerald-700")}>{dev > 0 ? "+" + dev : dev} дн</span>}</> : <>до {d ? d.endStr : "—"}</>}
                          </div>
                        </button>
                        {isOpen && (<>
                          <div className="fixed inset-0 z-20" onClick={() => setStagePop(null)} />
                          <div className={"absolute top-full z-30 mt-2 w-[236px] rounded-xl border border-neutral-200 bg-white p-3 shadow-xl " + (i >= cycSt.length / 2 ? "right-0" : "left-0")}>
                            <div className="mb-2 text-[13px] font-bold text-neutral-800">{s.name}</div>
                            <label className="mb-1.5 flex items-center justify-between gap-2 text-xs text-neutral-500">План<input type="date" value={d ? d.endISO : ""} onChange={(e) => setStagePlan(i, e.target.value)} className="w-[130px] rounded-md border border-neutral-200 px-1.5 py-1 text-[13px] text-neutral-700 focus:outline-none focus:ring-2 focus:ring-orange-200" /></label>
                            <label className="flex items-center justify-between gap-2 text-xs text-neutral-500">Факт<input type="date" value={s.actualDate || ""} onChange={(e) => setStageFact(i, e.target.value)} className="w-[130px] rounded-md border border-neutral-200 px-1.5 py-1 text-[13px] text-neutral-700 focus:outline-none focus:ring-2 focus:ring-orange-200" /></label>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                              {(s.done || s.actualDate) && <button onClick={() => clearStageFact(i)} className="text-[11px] font-semibold text-red-500 hover:underline" title="Этап вернётся в работу">Убрать факт</button>}
                              {(cycleTriggers || []).some((r) => r.stageId === s.id && r.enabled && String(r.text || "").trim()) && <button onClick={() => { onCreateStageTask && onCreateStageTask(active.id, s.id); setStagePop(null); }} className="text-[11px] font-semibold text-sky-600 hover:underline">Создать задачи этапа</button>}
                            </div>
                          </div>
                        </>)}
                      </div>
                    ); })}
                  </div>
                  <div className="relative shrink-0">
                    <button onClick={() => setDurOpen((o) => !o)} title="Старт цикла" className={"flex h-7 w-7 items-center justify-center rounded-lg border transition " + (durOpen ? "border-neutral-400 bg-neutral-100 text-neutral-700" : "border-neutral-200 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600")}><Settings2 size={14} /></button>
                    {durOpen && (<>
                      <div className="fixed inset-0 z-20" onClick={() => setDurOpen(false)} />
                      <div className="absolute right-0 top-full z-30 mt-2 w-[380px] max-w-[92vw] rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl">
                        <div className="relative mb-3 flex items-center gap-2 text-[14px] font-extrabold text-neutral-800">Цикл партии
                          {(cycles || []).length > 0 && <select value={(cyc && cyc.cycleId) || ""} onChange={(e) => switchCycle(e.target.value)} className="min-w-0 max-w-[170px] rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[12.5px] font-semibold text-neutral-800 focus:outline-none">{!(cyc && cyc.cycleId) && <option value="">свой набор</option>}{cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
                          <button onClick={() => setCycMore((v) => !v)} title="Ещё" className="ml-auto flex h-[26px] w-[26px] items-center justify-center rounded-lg text-[16px] leading-none text-neutral-400 hover:bg-neutral-100">⋯</button>
                          {cycMore && (<><div className="fixed inset-0 z-10" onClick={() => setCycMore(false)} /><div className="absolute right-0 top-8 z-20 w-52 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl"><button onClick={() => { setCycMore(false); resetCycStages(); }} className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50">Сбросить к стандарту</button></div></>)}
                        </div>
                        <label className="mb-3 flex items-center justify-between gap-2 text-[12.5px] text-neutral-500">Старт цикла<input type="date" value={cyc.startDate || ""} onChange={(e) => patchCyc({ startDate: e.target.value })} className="w-[140px] rounded-lg border border-neutral-200 px-2 py-1 text-[13px] text-neutral-700 focus:outline-none focus:ring-2 focus:ring-orange-200" /></label>
                        <div className="relative max-h-[320px] overflow-y-auto pl-[26px]">
                          <div className="absolute bottom-3 left-[8px] top-3 w-0.5 bg-neutral-200" />
                          {cycSt.map((s, i) => { const dd = cycDates[s.id]; return (
                            <div key={s.id} onDragOver={(e) => { if (dragSt != null) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); moveCycStageTo(dragSt, i); setDragSt(null); }} className={"relative flex items-center gap-2 py-1.5 " + (dragSt === i ? "opacity-40" : "")}>
                              <span draggable onDragStart={() => setDragSt(i)} onDragEnd={() => setDragSt(null)} title="Перетащить, чтобы поменять порядок" className="absolute -left-[23px] top-1/2 h-3 w-3 -translate-y-1/2 cursor-grab rounded-full border-[2.5px]" style={s.done ? { background: "#16a34a", borderColor: "#16a34a" } : { background: "#fff", borderColor: "#f59e0b" }} />
                              <div className="min-w-0 flex-1">
                                <StagePicker label={s.name} current={s.name} options={(cycleStages || []).filter((l) => !cycSt.some((x) => x.id === l.id))} onPick={(L) => swapCycStage(s.id, L)} />
                                <div className="px-1 text-[11.5px] font-medium text-neutral-400">{dd ? `${dd.startStr} → ${dd.endStr}` : "—"}</div>
                              </div>
                              <div className="inline-flex shrink-0 items-center overflow-hidden rounded-[9px] border border-neutral-200">
                                <button onClick={() => setCycDays(s.id, Math.max(0, (parseInt(s.days, 10) || 0) - 1))} className="w-6 text-center font-bold text-neutral-500 hover:bg-neutral-100">−</button>
                                <input value={s.days} onChange={(e) => setCycDays(s.id, e.target.value)} inputMode="numeric" className="w-[36px] border-x border-neutral-200 py-[3px] text-center text-[13px] focus:outline-none" />
                                <button onClick={() => setCycDays(s.id, (parseInt(s.days, 10) || 0) + 1)} className="w-6 text-center font-bold text-neutral-500 hover:bg-neutral-100">+</button>
                              </div>
                              <button onClick={() => removeCycStage(s.id)} title="Удалить этап" className="w-4 shrink-0 text-center text-neutral-300 hover:text-red-500"><X size={13} /></button>
                            </div>
                          ); })}
                        </div>
                        <div className="mt-2"><StagePicker dashed label="＋ Добавить этап…" options={(cycleStages || []).filter((l) => !cycSt.some((x) => x.id === l.id))} onPick={addCycStage} /></div>
                        {(() => { const tot = cycSt.reduce((a, x) => a + (parseInt(x.days, 10) || 0), 0); const last = cycSt.length ? cycDates[cycSt[cycSt.length - 1].id] : null; return (
                          <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[12.5px] font-semibold text-emerald-800">🏁 <span>Завершение цикла · {tot} дн</span>{last && <b className="ml-auto text-[14px] text-emerald-900">{last.endISO.slice(8, 10)}.{last.endISO.slice(5, 7)}.{last.endISO.slice(0, 4)}</b>}</div>
                        ); })()}
                      </div>
                    </>)}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {stageToasts.length > 0 && (
          <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
            {stageToasts.map((t) => (
              <div key={t.id} className="flex max-w-[92vw] items-center gap-3 rounded-xl bg-neutral-900 px-4 py-2.5 text-[13px] text-white shadow-2xl">
                <span>{t.text}</span>
                {t.actions.map((a, k) => (<button key={k} onClick={() => { try { a.fn && a.fn(); } finally { closeToast(t.id); } }} className={"font-bold " + (a.primary ? "text-emerald-300 hover:text-emerald-200" : "text-neutral-400 hover:text-neutral-200")}>{a.label}</button>))}
              </div>
            ))}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr className="text-[10px] uppercase tracking-wide text-neutral-400">
              <th className="px-3 py-2 text-left font-semibold">Товар</th>
              <th className="px-3 py-2 text-left font-semibold">Предмет</th>
              <th className="px-3 py-2 text-left font-semibold">Примечание</th>
              <th className="px-3 py-2 text-right font-semibold">Цена ¥/ед</th>
              <th className="px-3 py-2 text-right font-semibold">Вес, г</th>
              <th className="px-3 py-2 text-right font-semibold">Цена ₽/ед</th>
              <th className="px-3 py-2 text-right font-semibold">Кол-во</th>
              <th className="px-3 py-2 text-right font-semibold">Сумма ¥</th>
              <th className="px-3 py-2 text-right font-semibold">Сумма ₽</th>
              <th className="px-3 py-2 text-left font-semibold">Ссылка</th>
              <th className="px-3 py-2 text-center font-semibold" title="Отметьте, когда товар заказан у поставщика">Заказан <span className="font-bold text-neutral-400">{rows.filter((r) => r.it.ordered).length}/{rows.length}</span></th>
              <th className="px-3 py-2 text-center font-semibold" title="Отметьте, когда на товар есть сертификат">Сертификат <span className="font-bold text-neutral-400">{rows.filter((r) => r.it.cert).length}/{rows.length}</span></th>
              <th className="px-3 py-2" />
            </tr></thead>
            <tbody>
              {rows.map(({ it, p, w, rubUnit, sumCny, sumRub }) => {
                const pSizes = Array.isArray(p.plan?.sizes) ? p.plan.sizes : [];
                const pOne = !!p.plan?.oneSize;
                const open = !!qtyOpen[it.id];
                const qTotal = toNum(it.qty);
                return (
                <Fragment key={it.id}>
                <tr className="border-t border-neutral-100 text-sm text-neutral-700">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-11 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-100 text-neutral-300">{p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={14} />}</div>
                      <div className="min-w-0"><div className="text-[11px] text-neutral-400">{p.code || "—"}</div><button onClick={() => onOpenCard && onOpenCard(it.productId)} title="Открыть карточку товара" className="block max-w-full truncate text-left font-medium text-neutral-800 hover:text-orange-700 hover:underline" style={{ maxWidth: 276 }}>{p.name || "Без названия"}</button></div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-neutral-600">{p.subject ? <span className="block max-w-[160px] truncate" title={p.subject}>{p.subject}</span> : <span className="text-neutral-300">—</span>}</td>
                  <td className="px-3 py-2"><input value={it.note || ""} onChange={(e) => setItem(it.id, "note", e.target.value)} placeholder="примечание…" className="w-full min-w-[120px] rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-neutral-700 placeholder:text-neutral-300 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-orange-200" /></td>
                  <td className="px-3 py-2 text-right"><input value={it.priceCny} onChange={(e) => setItem(it.id, "priceCny", e.target.value)} inputMode="decimal" placeholder="0" className="w-16 rounded-md border border-neutral-200 px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-orange-200" /></td>
                  <td className="px-3 py-2 text-right text-neutral-500">{isNaN(w) ? "—" : w}</td>
                  <td className="px-3 py-2 text-right text-neutral-500">{fmtRub(rubUnit)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={(e) => toggleQty(it.id, e.currentTarget)} title="Количество по размерам" className={"inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold transition " + (open ? "border-orange-300 bg-orange-50 text-orange-700" : "border-neutral-200 text-neutral-800 hover:border-neutral-300")}>
                      {qTotal ? qTotal.toLocaleString("ru-RU") : "0"}
                      {open ? <ChevronUp size={12} className="text-neutral-400" /> : <ChevronDown size={12} className="text-neutral-400" />}
                    </button>
                    {open && qtyPop && (<>
                      <div className="fixed inset-0 z-40" onClick={() => setQtyPop(null)} />
                      <div className="fixed z-50 w-[300px] rounded-2xl border border-neutral-200 bg-white p-3.5 text-left shadow-2xl" style={{ right: qtyPop.right, ...(qtyPop.up ? { bottom: qtyPop.bottom } : { top: qtyPop.top }) }}>
                        <div className="mb-2.5 flex items-center gap-2">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">{pOne || pSizes.length > 0 ? "Количество по размерам" : "Количество"}</span>
                          <button onClick={() => setQtyPop(null)} className="ml-auto text-neutral-300 hover:text-neutral-600"><X size={14} /></button>
                        </div>
                        {pOne ? (
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-teal-100 bg-teal-50 px-2.5 py-1 text-sm font-semibold text-teal-700"><Target size={13} /> {p.plan?.oneLabel || "One size"}</span>
                            <input autoFocus value={it.qty} onChange={(e) => setItem(it.id, "qty", e.target.value)} inputMode="numeric" placeholder="0" className="w-20 rounded-md border border-neutral-200 px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-orange-200" />
                          </div>
                        ) : pSizes.length > 0 ? (
                          <div className="flex flex-wrap gap-2.5">
                            {pSizes.map((s, si) => (
                              <div key={s.id} className="flex flex-col items-center gap-1">
                                <span className="text-xs font-bold text-teal-700">{s.name || "—"}</span>
                                <input autoFocus={si === 0} value={(it.qtyBySize || {})[s.id] ?? ""} onChange={(e) => setItemSizeQty(it.id, s.id, e.target.value)} inputMode="numeric" placeholder="0" className="w-14 rounded-lg border border-neutral-200 px-1 py-1.5 text-center text-[15px] font-bold focus:outline-none focus:ring-2 focus:ring-orange-200" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-neutral-500">
                            <div>У товара не задан размерный ряд. <button onClick={() => { setQtyPop(null); onOpenCard && onOpenCard(it.productId); }} className="text-blue-600 hover:underline">Задать в карточке →</button></div>
                            <div className="mt-2.5 flex items-center gap-2"><span>Общее кол-во:</span><input autoFocus value={it.qty} onChange={(e) => setItem(it.id, "qty", e.target.value)} inputMode="numeric" placeholder="0" className="w-24 rounded-md border border-neutral-200 px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-orange-200" /></div>
                          </div>
                        )}
                        <div className="mt-3 flex items-center border-t border-neutral-100 pt-2.5 text-xs text-neutral-500">Итого: <b className="ml-1 text-[13px] text-neutral-900">{qTotal || 0} шт</b>
                          <button onClick={() => setQtyPop(null)} className="ml-auto rounded-lg bg-neutral-900 px-3 py-1 text-xs font-semibold text-white hover:bg-neutral-700">Готово</button>
                        </div>
                      </div>
                    </>)}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtCny(sumCny)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-neutral-900">{fmtRub(sumRub)}</td>
                  <td className="px-3 py-2 text-left">{p?.purchase?.link ? <a href={p.purchase.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">ссылка <ExternalLink size={11} /></a> : <span className="text-xs text-neutral-300">—</span>}</td>
                  <td className="px-3 py-2 text-center"><input type="checkbox" checked={!!it.ordered} onChange={(e) => setItem(it.id, "ordered", e.target.checked)} title={it.ordered ? "Заказан" : "Ещё не заказан"} className="h-4 w-4 cursor-pointer accent-green-600" /></td>
                  <td className="px-3 py-2 text-center"><input type="checkbox" checked={!!it.cert} onChange={(e) => setItem(it.id, "cert", e.target.checked)} title={it.cert ? "Сертификат есть" : "Сертификата ещё нет"} className="h-4 w-4 cursor-pointer accent-green-600" /></td>
                  <td className="px-3 py-2 text-right"><button onClick={() => removeItem(it.id)} className="text-neutral-300 hover:text-red-500" title="Убрать из партии"><X size={14} /></button></td>
                </tr>
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="relative border-t border-neutral-100 px-3 py-3">
          <button ref={addBtnRef} onClick={() => setPicker((o) => { const next = !o; if (next && addBtnRef.current) { const r = addBtnRef.current.getBoundingClientRect(); const below = window.innerHeight - r.bottom; setPickerUp(below < 360 && r.top > below); } return next; })} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"><Plus size={14} /> Товар в партию</button>
          {picker && <><div className="fixed inset-0 z-30" onClick={() => { setPicker(false); setPq(""); }} />
            <div className={"absolute left-3 z-40 w-80 rounded-xl border border-neutral-200 bg-white p-2 shadow-xl " + (pickerUp ? "bottom-full mb-1" : "top-full mt-1")}>
              <input autoFocus value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Поиск по коду или названию…" className="mb-2 w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
              <div className="overflow-auto" style={{ maxHeight: "min(18rem, 60vh)" }}>
                {pcands.length === 0 && <div className="px-2 py-3 text-center text-xs text-neutral-400">Нет подходящих товаров</div>}
                {pcands.slice(0, 50).map((p) => (
                  <button key={p.id} onClick={() => addItem(p.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-50">
                    <div className="flex h-9 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-100 text-neutral-300">{p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={12} />}</div>
                    <div className="min-w-0"><div className="text-[11px] text-neutral-400">{p.code || "—"}</div><div className="truncate text-sm text-neutral-700">{p.name || "Без названия"}</div></div>
                  </button>
                ))}
              </div>
            </div></>}
        </div>

        {/* Задачи по партии (тип «Закупки») */}
      </div>
    </div>
  );
}

function PurchasesTable({ purchases, onAdd, onSetField, onRemove, onTransfer }) {
  const fileRef = useRef(null);
  const target = useRef(null);
  const pickImage = (id) => { target.current = id; fileRef.current?.click(); };
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    const id = target.current;
    e.target.value = "";
    if (!f || !id) return;
    try { onSetField(id, "image", await fileToThumb(f)); } catch {}
  };

  return (
    <div className="rounded-xl overflow-auto border border-neutral-200 bg-white shadow-sm">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      <table className="text-sm" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
        <thead>
          <tr>
            <th className="bg-neutral-50 px-3 py-2" style={{ width: 44, borderBottom: "1px solid #e5e5e5" }} />
            <th className="bg-neutral-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500" style={{ width: 230, borderBottom: "1px solid #e5e5e5" }}>В ассортимент</th>
            <th className="bg-neutral-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500" style={{ width: 72, borderBottom: "1px solid #e5e5e5" }}>Фото</th>
            <th className="bg-neutral-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500" style={{ width: 200, borderBottom: "1px solid #e5e5e5" }}>Предмет</th>
            <th className="bg-neutral-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500" style={{ borderBottom: "1px solid #e5e5e5" }}>Наименование</th>
          </tr>
        </thead>
        <tbody>
          {purchases.map((p) => (
            <tr key={p.id} className="group">
              <td className="text-center" style={{ borderBottom: "1px solid #f5f5f5" }}>
                <button onClick={() => onRemove(p.id)} title="Удалить из закупок" className="p-1.5 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100">
                  <Trash2 size={15} />
                </button>
              </td>
              <td style={{ borderBottom: "1px solid #f5f5f5" }}>
                <button onClick={() => onTransfer(p.id)} title="Перенос в базовый ассортимент" className="rounded-md m-1 inline-flex items-center gap-1.5 border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
                  <ArrowRight size={15} /> В базовый ассортимент
                </button>
              </td>
              <td style={{ borderBottom: "1px solid #f5f5f5" }}>
                <button onClick={() => pickImage(p.id)} className="rounded-lg mx-auto flex h-11 w-11 items-center justify-center overflow-hidden border border-neutral-200 bg-neutral-50 text-neutral-400 hover:border-neutral-200 hover:text-neutral-600" title="Загрузить фото">
                  {p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={16} />}
                </button>
              </td>
              <td style={{ borderBottom: "1px solid #f5f5f5" }}>
                <input value={p.subject} onChange={(e) => onSetField(p.id, "subject", e.target.value)} placeholder="Категория / предмет" className="w-full bg-transparent px-2 py-1.5 text-neutral-800 placeholder:text-neutral-300 focus:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-400" />
              </td>
              <td style={{ borderBottom: "1px solid #f5f5f5" }}>
                <input value={p.name} onChange={(e) => onSetField(p.id, "name", e.target.value)} placeholder="Название товара" className="w-full bg-transparent px-2 py-1.5 text-neutral-800 placeholder:text-neutral-300 focus:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-400" />
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={5} className="p-0">
              <button onClick={onAdd} className="rounded-md flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-100">
                <span className="flex h-5 w-5 items-center justify-center bg-neutral-900 text-white"><Plus size={14} strokeWidth={3} /></span>
                Добавить позицию
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      {purchases.length === 0 && (
        <div className="px-4 py-10 text-center text-sm text-neutral-400">Список закупок пуст. Нажмите «Добавить позицию».</div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Блок-матрица (метрики × записи) для одного товара — Внешка / Раздачи / Выкупы
---------------------------------------------------------------------------- */

function MatrixBlock({ group, metrics, entries, onAddEntry, onRemoveEntry, onSetVal, onAddMetric, onRemoveMetric, onRenameMetric }) {
  const accent = group.accent;
  const LABEL_W = 188;
  const COL_W = 150;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            <th
              className="px-3 py-2 text-left align-middle"
              style={{ width: LABEL_W, minWidth: LABEL_W, background: accent, color: "#fff", borderTopLeftRadius: 8, borderBottomLeftRadius: entries.length ? 0 : 8 }}
            >
              <div className="text-sm font-bold italic leading-tight">{group.label}</div>
              <div className="font-medium opacity-80" style={{ fontSize: 11 }}>Метрики</div>
            </th>
            {entries.map((entry, idx) => (
              <th key={entry.id} className="group/col px-2 py-2 text-center" style={{ width: COL_W, minWidth: COL_W, background: accent + "14", borderLeft: "1px solid #fff" }}>
                <div className="flex items-center justify-center gap-1">
                  <span className="text-sm font-bold italic" style={{ color: accent }}>{idx + 1}</span>
                  <button onClick={() => onRemoveEntry(entry.id)} title="Удалить столбец" className="p-0.5 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover/col:opacity-100">
                    <X size={12} />
                  </button>
                </div>
              </th>
            ))}
            <th className="px-2 py-2 align-middle" style={{ width: 48, minWidth: 48 }}>
              <button onClick={onAddEntry} title="Добавить столбец" className="flex h-7 w-7 items-center justify-center text-white hover:opacity-90" style={{ background: accent }}>
                <Plus size={15} strokeWidth={3} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.id} className="group/row">
              <th className="px-2 py-1 text-left" style={{ width: LABEL_W, minWidth: LABEL_W, background: "#f5f5f5", borderTop: "1px solid #e5e5e5" }}>
                <div className="flex items-center gap-1">
                  <input
                    value={m.label}
                    onChange={(e) => onRenameMetric(m.id, e.target.value)}
                    className="w-full bg-transparent px-1 py-0.5 text-sm font-medium text-neutral-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-200"
                  />
                  <button onClick={() => onRemoveMetric(m.id)} title="Удалить метрику" className="p-0.5 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover/row:opacity-100">
                    <Trash2 size={13} />
                  </button>
                </div>
              </th>
              {entries.map((entry) => (
                <td key={entry.id} style={{ width: COL_W, minWidth: COL_W, background: "#fff", borderTop: "1px solid #e5e5e5", borderLeft: "1px solid #e5e5e5" }}>
                  <input
                    value={entry.values[m.id] ?? ""}
                    onChange={(e) => onSetVal(entry.id, m.id, e.target.value)}
                    className="w-full bg-transparent px-2 py-1.5 text-sm text-neutral-800 focus:bg-orange-50 focus:outline-none"
                  />
                </td>
              ))}
              <td style={{ borderTop: "1px solid #e5e5e5" }} />
            </tr>
          ))}
          <tr>
            <td colSpan={entries.length + 2} className="px-2 py-1.5" style={{ borderTop: "1px solid #e5e5e5" }}>
              <button onClick={onAddMetric} className="rounded-md inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700">
                <Plus size={13} /> Метрика
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      {entries.length === 0 && (
        <p className="mt-2 px-1 text-xs text-neutral-400">Добавьте столбец плюсиком справа.</p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Блок «План отгрузок» — размеры (строки) × склады (шт + %)
---------------------------------------------------------------------------- */

function PlanBlock({ group, warehouses, sizes, onAddSize, onRemoveSize, onSetSize, onSetQty, onAddWarehouse, onRemoveWarehouse, onSetWarehouse }) {
  const accent = group.accent;
  const SIZE_W = 70;
  const NUM_W = 90;
  const WH_W = 120;
  const PCT_W = 46;
  const stickyLeft = { position: "sticky", left: 0, zIndex: 2 };
  const tnum = { fontVariantNumeric: "tabular-nums" };

  const visible = warehouses.filter((w) => !w.hidden);
  const hidden = warehouses.filter((w) => w.hidden);
  const colCount = visible.length + 5;

  return (
    <div>
      {hidden.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-xs text-neutral-400">Скрытые склады:</span>
          {hidden.map((w) => (
            <span key={w.id} className="rounded-xl inline-flex items-center gap-1 border border-neutral-200 bg-white px-2 py-0.5 text-xs text-neutral-500">
              <button onClick={() => onSetWarehouse(w.id, "hidden", false)} className="font-medium hover:text-neutral-800" title="Показать склад">{w.name || "—"}</button>
              <button onClick={() => onRemoveWarehouse(w.id)} className="text-neutral-300 hover:text-red-500" title="Удалить навсегда"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th rowSpan={2} className="px-3 py-2 text-left align-middle" style={{ ...stickyLeft, width: SIZE_W, minWidth: SIZE_W, background: accent, color: "#fff", borderTopLeftRadius: 8 }}>
                <div className="text-sm font-bold italic leading-tight">{group.label}</div>
                <div className="font-medium opacity-80" style={{ fontSize: 11 }}>Размеры</div>
              </th>
              <th rowSpan={2} className="px-2 py-2 text-center text-xs font-semibold text-neutral-500 align-middle" style={{ width: NUM_W, minWidth: NUM_W, background: "#f5f5f5", borderBottom: "1px solid #e5e5e5" }}>Общее<br />кол-во</th>
              <th rowSpan={2} className="px-2 py-2 text-center text-xs font-semibold align-middle" style={{ width: NUM_W, minWidth: NUM_W, background: accent + "1a", color: accent, borderBottom: "1px solid #e5e5e5" }}>Кол-во<br />к поставке</th>
              {visible.map((w) => (
                <th key={w.id} className="group/wh px-1 pt-1 text-center align-top" style={{ width: WH_W, minWidth: WH_W, background: "#fff7ed", borderLeft: "2px solid #fff" }}>
                  <div className="flex items-start gap-0.5">
                    <div className="min-w-0 flex-1 leading-tight">
                      <input value={w.name} onChange={(e) => onSetWarehouse(w.id, "name", e.target.value)} className="w-full bg-transparent text-center text-xs font-bold text-neutral-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-200" />
                      <input value={w.region} onChange={(e) => onSetWarehouse(w.id, "region", e.target.value)} placeholder="регион" className="w-full bg-transparent text-center text-neutral-400 focus:bg-white focus:outline-none" style={{ fontSize: 10 }} />
                    </div>
                    <button onClick={() => onSetWarehouse(w.id, "hidden", true)} title="Скрыть склад" className="mt-0.5 p-0.5 text-neutral-300 opacity-0 transition hover:bg-neutral-200 hover:text-neutral-600 group-hover/wh:opacity-100">
                      <Minus size={12} />
                    </button>
                  </div>
                </th>
              ))}
              <th rowSpan={2} className="px-2 py-2 text-center text-xs font-semibold text-neutral-600 align-middle" style={{ width: NUM_W, minWidth: NUM_W, background: "#f0fdf4", borderBottom: "1px solid #e5e5e5" }}>Сумма</th>
              <th rowSpan={2} className="px-2 align-middle" style={{ width: 44, minWidth: 44 }}>
                <button onClick={onAddWarehouse} title="Добавить склад" className="flex h-7 w-7 items-center justify-center text-white hover:opacity-90" style={{ background: accent }}>
                  <Plus size={15} strokeWidth={3} />
                </button>
              </th>
            </tr>
            <tr>
              {visible.map((w) => (
                <th key={w.id} className="px-1 pb-1" style={{ background: "#fff7ed", borderLeft: "2px solid #fff" }}>
                  <div className="flex font-medium text-neutral-400" style={{ fontSize: 10 }}>
                    <span className="flex-1 text-right pr-1">шт</span>
                    <span className="text-center" style={{ width: PCT_W }}>%</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sizes.map((s) => {
              const total = toNum(s.total);
              const toShip = toNum(s.toShip);
              const sum = warehouses.reduce((a, w) => { const q = toNum(s.qty[w.id]); return a + (isNaN(q) ? 0 : q); }, 0);
              const matches = toShip > 0 && Math.round(sum) === Math.round(toShip);
              const shipPct = total > 0 && toShip > 0 ? Math.round((toShip / total) * 100) : null;
              return (
                <tr key={s.id} className="group/sz">
                  <th className="px-1 py-1 text-left" style={{ ...stickyLeft, width: SIZE_W, minWidth: SIZE_W, background: "#fafafa", borderTop: "1px solid #e5e5e5" }}>
                    <div className="flex items-center gap-0.5">
                      <input value={s.name} onChange={(e) => onSetSize(s.id, "name", e.target.value)} placeholder="—" className="w-9 bg-transparent px-1 py-1 text-sm font-semibold text-neutral-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-200" />
                      <button onClick={() => onRemoveSize(s.id)} title="Удалить размер" className="p-0.5 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover/sz:opacity-100">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </th>
                  <td style={{ background: "#fff", borderTop: "1px solid #e5e5e5" }}>
                    <input value={s.total} onChange={(e) => onSetSize(s.id, "total", e.target.value)} inputMode="decimal" className="w-full bg-transparent px-2 py-1.5 text-right text-sm font-medium text-neutral-700 focus:bg-orange-50 focus:outline-none" style={tnum} />
                  </td>
                  <td style={{ background: accent + "0d", borderTop: "1px solid #e5e5e5" }}>
                    <input value={s.toShip} onChange={(e) => onSetSize(s.id, "toShip", e.target.value)} inputMode="decimal" className="w-full bg-transparent px-2 py-1.5 text-right text-sm font-semibold focus:bg-orange-50 focus:outline-none" style={{ color: accent, ...tnum }} />
                    {shipPct != null && <div className="px-2 text-right text-neutral-400" style={{ fontSize: 9, marginTop: -4 }}>{shipPct}% от общего</div>}
                  </td>
                  {visible.map((w) => {
                    const qStr = s.qty[w.id] ?? "";
                    const q = toNum(qStr);
                    const pct = !isNaN(q) && toShip > 0 ? Math.round((q / toShip) * 100) : "";
                    const onPct = (val) => {
                      if (val === "") return onSetQty(s.id, w.id, "");
                      const pv = toNum(val);
                      if (isNaN(pv) || toShip <= 0) return;
                      onSetQty(s.id, w.id, String(Math.round((pv / 100) * toShip)));
                    };
                    const filled = !isNaN(q) && q > 0;
                    return (
                      <td key={w.id} style={{ width: WH_W, minWidth: WH_W, borderTop: "1px solid #e5e5e5", borderLeft: "2px solid #f5f5f5", background: filled ? "#f0fdf4" : "transparent" }}>
                        <div className="flex items-center">
                          <input value={qStr} onChange={(e) => onSetQty(s.id, w.id, e.target.value)} inputMode="decimal" placeholder="0" className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-right text-sm font-semibold text-neutral-800 placeholder:text-neutral-300 focus:bg-orange-50 focus:outline-none" style={tnum} />
                          <input value={pct === "" ? "" : String(pct)} onChange={(e) => onPct(e.target.value)} inputMode="decimal" placeholder="%" className="bg-transparent py-1.5 pr-1.5 text-right text-neutral-400 placeholder:text-neutral-300 focus:bg-orange-50 focus:outline-none" style={{ width: PCT_W, fontSize: 11, borderLeft: "1px solid #e5e7eb", ...tnum }} />
                        </div>
                      </td>
                    );
                  })}
                  <td className="text-center" style={{ borderTop: "1px solid #e5e5e5", background: matches ? "#bbf7d0" : sum > 0 ? "#fef9c3" : "#fafafa" }}>
                    <span className="px-2 text-sm font-bold text-neutral-700" style={tnum}>{sum || ""}</span>
                  </td>
                  <td style={{ borderTop: "1px solid #e5e5e5" }} />
                </tr>
              );
            })}
            <tr>
              <td colSpan={colCount} className="px-2 py-1.5" style={{ borderTop: "1px solid #e5e5e5" }}>
                <button onClick={onAddSize} className="rounded-md inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700">
                  <Plus size={13} /> Размер
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        {sizes.length === 0 && (
          <p className="mt-2 px-1 text-xs text-neutral-400">Добавьте размер кнопкой ниже, затем заполните распределение по складам.</p>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Блок «Календарь» — процесс «Логистика» на диаграмме Ганта. Один на товар.
   Процесс = дата старта + последовательные компоненты (название + длительность в днях).
   Компоненты идут встык; их правые границы (ползунки) можно тянуть на Ганте, а весь
   процесс — двигать. Точка входа — дедлайн (старт продаж). Подсвечены сегодня и дедлайн.
---------------------------------------------------------------------------- */

function CalendarBlock({ product, productList = [], onSetEntry, onSetStart, onSetName, onSetComponents, onCopyFrom }) {
  const cal = normalizeCalendar(product.calendar);
  const components = cal.components || [];
  const entry = cal.entry || "";
  const start = cal.start || "";
  const procName = cal.name || "Логистика";

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${String(d.getFullYear()).padStart(4, "0")}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDaysStr = (dayStr, n) => { const d = new Date(dayStr + "T00:00:00"); if (isNaN(d.getTime())) return dayStr; d.setDate(d.getDate() + n); return iso(d); };
  const daysBetween = (aStr, bStr) => Math.round((new Date(bStr + "T00:00:00") - new Date(aStr + "T00:00:00")) / 86400000);
  const plausible = (ds) => typeof ds === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ds) && ds >= "2000-01-01" && ds <= "2100-12-31";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = iso(today);

  const [editOpen, setEditOpen] = useState(false); // окно настроек процесса
  const [copyOpen, setCopyOpen] = useState(false); // меню «скопировать из…»
  const [drag, setDrag] = useState(null); // { mode:"move"|"resize", compIdx, startClientX, origStart, origDays, previewStart, previewDays }

  const LBL_W = 230, DAY_W = 30;
  const sticky = (left, w, bg, z = 3) => ({ position: "sticky", left, width: w, minWidth: w, maxWidth: w, background: bg, zIndex: z });

  // зафиксированные длительности (для расчёта окна — стабильно во время перетаскивания)
  const committedDays = components.map((c) => Math.max(1, parseInt(c.days) || 1));
  const committedTotal = committedDays.reduce((a, b) => a + b, 0);
  const hasStart = plausible(start);

  // окно дат считаем по зафиксированным значениям — чтобы сетка не «уезжала» при перетаскивании
  const dates = [];
  if (hasStart) { dates.push(start); const e = addDaysStr(start, committedTotal - 1); if (plausible(e)) dates.push(e); }
  if (plausible(entry)) dates.push(entry);
  dates.push(todayStr);
  const minStr = dates.reduce((a, b) => (a < b ? a : b), dates[0] || todayStr);
  const maxStr = dates.reduce((a, b) => (a > b ? a : b), dates[0] || todayStr);
  const winStart = addDaysStr(minStr, -2);
  let count = daysBetween(winStart, addDaysStr(maxStr, 2)) + 1;
  count = Math.max(14, Math.min(220, isNaN(count) ? 14 : count));
  const dayList = buildDays(winStart, count);

  // полоса (во время перетаскивания — превью, иначе зафиксированные значения)
  const dragging = !!drag;
  const barStart = dragging ? drag.previewStart : start;
  const barDays = dragging ? drag.previewDays : committedDays;
  const barTotal = barDays.reduce((a, b) => a + b, 0);
  const barOffsets = []; { let acc = 0; for (const d of barDays) { barOffsets.push(acc); acc += d; } }
  const rawStartIdx = dayList.length && plausible(barStart) ? daysBetween(dayList[0].key, barStart) : 0;

  // ----- компоненты (редактирование в настройках) -----
  const setComp = (id, field, val) => onSetComponents(components.map((c) => (c.id === id ? { ...c, [field]: val } : c)));
  const addComp = () => onSetComponents([...components, { id: uid(), name: "", days: 3, color: CAL_STAGE_COLORS[components.length % CAL_STAGE_COLORS.length] }]);
  const removeComp = (id) => onSetComponents(components.filter((c) => c.id !== id));
  const moveComp = (idx, dir) => { const j = idx + dir; if (j < 0 || j >= components.length) return; const arr = components.slice(); const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t; onSetComponents(arr); };

  // ----- перетаскивание на ганте -----
  const startDrag = (mode, compIdx, ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (!hasStart) return;
    setDrag({ mode, compIdx, startClientX: ev.clientX, origStart: start, origDays: committedDays.slice(), previewStart: start, previewDays: committedDays.slice() });
  };
  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      const delta = Math.round((e.clientX - drag.startClientX) / DAY_W);
      if (drag.mode === "move") {
        setDrag((d) => (d ? { ...d, previewStart: addDaysStr(d.origStart, delta) } : d));
      } else {
        setDrag((d) => { if (!d) return d; const nd = d.origDays.slice(); nd[d.compIdx] = Math.max(1, d.origDays[d.compIdx] + delta); return { ...d, previewDays: nd }; });
      }
    };
    const onUp = () => {
      setDrag((d) => {
        if (d) {
          if (d.mode === "move") onSetStart(d.previewStart);
          else onSetComponents(components.map((c, i) => (i === d.compIdx ? { ...c, days: d.previewDays[i] } : c)));
        }
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drag, components]); // eslint-disable-line react-hooks/exhaustive-deps

  const headColBg = (dKey) => (dKey === entry ? "#fef2f2" : dKey === todayStr ? "#fff7ed" : dKey && new Date(dKey + "T00:00:00").getDay() % 6 === 0 ? "#f5f5f5" : "#fafafa");
  const colBorders = (dKey) => {
    if (dKey === entry) return { borderLeft: "2px dashed #dc2626" };
    if (dKey === todayStr) return { borderLeft: "1px solid #ea580c", borderRight: "1px solid #ea580c" };
    return { borderLeft: "1px solid #f0f0f0" };
  };
  const dateInput = "rounded-md border border-neutral-200 px-1 py-0.5 text-xs text-neutral-700 focus:outline-none focus:ring-2 focus:ring-sky-200";
  const procEnd = hasStart && barTotal > 0 ? addDaysStr(barStart, barTotal - 1) : "";

  return (
    <div>
      {/* Шапка */}
      <div className="mb-2 flex flex-wrap items-center gap-3 px-1">
        <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
          <span className="inline-flex items-center gap-1"><span style={{ display: "inline-block", width: 12, height: 0, borderTop: "2px dashed #dc2626" }} /> Точка входа (старт продаж)</span>
          <input type="date" value={entry} onChange={(e) => onSetEntry(e.target.value)} className={dateInput} />
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
          Старт логистики
          <input type="date" value={start} onChange={(e) => onSetStart(e.target.value)} className={dateInput} />
        </label>
        <div className="relative">
          <button
            onClick={() => setCopyOpen((v) => !v)}
            title="Скопировать этапы из другого товара"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100"
          >
            <Copy size={14} />
          </button>
          {copyOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setCopyOpen(false)} />
              <div className="absolute left-0 top-8 z-20 max-h-64 w-64 overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
                <div className="px-3 py-1 text-xs font-medium text-neutral-400">Скопировать этапы из…</div>
                {productList.filter((x) => x.id !== product.id).map((x) => (
                  <button
                    key={x.id}
                    onClick={() => { onCopyFrom(x.id); setCopyOpen(false); }}
                    className="block w-full truncate px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-50"
                  >
                    {(x.code || x.wb || "—") + (x.name ? " — " + x.name : "")}
                  </button>
                ))}
                {productList.filter((x) => x.id !== product.id).length === 0 && (
                  <div className="px-3 py-1.5 text-xs text-neutral-400">Нет других товаров</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ overflowX: "auto", paddingBottom: 12 }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ ...sticky(0, LBL_W, "#fafafa", 4), borderTopLeftRadius: 8, borderBottom: "1px solid #e5e5e5", borderRight: "1px solid #e5e5e5", boxShadow: "6px 0 10px -8px rgba(15,23,42,.25)", textAlign: "left", padding: "4px 10px" }} className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Процесс</th>
              {dayList.map((d) => (
                <th key={d.key} style={{ width: DAY_W, minWidth: DAY_W, background: headColBg(d.key), ...colBorders(d.key), borderTop: d.key === todayStr || d.key === entry ? undefined : "none", position: "relative" }} className="px-0.5 py-1 text-center">
                  {d.key === entry && <div style={{ position: "absolute", top: -1, left: "50%", transform: "translateX(-50%)", color: "#dc2626", fontSize: 9, lineHeight: 1 }}>▼</div>}
                  {d.firstOfMonth && <div className="font-bold text-sky-600" style={{ fontSize: 9 }}>{MONTHS[d.month]} {d.key.slice(2, 4)}</div>}
                  <div className="text-xs font-semibold text-neutral-600">{String(d.day).padStart(2, "0")}</div>
                  <div className="text-neutral-400" style={{ fontSize: 9 }}>{d.wd}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th style={{ ...sticky(0, LBL_W, "#fff"), borderTop: "1px solid #f5f5f5", borderRight: "1px solid #e5e5e5", boxShadow: "6px 0 10px -8px rgba(15,23,42,.25)", textAlign: "left", padding: "3px 6px 3px 10px" }}>
                <div className="flex w-full items-center gap-1.5">
                  <span className="min-w-0 truncate text-xs font-semibold text-neutral-800">Этапы</span>
                  <button onClick={() => setEditOpen(true)} className="rounded-md ml-auto flex h-6 w-6 shrink-0 items-center justify-center border text-neutral-500 hover:bg-neutral-50" style={editOpen ? { borderColor: "#0ea5e9", color: "#0284c7", background: "#f0f9ff" } : { borderColor: "#e5e5e5" }} title="Настройки этапов (старт, компоненты)"><Settings2 size={13} /></button>
                </div>
              </th>
              {dayList.map((d, di) => (
                <td key={d.key} style={{ width: DAY_W, minWidth: DAY_W, position: "relative", zIndex: di === 0 ? 2 : "auto", borderTop: "1px solid #f5f5f5", background: d.weekend ? "#fafafa" : "#fff", ...colBorders(d.key) }}>
                  <div style={{ minHeight: 34 }} />
                  {di === 0 && hasStart && barTotal > 0 && (
                    <div style={{ position: "absolute", top: 1, bottom: 1, left: rawStartIdx * DAY_W, width: barTotal * DAY_W }}>
                      {barDays.map((dd, ci) => {
                        const c = components[ci] || {};
                        const segW = dd * DAY_W;
                        const color = c.color || "#93c5fd";
                        return (
                          <div
                            key={c.id || ci}
                            onMouseDown={(ev) => startDrag("move", ci, ev)}
                            title={`${c.name || "Компонент"} — ${dd} дн. Тяните, чтобы сдвинуть процесс; за правый край — изменить длительность`}
                            style={{ position: "absolute", top: 0, bottom: 0, left: barOffsets[ci] * DAY_W, width: segW, background: color, borderRight: ci < barDays.length - 1 ? "1px solid rgba(255,255,255,.75)" : "none", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: dragging && drag.mode === "move" ? "grabbing" : "grab", userSelect: "none" }}
                          >
                            <span style={{ fontSize: 9, fontWeight: 600, color: "#334155", whiteSpace: "nowrap", padding: "0 3px", pointerEvents: "none" }}>
                              {segW >= 56 ? `${c.name || ""} · ${dd}` : segW >= 22 ? dd : ""}
                            </span>
                            <div onMouseDown={(ev) => startDrag("resize", ci, ev)} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 7, cursor: "ew-resize" }} title="Изменить длительность компонента" />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {!hasStart && (
        <div className="px-3 py-3 text-center text-xs text-neutral-400">Укажите «Старт логистики», чтобы увидеть полосу процесса.</div>
      )}

      {/* Окно настроек процесса */}
      {editOpen && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setEditOpen(false)} />
          <div className="rounded-2xl fixed left-1/2 top-24 z-50 w-[540px] max-w-[92vw] -translate-x-1/2 border border-neutral-200 bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-800">Настройки логистики</span>
              <button onClick={() => setEditOpen(false)} className="rounded-md p-0.5 text-neutral-400 hover:bg-neutral-100"><X size={16} /></button>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">Название
                <input value={procName} onChange={(e) => onSetName(e.target.value)} className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 focus:outline-none focus:ring-2 focus:ring-sky-200" style={{ width: 150 }} />
              </label>
              <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">Старт
                <input type="date" value={start} onChange={(e) => onSetStart(e.target.value)} className={dateInput} />
              </label>
              <span className="text-xs text-neutral-400">Итого: <b className="text-neutral-700">{committedTotal} дн</b>{procEnd ? ` · до ${procEnd.slice(8, 10)}.${procEnd.slice(5, 7)}` : ""}</span>
            </div>
            <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400" style={{ display: "grid", gridTemplateColumns: "20px 1fr 70px 26px 26px 26px", gap: 6, alignItems: "center" }}>
              <span></span><span>Компонент</span><span className="text-right">Дней</span><span></span><span></span><span></span>
            </div>
            <div className="space-y-1.5">
              {components.map((c, ci) => (
                <div key={c.id} style={{ display: "grid", gridTemplateColumns: "20px 1fr 70px 26px 26px 26px", gap: 6, alignItems: "center" }}>
                  <input type="color" value={c.color || "#93c5fd"} onChange={(e) => setComp(c.id, "color", e.target.value)} style={{ width: 18, height: 18, padding: 0, border: "none", background: "none", cursor: "pointer" }} title="Цвет" />
                  <input value={c.name} onChange={(e) => setComp(c.id, "name", e.target.value)} placeholder="Название компонента" className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 focus:outline-none focus:ring-2 focus:ring-sky-200" />
                  <input value={c.days} onChange={(e) => setComp(c.id, "days", e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="0" className="rounded-md border border-neutral-200 px-2 py-1 text-right text-xs text-neutral-700 focus:outline-none focus:ring-2 focus:ring-sky-200" />
                  <button onClick={() => moveComp(ci, -1)} disabled={ci === 0} className="rounded flex h-6 w-6 items-center justify-center text-neutral-400 hover:bg-neutral-100 disabled:opacity-30" title="Выше"><ChevronUp size={13} /></button>
                  <button onClick={() => moveComp(ci, 1)} disabled={ci === components.length - 1} className="rounded flex h-6 w-6 items-center justify-center text-neutral-400 hover:bg-neutral-100 disabled:opacity-30" title="Ниже"><ChevronDown size={13} /></button>
                  <button onClick={() => removeComp(c.id)} className="rounded flex h-6 w-6 items-center justify-center text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
            <button onClick={addComp} className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-200 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50">
              <Plus size={13} /> Добавить компонент
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Блок «РНП» — диаграмма Ганта (задачи × дни) + Фонд маркетинга. Один на товар.
---------------------------------------------------------------------------- */

function GanttBlock({ product, hiddenTasks = {}, startDate, days, onSetStartDate, onSetDays, onToggleTask, rnpOrder = [], onSetRnpOrder, onSetCell, onSetEntries, onSetFill, onSetFlag, onSetBudget, onSetSaleStart, onOpenPopup, onOpenDB, wbOrders = {}, wbLoading, wbProgress, onFetchWb, hideBudget = false, monthNav = false }) {
  const [fillMode, setFillMode] = useState(false);
  const [fillColor, setFillColor] = useState(FILL_COLORS[0]);
  const [bd, setBd] = useState(null); // позиция окна разбивки затрат
  const bdBtnRef = useRef(null);
  const nowM = new Date();
  const [ym, setYm] = useState(() => ({ y: nowM.getFullYear(), m: nowM.getMonth() }));
  const [rowsOpen, setRowsOpen] = useState(false);
  const prevMo = () => setYm((s) => { const d = new Date(s.y, s.m - 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const nextMo = () => setYm((s) => { const d = new Date(s.y, s.m + 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const goThisMo = () => setYm({ y: nowM.getFullYear(), m: nowM.getMonth() });
  // порядок строк: по rnpOrder, затем по исходному порядку RNP_TASKS
  const orderIdxOf = (id) => { const i = (rnpOrder || []).indexOf(id); return i === -1 ? 1000 + RNP_TASKS.findIndex((t) => t.id === id) : i; };
  const orderedAll = [...RNP_TASKS].sort((a, b) => orderIdxOf(a.id) - orderIdxOf(b.id));
  const moveRow = (id, dir) => {
    const base = (rnpOrder && rnpOrder.length) ? rnpOrder.filter((x) => RNP_TASKS.some((t) => t.id === x)) : RNP_TASKS.map((t) => t.id);
    const miss = RNP_TASKS.map((t) => t.id).filter((x) => !base.includes(x));
    const arr = [...base, ...miss];
    const i = arr.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onSetRnpOrder && onSetRnpOrder(arr);
  };
  const openBd = () => {
    const r = bdBtnRef.current?.getBoundingClientRect();
    if (r) setBd({ x: Math.min(r.left, (typeof window !== "undefined" ? window.innerWidth : 400) - 300), y: r.bottom + 6 });
  };

  const tasks = orderedAll.filter((t) => !hiddenTasks[t.id]);

  const cells = product.rnp.cells || {};
  const entries = product.rnp.entries || {};
  const fills = product.rnp.fills || {};
  const flags = product.rnp.flags || {};
  const budget = product.rnp.budget || { allocated: "" };
  const monthFirstISO = `${ym.y}-${String(ym.m + 1).padStart(2, "0")}-01`;
  const daysInMo = new Date(ym.y, ym.m + 1, 0).getDate();
  const dayList = monthNav ? buildDays(monthFirstISO, daysInMo) : buildDays(startDate, days);
  // старт продаж = «точка входа» логистического календаря товара
  const SALE_CLR = "#7c3aed";
  const saleStart = (product.calendar && product.calendar.entry) || "";
  const saleInView = !!saleStart && dayList.some((d) => d.key === saleStart);
  const saleDM = saleStart ? `${saleStart.slice(8, 10)}.${saleStart.slice(5, 7)}` : "";

  const LBL_W = 210, TOT_W = 62, SHARE_W = 56, DAY_W = 66;
  const sticky = (left, w, bg, z = 3) => ({ position: "sticky", left, width: w, minWidth: w, maxWidth: w, background: bg, zIndex: z });

  const recordCost = (task, e) => calcRecordCost(task.fields, e);
  const entrySum = (task, arr) => (arr || []).reduce((a, e) => a + recordCost(task, e), 0);
  const rangeEntries = (task) => entries[`${task.id}:_ranges`] || [];
  const dayCostOf = (task, dkey) => {
    if (task.kind === "rangeTask") {
      return rangeEntries(task).reduce((a, e) => (e.start <= dkey && e.end >= dkey ? a + recordCost(task, e) : a), 0);
    }
    return task.top === "entries"
      ? entrySum(task, entries[`${task.id}:${dkey}`])
      : rnpInternalDay(task, product, dkey);
  };
  const taskTotal = (task) => {
    if (task.kind === "rangeTask") return rangeEntries(task).reduce((a, e) => a + recordCost(task, e), 0);
    return task.top === "entries"
      ? Object.entries(entries).reduce((a, [k, arr]) => a + (k.startsWith(task.id + ":") && !k.endsWith(":_ranges") ? entrySum(task, arr) : 0), 0)
      : rnpSingleTotal(task, product);
  };
  const allocated = toNum(budget.allocated);
  const spent = RNP_COST_TASKS.reduce((a, t) => a + taskTotal(t), 0);
  const ostatok = (isNaN(allocated) ? 0 : allocated) - spent;

  const paintOverlay = (tid, dkey) => fillMode ? (
    <div
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); const key = `${tid}:${dkey}`; onSetFill(key, fills[key] === fillColor ? null : fillColor); }}
      style={{ position: "absolute", inset: 0, cursor: "cell", zIndex: 6 }}
    />
  ) : null;
  const cellBg = (tid, dkey, weekend) => fills[`${tid}:${dkey}`] || (weekend ? "#fafafa" : "#fff");

  const numInput = "w-full bg-transparent px-1 py-1 text-center focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-200";

  // рендер одной ячейки-дня для конкретной задачи
  const today = new Date().toISOString().slice(0, 10);
  const entryStatus = (task, dkey) => {
    const arr = entries[`${task.id}:${dkey}`] || [];
    if (arr.length === 0) return "empty";
    return arr.every((e) => e.done) ? "done" : "planned";
  };

  const renderDay = (task, d, sub) => {
    const fillBg = fills[`${task.id}:${d.key}`];
    const baseBg = fillBg || (d.weekend ? "#fafafa" : "#fff");
    const isToday = d.key === today;
    const isSale = d.key === saleStart;
    const base = { ...(monthNav ? { overflow: "hidden" } : { width: DAY_W, minWidth: DAY_W }), position: "relative", borderTop: "1px solid #f5f5f5", borderLeft: isToday ? "1px solid #ea580c" : (isSale ? `2px dashed ${SALE_CLR}` : "1px solid #f5f5f5"), borderRight: isToday ? "1px solid #ea580c" : "none", background: baseBg };

    if (task.kind === "wbOrders") {
      const count = rnpWbCount(task, product, d.key, wbOrders);
      return (
        <td key={d.key} title={rnpWbTip(task, product, d.key)} style={{ ...base, background: count > 0 ? "#f0fdf4" : baseBg }}>
          <div className="px-1 py-0.5 text-center text-xs font-semibold text-neutral-700" style={{ minHeight: 26, fontVariantNumeric: "tabular-nums" }}>
            {count > 0 ? rnpWbFmt(task, count) : <span className="text-neutral-300">—</span>}
          </div>
        </td>
      );
    }
    if (task.kind === "singleCost") {
      const ad = rnpAdDay(product, d.key);
      if (task.id === "internal" && ad !== undefined) return (
        <td key={d.key} title="Факт из WB (внутренняя реклама)" style={{ ...base, background: ad > 0 ? "#eff6ff" : (d.weekend ? "#fafafa" : "#fff") }}>
          <div className="w-full px-1 py-0.5 text-center text-xs font-semibold" style={{ color: "#2563eb", fontVariantNumeric: "tabular-nums" }}>{ad > 0 ? Math.round(ad).toLocaleString("ru-RU") : ""}</div>
          {paintOverlay(task.id, d.key)}
        </td>
      );
      const val = cells[`${task.id}:cost:${d.key}`] ?? "";
      const has = val !== "" && toNum(val) > 0;
      const bg = has ? "#f0fdf4" : (d.weekend ? "#fafafa" : "#fff");
      return (
        <td key={d.key} style={{ ...base, background: bg }}>
          <input value={val} onChange={(e) => onSetCell(`${task.id}:cost:${d.key}`, e.target.value)} inputMode="decimal" placeholder="₽" className="w-full bg-transparent px-1 py-0.5 text-center text-xs font-medium text-neutral-600 placeholder:text-neutral-300 focus:bg-white focus:outline-none" style={{ fontVariantNumeric: "tabular-nums" }} />
          {paintOverlay(task.id, d.key)}
        </td>
      );
    }
    if (task.kind === "twoRow") {
      if (sub === "top") {
        if (task.top === "text") {
          return (
            <td key={d.key} style={base}>
              <input value={cells[`${task.id}:top:${d.key}`] ?? ""} onChange={(e) => onSetCell(`${task.id}:top:${d.key}`, e.target.value)} className="w-full bg-transparent px-1 py-0.5 text-center text-xs text-neutral-700 focus:bg-white focus:outline-none" />
              {paintOverlay(task.id, d.key)}
            </td>
          );
        }
        // entries cell
        const arr = entries[`${task.id}:${d.key}`] || [];
        const cost = dayCostOf(task, d.key);
        const st = entryStatus(task, d.key);
        const cellBgE = st === "done" ? "#f0fdf4" : st === "planned" ? "#e5e5e5" : baseBg;
        return (
          <td key={d.key} style={{ ...base, background: fillBg || cellBgE }}>
            <button onClick={() => onOpenPopup(task, d.key)} className="group/cell flex w-full flex-col items-center justify-center gap-0.5 px-1 py-0.5 hover:bg-orange-50" style={{ minHeight: 30 }} title="Открыть записи">
              {arr.length > 0 ? (
                <>
                  <span className="relative inline-flex items-center">
                    <span className="rounded-full inline-flex h-4 min-w-4 items-center justify-center bg-orange-600 px-1 font-bold text-white" style={{ fontSize: 10 }}>{arr.length}</span>
                    <span className="ml-0.5 hidden text-neutral-400 group-hover/cell:inline"><Plus size={11} /></span>
                  </span>
                  {cost > 0 && <span className="font-medium text-neutral-500" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{cost.toLocaleString("ru-RU")}</span>}
                </>
              ) : (
                <Plus size={13} className="text-neutral-300" />
              )}
            </button>
            {paintOverlay(task.id, d.key)}
          </td>
        );
      }
      // cost sub-row (only for text-top tasks now)
      return (
        <td key={d.key} style={{ ...(monthNav ? { overflow: "hidden" } : { width: DAY_W, minWidth: DAY_W }), borderTop: "1px solid #f5f5f5", borderLeft: d.key === saleStart ? `2px dashed ${SALE_CLR}` : "1px solid #f5f5f5", background: "#fff" }}>
          <input value={cells[`${task.id}:cost:${d.key}`] ?? ""} onChange={(e) => onSetCell(`${task.id}:cost:${d.key}`, e.target.value)} inputMode="decimal" placeholder="₽" className="w-full bg-transparent px-1 py-0.5 text-center text-xs font-medium text-neutral-600 placeholder:text-neutral-300 focus:bg-white focus:outline-none" style={{ fontVariantNumeric: "tabular-nums" }} />
        </td>
      );
    }
    if (task.kind === "checkbox") {
      const key = `${task.id}:${d.key}`;
      const on = !!flags[key];
      return (
        <td key={d.key} style={{ ...base, background: on ? "#f0fdf4" : baseBg }}>
          <label className="flex items-center justify-center" style={{ minHeight: 26, cursor: "pointer" }}>
            <input type="checkbox" checked={on} onChange={() => onSetFlag(key, !on)} className="h-3.5 w-3.5 accent-green-600" />
          </label>
        </td>
      );
    }
    if (task.kind === "rangeTask") {
      const ranges = rangeEntries(task);
      const active = ranges.filter((r) => r.start <= d.key && r.end >= d.key);
      if (active.length > 0) {
        const allDone = active.every((r) => r.done);
        const bg2 = allDone ? "#f0fdf4" : "#e5e5e5";
        return (
          <td key={d.key} style={{ ...base, background: fillBg || bg2 }}>
            <div style={{ minHeight: 26 }} />
            {paintOverlay(task.id, d.key)}
          </td>
        );
      }
      return (
        <td key={d.key} style={base}>
          <div style={{ minHeight: 26 }} />
          {paintOverlay(task.id, d.key)}
        </td>
      );
    }
    return <td key={d.key} style={base} />;
  };

  return (
    <div>
      {/* панель управления */}
      {monthNav ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
          <button onClick={prevMo} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /></button>
          <button onClick={nextMo} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><ChevronRight size={16} /></button>
          <h3 className="ml-1 text-sm font-semibold capitalize text-neutral-900">{MONTHS_FULL[ym.m]} {ym.y}</h3>
          <label className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50/60 px-2 py-1 text-xs font-medium text-violet-700" title="Отмечается полоской на ганте (единое поле со «старт продаж / точка входа»)">
            <Flag size={12} className="text-violet-500" /> Старт продаж
            <input type="date" value={saleStart} onChange={(e) => onSetSaleStart && onSetSaleStart(e.target.value)} className="rounded-md border border-violet-200 bg-white px-1.5 py-0.5 text-xs text-violet-700 focus:outline-none" />
            {saleStart && <button onClick={() => onSetSaleStart && onSetSaleStart("")} className="rounded p-0.5 text-violet-300 hover:bg-violet-100 hover:text-violet-600" title="Убрать"><X size={12} /></button>}
          </label>
          <div className="relative ml-auto">
            <button onClick={() => setRowsOpen((o) => !o)} className={"inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition " + (rowsOpen ? "border-neutral-800 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50")}>
              <Settings2 size={14} className={rowsOpen ? "text-white" : "text-neutral-400"} /> Строки
              <ChevronDown size={12} className={"transition " + (rowsOpen ? "rotate-180" : "")} />
            </button>
            {rowsOpen && (<><div className="fixed inset-0 z-40" onClick={() => setRowsOpen(false)} />
              <div className="absolute right-0 z-50 mt-1.5 w-[320px] max-w-[88vw] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl">
                <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2.5"><span className="text-[13px] font-bold text-neutral-800">Строки РНП</span><button onClick={() => setRowsOpen(false)} className="ml-auto rounded-md p-0.5 text-neutral-400 hover:bg-neutral-100"><X size={15} /></button></div>
                <div className="max-h-[360px] overflow-auto p-2">
                  {orderedAll.map((t, i) => { const on = !hiddenTasks[t.id]; return (
                    <div key={t.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
                      <span className="flex flex-col text-neutral-300">
                        <button onClick={() => moveRow(t.id, -1)} disabled={i === 0} className="-my-0.5 flex h-3.5 w-4 items-center justify-center hover:text-neutral-600 disabled:opacity-30"><ChevronUp size={12} /></button>
                        <button onClick={() => moveRow(t.id, 1)} disabled={i === orderedAll.length - 1} className="-my-0.5 flex h-3.5 w-4 items-center justify-center hover:text-neutral-600 disabled:opacity-30"><ChevronDown size={12} /></button>
                      </span>
                      <span className={"flex-1 text-[13px] " + (on ? "text-neutral-700" : "text-neutral-400")}>{t.label}</span>
                      <button onClick={() => onToggleTask && onToggleTask(t.id)} title={on ? "Скрыть строку" : "Показать строку"} className="relative h-[20px] w-[34px] shrink-0 rounded-full transition" style={{ background: on ? "#16a34a" : "#d4d4d8" }}>
                        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: on ? 16 : 2 }} />
                      </button>
                    </div>
                  ); })}
                </div>
                <div className="border-t border-neutral-100 px-3 py-2"><span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-neutral-400"><Plus size={13} /> Строка по товару <span className="text-[10px] font-normal text-neutral-300">скоро</span></span></div>
              </div></>)}
          </div>
        </div>
      ) : (
      <div className="mb-2 flex flex-wrap items-center gap-3 px-1">
        <div className="text-sm font-semibold text-neutral-900">Дата</div>
        <label className="flex items-center gap-1 text-xs text-neutral-500">
          с
          <input type="date" value={startDate} onChange={(e) => onSetStartDate(e.target.value)} className="rounded-lg border border-neutral-200 px-1.5 py-0.5 text-xs" />
        </label>
        <label className="flex items-center gap-1 text-xs text-neutral-500">
          дней
          <input type="number" min="7" max="120" value={days} onChange={(e) => onSetDays(Math.max(7, Math.min(120, parseInt(e.target.value) || 7)))} className="rounded-lg w-16 border border-neutral-200 px-1.5 py-0.5 text-xs" />
        </label>

        {/* Фонд маркетинга */}
        {!hideBudget && (
        <div className="rounded-xl ml-auto inline-flex flex-wrap items-center gap-2 border border-neutral-200 bg-white px-2.5 py-1">
          <span className="text-xs font-semibold text-neutral-800">Фонд маркетинга</span>
          <label className="flex items-center gap-1 text-xs text-neutral-500">
            Выделено
            <input value={budget.allocated} onChange={(e) => onSetBudget(e.target.value)} inputMode="decimal" placeholder="0" className="rounded-lg w-20 border border-neutral-200 px-1.5 py-0.5 text-right text-xs font-semibold text-neutral-800 focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ fontVariantNumeric: "tabular-nums" }} />
          </label>
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            Затраты
            <span className="bg-neutral-100 px-1.5 py-0.5 text-xs font-semibold text-neutral-700" style={{ fontVariantNumeric: "tabular-nums" }}>{money(spent)}</span>
            <button ref={bdBtnRef} onClick={() => (bd ? setBd(null) : openBd())} title="Разбивка по строкам" className="rounded-lg flex h-5 w-5 items-center justify-center border border-neutral-200 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700">
              <Plus size={13} />
            </button>
          </div>
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            Остаток
            <span className="px-1.5 py-0.5 text-xs font-bold" style={{ fontVariantNumeric: "tabular-nums", background: ostatok < 0 ? "#fee2e2" : "#f0fdf4", color: ostatok < 0 ? "#b91c1c" : "#15803d" }}>{money(ostatok)}</span>
          </div>
        </div>
        )}
      </div>
      )}

      <div style={{ overflowX: "auto", paddingBottom: 12, paddingTop: saleInView ? 22 : 0 }}>
        <table style={monthNav ? { borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: "100%", minWidth: LBL_W + dayList.length * 22 } : { borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ ...sticky(0, LBL_W, "#fafafa", 4), borderTopLeftRadius: 8, borderBottom: "1px solid #e5e5e5" }}></th>
              {dayList.map((d) => { const isSale = d.key === saleStart; return (
                <th key={d.key} style={{ ...(monthNav ? {} : { width: DAY_W, minWidth: DAY_W }), position: "relative", background: d.weekend ? "#f5f5f5" : "#fafafa", borderLeft: d.key === today ? "1px solid #ea580c" : (isSale ? `2px dashed ${SALE_CLR}` : "1px solid #e5e5e5"), borderRight: d.key === today ? "1px solid #ea580c" : "none", borderTop: d.key === today ? "1px solid #ea580c" : "none" }} className="px-0.5 py-1 text-center">
                  {isSale && (<>
                    <span style={{ position: "absolute", left: -1, top: -20, transform: "translateX(-50%)", whiteSpace: "nowrap", background: "#f5f3ff", color: "#6d28d9", border: "1px solid #ddd6fe", fontSize: 9.5, fontWeight: 800, borderRadius: 6, padding: "2px 7px", zIndex: 6, pointerEvents: "none" }}>Старт продаж {saleDM}</span>
                    <span style={{ position: "absolute", left: -1, top: -1, transform: "translateX(-50%)", color: SALE_CLR, fontSize: 11, lineHeight: 1, zIndex: 5, pointerEvents: "none" }}>▼</span>
                  </>)}
                  {!monthNav && d.firstOfMonth && <div className="font-bold text-orange-600" style={{ fontSize: 9 }}>{MONTHS[d.month]} {d.key.slice(2, 4)}</div>}
                  <div className="text-xs font-semibold text-neutral-600">{String(d.day).padStart(2, "0")}</div>
                  <div className="text-neutral-400" style={{ fontSize: 9 }}>{d.wd}</div>
                </th>
              ); })}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const twoRow = task.kind === "twoRow" && task.top === "text";
              return (
                <FragmentRow key={task.id}>
                  <tr>
                    <th rowSpan={twoRow ? 2 : 1} style={{ ...sticky(0, LBL_W, "#fafafa"), borderTop: "1px solid #f5f5f5", textAlign: "left", padding: "4px 10px", verticalAlign: "middle" }}>
                      <div className="flex items-center gap-1.5">
                        {(task.top === "entries" || task.kind === "rangeTask") ? (
                          <button onClick={() => onOpenDB(task)} className="text-left text-xs font-semibold text-orange-700 hover:underline" title="Открыть базу записей">{task.label}</button>
                        ) : task.kind === "wbOrders" && task.src !== "sales" ? (
                          <button onClick={onFetchWb} disabled={wbLoading} className="text-left text-xs font-semibold text-orange-700 hover:underline disabled:opacity-60" title={wbLoading ? "Загрузка…" : "Обновить заказы из WB"}>
                            {wbLoading
                              ? `Загрузка ${wbProgress ? `${wbProgress.done}/${wbProgress.total}` : ""}…`
                              : `${task.label} ↻`}
                          </button>
                        ) : (
                          <span className="text-xs font-medium text-neutral-700">{task.label}</span>
                        )}
                      </div>
                    </th>
                    {dayList.map((d) => renderDay(task, d, "top"))}
                  </tr>
                  {twoRow && (
                    <tr>
                      {dayList.map((d) => renderDay(task, d, "cost"))}
                    </tr>
                  )}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>

      {bd && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setBd(null)} />
          <div className="rounded-2xl fixed z-50 border border-neutral-200 bg-white p-3 text-neutral-700 shadow-xl" style={{ left: bd.x, top: bd.y, minWidth: 280 }}>
            <div className="mb-1.5 flex items-center justify-between border-b border-neutral-100 pb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              <span>Строка</span>
              <span className="flex gap-4"><span className="w-20 text-right">Всего</span><span className="w-10 text-right">Доля</span></span>
            </div>
            {RNP_COST_TASKS.map((t) => {
              const tot = taskTotal(t);
              const share = allocated > 0 ? Math.round((tot / allocated) * 100) : 0;
              return (
                <div key={t.id} className="flex items-center justify-between gap-6 py-0.5 text-sm">
                  <span className="text-neutral-600">{t.label}</span>
                  <span className="flex gap-4" style={{ fontVariantNumeric: "tabular-nums" }}>
                    <span className="w-20 text-right font-medium text-neutral-800">{tot ? money(tot) : "—"}</span>
                    <span className="w-10 text-right text-neutral-400">{share}%</span>
                  </span>
                </div>
              );
            })}
            <div className="mt-1.5 flex items-center justify-between gap-6 border-t border-neutral-100 pt-1.5 text-sm font-bold">
              <span>Итого</span>
              <span className="flex gap-4" style={{ fontVariantNumeric: "tabular-nums" }}>
                <span className="w-20 text-right">{money(spent)}</span>
                <span className="w-10 text-right text-neutral-400">{allocated > 0 ? Math.round((spent / allocated) * 100) : 0}%</span>
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
function GanttPopup({ state, cells, entries, refSources = {}, onSetCell, onSetEntries, onClose }) {
  const { task, dateKey } = state;
  const isReviews = task.kind === "reviews";
  const entryKey = `${task.id}:${dateKey}`;
  const arr = entries[entryKey] || [];

  const fields = task.fields || [];
  const costFields = fields.filter((f) => f.type === "cost" || f.type === "condCost");
  const blankEntry = () => { const e = { id: uid(), done: false }; fields.forEach((f) => { e[f.id] = (f.type === "bool" || f.type === "condCost" || f.type === "condChoice") ? (f.type === "condChoice" ? "" : false) : ""; }); return e; };
  const addEntry = () => onSetEntries(entryKey, [...arr, blankEntry()]);
  const setField = (id, field, val) => onSetEntries(entryKey, arr.map((e) => (e.id === id ? { ...e, [field]: val } : e)));
  const removeEntry = (id) => onSetEntries(entryKey, arr.filter((e) => e.id !== id));
  const recordCost = (e) => calcRecordCost(fields, e);
  const totalCost = arr.reduce((a, e) => a + recordCost(e), 0);

  const optStyle = (sel, opt, choice) => {
    if (sel !== opt) return { background: "#fff", borderColor: "#e5e5e5", color: "#a3a3a3" };
    if (choice) return { background: "#ffedd5", borderColor: "#fdba74", color: "#c2410c" };
    if (opt === "да") return { background: "#f0fdf4", borderColor: "#86efac", color: "#15803d" };
    if (opt === "нет") return { background: "#fee2e2", borderColor: "#fca5a5", color: "#b91c1c" };
    return { background: "#e5e5e5", borderColor: "#d4d4d4", color: "#525252" };
  };

  const renderField = (e, f) => {
    if (f.type === "ref") {
      const rows = refSources[f.source] || [];
      const listId = `dl-${task.id}-${f.id}`;
      const picked = rows.find((r) => (r.name || "") === (e[f.id] || ""));
      const st = picked && BLOGGER_STATUSES.find((s) => s.value === picked.status);
      return (
        <div className="flex items-center gap-1.5">
          <input
            value={e[f.id] ?? ""}
            onChange={(ev) => setField(e.id, f.id, ev.target.value)}
            list={listId}
            placeholder={rows.length ? "Выберите из базы или введите" : f.label}
            className="rounded-lg w-full border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
          <datalist id={listId}>
            {rows.filter((r) => r.name).map((r) => (
              <option key={r.id} value={r.name}>{r.status || ""}</option>
            ))}
          </datalist>
          {st && (
            <span className="rounded-full shrink-0 px-2 py-0.5 text-xs font-medium" style={{ background: st.color + "1f", color: st.color }}>
              {st.value}
            </span>
          )}
        </div>
      );
    }
    if (f.type === "condCost") {
      const on = !!e[f.toggleId];
      return (
        <div className="flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={on} onChange={(ev) => setField(e.id, f.toggleId, ev.target.checked)} className="h-4 w-4 accent-orange-600" />
            {f.label}
          </label>
          {on && (
            <div className="flex items-center gap-2 pl-6">
              <span className="text-xs text-neutral-500">{f.amountLabel}</span>
              <input value={e[f.amountId] ?? ""} onChange={(ev) => setField(e.id, f.amountId, ev.target.value)} inputMode="decimal" placeholder="0 ₽" className="rounded-lg w-32 border border-neutral-200 px-2.5 py-1.5 text-right text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ fontVariantNumeric: "tabular-nums" }} />
            </div>
          )}
        </div>
      );
    }
    if (f.type === "condChoice") {
      const on = !!e[f.toggleId];
      return (
        <div className="flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={on} onChange={(ev) => setField(e.id, f.toggleId, ev.target.checked)} className="h-4 w-4 accent-orange-600" />
            {f.label}
          </label>
          {on && (
            <div className="flex flex-wrap gap-1 pl-6">
              {f.options.map((opt) => {
                const sel = e[f.valueId] === opt;
                const good = opt.includes("прошёл") && !opt.includes("не ");
                const bad = opt.includes("не прошёл");
                const style = !sel ? { background: "#fff", borderColor: "#e5e5e5", color: "#a3a3a3" }
                  : good ? { background: "#f0fdf4", borderColor: "#86efac", color: "#15803d" }
                  : bad ? { background: "#fee2e2", borderColor: "#fca5a5", color: "#b91c1c" }
                  : { background: "#e5e5e5", borderColor: "#d4d4d4", color: "#525252" };
                return (
                  <button key={opt} onClick={() => setField(e.id, f.valueId, sel ? "" : opt)} className="rounded-full border px-3 py-1 text-xs font-medium transition" style={style}>{opt}</button>
                );
              })}
            </div>
          )}
        </div>
      );
    }
    if (f.type === "text")
      return <input value={e[f.id] ?? ""} onChange={(ev) => setField(e.id, f.id, ev.target.value)} placeholder={f.label} className="rounded-lg w-full border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />;
    if (f.type === "link")
      return (
        <div className="flex items-center gap-1.5">
          <input value={e[f.id] ?? ""} onChange={(ev) => setField(e.id, f.id, ev.target.value)} placeholder="https://…" className="rounded-lg w-full border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
          {e[f.id] && <a href={e[f.id]} target="_blank" rel="noopener noreferrer" className="shrink-0 p-1.5 text-orange-600 hover:bg-orange-50" title="Открыть"><ArrowRight size={15} /></a>}
        </div>
      );
    if (f.type === "cost")
      return <input value={e[f.id] ?? ""} onChange={(ev) => setField(e.id, f.id, ev.target.value)} inputMode="decimal" placeholder="0 ₽" className="rounded-lg w-32 border border-neutral-200 px-2.5 py-1.5 text-right text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ fontVariantNumeric: "tabular-nums" }} />;
    if (f.type === "bool")
      return (
        <div className="flex gap-1">
          {["да", "нет"].map((opt) => (
            <button key={opt} onClick={() => setField(e.id, f.id, opt === "да")} className="rounded-full border px-3 py-1 text-xs font-medium transition" style={optStyle(e[f.id] ? "да" : "нет", opt, false)}>{opt}</button>
          ))}
        </div>
      );
    // triple / choice
    if (!Array.isArray(f.options)) return null;
    const choice = f.type === "choice";
    return (
      <div className="flex flex-wrap gap-1">
        {f.options.map((opt) => (
          <button key={opt} onClick={() => setField(e.id, f.id, e[f.id] === opt ? "" : opt)} className="rounded-full border px-3 py-1 text-xs font-medium transition" style={optStyle(e[f.id], opt, choice)}>{opt}</button>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-lg overflow-auto bg-white p-5 shadow-xl" style={{ maxHeight: zvh(85) }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">{task.label} · {dateKey.slice(8, 10)}.{dateKey.slice(5, 7)}</h2>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
        </div>

        {isReviews ? (
          <div className="flex items-end gap-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
              Кол-во отзывов
              <input value={cells[`reviews:cnt:${dateKey}`] ?? ""} onChange={(e) => onSetCell(`reviews:cnt:${dateKey}`, e.target.value)} inputMode="numeric" className="rounded-lg w-32 border border-neutral-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
              Звёзд (0–5)
              <input value={cells[`reviews:st:${dateKey}`] ?? ""} onChange={(e) => onSetCell(`reviews:st:${dateKey}`, e.target.value)} inputMode="decimal" className="rounded-lg w-32 border border-neutral-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
            </label>
          </div>
        ) : (
          <div className="space-y-2.5">
            {arr.map((e, i) => (
              <div key={e.id} className="border border-neutral-100 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={!!e.done} onChange={(ev) => setField(e.id, "done", ev.target.checked)} className="h-4 w-4 accent-green-600" title="Выполнено" />
                    <span className="text-xs font-semibold text-neutral-400">Запись {i + 1}{costFields.length > 1 ? ` · ${money(recordCost(e))}` : ""}</span>
                  </span>
                  <button onClick={() => removeEntry(e.id)} className="p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
                <div className="space-y-2">
                  {fields.map((f) => (
                    <div key={f.id} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 text-xs font-medium text-neutral-500">{f.label}</span>
                      <div className="flex-1">{renderField(e, f)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <button onClick={addEntry} className="rounded-lg inline-flex items-center gap-1 border border-dashed border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-500 hover:bg-neutral-50">
                <Plus size={14} /> Добавить запись
              </button>
              <span className="text-sm text-neutral-500">Итого затрат: <b className="text-neutral-800" style={{ fontVariantNumeric: "tabular-nums" }}>{money(totalCost)}</b></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* Окно-база: все записи задачи по товару в виде редактируемой таблицы */
function EntriesDB({ task, entries, startDate, refSources = {}, onSetEntries, onClose }) {
  const fields = task.fields || [];
  const costFields = fields.filter((f) => f.type === "cost" || f.type === "condCost");
  const isRange = task.kind === "rangeTask";
  const rangeKey = `${task.id}:_ranges`;

  // данные
  const rows = [];
  if (isRange) {
    (entries[rangeKey] || []).forEach((rec) => rows.push({ rec }));
  } else {
    Object.entries(entries).forEach(([k, arr]) => {
      if (k.startsWith(task.id + ":") && !k.endsWith(":_ranges")) {
        const date = k.slice(task.id.length + 1);
        (arr || []).forEach((rec) => rows.push({ date, rec }));
      }
    });
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  const arrAt = (date) => entries[`${task.id}:${date}`] || [];
  const rangeArr = () => entries[rangeKey] || [];

  const updateField = (date, recId, fieldId, val) => {
    if (isRange) {
      onSetEntries(rangeKey, rangeArr().map((r) => (r.id === recId ? { ...r, [fieldId]: val } : r)));
    } else {
      onSetEntries(`${task.id}:${date}`, arrAt(date).map((r) => (r.id === recId ? { ...r, [fieldId]: val } : r)));
    }
  };
  const deleteRec = (date, recId) => {
    if (isRange) {
      onSetEntries(rangeKey, rangeArr().filter((r) => r.id !== recId));
    } else {
      onSetEntries(`${task.id}:${date}`, arrAt(date).filter((r) => r.id !== recId));
    }
  };
  const changeDate = (oldDate, recId, newDate) => {
    if (isRange || !newDate || newDate === oldDate) return;
    const rec = arrAt(oldDate).find((r) => r.id === recId);
    if (!rec) return;
    onSetEntries(`${task.id}:${oldDate}`, arrAt(oldDate).filter((r) => r.id !== recId));
    onSetEntries(`${task.id}:${newDate}`, [...arrAt(newDate), rec]);
  };
  const addRec = () => {
    const e = { id: uid(), done: false };
    fields.forEach((f) => {
      if (f.type === "bool" || f.type === "condCost") e[f.id] = false;
      else if (f.type === "date") e[f.id] = startDate;
      else e[f.id] = "";
    });
    if (isRange) {
      onSetEntries(rangeKey, [...rangeArr(), e]);
    } else {
      onSetEntries(`${task.id}:${startDate}`, [...arrAt(startDate), e]);
    }
  };
  const recordCost = (e) => calcRecordCost(fields, e);
  const grandTotal = rows.reduce((a, r) => a + recordCost(r.rec), 0);

  const inp = "w-full  border border-neutral-200 bg-white px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-200";
  const segStyle = (sel, opt) => {
    if (!sel) return { background: "#fff", borderColor: "#e5e5e5", color: "#a3a3a3" };
    if (opt === "да") return { background: "#f0fdf4", borderColor: "#86efac", color: "#15803d" };
    if (opt === "нет") return { background: "#fee2e2", borderColor: "#fca5a5", color: "#b91c1c" };
    return { background: "#e5e5e5", borderColor: "#d4d4d4", color: "#525252" };
  };
  const cellEditor = (date, rec, f) => {
    const val = rec[f.id];
    const set = (v) => updateField(date, rec.id, f.id, v);
    if (f.type === "condCost") {
      const on = !!rec[f.toggleId];
      return (
        <div className="flex items-center gap-1.5">
          <label className="flex cursor-pointer items-center gap-1 text-xs text-neutral-600">
            <input type="checkbox" checked={on} onChange={(ev) => updateField(date, rec.id, f.toggleId, ev.target.checked)} className="h-3.5 w-3.5 accent-orange-600" />
            да
          </label>
          {on && (
            <input value={rec[f.amountId] ?? ""} onChange={(ev) => updateField(date, rec.id, f.amountId, ev.target.value)} inputMode="decimal" placeholder="₽" className={inp + " text-right"} style={{ fontVariantNumeric: "tabular-nums", width: 80 }} />
          )}
        </div>
      );
    }
    if (f.type === "condChoice") {
      const on = !!rec[f.toggleId];
      return (
        <div className="flex items-center gap-1">
          <input type="checkbox" checked={on} onChange={(ev) => updateField(date, rec.id, f.toggleId, ev.target.checked)} className="h-3.5 w-3.5 accent-orange-600" title="Оставит отзыв" />
          {on && (
            <select value={rec[f.valueId] || ""} onChange={(ev) => updateField(date, rec.id, f.valueId, ev.target.value)} className={inp}>
              <option value="">—</option>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
        </div>
      );
    }
    if (f.type === "ref") {
      const rows = refSources[f.source] || [];
      const listId = `dbdl-${task.id}-${f.id}`;
      return (
        <>
          <input value={val ?? ""} onChange={(e) => set(e.target.value)} list={listId} className={inp} />
          <datalist id={listId}>
            {rows.filter((r) => r.name).map((r) => (
              <option key={r.id} value={r.name}>{r.status || ""}</option>
            ))}
          </datalist>
        </>
      );
    }
    if (f.type === "bool")
      return (
        <div className="flex gap-1">
          {["да", "нет"].map((opt) => (
            <button key={opt} onClick={() => set(opt === "да")} className="rounded-full border px-2.5 py-0.5 text-xs font-medium transition" style={segStyle((val ? "да" : "нет") === opt, opt)}>{opt}</button>
          ))}
        </div>
      );
    if (f.type === "triple")
      return (
        <div className="flex flex-wrap gap-1">
          {f.options.map((opt) => (
            <button key={opt} onClick={() => set(val === opt ? "" : opt)} className="rounded-full border px-2.5 py-0.5 text-xs font-medium transition" style={segStyle(val === opt, opt)}>{opt}</button>
          ))}
        </div>
      );
    if (f.type === "choice")
      return <select value={val || ""} onChange={(e) => set(e.target.value)} className={inp}><option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
    if (f.type === "cost")
      return <input value={val ?? ""} onChange={(e) => set(e.target.value)} inputMode="decimal" className={inp + " text-right"} style={{ fontVariantNumeric: "tabular-nums" }} />;
    if (f.type === "date")
      return <input type="date" value={val ?? ""} onChange={(e) => set(e.target.value)} className={inp} />;
    if (f.type === "link")
      return (
        <div className="flex items-center gap-1">
          <input value={val ?? ""} onChange={(e) => set(e.target.value)} placeholder="https://…" className={inp} />
          {val && <a href={val} target="_blank" rel="noopener noreferrer" className="shrink-0 text-orange-600 hover:text-orange-800" title="Открыть"><ArrowRight size={13} /></a>}
        </div>
      );
    return <input value={val ?? ""} onChange={(e) => set(e.target.value)} className={inp} />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      <div className="rounded-2xl w-full overflow-auto bg-white p-5 shadow-xl" style={{ maxWidth: "min(1100px, 95vw)", maxHeight: zvh(88) }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">{task.label} — база записей</h2>
            <p className="text-sm text-neutral-400">{rows.length} записей{costFields.length > 0 ? ` · итого затрат ${money(grandTotal)}` : ""}</p>
          </div>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
        </div>

        <div className="rounded-lg overflow-auto border border-neutral-200">
          <table className="text-sm" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
            <thead>
              <tr>
                <th className="bg-neutral-50 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500" style={{ borderBottom: "1px solid #e5e5e5", width: 44 }}>✓</th>
                {!isRange && <th className="bg-neutral-50 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500" style={{ borderBottom: "1px solid #e5e5e5", minWidth: 130 }}>Дата</th>}
                {fields.map((f) => (
                  <th key={f.id} className="bg-neutral-50 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500" style={{ borderBottom: "1px solid #e5e5e5", minWidth: f.type === "text" || f.type === "link" || f.type === "ref" ? 170 : f.type === "triple" || f.type === "condChoice" ? 200 : f.type === "date" ? 140 : f.type === "bool" ? 118 : f.type === "condCost" ? 150 : 120 }}>{f.label}</th>
                ))}
                <th className="bg-neutral-50 px-2 py-2" style={{ borderBottom: "1px solid #e5e5e5", width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ date, rec }) => (
                <tr key={rec.id} className="group" style={{ background: rec.done ? "#f0fdf4" : "transparent" }}>
                  <td className="px-1 text-center" style={{ borderBottom: "1px solid #f5f5f5" }}>
                    <input type="checkbox" checked={!!rec.done} onChange={(e) => updateField(date, rec.id, "done", e.target.checked)} className="h-4 w-4 accent-green-600" />
                  </td>
                  {!isRange && (
                    <td className="px-2 py-1" style={{ borderBottom: "1px solid #f5f5f5" }}>
                      <input type="date" value={date} onChange={(e) => changeDate(date, rec.id, e.target.value)} className={inp} />
                    </td>
                  )}
                  {fields.map((f) => (
                    <td key={f.id} className="px-2 py-1" style={{ borderBottom: "1px solid #f5f5f5" }}>{cellEditor(date, rec, f)}</td>
                  ))}
                  <td className="px-1 text-center" style={{ borderBottom: "1px solid #f5f5f5" }}>
                    <button onClick={() => deleteRec(date, rec.id)} className="p-1 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={fields.length + (isRange ? 2 : 3)} className="px-3 py-8 text-center text-sm text-neutral-400">Записей пока нет</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3">
          <button onClick={addRec} className="rounded-lg inline-flex items-center gap-1.5 border border-dashed border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-500 hover:bg-neutral-50">
            <Plus size={14} /> Добавить запись
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Справочная база (Блогеры / Раздачницы)
---------------------------------------------------------------------------- */

function RefDB({ embedded, title, typeId, fields, rows, setRows, types = [], activeId, onSelect, onAddType, onRemoveType, extraCols = [], setExtraCols, usage, onCreateTask, onClose }) {
  const fileRef = useRef(null);
  const csvRef = useRef(null);
  const target = useRef(null);
  const ymd = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : "");
  const money = (n) => Math.round(n).toLocaleString("ru-RU") + " ₽";
  // колонки: базовые + свои
  const allFields = useMemo(() => [...fields, ...(extraCols || []).map((c) => ({ id: c.id, label: c.label, type: c.type, custom: true, options: c.type === "select" ? (c.options || []).map((v, i) => ({ value: v, color: ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#0ea5e9", "#a3a3a3"][i % 6] })) : undefined }))], [fields, extraCols]);
  const [hidden, setHidden] = useState(() => lsGet("rnp.dbHidden." + typeId, []));
  useEffect(() => lsSet("rnp.dbHidden." + typeId, hidden), [hidden]); // eslint-disable-line
  const vis = allFields.filter((f) => f.id === "image" || f.id === "name" || !hidden.includes(f.id));
  const statusField = fields.find((f) => f.type === "select");
  const starsField = fields.find((f) => f.type === "stars");
  const nameField = fields.find((f) => f.id === "name");
  const [q, setQ] = useState("");
  const [stSel, setStSel] = useState([]);
  const [minStar, setMinStar] = useState(0);
  const [sort, setSort] = useState({ id: null, dir: 1 });
  const [sel, setSel] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [trashView, setTrashView] = useState(false);
  const [menu, setMenu] = useState(null); // status | rating | cols | addcol | bulkstatus
  const [msg, setMsg] = useState("");
  const [newCol, setNewCol] = useState({ label: "", type: "text", options: "" });
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3200); };

  const live = rows.filter((r) => !r.deletedAt);
  const trashed = rows.filter((r) => r.deletedAt);
  const add = () => {
    const r = { id: uid() };
    fields.forEach((f) => { if (f.type === "calc") return; r[f.id] = f.type === "select" ? (f.options[0]?.value ?? "") : ""; });
    setRows((prev) => [r, ...prev]); setQ(""); setStSel([]); setMinStar(0); setSort({ id: null, dir: 1 }); setOpenId(r.id);
  };
  const set = (id, field, val) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  const toTrash = (ids) => { const t = new Date().toISOString(); setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, deletedAt: t } : r))); setSel((s) => s.filter((x) => !ids.includes(x))); if (ids.includes(openId)) setOpenId(null); flash(ids.length === 1 ? "Запись перемещена в корзину" : "В корзину перемещено: " + ids.length); };
  const restore = (id) => setRows((prev) => prev.map((r) => { if (r.id !== id) return r; const { deletedAt, ...rest } = r; return rest; }));
  const purge = (ids) => setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
  // автоочистка корзины старше 30 дней
  useEffect(() => { const lim = Date.now() - 30 * 86400000; const old = rows.filter((r) => r.deletedAt && new Date(r.deletedAt).getTime() < lim).map((r) => r.id); if (old.length) purge(old); }, []); // eslint-disable-line

  const pickImage = (id) => { target.current = id; fileRef.current?.click(); };
  const onFile = async (e) => {
    const f = e.target.files?.[0]; const id = target.current; e.target.value = "";
    if (!f || !id) return;
    try { set(id, "image", await fileToThumb(f, 96)); } catch (err) { console.error("[Фото] не удалось обработать:", err); }
  };

  const valOf = (r, f) => f.type === "calc" ? (f.fn(r) || 0) : f.type === "stars" || f.type === "num" ? (toNum(r[f.id]) || 0) : String(r[f.id] ?? "").toLowerCase();
  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let out = live.filter((r) => {
      if (qq && !allFields.some((f) => f.type !== "image" && f.type !== "calc" && String(r[f.id] ?? "").toLowerCase().includes(qq)) && !String(r.notes || "").toLowerCase().includes(qq)) return false;
      if (statusField && stSel.length && !stSel.includes(r[statusField.id])) return false;
      if (starsField && minStar && (toNum(r[starsField.id]) || 0) < minStar) return false;
      return true;
    });
    if (sort.id) { const f = allFields.find((x) => x.id === sort.id); if (f) out = out.slice().sort((a, b) => { const x = valOf(a, f), y = valOf(b, f); return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "ru")) * sort.dir; }); }
    return out;
  }, [rows, q, stSel, minStar, sort, allFields]); // eslint-disable-line
  const clickSort = (id) => setSort((s) => s.id !== id ? { id, dir: 1 } : s.dir === 1 ? { id, dir: -1 } : { id: null, dir: 1 });
  const allSel = list.length > 0 && list.every((r) => sel.includes(r.id));

  // ---- CSV ----
  const csvEsc = (v) => { const s = String(v == null ? "" : v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const exportCsv = () => {
    const cols = vis.filter((f) => f.type !== "image");
    const lines = [cols.map((f) => csvEsc(f.label)).join(";")];
    list.forEach((r) => lines.push(cols.map((f) => csvEsc(f.type === "calc" ? f.fn(r) : r[f.id])).join(";")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (title || "база") + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const parseCsv = (text) => {
    const t = text.replace(/^﻿/, ""); const delim = (t.split("\n")[0].match(/;/g) || []).length >= (t.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
    const out = []; let row = [], cur = "", inq = false;
    for (let i = 0; i < t.length; i++) { const c = t[i];
      if (inq) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += c; }
      else if (c === '"') inq = true; else if (c === delim) { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur.replace(/\r$/, "")); out.push(row); row = []; cur = ""; } else cur += c; }
    if (cur !== "" || row.length) { row.push(cur.replace(/\r$/, "")); out.push(row); }
    return out.filter((r) => r.some((x) => String(x).trim()));
  };
  const onCsv = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    try {
      const data = parseCsv(await f.text()); if (data.length < 2) { flash("В файле нет строк для импорта"); return; }
      const head = data[0].map((h) => String(h).trim().toLowerCase());
      const map = allFields.map((fl) => ({ fl, i: head.indexOf(String(fl.label).toLowerCase()) })).filter((m) => m.i >= 0 && m.fl.type !== "image" && m.fl.type !== "calc");
      if (!map.length) { flash("Названия колонок не совпали. Скачайте экспорт и используйте его как образец"); return; }
      const names = new Set(live.map((r) => String(r.name || "").trim().toLowerCase()));
      const add2 = []; let dup = 0;
      data.slice(1).forEach((cells) => {
        const r = { id: uid() };
        fields.forEach((fl) => { if (fl.type === "select") r[fl.id] = fl.options[0]?.value ?? ""; });
        map.forEach(({ fl, i }) => { let v = String(cells[i] ?? "").trim(); if (fl.type === "select" && !fl.options.some((o) => o.value === v)) v = fl.options[0]?.value ?? ""; r[fl.id] = v; });
        const nm = String(r.name || "").trim().toLowerCase();
        if (nameField && nm && names.has(nm)) { dup++; return; }
        if (nm) names.add(nm); add2.push(r);
      });
      setRows((prev) => [...add2, ...prev]); flash("Импортировано: " + add2.length + (dup ? ", пропущено дублей: " + dup : ""));
    } catch (err) { flash("Не удалось прочитать файл"); }
  };

  const inp = "w-full rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200";
  const Menu = ({ id, label, active, width = 230, children }) => (
    <div className="relative">
      <button onClick={() => setMenu(menu === id ? null : id)} className={"inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition " + (active ? "border-orange-300 bg-orange-50 text-orange-700" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50")}>{label}<ChevronDown size={13} className="opacity-60" /></button>
      {menu === id && (<><div className="fixed inset-0 z-10" onClick={() => setMenu(null)} /><div className="absolute left-0 z-20 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl" style={{ width }}>{children}</div></>)}
    </div>
  );
  const Opt = ({ on, onClick, children }) => (
    <button onClick={onClick} className={"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-neutral-50 " + (on ? "font-semibold text-neutral-900" : "text-neutral-600")}>
      <span className={"flex h-4 w-4 shrink-0 items-center justify-center rounded border " + (on ? "border-orange-500 bg-orange-500 text-white" : "border-neutral-300")}>{on && <Check size={11} strokeWidth={3.4} />}</span><span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
  const selOpt = (f, r) => (f.options || []).find((o) => o.value === r[f.id]) || (f.options || [])[0];
  const cell = (r, f) => {
    if (f.type === "image") return <button onClick={() => pickImage(r.id)} className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-neutral-200 bg-neutral-50 text-neutral-400 hover:border-neutral-300">{r.image ? <img src={r.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={14} />}</button>;
    if (f.type === "stars") return <div className="flex gap-0.5">{[1, 2, 3, 4, 5].map((star) => <button key={star} onClick={() => set(r.id, f.id, (toNum(r[f.id]) === star ? 0 : star).toString())} className="text-lg leading-none transition" style={{ color: star <= (toNum(r[f.id]) || 0) ? "#f59e0b" : "#e5e5e5" }}>★</button>)}</div>;
    if (f.type === "link") return <div className="flex items-center gap-1"><input value={r[f.id] ?? ""} onChange={(e) => set(r.id, f.id, e.target.value)} placeholder="https://…" className={inp} />{r[f.id] && <a href={r[f.id]} target="_blank" rel="noopener noreferrer" className="shrink-0 text-orange-600 hover:text-orange-800"><ArrowRight size={13} /></a>}</div>;
    if (f.type === "select") { const opt = selOpt(f, r); return <select value={r[f.id] ?? ""} onChange={(e) => set(r.id, f.id, e.target.value)} className="w-full cursor-pointer rounded-lg border-0 px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ background: (opt?.color || "#a3a3a3") + "1f", color: opt?.color || "#a3a3a3" }}>{(f.options || []).map((o) => <option key={o.value} value={o.value} style={{ color: "#171717" }}>{o.value}</option>)}</select>; }
    if (f.type === "calc") return <div className="px-1.5 py-1 text-right text-sm font-semibold text-neutral-700" style={{ fontVariantNumeric: "tabular-nums" }}>{f.fn(r) || <span className="font-normal text-neutral-300">0</span>}</div>;
    if (f.type === "num") return <input value={r[f.id] ?? ""} onChange={(e) => set(r.id, f.id, e.target.value)} inputMode="decimal" className={inp + " text-right"} style={{ fontVariantNumeric: "tabular-nums" }} />;
    if (f.type === "date") return <input type="date" value={r[f.id] ?? ""} onChange={(e) => set(r.id, f.id, e.target.value)} className={inp} />;
    return <input value={r[f.id] ?? ""} onChange={(e) => set(r.id, f.id, e.target.value)} className={inp} />;
  };
  const colW = (f) => f.type === "image" ? 64 : f.type === "link" ? 190 : f.type === "stars" ? 120 : f.type === "select" ? 130 : f.type === "calc" ? 110 : f.type === "date" ? 140 : 150;
  const addCol = () => { const label = newCol.label.trim(); if (!label || !setExtraCols) return; const c = { id: "x_" + uid().slice(0, 8), label, type: newCol.type }; if (newCol.type === "select") c.options = newCol.options.split(",").map((s) => s.trim()).filter(Boolean); if (newCol.type === "select" && !c.options.length) c.options = ["да", "нет"]; setExtraCols([...(extraCols || []), c]); setNewCol({ label: "", type: "text", options: "" }); setMenu(null); };
  const delCol = (id) => { if (!window.confirm("Удалить колонку? Значения в ней пропадут из таблицы.")) return; setExtraCols((extraCols || []).filter((c) => c.id !== id)); };

  // ---- карточка записи ----
  const openRow = openId ? rows.find((r) => r.id === openId) : null;
  const use = openRow && usage ? usage(openRow) : null;
  const useTotal = use ? use.reduce((s, u) => s + u.cost, 0) : 0;
  const card = openRow && (
    <div className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-white">
      <div className="flex items-center gap-3 border-b border-neutral-100 p-4">
        <button onClick={() => pickImage(openRow.id)} className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-neutral-200 bg-neutral-50 text-neutral-400">{openRow.image ? <img src={openRow.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={16} />}</button>
        <div className="min-w-0 flex-1"><input value={openRow.name ?? ""} onChange={(e) => set(openRow.id, "name", e.target.value)} placeholder="Название" className="w-full border-0 bg-transparent p-0 text-base font-extrabold text-neutral-900 outline-none placeholder:text-neutral-300" />{starsField && cell(openRow, starsField)}</div>
        <button onClick={() => setOpenId(null)} className="self-start rounded-lg p-1 text-neutral-400 hover:bg-neutral-100"><X size={16} /></button>
      </div>
      {use && (
        <div className="grid grid-cols-3 gap-2 p-4 pb-2">
          {[[use.length, "интеграций"], [money(useTotal), "потрачено всего"], [use.length ? money(useTotal / use.length) : "—", "средняя цена"]].map(([v, l], i) => <div key={i} className="rounded-xl border border-neutral-100 bg-neutral-50 px-2.5 py-2"><b className="block text-[15px] font-extrabold leading-tight">{v}</b><span className="text-[10.5px] text-neutral-400">{l}</span></div>)}
        </div>
      )}
      <div className="px-4 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">Данные</div>
      <div className="flex flex-col gap-1.5 px-4 pb-2">
        {allFields.filter((f) => f.id !== "image" && f.id !== "name" && f.type !== "stars" && f.type !== "calc").map((f) => <label key={f.id} className="flex items-center gap-2"><span className="w-[92px] shrink-0 text-xs text-neutral-400">{f.label}</span><div className="min-w-0 flex-1">{cell(openRow, f)}</div></label>)}
        <label className="flex items-center gap-2"><span className="w-[92px] shrink-0 text-xs text-neutral-400">Посл. контакт</span><div className="min-w-0 flex-1"><input type="date" value={openRow.lastContact || ""} onChange={(e) => set(openRow.id, "lastContact", e.target.value)} className={inp} /></div></label>
      </div>
      {use && (<>
        <div className="px-4 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">Интеграции (из РНП товаров)</div>
        {use.length === 0 && <div className="px-4 pb-3 text-xs text-neutral-400">Пока нет записей в РНП</div>}
        {use.map((u) => <div key={u.id} className="flex items-center gap-2.5 border-t border-neutral-50 px-4 py-1.5"><span className="flex h-[34px] w-[26px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-neutral-50">{u.image ? <img src={u.image} alt="" className="h-full w-full object-cover" /> : null}</span><div className="min-w-0 flex-1 text-[13px] font-semibold leading-tight">{u.name}<span className="block text-[11px] font-normal text-neutral-400">{u.code} · {ymd(u.date) || "без даты"}</span></div><b className="text-[13px]">{money(u.cost)}</b></div>)}
      </>)}
      <div className="px-4 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">Заметки</div>
      <textarea value={openRow.notes || ""} onChange={(e) => set(openRow.id, "notes", e.target.value)} rows={4} placeholder="Условия, договорённости, что заходит лучше…" className="mx-4 mb-3 rounded-xl border border-neutral-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-200" />
      <div className="mt-auto flex gap-2 border-t border-neutral-100 p-4">
        {onCreateTask && <button onClick={() => { onCreateTask("Связаться: " + (openRow.name || "без названия")); flash("Задача создана"); }} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-neutral-800"><Plus size={13} />Задача</button>}
        <button onClick={() => toTrash([openRow.id])} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-bold text-neutral-600 hover:bg-neutral-50">В корзину</button>
      </div>
    </div>
  );

  return (
    <div className={embedded ? "" : "fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-3 sm:p-6"} onClick={embedded ? undefined : onClose}>
      <div className={"flex w-full overflow-hidden bg-white " + (embedded ? "rounded-2xl border border-neutral-200" : "h-full rounded-2xl shadow-2xl")} style={embedded ? { height: `calc(${zvh(100)} - 150px)`, minHeight: 480 } : { maxWidth: 1360, maxHeight: "94vh" }} onClick={(e) => e.stopPropagation()}>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onCsv} />
        <div className="hidden w-[200px] shrink-0 flex-col border-r border-neutral-100 bg-neutral-50 p-3 md:flex">
          <div className="px-2 pb-2 text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">Виды базы</div>
          {types.map((t) => (
            <div key={t.id} className={"group/t mb-0.5 flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-semibold transition " + (activeId === t.id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:bg-white/70")}>
              <button onClick={() => onSelect && onSelect(t.id)} className="min-w-0 flex-1 truncate text-left">{t.name}</button>
              <span className="text-[11px] font-bold text-neutral-400">{t.count}</span>
              {t.custom && activeId === t.id && <button onClick={() => onRemoveType && onRemoveType(t.id)} className="rounded p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить вид"><X size={12} /></button>}
            </div>
          ))}
          <button onClick={() => onAddType && onAddType()} className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-2.5 py-2 text-sm font-semibold text-neutral-400 hover:text-neutral-700"><Plus size={13} />Новый вид</button>
          <div className="mt-auto border-t border-neutral-200 pt-2">
            <button onClick={() => { setTrashView((v) => !v); setSel([]); }} className={"flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold " + (trashView ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:bg-white/70")}><Trash2 size={14} />Корзина<span className="ml-auto text-[11px] font-bold text-neutral-400">{trashed.length}</span></button>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-3">
            <h2 className="mr-1 text-[17px] font-extrabold tracking-tight text-neutral-900">{trashView ? "Корзина · " + title : title}</h2>
            <span className="text-xs text-neutral-400">{trashView ? trashed.length : list.length + (list.length !== live.length ? " из " + live.length : "")} записей</span>
            {!trashView && (<>
              <div className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5"><Search size={13} className="text-neutral-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск" className="w-36 border-0 bg-transparent p-0 text-xs outline-none placeholder:text-neutral-400" />{q && <button onClick={() => setQ("")} className="text-neutral-300 hover:text-neutral-600"><X size={12} /></button>}</div>
              {statusField && <Menu id="status" label={stSel.length ? statusField.label + ": " + stSel.length : statusField.label} active={stSel.length > 0}>{statusField.options.map((o) => <Opt key={o.value} on={stSel.includes(o.value)} onClick={() => setStSel(stSel.includes(o.value) ? stSel.filter((x) => x !== o.value) : [...stSel, o.value])}><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: o.color }} />{o.value}</Opt>)}{stSel.length > 0 && <button onClick={() => setStSel([])} className="mt-1 w-full border-t border-neutral-100 px-2.5 pt-2 text-left text-xs font-semibold text-neutral-400 hover:text-neutral-700">Сбросить</button>}</Menu>}
              {starsField && <Menu id="rating" label={minStar ? "Рейтинг от " + minStar : "Рейтинг"} active={minStar > 0} width={170}>{[0, 1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => { setMinStar(n); setMenu(null); }} className={"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-neutral-50 " + (minStar === n ? "font-semibold text-neutral-900" : "text-neutral-600")}>{n === 0 ? "Любой" : <span className="text-amber-500">{"★".repeat(n)}<span className="text-neutral-300">{"★".repeat(5 - n)}</span></span>}</button>)}</Menu>}
              <Menu id="cols" label="Колонки" active={hidden.length > 0} width={250}>
                {allFields.filter((f) => f.id !== "image" && f.id !== "name").map((f) => <div key={f.id} className="flex items-center"><div className="min-w-0 flex-1"><Opt on={!hidden.includes(f.id)} onClick={() => setHidden(hidden.includes(f.id) ? hidden.filter((x) => x !== f.id) : [...hidden, f.id])}>{f.label}</Opt></div>{f.custom && <button onClick={() => delCol(f.id)} className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить колонку"><Trash2 size={12} /></button>}</div>)}
              </Menu>
            </>)}
            <span className="flex-1" />
            {!trashView && (<>
              <button onClick={() => csvRef.current && csvRef.current.click()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><Download size={13} className="rotate-180" />Импорт</button>
              <button onClick={exportCsv} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><Download size={13} />Экспорт</button>
              <button onClick={add} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-xs font-bold text-white hover:bg-neutral-800"><Plus size={13} />Запись</button>
            </>)}
            {!embedded && <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><X size={18} /></button>}
          </div>
          {msg && <div className="mx-4 mt-3 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white">{msg}</div>}
          {!trashView && sel.length > 0 && (
            <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-neutral-900 px-3.5 py-2 text-xs font-bold text-white">
              <span>Выбрано {sel.length}</span>
              {statusField && <div className="relative"><button onClick={() => setMenu(menu === "bulkstatus" ? null : "bulkstatus")} className="text-amber-300 hover:underline">Сменить статус</button>
                {menu === "bulkstatus" && (<><div className="fixed inset-0 z-10" onClick={() => setMenu(null)} /><div className="absolute left-0 top-full z-20 mt-2 w-44 rounded-xl border border-neutral-200 bg-white p-1.5 text-neutral-700 shadow-xl">{statusField.options.map((o) => <button key={o.value} onClick={() => { setRows((prev) => prev.map((r) => (sel.includes(r.id) ? { ...r, [statusField.id]: o.value } : r))); setMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold hover:bg-neutral-50"><span className="h-2 w-2 rounded-full" style={{ background: o.color }} />{o.value}</button>)}</div></>)}</div>}
              <button onClick={() => toTrash(sel)} className="text-red-300 hover:underline">В корзину</button>
              <button onClick={() => setSel([])} className="ml-auto text-neutral-400 hover:text-white">Снять выбор</button>
            </div>
          )}
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-auto">
              {trashView ? (
                <div>
                  {trashed.length === 0 && <div className="px-6 py-16 text-center text-sm text-neutral-400">Корзина пуста</div>}
                  {trashed.map((r) => { const dl = Math.max(0, 30 - Math.floor((Date.now() - new Date(r.deletedAt).getTime()) / 86400000)); return (
                    <div key={r.id} className="flex items-center gap-3 border-b border-neutral-50 px-4 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-neutral-200 bg-neutral-50 text-neutral-300">{r.image ? <img src={r.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={14} />}</span>
                      <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-neutral-500 line-through decoration-neutral-300">{r.name || "Без названия"}</div><div className={"text-[11.5px] font-semibold " + (dl <= 3 ? "text-rose-500" : "text-amber-600")}>осталось {dl} дн.</div></div>
                      <button onClick={() => restore(r.id)} className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700">Вернуть</button>
                      <button onClick={() => { if (window.confirm("Удалить навсегда? Вернуть будет нельзя.")) purge([r.id]); }} className="rounded-lg border border-rose-200 p-1.5 text-rose-500 hover:bg-rose-50" title="Удалить навсегда"><X size={13} /></button>
                    </div>
                  ); })}
                </div>
              ) : (
                <table className="text-sm" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-[5] w-8 border-b border-neutral-200 bg-white px-2 py-2"><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? [] : list.map((r) => r.id))} className="h-4 w-4 accent-orange-500" /></th>
                      {vis.map((f) => (
                        <th key={f.id} onClick={() => f.type !== "image" && clickSort(f.id)} className={"sticky top-0 z-[5] border-b border-neutral-200 bg-white px-2 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider " + (f.type !== "image" ? "cursor-pointer select-none hover:text-neutral-800 " : "") + (sort.id === f.id ? "text-neutral-900" : "text-neutral-400")} style={{ minWidth: colW(f) }}>{f.label}{sort.id === f.id ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</th>
                      ))}
                      <th className="sticky top-0 z-[5] border-b border-neutral-200 bg-white px-2 py-2 text-left">
                        <div className="relative inline-block"><button onClick={() => setMenu(menu === "addcol" ? null : "addcol")} className="whitespace-nowrap rounded-md border border-dashed border-neutral-300 px-2 py-0.5 text-[11px] font-bold text-neutral-400 hover:text-neutral-700">＋ колонка</button>
                          {menu === "addcol" && (<><div className="fixed inset-0 z-10" onClick={() => setMenu(null)} /><div className="absolute right-0 top-full z-20 mt-1.5 w-64 rounded-xl border border-neutral-200 bg-white p-3 text-left normal-case tracking-normal shadow-xl">
                            <div className="mb-1.5 text-xs font-bold text-neutral-700">Новая колонка</div>
                            <input value={newCol.label} onChange={(e) => setNewCol({ ...newCol, label: e.target.value })} placeholder="Название" className={inp + " mb-2"} />
                            <select value={newCol.type} onChange={(e) => setNewCol({ ...newCol, type: e.target.value })} className={inp + " mb-2"}>{[["text", "Текст"], ["num", "Число"], ["link", "Ссылка"], ["date", "Дата"], ["select", "Список"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                            {newCol.type === "select" && <input value={newCol.options} onChange={(e) => setNewCol({ ...newCol, options: e.target.value })} placeholder="Варианты через запятую" className={inp + " mb-2"} />}
                            <button onClick={addCol} disabled={!newCol.label.trim()} className="w-full rounded-lg bg-neutral-900 py-1.5 text-xs font-bold text-white disabled:opacity-40">Добавить</button>
                          </div></>)}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id} className={"group " + (openId === r.id ? "bg-orange-50/60" : sel.includes(r.id) ? "bg-orange-50/40" : "hover:bg-neutral-50/60")}>
                        <td className="px-2 py-1.5" style={{ borderBottom: "1px solid #f5f5f5" }}><input type="checkbox" checked={sel.includes(r.id)} onChange={() => setSel(sel.includes(r.id) ? sel.filter((x) => x !== r.id) : [...sel, r.id])} className="h-4 w-4 accent-orange-500" /></td>
                        {vis.map((f) => <td key={f.id} className="px-2 py-1.5" style={{ borderBottom: "1px solid #f5f5f5" }}>{f.id === "name" ? <div className="flex items-center gap-1">{cell(r, f)}<button onClick={() => setOpenId(openId === r.id ? null : r.id)} title="Открыть карточку" className="shrink-0 rounded-md p-1 text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700"><Maximize2 size={13} /></button></div> : cell(r, f)}</td>)}
                        <td className="px-1 text-center" style={{ borderBottom: "1px solid #f5f5f5" }}><button onClick={() => toTrash([r.id])} title="В корзину" className="rounded-md p-1 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"><Trash2 size={14} /></button></td>
                      </tr>
                    ))}
                    {list.length === 0 && <tr><td colSpan={vis.length + 2} className="px-3 py-12 text-center text-sm text-neutral-400">{live.length ? "Под фильтры ничего не подходит" : "Пока нет записей — нажмите «Запись»"}</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
            {!trashView && card}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Ячейка-инпут
---------------------------------------------------------------------------- */

function CellInput({ value, onChange, placeholder, mono }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full truncate bg-transparent px-2 py-1 text-neutral-800 placeholder:text-neutral-300 focus:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-400"
      style={mono ? { fontVariantNumeric: "tabular-nums" } : undefined}
    />
  );
}

/* ----------------------------------------------------------------------------
   Окно «Задачи по карточке» — чек-лист задач конкретного товара
---------------------------------------------------------------------------- */

function LabelSelect({ labels, value, onChange, compact }) {
  const cur = (labels || []).find((l) => l.id === value);
  // Компактный вид: только цветная точка (акцент на тексте задачи).
  // Нативный список меток открывается прозрачным <select> поверх точки.
  if (compact) {
    return (
      <div className="relative shrink-0" title={cur ? cur.name : "Без метки"}>
        <span className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-neutral-100">
          <span className="h-3 w-3 rounded-full" style={cur ? { background: cur.color } : { background: "#fff", boxShadow: "inset 0 0 0 1.5px #d4d4d4" }} />
        </span>
        <select value={value || ""} onChange={(e) => onChange(e.target.value || null)} className="absolute inset-0 cursor-pointer opacity-0">
          <option value="">Без метки</option>
          {(labels || []).map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
        </select>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cur ? cur.color : "#e5e5e5" }} />
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-xs text-neutral-600 focus:border-neutral-400 focus:outline-none"
        title={cur ? cur.name : "Метка"}
      >
        <option value="">Без метки</option>
        {(labels || []).map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
    </div>
  );
}

/* --- Конкуренты (карточки ВБ) --- */
const wbNmFromUrl = (url) => {
  if (!url) return null;
  const s = String(url);
  const m = s.match(/catalog\/(\d+)/) || s.match(/(\d{5,})/);
  return m ? m[1] : null;
};
const wbBasketHost = (vol) => {
  const ranges = [
    [143, 1], [287, 2], [431, 3], [719, 4], [1007, 5], [1061, 6], [1115, 7], [1169, 8], [1313, 9], [1601, 10],
    [1655, 11], [1919, 12], [2045, 13], [2189, 14], [2405, 15], [2621, 16], [2837, 17], [3053, 18], [3269, 19], [3485, 20],
    [3701, 21], [3917, 22], [4133, 23], [4349, 24], [4565, 25], [4877, 26], [5193, 27], [5509, 28], [5825, 29], [6141, 30],
    [6457, 31], [6773, 32], [7089, 33], [7405, 34], [7721, 35], [8037, 36], [8353, 37], [8669, 38], [8985, 39], [9301, 40],
  ];
  for (const [max, host] of ranges) if (vol <= max) return host;
  return 41;
};
// Список кандидатов URL картинки: начинаем с вычисленной корзины, затем перебираем остальные
const wbImageCandidates = (nm) => {
  const id = parseInt(nm, 10);
  if (!id) return [];
  const vol = Math.floor(id / 100000);
  const part = Math.floor(id / 1000);
  const guess = wbBasketHost(vol);
  const order = [guess];
  for (let i = 1; i <= 45; i++) if (i !== guess) order.push(i);
  return order.map((h) => `https://basket-${String(h).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${id}/images/big/1.webp`);
};

function CompetitorThumb({ url, onRemove }) {
  const nm = wbNmFromUrl(url);
  const cands = nm ? wbImageCandidates(nm) : [];
  const [i, setI] = useState(0);
  const [failed, setFailed] = useState(false);
  const src = cands[i];
  return (
    <div className="group relative">
      <a href={url} target="_blank" rel="noreferrer" className="block aspect-[3/4] overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50" title={url}>
        {src && !failed ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setI((x) => { if (x + 1 < cands.length) return x + 1; setFailed(true); return x; })}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-1 text-center text-[11px] text-neutral-400">нет превью</div>
        )}
      </a>
      <button onClick={onRemove} className="rounded-md absolute right-1 top-1 bg-white/90 p-0.5 text-neutral-400 opacity-0 shadow transition hover:text-red-500 group-hover:opacity-100" title="Удалить"><X size={14} /></button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Сезонность: чтение xlsx прямо в браузере (без внешних зависимостей)
---------------------------------------------------------------------------- */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const ab = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}
async function readZip(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error("Файл не распознан как xlsx.");
  const cnt = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = {};
  for (let n = 0; n < cnt; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    entries[name] = { method, compSize, lho };
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = async (name) => {
    const e = entries[name]; if (!e) return null;
    const lh = e.lho;
    const nl = dv.getUint16(lh + 26, true);
    const el = dv.getUint16(lh + 28, true);
    const start = lh + 30 + nl + el;
    const comp = u8.subarray(start, start + e.compSize);
    const raw = e.method === 0 ? comp : await inflateRaw(comp);
    return new TextDecoder().decode(raw);
  };
  return { entries, read };
}
const decodeXml = (s) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const colIndex = (ref) => { const m = ref.match(/^[A-Z]+/); let n = 0; for (const ch of m[0]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const serialToISO = (n) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);

// Чтение первого листа xlsx → массив строк [{rnum, cells}]
async function readSheetRows(arrayBuffer) {
  const zip = await readZip(arrayBuffer);
  // общие строки
  const ssXml = await zip.read("xl/sharedStrings.xml");
  const shared = [];
  if (ssXml) {
    const siRe = /<si>([\s\S]*?)<\/si>/g; let m;
    while ((m = siRe.exec(ssXml))) {
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g; let tm, s = "";
      while ((tm = tRe.exec(m[1]))) s += tm[1];
      shared.push(decodeXml(s));
    }
  }
  // первый лист книги
  const wbXml = await zip.read("xl/workbook.xml");
  const relsXml = await zip.read("xl/_rels/workbook.xml.rels");
  let sheetPath = "xl/worksheets/sheet1.xml";
  try {
    const firstId = (wbXml.match(/<sheet[^>]*r:id="([^"]+)"/) || [])[1];
    const rel = relsXml.match(new RegExp(`Id="${firstId}"[^>]*Target="([^"]+)"`)) || relsXml.match(new RegExp(`Target="([^"]+)"[^>]*Id="${firstId}"`));
    if (rel) sheetPath = "xl/" + rel[1].replace(/^\//, "").replace(/^xl\//, "");
  } catch {}
  const sheetXml = await zip.read(sheetPath) || await zip.read("xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("Не найден лист с данными.");

  const cellVal = (attrs, body) => {
    const t = (attrs.match(/t="([^"]+)"/) || [])[1];
    const vm = body.match(/<v>([\s\S]*?)<\/v>/);
    if (t === "s") return shared[parseInt((vm || [])[1], 10)] ?? "";
    if (t === "inlineStr" || t === "str") { const im = body.match(/<t[^>]*>([\s\S]*?)<\/t>/); return im ? decodeXml(im[1]) : ((vm && vm[1]) || ""); }
    return vm ? vm[1] : "";
  };
  const rows = [];
  const rowRe = /<row[^>]*\sr="(\d+)"[^>]*>([\s\S]*?)<\/row>/g; let rm;
  while ((rm = rowRe.exec(sheetXml))) {
    const rnum = parseInt(rm[1], 10);
    const cells = {};
    const cRe = /<c\s+r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g; let cm;
    while ((cm = cRe.exec(rm[2]))) cells[colIndex(cm[1])] = cellVal(cm[2], cm[3]);
    rows.push({ rnum, cells });
  }
  return rows;
}

// Парсинг таблицы комиссий ВБ → [{name, commission, category}] (комиссия из колонки «Склад WB (FBW), %»)
async function parseCommissionsXlsx(arrayBuffer) {
  const rows = await readSheetRows(arrayBuffer);
  if (!rows.length) throw new Error("Лист пуст.");
  const header = rows[0].cells;
  const norm = (s) => String(s || "").toLowerCase().replace(/\s|\n/g, "");
  let colSubj = -1, colFbw = -1;
  for (const [k, v] of Object.entries(header)) {
    const h = norm(v);
    if (colSubj < 0 && h.includes("предмет")) colSubj = +k;
    if (colFbw < 0 && h.includes("fbw")) colFbw = +k;
  }
  if (colSubj < 0 || colFbw < 0)
    throw new Error("Не найдены столбцы «Предмет» и «Склад WB (FBW), %».");
  const out = []; const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i].cells;
    const name = String(c[colSubj] ?? "").trim();
    const comm = parseFloat(String(c[colFbw] ?? "").replace(",", "."));
    if (!name || isNaN(comm) || seen.has(name)) continue;
    seen.add(name);
    out.push({ id: uid(), name, commission: comm });
  }
  if (!out.length) throw new Error("Не удалось прочитать комиссии из файла.");
  return out;
}

async function parseSeasonalityXlsx(arrayBuffer) {
  const rows = await readSheetRows(arrayBuffer);
  if (!rows.length) throw new Error("Лист пуст.");

  // шапка: ищем нужные столбцы по названию
  const header = rows[0].cells;
  const norm = (s) => String(s || "").toLowerCase().replace(/\s|\n/g, "");
  let colDate = -1, colOrders = -1, colCheck = -1;
  for (const [k, v] of Object.entries(header)) {
    const h = norm(v);
    if (colDate < 0 && h.includes("дата")) colDate = +k;
    if (colOrders < 0 && h.includes("заказы") && (h.includes("₽") || h.includes("руб"))) colOrders = +k;
    if (colCheck < 0 && h.includes("среднийчек")) colCheck = +k;
  }
  if (colDate < 0 || colOrders < 0 || colCheck < 0)
    throw new Error("Нужные столбцы не найдены (Дата, «Заказы, ₽», «Средний чек, ₽»). Загрузите Лист 1 (mpstats).");

  const raw = [];
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i].cells;
    const ds = c[colDate], o = parseFloat(c[colOrders]), ch = parseFloat(c[colCheck]);
    if (ds == null || isNaN(o) || isNaN(ch)) continue;
    const dnum = parseFloat(ds);
    const d = !isNaN(dnum) && dnum > 20000 && dnum < 80000 ? serialToISO(dnum) : String(ds).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    raw.push({ d, o, ch });
  }
  if (!raw.length) throw new Error("Не удалось прочитать данные по дням.");

  const meanO = raw.reduce((s, r) => s + r.o, 0) / raw.length;
  const meanC = raw.reduce((s, r) => s + r.ch, 0) / raw.length;
  const points = raw
    .map((r) => ({ d: r.d, s: +((r.o / meanO) * (r.ch / meanC)).toFixed(4) }))
    .sort((a, b) => (a.d < b.d ? -1 : 1));
  return points;
}

const MON_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function SeasonalityPanel({ data, onChange, cal, onSetComponents, onSetBuffer }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [anchor, setAnchor] = useState("entry"); // "entry" = от входа, "today" = от сегодня
  const fileRef = useRef(null);
  const points = (data && Array.isArray(data.points)) ? data.points : [];
  const entry = data?.entry || null;
  const exit = data?.exit || null;

  // ---- производственный цикл (из календаря) ----
  const comps = (cal && Array.isArray(cal.components)) ? cal.components : [];
  const buffer = Math.max(0, parseInt(cal?.buffer) || 0);
  const totalDays = comps.reduce((s, c) => s + Math.max(0, parseInt(c.days) || 0), 0);
  const canEditCal = typeof onSetComponents === "function";
  const setCompDays = (id, v) => { if (canEditCal) onSetComponents(comps.map((c) => (c.id === id ? { ...c, days: Math.max(0, parseInt(v) || 0) } : c))); };

  // ---- реальные даты для вердикта «успеем ли» ----
  const pad2 = (x) => String(x).padStart(2, "0");
  const fmtRu = (d) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  const addDays = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
  const diffDays = (a, b) => Math.round((b - a) / 86400000);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const entryMD = entry ? { m: +entry.slice(5, 7) - 1, d: +entry.slice(8, 10) } : null;
  const nextOccur = (md) => { let c = new Date(today.getFullYear(), md.m, md.d); c.setHours(0, 0, 0, 0); if (c < today) c = new Date(today.getFullYear() + 1, md.m, md.d); return c; };
  const targetOnShelf = entryMD ? nextOccur(entryMD) : null;           // ближайший «вход» в будущем
  const crucialStart = targetOnShelf ? addDays(targetOnShelf, -(totalDays + buffer)) : null; // крайний старт цикла
  const slack = crucialStart ? diffDays(today, crucialStart) : null;   // запас в днях (>0 есть, <0 опоздание)
  let verdict = null;
  if (crucialStart != null) {
    if (slack < 0) verdict = { kind: "late", text: `⛔ Опоздание · старт был нужен ${fmtRu(crucialStart)} (−${-slack} дн)` };
    else if (slack <= 14) verdict = { kind: "warn", text: `⚠️ Впритык · крайний старт ${fmtRu(crucialStart)} · запас ${slack} дн` };
    else verdict = { kind: "ok", text: `✅ Успеваем · крайний старт ${fmtRu(crucialStart)} · запас ${slack} дн` };
  }
  // проекция «если стартуем сегодня» → когда на полке
  const projOnShelf = addDays(today, totalDays + buffer);

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const buf = await file.arrayBuffer();
      const pts = await parseSeasonalityXlsx(buf);
      onChange({ points: pts, entry: null, exit: null });
    } catch (e) {
      setErr(e?.message || "Не удалось обработать файл.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // геометрия графика
  const VBW = 760, VBH = 210, padX = 6, padT = 12, padB = 20;
  const n = points.length;
  const maxS = points.reduce((m, p) => Math.max(m, p.s), 0.0001);
  const xAt = (i) => padX + (n <= 1 ? 0 : (i / (n - 1)) * (VBW - 2 * padX));
  const yAt = (s) => padT + (1 - s / maxS) * (VBH - padT - padB);
  const idxOf = (d) => points.findIndex((p) => p.d === d);
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p.s).toFixed(1)}`).join(" ");
  const areaPath = n ? `${linePath} L${xAt(n - 1).toFixed(1)},${yAt(0).toFixed(1)} L${xAt(0).toFixed(1)},${yAt(0).toFixed(1)} Z` : "";

  const monthTicks = [];
  let lastM = -1;
  points.forEach((p, i) => { const m = +p.d.slice(5, 7) - 1; if (m !== lastM) { monthTicks.push({ i, m }); lastM = m; } });

  const onChartClick = (e) => {
    if (!n) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const i = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    const d = points[i].d;
    if (!entry || (entry && exit)) onChange({ ...data, points, entry: d, exit: null });
    else onChange({ ...data, points, entry, exit: d });
  };

  const ei = entry ? idxOf(entry) : -1;
  const xi = exit ? idxOf(exit) : -1;
  const peak = n ? points.reduce((a, b) => (b.s > a.s ? b : a)) : null;
  const low = n ? points.reduce((a, b) => (b.s < a.s ? b : a)) : null;
  const fmtD = (d) => d ? `${d.slice(8, 10)} ${MON_SHORT[+d.slice(5, 7) - 1]}` : "—";
  let windowAvg = null;
  if (ei >= 0 && xi >= 0) {
    const a = Math.min(ei, xi), b = Math.max(ei, xi);
    const seg = points.slice(a, b + 1);
    windowAvg = seg.reduce((s, p) => s + p.s, 0) / seg.length;
  }

  // ---- наложение производственного цикла на график ----
  const spanDays = n > 1 ? Math.max(1, diffDays(new Date(points[0].d + "T00:00:00"), new Date(points[n - 1].d + "T00:00:00"))) : 364;
  const ppd = (VBW - 2 * padX) / spanDays; // пикселей на день
  const bandH = 12, bandY = VBH - padB - bandH - 1;
  const mdToIdx = (mo, da) => { const t = mo * 100 + da; let bi = 0, bd = 1e9; points.forEach((p, i) => { const v = (+p.d.slice(5, 7)) * 100 + (+p.d.slice(8, 10)); const dd = Math.abs(v - t); if (dd < bd) { bd = dd; bi = i; } }); return bi; };
  const todayX = n ? xAt(mdToIdx(today.getMonth() + 1, today.getDate())) : 0;
  let bandStartX = null, bandEndX = null; const stageRects = [];
  if (totalDays > 0 && (anchor === "entry" ? ei >= 0 : n > 0)) {
    if (anchor === "entry") { bandEndX = xAt(ei) - buffer * ppd; bandStartX = bandEndX - totalDays * ppd; }
    else { bandStartX = todayX; bandEndX = todayX + totalDays * ppd; }
    let cx = bandStartX;
    comps.forEach((c, i) => { const w = Math.max(0, parseInt(c.days) || 0) * ppd; stageRects.push({ x: cx, w, color: c.color || CAL_STAGE_COLORS[i % CAL_STAGE_COLORS.length], name: c.name }); cx += w; });
  }
  const vColor = verdict ? (verdict.kind === "ok" ? { bg: "#ecfdf5", fg: "#059669", bd: "#a7f3d0" } : verdict.kind === "warn" ? { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" } : { bg: "#fef2f2", fg: "#dc2626", bd: "#fecaca" }) : null;

  return (
    <div>
      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      {n === 0 ? (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-200 py-6 text-sm text-neutral-500 hover:border-sky-300 hover:bg-sky-50/40 disabled:opacity-50"
        >
          <Download size={18} className="rotate-180 text-neutral-400" />
          {busy ? "Обработка…" : "Загрузить таблицу (Лист 1, mpstats) — .xlsx"}
        </button>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
            <span>Дней: <b className="text-neutral-700">{n}</b></span>
            {peak && <span>Пик: <b className="text-neutral-700">{fmtD(peak.d)}</b> ({peak.s.toFixed(2)})</span>}
            {low && <span>Спад: <b className="text-neutral-700">{fmtD(low.d)}</b> ({low.s.toFixed(2)})</span>}
            {totalDays > 0 && (
              <span className="ml-auto inline-flex items-center rounded-lg bg-neutral-100 p-0.5" title="Куда откладывать цикл">
                <button onClick={() => setAnchor("entry")} className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${anchor === "entry" ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500"}`}>Цикл от входа</button>
                <button onClick={() => setAnchor("today")} className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${anchor === "today" ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500"}`}>от сегодня</button>
              </span>
            )}
            <button onClick={() => fileRef.current?.click()} className={`${totalDays > 0 ? "" : "ml-auto"} inline-flex items-center gap-1 text-sky-600 hover:underline`}>Загрузить заново</button>
          </div>

          <svg viewBox={`0 0 ${VBW} ${VBH}`} className="w-full cursor-crosshair select-none" style={{ height: 210 }} onClick={onChartClick}>
            {/* окно вход→выход */}
            {ei >= 0 && xi >= 0 && (
              <rect x={Math.min(xAt(ei), xAt(xi))} y={padT} width={Math.abs(xAt(xi) - xAt(ei))} height={VBH - padT - padB} fill="#16a34a" opacity="0.07" />
            )}
            {/* базовая линия сезон = 1 */}
            <line x1={padX} x2={VBW - padX} y1={yAt(1)} y2={yAt(1)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4 3" />
            <text x={padX + 2} y={yAt(1) - 3} fontSize="9" fill="#94a3b8">1,0 (среднее)</text>
            {/* область и линия сезонности */}
            <path d={areaPath} fill="#0ea5e9" opacity="0.08" />
            <path d={linePath} fill="none" stroke="#0284c7" strokeWidth="1.5" />
            {/* метки месяцев */}
            {monthTicks.map((t) => (
              <g key={t.i}>
                <line x1={xAt(t.i)} x2={xAt(t.i)} y1={VBH - padB} y2={VBH - padB + 3} stroke="#cbd5e1" strokeWidth="1" />
                <text x={xAt(t.i)} y={VBH - padB + 13} fontSize="9" fill="#94a3b8" textAnchor="middle">{MON_SHORT[t.m]}</text>
              </g>
            ))}
            {/* точка входа */}
            {ei >= 0 && (
              <g>
                <line x1={xAt(ei)} x2={xAt(ei)} y1={padT} y2={VBH - padB} stroke="#16a34a" strokeWidth="1.5" />
                <circle cx={xAt(ei)} cy={yAt(points[ei].s)} r="3.5" fill="#16a34a" />
              </g>
            )}
            {/* точка выхода */}
            {xi >= 0 && (
              <g>
                <line x1={xAt(xi)} x2={xAt(xi)} y1={padT} y2={VBH - padB} stroke="#dc2626" strokeWidth="1.5" />
                <circle cx={xAt(xi)} cy={yAt(points[xi].s)} r="3.5" fill="#dc2626" />
              </g>
            )}
            {/* линия «сегодня» */}
            {n > 0 && (
              <g>
                <line x1={todayX} x2={todayX} y1={padT} y2={VBH - padB} stroke="#f59e0b" strokeWidth="1.3" strokeDasharray="5 4" />
                <text x={todayX + (todayX > VBW - 60 ? -4 : 4)} y={padT + 9} fontSize="9" fontWeight="700" fill="#d97706" textAnchor={todayX > VBW - 60 ? "end" : "start"}>сегодня</text>
              </g>
            )}
            {/* полоса производственного цикла */}
            {stageRects.length > 0 && (
              <g>
                {/* запас до входа (пунктирный зазор), только в режиме «от входа» */}
                {anchor === "entry" && buffer > 0 && (
                  <rect x={bandEndX} y={bandY} width={buffer * ppd} height={bandH} fill="#f3f4f6" stroke="#d4d4d8" strokeWidth="0.8" strokeDasharray="3 2" />
                )}
                {stageRects.map((s, i) => (
                  <rect key={i} x={s.x} y={bandY} width={Math.max(0, s.w)} height={bandH} fill={s.color} opacity="0.92">
                    <title>{s.name}</title>
                  </rect>
                ))}
                {/* рамка всего цикла */}
                <rect x={bandStartX} y={bandY} width={Math.max(0, bandEndX - bandStartX)} height={bandH} fill="none" stroke="#ffffff" strokeWidth="1" />
                <text x={bandStartX} y={bandY - 3} fontSize="9" fontWeight="700" fill="#525252">◀ старт цикла</text>
                {anchor === "entry"
                  ? <text x={xAt(ei) - 3} y={bandY - 3} fontSize="9" fontWeight="700" fill="#16a34a" textAnchor="end">на полке</text>
                  : <text x={Math.min(bandEndX + 3, VBW - padX)} y={bandY - 3} fontSize="9" fontWeight="700" fill="#2563eb">выйдем на полку</text>}
              </g>
            )}
          </svg>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-green-600" /> Вход: <b className="text-neutral-700">{fmtD(entry)}</b></span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-600" /> Выход: <b className="text-neutral-700">{fmtD(exit)}</b></span>
            {windowAvg != null && <span className="text-neutral-500">Ср. сезон в окне: <b className="text-neutral-700">{windowAvg.toFixed(2)}</b></span>}
            {(entry || exit) && <button onClick={() => onChange({ ...data, points, entry: null, exit: null })} className="ml-auto text-neutral-400 hover:text-red-500">Сбросить точки</button>}
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">Кликните по графику, чтобы отметить точку входа, затем ещё раз — точку выхода.</p>

          {/* ---- производственный цикл ---- */}
          <div className="mt-4 border-t border-neutral-100 pt-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h5 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Производственный цикл</h5>
              {verdict ? (
                <span className="ml-auto inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold" style={{ background: vColor.bg, color: vColor.fg, borderColor: vColor.bd }}>{verdict.text}</span>
              ) : (
                <span className="ml-auto text-[11px] text-neutral-400">{entry ? "добавьте этапы цикла ниже" : "отметьте точку входа на графике"}</span>
              )}
            </div>

            {comps.length > 0 && (
              <div className="flex flex-wrap items-end gap-2">
                {comps.map((c, i) => (
                  <label key={c.id} className="flex flex-col gap-1">
                    <span className="text-[10px] text-neutral-500">{c.name || `Этап ${i + 1}`}</span>
                    <span className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 py-1">
                      <span className="h-2 w-2 rounded-sm" style={{ background: c.color || CAL_STAGE_COLORS[i % CAL_STAGE_COLORS.length] }} />
                      <input type="number" min="0" value={c.days} onChange={(e) => setCompDays(c.id, e.target.value)} disabled={!canEditCal} className="w-11 border-none p-0 text-right text-sm font-bold text-neutral-800 outline-none disabled:bg-transparent" />
                      <span className="text-[10px] text-neutral-400">дн</span>
                    </span>
                  </label>
                ))}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-neutral-500">Запас до входа</span>
                  <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 bg-white px-2 py-1">
                    <input type="number" min="0" value={buffer} onChange={(e) => typeof onSetBuffer === "function" && onSetBuffer(Math.max(0, parseInt(e.target.value) || 0))} disabled={typeof onSetBuffer !== "function"} className="w-11 border-none p-0 text-right text-sm font-bold text-neutral-800 outline-none disabled:bg-transparent" />
                    <span className="text-[10px] text-neutral-400">дн</span>
                  </span>
                </label>
              </div>
            )}

            {totalDays > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-neutral-100 pt-2 text-xs">
                <span className="text-neutral-500">Цикл всего: <b className="text-neutral-800">{totalDays} дн</b>{buffer > 0 && <span className="text-neutral-400"> + запас {buffer}</span>}</span>
                {anchor === "entry" ? (
                  <>
                    {targetOnShelf && <span className="text-neutral-500">Цель «на полке»: <b className="text-neutral-800">{fmtRu(targetOnShelf)}</b></span>}
                    {crucialStart && <span className="text-neutral-500">Крайний старт: <b className="text-neutral-800">{fmtRu(crucialStart)}</b></span>}
                    <span className="text-neutral-500">Сегодня: <b className="text-neutral-800">{fmtRu(today)}</b></span>
                    {slack != null && <span className="text-neutral-500">Запас: <b style={{ color: vColor?.fg }}>{slack < 0 ? `опоздание ${-slack} дн` : `${slack} дн`}</b></span>}
                  </>
                ) : (
                  <>
                    <span className="text-neutral-500">Старт сегодня: <b className="text-neutral-800">{fmtRu(today)}</b></span>
                    <span className="text-neutral-500">Выйдем на полку: <b className="text-neutral-800">{fmtRu(projOnShelf)}</b></span>
                    {targetOnShelf && <span className="text-neutral-500">Цель входа: <b className="text-neutral-800">{fmtRu(targetOnShelf)}</b> <span style={{ color: diffDays(projOnShelf, targetOnShelf) >= 0 ? "#059669" : "#dc2626" }}>({diffDays(projOnShelf, targetOnShelf) >= 0 ? `успеваем на ${diffDays(projOnShelf, targetOnShelf)} дн раньше` : `позже на ${-diffDays(projOnShelf, targetOnShelf)} дн`})</span></span>}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}

// Вид «Календарь» для блока продвижения одного товара
function PromoCalendar({ product, wbOrders = {}, onOpenDay }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const todayStr = isoYMD(now);
  const startOffset = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => new Date(ym.y, ym.m, 1 - startOffset + i));
  const prevM = () => setYm((s) => { const d = new Date(s.y, s.m - 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const nextM = () => setYm((s) => { const d = new Date(s.y, s.m + 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const goToday = () => setYm({ y: now.getFullYear(), m: now.getMonth() });
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={prevM} className="rounded-lg flex h-7 w-7 items-center justify-center border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /></button>
        <button onClick={nextM} className="rounded-lg flex h-7 w-7 items-center justify-center border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><ChevronRight size={16} /></button>
        <h2 className="ml-1 text-sm font-semibold capitalize text-neutral-900">{MONTHS_FULL[ym.m]} {ym.y}</h2>
        <button onClick={goToday} className="rounded-lg ml-1 border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50">Сегодня</button>
      </div>
      <div className="grid grid-cols-7 gap-px">
        {WD_SHORT.map((w) => (<div key={w} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{w}</div>))}
        {cells.map((d, i) => {
          const ds = isoYMD(d);
          const inMonth = d.getMonth() === ym.m;
          const isToday = ds === todayStr;
          const acts = RNP_TASKS.map((t) => ({ t, a: rnpDayActivity(t, product, ds, wbOrders) })).filter((x) => x.a);
          const spend = RNP_TASKS.reduce((s, t) => s + rnpDayCost(t, product, ds), 0);
          return (
            <div key={i} onClick={() => inMonth && onOpenDay(ds)} className={"min-h-[92px] cursor-pointer rounded-lg border p-1 transition hover:border-orange-300 " + (inMonth ? "border-neutral-100 bg-white" : "border-neutral-100 bg-neutral-50/40")}>
              <div className="mb-1 flex items-center justify-between px-0.5">
                <span className={"inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs " + (isToday ? "bg-orange-600 font-bold text-white" : inMonth ? "text-neutral-600" : "text-neutral-300")}>{d.getDate()}</span>
                {spend > 0 && <span className="text-[10px] font-bold tabular-nums text-amber-700">{spend.toLocaleString("ru-RU")} ₽</span>}
              </div>
              <div className="space-y-0.5">
                {acts.slice(0, 3).map(({ t, a }) => (
                  <div key={t.id} className="flex items-center gap-1 px-0.5 text-[11px]" title={t.label}>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: RNP_COLORS[t.id] || "#cbd5e1" }} />
                    <span className="min-w-0 flex-1 truncate text-neutral-600">{t.label}{a.count ? " ·" + (t.src ? rnpWbFmt(t, a.count) : a.count) : ""}</span>
                  </div>
                ))}
                {acts.length > 3 && <div className="px-1 text-[10px] text-neutral-400">+{acts.length - 3} ещё</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Редактор одного дня продвижения (открывается кликом по дню в календаре)
function PromoDayEditor({ product, dkey, wbOrders = {}, onSetCell, onSetFlag, onOpenPopup, onClose }) {
  const entries = product.rnp?.entries || {};
  const cells = product.rnp?.cells || {};
  const flags = product.rnp?.flags || {};
  const [y, m, dd] = dkey.split("-");
  const title = `${dd} ${MONTHS_FULL[+m - 1].toLowerCase()} ${y}`;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-md bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold capitalize text-neutral-900">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
        </div>
        <div className="space-y-1.5">
          {RNP_TASKS.map((t) => {
            const dot = <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: RNP_COLORS[t.id] || "#cbd5e1" }} />;
            if (t.kind === "wbOrders") {
              const c = rnpWbCount(t, product, dkey, wbOrders);
              return (<div key={t.id} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2"><span className="inline-flex items-center gap-2 text-sm text-neutral-700">{dot}{t.label}</span><span className="ml-auto text-sm font-semibold tabular-nums text-neutral-700">{c ? rnpWbFmt(t, c) : "—"}</span></div>);
            }
            if (t.kind === "singleCost") {
              return (<div key={t.id} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2"><span className="inline-flex items-center gap-2 text-sm text-neutral-700">{dot}{t.label}</span><div className="ml-auto flex items-center gap-1">{t.id === "internal" && rnpAdDay(product, dkey) !== undefined ? <span title="Факт из WB" className="w-24 px-2 py-1 text-right text-sm font-semibold tabular-nums text-blue-600">{Math.round(rnpAdDay(product, dkey)).toLocaleString("ru-RU")}</span> : <input value={cells[`${t.id}:cost:${dkey}`] ?? ""} onChange={(e) => onSetCell(`${t.id}:cost:${dkey}`, e.target.value)} inputMode="decimal" placeholder="0" className="w-24 rounded-lg border border-neutral-200 px-2 py-1 text-right text-sm tabular-nums focus:border-neutral-400 focus:outline-none" />}<span className="text-xs text-neutral-400">₽</span></div></div>);
            }
            if (t.kind === "twoRow" && t.top === "entries") {
              const arr = entries[`${t.id}:${dkey}`] || [];
              return (<button key={t.id} onClick={() => { onOpenPopup(t, dkey); onClose(); }} className="flex w-full items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2 text-left hover:border-orange-200 hover:bg-orange-50/40"><span className="inline-flex items-center gap-2 text-sm text-neutral-700">{dot}{t.label}</span><span className="ml-auto inline-flex items-center gap-1 text-sm text-neutral-500">{arr.length ? `${arr.length} зап.` : "добавить"}<Plus size={13} /></span></button>);
            }
            if (t.kind === "checkbox") {
              const on = !!flags[`${t.id}:${dkey}`];
              return (<label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2"><span className="inline-flex items-center gap-2 text-sm text-neutral-700">{dot}{t.label}</span><input type="checkbox" checked={on} onChange={() => onSetFlag(`${t.id}:${dkey}`, !on)} className="ml-auto h-4 w-4 accent-green-600" /></label>);
            }
            if (t.kind === "rangeTask") {
              const active = (entries[`${t.id}:_ranges`] || []).some((r) => r.start <= dkey && r.end >= dkey);
              return (<div key={t.id} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2"><span className="inline-flex items-center gap-2 text-sm text-neutral-700">{dot}{t.label}</span><span className="ml-auto text-xs text-neutral-400">{active ? "активно" : "—"}</span></div>);
            }
            return null;
          })}
        </div>
        <p className="mt-3 text-[11px] text-neutral-400">Диапазонные задачи (Баллы, А/Б) редактируются в базе записей из вида «Гант».</p>
      </div>
    </div>
  );
}

// Выпадающий список «Предмет» (combobox): фильтрация по вводу + выбор из списка, свой текст разрешён
function SubjectCombo({ value, subjects = [], onChange, auto = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const opts = (subjects || []).map((s) => s.name).filter(Boolean);
  const q = (value || "").trim().toLowerCase();
  const filtered = q ? opts.filter((n) => n.toLowerCase().includes(q)) : opts;
  return (
    <div ref={ref} className={auto ? "relative inline-block" : "relative w-full max-w-xs"}>
      <div className={"flex items-center rounded-md border pr-1 focus-within:border-neutral-300 focus-within:ring-2 focus-within:ring-orange-200 " + (auto && !(value || "").trim() ? "border-dashed border-neutral-300 hover:border-neutral-400" : "border-transparent hover:border-neutral-200")}>
        <input value={value || ""} onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={auto ? "предмет" : "категория ВБ"} style={auto ? { width: Math.max((value || "").length, 7) + 1 + "ch" } : undefined} className={"bg-transparent px-1.5 py-0.5 focus:outline-none " + (auto ? "text-[15px] text-neutral-800 placeholder:text-neutral-400" : "min-w-0 flex-1 text-sm text-neutral-700")} />
        <button type="button" onClick={() => setOpen((o) => !o)} className="shrink-0 rounded p-0.5 text-neutral-400 hover:text-neutral-700" title="Выбрать предмет"><ChevronDown size={14} /></button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute left-0 top-full z-[60] mt-1 max-h-60 w-full min-w-[180px] overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl">
          {filtered.map((n) => (
            <button key={n} type="button" onMouseDown={(e) => { e.preventDefault(); onChange(n); setOpen(false); }} className={"flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-neutral-50 " + (n === value ? "font-semibold text-orange-700" : "text-neutral-700")}>{n}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Светофорный переключатель оценки критерия (зелёный / оранжевый / красный)
function TrafficToggle({ value, onChange }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-50 p-1">
      {TL_LEVELS.map((lv) => {
        const m = TL_META[lv];
        const on = value === lv;
        return (
          <button
            key={lv}
            onClick={() => onChange(lv)}
            title={m.label}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition"
            style={on ? { background: m.bg } : {}}
          >
            <span
              className="block h-3.5 w-3.5 rounded-full"
              style={on ? { background: m.color } : { border: `2px solid ${m.color}`, opacity: 0.55 }}
            />
          </button>
        );
      })}
    </div>
  );
}

// Оценочная карта карточки: рейтинг-кольцо + саммари + критерии (светофор + комментарий) + настройка критериев
function CritScorecard({ criteria = [], onSetCriteria, analytics, onSetAnalytics }) {
  const crits = Array.isArray(criteria) ? criteria : [];
  const ratings = analytics?.ratings || {};
  const comments = analytics?.comments || {};
  const sc = analyticsScore(crits, ratings);
  const verdict = scoreVerdict(sc);

  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const dragId = useRef(null);

  const setRating = (cid, lv) =>
    onSetAnalytics({ ratings: { ...ratings, [cid]: ratings[cid] === lv ? undefined : lv }, comments });
  const setComment = (cid, text) =>
    onSetAnalytics({ ratings, comments: { ...comments, [cid]: text } });

  const addCrit = () => { const t = draft.trim(); if (!t) return; onSetCriteria([...crits, { id: uid(), name: t }]); setDraft(""); };
  const renameCrit = (cid, name) => onSetCriteria(crits.map((c) => (c.id === cid ? { ...c, name } : c)));
  const removeCrit = (cid) => onSetCriteria(crits.filter((c) => c.id !== cid));
  const reorder = (from, to) => { if (from === to || from == null || to == null) return; const a = crits.slice(); const [m] = a.splice(from, 1); a.splice(to, 0, m); onSetCriteria(a); };

  // геометрия кольца
  const R = 26, C = 2 * Math.PI * R;
  const frac = sc.max > 0 ? sc.got / sc.max : 0;

  return (
    <div className="rounded-2xl border border-neutral-200 p-4">
      {/* саммари — компактно, в одну строку */}
      <div className="flex items-center gap-3">
        <div className="relative h-12 w-12 shrink-0">
          <svg viewBox="0 0 64 64" className="h-12 w-12 -rotate-90">
            <circle cx="32" cy="32" r={R} fill="none" stroke="#eef0f2" strokeWidth="6" />
            <circle cx="32" cy="32" r={R} fill="none" stroke={verdict.color} strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
            <span className="text-sm font-bold tabular-nums text-neutral-900">{sc.rated ? sc.score10 : "—"}</span>
            <span className="text-[8px] text-neutral-400">{sc.rated ? "из 10" : "рейтинг"}</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold" style={{ color: verdict.color }}>{verdict.text}</div>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-neutral-100">
            {sc.max > 0 && (<><div style={{ width: `${(sc.counts.green * 2 / sc.max) * 100}%`, background: TL_META.green.color }} /><div style={{ width: `${(sc.counts.orange / sc.max) * 100}%`, background: TL_META.orange.color }} /><div style={{ width: `${(sc.counts.red * 0 / sc.max) * 100}%` }} /></>)}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: TL_META.green.color }} />{sc.counts.green} хорошо</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: TL_META.orange.color }} />{sc.counts.orange} средне</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: TL_META.red.color }} />{sc.counts.red} плохо</span>
          </div>
        </div>
      </div>

      {/* шапка «Критерии» + кнопка настройки */}
      <div className="mt-4 flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Критерии</h4>
        <span className="rounded-full bg-neutral-100 px-1.5 text-xs font-semibold text-neutral-500">{crits.length}</span>
        <button onClick={() => setEditOpen((v) => !v)} className={"ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition " + (editOpen ? "border-neutral-800 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50")}><Settings2 size={13} /> Настроить</button>
      </div>

      {/* панель настройки критериев (общие для всех карточек) */}
      {editOpen && (
        <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
          <p className="mb-2 text-[11px] text-neutral-400">Критерии общие для всех карточек — изменения применятся везде.</p>
          <div className="flex flex-col gap-1.5">
            {crits.map((c, i) => (
              <div
                key={c.id}
                draggable
                onDragStart={() => { dragId.current = i; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { reorder(dragId.current, i); dragId.current = null; }}
                className="flex items-center gap-2"
              >
                <span className="cursor-grab text-neutral-300" title="Перетащить"><GripVertical size={15} /></span>
                <input value={c.name} onChange={(e) => renameCrit(c.id, e.target.value)} className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm focus:border-neutral-400 focus:outline-none" />
                <button onClick={() => removeCrit(c.id)} className="shrink-0 rounded p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить критерий"><X size={15} /></button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCrit(); } }} placeholder="Новый критерий…" className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm focus:border-neutral-400 focus:outline-none" />
            <button onClick={addCrit} disabled={!draft.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-40"><Plus size={14} /> Добавить</button>
          </div>
        </div>
      )}

      {/* оценка по каждому критерию — компактные строки без карточек */}
      <div className="mt-2">
        {crits.length === 0 && <p className="py-4 text-center text-sm text-neutral-400">Критериев пока нет — добавьте в «Настроить».</p>}
        {crits.map((c) => (
          <div key={c.id} className="border-t border-neutral-100 py-2.5 first:border-t-0">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-sm font-semibold text-neutral-800">{c.name}</span>
              <TrafficToggle value={ratings[c.id]} onChange={(lv) => setRating(c.id, lv)} />
            </div>
            <input value={comments[c.id] || ""} onChange={(e) => setComment(c.id, e.target.value)} placeholder="комментарий…" className="mt-1 w-full border-0 border-b border-dashed border-neutral-200 bg-transparent px-0.5 py-0.5 text-sm text-neutral-700 placeholder:text-neutral-300 focus:border-neutral-400 focus:border-solid focus:outline-none" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Дашборд «Размеры»: размерный ряд (пилюли + пресеты) либо режим One size
function SizesBoard({ sizes = [], oneSize, oneLabel, onSizesSet, onSetOneSize, onSetOneLabel }) {
  const [draft, setDraft] = useState("");
  const list = Array.isArray(sizes) ? sizes : [];
  const mkSize = (name) => ({ id: uid(), name, total: "", toShip: "", qty: {} });

  const renameSize = (sid, name) => onSizesSet(list.map((s) => (s.id === sid ? { ...s, name } : s)));
  const removeSize = (sid) => onSizesSet(list.filter((s) => s.id !== sid));
  const addSize = () => { const t = draft.trim(); if (!t) return; onSizesSet([...list, mkSize(t)]); setDraft(""); };
  const applyPreset = (names) => {
    // сохраняем склад/кол-во для совпадающих по имени размеров
    const byName = new Map(list.map((s) => [String(s.name).trim(), s]));
    onSizesSet(names.map((n) => byName.get(n) || mkSize(n)));
  };

  return (
    <div className="mx-auto max-w-xl">
      {!oneSize ? (
        <>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Быстрый выбор</div>
          <div className="mb-5 flex flex-wrap gap-2">
            {SIZE_PRESETS.map((p) => (
              <button key={p.label} onClick={() => applyPreset(p.sizes)} className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700">{p.label}</button>
            ))}
            {list.length > 0 && <button onClick={() => onSizesSet([])} className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600">Очистить</button>}
          </div>

          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Размеры товара</div>
          <div className="flex flex-wrap gap-2">
            {list.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-xl border border-neutral-200 bg-neutral-50 py-1.5 pl-3 pr-1.5">
                <input value={s.name} onChange={(e) => renameSize(s.id, e.target.value)} placeholder="—" className="w-12 bg-transparent text-center text-sm font-bold text-teal-700 focus:outline-none" />
                <button onClick={() => removeSize(s.id)} className="rounded p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить размер"><X size={13} /></button>
              </span>
            ))}
            <span className="inline-flex items-center gap-1 rounded-xl border border-dashed border-neutral-300 py-1.5 pl-3 pr-2 text-neutral-400">
              <Plus size={14} />
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSize(); } }} onBlur={addSize} placeholder="размер…" className="w-20 bg-transparent text-sm font-medium text-neutral-800 focus:outline-none" />
            </span>
          </div>

          <p className="mt-6 rounded-xl border border-neutral-100 bg-neutral-50/60 px-3.5 py-3 text-xs text-neutral-500"><b className="text-neutral-700">Как работает:</b> вводите размеры этого товара пресетами или вручную. Это общий размерный ряд карточки — он подхватывается в плане поставок и закупке. Переключатель сверху включает режим <b>One size</b>, если товар безразмерный.</p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-4 rounded-2xl border border-teal-200 bg-teal-50 p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white"><Target size={22} /></div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-teal-900">Единый размер (One size)</div>
              <div className="text-xs text-teal-700/80">Товар без размерного ряда — один вариант на всех.</div>
            </div>
            <div className="ml-auto flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-700/80">Подпись размера</span>
              <input value={oneLabel || ""} onChange={(e) => onSetOneLabel(e.target.value)} placeholder="ONE SIZE" className="w-40 rounded-lg border border-teal-200 bg-white px-2.5 py-1.5 text-sm focus:border-teal-400 focus:outline-none" />
            </div>
          </div>
          <p className="mt-5 rounded-xl border border-neutral-100 bg-neutral-50/60 px-3.5 py-3 text-xs text-neutral-500"><b className="text-neutral-700">One size:</b> размерная сетка скрывается, товар считается как один размер. Подпись можно поменять (например «42–48» или «безразмерный»). Вернуться к ряду — тем же переключателем сверху.</p>
        </>
      )}
    </div>
  );
}

function stockSrc(product, msData, ozStockData, wbWayData) {
  const pc = String(product.code || "").trim();
  const msRows = msData && msData.items && pc ? msData.items.filter((it) => String(it.code || "").split("_")[0].trim() === pc) : [];
  const ms = msRows.reduce((a, x) => a + (x.stock || 0), 0);
  const wbw = wbWayData && wbWayData.items ? (wbWayData.items[pc] || wbWayData.items[String(product.wb || "")]) : null;
  const wb = wbw ? (wbw.st || 0) : 0;
  const oz = ozStockData && ozStockData.stock && ozStockData.stock.codes && pc ? (ozStockData.stock.codes[pc] || 0) : 0;
  return { pc, msRows, ms, wb, oz, all: ms + wb + oz, hasMs: msRows.length > 0, hasWb: !!wbw, hasOz: !!(ozStockData && ozStockData.stock) };
}

function CardTasksModal({ product, allJobs = [], onCardAddTask, onOpenJob, onUpdateJob, statuses = [], onSetName, onSetTasks, onSetCompetitors, onSetSeasonality, analyticsCriteria = [], onSetCriteria, onSetAnalytics, onSizesSet, onSetOneSize, onSetOneLabel, onSetField, subjects = [], unitConst = {}, onSetUnitConst, productList, onCalEntry, onCalStart, onCalName, onCalComponents, onCalBuffer, onCalCopyFrom, hiddenTasks, rnpStartDate, rnpDays, onSetRnpStartDate, onSetRnpDays, onSetRnpCell, onSetRnpEntries, onSetRnpFill, onSetRnpFlag, onSetRnpBudget, onToggleTask, rnpOrder = [], onSetRnpOrder, purchaseBatches = [], onSetBatchItemFields, onOpenPopup, onOpenDB, wbOrders, wbLoading, wbProgress, onFetchWb, rating = null, msData = null, msReady = false, msLoading = false, onFetchMs, ozStockData = null, wbWayData = null, onClose }) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [wbEdit, setWbEdit] = useState(false);
  const [ratesEdit, setRatesEdit] = useState(false);
  const curStatus = (statuses || []).find((s) => s.name === product.status);
  // Задачи карточки = задачи типа «Товар» этого товара из общего раздела «Задачи».
  // Двусторонняя синхронизация: создал/отметил здесь → видно на Ганте/канбане и наоборот.
  const prodJobs = (allJobs || []).filter((j) => j && jobType(j) === "product" && j.productId === product.id);
  const activeJobs = prodJobs.filter((j) => stageOf(j) !== "done");
  const doneJobs = prodJobs.filter((j) => stageOf(j) === "done");
  const jDone = doneJobs.length, jTotal = prodJobs.length;
  const jPct = jTotal ? Math.round((jDone / jTotal) * 100) : 0;
  const toggleJob = (j) => { const d = stageOf(j) === "done"; onUpdateJob && onUpdateJob({ ...j, done: !d, stage: !d ? "done" : "wait" }); };
  const [newText, setNewText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [fullBlock, setFullBlock] = useState(null); // "promo" | "purchase" | "analytics" — раскрытый на весь экран блок
  const [calBlockOpen, setCalBlockOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoView, setPromoView] = useState("gantt"); // gantt | cal
  const [promoDay, setPromoDay] = useState(null); // открытый день в календаре продвижения
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const pu = product.purchase || {};
  const photoRef = useRef(null);
  const onPhoto = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f || !onSetField) return;
    try { onSetField("image", await fileToThumb(f, 360)); } catch (err) { console.error("[Фото] не удалось обработать:", err); }
  };
  const setPu = (k, v) => onSetField && onSetField("purchase", { ...(product.purchase || {}), [k]: v });
  // ссылки закупки: несколько, одна отмечена звёздочкой как главная (по ней переход)
  const puLinks = (Array.isArray(pu.links) && pu.links.length) ? pu.links : (pu.link && String(pu.link).trim() ? [{ id: "l0", url: pu.link, main: true }] : []);
  const savePuLinks = (arr) => {
    const a = arr.map((l) => ({ ...l }));
    if (a.length && !a.some((l) => l.main)) a[0].main = true;
    const main = a.find((l) => l.main) || a[0];
    onSetField && onSetField("purchase", { ...(product.purchase || {}), links: a, link: (main && main.url) || "" });
  };
  const addPuLink = (url) => savePuLinks([...puLinks, { id: uid(), url, main: puLinks.length === 0 }]);
  const setPuLinkUrl = (id, url) => savePuLinks(puLinks.map((l) => (l.id === id ? { ...l, url } : l)));
  const setPuLinkMain = (id) => savePuLinks(puLinks.map((l) => ({ ...l, main: l.id === id })));
  const removePuLink = (id) => savePuLinks(puLinks.filter((l) => l.id !== id));
  const [linkDraft, setLinkDraft] = useState("");
  const commitLinkDraft = () => { const v = linkDraft.trim(); if (v) { addPuLink(v); setLinkDraft(""); } };
  const puCny = toNum(product.cny), puUsd = toNum(product.usd), puCargo = toNum(product.cargo);
  const puComm = toNum(unitConst.commission), puIns = toNum(unitConst.insurance);
  const puFeeMul = 1 + ((isNaN(puComm) ? 0 : puComm) + (isNaN(puIns) ? 0 : puIns)) / 100; // комиссия + страховка к сумме за товар в юанях
  const puPriceCny = toNum(pu.priceCny), puWeightG = toNum(pu.weightG), puQty = toNum(pu.qty);
  const puRubPerUnit = !isNaN(puPriceCny)
    ? (isNaN(puCny) ? 0 : puCny) * puPriceCny * puFeeMul + (isNaN(puCargo) ? 0 : puCargo) * ((isNaN(puWeightG) ? 0 : puWeightG) / 1000) * (isNaN(puUsd) ? 0 : puUsd)
    : NaN;
  const puLotRub = !isNaN(puRubPerUnit) && !isNaN(puQty) ? puRubPerUnit * puQty : NaN;
  const puLotCny = !isNaN(puPriceCny) && !isNaN(puQty) ? puPriceCny * puQty : NaN;
  const yuan = (n) => (isNaN(n) ? "—" : Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString("ru-RU") + " ¥" : (Math.round(n * 100) / 100).toLocaleString("ru-RU") + " ¥");
  const [mp, setMp] = useState("wb"); // маркетплейс для юнит-экономики: wb | oz
  const promoBudget = rnpBudget(product);

  // ===== Фонд маркетинга (по партиям) =====
  const [mktBatchId, setMktBatchId] = useState(null);
  const mktBatches = (purchaseBatches || []).filter((b) => (b.items || []).some((it) => it.productId === product.id));
  // этапы производства партии (для дашборда «Закупка»)
  const batchCycleInfo = (b) => {
    const cyc = b && b.cycle;
    const started = !!(cyc && cyc.started && Array.isArray(cyc.stages) && cyc.stages.length);
    const stages = started ? cyc.stages : [];
    const total = stages.length;
    const doneCount = stages.filter((s) => s.done).length;
    const curIdx = stages.findIndex((s) => !s.done);
    const completed = started && curIdx < 0;
    const cur = curIdx >= 0 ? stages[curIdx] : null;
    const dates = started ? cycleStageDates(cyc.startDate, stages) : {};
    const curEnd = cur && dates[cur.id] ? dates[cur.id].endStr : null;
    const it = (b.items || []).find((x) => x.productId === product.id);
    const q = it ? parseInt(it.qty) : NaN;
    const qty = isNaN(q) ? null : q;
    const st = PU_STATUS[b.status] || PU_STATUS.draft;
    return { started, stages, total, doneCount, curIdx, completed, cur, curEnd, qty, st };
  };
  const batchShort = (name) => { const m = String(name || "").match(/#\s*\d+/); return m ? m[0].replace(/\s+/g, "") : String(name || "").slice(0, 4); };
  const pluralRu = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return one; if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return few; return many; };
  const mktCur = mktBatches.find((b) => b.id === mktBatchId) || mktBatches[0] || null;
  const mktItem = mktCur ? (mktCur.items || []).find((it) => it.productId === product.id) : null;
  const mktQty = toNum(mktItem?.qty), mktDrr = toNum(mktItem?.mktDrr), mktPrice = toNum(mktItem?.mktPlanPrice);
  const fundOfItem = (it) => { const q = toNum(it?.qty), d = toNum(it?.mktDrr), p = toNum(it?.mktPlanPrice); return (!isNaN(q) && !isNaN(d) && !isNaN(p)) ? q * p * d / 100 : 0; };
  const spentOfItem = (it) => { const s = toNum(it?.mktSpent); return isNaN(s) ? 0 : s; };
  const mktFund = fundOfItem(mktItem);
  const mktSpentV = spentOfItem(mktItem);
  const mktRevenue = (!isNaN(mktQty) && !isNaN(mktPrice)) ? mktQty * mktPrice : NaN;
  const mktOstatok = mktFund - mktSpentV;
  const mktPctCur = mktFund > 0 ? Math.round(mktSpentV / mktFund * 100) : 0;
  // суммарно по всем партиям товара — для превью-плитки
  const mktTotalFund = mktBatches.reduce((s, b) => s + fundOfItem((b.items || []).find((it) => it.productId === product.id)), 0);
  const mktTotalSpent = mktBatches.reduce((s, b) => s + spentOfItem((b.items || []).find((it) => it.productId === product.id)), 0);
  const mktPct = mktTotalFund > 0 ? Math.round(mktTotalSpent / mktTotalFund * 100) : 0;
  const setMktField = (patch) => { if (mktCur && onSetBatchItemFields) onSetBatchItemFields(mktCur.id, patch); };

  // ===== Контент (чек-лист готовности) =====
  const contentDone = (product.content && typeof product.content === "object") ? product.content : {};
  const contentCount = CONTENT_ITEMS.filter((i) => contentDone[i.id]).length;
  const contentPct = Math.round((contentCount / CONTENT_ITEMS.length) * 100);
  const toggleContent = (id) => onSetField && onSetField("content", { ...contentDone, [id]: !contentDone[id] });

  const addTask = () => {
    const t = newText.trim();
    if (!t) return;
    onCardAddTask && onCardAddTask(t);
    setNewText("");
  };
  const fmtDM = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : "");
  const renderJobRow = (j) => {
    const isDone = stageOf(j) === "done";
    return (
      <div key={j.id} className="group flex items-center gap-2 rounded-lg border border-neutral-100 px-2 py-1.5 hover:border-neutral-200">
        <input type="checkbox" checked={isDone} onChange={() => toggleJob(j)} className="h-4 w-4 shrink-0 accent-green-600" />
        {Array.isArray(j.files) && j.files.length > 0 && <Paperclip size={13} className="shrink-0 text-neutral-400" />}
        <button onClick={() => onOpenJob && onOpenJob(j)} className="min-w-0 flex-1 truncate text-left text-sm hover:underline" style={isDone ? { textDecoration: "line-through", color: "#a3a3a3" } : { color: "#171717" }} title={j.title || "Без названия"}>{stripProdSuffix(j.title, product && product.name) || "Без названия"}</button>
        {j.date && <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">{fmtDM(j.date)}</span>}
      </div>
    );
  };

  // --- конкуренты ---
  const competitors = Array.isArray(product.competitors) ? product.competitors : [];
  const [compUrl, setCompUrl] = useState("");
  const addComp = () => {
    const u = compUrl.trim();
    if (!u || !wbNmFromUrl(u)) return;
    onSetCompetitors([...competitors, { id: uid(), url: u }]);
    setCompUrl("");
  };
  const removeComp = (id) => onSetCompetitors(competitors.filter((c) => c.id !== id));

  // --- аналитика: рейтинг карточки по критериям ---
  const aScore = analyticsScore(analyticsCriteria, product.analytics?.ratings);

  // --- размеры ---
  const planSizes = Array.isArray(product.plan?.sizes) ? product.plan.sizes : [];
  const oneSize = !!product.plan?.oneSize;
  const oneLabel = product.plan?.oneLabel || "ONE SIZE";

  // --- дашборды: юнит-экономика (переключатель ВБ / Озон) ---
  const MP = mp === "oz"
    ? { gid: "unitoz", f: { price: "priceOz", spp: "sppOz", drr: "drrOz", commission: "commissionOz", buyback: "buybackOz", logistics: "logisticsOz" }, c: { logisticsFull: "logisticsFullOz", totalCosts: "totalCostsOz", profit: "profitOz", renta: "rentaOz", margin: "marginOz" } }
    : { gid: "unit",   f: { price: "price",   spp: "spp",   drr: "drr",   commission: "commission",   buyback: "buyback",   logistics: "logistics"   }, c: { logisticsFull: "logisticsFull",   totalCosts: "totalCosts",   profit: "profit",   renta: "renta",   margin: "margin"   } };
  const unitCols = (GROUPS.find((g) => g.id === MP.gid) || {}).columns || [];
  const cv = (id) => {
    const c = unitCols.find((x) => x.id === id);
    if (!c) return NaN;
    try { return c.type === "calc" ? c.fn(product, unitCols) : toNum(product[c.field]); } catch { return NaN; }
  };
  const price = cv(MP.f.price), cost = cv("cost");
  const sppVal = toNum(product[MP.f.spp]);
  const afterSpp = isNaN(price) ? NaN : (isNaN(sppVal) ? price : price * (1 - sppVal / 100));
  const profit = cv(MP.c.profit), margin = cv(MP.c.margin), renta = cv(MP.c.renta);
  const logRub = cv(MP.c.logisticsFull);
  const totalCostsV = cv(MP.c.totalCosts);
  const hasEconomics = !isNaN(price) && price > 0 && !isNaN(cost);

  // Какая нужна цена для заданной рентабельности (ЧП/себес):
  //   Общие затраты = Себес + Итог.лог + Цена*k,  где k — переменная доля от цены.
  //   ЧП = Цена*(1−k) − (Себес + Итог.лог);  Рента = ЧП/Себес = R  ⇒
  //   Цена = (Себес*(1+R) + Итог.лог) / (1 − k)
  const kVar = (() => {
    const comm = toNum(product[MP.f.commission]) || 0;
    const sppv = toNum(product[MP.f.spp]) || 0;
    const drrv = toNum(product[MP.f.drr]) || 0;
    const acqv = toNum(product[mp === "oz" ? "acquiringOz" : "acquiring"]) || 0;
    const taxv = toNum(product[mp === "oz" ? "taxRateOz" : "taxRate"]) || 0;
    const af = 1 - sppv / 100;
    return mp === "oz"
      ? comm / 100 + drrv / 100 + af * acqv / 100 + af * taxv / 100  // Озон: эквайринг от цены после СПП
      : comm / 100 + acqv / 100 + drrv / 100 + af * taxv / 100;       // ВБ: эквайринг от цены
  })();
  const targetPrice = (R) => {
    const logF = isNaN(logRub) ? 0 : logRub;
    if (isNaN(cost) || !(1 - kVar > 0)) return NaN;
    return (cost * (1 + R) + logF) / (1 - kVar);
  };


  const toneColor = (v) => isNaN(v) ? "#0f172a" : (v >= 0 ? "#15803d" : "#dc2626");
  const pct = (v) => isNaN(v) ? "—" : Math.round(v) + "%";

  // компактная строка-поле «label … input» (функция, не компонент)
  const unitField = (label, field, suffix, opts) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-neutral-600">{label}{opts && opts.hint && <span className="ml-1 text-[10px] text-neutral-400">{opts.hint}</span>}</span>
      <div className="flex items-center gap-1">
        {opts && opts.readOnly ? (
          <span className="w-24 rounded-lg border border-neutral-100 bg-neutral-50 px-2 py-1 text-right text-sm font-semibold tabular-nums text-neutral-700">{(product[field] ?? "") === "" ? "—" : product[field]}</span>
        ) : (
          <input
            value={product[field] ?? ""}
            onChange={(e) => onSetField && onSetField(field, e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="w-24 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-right text-sm font-semibold tabular-nums text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        )}
        <span className="w-2.5 text-xs text-neutral-400">{suffix || ""}</span>
      </div>
    </div>
  );
  const resRow = (label, text, colorNum) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-neutral-600">{label}</span>
      <b className="text-sm font-bold tabular-nums" style={{ color: colorNum === undefined ? "#0f172a" : toneColor(colorNum) }}>{text}</b>
    </div>
  );
  const puField = (label, value, onChange, suffix) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-neutral-600">{label}</span>
      <div className="flex items-center gap-1">
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder="0" className="w-24 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-right text-sm font-semibold tabular-nums text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />
        <span className="w-4 text-xs text-neutral-400">{suffix || ""}</span>
      </div>
    </div>
  );

  const card = (title, children, extra) => (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4">
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
          {extra}
        </div>
      )}
      {children}
    </section>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50" onClick={(e) => e.stopPropagation()}>
      {/* Шапка */}
      <div className="flex items-stretch gap-3.5 border-b border-neutral-200 bg-white px-5 py-2 sm:px-8">
        <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
        <div className="group relative aspect-[3/4] shrink-0 self-stretch cursor-pointer overflow-hidden rounded-[11px] border border-neutral-200 bg-neutral-50 shadow-sm" onClick={() => photoRef.current && photoRef.current.click()} title={product.image ? "Заменить фото" : "Добавить фото"}>
          {product.image
            ? <img src={product.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
            : <div className="absolute inset-0 flex items-center justify-center text-neutral-300"><ImagePlus size={20} /></div>}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
            <ImagePlus size={14} /><span className="text-[9px] font-semibold leading-none">{product.image ? "Заменить" : "Добавить"}</span>
          </div>
          {product.image && <button onClick={(e) => { e.stopPropagation(); onSetField && onSetField("image", null); }} title="Удалить фото" className="absolute right-0.5 top-0.5 hidden rounded-full bg-black/55 p-0.5 text-white hover:bg-red-600 group-hover:block"><X size={11} /></button>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 py-0.5 min-h-[92px]">
          <div className="-ml-1.5 -mb-1.5 flex h-[18px] items-center">
            <input value={product.code || ""} onChange={(e) => onSetField("code", e.target.value)} placeholder="код" style={{ width: Math.max(String(product.code || "").length, 3) + 2.4 + "ch" }} className={"h-[18px] rounded-md border border-transparent bg-transparent px-1.5 text-[13px] leading-none outline-none transition placeholder:font-semibold placeholder:text-neutral-400 hover:bg-neutral-100 focus:border-neutral-300 focus:bg-neutral-100 " + (product.code ? "font-semibold text-neutral-500 hover:border-neutral-200" : "font-semibold text-neutral-500 hover:border-dashed hover:border-neutral-200")} />
          </div>
          <input
            value={product.name}
            onChange={(e) => onSetName(e.target.value)}
            placeholder="Название товара"
            className="-ml-1.5 h-7 w-full max-w-2xl rounded-lg border border-transparent px-1.5 py-0 text-xl font-extrabold leading-7 tracking-tight text-neutral-900 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <button onClick={() => setStatusOpen((v) => !v)} className="inline-flex h-[26px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold transition hover:brightness-95" style={curStatus ? { background: curStatus.color + "1f", color: curStatus.color } : { background: "#f1f1f3", color: "#9a9a9a" }}>
                {curStatus ? curStatus.name : "Без статуса"}
                <ChevronDown size={12} className="opacity-60" />
              </button>
              {statusOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(false)} />
                  <div className="absolute left-0 top-full z-20 mt-1.5 w-48 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl">
                    {(statuses || []).map((s) => { const on = s.name === product.status; return (
                      <button key={s.name} onClick={() => { onSetField("status", s.name); setStatusOpen(false); }} className={"flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-neutral-50 " + (on ? "font-semibold text-neutral-900" : "text-neutral-600")}>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                        {s.name}
                        {on && <Check size={14} className="ml-auto text-green-600" />}
                      </button>
                    ); })}
                    <button onClick={() => { onSetField("status", ""); setStatusOpen(false); }} className={"flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-neutral-50 " + (!curStatus ? "font-semibold text-neutral-700" : "text-neutral-400")}>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-neutral-200" />
                      Без статуса
                      {!curStatus && <Check size={14} className="ml-auto text-green-600" />}
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="flex h-[26px] items-center rounded-lg bg-neutral-100 px-1.5"><SubjectCombo auto value={product.subject} subjects={subjects} onChange={(v) => onSetField("subject", v)} /></div>
            {product.wb && !wbEdit ? (
              <span className="group inline-flex items-center gap-1.5">
                <a href={`https://global.wildberries.ru/catalog/${String(product.wb).trim()}/detail.aspx`} target="_blank" rel="noreferrer" title={"Артикул WB " + product.wb + " — открыть на сайте"} className="inline-flex items-center gap-1 text-[13px] font-semibold text-violet-700 hover:text-violet-900">WB <ExternalLink size={13} /></a>
                <button onClick={() => setWbEdit(true)} title="Изменить артикул WB" className="hidden rounded p-0.5 text-neutral-300 hover:text-neutral-600 group-hover:inline-flex"><Pencil size={11} /></button></span>
            ) : (
              <input autoFocus={wbEdit} value={product.wb || ""} onChange={(e) => onSetField("wb", e.target.value)} onBlur={() => setWbEdit(false)} onKeyDown={(e) => e.key === "Enter" && setWbEdit(false)} placeholder="+ WB артикул" style={{ width: Math.max(String(product.wb || "").length, 12) + 2.4 + "ch" }} className="h-[26px] rounded-md border border-transparent bg-transparent px-2 text-[13px] font-semibold outline-none transition placeholder:font-semibold placeholder:text-neutral-400 hover:border-dashed hover:border-neutral-200 hover:bg-neutral-100 focus:border-solid focus:border-neutral-300 focus:bg-neutral-100" />
            )}
          </div>
        </div>
        {(() => {
          // заказы за последние 7 дней (сегодня — последний столбик) и сравнение с предыдущими 7
          const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const dayN = (off) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - off); return d; };
          const ot = RNP_TASKS[0];
          const cur = Array.from({ length: 7 }, (_, i) => { const d = dayN(6 - i); return { key: iso(d), n: rnpWbCount(ot, product, iso(d), wbOrders || {}), dd: String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") }; });
          const total = cur.reduce((a, x) => a + x.n, 0);
          const prev = Array.from({ length: 7 }, (_, i) => rnpWbCount(ot, product, iso(dayN(13 - i)), wbOrders || {})).reduce((a, x) => a + x, 0);
          const delta = prev > 0 ? Math.round((total - prev) / prev * 100) : null;
          const mx = Math.max(1, ...cur.map((x) => x.n));
          return (
            <div className="hidden shrink-0 items-end gap-5 self-end pr-1 md:flex">
              {(() => { const rt = rating && typeof rating.r === "number" ? rating : null; const col = !rt ? "#a3a3a3" : rt.r >= 4.7 ? "#15803d" : rt.r >= 4.5 ? "#b45309" : "#dc2626"; return (
                <div className="border-r border-neutral-200 pr-5 text-left leading-tight" title={rt ? "Рейтинг и отзывы на WB" + (rating.t ? " · обновлено " + new Date(rating.t).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "") : "Рейтинг WB не загружен"}>
                  <div className="text-[11px] font-semibold text-neutral-400">Рейтинг WB · отзывы</div>
                  <div className="flex items-baseline gap-1.5 text-[22px] font-extrabold tabular-nums"><span style={{ color: "#f59e0b" }}>★</span><span style={{ color: col }}>{rt ? String(rt.r.toFixed(1)).replace(".", ",") : "—"}</span>{rt && <span className="text-[13px] font-semibold text-neutral-500">{Number(rating.f || 0).toLocaleString("ru-RU")} {(() => { const n = Number(rating.f || 0) % 100, d = n % 10; return n > 10 && n < 15 ? "отзывов" : d === 1 ? "отзыв" : d >= 2 && d <= 4 ? "отзыва" : "отзывов"; })()}</span>}</div>
                </div>
              ); })()}
              <div className="text-left leading-tight">
                <div className="text-[11px] font-semibold text-neutral-400">Заказы · 7 дней</div>
                <div className="text-[22px] font-extrabold tabular-nums text-neutral-900">{total}{delta !== null && <span className="ml-1.5 align-middle text-[11px] font-extrabold" style={{ color: delta >= 0 ? "#16a34a" : "#dc2626" }}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%</span>}</div>
              </div>
              <div className="flex h-[88px] items-end gap-1.5">
                {cur.map((x, i) => (<div key={x.key} title={x.dd + ": " + x.n} className="flex flex-col items-center justify-end">
                  <span className="mb-0.5 text-[12px] font-bold leading-none tabular-nums" style={{ color: i === 6 ? "#0f766e" : (x.n > 0 ? "#737373" : "#d4d4d4") }}>{x.n}</span>
                  <div className="w-[20px] rounded-t-[4px]" style={{ height: Math.max(4, Math.round(x.n / mx * 64)), background: i === 6 ? "#0d9488" : "#86efac" }} />
                </div>))}
              </div>
            </div>
          );
        })()}
        <button onClick={onClose} className="rounded-lg shrink-0 self-start p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" title="Закрыть"><X size={20} /></button>
      </div>

      {/* Тело — дашборды */}
      <div className="flex-1 overflow-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 lg:flex-row lg:items-start">

          {/* Левая колонка — задачи товара (синхр. с разделом «Задачи») */}
          <aside className="w-full space-y-3 lg:w-[27rem] lg:shrink-0">
            {card(
              "Задачи",
              <>
                <div className="mb-2">
                  <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
                    <span>{jDone} из {jTotal}</span>
                    <span>{jPct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full rounded-full bg-green-500" style={{ width: jPct + "%" }} />
                  </div>
                </div>
                <div className="space-y-1">
                  {activeJobs.map((j) => renderJobRow(j))}
                  {jTotal === 0 && <div className="py-3 text-center text-xs text-neutral-400">Задач по товару пока нет.</div>}
                  {jTotal > 0 && activeJobs.length === 0 && <div className="py-3 text-center text-xs text-neutral-400">Все задачи выполнены 🎉</div>}
                </div>
                {doneJobs.length > 0 && (
                  <div className="mt-3 border-t border-neutral-100 pt-2">
                    <button onClick={() => setShowDone((v) => !v)} className="flex w-full items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-700">
                      {showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      Выполненные
                      <span className="rounded-full bg-neutral-100 px-1.5 text-[11px] font-semibold text-neutral-500">{doneJobs.length}</span>
                    </button>
                    {showDone && <div className="mt-2 space-y-1">{doneJobs.map((j) => renderJobRow(j))}</div>}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-1.5">
                  <input
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addTask()}
                    placeholder="Новая задача по товару…"
                    className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
                  />
                  <button onClick={addTask} disabled={!newText.trim()} className="rounded-lg inline-flex shrink-0 items-center bg-neutral-900 p-2 text-white hover:bg-neutral-800 disabled:opacity-40" title="Добавить"><Plus size={15} /></button>
                </div>
              </>
            )}
          </aside>

          {/* Правая часть — дашборды */}
          <div className="min-w-0 flex-1 space-y-5">

            {/* Юнит-экономика — раскрывающийся редактируемый дашборд */}
            <section className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <button onClick={() => setUnitOpen((v) => !v)} className="flex items-center gap-1.5 text-left">
                  {unitOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <h3 className="text-sm font-semibold text-neutral-800">Юнит-экономика</h3>
                </button>
                <div className="inline-flex rounded-lg border border-neutral-200 p-0.5">
                  {[["wb", "ВБ", "#7c3aed"], ["oz", "Озон", "#2563eb"]].map(([id, lbl, col]) => (
                    <button
                      key={id}
                      onClick={() => setMp(id)}
                      className="rounded-md px-2.5 py-0.5 text-xs font-semibold transition"
                      style={mp === id ? { background: col, color: "#fff" } : { color: "#737373" }}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <span onClick={() => setUnitOpen((v) => !v)} className="ml-auto cursor-pointer text-[11px] text-neutral-400">{unitOpen ? "свернуть" : "изменить данные"}</span>
              </div>

              {/* превью — две колонки: ввод слева, итог справа */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  {unitField("Цена", MP.f.price)}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-neutral-400">После СПП</span>
                    <div className="flex items-center gap-1">
                      <span className="w-24 text-right text-sm font-bold tabular-nums text-neutral-500">{money(afterSpp)}</span>
                      <span className="w-2.5" />
                    </div>
                  </div>
                  {unitField("СПП, %", MP.f.spp, "%")}
                  {unitField("ДРР, %", MP.f.drr, "%")}
                </div>
                <div className="flex flex-col justify-center gap-2 rounded-xl border border-neutral-100 bg-neutral-50/60 px-3 py-2.5">
                  {resRow("Чистая прибыль", money(profit), isNaN(profit) ? undefined : profit)}
                  {resRow("Рентабельность", pct(renta), isNaN(renta) ? undefined : renta)}
                  {resRow("Маржа", pct(margin), isNaN(margin) ? undefined : margin)}
                </div>
              </div>

              {/* Подсказки: цена под нужную рентабельность (клик — подставить) */}
              {(() => { const sppMul = (!isNaN(sppVal) && sppVal > 0) ? (1 - sppVal / 100) : null; return (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">Цена для рента:{sppMul != null && <span className="rounded bg-sky-100 px-1.5 text-[9px] font-bold uppercase tracking-wide text-sky-600">с СПП</span>}</span>
                {[50, 75, 100, 150, 200].map((r) => {
                  const v = targetPrice(r / 100);
                  return (
                    <button
                      key={r}
                      onClick={() => !isNaN(v) && onSetField && onSetField(MP.f.price, String(Math.round(v)))}
                      disabled={isNaN(v)}
                      title={isNaN(v) ? "Заполните себестоимость" : "Поставить эту цену"}
                      className="flex flex-col rounded-lg border border-neutral-100 bg-neutral-50/60 px-2 py-1 text-xs transition hover:border-sky-300 hover:bg-sky-50/50 disabled:cursor-default disabled:opacity-60 disabled:hover:border-neutral-100 disabled:hover:bg-neutral-50/60"
                    >
                      <span className="whitespace-nowrap"><span className="text-neutral-400">{r}%</span> <b className="tabular-nums text-neutral-800">{isNaN(v) ? "—" : money(v)}</b></span>
                      {sppMul != null && !isNaN(v) && <span className="text-right text-[10px] font-bold tabular-nums text-sky-600">{money(v * sppMul)}</span>}
                    </button>
                  );
                })}
              </div>
              ); })()}

              {/* расширенный редактор — тот же компактный размер строк, что и сверху */}
              {unitOpen && (
                <div className="mt-3 border-t border-neutral-100 pt-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-400">Параметры товара</p>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    {unitField("Себестоимость", "cost")}
                    {unitField("Комиссия, %", MP.f.commission, "%", mp === "oz" ? undefined : { readOnly: true, hint: "из предмета" })}
                    {unitField("% выкупа", MP.f.buyback, "%")}
                    {unitField("Базовая логистика", MP.f.logistics)}
                  </div>
                  <p className="mb-2 mt-3 text-[11px] font-medium uppercase tracking-wide text-neutral-400">Результат</p>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-xl border border-neutral-100 bg-neutral-50/60 px-3 py-2.5 sm:grid-cols-2">
                    {resRow("Итоговая логистика", money(logRub))}
                    {resRow("Общие затраты", money(totalCostsV))}
                  </div>
                </div>
              )}
            </section>

            {/* Блоки-плитки: Продвижение / Закупка / Фонд маркетинга / Аналитика / Размеры (раскрываются на весь экран) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <button onClick={() => setFullBlock("promo")} className="group relative flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:border-orange-300 hover:shadow-sm">
                <Maximize2 size={13} className="absolute right-3 top-3 text-neutral-300 transition group-hover:text-orange-500" />
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400"><span className="h-2 w-2 rounded-full bg-orange-400" /> РНП</div>
                <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">{(RNP_TASKS || []).filter((t) => !hiddenTasks[t.id]).length}<span className="ml-1 text-base font-semibold text-neutral-400">строк</span></div>
                <div className="text-[11px] text-neutral-400">план продвижения</div>
              </button>

              <div className="group relative h-full">
                <button onClick={() => setFullBlock("purchase")} className="flex h-full w-full flex-col rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:border-sky-300 hover:shadow-sm">
                  <Maximize2 size={13} className="absolute right-3 top-3 text-neutral-300 transition group-hover:text-sky-500" />
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400"><span className="h-2 w-2 rounded-full bg-sky-400" /> Закупка</div>
                  <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">{isNaN(puRubPerUnit) ? "—" : money(puRubPerUnit)}</div>
                  <div className="text-[11px] text-neutral-400">цена за единицу</div>
                  {mktBatches.length > 0 && (
                    <div className="mt-3 border-t border-neutral-100 pt-2.5">
                      <div className="mb-2 text-[11px] font-semibold text-neutral-500">{mktBatches.length} {pluralRu(mktBatches.length, "партия", "партии", "партий")} с товаром</div>
                      <div className="space-y-1.5">
                        {mktBatches.slice(0, 3).map((b) => { const ci = batchCycleInfo(b); const segs = ci.started ? ci.stages : [0, 1, 2, 3, 4]; return (
                          <div key={b.id} className="flex items-center gap-2">
                            <span className="w-5 shrink-0 text-[10px] font-bold text-neutral-400">{batchShort(b.name)}</span>
                            <span className="flex min-w-0 flex-1 gap-[3px]">
                              {segs.map((s, i) => { const bg = !ci.started ? "#e7e7ec" : ci.stages[i].done ? "#10b981" : i === ci.curIdx ? "#0ea5e9" : "#e7e7ec"; return <span key={i} className="h-[5px] flex-1 rounded-[3px]" style={{ background: bg }} />; })}
                            </span>
                            <span className={"shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase " + ci.st.cls}>{ci.st.label}</span>
                          </div>
                        ); })}
                        {mktBatches.length > 3 && <div className="pl-7 text-[10px] text-neutral-400">ещё {mktBatches.length - 3}</div>}
                      </div>
                    </div>
                  )}
                </button>
                {product.purchase?.link && (
                  <a href={product.purchase.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Открыть ссылку на закупку" className="absolute right-9 top-2.5 flex h-6 w-6 items-center justify-center rounded-md text-neutral-300 transition hover:bg-sky-50 hover:text-sky-600"><ExternalLink size={13} /></a>
                )}
              </div>

              <button onClick={() => setFullBlock("mktfund")} className="group relative flex h-full flex-col rounded-2xl border border-pink-200 bg-gradient-to-b from-white to-pink-50/40 p-4 text-left transition hover:border-pink-300 hover:shadow-sm">
                <Maximize2 size={13} className="absolute right-3 top-3 text-pink-200 transition group-hover:text-pink-500" />
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-pink-500"><Megaphone size={12} /> Фонд маркетинга</div>
                {mktBatches.length === 0 ? (
                  <><div className="mt-3 text-2xl font-bold tabular-nums text-neutral-300">—</div><div className="text-[11px] text-neutral-400">нет партий с товаром</div></>
                ) : (
                  <>
                    <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">{mktPct}<span className="text-base font-semibold text-neutral-400">%</span></div>
                    <div className="text-[11px] text-neutral-400">израсходовано из фонда</div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-pink-100"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, mktPct))}%`, background: "linear-gradient(90deg,#ec4899,#db2777)" }} /></div>
                    <div className="mt-1.5 flex justify-between text-[10px]"><span className="font-semibold text-pink-600">{money(mktTotalSpent)}</span><span className="text-neutral-400">из {money(mktTotalFund)}</span></div>
                  </>
                )}
              </button>

              <button onClick={() => setFullBlock("content")} className="group relative flex h-full flex-col rounded-2xl border border-emerald-200 bg-gradient-to-b from-white to-emerald-50/40 p-4 text-left transition hover:border-emerald-300 hover:shadow-sm">
                <Maximize2 size={13} className="absolute right-3 top-3 text-emerald-200 transition group-hover:text-emerald-500" />
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600"><ImagePlus size={12} /> Контент</div>
                <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">{contentPct}<span className="text-base font-semibold text-neutral-400">%</span></div>
                <div className="text-[11px] text-neutral-400">заполнено</div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-100"><div className="h-full rounded-full" style={{ width: `${contentPct}%`, background: "linear-gradient(90deg,#34d399,#16a34a)" }} /></div>
                <div className="mt-1.5 flex justify-between text-[10px]"><span className="font-semibold text-emerald-600">{contentCount} из {CONTENT_ITEMS.length}</span><span className="text-neutral-400">пунктов</span></div>
              </button>

              <button onClick={() => setFullBlock("analytics")} className="group relative flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:border-violet-300 hover:shadow-sm">
                <Maximize2 size={13} className="absolute right-3 top-3 text-neutral-300 transition group-hover:text-violet-500" />
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400"><span className="h-2 w-2 rounded-full bg-violet-400" /> Аналитика</div>
                <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">{aScore.rated > 0 ? <>{aScore.score10}<span className="text-base font-semibold text-neutral-400">/10</span></> : "—"}</div>
                <div className="text-[11px] text-neutral-400">рейтинг карточки</div>
                <div className="mt-2 text-[11px] text-neutral-400">{aScore.rated > 0 ? `оценено: ${aScore.rated}/${aScore.total}` : competitors.length > 0 ? `конкурентов: ${competitors.length}` : "появится после анализа"}</div>
              </button>

              <button onClick={() => setFullBlock("sizes")} className="group relative flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:border-teal-300 hover:shadow-sm">
                <Maximize2 size={13} className="absolute right-3 top-3 text-neutral-300 transition group-hover:text-teal-500" />
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400"><span className="h-2 w-2 rounded-full bg-teal-500" /> Размеры</div>
                {oneSize ? (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-teal-100 bg-teal-50 px-2.5 py-1 text-sm font-bold text-teal-700"><Target size={13} /> {oneLabel || "One size"}</div>
                ) : planSizes.length > 0 ? (
                  <>
                    <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">{planSizes.length} <span className="text-base font-semibold text-neutral-400">{planSizes.length === 1 ? "размер" : planSizes.length < 5 ? "размера" : "размеров"}</span></div>
                    <div className="mt-2 flex flex-wrap gap-1">{planSizes.slice(0, 8).map((s) => (<span key={s.id} className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-md border border-teal-100 bg-teal-50 px-1.5 text-[11px] font-bold text-teal-700">{s.name || "—"}</span>))}{planSizes.length > 8 && <span className="text-[11px] text-neutral-400">+{planSizes.length - 8}</span>}</div>
                  </>
                ) : (
                  <>
                    <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">—</div>
                    <div className="text-[11px] text-neutral-400">размеры не заданы</div>
                  </>
                )}
              </button>

              {(() => {
                const src = stockSrc(product, msData, ozStockData, wbWayData);
                const pc = src.pc, rows = src.msRows;
                const SZ = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
                const szOf = (it) => { const sfx = String(it.code || "").split("_")[1] || ""; return { k: sfx || "—" }; };
                const srt = rows.map((it) => ({ ...it, sz: szOf(it) })).sort((a, b) => (SZ.indexOf(a.sz.k) < 0 ? 99 : SZ.indexOf(a.sz.k)) - (SZ.indexOf(b.sz.k) < 0 ? 99 : SZ.indexOf(b.sz.k)) || a.sz.k.localeCompare(b.sz.k));
                const tot = src.all;
                const lvl = (n) => n <= 0 ? ["#dc2626", "#fee2e2"] : n <= 5 ? ["#c2410c", "#ffedd5"] : ["#15803d", "#dcfce7"];
                const isoD = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
                let o7 = 0; for (let i = 0; i < 7; i++) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); o7 += rnpWbCount(RNP_TASKS[0], product, isoD(d), wbOrders || {}); }
                const days = tot > 0 && o7 > 0 ? Math.round(tot / (o7 / 7)) : null;
                const warn = srt.length > 0 && srt.some((x) => (x.stock || 0) <= 5);
                const none = !pc || (!src.hasMs && src.wb === 0 && src.oz === 0);
                const parts = [["Склад", src.ms, "#16a34a"], ["WB", src.wb, "#cb11ab"], ["Озон", src.oz, "#005bff"]];
                return (
                  <button onClick={() => setFullBlock("stock")} className={"group relative flex h-full flex-col rounded-2xl border p-4 text-left transition hover:shadow-sm " + (none ? "border-neutral-200 bg-white hover:border-orange-300" : warn ? "border-orange-200 bg-gradient-to-b from-white to-orange-50/50 hover:border-orange-300" : "border-neutral-200 bg-white hover:border-orange-300")}>
                    <Maximize2 size={13} className="absolute right-3 top-3 text-neutral-300 transition group-hover:text-orange-500" />
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400"><span className="h-2 w-2 rounded-full bg-orange-500" /> Остатки</div>
                    {none ? (
                      <>
                        <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">—</div>
                        <div className="text-[11px] text-neutral-400">{!pc ? "у товара нет кода" : !msReady && !src.hasWb && !src.hasOz ? "источники не подключены" : "остатков не найдено (код " + pc + ")"}</div>
                      </>
                    ) : (
                      <>
                        <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">{tot} <span className="text-base font-semibold text-neutral-400">шт</span></div>
                        <div className="text-[11px] text-neutral-400">всего{days !== null ? " · хватит на ~" + days + " дн." : ""}</div>
                        {tot > 0 && <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-neutral-100">{parts.map(([n, v, c]) => v > 0 ? <div key={n} style={{ width: (v / tot * 100) + "%", background: c }} /> : null)}</div>}
                        <div className="mt-1.5 flex flex-wrap gap-x-2 text-[11px] text-neutral-500">{parts.map(([n, v, c]) => <span key={n}><i className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />{n} {v}</span>)}</div>
                        {srt.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{srt.slice(0, 8).map((x) => { const [c, bg] = lvl(x.stock || 0); return (<span key={x.id} className="rounded-md px-1.5 py-0.5 text-[11px] font-bold" style={{ color: c, background: bg }}>{x.sz.k} {x.stock || 0}</span>); })}</div>}
                      </>
                    )}
                  </button>
                );
              })()}
            </div>

            {/* Полноэкранный просмотр выбранного блока */}
            {fullBlock && (
              <div className="fixed inset-0 z-[70] flex items-start justify-center bg-neutral-900/40 p-3 sm:p-6" onClick={() => setFullBlock(null)}>
                <div className={"flex flex-col overflow-hidden rounded-2xl bg-white shadow-xl " + (fullBlock === "promo" ? "h-[96vh] max-h-[96vh] w-full max-w-[98vw]" : "max-h-[94vh] w-full " + (fullBlock === "analytics" ? "max-w-6xl" : (fullBlock === "mktfund" || fullBlock === "content" || fullBlock === "stock") ? "max-w-2xl" : "max-w-5xl"))} onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-5 py-3">
                    <h3 className="text-sm font-semibold text-neutral-800">{fullBlock === "promo" ? "РНП" : fullBlock === "purchase" ? "Закупка" : fullBlock === "sizes" ? "Размеры" : fullBlock === "stock" ? "Остатки" : fullBlock === "mktfund" ? "Фонд маркетинга" : fullBlock === "content" ? "Контент" : "Аналитика"}</h3>
                    {fullBlock === "sizes" && (
                      <div className="ml-2 inline-flex rounded-lg bg-neutral-100 p-0.5">
                        <button onClick={() => onSetOneSize(false)} className={"rounded-md px-3 py-1 text-xs font-semibold transition " + (!oneSize ? "bg-white text-teal-700 shadow-sm" : "text-neutral-500")}>Размерный ряд</button>
                        <button onClick={() => onSetOneSize(true)} className={"rounded-md px-3 py-1 text-xs font-semibold transition " + (oneSize ? "bg-white text-teal-700 shadow-sm" : "text-neutral-500")}>One size</button>
                      </div>
                    )}
                    <button onClick={() => setFullBlock(null)} className="ml-auto rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" title="Свернуть"><X size={18} /></button>
                  </div>
                  <div className="min-w-0 flex-1 overflow-auto p-5">

                    {fullBlock === "promo" && (
                      <GanttBlock product={product} hiddenTasks={hiddenTasks} onToggleTask={onToggleTask} rnpOrder={rnpOrder} onSetRnpOrder={onSetRnpOrder} startDate={rnpStartDate} days={rnpDays} onSetStartDate={onSetRnpStartDate} onSetDays={onSetRnpDays} onSetCell={onSetRnpCell} onSetEntries={onSetRnpEntries} onSetFill={onSetRnpFill} onSetFlag={onSetRnpFlag} onSetBudget={onSetRnpBudget} onSetSaleStart={onCalEntry} onOpenPopup={onOpenPopup} onOpenDB={onOpenDB} wbOrders={wbOrders} wbLoading={wbLoading} wbProgress={wbProgress} onFetchWb={onFetchWb} hideBudget monthNav />
                    )}

                    {fullBlock === "stock" && (() => {
                      const pc = String(product.code || "").trim();
                      const SZ = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
                      const rows = (msData && msData.items && pc ? msData.items.filter((it) => String(it.code || "").split("_")[0].trim() === pc) : []).map((it) => { const k = String(it.code || "").split("_")[1] || "—"; const m = /\((\d+)\)/.exec(it.name || ""); return { ...it, k, n: m ? m[1] : "" }; }).sort((a, b) => (SZ.indexOf(a.k) < 0 ? 99 : SZ.indexOf(a.k)) - (SZ.indexOf(b.k) < 0 ? 99 : SZ.indexOf(b.k)));
                      const fm = (v) => Math.round(v).toLocaleString("ru-RU");
                      const tot = rows.reduce((a, x) => a + (x.stock || 0), 0), res = rows.reduce((a, x) => a + (x.reserve || 0), 0), sum = rows.reduce((a, x) => a + (x.stock || 0) * (x.cost || 0), 0);
                      const col = (n) => n <= 0 ? "#dc2626" : n <= 5 ? "#c2410c" : "#15803d";
                      return (
                        <div>
                          {(() => { const sr = stockSrc(product, msData, ozStockData, wbWayData); return (
                            <div className="mb-4">
                              <div className="grid grid-cols-3 gap-2">
                                {[["Наш склад · МС", sr.ms, "#16a34a", sr.hasMs], ["Wildberries", sr.wb, "#cb11ab", sr.hasWb], ["Озон", sr.oz, "#005bff", sr.hasOz]].map(([n, v, c, has]) => (
                                  <div key={n} className="rounded-xl border border-neutral-200 p-3">
                                    <div className="text-[11px] font-bold text-neutral-500"><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: c }} />{n}</div>
                                    <div className="text-2xl font-extrabold tabular-nums text-neutral-900">{has ? v : "—"} <span className="text-xs font-semibold text-neutral-400">{has ? "шт" : "нет данных"}</span></div>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-x-4 rounded-xl bg-neutral-50 px-3 py-2 text-sm"><b>Всего {sr.all} шт</b><span className="text-[11px] text-neutral-400">WB и Озон отдают остаток по товару целиком, без разбивки по размерам</span></div>
                            </div>
                          ); })()}
                          <div className="mb-3 flex items-center gap-2">
                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700">МойСклад · {(msData && msData.store) || "НАШ СКЛАД / ОДЕЖДА"}</span>
                            <span className="ml-auto text-[11px] text-neutral-400">{msData && msData.updatedAt ? "обновлено " + new Date(msData.updatedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                            <button onClick={() => onFetchMs && onFetchMs()} disabled={!msReady || msLoading} className="rounded-md border border-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">{msLoading ? "…" : "⟳ обновить"}</button>
                          </div>
                          {rows.length === 0 ? (
                            <div className="py-10 text-center text-sm text-neutral-400">{!msReady ? "МойСклад не подключён (Настройки → Интеграции)" : !pc ? "У товара не заполнен код" : "Товар с кодом " + pc + " не найден на складе в МойСклад"}</div>
                          ) : (
                            <table className="w-full text-sm">
                              <thead><tr className="text-left text-[11px] font-bold text-neutral-400"><th className="px-2 py-1.5">Размер</th><th>Код МС</th><th className="text-right">Остаток</th><th className="text-right">Резерв</th><th className="text-right">Себест.</th><th className="text-right">Стоимость</th></tr></thead>
                              <tbody>
                                {rows.map((x) => (
                                  <tr key={x.id} className="border-t border-neutral-100">
                                    <td className="px-2 py-2 font-bold">{x.k}{x.n ? " (" + x.n + ")" : ""}</td>
                                    <td className="text-neutral-500">{x.code}</td>
                                    <td className="text-right font-bold tabular-nums" style={{ color: col(x.stock || 0) }}>{x.stock || 0}</td>
                                    <td className="text-right tabular-nums">{x.reserve || 0}</td>
                                    <td className="text-right tabular-nums" title={x.costSrc === "supply" ? "последняя приёмка" + (x.costAt ? " " + x.costAt : "") : "из отчёта МС (приёмка не найдена)"}>{x.cost ? fm(x.cost) + " ₽" : "—"}{x.costSrc !== "supply" && x.cost ? "*" : ""}</td>
                                    <td className="text-right tabular-nums">{x.cost ? fm((x.stock || 0) * x.cost) + " ₽" : "—"}</td>
                                  </tr>
                                ))}
                                <tr className="border-t border-neutral-200 font-extrabold"><td className="px-2 py-2">Итого</td><td /><td className="text-right tabular-nums">{tot}</td><td className="text-right tabular-nums">{res}</td><td /><td className="text-right tabular-nums">{fm(sum)} ₽</td></tr>
                              </tbody>
                            </table>
                          )}
                          <p className="mt-3 text-[11px] text-neutral-400">Остаток — только склад «НАШ СКЛАД / ОДЕЖДА». Себестоимость — цена последней приёмки в МойСклад.</p>
                        </div>
                      );
                    })()}

                    {fullBlock === "mktfund" && (
                      mktBatches.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
                          <Megaphone size={26} className="text-pink-300" />
                          <div className="text-sm font-semibold text-neutral-700">Этого товара пока нет ни в одной партии</div>
                          <div className="max-w-sm text-xs text-neutral-400">Добавьте товар в партию в блоке «Закупки» — и здесь появится фонд маркетинга по каждой партии.</div>
                        </div>
                      ) : (
                        <>
                          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Партия <span className="font-normal normal-case text-neutral-400">· только партии с этим товаром</span></div>
                          <div className="mb-5 flex flex-wrap gap-2">
                            {mktBatches.map((b) => {
                              const it = (b.items || []).find((x) => x.productId === product.id);
                              const sel = mktCur && b.id === mktCur.id;
                              return (
                                <button key={b.id} onClick={() => setMktBatchId(b.id)} className={"flex flex-col gap-0.5 rounded-xl border px-3.5 py-2 text-left transition " + (sel ? "border-pink-500 bg-pink-50/70 ring-2 ring-pink-100" : "border-neutral-200 bg-white hover:border-pink-200")}>
                                  <span className="text-[13px] font-bold text-neutral-800">{b.name || "Партия"}</span>
                                  <span className={"text-[11px] " + (sel ? "text-pink-600" : "text-neutral-400")}>{toNum(it?.qty) ? `${toNum(it.qty).toLocaleString("ru-RU")} шт` : "кол-во не указано"}</span>
                                </button>
                              );
                            })}
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 px-4 py-3">
                              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Кол-во <span className="rounded bg-sky-50 px-1.5 py-px text-[8.5px] font-bold text-sky-600">из партии</span></div>
                              <div className="text-xl font-bold tabular-nums text-neutral-900">{isNaN(mktQty) ? "—" : mktQty.toLocaleString("ru-RU")}<span className="ml-1 text-sm font-semibold text-neutral-400">шт</span></div>
                            </div>
                            <label className="rounded-xl border border-neutral-200 bg-white px-4 py-3 focus-within:border-pink-400 focus-within:ring-2 focus-within:ring-pink-100">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">ДРР, %</div>
                              <div className="flex items-baseline gap-1"><input value={mktItem?.mktDrr ?? ""} onChange={(e) => setMktField({ mktDrr: e.target.value })} inputMode="decimal" placeholder="0" className="w-full bg-transparent text-xl font-bold tabular-nums text-neutral-900 focus:outline-none" /><span className="text-sm font-semibold text-neutral-400">%</span></div>
                            </label>
                            <label className="rounded-xl border border-neutral-200 bg-white px-4 py-3 focus-within:border-pink-400 focus-within:ring-2 focus-within:ring-pink-100">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Плановая цена</div>
                              <div className="flex items-baseline gap-1"><input value={mktItem?.mktPlanPrice ?? ""} onChange={(e) => setMktField({ mktPlanPrice: e.target.value })} inputMode="decimal" placeholder="0" className="w-full bg-transparent text-xl font-bold tabular-nums text-neutral-900 focus:outline-none" /><span className="text-sm font-semibold text-neutral-400">₽</span></div>
                            </label>
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 px-4 py-3">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Выручка по плану</div>
                              <div className="text-xl font-bold tabular-nums text-neutral-900">{isNaN(mktRevenue) ? "—" : money(mktRevenue)}</div>
                            </div>
                          </div>

                          <div className="mt-3 rounded-2xl border border-pink-200 bg-gradient-to-b from-pink-50/80 to-pink-100/40 px-5 py-4">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-pink-600">Фонд маркетинга</div>
                            <div className="text-3xl font-bold tabular-nums text-pink-700">{money(mktFund)}</div>
                            <div className="mt-0.5 text-[11px] text-pink-500/80">= {isNaN(mktQty) ? "0" : mktQty.toLocaleString("ru-RU")} шт × {isNaN(mktPrice) ? "0" : mktPrice.toLocaleString("ru-RU")} ₽ × {isNaN(mktDrr) ? "0" : mktDrr}%</div>
                          </div>

                          <div className="mt-3 rounded-2xl border border-neutral-200 px-5 py-4">
                            <div className="mb-2.5 flex items-center justify-between">
                              <span className="text-[13px] font-semibold text-neutral-600">Израсходовано из фонда</span>
                              <span className="text-xl font-bold tabular-nums text-pink-600">{mktPctCur}%</span>
                            </div>
                            <div className="h-3 overflow-hidden rounded-full bg-pink-100"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, mktPctCur))}%`, background: mktOstatok < 0 ? "#ef4444" : "linear-gradient(90deg,#ec4899,#db2777)" }} /></div>
                            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                              <label className="flex items-center gap-2">
                                <span className="text-[11px] text-neutral-500">Потрачено</span>
                                <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 focus-within:border-pink-400 focus-within:ring-2 focus-within:ring-pink-100"><input value={mktItem?.mktSpent ?? ""} onChange={(e) => setMktField({ mktSpent: e.target.value })} inputMode="decimal" placeholder="0" className="w-20 bg-transparent text-right text-sm font-bold tabular-nums focus:outline-none" /><span className="text-[11px] text-neutral-400">₽</span></div>
                              </label>
                              <span className="text-[12px] text-neutral-500">Остаток <b className="tabular-nums" style={{ color: mktOstatok < 0 ? "#b91c1c" : "#15803d" }}>{money(mktOstatok)}</b></span>
                            </div>
                          </div>
                        </>
                      )
                    )}

                    {fullBlock === "purchase" && (
                      <>
                        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="flex flex-col justify-center gap-2 rounded-xl border border-neutral-100 bg-neutral-50/60 px-3 py-2.5">{resRow("Цена в руб за ед.", money(puRubPerUnit))}{resRow("Цена партии в рублях", money(puLotRub))}{resRow("Цена партии в юанях", yuan(puLotCny))}</div>
                          <div className="space-y-2">{puField("Цена в юанях за ед.", pu.priceCny, (v) => setPu("priceCny", v), "¥")}{puField("Вес, г", pu.weightG, (v) => setPu("weightG", v), "г")}{puField("Кол-во", pu.qty, (v) => setPu("qty", v), "шт")}</div>
                        </div>
                        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Курсы и комиссии</span>
                          {!ratesEdit ? (
                            <>
                              {[["¥", "cny", "₽"], ["$", "usd", "₽"], ["карго", "cargo", "$/кг"], ["комиссия", "commission", "%"], ["страховка", "insurance", "%"]].map(([label, key, suf]) => (
                                <span key={key} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-[13px]"><span className="mr-1.5 text-neutral-400">{label}</span><b className="tabular-nums text-neutral-800">{(unitConst || {})[key] || "—"} {suf}</b></span>
                              ))}
                              <button onClick={() => setRatesEdit(true)} title="Общие для всех товаров — меняются сразу везде" className="ml-auto text-[12.5px] font-bold text-blue-600 hover:underline">изменить</button>
                            </>
                          ) : (
                            <>
                              {[["Курс ¥", "cny", "₽"], ["Курс $", "usd", "₽"], ["Карго", "cargo", "$/кг"], ["Комиссия", "commission", "%"], ["Страховка", "insurance", "%"]].map(([label, key, suf]) => (
                                <label key={key} className="flex flex-col gap-0.5">
                                  <span className="text-[10px] text-neutral-500">{label}</span>
                                  <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 focus-within:border-neutral-400 focus-within:ring-2 focus-within:ring-orange-200">
                                    <input value={(unitConst || {})[key] ?? ""} onChange={(e) => onSetUnitConst && onSetUnitConst({ [key]: e.target.value })} inputMode="decimal" placeholder="0" className="w-14 bg-transparent text-right text-sm tabular-nums focus:outline-none" />
                                    <span className="text-[11px] text-neutral-400">{suf}</span>
                                  </div>
                                </label>
                              ))}
                              <button onClick={() => setRatesEdit(false)} className="ml-auto text-[12.5px] font-bold text-blue-600 hover:underline">готово</button>
                              <span className="w-full text-[11px] text-neutral-400">общие для всех товаров, меняются сразу везде</span>
                            </>
                          )}
                        </div>
                        {(isNaN(puCny) || isNaN(puUsd) || isNaN(puCargo)) && (<p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">Заполните курс юаня, курс доллара и ставку карго выше — иначе расчёт неполный.</p>)}
                        <div className="mb-4 flex flex-wrap items-start gap-2">
                          <span className="shrink-0 pt-2 text-xs text-neutral-600">Ссылки</span>
                          <div className="min-w-[220px] flex-[2] space-y-1.5">
                            {puLinks.map((l) => (
                              <div key={l.id} className="flex items-center gap-1.5">
                                <button onClick={() => setPuLinkMain(l.id)} title={l.main ? "Главная — по ней переходим" : "Сделать главной"} className={"shrink-0 transition " + (l.main ? "text-amber-500" : "text-neutral-300 hover:text-amber-400")}><Star size={16} fill={l.main ? "#f59e0b" : "none"} /></button>
                                <div className="relative flex-1">
                                  <input value={l.url} onChange={(e) => setPuLinkUrl(l.id, e.target.value)} placeholder="https://…" className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 pr-8 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />
                                  {String(l.url || "").trim() && <a href={l.url} target="_blank" rel="noreferrer" className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-sky-600" title="Открыть"><ExternalLink size={14} /></a>}
                                </div>
                                <button onClick={() => removePuLink(l.id)} title="Удалить ссылку" className="shrink-0 rounded p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-500"><X size={14} /></button>
                              </div>
                            ))}
                            <div className="flex items-center gap-1.5">
                              <span className="w-4 shrink-0" />
                              <input value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)} onBlur={commitLinkDraft} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitLinkDraft(); } }} placeholder={puLinks.length ? "добавить ещё ссылку…" : "https://…"} className="min-w-0 flex-1 rounded-lg border border-dashed border-neutral-200 px-3 py-1.5 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />
                              <span className="w-[22px] shrink-0" />
                            </div>
                          </div>
                          <span className="shrink-0 pt-2 text-xs text-neutral-600">Параметр</span>
                          <input value={pu.param ?? ""} onChange={(e) => setPu("param", e.target.value)} placeholder="цвет / размер" className="min-w-[120px] flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />
                        </div>
                        {mktBatches.length > 0 && (
                          <div className="mt-1">
                            <div className="mb-2.5 flex items-center gap-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Партии с этим товаром <span className="rounded-full bg-sky-100 px-2 text-[11px] font-bold text-sky-600">{mktBatches.length}</span></div>
                            <div className="space-y-2.5">
                              {mktBatches.map((b) => { const ci = batchCycleInfo(b); return (
                                <div key={b.id} className="rounded-xl border border-neutral-200 bg-white p-3.5">
                                  <div className="mb-3 flex items-center gap-2.5">
                                    <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold uppercase " + ci.st.cls}>{ci.st.label}</span>
                                    <span className="text-sm font-bold text-neutral-800">{b.name}</span>
                                    {ci.qty != null && <span className="text-xs font-medium text-neutral-400">· {ci.qty} шт</span>}
                                  </div>
                                  {!ci.started ? (
                                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-3 py-2 text-[12.5px] text-neutral-500"><span className="h-2 w-2 rounded-full bg-neutral-300" /> Производственный цикл ещё не запущен</div>
                                  ) : ci.completed ? (
                                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-[12.5px] font-medium text-emerald-700"><Check size={14} strokeWidth={3} /> Цикл производства завершён — все {ci.total} {pluralRu(ci.total, "этап", "этапа", "этапов")} пройдены</div>
                                  ) : (
                                    <>
                                      {(() => { const dd = cycleStageDates(b.cycle.startDate, ci.stages); const now = new Date(); const tISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; const late = ci.cur && dd[ci.cur.id] && dd[ci.cur.id].endISO < tISO; return (
                                        <>
                                          <div className="flex gap-[3px]">
                                            {ci.stages.map((s, i) => { const done = s.done; const cur = i === ci.curIdx; const d = dd[s.id] || {}; return (
                                              <div key={s.id} className="min-w-0" style={{ flex: Math.max(Number(s.days) || 1, 3) }}>
                                                <div className="flex h-[26px] items-center overflow-hidden whitespace-nowrap rounded-[7px] px-2.5 text-[12px] font-bold" style={done ? { background: "#16a34a", color: "#fff" } : cur ? { background: late ? "linear-gradient(90deg,#ef4444,#dc2626)" : "linear-gradient(90deg,#f59e0b,#ea580c)", color: "#fff" } : { background: "#f0f0f0", color: "#a3a3a3" }}>{done ? "✓ " : ""}{s.name}</div>
                                                <div className="mt-1 text-[11px] font-bold" style={{ color: cur ? (late ? "#dc2626" : "#c2410c") : "#737373" }}>{cur ? "до " : ""}{d.endStr || ""}</div>
                                              </div>
                                            ); })}
                                          </div>
                                        </>
                                      ); })()}
                                    </>
                                  )}
                                </div>
                              ); })}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {fullBlock === "content" && (
                      <>
                        <div className="mb-5 flex items-center gap-3">
                          <div className="text-3xl font-bold tabular-nums text-emerald-600">{contentPct}%</div>
                          <div className="flex-1">
                            <div className="h-2.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full" style={{ width: `${contentPct}%`, background: "linear-gradient(90deg,#34d399,#16a34a)" }} /></div>
                            <div className="mt-1.5 text-[12px] text-neutral-400">Готово {contentCount} из {CONTENT_ITEMS.length}</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {CONTENT_ITEMS.map((it) => { const on = !!contentDone[it.id]; return (
                            <button key={it.id} onClick={() => toggleContent(it.id)} className={"flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm transition " + (on ? "border-emerald-200 bg-emerald-50/50 text-neutral-500" : "border-neutral-200 text-neutral-700 hover:border-emerald-200 hover:bg-emerald-50/40")}>
                              <span className={"flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 " + (on ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300")}>{on && <Check size={13} strokeWidth={3} />}</span>
                              <span className={on ? "line-through" : ""}>{it.label}</span>
                            </button>
                          ); })}
                        </div>
                      </>
                    )}

                    {fullBlock === "analytics" && (
                      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,440px)_1fr]">
                        {/* ЛЕВО: оценочная карта по критериям */}
                        <CritScorecard
                          criteria={analyticsCriteria}
                          onSetCriteria={onSetCriteria}
                          analytics={product.analytics}
                          onSetAnalytics={onSetAnalytics}
                        />
                        {/* ПРАВО: сезонность + конкуренты */}
                        <div className="space-y-4">
                          <div className="rounded-2xl border border-neutral-200 p-4">
                            <div className="mb-2 flex items-center gap-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Сезонность и производство</h4>{product.seasonality?.points?.length > 0 && <span className="ml-auto rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">график построен</span>}</div>
                            <SeasonalityPanel data={product.seasonality} onChange={onSetSeasonality} cal={normalizeCalendar(product.calendar)} onSetComponents={onCalComponents} onSetBuffer={onCalBuffer} />
                          </div>
                          <div className="rounded-2xl border border-neutral-200 p-4">
                            <div className="mb-2 flex items-center gap-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Конкуренты</h4>{competitors.length > 0 && <span className="rounded-full bg-neutral-100 px-1.5 text-xs font-semibold text-neutral-500">{competitors.length}</span>}</div>
                            {competitors.length > 0 ? (<div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-6">{competitors.map((c) => (<CompetitorThumb key={c.id} url={c.url} onRemove={() => removeComp(c.id)} />))}</div>) : (<p className="text-xs text-neutral-400">Пока пусто. Вставьте ссылку на карточку конкурента на ВБ ниже.</p>)}
                            <div className="mt-3 flex items-center gap-2"><input value={compUrl} onChange={(e) => setCompUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComp()} placeholder="Ссылка на карточку ВБ…" className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" /><button onClick={addComp} disabled={!wbNmFromUrl(compUrl.trim())} className="rounded-lg inline-flex shrink-0 items-center gap-1 bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40"><Plus size={14} /> Добавить</button></div>
                          </div>
                        </div>
                      </div>
                    )}

                    {fullBlock === "sizes" && (
                      <SizesBoard
                        sizes={planSizes}
                        oneSize={oneSize}
                        oneLabel={oneLabel}
                        onSizesSet={onSizesSet}
                        onSetOneSize={onSetOneSize}
                        onSetOneLabel={onSetOneLabel}
                      />
                    )}

                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {promoDay && (
        <PromoDayEditor
          product={product}
          dkey={promoDay}
          wbOrders={wbOrders}
          onSetCell={onSetRnpCell}
          onSetFlag={onSetRnpFlag}
          onOpenPopup={onOpenPopup}
          onClose={() => setPromoDay(null)}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Настройки: статусы + задачи по умолчанию
---------------------------------------------------------------------------- */

/* ----------------------------------------------------------------------------
   Блок «Задачи» — календарь
---------------------------------------------------------------------------- */
const MONTHS_FULL = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const pad2 = (n) => String(n).padStart(2, "0");
const isoYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const parseISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };

// --- регулярность операционных задач ---
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Пн..Вс в терминах getDay()
const WD_LABEL = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 0: "Вс" };
const WD_FULL = { 1: "понедельник", 2: "вторник", 3: "среда", 4: "четверг", 5: "пятница", 6: "суббота", 0: "воскресенье" };
const ORD_LABEL = { 1: "Первый", 2: "Второй", 3: "Третий", 4: "Четвёртый", "-1": "Последний" };
const normRecur = (r) => ({
  mode: r && r.mode === "monthly" ? "monthly" : "weekly",
  weekdays: r && Array.isArray(r.weekdays) ? r.weekdays : [1, 2, 3, 4, 5],
  ordinal: r && r.ordinal != null ? r.ordinal : 1,
  weekday: r && r.weekday != null ? r.weekday : 1,
});
function occurrenceDays(recur, y, m) {
  const r = normRecur(recur);
  const dim = new Date(y, m + 1, 0).getDate();
  const out = [];
  if (r.mode === "weekly") {
    for (let d = 1; d <= dim; d++) if (r.weekdays.includes(new Date(y, m, d).getDay())) out.push(d);
  } else {
    const matches = [];
    for (let d = 1; d <= dim; d++) if (new Date(y, m, d).getDay() === r.weekday) matches.push(d);
    if (matches.length) {
      if (r.ordinal === -1) out.push(matches[matches.length - 1]);
      else if (matches[r.ordinal - 1]) out.push(matches[r.ordinal - 1]);
    }
  }
  return out;
}
function describeRecur(recur) {
  const r = normRecur(recur);
  if (r.mode === "monthly") return `${ORD_LABEL[r.ordinal] || "Первый"} ${WD_FULL[r.weekday] || ""} месяца`.trim();
  const wds = r.weekdays;
  if (wds.length === 7) return "каждый день";
  if (wds.length === 0) return "дни не выбраны";
  return WD_ORDER.filter((w) => wds.includes(w)).map((w) => WD_LABEL[w]).join(" · ");
}

function RecurEditor({ recur, onChange }) {
  const r = normRecur(recur);
  const toggleWd = (w) => { const s = new Set(r.weekdays); s.has(w) ? s.delete(w) : s.add(w); onChange({ ...r, weekdays: WD_ORDER.filter((x) => s.has(x)) }); };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-sm text-neutral-500">Повтор</span>
        <div className="inline-flex rounded-lg bg-neutral-100 p-0.5 text-xs font-semibold">
          <button onClick={() => onChange({ ...r, mode: "weekly" })} className={"rounded-md px-3 py-1 transition " + (r.mode === "weekly" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}>По дням недели</button>
          <button onClick={() => onChange({ ...r, mode: "monthly" })} className={"rounded-md px-3 py-1 transition " + (r.mode === "monthly" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}>По числу месяца</button>
        </div>
      </div>
      {r.mode === "weekly" ? (
        <div className="flex items-start gap-2">
          <span className="w-24 shrink-0 pt-1.5 text-sm text-neutral-500">Дни недели</span>
          <div className="flex flex-wrap gap-1">
            {WD_ORDER.map((w) => (
              <button key={w} onClick={() => toggleWd(w)} className={"flex h-8 w-9 items-center justify-center rounded-lg text-xs font-semibold transition " + (r.weekdays.includes(w) ? "bg-neutral-900 text-white" : "border border-neutral-200 text-neutral-500 hover:bg-neutral-50")}>{WD_LABEL[w]}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-sm text-neutral-500">Когда</span>
          <select value={r.ordinal} onChange={(e) => onChange({ ...r, ordinal: Number(e.target.value) })} className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none">
            {[1, 2, 3, 4, -1].map((o) => (<option key={o} value={o}>{ORD_LABEL[o]}</option>))}
          </select>
          <select value={r.weekday} onChange={(e) => onChange({ ...r, weekday: Number(e.target.value) })} className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none">
            {WD_ORDER.map((w) => (<option key={w} value={w}>{WD_FULL[w]}</option>))}
          </select>
          <span className="text-xs text-neutral-400">месяца</span>
        </div>
      )}
    </div>
  );
}

function OpTypeModal({ opType, onSave, onDelete, onClose }) {
  const [o, setO] = useState({ ...opType, recur: normRecur(opType.recur) });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-md bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">Операционная задача</h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <input value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} placeholder="Название…" autoFocus className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />
          <RecurEditor recur={o.recur} onChange={(r) => setO({ ...o, recur: r })} />
        </div>
        <div className="mt-5 flex items-center gap-2">
          <button onClick={() => o.name.trim() && onSave(o)} disabled={!o.name.trim()} className="rounded-lg flex-1 bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40">Сохранить</button>
          <button onClick={() => onDelete(o.id)} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-500 hover:bg-red-50 hover:text-red-600">Удалить</button>
        </div>
      </div>
    </div>
  );
}

const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return one; if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return few; return many; };
// ---- Вкладка «Контент»: наполненность карточек (матрица «товар × пункт чек-листа») ----
function ContentBoard({ products = [], batches = [], statuses = [], onToggle, onOpen }) {
  const [batchSel, setBatchSel] = useState([]); // выбранные партии (пусто = все товары)
  const [statusSel, setStatusSel] = useState([]); // статусы товара
  const [missing, setMissing] = useState(null); // id пункта, которого не хватает
  const [sort, setSort] = useState("new"); // new | asc | desc
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(null); // batches | status | missing | sort
  const SHORT = { main: "Главн.", sizegrid: "Размер.", extra: "Доп.", desc: "Опис.", specs: "Хар-ки", rich: "Рич", variants: "Вар. гл.", video: "Видео", bundle: "Связка" };
  const N = CONTENT_ITEMS.length;
  const doneOf = (p) => (p.content && typeof p.content === "object" ? p.content : {});
  const pctOf = (p) => { const d = doneOf(p); return Math.round(CONTENT_ITEMS.filter((i) => d[i.id]).length / N * 100); };
  const colOf = (v) => v >= 80 ? "#16a34a" : v >= 40 ? "#f59e0b" : v > 0 ? "#ef4444" : "#d4d4d8";
  const statusColor = (name) => (statuses.find((s) => s.name === name) || {}).color || "#a3a3a3";
  // товары выбранных партий
  const batchProductIds = useMemo(() => {
    if (!batchSel.length) return null;
    const set = new Set();
    (batches || []).filter((b) => batchSel.includes(b.id)).forEach((b) => (b.items || []).forEach((it) => it && it.productId && set.add(it.productId)));
    return set;
  }, [batchSel, batches]);
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let r = products.filter((p) => {
      if (batchProductIds && !batchProductIds.has(p.id)) return false;
      if (statusSel.length && !statusSel.includes(p.status)) return false;
      if (missing && doneOf(p)[missing]) return false;
      if (qq && !((p.name || "").toLowerCase().includes(qq) || (p.code || "").toLowerCase().includes(qq))) return false;
      return true;
    });
    r = r.slice().sort((a, b) => sort === "asc" ? pctOf(a) - pctOf(b) : sort === "desc" ? pctOf(b) - pctOf(a) : (b.createdAt || 0) - (a.createdAt || 0));
    return r;
  }, [products, batchProductIds, statusSel, missing, q, sort]); // eslint-disable-line
  const avg = rows.length ? Math.round(rows.reduce((s, p) => s + pctOf(p), 0) / rows.length) : 0;
  const full = rows.filter((p) => pctOf(p) === 100).length;
  const none = rows.filter((p) => pctOf(p) === 0).length;
  const perItem = CONTENT_ITEMS.map((it) => rows.length ? Math.round(rows.filter((p) => doneOf(p)[it.id]).length / rows.length * 100) : 0);
  const batchCount = (b) => new Set((b.items || []).map((it) => it && it.productId).filter(Boolean)).size;
  const toggleIn = (arr, setArr, v) => setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const Chip = ({ id, label, active, children, width = 260 }) => (
    <div className="relative">
      <button onClick={() => setMenu(menu === id ? null : id)} className={"inline-flex h-[30px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition " + (active ? "border-orange-300 bg-orange-50 text-orange-700" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50")}>{label}<ChevronDown size={13} className="opacity-60" /></button>
      {menu === id && (<><div className="fixed inset-0 z-10" onClick={() => setMenu(null)} /><div className="absolute left-0 z-20 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl" style={{ width }}>{children}</div></>)}
    </div>
  );
  const Opt = ({ on, onClick, children, right }) => (
    <button onClick={onClick} className={"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-neutral-50 " + (on ? "font-semibold text-neutral-900" : "text-neutral-600")}>
      <span className={"flex h-4 w-4 shrink-0 items-center justify-center rounded border " + (on ? "border-orange-500 bg-orange-500 text-white" : "border-neutral-300")}>{on && <Check size={11} strokeWidth={3.4} />}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>{right != null && <span className="text-[11px] text-neutral-400">{right}</span>}
    </button>
  );
  const sortLabel = sort === "asc" ? "Готовность: сначала меньше" : sort === "desc" ? "Готовность: сначала больше" : "Сначала новые";
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-100 px-4 py-3">
        <div className="flex items-baseline gap-1.5"><b className="text-[28px] font-extrabold leading-none tracking-tight" style={{ color: colOf(avg) === "#d4d4d8" ? "#a3a3a3" : colOf(avg) }}>{avg}%</b><span className="text-xs text-neutral-400">средняя наполненность</span></div>
        <div className="flex gap-4">
          {[[full, "готовы на 100%"], [none, "ещё не начаты"], [rows.length, "товаров в списке"]].map(([n, l], i) => <div key={i} className="flex flex-col leading-tight"><b className="text-base font-extrabold text-neutral-900">{n}</b><span className="text-[10.5px] text-neutral-400">{l}</span></div>)}
        </div>
        <span className="flex-1" />
        <div className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5"><Search size={13} className="text-neutral-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Код или название" className="w-36 border-0 bg-transparent p-0 text-xs outline-none placeholder:text-neutral-400" />{q && <button onClick={() => setQ("")} className="text-neutral-300 hover:text-neutral-600"><X size={12} /></button>}</div>
        <Chip id="batches" label={batchSel.length ? "Партии: " + batchSel.length : "Все партии"} active={batchSel.length > 0} width={300}>
          {(batches || []).length === 0 && <div className="px-2.5 py-3 text-xs text-neutral-400">Партий пока нет</div>}
          {(batches || []).map((b) => <Opt key={b.id} on={batchSel.includes(b.id)} onClick={() => toggleIn(batchSel, setBatchSel, b.id)} right={batchCount(b)}>{b.name || "Партия"}</Opt>)}
          {batchSel.length > 0 && <button onClick={() => setBatchSel([])} className="mt-1 w-full rounded-lg border-t border-neutral-100 px-2.5 pt-2 text-left text-xs font-semibold text-neutral-400 hover:text-neutral-700">Сбросить выбор</button>}
        </Chip>
        <Chip id="status" label={statusSel.length ? "Статусы: " + statusSel.length : "Все статусы"} active={statusSel.length > 0} width={240}>
          {(statuses || []).map((s) => <Opt key={s.name} on={statusSel.includes(s.name)} onClick={() => toggleIn(statusSel, setStatusSel, s.name)}><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}</Opt>)}
          {statusSel.length > 0 && <button onClick={() => setStatusSel([])} className="mt-1 w-full rounded-lg border-t border-neutral-100 px-2.5 pt-2 text-left text-xs font-semibold text-neutral-400 hover:text-neutral-700">Сбросить выбор</button>}
        </Chip>
        <Chip id="missing" label={missing ? "Нет: " + (CONTENT_ITEMS.find((i) => i.id === missing) || {}).label : "Чего не хватает"} active={!!missing} width={220}>
          {CONTENT_ITEMS.map((it) => <Opt key={it.id} on={missing === it.id} onClick={() => { setMissing(missing === it.id ? null : it.id); setMenu(null); }}>{it.label}</Opt>)}
        </Chip>
        <Chip id="sort" label={sortLabel} active={false} width={230}>
          {[["new", "Сначала новые"], ["asc", "Готовность: сначала меньше"], ["desc", "Готовность: сначала больше"]].map(([k, l]) => <button key={k} onClick={() => { setSort(k); setMenu(null); }} className={"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-neutral-50 " + (sort === k ? "font-semibold text-neutral-900" : "text-neutral-600")}>{sort === k ? <Check size={14} className="text-orange-600" /> : <span className="w-3.5" />}{l}</button>)}
        </Chip>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="px-4 py-2 text-left text-[9.5px] font-extrabold uppercase tracking-wider text-neutral-400">Товар</th>
            {CONTENT_ITEMS.map((it) => <th key={it.id} title={it.label} className="px-1 py-2 text-center text-[9.5px] font-extrabold uppercase tracking-wider text-neutral-400 whitespace-nowrap">{SHORT[it.id] || it.label}</th>)}
            <th className="py-2 pl-1 pr-4 text-left text-[9.5px] font-extrabold uppercase tracking-wider text-neutral-400">Готовность</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={N + 2} className="px-4 py-14 text-center text-sm text-neutral-400">Нет товаров под выбранные фильтры</td></tr>}
            {rows.map((p) => { const d = doneOf(p); const pc = pctOf(p); return (
              <tr key={p.id} className="border-t border-neutral-100 hover:bg-neutral-50/60">
                <td className="px-4 py-2">
                  <button onClick={() => onOpen && onOpen(p.id)} className="flex items-center gap-2.5 text-left">
                    <span className="flex h-11 w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-[7px] border border-neutral-200 bg-neutral-50 text-neutral-300">{p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={14} />}</span>
                    <span className="min-w-0"><span className="block text-[13px] font-bold leading-tight text-neutral-800">{p.code || "—"}</span><span className="block max-w-[260px] truncate text-[11px] text-neutral-400">{p.name || "Без названия"}</span></span>
                    {p.status && <span className="ml-1 hidden h-2 w-2 shrink-0 rounded-full sm:block" style={{ background: statusColor(p.status) }} title={p.status} />}
                  </button>
                </td>
                {CONTENT_ITEMS.map((it) => (
                  <td key={it.id} className="px-1 py-2 text-center">
                    <button onClick={() => onToggle && onToggle(p.id, it.id)} title={it.label} className={"inline-flex h-5 w-5 items-center justify-center rounded-[7px] border-[1.5px] transition " + (d[it.id] ? "border-green-500 bg-green-500 text-white" : "border-neutral-300 bg-white text-transparent hover:border-green-400")}><Check size={12} strokeWidth={3.4} /></button>
                  </td>
                ))}
                <td className="py-2 pl-1 pr-4"><div className="flex min-w-[120px] items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full" style={{ width: pc + "%", background: colOf(pc) }} /></div><b className="w-9 text-right text-xs font-extrabold" style={{ color: colOf(pc) === "#d4d4d8" ? "#a3a3a3" : colOf(pc) }}>{pc}%</b></div></td>
              </tr>
            ); })}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="border-t border-neutral-200 bg-neutral-50">
            <td className="px-4 py-2 text-[11.5px] font-extrabold text-neutral-500">Заполнено по пункту</td>
            {perItem.map((v, i) => <td key={i} className="px-1 py-2 text-center text-[11.5px] font-extrabold text-neutral-600">{v}%</td>)}
            <td />
          </tr></tfoot>}
        </table>
      </div>
    </div>
  );
}

// ---- Отчёты: итоги по выполненным задачам и подзадачам за день / неделю / месяц ----
function DaySummary({ jobs = [], opTypes = [], opDone = {}, people = [], products = [], batches = [], onClose }) {
  const [mode, setMode] = useState("day"); // day | week | month
  const [anchor, setAnchor] = useState(() => new Date());
  const [copied, setCopied] = useState(null);
  const personById = Object.fromEntries((people || []).map((p) => [p.id, p]));
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const range = (() => {
    const a = startOfDay(anchor);
    if (mode === "day") return [a, a];
    if (mode === "week") { const dow = (a.getDay() + 6) % 7; const s = new Date(a.getFullYear(), a.getMonth(), a.getDate() - dow); return [s, new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6)]; }
    return [new Date(a.getFullYear(), a.getMonth(), 1), new Date(a.getFullYear(), a.getMonth() + 1, 0)];
  })();
  const fromS = isoYMD(range[0]), toS = isoYMD(range[1]);
  const inR = (iso) => iso >= fromS && iso <= toS;
  const step = (dir) => setAnchor((a) => mode === "day" ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + dir) : mode === "week" ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1));
  const fmtR = (d) => d.getDate() + " " + MONTHS_GEN[d.getMonth()];
  const todayS = isoYMD(new Date());
  const title = mode === "day"
    ? fmtR(range[0]) + ", " + WD_LABEL[range[0].getDay()].toLowerCase()
    : mode === "week" ? fmtR(range[0]) + " — " + fmtR(range[1]) : MONTHS_FULL[range[0].getMonth()] + " " + range[0].getFullYear();
  const hhmm = (ts) => { const d = new Date(ts); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };
  const dm = (iso) => iso.slice(8, 10) + "." + iso.slice(5, 7);

  // собираем записи по исполнителям
  const per = {}; // pid -> { sections: {type: items[]}, tasks, subs }
  const slot = (pid) => (per[pid] = per[pid] || { sections: { purchase: [], project: [], op: [], product: [] }, tasks: 0, subs: 0 });
  let onTime = 0, late = 0, totalTasks = 0, totalSubs = 0;
  (jobs || []).forEach((j) => {
    if (!j || j.deletedAt) return;
    const log = Array.isArray(j.log) ? j.log : [];
    const doneEv = log.filter((e) => e.kind === "done" && e.ts && inR(isoYMD(new Date(e.ts)))).sort((a, b) => (a.ts < b.ts ? 1 : -1))[0];
    const seen = {};
    const cl0 = Array.isArray(j.checklist) ? j.checklist : [];
    // подзадача, у которой сейчас снят чек-бокс (отмечена по ошибке), в отчёт не попадает
    const stillDone = (e) => { const c = (e.cid && cl0.find((x) => x.id === e.cid)) || cl0.find((x) => (x.text || "").trim() === (e.text || "").trim()); return !c || !!c.done; };
    const subs = log.filter((e) => e.kind === "sub_done" && e.ts && inR(isoYMD(new Date(e.ts))) && (e.text || "").trim() && stillDone(e)).filter((e) => { const k = (e.cid || e.text.trim()); if (seen[k]) return false; seen[k] = 1; return true; });
    if (!doneEv && !subs.length) return;
    const t = jobType(j);
    const prod = j.productId ? (products || []).find((p) => p.id === j.productId) : null;
    const batch = j.batchId ? (batches || []).find((b) => b.id === j.batchId) : null;
    const ctx = t === "product" ? (prod ? [prod.code, prod.name].filter(Boolean).join(" · ") : "") : (batch ? batch.name || "" : "");
    const doneS = doneEv ? isoYMD(new Date(doneEv.ts)) : null;
    const lateDays = doneS && j.date && doneS > j.date ? Math.round((new Date(doneS) - new Date(j.date)) / 86400000) : 0;
    const item = { kind: "job", id: j.id, title: t === "product" ? stripProdSuffix(j.title, prod && prod.name) : (j.title || "—"), ctx, ts: doneEv ? doneEv.ts : subs[0].ts, done: !!doneEv, lateDays, subs: subs.map((e) => e.text.trim()) };
    const ids = jobAssignees(j); const owners = ids.length ? ids : ["__none"];
    owners.forEach((pid) => { const s = slot(pid); s.sections[t].push(item); if (doneEv) s.tasks += 1; s.subs += subs.length; });
    if (doneEv) { totalTasks += 1; if (lateDays > 0) late += 1; else onTime += 1; }
    totalSubs += subs.length;
  });
  (opTypes || []).forEach((op) => {
    const days = Object.keys(opDone[op.id] || {}).filter((d) => opDone[op.id][d] && inR(d)).sort();
    if (!days.length) return;
    const pid = op.assignee || "__none";
    const s = slot(pid);
    days.forEach((d) => s.sections.op.push({ kind: "op", id: op.id + d, title: op.name || "—", ctx: "", ts: d, done: true, lateDays: 0, subs: [], day: d }));
    s.tasks += days.length; totalTasks += days.length; onTime += days.length;
  });
  const persons = Object.keys(per).sort((a, b) => per[b].tasks - per[a].tasks);
  const SEC = [["project", "Проектные"], ["op", "Операционные"], ["product", "Товары"]];
  const nameOf = (pid) => pid === "__none" ? "Без исполнителя" : profileLabel(personById[pid]);
  const when = (it) => it.kind === "op" ? (mode === "day" ? "" : dm(it.day)) : (mode === "day" ? hhmm(it.ts) : dm(isoYMD(new Date(it.ts))) + " " + hhmm(it.ts));
  const textFor = (pid) => {
    const s = per[pid]; const out = [];
    out.push(nameOf(pid) + " — " + title + ", закрыто " + s.tasks + " " + plural(s.tasks, "задача", "задачи", "задач") + (s.subs ? " (" + s.subs + " " + plural(s.subs, "подзадача", "подзадачи", "подзадач") + ")" : ""));
    SEC.forEach(([k, lab]) => {
      const arr = s.sections[k]; if (!arr.length) return;
      out.push(""); out.push(lab);
      arr.forEach((it) => {
        const subsTxt = it.subs.length ? " (подзадачи: " + it.subs.join(", ") + ")" : "";
        out.push((it.done ? "✓ " : "• ") + it.title + (it.ctx ? " — " + it.ctx : "") + (it.lateDays ? " (+" + it.lateDays + " дн)" : "") + subsTxt);
      });
    });
    return out.join("\n");
  };
  const copy = async (key, text) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600); } catch {} };
  const ModeBtn = ({ k, label }) => <button onClick={() => setMode(k)} className={"h-[30px] rounded-lg border px-2.5 text-xs font-bold transition " + (mode === k ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50")}>{label}</button>;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/35 p-3 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-neutral-100 px-5 py-3.5">
          <h2 className="text-lg font-extrabold tracking-tight text-neutral-900">Отчеты</h2>
          <div className="ml-2 flex items-center gap-1">
            <button onClick={() => step(-1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><ChevronRight size={15} style={{ transform: "rotate(180deg)" }} /></button>
            <span className="flex h-[30px] items-center gap-2 rounded-lg border border-neutral-200 px-3 text-[13px] font-bold capitalize text-neutral-800">{title}{mode === "day" && fromS === todayS && <span className="text-[11px] font-semibold normal-case text-neutral-400">сегодня</span>}</span>
            <button onClick={() => step(1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><ChevronRight size={15} /></button>
          </div>
          <ModeBtn k="day" label="День" /><ModeBtn k="week" label="Неделя" /><ModeBtn k="month" label="Месяц" />
          <span className="flex-1" />
          {persons.length > 0 && <button onClick={() => copy("all", persons.map(textFor).join("\n\n"))} className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><Copy size={13} />{copied === "all" ? "Скопировано" : "Копировать всё"}</button>}
          <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" title="Закрыть"><X size={18} /></button>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-neutral-100 bg-neutral-50 px-5 py-3">
          {[[totalTasks, plural(totalTasks, "задача закрыта", "задачи закрыто", "задач закрыто"), ""], [totalSubs, plural(totalSubs, "подзадача", "подзадачи", "подзадач"), ""], [onTime, "в срок", "text-emerald-600"], [late, "с опозданием", late ? "text-red-600" : ""], [persons.length, plural(persons.length, "исполнитель", "исполнителя", "исполнителей"), ""]].map(([n, l, c], i) => (
            <div key={i} className="flex flex-col"><b className={"text-xl font-extrabold leading-tight tracking-tight " + (c || "text-neutral-900")}>{n}</b><span className="text-[11px] text-neutral-400">{l}</span></div>
          ))}
        </div>
        {persons.length === 0 ? (
          <div className="px-5 py-14 text-center text-sm text-neutral-400">За этот период закрытых задач нет</div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 p-4 sm:p-5 md:grid-cols-2">
            {persons.map((pid) => { const s = per[pid]; return (
              <div key={pid} className="overflow-hidden rounded-2xl border border-neutral-200">
                <div className="flex items-center gap-2.5 border-b border-neutral-100 px-3.5 py-2.5">
                  <PersonAvatar p={personById[pid]} size={32} />
                  <div className="min-w-0 leading-tight"><div className="truncate text-sm font-extrabold text-neutral-900">{nameOf(pid)}</div><div className="mt-0.5 text-[11px] font-semibold text-neutral-400">{s.tasks} {plural(s.tasks, "задача", "задачи", "задач")}{s.subs ? " · " + s.subs + " " + plural(s.subs, "подзадача", "подзадачи", "подзадач") : ""}</div></div>
                  <div className="ml-auto text-right leading-none"><b className="text-[22px] font-extrabold tracking-tight">{s.tasks}</b><div className="mt-0.5 text-[10px] font-semibold text-neutral-400">закрыто</div></div>
                  <button onClick={() => copy(pid, textFor(pid))} title="Копировать отчёт" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50">{copied === pid ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}</button>
                </div>
                <div className="pb-2">
                  {SEC.map(([k, lab]) => { const arr = s.sections[k]; if (!arr.length) return null; return (
                    <div key={k}>
                      <div className="px-3.5 pb-0.5 pt-2.5 text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">{lab}</div>
                      {arr.sort((a, b) => (a.ts < b.ts ? -1 : 1)).map((it) => (
                        <div key={it.id + (it.day || "")} className="px-3.5 py-1">
                          <div className="flex items-start gap-2.5">
                            <span className={"mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] " + (it.done ? "bg-green-500" : "border border-neutral-300")}>{it.done && <Check size={11} strokeWidth={3.4} className="text-white" />}</span>
                            <div className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-neutral-800">
                              {it.title}
                              {(it.ctx || it.lateDays > 0) && <div className="text-[11px] font-medium text-neutral-400">{it.ctx}{it.lateDays > 0 && <span className="ml-1.5 rounded-md bg-red-50 px-1.5 py-px text-[10px] font-extrabold text-red-600">+{it.lateDays} дн</span>}</div>}
                            </div>
                            <span className="shrink-0 text-[11px] font-semibold text-neutral-400">{when(it)}</span>
                          </div>
                          {it.subs.length > 0 && <div className="mt-0.5 pl-[26px]">{it.subs.map((t, i) => <div key={i} className="flex items-center gap-1.5 py-px text-xs text-neutral-500"><span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-[4px] bg-green-100"><Check size={8} strokeWidth={4} className="text-green-600" /></span>{t}</div>)}</div>}
                        </div>
                      ))}
                    </div>
                  ); })}
                </div>
              </div>
            ); })}
          </div>
        )}
        <div className="border-t border-neutral-100 bg-neutral-50 px-5 py-3 text-[11px] text-neutral-400">Считаются задачи и подзадачи, отмеченные выполненными в выбранный период. Задачи, закрытые до появления журнала событий, в отчёт не попадают.</div>
      </div>
    </div>
  );
}

function TasksView({ focusLine = "", onFocusLine, jobs, taskLabels, taskTags = [], people = [], myId = null, onUpdateJob, products, batches = [], opTypes, opDone, onToggleDone, onEditOp, onAddJob, onOpen, onOpenBatch }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [view, setView] = useState("kanban"); // kanban | list | cal | gantt
  const [secDone, setSecDone] = useState(() => { try { return JSON.parse(localStorage.getItem("rnp-gantt-showdone") || "{}"); } catch { return {}; } });
  const toggleSecDone = (id) => setSecDone((c) => { const n = { ...c, [id]: !c[id] }; try { localStorage.setItem("rnp-gantt-showdone", JSON.stringify(n)); } catch {} return n; });
  const [groupBy, setGroupBy] = useState(() => { const g = lsGet("rnp.kanbanGroup", "status"); return g === "label" ? "status" : g; }); // status | priority
  const [kanbanSort, setKanbanSort] = useState(() => lsGet("rnp.kanbanSort", "created")); // created | priority
  const [kanbanWide, setKanbanWide] = useState(() => lsGet("rnp.kanbanWide", false)); // широкий вид столбцов (2 подколонки по приоритету)
  const [fltPrio, setFltPrio] = useState([]);
  const [fltMark, setFltMark] = useState([]); // метки (мультивыбор): urgent|edu|long|__none
  const [fltStatus, setFltStatus] = useState([]); // статусы (мультивыбор): wait|progress|done
  const [fltTag, setFltTag] = useState(null);
  const [fltAssignee, setFltAssignee] = useState([]); // исполнители (мультивыбор), "__none" — не назначен
  const mineInitRef = useRef(false);
  useEffect(() => { if (myId && !mineInitRef.current) { mineInitRef.current = true; setFltAssignee([myId]); } }, [myId]); // по умолчанию — «Свои»
  const togV = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const iAmOnly = !!myId && fltAssignee.length === 1 && fltAssignee[0] === myId;
  const resetFilters = () => { setFltPrio([]); setFltMark([]); setFltStatus([]); setFltAssignee([]); };
  const [fltType, setFltType] = useState("project"); // тип задачи всегда выбран (у каждого — свой набор видов); по умолчанию проектные
  const [fltOpen, setFltOpen] = useState(null);
  const [fltSearch, setFltSearch] = useState(""); // поиск по названию задачи
  const [searchOpen, setSearchOpen] = useState(false); // лупа развёрнута в поле
  const [focusMode, setFocusMode] = useState(false); // режим ФОКУС (повестка на сегодня)
  const [reportsOpen, setReportsOpen] = useState(false); // окно «Отчеты» (итоги по выполненным задачам)
  const todayStr = isoYMD(now);
  useEffect(() => lsSet("rnp.kanbanGroup", groupBy), [groupBy]);
  useEffect(() => lsSet("rnp.kanbanSort", kanbanSort), [kanbanSort]);
  useEffect(() => lsSet("rnp.kanbanWide", kanbanWide), [kanbanWide]);

  const labelColor = (id) => (taskLabels || []).find((l) => l.id === id)?.color || "#cbd5e1";
  const prevM = () => setYm((s) => { const d = new Date(s.y, s.m - 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const nextM = () => setYm((s) => { const d = new Date(s.y, s.m + 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const goToday = () => setYm({ y: now.getFullYear(), m: now.getMonth() });

  const isBoard = view === "kanban" || view === "prod";
  const prodType = fltType === "product";
  // наборы видов зависят от типа задачи
  const viewOptions =
    fltType === "product" ? [["kanban", Columns3, "Канбан"], ["gantt", GanttChart, "Гант"], ["prod", Box, "Товары"]]
    : fltType === "op" ? [["gantt", GanttChart, "Гант"], ["today", CalendarCheck, "Сегодня"]] // операционные — Гант + Сегодня
    : [["kanban", Columns3, "Канбан"], ["gantt", GanttChart, "Гант"]]; // Календарь/Список убраны
  useEffect(() => { if (fltType === "product") setView("prod"); /* товары — сразу вид «Товары» (по задачам) */ else if (!viewOptions.some(([id]) => id === view)) setView(viewOptions[0][0]); }, [fltType]);
  const GROUP_LABELS = { status: "Статусу", priority: "Приоритету" };
  const activeFilters = (fltPrio.length ? 1 : 0) + (fltAssignee.length ? 1 : 0) + (fltMark.length ? 1 : 0) + (fltStatus.length ? 1 : 0);
  const typeOf = (j) => (j && j.type === "op") ? "op" : jobType(j);
  const matchType = (j) => !fltType || typeOf(j) === fltType;
  const fJobs = jobs.filter((j) => {
    if (!matchType(j)) return false;
    if (fltPrio.length && !fltPrio.includes(j.priority || null)) return false;
    if (fltAssignee.length) { const as = jobAssignees(j); if (!((fltAssignee.includes("__none") && as.length === 0) || as.some((a) => fltAssignee.includes(a)))) return false; }
    if (fltMark.length && !((fltMark.includes("__none") && !j.mark) || fltMark.includes(j.mark || null))) return false;
    if (fltStatus.length && !fltStatus.includes(stageOf(j))) return false;
    if (fltSearch.trim() && !String(j.title || "").toLowerCase().includes(fltSearch.trim().toLowerCase())) return false;
    return true;
  });
  // операционные, отфильтрованные по исполнителю (для Ганта и вида «Сегодня»)
  const opTypesF = fltAssignee.length ? (opTypes || []).filter((op) => (fltAssignee.includes("__none") && !op.assignee) || fltAssignee.includes(op.assignee || null)) : (opTypes || []);

  return (
    <div className="flex flex-col rounded-xl border border-neutral-200 bg-white p-3 shadow-sm sm:p-4" style={{ maxHeight: `calc(${zvh(100)} - 128px)` }}>
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-neutral-900">Задачи</h2>
        <div className="ml-3 inline-flex rounded-lg bg-neutral-100 p-0.5" title="Быстрый фильтр по типу задачи">
          {TASK_TYPE_META.map(({ key, label, Icon, tint }) => { const on = fltType === key && !focusMode; return (
            <button key={key} title={label} onClick={() => { setFocusMode(false); setFltType(key); }} className="flex h-7 w-8 items-center justify-center rounded-md transition" style={on ? { background: "#fff", color: tint, boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "#9ca3af" }}><Icon size={15} /></button>
          ); })}
        </div>
        {!focusMode && <div className="inline-flex rounded-lg bg-neutral-100 p-0.5">
          {viewOptions.map(([id, Icon, title]) => (
              <button key={id} onClick={() => setView(id)} title={title} className={"flex h-7 w-8 items-center justify-center rounded-md transition " + (view === id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-400 hover:text-neutral-600")}><Icon size={16} /></button>
          ))}
        </div>}
        <button onClick={() => setFocusMode((f) => !f)} title="Фокус — повестка на сегодня" className={"group inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-extrabold transition " + (focusMode ? "text-white shadow-[0_2px_8px_rgba(225,29,72,0.35)]" : "border border-neutral-200 text-neutral-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600")} style={focusMode ? { background: "#e11d48" } : undefined}><Target size={15} className={focusMode ? "" : "text-neutral-400 transition group-hover:text-rose-600"} />ФОКУС</button>
        <button onClick={() => setReportsOpen(true)} title="Итоги — отчёт по выполненным задачам" aria-label="Итоги" className={"group inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-extrabold transition " + (reportsOpen ? "bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)]" : "border border-neutral-200 text-neutral-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600")}><ClipboardCheck size={15} className={reportsOpen ? "" : "text-neutral-400 transition group-hover:text-blue-600"} />ИТОГИ</button>
        {reportsOpen && <DaySummary jobs={jobs} opTypes={opTypes} opDone={opDone} people={people} products={products} batches={batches} onClose={() => setReportsOpen(false)} />}
        {!focusMode && <div className="ml-auto flex flex-wrap items-center gap-2">
          {searchOpen || fltSearch ? (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-900 bg-white px-2.5 py-1.5" style={{ width: 210 }}>
              <Search size={14} className="shrink-0 text-neutral-400" />
              <input
                autoFocus
                value={fltSearch}
                onChange={(e) => setFltSearch(e.target.value)}
                onBlur={() => { if (!fltSearch.trim()) setSearchOpen(false); }}
                onKeyDown={(e) => { if (e.key === "Escape") { setFltSearch(""); setSearchOpen(false); } }}
                placeholder="Поиск по названию…"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-neutral-800 outline-none placeholder:text-neutral-400"
              />
              <button onClick={() => { setFltSearch(""); setSearchOpen(false); }} className="shrink-0 text-neutral-300 hover:text-neutral-600" title="Очистить"><X size={14} /></button>
            </div>
          ) : (
            <button onClick={() => setSearchOpen(true)} title="Поиск по названию" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><Search size={15} /></button>
          )}
          {!focusMode && view !== "kanban" && view !== "prod" && view !== "today" && (fltType === "project" || fltType === "purchase") && (() => { const sid = fltType === "project" ? "gen" : "pur"; const on = !!secDone[sid]; return (
            <button onClick={() => toggleSecDone(sid)} title={on ? "Скрыть выполненные" : "Показать выполненные"} className={"inline-flex h-8 w-8 items-center justify-center rounded-lg border " + (on ? "border-neutral-300 bg-neutral-100 text-neutral-700" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50")}>{on ? <Eye size={15} /> : <EyeOff size={15} />}</button>
          ); })()}
          {myId && (
            <button onClick={() => setFltAssignee(iAmOnly ? [] : [myId])} title="Только мои задачи" className={"inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold " + (iAmOnly ? "border-orange-300 bg-orange-50 text-orange-700" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50")}><User size={14} className={iAmOnly ? "" : "text-neutral-400"} />Свои</button>
          )}
          {view === "kanban" && (
            <div className="relative">
              <button onClick={() => setFltOpen(fltOpen === "group" ? null : "group")} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50" title={"Колонки по: " + (GROUP_LABELS[groupBy] || "")}><Columns3 size={15} /></button>
              {fltOpen === "group" && (<><div className="fixed inset-0 z-10" onClick={() => setFltOpen(null)} /><div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Колонки по</div>
                {[["status", "Статусу"], ["priority", "Приоритету"]].map(([k, lbl]) => <button key={k} onClick={() => { setGroupBy(k); }} className={"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-neutral-50 " + (groupBy === k ? "font-semibold text-neutral-900" : "text-neutral-600")}>{groupBy === k ? <Check size={14} className="text-orange-600" /> : <span className="w-3.5" />}{lbl}</button>)}
                <div className="my-1 h-px bg-neutral-100" />
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Сортировка карточек</div>
                {[["created", "По дате добавления"], ["priority", "По приоритету"]].map(([k, lbl]) => <button key={k} onClick={() => { setKanbanSort(k); }} className={"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-neutral-50 " + (kanbanSort === k ? "font-semibold text-neutral-900" : "text-neutral-600")}>{kanbanSort === k ? <Check size={14} className="text-orange-600" /> : <span className="w-3.5" />}{lbl}{k === "priority" && <span className="ml-auto text-[10px] font-normal text-neutral-400">выс. сверху</span>}</button>)}
                {groupBy === "status" && <>
                  <div className="my-1 h-px bg-neutral-100" />
                  <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Вид столбцов</div>
                  {[[false, "Обычный", ""], [true, "Широкий", "2 колонки"]].map(([v, lbl, hint]) => <button key={String(v)} onClick={() => { setKanbanWide(v); }} className={"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-neutral-50 " + (kanbanWide === v ? "font-semibold text-neutral-900" : "text-neutral-600")}>{kanbanWide === v ? <Check size={14} className="text-orange-600" /> : <span className="w-3.5" />}{lbl}{hint && <span className="ml-auto text-[10px] font-normal text-neutral-400">{hint}</span>}</button>)}
                </>}
              </div></>)}
            </div>
          )}
          {(isBoard || view === "gantt" || view === "today") && (
            <div className="relative">
              <button onClick={() => setFltOpen(fltOpen === "filter" ? null : "filter")} title="Фильтр" className={"relative inline-flex h-8 w-8 items-center justify-center rounded-lg border " + (activeFilters ? "border-orange-300 bg-orange-50 text-orange-700" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50")}><Filter size={15} />{activeFilters > 0 && <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold text-white">{activeFilters}</span>}</button>
              {fltOpen === "filter" && (<><div className="fixed inset-0 z-10" onClick={() => setFltOpen(null)} /><div className="absolute right-0 z-20 mt-1 w-[340px] rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-xl">
                <div className="mb-2.5 flex items-center"><b className="text-[14px] text-neutral-900">Фильтры</b>{activeFilters > 0 && <button onClick={resetFilters} className="ml-auto text-[12px] font-bold text-blue-600 hover:underline">Сбросить всё</button>}</div>
                <div className="mb-3">
                  <div className="mb-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-neutral-400">Статус</div>
                  <div className="flex gap-0.5 rounded-[10px] bg-neutral-100 p-[3px]">
                    <button onClick={() => setFltStatus([])} className={"flex-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-[12.5px] font-bold transition " + (fltStatus.length === 0 ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800")}>Все</button>
                    {[["wait", "Ожидает"], ["progress", "В процессе"], ["done", "Готово"]].map(([k, lbl]) => <button key={k} onClick={() => setFltStatus(togV(fltStatus, k))} className={"flex-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-[12.5px] font-bold transition " + (fltStatus.includes(k) ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800")}>{lbl}</button>)}
                  </div>
                </div>
                <div className="mb-3">
                  <div className="mb-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-neutral-400">Приоритет</div>
                  <div className="flex gap-0.5 rounded-[10px] bg-neutral-100 p-[3px]">
                    <button onClick={() => setFltPrio([])} className={"flex-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-[12.5px] font-bold transition " + (fltPrio.length === 0 ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800")}>Все</button>
                    {Object.keys(PRIORITIES).map((k) => <button key={k} onClick={() => setFltPrio(togV(fltPrio, k))} className={"flex-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-[12.5px] font-bold transition " + (fltPrio.includes(k) ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800")}>{PRIORITIES[k].label}</button>)}
                  </div>
                </div>
                <div className="mb-3">
                  <div className="mb-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-neutral-400">Исполнитель</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(people || []).length === 0 && <span className="text-[11px] text-neutral-400">Исполнителей нет</span>}
                    {(people || []).map((pr) => { const on = fltAssignee.includes(pr.id); return <button key={pr.id} onClick={() => setFltAssignee(togV(fltAssignee, pr.id))} title={profileLabel(pr)} className={"flex w-[58px] flex-col items-center gap-1 rounded-xl border-[1.5px] py-1.5 text-[11px] font-bold transition " + (on ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-500 hover:bg-neutral-50")}><PersonAvatar p={pr} size={30} /><span className="max-w-full truncate px-0.5">{profileLabel(pr)}</span></button>; })}
                    {(people || []).length > 0 && <button onClick={() => setFltAssignee(togV(fltAssignee, "__none"))} className={"flex w-[58px] flex-col items-center gap-1 rounded-xl border-[1.5px] py-1.5 text-[11px] font-bold transition " + (fltAssignee.includes("__none") ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-500 hover:bg-neutral-50")}><span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-neutral-200 text-neutral-400"><User size={15} /></span>Никто</button>}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-neutral-400">Метка</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {JOB_MARKS.map(([id, ic]) => <button key={id} onClick={() => setFltMark(togV(fltMark, id))} className={"rounded-full border px-2.5 py-1 text-[14px] leading-none transition " + (fltMark.includes(id) ? "border-neutral-900 bg-white" : "border-neutral-200 bg-white hover:bg-neutral-50")}>{ic}</button>)}
                    <button onClick={() => setFltMark(togV(fltMark, "__none"))} className={"rounded-full border px-3 py-1 text-[12.5px] font-semibold transition " + (fltMark.includes("__none") ? "border-neutral-900 text-neutral-900" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50")}>Без метки</button>
                  </div>
                </div>
              </div></>)}
            </div>
          )}
          <button onClick={() => onAddJob({})} title="Добавить задачу" className="inline-flex h-8 items-center gap-1 rounded-lg bg-neutral-900 px-2.5 text-white hover:bg-neutral-800"><Plus size={16} /><span className="hidden text-sm font-semibold sm:inline">Задача</span></button>
        </div>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {focusMode ? <FocusView jobs={jobs} opTypes={opTypes} opDone={opDone} onToggleDone={onToggleDone} onEditOp={onEditOp} products={products} people={people} batches={batches} onOpenBatch={onOpenBatch} myId={myId} now={now} onUpdateJob={onUpdateJob} onOpen={onOpen} onAddJob={onAddJob} focusLine={focusLine} onFocusLine={onFocusLine} />
          : view === "kanban" ? <KanbanBoard jobs={fJobs} groupBy={groupBy} sortBy={kanbanSort} wide={kanbanWide} tags={taskTags} taskLabels={taskLabels} people={people} products={products} onOpen={onOpen} onAddJob={onAddJob} onUpdateJob={onUpdateJob} />
          : view === "prod" ? <ProductTasksView jobs={fJobs} products={products} onOpen={onOpen} />
          : view === "today" ? <OpTodayView opTypes={opTypesF} opDone={opDone} onToggleDone={onToggleDone} people={people} now={now} onEditOp={onEditOp} />
          : <GanttBoard onPrevM={prevM} onNextM={nextM} jobs={fJobs} products={products} batches={batches} people={people} opTypes={opTypesF} opDone={opDone} onToggleDone={onToggleDone} onEditOp={onEditOp} ym={ym} todayStr={todayStr} labelColor={labelColor} onAddJob={onAddJob} onOpen={onOpen} onUpdateJob={onUpdateJob} onlyType={fltType} secDone={secDone} toggleSecDone={toggleSecDone} />}
      </div>
    </div>
  );
}

// Карточка задачи (Канбан) и строка (Список) используют общие мелкие элементы
function PrioChip({ p }) { if (!p || !PRIORITIES[p]) return null; const m = PRIORITIES[p]; return <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: m.bg, color: m.color }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />{m.label}</span>; }
function StageChip({ j }) { const k = stageOf(j); const m = STAGES[k]; return <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: m.bg, color: m.color }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />{m.label}</span>; }
function StageIcon({ j, size = 15 }) {
  const k = stageOf(j); const m = STAGES[k];
  const base = { width: size, height: size, viewBox: "0 0 24 24" };
  let svg;
  if (k === "progress") svg = (<svg {...base}><circle cx="12" cy="12" r="9" fill="none" stroke={m.color} strokeWidth="2.2" /><path d="M12 3 a9 9 0 0 1 0 18 z" fill={m.color} /></svg>);
  else if (k === "done") svg = (<svg {...base} fill="none" stroke={m.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-4.8" /></svg>);
  else svg = (<svg {...base} fill="none" stroke={m.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></svg>);
  return <span title={m.label} className="inline-flex shrink-0 items-center">{svg}</span>;
}

// Режим «Фокус»: повестка на сегодня по всем типам задач, горизонтально (под экран ноутбука).
function TrashPanel({ jobs, people = [], products = [], trashProducts = [], trashFunctions = [], areas = [], startSection = "jobs", myId, userEmail, onRestore, onPurge, onRestoreProduct, onPurgeProducts, onRestoreFunction, onPurgeFunctions, onClose }) {
  const [sec, setSec] = useState(startSection); // products | functions | jobs
  const [tab, setTab] = useState("all");
  const [confirm1, setConfirm1] = useState(null); // id | "all"
  useEffect(() => { setConfirm1(null); }, [sec]);
  const personById = Object.fromEntries((people || []).map((p) => [p.id, p]));
  const prodById = Object.fromEntries((products || []).map((p) => [p.id, p]));
  const areaById = Object.fromEntries((areas || []).map((a) => [a.id, a]));
  const isMine = (j) => j.deletedBy && (j.deletedBy === myId || j.deletedBy === userEmail);
  const list = jobs.filter((j) => tab === "all" ? true : tab === "mine" ? isMine(j) : tab === "project" ? jobType(j) === "project" : jobType(j) !== "project");
  const daysLeft = (j) => Math.max(0, 30 - Math.floor((Date.now() - new Date(j.deletedAt).getTime()) / 86400000));
  const fmtDT = (iso) => { const d = new Date(iso); const t = new Date(); const hm = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); if (d.toDateString() === t.toDateString()) return "сегодня " + hm; const y = new Date(t.getTime() - 86400000); if (d.toDateString() === y.toDateString()) return "вчера " + hm; return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); };
  const tabs = [["all", "Все", jobs.length], ["mine", "Мои", jobs.filter(isMine).length], ["project", "Проектные", jobs.filter((j) => jobType(j) === "project").length], ["other", "Прочие", jobs.filter((j) => jobType(j) !== "project").length]];
  const byOf = (x) => personById[x.deletedBy] || (x.deletedBy ? Object.values(personById).find((p) => p.email === x.deletedBy) : null);
  const total = jobs.length + trashProducts.length + trashFunctions.length;
  const curItems = sec === "products" ? trashProducts : sec === "functions" ? trashFunctions : jobs;
  const purgeIds = (ids) => { if (sec === "products") onPurgeProducts(ids); else if (sec === "functions") onPurgeFunctions(ids); else onPurge(ids); };
  const noun = sec === "products" ? "товары" : sec === "functions" ? "функции" : "задачи";
  const metaLine = (x) => { const by = byOf(x); const dl = daysLeft(x); return (<>
    <span className="inline-flex items-center gap-1">{by ? <PersonAvatar p={by} size={16} /> : null}удалил{by ? " " + profileLabel(by) : ""} · {fmtDT(x.deletedAt)}</span>
    <span className={"font-semibold " + (dl <= 3 ? "text-rose-500" : "text-amber-600")}>осталось {dl} дн.</span>
  </>); };
  const actions = (id, onBack) => (
    <div className="flex shrink-0 gap-1.5">
      <button onClick={() => onBack(id)} className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700">Вернуть</button>
      <button onClick={() => setConfirm1(id)} title="Удалить навсегда" className="rounded-lg border border-rose-200 p-1.5 text-rose-500 hover:bg-rose-50"><X size={13} /></button>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[97] flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-[480px] flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
          <Trash2 size={17} className="text-neutral-500" />
          <h3 className="text-base font-bold text-neutral-800">Корзина</h3>
          <span className="rounded-full bg-neutral-200/70 px-2 text-xs font-bold text-neutral-500">{total}</span>
          <div className="ml-auto flex items-center gap-2">
            {curItems.length > 0 && <button onClick={() => setConfirm1("all")} className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">Очистить раздел</button>}
            <button onClick={onClose} className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><X size={18} /></button>
          </div>
        </div>
        <div className="flex gap-1.5 border-b border-neutral-100 px-4 py-2">
          {[["products", "Товары", trashProducts.length], ["functions", "Функции", trashFunctions.length], ["jobs", "Задачи", jobs.length]].map(([k, n, c]) => <button key={k} onClick={() => setSec(k)} className={"rounded-full px-3 py-1 text-xs font-bold transition " + (sec === k ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200")}>{n} {c}</button>)}
        </div>
        {sec === "jobs" && (
          <div className="flex gap-1.5 border-b border-neutral-100 px-4 py-2">
            {tabs.map(([k, n, c]) => <button key={k} onClick={() => setTab(k)} className={"rounded-full px-2.5 py-1 text-xs font-semibold transition " + (tab === k ? "bg-neutral-200 text-neutral-800" : "bg-neutral-50 text-neutral-400 hover:bg-neutral-100")}>{n} {c}</button>)}
          </div>
        )}
        {confirm1 && (
          <div className="m-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-neutral-700">
            <b>Удалить навсегда?</b> {confirm1 === "all" ? `Все ${noun} в корзине (${curItems.length}) будут стёрты без возможности вернуть.` : "Вернуть будет нельзя."}
            <div className="mt-2 flex gap-2">
              <button onClick={() => { purgeIds(confirm1 === "all" ? curItems.map((x) => x.id) : [confirm1]); setConfirm1(null); }} className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700">Удалить навсегда</button>
              <button onClick={() => setConfirm1(null)} className="rounded-lg border border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-600">Отмена</button>
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sec === "products" && trashProducts.length === 0 && <div className="px-6 py-16 text-center text-sm text-neutral-400">Удалённых товаров нет</div>}
          {sec === "products" && trashProducts.map((p) => (
            <div key={p.id} className="flex items-start gap-3 border-b border-neutral-50 px-4 py-3">
              <div className="flex h-[52px] w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-300">{p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={16} />}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold leading-snug text-neutral-500 line-through decoration-neutral-300">{p.name || "Без названия"}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-neutral-400">
                  {p.code && <span className="rounded bg-neutral-100 px-1.5 font-semibold text-neutral-500">{p.code}</span>}
                  {p.status && <span className="rounded bg-neutral-100 px-1.5 font-semibold text-neutral-500">{p.status}</span>}
                  {metaLine(p)}
                </div>
              </div>
              {actions(p.id, onRestoreProduct)}
            </div>
          ))}
          {sec === "functions" && trashFunctions.length === 0 && <div className="px-6 py-16 text-center text-sm text-neutral-400">Удалённых функций нет</div>}
          {sec === "functions" && trashFunctions.map((f) => { const ar = areaById[f.areaId]; const n = (f.subs || []).length; return (
            <div key={f.id} className="flex items-start gap-3 border-b border-neutral-50 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold leading-snug text-neutral-500 line-through decoration-neutral-300">{f.name || "Без названия"}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-neutral-400">
                  {ar && <span className="rounded px-1.5 font-semibold" style={{ background: ar.color + "22", color: ar.color }}>{ar.name}</span>}
                  <span>{n ? n + " " + plural(n, "подфункция", "подфункции", "подфункций") : "без подфункций"}</span>
                  {metaLine(f)}
                </div>
              </div>
              {actions(f.id, onRestoreFunction)}
            </div>
          ); })}
          {sec === "jobs" && list.length === 0 && <div className="px-6 py-16 text-center text-sm text-neutral-400">{jobs.length ? "В этом разделе пусто" : "Корзина задач пуста"}</div>}
          {sec === "jobs" && list.map((j) => { const st = STAGES[stageOf(j)]; const prod = prodById[j.productId]; return (
            <div key={j.id} className="flex items-start gap-2.5 border-b border-neutral-50 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-neutral-500 line-through decoration-neutral-300">{(j.title || "Без названия")}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-neutral-400">
                  <span className="rounded bg-neutral-100 px-1.5 font-semibold text-neutral-500">{(JOB_TYPES[jobType(j)] || {}).label || "Задача"}</span>
                  <span className="rounded px-1.5 font-semibold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                  {prod && <span>{prod.code || prod.name}</span>}
                  {metaLine(j)}
                </div>
              </div>
              {actions(j.id, onRestore)}
            </div>
          ); })}
        </div>
        <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-2.5 text-[11.5px] text-neutral-400">Удалённое старше 30 дней стирается автоматически. Корзина общая для всех.</div>
      </div>
    </div>
  );
}

const StIcon = ({ st }) => st === "progress"
  ? <span title="В процессе" className="inline-flex shrink-0"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#a3a3a3" strokeWidth="2" strokeLinecap="round"><line x1="12.00" y1="6.80" x2="12.00" y2="3.00" opacity="0.31" /><line x1="14.60" y1="7.50" x2="16.50" y2="4.21" opacity="0.38" /><line x1="16.50" y1="9.40" x2="19.79" y2="7.50" opacity="0.44" /><line x1="17.20" y1="12.00" x2="21.00" y2="12.00" opacity="0.50" /><line x1="16.50" y1="14.60" x2="19.79" y2="16.50" opacity="0.56" /><line x1="14.60" y1="16.50" x2="16.50" y2="19.79" opacity="0.62" /><line x1="12.00" y1="17.20" x2="12.00" y2="21.00" opacity="0.69" /><line x1="9.40" y1="16.50" x2="7.50" y2="19.79" opacity="0.75" /><line x1="7.50" y1="14.60" x2="4.21" y2="16.50" opacity="0.81" /><line x1="6.80" y1="12.00" x2="3.00" y2="12.00" opacity="0.88" /><line x1="7.50" y1="9.40" x2="4.21" y2="7.50" opacity="0.94" /><line x1="9.40" y1="7.50" x2="7.50" y2="4.21" opacity="1.00" /></svg></span>
  : <span title="Ожидает" className="inline-flex shrink-0"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#a3a3a3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></span>;

function FocusView({ jobs = [], opTypes = [], opDone = {}, onToggleDone, onEditOp, products = [], people = [], batches = [], onOpenBatch, myId = null, now, onUpdateJob, onOpen, onAddJob, focusLine = "", onFocusLine }) {
  const [pickOpen, setPickOpen] = useState(false);
  const [pickType, setPickType] = useState(null); // тип колонки, в которую добавляем задачи через «＋»
  const [eyeOpen, setEyeOpen] = useState(false);
  const [pickSel, setPickSel] = useState([]);
  const [pickQ, setPickQ] = useState("");
  const [onlyOver, setOnlyOver] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [openG, setOpenG] = useState({});
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState(focusLine || "");
  useEffect(() => { setDraft(focusLine || ""); }, [focusLine]);
  const [hidden, setHidden] = useState(() => lsGet("rnp.focusHidden", []));
  const [fold, setFold] = useState(() => lsGet("rnp.focusFold", {})); // свёрнутые в полосу блоки: { ops, proj, prod }
  const setFoldK = (k, v) => setFold((f) => { const n = { ...f, [k]: v }; lsSet("rnp.focusFold", n); return n; });
  const toggleHidden = (k) => setHidden((h) => { const n = h.includes(k) ? h.filter((x) => x !== k) : [...h, k]; lsSet("rnp.focusHidden", n); return n; });
  const flash = (t) => { setNote(t); setTimeout(() => setNote(""), 2800); };

  const todayStr = isoYMD(now);
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate(), wd = now.getDay();
  const PRANK = { high: 0, med: 1, low: 2 };
  const sortP = (a, b) => (PRANK[a.priority] ?? 1) - (PRANK[b.priority] ?? 1);
  const prodById = Object.fromEntries((products || []).map((p) => [p.id, p]));

  // — операционные: мои, сегодня, невыполненные (выполненные скрыты) —
  const opIsDone = (op) => !!(opDone[op.id] && opDone[op.id][todayStr]);
  const myOpsToday = (opTypes || []).filter((op) => (myId ? (op.assignee || null) === myId : true) && occurrenceDays(op.recur, y, m).includes(d));
  const opsPending = myOpsToday.filter((op) => !opIsDone(op));
  const opsDoneCount = myOpsToday.length - opsPending.length;

  // — проектные —
  const burning = (j) => j.date && j.date <= todayStr && stageOf(j) !== "done"; // срок сегодня/просрочено
  const dueBadge = (j) => { if (!j.date || stageOf(j) === "done") return null; if (j.date < todayStr) { const dd = Math.round((new Date(todayStr) - new Date(j.date)) / 86400000); return { txt: `−${dd} дн`, over: true, dd }; } if (j.date === todayStr) return { txt: "сегодня", over: false, dd: 0 }; return null; };
  const mine = (j) => !myId || jobAssignees(j).includes(myId); // только задачи текущего пользователя
  const isOver = (j) => mine(j) && j.date && j.date < todayStr && stageOf(j) !== "done";
  const projAll = (jobs || []).filter((j) => jobType(j) === "project" && !j.opId && mine(j));
  const focusProjectsBase = projAll.filter((j) => stageOf(j) !== "done" && (stageOf(j) === "progress" || burning(j) || j.focus)).sort(sortP);
  const focusProjects = onlyOver ? projAll.filter(isOver).sort(sortP) : focusProjectsBase;
  const waiting = projAll.filter((j) => stageOf(j) === "wait" && !burning(j) && !j.focus).sort(sortP);
  const pinnedList = focusProjects.filter((j) => j.pinned).slice(0, 3);
  const pinnedIds = new Set(pinnedList.map((j) => j.id));
  const restList = focusProjects.filter((j) => !pinnedIds.has(j.id));

  // — товары: горящие или в работе с высоким приоритетом; группируем одинаковые задачи по названию —
  const prodJobs = (jobs || []).filter((j) => jobType(j) === "product" && stageOf(j) !== "done" && mine(j));
  const prodHot = onlyOver ? prodJobs.filter(isOver) : prodJobs.filter((j) => burning(j) || (stageOf(j) === "progress" && j.priority === "high"));
  const groupsMap = {};
  prodHot.forEach((j) => { const t = stripProdSuffix(j.title, prodById[j.productId]?.name) || "Задача"; (groupsMap[t] = groupsMap[t] || []).push(j); });
  const groups = Object.entries(groupsMap).map(([title, list]) => ({ title, list, maxOver: Math.max(0, ...list.map((j) => (dueBadge(j)?.over ? dueBadge(j).dd : 0))), hasOver: list.some((j) => dueBadge(j)?.over) })).sort((a, b) => b.list.length - a.list.length);

  // — метрики —
  const inWorkCount = projAll.filter((j) => stageOf(j) === "progress").length;
  const overdueJobs = (jobs || []).filter(isOver);
  const overdueCount = overdueJobs.length;
  const dueTodayCount = (jobs || []).filter((j) => mine(j) && j.date === todayStr && stageOf(j) !== "done").length;
  const opPct = myOpsToday.length ? Math.round((opsDoneCount / myOpsToday.length) * 360) : 0;

  // — четыре колонки: Операционные / Проектные / Товары / Закупки; в каждой своя сортировка —
  const isMain = (j) => !!(j.pinned || j.focus); // добавлено вручную через «＋»
  const allOpen = (jobs || []).filter((j) => !j.opId && mine(j) && stageOf(j) !== "done");
  const dateKey = (j) => j.date || "9999-99-99";
  // сегодня между началом и сроком (не просрочено)
  const inWindow = (j) => !!j.date && j.date >= todayStr && (!j.start || j.start <= todayStr);
  // номер группы сортировки: 0 просрочено, 1 идёт по датам, 2+ приоритет (у проектных — по статусу и молнии), 9 — добавлено вручную; null — не показывается
  const tierOf = (j, type) => {
    if (isOver(j)) return 0;
    if (inWindow(j)) return 1;
    if (j.priority === "high") {
      if (type === "project") { const prog = stageOf(j) === "progress"; const z = j.mark === "urgent"; return prog ? (z ? 2 : 3) : (z ? 4 : 5); }
      return 2;
    }
    if (type === "project" && j.priority === "med" && stageOf(j) === "progress") return 6; // проектные: в процессе, средний приоритет — в самый низ
    return isMain(j) ? 9 : null;
  };
  const cmpJobs = (a, b) => dateKey(a).localeCompare(dateKey(b)) || (a.title || "").localeCompare(b.title || "");
  const buildCol = (type) => allOpen.filter((j) => jobType(j) === type).map((j) => ({ j, t: tierOf(j, type) })).filter((x) => x.t !== null && (!onlyOver || x.t === 0)).sort((a, b) => a.t - b.t || cmpJobs(a.j, b.j)).map((x) => x.j);
  const groupList = (list) => { const map = new Map(); list.forEach((j) => { const t = stripProdSuffix(j.title, prodById[j.productId]?.name) || "Задача"; if (!map.has(t)) map.set(t, []); map.get(t).push(j); }); return [...map.entries()].map(([title, l]) => ({ title, list: l, maxOver: Math.max(0, ...l.map((j) => (dueBadge(j)?.over ? dueBadge(j).dd : 0))), hasOver: l.some((j) => dueBadge(j)?.over) })); };
  const projList = buildCol("project");
  const prodGroups = groupList(buildCol("product"));
  const purList = buildCol("purchase");
  // закупки: партии с запущенным циклом (в работе) и их открытые задачи
  const cycBatches = (batches || []).filter((b) => b && b.cycle && b.cycle.started && Array.isArray(b.cycle.stages) && b.cycle.stages.some((x) => !x.done)).map((b) => {
    const stg = b.cycle.stages; const ci = stg.findIndex((x) => !x.done); const cur = stg[ci];
    const dts = cycleStageDates(b.cycle.startDate, stg); const endISO = cur && dts[cur.id] ? dts[cur.id].endISO : null;
    const over = endISO && endISO < todayStr ? Math.round((new Date(todayStr) - new Date(endISO)) / 86400000) : 0;
    const tasks = (jobs || []).filter((j) => j.batchId === b.id && !j.opId && stageOf(j) !== "done").sort((a, c) => dateKey(a).localeCompare(dateKey(c)) || sortP(a, c));
    const taskOver = tasks.some((j) => j.date && j.date < todayStr);
    return { b, stg, ci, cur, endISO, over, tasks, taskOver };
  }).filter((x) => !onlyOver || x.over > 0 || x.taskOver).sort((a, c) => (c.over - a.over) || String(a.endISO || "9999").localeCompare(String(c.endISO || "9999")) || String(a.b.name || "").localeCompare(String(c.b.name || "")));
  const typeBadge = (j) => TASK_TYPE_META.find((x) => x.key === jobType(j)) || TASK_TYPE_META[1];
  const TypeIco = ({ j, size = 22 }) => { const tb = typeBadge(j); const Ic = tb.Icon; return <span title={tb.label} style={{ background: tb.bg, color: tb.tint, width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-md"><Ic size={Math.round(size * 0.58)} /></span>; };
  const dueChip = (j) => { if (!j.date) return null; const dd = Math.round((new Date(j.date) - new Date(todayStr)) / 86400000); if (dd < 0) return { txt: `−${-dd} д`, cls: "bg-[#e11d48] text-white" }; if (dd === 0) return { txt: "сегодня", cls: "bg-orange-100 text-orange-700" }; if (dd === 1) return { txt: "завтра", cls: "bg-orange-100 text-orange-700" }; if (dd <= 3) return { txt: `через ${dd} дн`, cls: "bg-orange-100 text-orange-700" }; return { txt: j.date.slice(8, 10) + "." + j.date.slice(5, 7), cls: "bg-neutral-100 text-neutral-500" }; };
  const setMain = (j, on) => onUpdateJob({ ...j, pinned: on, ...(on ? {} : { focus: false }) });
  const pickCands = pickType ? allOpen.filter((j) => jobType(j) === pickType && tierOf(j, pickType) === null).sort((a, b) => dateKey(a).localeCompare(dateKey(b)) || sortP(a, b)) : [];
  const pickList = pickCands.filter((j) => !pickQ.trim() || (j.title || "").toLowerCase().includes(pickQ.trim().toLowerCase())).slice(0, 200);
  const addToMain = () => { const sel = allOpen.filter((j) => pickSel.includes(j.id)); sel.forEach((j) => onUpdateJob({ ...j, pinned: true })); setPickSel([]); setPickType(null); setPickQ(""); if (sel.length) flash(`В Фокус добавлено: ${sel.length}`); };
  const JobCard = ({ j, main = false }) => {
    const dc = dueChip(j); const st = STAGES[stageOf(j)]; const pr = (people || []).find((q) => q.id === j.assignee);
    return (
      <div onClick={() => onOpen(j)} title={st ? st.label : ""} className="group flex cursor-pointer items-center gap-2.5 border-b border-neutral-100 px-1.5 py-2 transition last:border-b-0 hover:bg-neutral-50">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-neutral-800">{stripProdSuffix(j.title, prodById[j.productId]?.name)}</span>
        {dc ? <span className={"shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold " + dc.cls}>{dc.txt}</span> : <span className="w-[1px]" />}
      </div>
    );
  };
  const renderGroup = (g) => {
              const open = !!openG[g.title];
              const n = g.list.length;
              return (
                <div key={g.title} className="border-b border-neutral-100 last:border-b-0">
                  <button onClick={() => setOpenG((o) => ({ ...o, [g.title]: !o[g.title] }))} className="flex w-full items-center gap-2.5 px-1.5 py-2 text-left transition hover:bg-neutral-50">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-neutral-800">{g.title}</span>
                    <span className="shrink-0 text-[12px] font-bold text-neutral-400">x{n}</span>
                    {(() => { const dd = g.hasOver ? { txt: `−${g.maxOver} д`, cls: "bg-[#e11d48] text-white" } : dueChip(g.list.slice().sort((a, b) => dateKey(a).localeCompare(dateKey(b)))[0]); return dd ? <span className={"shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold " + dd.cls}>{dd.txt}</span> : null; })()}
                    <ChevronRight size={14} className={"shrink-0 text-neutral-300 transition " + (open ? "rotate-90" : "")} />
                  </button>
                  {open && (
                    <div className="px-1.5 pb-1 pt-1">
                      {g.list.map((j) => { const prod = prodById[j.productId]; return (
                        <div key={j.id} onClick={() => onOpen(j)} className="mb-1.5 flex cursor-pointer items-center gap-2.5 rounded-[11px] border border-neutral-200 bg-white p-1 pr-2.5 transition hover:border-neutral-300 hover:shadow-sm">
                          <span className="flex h-[38px] w-[32px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-100 text-neutral-300">{prod?.image ? <img src={prod.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={13} />}</span>
                          <span className="min-w-0 flex-1"><span className="block text-[11.5px] font-extrabold leading-tight text-neutral-400">{prod?.code || "—"}</span><span className="block truncate text-[12.5px] font-bold text-neutral-800">{prod?.name || "Товар"}</span></span>
                          <button onClick={(e) => { e.stopPropagation(); onUpdateJob(applyStage(j, "done")); }} title="Отметить выполненной" aria-label="Отметить выполненной" className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border-2 border-neutral-300 bg-white text-transparent transition hover:border-emerald-500 hover:text-emerald-500"><Check size={11} strokeWidth={3.4} /></button>
                        </div>
                      ); })}
                      <div className="flex flex-wrap gap-1.5 px-1.5 pt-1">
                        <button onClick={() => { if (window.confirm(`Перенести «${g.title}» (${n}) на завтра?`)) { setDates(g.list, shiftDate(1)); flash(`Перенесено: ${n}`); } }} className="rounded-lg border border-neutral-200 px-2.5 py-1 text-[11px] font-bold text-neutral-600 hover:bg-neutral-50">Перенести группу на завтра</button>
                        <button onClick={() => { if (window.confirm(`Закрыть «${g.title}» для всех (${n})?`)) { g.list.forEach((j) => onUpdateJob(applyStage(j, "done"))); flash(`Закрыто: ${n}`); } }} className="rounded-lg border border-emerald-200 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50">✓ Закрыть для всех {n}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
  };

  const prioSize = (j) => j.priority === "high" ? "t-hi" : j.priority === "med" ? "t-md" : "t-lo";
  const pmeta = (pr) => PRIORITIES[pr] || PRIORITIES.med;
  const shiftDate = (n) => isoYMD(new Date(y, m, d + n));
  const setDates = (list, date) => list.forEach((j) => onUpdateJob({ ...j, date, start: j.start && j.start > date ? date : j.start }));
  const moveAllOver = (n, label) => { if (!overdueJobs.length) return; if (!window.confirm(`Перенести просроченные задачи (${overdueJobs.length}) ${label}?`)) return; setDates(overdueJobs, shiftDate(n)); flash(`Перенесено: ${overdueJobs.length}`); };
  const togglePin = (j) => { if (j.pinned) { onUpdateJob({ ...j, pinned: false }); return; } if (pinnedList.length >= 3) { flash("В Топ-3 можно закрепить не больше трёх задач"); return; } onUpdateJob({ ...j, pinned: true }); };
  const addToFocus = () => { const sel = waiting.filter((j) => pickSel.includes(j.id)); sel.forEach((j) => onUpdateJob({ ...applyStage(j, "progress"), focus: true })); setPickSel([]); setPickOpen(false); setPickQ(""); if (sel.length) flash(`В Фокус добавлено: ${sel.length}`); };
  const removeFromFocus = (j) => onUpdateJob({ ...applyStage(j, "wait"), focus: false, pinned: false });
  const commitLine = () => { if ((draft || "") !== (focusLine || "") && onFocusLine) onFocusLine(draft); };

  const Tile = ({ j, onClick }) => {
    const pm = pmeta(j.priority);
    const sz = prioSize(j);
    const badge = dueBadge(j);
    const pr = (people || []).find((p) => p.id === j.assignee);
    const base = sz === "t-hi" ? "basis-[calc(50%-5px)] min-h-[92px] text-[14px]" : sz === "t-md" ? "basis-[calc(50%-5px)] min-h-[68px] text-[12.5px]" : "basis-[calc(33.333%-6px)] min-h-[50px] text-[11.5px]";
    return (
      <button onClick={onClick} className={"relative flex grow flex-col justify-between rounded-xl border-[1.5px] p-3 text-left transition hover:shadow-sm " + base} style={{ background: pm.soft, borderColor: pm.color }}>
        <span className="absolute right-2.5 top-2 text-[8.5px] font-extrabold uppercase" style={{ color: pm.color }}>{j.priority === "high" ? "выс" : j.priority === "med" ? "сред" : "низ"}</span>
        <span className="pr-8 font-bold leading-tight text-neutral-800">{stripProdSuffix(j.title, prodById[j.productId]?.name)}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {j.focus && <span className="rounded-md bg-rose-100 px-1.5 text-[10px] font-extrabold text-rose-700">◎ в фокусе</span>}
          {badge && <span className="rounded-md border bg-white px-1.5 text-[10px] font-extrabold" style={{ color: badge.over ? "#dc2626" : "#d97706", borderColor: badge.over ? "#fecaca" : "#fde68a" }}>{badge.txt}</span>}
          {j.focus && <span role="button" onClick={(e) => { e.stopPropagation(); removeFromFocus(j); }} className="text-[10px] text-neutral-400 underline decoration-dotted hover:text-neutral-700">убрать из Фокуса</span>}
          {pr && <span className="ml-auto"><PersonAvatar p={pr} size={21} /></span>}
        </span>
        <span role="button" title={j.pinned ? "Убрать из Топ-3" : "Закрепить в Топ-3"} onClick={(e) => { e.stopPropagation(); togglePin(j); }} className={"absolute bottom-2 text-[15px] leading-none " + (pr ? "right-9 " : "right-2.5 ") + (j.pinned ? "text-rose-600" : "text-neutral-300 hover:text-rose-400")}>★</span>
      </button>
    );
  };

  const COLS = [{ k: "ops", label: "Операционные", dot: "#6366f1" }, { k: "project", label: "Проектные", dot: "#7c3aed" }, { k: "product", label: "Товары", dot: "#ea580c" }, { k: "purchase", label: "Закупки", dot: "#0891b2" }];
  const FoldStrip = ({ k, label, count, onOpen }) => (
    <div className="min-w-0 border-b border-neutral-100 p-3.5 md:border-b-0 md:border-r">
      <button onClick={onOpen || (() => setFoldK(k, false))} title={"Развернуть «" + label + "»"} className="flex w-full items-center gap-2 text-left">
        <span className="text-[11.5px] font-extrabold uppercase tracking-wide text-neutral-500">{label}</span>
        {count !== "" && count != null && <span className="rounded-full bg-neutral-100 px-2 text-[10px] font-bold text-neutral-500">{count}</span>}
        <span className="ml-auto flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><ChevronDown size={14} /></span>
      </button>
    </div>
  );
  const foldBtn = (k) => <button onClick={() => setFoldK(k, true)} title="Свернуть" className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><ChevronDown size={14} className="rotate-180" /></button>;
  const tileChip = (j) => { if (!j.date) return null; const dd = Math.round((new Date(j.date) - new Date(todayStr)) / 86400000); if (dd < 0) return { txt: `−${-dd} дн`, cls: "bg-red-100 text-red-700" }; if (dd === 0) return { txt: "сегодня", cls: "bg-orange-100 text-orange-700" }; return { txt: "до " + j.date.slice(8, 10) + "." + j.date.slice(5, 7), cls: inWindow(j) ? "bg-blue-100 text-blue-700" : "bg-neutral-100 text-neutral-600" }; };
  const ProjTile = ({ j }) => {
    const manual = isMain(j); const t = tierOf(j, "project"); const isToday = t !== 0 && j.date === todayStr; const chip = null; const dueTxt = (t === 0 || isToday || !j.date || stageOf(j) === "done") ? null : j.date.slice(8, 10) + "." + j.date.slice(5, 7); const st = STAGES[stageOf(j)]; const overDays = t === 0 ? Math.round((new Date(todayStr) - new Date(j.date)) / 86400000) : 0;
    return (
      <div onClick={() => onOpen(j)} className={"group relative flex min-h-[101px] cursor-pointer flex-col rounded-xl border p-2.5 transition hover:shadow-sm " + (t === 0 ? "border-[#CF364C] bg-[#CF364C]" : isToday ? "border-[#FF9F40] bg-[#FF9F40]" : j.priority === "high" ? "border-red-300 bg-red-50" : j.priority === "med" ? "border-amber-300 bg-amber-50" : "border-[#d4d4d8] bg-neutral-100")}>
        {t === 0 && <span className="absolute bottom-2 right-2 rounded-[7px] bg-white inline-flex items-center justify-center px-[10px] py-[5px] text-[11px] font-black leading-none text-[#CF364C]">−{overDays} д</span>}
        {dueTxt && <span className="absolute bottom-2 right-2 rounded-[7px] bg-white inline-flex items-center justify-center px-[10px] py-[5px] text-[11px] font-black leading-none text-neutral-700">{dueTxt}</span>}
        {isToday && <span className="absolute bottom-2 right-2 rounded-[7px] bg-white inline-flex items-center justify-center px-[10px] py-[5px] text-[11px] font-black leading-none text-amber-700">сегодня</span>}
        <span className={"line-clamp-3 text-[13.5px] font-bold leading-snug " + ((t === 0 || isToday) ? "text-white" : "text-neutral-800")}>{(markIcon(j.mark) ? markIcon(j.mark) + " " : "") + j.title}</span>
        <div className={"mt-auto flex items-center gap-1.5 pt-2 text-[10.5px] font-extrabold " + ((t === 0 || isToday || dueTxt) ? "pr-16" : "pr-5") + ((t === 0 || isToday) ? " [&_svg]:stroke-white [&_svg]:opacity-80" : "")}>
          <StIcon st={stageOf(j)} />
          {chip && <span className={"rounded-full px-2 py-px " + chip.cls}>{chip.txt}</span>}
        </div>
      </div>
    );
  };
  const AddBtn = ({ type }) => <button onClick={() => { setPickType(type); setPickSel([]); setPickQ(""); }} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-rose-200 bg-rose-50/40 py-2 text-[12px] font-bold text-rose-700 transition hover:bg-rose-50"><Plus size={13} />добавить</button>;
  const colHead = (k, label, count) => <div className="mb-2.5 flex items-center gap-2"><span className="text-[11.5px] font-extrabold uppercase tracking-wide text-neutral-500">{label}</span><span className="rounded-full bg-neutral-100 px-2 text-[10px] font-bold text-neutral-500">{count}</span><span className="ml-auto" />{foldBtn(k)}</div>;
  const opsStrip = !!fold.ops || (opsPending.length === 0 && !opsOpen);
  const showOps = !hidden.includes("ops"), showProj = !hidden.includes("project"), showProd = !hidden.includes("product"), showPur = !hidden.includes("purchase");

  return (
    <div className="flex h-full flex-col rounded-2xl border border-neutral-200 bg-white">
      {/* шапка: ФОКУС + строка фокуса, счётчики, меню групп */}
      <div className="relative flex items-center gap-3.5 rounded-t-[15px] bg-gradient-to-r from-[#e11d48] to-[#be123c] px-4" style={{ minHeight: 42 }}>
        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[14px] font-black tracking-wide text-white"><Target size={15} className="focus-pulse" />ФОКУС</span>
        {note && <span className="shrink-0 rounded-lg bg-neutral-900 px-2 py-0.5 text-[11px] font-semibold text-white">{note}</span>}
        <span className="h-[22px] w-px shrink-0 bg-white/35" />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commitLine} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} placeholder="На чём сейчас делаем упор…" className="min-w-0 flex-1 rounded-lg border-0 bg-transparent px-1.5 py-0.5 text-[14px] font-extrabold tracking-tight text-white outline-none ring-0 transition placeholder:font-semibold placeholder:text-white/50 hover:bg-white/10 focus:bg-white/15 focus:outline-none focus:ring-0" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {onAddJob && <button onClick={() => onAddJob({})} title="Добавить задачу (необязательно попадёт в фокус)" className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-white/40 bg-transparent px-2.5 text-[13px] font-extrabold text-white transition hover:bg-white/15"><Plus size={15} />Задача</button>}
          {overdueCount > 0 && <button onClick={() => setOnlyOver((v) => !v)} title="Показать только просроченные" className={"rounded-[10px] px-3 py-1.5 text-[13px] font-extrabold transition " + (onlyOver ? "bg-neutral-900 text-white" : "bg-white text-rose-700 hover:bg-rose-50")}>{overdueCount} просрочено ›</button>}
          <div className="relative">
            <button onClick={() => setEyeOpen((v) => !v)} title="Показывать группы задач" className={"flex h-8 w-8 items-center justify-center rounded-[10px] border transition " + (hidden.length ? "border-white bg-white text-rose-600" : "border-white/40 bg-transparent text-white hover:bg-white/15")}>{hidden.length ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            {eyeOpen && (<>
              <div className="fixed inset-0 z-20" onClick={() => setEyeOpen(false)} />
              <div className="absolute right-0 top-10 z-30 w-52 rounded-xl border border-neutral-200 bg-white p-2 shadow-xl">
                <div className="px-2 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Показывать группы</div>
                {COLS.map((c) => (
                  <label key={c.k} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50">
                    <input type="checkbox" checked={!hidden.includes(c.k)} onChange={() => toggleHidden(c.k)} className="h-4 w-4 accent-rose-600" />
                    <span className="h-2 w-2 rounded-full" style={{ background: c.dot }} />{c.label}
                  </label>
                ))}
              </div>
            </>)}
          </div>
        </div>
      </div>

      {onlyOver && (
        <div className="flex flex-wrap items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-[12px]">
          <b className="text-red-700">Просрочено: {overdueCount}</b><span className="text-neutral-500">показаны только они</span>
          <span className="ml-auto text-neutral-500">Перенести все:</span>
          {[[0, "на сегодня"], [1, "на завтра"], [7, "на неделю"]].map(([n, l]) => <button key={n} onClick={() => moveAllOver(n, l)} className="rounded-lg border border-red-200 bg-white px-2.5 py-1 font-bold text-red-700 hover:bg-red-100">{l}</button>)}
          <button onClick={() => setOnlyOver(false)} className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 font-bold text-neutral-600 hover:bg-neutral-50">Сбросить</button>
        </div>
      )}

      {/* колонки */}
      {!showOps && !showProj && !showProd && !showPur && (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[13px] text-neutral-500">
          Все блоки скрыты.
          <button onClick={() => { setHidden([]); lsSet("rnp.focusHidden", []); }} className="rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-rose-700">Показать все блоки</button>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:[grid-template-columns:repeat(var(--n),minmax(0,1fr))]" style={{ "--n": Math.max(1, [showOps, showProj, showProd, showPur].filter(Boolean).length) }}>
        {showOps && (opsStrip ? (
          <FoldStrip k="ops" label="Операционные" count={myOpsToday.length > 0 ? `${opsDoneCount}/${myOpsToday.length}` : ""} onOpen={() => { setOpsOpen(true); setFoldK("ops", false); }} />
        ) : (
          <div className="min-w-0 border-b border-neutral-100 p-3.5 md:border-b-0 md:border-r">
            <div className="mb-2.5 flex items-center gap-2"><span className="text-[11.5px] font-extrabold uppercase tracking-wide text-neutral-500">Операционные</span><span className="rounded-full bg-neutral-100 px-2 text-[10px] font-bold text-neutral-500">{opsPending.length === 0 ? `${opsDoneCount}/${myOpsToday.length}` : opsPending.length}</span>
              <button onClick={() => { setOpsOpen(false); setFoldK("ops", true); }} title="Свернуть" className="ml-auto flex h-[22px] w-[22px] items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><ChevronDown size={14} className="rotate-180" /></button></div>
            {myOpsToday.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-200 py-6 text-center text-[12px] text-neutral-400">На сегодня операционных нет</div>
            ) : [...opsPending, ...myOpsToday.filter(opIsDone)].map((op) => {
              const done = opIsDone(op);
              return (
                <div key={op.id} className="flex items-center gap-2.5 border-b border-neutral-100 py-2 text-[13px] last:border-b-0">
                  <button onClick={() => onToggleDone(op.id, todayStr)} title={done ? "Снять отметку" : "Отметить выполнено"} className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-md border-2 transition hover:scale-110" style={done ? { background: "#16a34a", borderColor: "#16a34a", color: "#fff" } : { background: "#fff", borderColor: "#c9c9cf" }}>{done && <Check size={12} strokeWidth={3.5} />}</button>
                  <button onClick={() => onEditOp && onEditOp(op)} className={"min-w-0 flex-1 truncate text-left " + (done ? "text-neutral-400 line-through" : "text-neutral-800")}>{op.name}</button>
                </div>
              );
            })}
          </div>
        ))}

        {showProj && (fold.project ? <FoldStrip k="project" label="Проектные" count={projList.length} /> : (
          <div className="min-w-0 border-b border-neutral-100 p-3.5 md:border-b-0 md:border-r">
            {colHead("project", "Проектные", projList.length)}
            {projList.length > 0 && <div className="grid grid-cols-2 gap-2">{projList.map((j) => <ProjTile key={j.id} j={j} />)}</div>}
            {projList.length === 0 && <div className="rounded-lg border border-dashed border-neutral-200 py-6 text-center text-[12px] text-neutral-400">{onlyOver ? "Просроченных нет" : "Пока пусто"}</div>}
          </div>
        ))}

        {showProd && (fold.product ? <FoldStrip k="product" label="Товары" count={prodGroups.length} /> : (
          <div className="min-w-0 border-b border-neutral-100 p-3.5 md:border-b-0 md:border-r">
            {colHead("product", "Товары", prodGroups.length)}
            {prodGroups.map((g) => renderGroup(g))}
            {prodGroups.length === 0 && <div className="rounded-lg border border-dashed border-neutral-200 py-6 text-center text-[12px] text-neutral-400">{onlyOver ? "Просроченных нет" : "Пока пусто"}</div>}
          </div>
        ))}
        {showPur && (fold.purchase ? <FoldStrip k="purchase" label="Закупки" count={cycBatches.length} /> : (
          <div className="min-w-0 p-3.5">
            {colHead("purchase", "Закупки", cycBatches.length)}
            {cycBatches.map(({ b, stg, ci, cur, endISO, over, tasks }) => (
              <div key={b.id} className={"mb-2.5 rounded-[14px] border p-2.5 " + "border-neutral-200 bg-white"}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-extrabold text-neutral-800">{b.name || "Партия"}</span>
                  {cur && <span className="shrink-0 text-[11px] font-extrabold text-neutral-500">{cur.name}</span>}
                  <button type="button" onClick={() => onOpenBatch && onOpenBatch(b.id)} title="Открыть партию в «Закупках»" className="-mr-1 shrink-0 rounded-md p-0.5 text-neutral-300 transition hover:text-[#e11d48]"><ArrowUpRight size={14} /></button>
                </div>
                <div className="mt-1.5 flex gap-[3px]">{stg.map((x, k) => <i key={x.id || k} title={x.name} className={"h-[5px] flex-1 rounded-[3px] " + (x.done ? "bg-[#a7e3b9]" : k === ci ? "bg-orange-400" : "bg-neutral-200")} />)}</div>
                {tasks.length > 0 && <div className="mt-2 space-y-1">{tasks.map((j) => { const dc = dueChip(j); return (
                  <div key={j.id} onClick={() => onOpen(j)} className={"flex cursor-pointer items-center gap-2 rounded-[9px] border px-2 py-1.5 transition hover:shadow-sm " + (j.priority === "high" ? "border-red-200 bg-red-50/60" : j.priority === "med" ? "border-amber-200 bg-amber-50/60" : "border-neutral-200 bg-white")}>
                    <StIcon st={stageOf(j)} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-neutral-800">{(markIcon(j.mark) ? markIcon(j.mark) + " " : "") + j.title}</span>
                    {dc && <span className={"shrink-0 rounded-full px-2 py-px text-[11px] font-extrabold " + dc.cls}>{dc.txt}</span>}
                  </div>
                ); })}</div>}
              </div>
            ))}
            {cycBatches.length === 0 && <div className="rounded-lg border border-dashed border-neutral-200 py-6 text-center text-[12px] text-neutral-400">{onlyOver ? "Просроченных нет" : "Нет партий с запущенным циклом"}</div>}
          </div>
        ))}
      </div>
      {pickType && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25 p-4" onClick={() => setPickType(null)}>
          <div className="w-[420px] max-w-full rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center text-[13px] font-extrabold text-neutral-800">Добавить в Фокус · {(COLS.find((c) => c.k === pickType) || {}).label}<button onClick={() => setPickType(null)} className="ml-auto text-neutral-300 hover:text-neutral-600"><X size={14} /></button></div>
            <input autoFocus value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder="Поиск по задачам…" className="mb-1.5 w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-rose-200" />
            <div className="max-h-[320px] overflow-y-auto">
              {pickList.length === 0 && <div className="py-4 text-center text-[12px] text-neutral-400">Нет подходящих задач</div>}
              {pickList.map((j) => (
                <label key={j.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-[12.5px] font-semibold text-neutral-700 hover:bg-neutral-50">
                  <input type="checkbox" checked={pickSel.includes(j.id)} onChange={() => setPickSel((x) => x.includes(j.id) ? x.filter((y2) => y2 !== j.id) : [...x, j.id])} className="h-4 w-4 accent-rose-600" />
                  <span className="min-w-0 flex-1 truncate">{stripProdSuffix(j.title, prodById[j.productId]?.name)}</span>
                  <span className="text-[10.5px] font-bold text-neutral-400">{j.date ? j.date.slice(8, 10) + "." + j.date.slice(5, 7) : ""}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center border-t border-neutral-100 pt-2.5">
              <span className="text-[11.5px] text-neutral-500">Выбрано: {pickSel.length}</span>
              <button onClick={addToMain} disabled={!pickSel.length} className="ml-auto rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-rose-700 disabled:opacity-40">Добавить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Вид «Сегодня» для операционных задач: только текущий день, список задач на сегодня с чекбоксом.
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
function OpTodayView({ opTypes = [], opDone = {}, onToggleDone, people = [], now, onEditOp }) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate(), wd = now.getDay();
  const todayStr = isoYMD(now);
  const isDone = (op) => !!(opDone[op.id] && opDone[op.id][todayStr]);
  const todays = (opTypes || []).filter((op) => occurrenceDays(op.recur, y, m).includes(d));
  const sorted = [...todays].sort((a, b) => (isDone(b) ? 1 : 0) - (isDone(a) ? 1 : 0)); // выполненные — вверх
  const doneCount = todays.filter(isDone).length;
  const personOf = (id) => (people || []).find((p) => p.id === id);
  const avatar = (op) => {
    const p = personOf(op.assignee);
    if (!p) return null;
    return <PersonAvatar p={p} size={20} />;
  };
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-orange-100 bg-orange-50/60 px-4 py-3">
        <CalendarCheck size={20} className="text-orange-600" />
        <div>
          <div className="text-[15px] font-bold text-orange-700">Сегодня · {d} {MONTHS_GEN[m]}, {WD_LABEL[wd]}</div>
          <div className="text-xs text-orange-700/60">задачи на эту дату</div>
        </div>
        <span className="ml-auto rounded-full border border-orange-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-orange-600">{doneCount} из {todays.length}</span>
      </div>
      {todays.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 py-12 text-center text-sm text-neutral-400">На сегодня операционных задач нет</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200">
          {sorted.map((op) => {
            const done = isDone(op);
            return (
              <div key={op.id} className="flex items-center gap-3 border-b border-neutral-100 px-4 py-2.5 last:border-b-0 hover:bg-neutral-50">
                <button
                  onClick={() => onToggleDone(op.id, todayStr)}
                  title={done ? "Выполнено — снять отметку" : "Отметить выполнено"}
                  className="flex shrink-0 items-center justify-center transition hover:scale-110"
                  style={{ width: 22, height: 22, borderRadius: 7, background: done ? "#16a34a" : "#fff7f0", border: done ? "2px solid #16a34a" : "2px solid #f6b98a", color: "#fff" }}
                >{done && <Check size={13} strokeWidth={3} />}</button>
                <button onClick={() => onEditOp && onEditOp(op)} className="min-w-0 flex-1 text-left" title="Настроить график">
                  <span className={"block truncate text-[13.5px] font-medium " + (done ? "text-neutral-400 line-through" : "text-neutral-800")}>{op.name}</span>
                </button>
                <span className="shrink-0">{avatar(op)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Вид «Товары» для задач по товарам: товар (фото·код·название) + все его задачи. Раскладки: строки | колонки.
function ProductTasksView({ jobs, products, onOpen }) {
  const [hideDone, setHideDone] = useState(() => lsGet("rnp.prodHideDone", false));
  const [groupMode, setGroupMode] = useState(() => lsGet("rnp.prodGroup2", "task")); // prod: товар→задачи | task: задача→товары
  useEffect(() => lsSet("rnp.prodHideDone", hideDone), [hideDone]);
  useEffect(() => lsSet("rnp.prodGroup2", groupMode), [groupMode]);

  const prodById = Object.fromEntries((products || []).map((p) => [p.id, p]));
  const byProd = new Map();
  const totByProd = new Map(); // порядок колонок считаем по ВСЕМ задачам (и выполненным), чтобы они не прыгали при выполнении
  (jobs || []).forEach((j) => {
    if (jobType(j) !== "product" || !j.productId) return;
    totByProd.set(j.productId, (totByProd.get(j.productId) || 0) + 1);
    if (hideDone && stageOf(j) === "done") return;
    if (!byProd.has(j.productId)) byProd.set(j.productId, []);
    byProd.get(j.productId).push(j);
  });
  const rows = [...byProd.entries()]
    .map(([pid, js]) => ({ p: prodById[pid] || { id: pid, code: "—", name: "Без товара", image: null }, jobs: js }))
    .filter((r) => r.jobs.length)
    .sort((a, b) => ((totByProd.get(b.p.id) || 0) - (totByProd.get(a.p.id) || 0)) || String(a.p.code || "").localeCompare(String(b.p.code || "")));

  const sortJobs = (js) => js.slice().sort((a, b) => {
    const da = stageOf(a) === "done" ? 1 : 0, db = stageOf(b) === "done" ? 1 : 0; if (da !== db) return da - db;
    const pr = { high: 0, med: 1, low: 2 }; return (pr[a.priority] ?? 3) - (pr[b.priority] ?? 3);
  });

  const nP = rows.length;
  const wP = (nP % 10 === 1 && nP % 100 !== 11) ? "товар" : ([2, 3, 4].includes(nP % 10) && ![12, 13, 14].includes(nP % 100)) ? "товара" : "товаров";

  const thumb = (p, w, h) => (
    <div className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-100 text-neutral-300" style={{ width: w, height: h }}>{p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={Math.round(w / 2.6)} />}</div>
  );
  // убрать хвост «· Название товара» — товар и так в шапке строки
  const stripProd = (title, name) => { let t = String(title || ""); if (name) { const re = new RegExp("\\s*[·•]\\s*" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$"); t = t.replace(re, ""); } return t.trim() || String(title || "—"); };
  const chip = (j, pname) => { const done = stageOf(j) === "done"; const m = PRIORITIES[j.priority]; const style = done ? { background: "#f4f5f6", color: "#a1a1aa", borderColor: "#e9e9ec" } : m ? { background: m.bg, color: m.color, borderColor: m.color + "55" } : { background: "#f8f8f9", color: "#52525b", borderColor: "#e5e5e9" }; const txt = stripProd(j.title, pname);
    return <button key={j.id} onClick={() => onOpen(j)} title={txt} style={style} className={"inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-semibold " + (done ? "line-through" : "")}>{done && <Check size={11} strokeWidth={3} className="shrink-0" />}<span className="truncate">{txt}</span></button>;
  };
  const card = (j, pname) => { const done = stageOf(j) === "done"; const m = PRIORITIES[j.priority]; const bc = done ? "#d1d5db" : (m ? m.color : "#cbd5e1"); const txt = stripProd(j.title, pname);
    return <button key={j.id} onClick={() => onOpen(j)} title={txt} className={"rounded-lg border border-l-[3px] bg-white px-2.5 py-2 text-left text-[11.5px] font-semibold leading-snug " + (done ? "text-neutral-400 line-through" : "text-neutral-700")} style={{ borderLeftColor: bc }}>{txt}</button>;
  };

  // «по задачам»: группируем по нормализованному названию задачи → товары
  const byTask = new Map();
  const totByTask = new Map();
  (jobs || []).forEach((j) => {
    if (jobType(j) !== "product" || !j.productId) return;
    const key = stripProd(j.title, (prodById[j.productId] || {}).name) || "—";
    totByTask.set(key, (totByTask.get(key) || 0) + 1);
    if (hideDone && stageOf(j) === "done") return;
    if (!byTask.has(key)) byTask.set(key, []);
    byTask.get(key).push(j);
  });
  const taskRows = [...byTask.entries()].map(([title, js]) => ({ title, jobs: js })).filter((r) => r.jobs.length)
    .sort((a, b) => ((totByTask.get(b.title) || 0) - (totByTask.get(a.title) || 0)) || a.title.localeCompare(b.title));
  const nT = taskRows.length;
  const wT = (nT % 10 === 1 && nT % 100 !== 11) ? "задача" : ([2, 3, 4].includes(nT % 10) && ![12, 13, 14].includes(nT % 100)) ? "задачи" : "задач";
  const groupPrio = (js) => { const rank = { high: 0, med: 1, low: 2 }; let best = 3, bp = ""; js.forEach((j) => { const r = rank[j.priority] ?? 3; if (r < best) { best = r; bp = j.priority; } }); return bp; };
  const sortProds = (js) => js.slice().sort((a, b) => { const da = stageOf(a) === "done" ? 1 : 0, db = stageOf(b) === "done" ? 1 : 0; if (da !== db) return da - db; return String((prodById[a.productId] || {}).code || "").localeCompare(String((prodById[b.productId] || {}).code || "")); });
  const prodChip = (j) => { const p = prodById[j.productId] || {}; const done = stageOf(j) === "done"; return (
    <button key={j.id} onClick={() => onOpen(j)} title={p.name || ""} className={"inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white py-[3px] pl-[3px] pr-2.5 hover:border-neutral-300 " + (done ? "opacity-50" : "")}>
      {thumb(p, 26, 32)}
      <span className="min-w-0 text-left"><span className="block text-[9px] font-bold leading-none text-neutral-400">{p.code || "—"}</span><span className="block max-w-[150px] truncate text-[11.5px] font-semibold leading-tight text-neutral-700">{p.name || "Без названия"}</span></span>
    </button>
  ); };
  const prodCard = (j) => { const p = prodById[j.productId] || {}; const done = stageOf(j) === "done"; return (
    <button key={j.id} onClick={() => onOpen(j)} title={p.name || ""} className={"flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-left hover:border-neutral-300 " + (done ? "opacity-50" : "")}>
      {thumb(p, 24, 30)}
      <span className="min-w-0"><span className="block text-[9px] font-bold leading-none text-neutral-400">{p.code || "—"}</span><span className="block truncate text-[11.5px] font-semibold leading-tight text-neutral-700">{p.name || "Без названия"}</span></span>
    </button>
  ); };
  const isTask = groupMode === "task";
  const empty = isTask ? !taskRows.length : !rows.length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-neutral-100 p-0.5">
          {[["prod", "По товарам"], ["task", "По задачам"]].map(([id, t]) => <button key={id} onClick={() => setGroupMode(id)} className={"rounded-md px-2.5 py-1 text-[12px] font-semibold transition " + (groupMode === id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>{t}</button>)}
        </div>
        <span className="text-[12px] text-neutral-400">{isTask ? `${nT} ${wT}` : `${nP} ${wP}`}</span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-neutral-500"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="accent-neutral-800" /> скрыть выполненные</label>
      </div>

      {empty ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-neutral-400"><Box size={26} className="text-neutral-300" />Нет задач по товарам{hideDone ? " (кроме выполненных)" : ""}.</div>
      ) : isTask ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {taskRows.map(({ title, jobs: js }) => { const bp = groupPrio(js); const clr = (PRIORITIES[bp] || {}).color || "#cbd5e1"; return (
            <div key={title} className="flex w-[230px] shrink-0 flex-col rounded-xl border border-neutral-200 bg-neutral-50/40 p-2.5">
              <div className="mb-2.5 flex min-h-[34px] items-center gap-2 px-1 py-1.5"><div className="min-w-0 flex-1 text-[13.5px] font-extrabold leading-tight text-neutral-800">{title}</div><span className="shrink-0 rounded-full bg-neutral-200/70 px-2 py-0.5 text-[11px] font-extrabold leading-none text-neutral-600">{js.length}</span></div>
              <div className="flex flex-col gap-1.5">{sortProds(js).map((j) => prodCard(j))}</div>
            </div>
          ); })}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {rows.map(({ p, jobs: js }) => (
            <div key={p.id} className="flex w-[220px] shrink-0 flex-col rounded-xl border border-neutral-200 bg-neutral-50/40 p-2.5">
              <div className="mb-2.5 flex items-center gap-2.5">
                {thumb(p, 36, 46)}
                <div className="min-w-0"><div className="text-[9.5px] font-semibold text-neutral-400">{p.code || "—"}</div><div className="truncate text-[12px] font-bold text-neutral-800" title={p.name}>{p.name || "Без названия"}</div></div>
                <span className="ml-auto shrink-0 rounded-full bg-neutral-200 px-1.5 text-[10px] font-bold text-neutral-500">{js.length}</span>
              </div>
              <div className="flex flex-col gap-1.5">{sortJobs(js).map((j) => card(j, p.name))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KanbanBoard({ jobs, groupBy, sortBy = "created", wide = false, tags, taskLabels, people = [], products, onOpen, onAddJob, onUpdateJob }) {
  const todayStr = isoYMD(new Date());
  const personById = Object.fromEntries((people || []).map((p) => [p.id, p]));
  const dragRef = useRef(null);
  const [overCol, setOverCol] = useState(null);
  const [colsCollapsed, setColsCollapsed] = useState(() => { const v = lsGet("rnp.kanbanColsCollapsed", null); return v && typeof v === "object" ? v : { done: lsGet("rnp.kanbanDoneCollapsed", true) }; });
  useEffect(() => lsSet("rnp.kanbanColsCollapsed", colsCollapsed), [colsCollapsed]);
  const tagById = Object.fromEntries((tags || []).map((t) => [t.id, t]));
  const prodById = Object.fromEntries((products || []).map((p) => [p.id, p]));
  const labelColor = (id) => (taskLabels || []).find((l) => l.id === id)?.color;
  const fmtD = (d) => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : "";

  // колонки строятся из выбранного параметра группировки
  let columns;
  if (groupBy === "status") {
    columns = STAGE_ORDER.map((k) => ({ key: k, name: STAGES[k].label, color: STAGES[k].color, match: (j) => stageOf(j) === k, preset: { stage: k, done: k === "done" } }));
  } else if (groupBy === "label") {
    columns = [
      ...(taskLabels || []).map((l) => ({ key: l.id, name: l.name, color: l.color || "#94a3b8", match: (j) => j.labelId === l.id, preset: { labelId: l.id } })),
      { key: "__none", name: "Без метки", color: "#cbd5e1", match: (j) => !j.labelId || !(taskLabels || []).some((l) => l.id === j.labelId), preset: { labelId: null } },
    ];
  } else {
    columns = [
      { key: "high", name: "Высокий", color: PRIORITIES.high.color, match: (j) => j.priority === "high", preset: { priority: "high" } },
      { key: "med", name: "Средний", color: PRIORITIES.med.color, match: (j) => j.priority === "med", preset: { priority: "med" } },
      { key: "low", name: "Низкий", color: PRIORITIES.low.color, match: (j) => j.priority === "low", preset: { priority: "low" } },
    ];
  }
  const byCol = Object.fromEntries(columns.map((c) => [c.key, []]));
  // сортировка карточек внутри колонок (при сортировке по приоритету сначала задачи со сроком, самые срочные выше): по дате добавления (новые сверху) или по приоритету (высокий сверху);
  // при равенстве — новые выше (стабильно по исходному индексу)
  const jobIdx = new Map(jobs.map((j, i) => [j.id, i]));
  const PRIO_RANK = { high: 0, med: 1, low: 2 };
  const sortedJobs = jobs.slice().sort((a, b) => {
    if (sortBy === "priority") {
      // задачи со сроком всегда выше задач без срока; чем раньше срок (просрочка — самая срочная) — тем выше
      const da = !a.done && stageOf(a) !== "done" && a.date ? a.date : "", db = !b.done && stageOf(b) !== "done" && b.date ? b.date : "";
      if (!!da !== !!db) return da ? -1 : 1;
      if (da && db && da !== db) return da.localeCompare(db);
      const pa = PRIO_RANK[a.priority] ?? 3, pb = PRIO_RANK[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
    }
    const ca = a.createdAt || "", cb = b.createdAt || "";
    if (ca !== cb) return cb.localeCompare(ca);
    return (jobIdx.get(b.id) ?? 0) - (jobIdx.get(a.id) ?? 0);
  });
  sortedJobs.forEach((j) => { const c = columns.find((c) => c.match(j)); if (c) byCol[c.key].push(j); });
  const moveJob = (id, col) => { const j = jobs.find((x) => x.id === id); if (j && !col.match(j)) onUpdateJob({ ...j, ...col.preset }); };
  const [doneOpen, setDoneOpen] = useState({});
  const jobCard = (j) => { const prod = prodById[j.productId]; const jtags = (Array.isArray(j.tags) ? j.tags : []).map((id) => tagById[id]).filter(Boolean); const cl = Array.isArray(j.checklist) ? j.checklist : []; const cdone = cl.filter((c) => c.done).length; const open_ = !j.done && stageOf(j) !== "done" && !!j.date; const over = open_ && j.date < todayStr; const tdy = open_ && j.date === todayStr; const bright = over || tdy;  const overDays = over ? Math.round((new Date(todayStr) - new Date(j.date)) / 86400000) : 0; const tone = over ? { bg: "#CF364C", bd: "#CF364C" } : tdy ? { bg: "#FF9F40", bd: "#FF9F40" } : j.priority === "high" ? { bg: "#fef2f2", bd: "#fca5a5" } : j.priority === "med" ? { bg: "#fffbeb", bd: "#fcd34d" } : { bg: "#f5f5f5", bd: "#d4d4d8" }; return (
    <div key={j.id} draggable onDragStart={() => { dragRef.current = j.id; }} onClick={() => onOpen(j)} className="cursor-pointer rounded-xl p-2.5 transition hover:shadow-sm" style={{ background: tone.bg, border: `1px solid ${tone.bd}` }}>
      <div className={"mb-2 text-sm font-semibold leading-snug " + (j.done ? "text-neutral-400 line-through" : bright ? "text-white" : "text-neutral-800")}>{(markIcon(j.mark) ? markIcon(j.mark) + " " : "") + (stripProdSuffix(j.title, prod && prod.name) || "Без названия")}</div>
      <div className={"grid h-[22px] grid-cols-[1fr_auto_1fr] items-center gap-1.5" + (bright ? " [&_svg]:stroke-white [&_svg]:opacity-90" : "")}>
        <div className="flex min-w-0 items-center gap-1.5 justify-self-start">
          {groupBy !== "status" && (stageOf(j) === "done" ? <StageIcon j={j} /> : <StIcon st={stageOf(j)} />)}
          {cl.length > 0 && <span className={"inline-flex items-center gap-1 text-[11px] font-semibold " + (bright ? "text-white" : cdone === cl.length ? "text-green-600" : "text-neutral-400")}><ListChecks size={12} />{cdone}/{cl.length}</span>}
          {prod && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-500">{prod.code || "товар"}</span>}
        </div>
        <div className="flex items-center justify-self-center">
          {bright ? <span className={"inline-flex items-center justify-center rounded-[7px] bg-white px-[10px] py-[5px] text-[11px] font-black leading-none " + (over ? "text-[#CF364C]" : "text-amber-700")}>{over ? "−" + overDays + " д" : "сегодня"}</span>
            : j.date ? <span className="inline-flex items-center justify-center rounded-[7px] bg-white px-[10px] py-[5px] text-[11px] font-black leading-none text-neutral-700">{fmtD(j.date)}</span> : null}
        </div>
        <div className="flex items-center justify-self-end"><AssigneeAvatars j={j} personById={personById} size={22} /></div>
      </div>
    </div>
  ); };

  return (
    <div className="flex min-h-full gap-3 pb-1">
      {columns.map((col) => { const isDoneCol = groupBy === "status"; const collapsed = isDoneCol && (col.key in colsCollapsed ? !!colsCollapsed[col.key] : false); const wideCol = wide && groupBy === "status" && !collapsed; return (
        <div key={col.key}
          onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
          onDragLeave={() => setOverCol((o) => (o === col.key ? null : o))}
          onDrop={(e) => { e.preventDefault(); moveJob(dragRef.current, col); dragRef.current = null; setOverCol(null); }}
          className={"flex shrink-0 flex-col rounded-2xl border p-2.5 transition " + (collapsed ? "w-auto self-start" : (wideCol ? "w-[30rem]" : "w-72"))}
          style={{ borderColor: overCol === col.key ? "#fdba74" : "#ececef", background: overCol === col.key ? "#fff7ed" : "#fafafa" }}>
          <div className={"flex items-center gap-2 px-1 " + (collapsed ? "" : "mb-2")}>
            {isDoneCol && <button onClick={() => setColsCollapsed((o) => ({ ...o, [col.key]: !collapsed }))} title={collapsed ? "Раскрыть" : "Свернуть"} className="-ml-0.5 shrink-0 text-neutral-400 transition hover:text-neutral-700"><ChevronRight size={15} className={"transition " + (collapsed ? "" : "rotate-90")} /></button>}
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: col.color }} />
            <span className="truncate text-xs font-bold uppercase tracking-wide text-neutral-600">{col.name}</span>
            <span className="rounded-full bg-neutral-200/70 px-1.5 text-[11px] font-bold text-neutral-500">{byCol[col.key].length}</span>
            {!collapsed && <button onClick={() => onAddJob({ ...col.preset })} title="Добавить задачу" className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-200/70 hover:text-neutral-700"><Plus size={15} /></button>}
          </div>
          {!collapsed && (wideCol ? (
            <div className="flex min-h-[40px] gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-2">{byCol[col.key].filter((j) => j.priority !== "high").map((j) => jobCard(j))}</div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">{byCol[col.key].filter((j) => j.priority === "high").map((j) => jobCard(j))}</div>
            </div>
          ) : (
            <div className="flex min-h-[40px] flex-col gap-2">
              {(groupBy === "status" ? byCol[col.key] : byCol[col.key].filter((j) => stageOf(j) !== "done")).map((j) => jobCard(j))}
            </div>
          ))}
          {groupBy !== "status" && (() => { const doneJobs = byCol[col.key].filter((j) => stageOf(j) === "done"); if (!doneJobs.length) return null; const open = !!doneOpen[col.key]; return (
            <div className="mt-2 border-t border-neutral-200/70 pt-2">
              <button onClick={() => setDoneOpen((o) => ({ ...o, [col.key]: !o[col.key] }))} className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"><ChevronRight size={13} className={"transition " + (open ? "rotate-90" : "")} /> Выполненные <span className="rounded-full bg-neutral-200/70 px-1.5 text-[11px] font-bold text-neutral-500">{doneJobs.length}</span></button>
              {open && <div className="mt-2 flex flex-col gap-2">{doneJobs.map((j) => jobCard(j))}</div>}
            </div>
          ); })()}
        </div>
      ); })}
    </div>
  );
}

function JobsListView({ jobs, tags, taskLabels, people = [], products, onOpen, onUpdateJob }) {
  const tagById = Object.fromEntries((tags || []).map((t) => [t.id, t]));
  const prodById = Object.fromEntries((products || []).map((p) => [p.id, p]));
  const personById = Object.fromEntries((people || []).map((p) => [p.id, p]));
  const label = (id) => (taskLabels || []).find((l) => l.id === id);
  const fmtD = (d) => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : "—";
  const sorted = jobs.slice().sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200">
      <table className="w-full border-collapse text-sm">
        <thead><tr className="text-[10px] uppercase tracking-wide text-neutral-400">
          <th className="w-8 px-2 py-2" />
          <th className="px-3 py-2 text-left font-semibold">Задача</th>
          <th className="px-3 py-2 text-left font-semibold">Статус</th>
          <th className="px-3 py-2 text-left font-semibold">Приоритет</th>
          <th className="px-3 py-2 text-left font-semibold">Исполнитель</th>
          <th className="px-3 py-2 text-left font-semibold">Дедлайн</th>
          <th className="px-3 py-2 text-left font-semibold">Товар</th>
        </tr></thead>
        <tbody>
          {sorted.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-neutral-400">Задач нет</td></tr>}
          {sorted.map((j) => { const lb = label(j.labelId); const prod = prodById[j.productId]; const jtags = (Array.isArray(j.tags) ? j.tags : []).map((id) => tagById[id]).filter(Boolean); const done = stageOf(j) === "done"; return (
            <tr key={j.id} className="border-t border-neutral-100 hover:bg-neutral-50/60">
              <td className="px-2 py-2 text-center"><button onClick={() => onUpdateJob(applyStage(j, done ? "wait" : "done"))} className="flex h-4 w-4 items-center justify-center rounded border" style={{ background: done ? "#16a34a" : "#fff", borderColor: done ? "#16a34a" : "#d4d4d4", color: "#fff" }}>{done && <Check size={10} strokeWidth={3} />}</button></td>
              <td className="px-3 py-2"><button onClick={() => onOpen(j)} className={"text-left font-medium hover:text-orange-700 " + (done ? "text-neutral-400 line-through" : "text-neutral-800")}>{(markIcon(j.mark) ? markIcon(j.mark) + " " : "") + (stripProdSuffix(j.title, prod && prod.name) || "Без названия")}</button></td>
              <td className="px-3 py-2"><StageIcon j={j} size={16} /></td>
              <td className="px-3 py-2"><PrioChip p={j.priority} /></td>
              <td className="px-3 py-2">{(() => { const prs = jobAssignees(j).map((id) => personById[id]).filter(Boolean); return prs.length ? <span className="inline-flex items-center gap-1.5 text-xs text-neutral-700">{prs.map((pr) => <span key={pr.id} className="inline-flex items-center gap-1"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: pr.color }}>{(pr.name[0] || "?").toUpperCase()}</span>{pr.name}</span>)}</span> : <span className="text-neutral-300">—</span>; })()}</td>
              <td className="px-3 py-2 text-xs text-neutral-600">{fmtD(j.date)}</td>
              <td className="px-3 py-2 text-xs text-neutral-500">{prod ? (prod.code || prod.name || "товар") : <span className="text-neutral-300">—</span>}</td>
            </tr>
          ); })}
        </tbody>
      </table>
    </div>
  );
}

function CalendarGrid({ jobs, products, ym, todayStr, labelColor, onAddOnDay, onOpen }) {
  const byDate = {};
  (jobs || []).forEach((j) => { if (j.date) (byDate[j.date] ||= []).push(j); });
  const startOffset = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7; // Пн=0
  const cells = Array.from({ length: 42 }, (_, i) => new Date(ym.y, ym.m, 1 - startOffset + i));
  return (
    <div className="grid grid-cols-7 gap-px">
      {WD_SHORT.map((w) => (<div key={w} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{w}</div>))}
      {cells.map((d, i) => {
        const ds = isoYMD(d);
        const inMonth = d.getMonth() === ym.m;
        const isToday = ds === todayStr;
        const list = byDate[ds] || [];
        return (
          <div
            key={i}
            onClick={() => onAddOnDay(ds)}
            className={"min-h-[92px] cursor-pointer rounded-lg border p-1 transition hover:border-sky-300 " + (inMonth ? "border-neutral-100 bg-white" : "border-neutral-100 bg-neutral-50/40")}
          >
            <div className="mb-1 flex items-center justify-between px-0.5">
              <span className={"inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs " + (isToday ? "bg-orange-600 font-bold text-white" : inMonth ? "text-neutral-600" : "text-neutral-300")}>{d.getDate()}</span>
            </div>
            <div className="space-y-0.5">
              {list.slice(0, 3).map((j) => {
                const p = products.find((x) => x.id === j.productId);
                return (
                  <button
                    key={j.id}
                    onClick={(e) => { e.stopPropagation(); onOpen(j); }}
                    className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-neutral-100"
                    title={(p ? p.code + " · " : "") + j.title}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: labelColor(j.labelId) }} />
                    <span className="min-w-0 flex-1 truncate" style={j.done ? { textDecoration: "line-through", color: "#a3a3a3" } : { color: "#404040" }}>{(markIcon(j.mark) ? markIcon(j.mark) + " " : "") + (stripProdSuffix(j.title, p && p.name) || "—")}</span>
                  </button>
                );
              })}
              {list.length > 3 && <div className="px-1 text-[10px] text-neutral-400">+{list.length - 3} ещё</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GanttBoard({ onPrevM, onNextM, jobs, products, batches = [], people = [], opTypes, opDone, onToggleDone, onEditOp, ym, todayStr, labelColor, onAddJob, onOpen, onUpdateJob, onlyType = null, secDone = {}, toggleSecDone = () => {} }) {
  const productOnly = onlyType === "product";
  const personById = Object.fromEntries((people || []).map((p) => [p.id, p]));
  const LW = 320;      // ширина колонки с подписями
  const DW = 30;       // ширина дня
  const BAR_H = 20;    // высота бара
  const TRACK_H = 24;  // шаг дорожки (бар + зазор)

  const timelineRef = useRef(null); // шкала дней — для перевода курсора в день
  const ganttRef = useRef(null);    // область ганта — для проверки «над таймлайном»
  const unschedRef = useRef(null);  // панель нераспределённых — для drop «снять дату»
  const dragRef = useRef(null);     // активное перетаскивание бара
  const [preview, setPreview] = useState(null);   // { jobId, startISO, dateISO } — живое превью бара
  const [overUnsched, setOverUnsched] = useState(false);
  const [cardDrag, setCardDrag] = useState(null);  // перетаскивание карточки из панели { jobId, title, color, x, y }
  const [dropDay, setDropDay] = useState(null);    // подсвеченный день при drop
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const prioColor = (j) => (PRIORITIES[j && j.priority]?.color) || "#9ca3af";
  // день под курсором по шкале (1..daysInMonth) или null, если вне таймлайна
  const dayAtX = (clientX) => {
    const el = timelineRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right) return null;
    return Math.min(daysInMonth, Math.max(1, Math.floor((clientX - r.left) / DW) + 1));
  };
  const overTimeline = (clientX, clientY) => {
    const t = timelineRef.current, g = ganttRef.current; if (!t || !g) return false;
    const tr = t.getBoundingClientRect(), gr = g.getBoundingClientRect();
    return clientX >= tr.left && clientX <= tr.right && clientY >= tr.top && clientY <= gr.bottom;
  };
  const overPanel = (clientX, clientY) => {
    const el = unschedRef.current; if (!el) return false;
    const r = el.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  };

  // перетаскивание бара: move (середина) / l,r (ресайз краёв); drop над панелью — снять дату
  const startBarDrag = (e, j, mode) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const s0 = parseISO(j.start || j.date), e0 = parseISO(j.date || j.start);
    let moved = false;
    dragRef.current = { jobId: j.id };
    const calc = (delta) => {
      let ns = s0, ne = e0;
      if (mode === "move") { ns = addDays(s0, delta); ne = addDays(e0, delta); }
      else if (mode === "l") { ns = addDays(s0, delta); if (ns > e0) ns = e0; }
      else if (mode === "r") { ne = addDays(e0, delta); if (ne < s0) ne = s0; }
      return { ns, ne };
    };
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      const { ns, ne } = calc(Math.round((ev.clientX - startX) / DW));
      setPreview({ jobId: j.id, startISO: isoYMD(ns), dateISO: isoYMD(ne) });
      setOverUnsched(mode === "move" && overPanel(ev.clientX, ev.clientY));
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragRef.current = null; setPreview(null); setOverUnsched(false);
      if (!moved) { onOpen(j); return; }
      if (mode === "move" && overPanel(ev.clientX, ev.clientY)) { onUpdateJob({ ...j, start: null, date: null }); return; }
      const { ns, ne } = calc(Math.round((ev.clientX - startX) / DW));
      onUpdateJob({ ...j, start: isoYMD(ns), date: isoYMD(ne) });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // перетаскивание нераспределённой задачи из панели на гант — назначить дату (1 день)
  const startCardDrag = (e, j) => {
    e.preventDefault();
    setCardDrag({ jobId: j.id, title: j.title || "—", color: prioColor(j), x: e.clientX, y: e.clientY });
    const onMove = (ev) => {
      setCardDrag((c) => (c ? { ...c, x: ev.clientX, y: ev.clientY } : c));
      setDropDay(overTimeline(ev.clientX, ev.clientY) ? dayAtX(ev.clientX) : null);
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const day = overTimeline(ev.clientX, ev.clientY) ? dayAtX(ev.clientX) : null;
      setCardDrag(null); setDropDay(null);
      if (day) { const iso = isoYMD(new Date(ym.y, ym.m, day)); onUpdateJob({ ...j, start: iso, date: iso }); }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const monthFirst = new Date(ym.y, ym.m, 1);
  const monthLast = new Date(ym.y, ym.m, daysInMonth);
  const todayD = parseISO(todayStr);
  const todayInMonth = todayD >= monthFirst && todayD <= monthLast;
  const todayCol = todayInMonth ? todayD.getDate() : 0;

  // свёрнутые секции (сохраняем в localStorage)
  const [collapsed, setCollapsed] = useState(() => { try { return JSON.parse(localStorage.getItem("rnp-gantt-collapsed") || "{}"); } catch { return {}; } });
  const toggleSection = (id) => setCollapsed((c) => { const n = { ...c, [id]: !c[id] }; try { localStorage.setItem("rnp-gantt-collapsed", JSON.stringify(n)); } catch {} return n; });
  // показ выполненных задач по разделам (по умолчанию скрыты)

  // позиция задачи внутри месяца (или null, если вне диапазона)
  const place = (j) => {
    if (!j.date && !j.start) return null;
    let s = parseISO(j.start || j.date);
    let e = parseISO(j.date || j.start);
    if (e < s) { const t = s; s = e; e = t; }
    if (e < monthFirst || s > monthLast) return null;
    const vs = s < monthFirst ? monthFirst : s;
    const ve = e > monthLast ? monthLast : e;
    return { startCol: vs.getDate(), endCol: ve.getDate(), clipL: s < monthFirst, clipR: e > monthLast };
  };

  // дорожки внутри строки (чтобы бары не накладывались)
  const withTracks = (list) => {
    const bars = list.map((x) => ({ ...x })).sort((a, b) => a.pos.startCol - b.pos.startCol || a.pos.endCol - b.pos.endCol);
    const ends = [];
    bars.forEach((b) => {
      let t = ends.findIndex((end) => b.pos.startCol > end);
      if (t === -1) { t = ends.length; ends.push(b.pos.endCol); } else ends[t] = b.pos.endCol;
      b.track = t;
    });
    return { bars, tracks: Math.max(1, ends.length) };
  };

  // раскладка задач по группам (операционные — отдельно, через регулярность)
  const visible = (jobs || []).map((j) => ({ j, pos: place(j) })).filter((x) => x.pos);
  // Проектные — тип project (без привязки к товару/партии)
  const projItems = visible.filter((x) => jobType(x.j) === "project");
  // Закупки — тип purchase, группировка по партиям
  const purMap = new Map();
  visible.forEach((x) => { if (jobType(x.j) !== "purchase") return; const bid = x.j.batchId || "__none"; (purMap.get(bid) || purMap.set(bid, []).get(bid)).push(x); });
  const batchRows = [];
  (batches || []).forEach((b) => { if (purMap.has(b.id)) batchRows.push({ key: b.id, label: "«" + (b.name || "Партия") + "»", preset: { type: "purchase", batchId: b.id }, items: purMap.get(b.id) }); });
  if (purMap.has("__none")) batchRows.push({ key: "__nobatch", label: "Без партии", preset: { type: "purchase" }, items: purMap.get("__none") });
  const purCount = batchRows.reduce((a, r) => a + r.items.length, 0);
  // Задачи по товарам — тип product, группировка по товарам
  const prodMap = new Map();
  visible.forEach((x) => {
    if (jobType(x.j) !== "product") return;
    (prodMap.get(x.j.productId) || prodMap.set(x.j.productId, []).get(x.j.productId)).push(x);
  });
  const prodRows = products
    .filter((p) => prodMap.has(p.id))
    .map((p) => ({ key: p.id, label: (p.code || "—") + (p.name ? " · " + p.name : ""), code: p.code || "—", name: p.name || "Без названия", img: p.image || null, preset: { type: "product", productId: p.id }, items: prodMap.get(p.id) }));

  const timelineW = daysInMonth * DW;
  // нераспределённые — задачи без даты и без начала (операционные сюда не входят — они в opTypes)
  const PRIO_RANK = { high: 0, med: 1, low: 2 };
  const unscheduled = (jobs || []).filter((j) => !j.date && !j.start && stageOf(j) !== "done") // выполненные не показываем
    .sort((a, b) => (PRIO_RANK[a.priority] ?? 3) - (PRIO_RANK[b.priority] ?? 3)); // сверху высокий приоритет

  const Bar = ({ x }) => {
    const prev = preview && preview.jobId === x.j.id;
    const pos = prev ? (place({ start: preview.startISO, date: preview.dateISO }) || x.pos) : x.pos;
    const { startCol, endCol, clipL, clipR } = pos;
    const left = (startCol - 1) * DW;
    const width = (endCol - startCol + 1) * DW - 4;
    const pm = PRIORITIES[x.j.priority];
    const done = x.j.done;
    const barBg = done ? "#f5f6f7" : (pm ? pm.soft : "#f8f8f9"); // как канбан-карточка: мягкая заливка
    const barBd = done ? "#e2e3e6" : (pm ? pm.color : "#d4d4d8"); // цветной контур по приоритету
    const barTxt = done ? "#9a9aa2" : "#1f1f24"; // тёмный текст
    const dragging = dragRef.current && dragRef.current.jobId === x.j.id;
    return (
      <div
        onPointerDown={(e) => startBarDrag(e, x.j, "move")}
        title={x.j.title}
        className="group/bar absolute flex items-center overflow-hidden text-left text-[11px] font-semibold shadow-sm"
        style={{
          left: left + 2, width: Math.max(width, DW - 4), top: x.track * TRACK_H + 3, height: BAR_H,
          background: barBg, color: barTxt, border: `1.5px solid ${barBd}`,
          borderRadius: 7,
          borderTopLeftRadius: clipL ? 0 : 7, borderBottomLeftRadius: clipL ? 0 : 7,
          borderTopRightRadius: clipR ? 0 : 7, borderBottomRightRadius: clipR ? 0 : 7,
          cursor: "grab", touchAction: "none",
          outline: dragging ? "2px solid rgba(0,0,0,.25)" : "none",
        }}
      >
        <span
          onPointerDown={(e) => startBarDrag(e, x.j, "l")}
          className="absolute inset-y-0 left-0 flex w-2 cursor-ew-resize items-center justify-center opacity-0 transition group-hover/bar:opacity-100"
          title="Изменить начало"
        ><span className="h-2.5 w-0.5 rounded bg-neutral-400/70" /></span>
        <span className="truncate px-2" style={x.j.done ? { textDecoration: "line-through" } : undefined}>{(markIcon(x.j.mark) ? markIcon(x.j.mark) + " " : "") + (stripProdSuffix(x.j.title, (products.find((p) => p.id === x.j.productId) || {}).name) || "—")}</span>
        <span
          onPointerDown={(e) => startBarDrag(e, x.j, "r")}
          className="absolute inset-y-0 right-0 flex w-2 cursor-ew-resize items-center justify-center opacity-0 transition group-hover/bar:opacity-100"
          title="Изменить длительность"
        ><span className="h-2.5 w-0.5 rounded bg-neutral-400/70" /></span>
      </div>
    );
  };

  const Row = ({ row, emptyHint }) => {
    const { bars, tracks } = withTracks(row.items);
    const rowH = tracks * TRACK_H + 6;
    const isProd = row.preset && row.preset.type === "product";
    return (
      <div className="flex border-t border-neutral-100">
        {isProd ? (
          <div className="group relative flex shrink-0 items-center gap-3 py-1.5 pl-2.5 pr-2" style={{ width: LW }}>
            <div className="flex h-[60px] w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-100 text-neutral-300">{row.img ? <img src={row.img} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={18} />}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-neutral-400">{row.code}</div>
              <div className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-tight text-neutral-800" title={row.name}>{row.name}</div>
            </div>
            <button onClick={() => onAddJob({ ...row.preset, date: todayStr })} className="shrink-0 rounded p-0.5 text-neutral-300 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100" title="Добавить задачу по товару"><Plus size={13} /></button>
          </div>
        ) : (
        <div className="group relative flex shrink-0 items-center gap-1 py-1 pr-2" style={{ width: LW }}>
          {row.img !== undefined && (
            <div className="ml-1 flex h-7 w-[22px] shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-100 text-neutral-300">{row.img ? <img src={row.img} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={11} />}</div>
          )}
          {!row.preset && row.items.length === 1 ? (
            <button onClick={() => onOpen(row.items[0].j)} title="Открыть задачу" className={"min-w-0 flex-1 truncate pl-1 text-left text-[12px] hover:text-orange-700 hover:underline " + (row.items[0].j.done ? "text-neutral-400 line-through" : "text-neutral-700")}>{row.label}</button>
          ) : (
            <span className="min-w-0 flex-1 truncate pl-1 text-[12px] text-neutral-700" title={row.label}>{row.label}</span>
          )}
          {row.preset && (
            <button
              onClick={() => onAddJob({ ...row.preset, date: todayStr })}
              className="shrink-0 rounded p-0.5 text-neutral-300 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100"
              title="Добавить задачу"
            ><Plus size={13} /></button>
          )}
        </div>
        )}
        <div className="relative shrink-0" style={{ width: timelineW, height: rowH }} onClick={() => row.preset && onAddJob({ ...row.preset, date: todayStr })}>
          {bars.map((b) => <Bar key={b.j.id} x={b} />)}
          {bars.length === 0 && emptyHint && <span className="absolute left-2 top-1.5 text-[11px] text-neutral-300">{emptyHint}</span>}
        </div>
      </div>
    );
  };

  // строка операционной задачи — чек-боксы по графику регулярности
  const OpRow = ({ op }) => {
    const days = occurrenceDays(op.recur, ym.y, ym.m);
    const doneMap = (opDone && opDone[op.id]) || {};
    const daySet = new Set(days);
    return (
      <div className="flex border-t border-neutral-100">
        <button
          onClick={() => onEditOp(op)}
          className="group flex shrink-0 items-center py-1 pl-2 pr-2 text-left hover:bg-neutral-50"
          style={{ width: LW }}
          title="Настроить график"
        >
          <span className="w-full truncate text-[12px] text-neutral-700 group-hover:text-neutral-900">{op.name}</span>
        </button>
        <div className="relative flex shrink-0 items-center" style={{ width: timelineW, height: TRACK_H + 6 }}>
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = i + 1;
            if (!daySet.has(d)) return <div key={i} style={{ width: DW }} />;
            const ds = isoYMD(new Date(ym.y, ym.m, d));
            const done = !!doneMap[ds];
            const overdue = !done && d < todayCol;
            return (
              <div key={i} className="flex items-center justify-center" style={{ width: DW }}>
                <button
                  onClick={() => onToggleDone(op.id, ds)}
                  title={done ? "Выполнено — снять отметку" : "Отметить выполнено"}
                  className="flex items-center justify-center transition hover:scale-110"
                  style={{
                    width: 18, height: 18, borderRadius: 5,
                    background: done ? "#16a34a" : overdue ? "#fef2f2" : "#fff",
                    border: done ? "2px solid #16a34a" : overdue ? "2px solid #fca5a5" : "2px solid #d4d4d4",
                    color: "#fff",
                  }}
                >{done && <Check size={12} strokeWidth={3} />}</button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const Section = ({ id, title, count, doneCount = 0, children }) => {
    const isOp = id === "op"; // операционные: единственный раздел в своём виде — без заголовка и сворачивания
    const bare = !isOp && (onlyType === "purchase" || onlyType === "project"); // единственный раздел вида: без названия и стрелки раскрытия
    const open = isOp || bare || !collapsed[id];
    const showDone = !!secDone[id];
    return (
      <div className="mt-2 first:mt-0">
        {!isOp && !bare && <div className="flex items-center gap-1.5 bg-neutral-50 px-2 py-1" style={{ width: LW + timelineW }}>
          {!bare && <button onClick={() => toggleSection(id)} className="flex items-center gap-1.5 text-left transition hover:opacity-70">
            <ChevronDown size={13} className="shrink-0 text-neutral-400 transition-transform" style={{ transform: open ? "none" : "rotate(-90deg)" }} />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</span>
            <span className="rounded-full bg-neutral-200/80 px-1.5 text-[10px] font-semibold leading-[16px] text-neutral-500">{count}</span>
          </button>}
          {doneCount > 0 && (
            <button onClick={() => toggleSecDone(id)} title={showDone ? "Скрыть выполненные" : "Показать выполненные"} className={"ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-semibold transition " + (showDone ? "text-neutral-600 hover:bg-neutral-200/70" : "text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-600")}>
              {showDone ? <Eye size={13} /> : <EyeOff size={13} />}{doneCount}
            </button>
          )}
        </div>}
        {open && children}
      </div>
    );
  };

  // учёт выполненных по разделам (глаз): скрыть, либо показать внизу
  const doneCountOf = (rows) => rows.reduce((a, r) => a + r.items.filter((x) => x.j.done).length, 0);
  const filterRows = (rows, show) => rows.map((r) => ({ ...r, items: show ? [...r.items.filter((x) => !x.j.done), ...r.items.filter((x) => x.j.done)] : r.items.filter((x) => !x.j.done) })).filter((r) => r.items.length > 0);
  const purDoneCount = doneCountOf(batchRows);
  const prodDoneCount = doneCountOf(prodRows);
  const purRowsShown = filterRows(batchRows, !!secDone.pur);
  const prodRowsShown = filterRows(prodRows, !!secDone.prod);
  const projActive = projItems.filter((x) => !x.j.done);
  const projDone = projItems.filter((x) => x.j.done);
  const projShown = secDone.gen ? [...projActive, ...projDone] : projActive;

  return (
    <div className="flex items-stretch">
    <div ref={ganttRef} className="min-w-0 flex-1 overflow-x-auto">
      <div className="relative" style={{ minWidth: LW + timelineW }}>
        {/* линия «сегодня» на всю высоту */}
        {todayInMonth && (
          <div className="pointer-events-none absolute bottom-0 z-10 w-px bg-orange-400" style={{ left: LW + (todayCol - 1) * DW + DW / 2, top: 36 }} />
        )}

        {/* подсветка дня при перетаскивании карточки из панели */}
        {cardDrag && dropDay && (
          <div className="pointer-events-none absolute z-10 border-x border-orange-300 bg-orange-100/40" style={{ left: LW + (dropDay - 1) * DW, width: DW, top: 36, bottom: 0 }} />
        )}

        {/* шапка дней */}
        <div className="flex" style={{ height: 36 }}>
          <div className="flex shrink-0 items-center gap-1.5 pl-1" style={{ width: LW }}>
            <button onClick={onPrevM} title="Предыдущий месяц" className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /></button>
            <button onClick={onNextM} title="Следующий месяц" className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><ChevronRight size={16} /></button>
            <h2 className="ml-1 whitespace-nowrap text-base font-semibold capitalize text-neutral-900">{MONTHS_FULL[ym.m]} {ym.y}</h2>
          </div>
          <div ref={timelineRef} className="flex shrink-0" style={{ width: timelineW }}>
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = new Date(ym.y, ym.m, i + 1);
              const we = d.getDay() === 0 || d.getDay() === 6;
              const isToday = i + 1 === todayCol;
              return (
                <div key={i} className="flex flex-col items-center gap-0.5 pt-0.5" style={{ width: DW }}>
                  <span className={"text-[11px] font-medium leading-none " + (isToday ? "inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-600 font-bold text-white" : we ? "text-neutral-300" : "text-neutral-500")}>{i + 1}</span>
                  <span className={"text-[9px] font-medium leading-none " + (we ? "text-neutral-300" : "text-neutral-400")}>{WD_LABEL[d.getDay()]}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* фон выходных */}
        <div className="pointer-events-none absolute inset-y-0 flex" style={{ left: LW, top: 36 }}>
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = new Date(ym.y, ym.m, i + 1);
            const we = d.getDay() === 0 || d.getDay() === 6;
            return <div key={i} style={{ width: DW }} className={we ? "bg-neutral-50/70" : ""} />;
          })}
        </div>

        <div className="relative">
          {(!onlyType || onlyType === "op") && (
          <Section id="op" title="Операционные задачи" count={(opTypes || []).length}>
            {(opTypes || []).length === 0
              ? <div className="border-t border-neutral-100 px-2 py-2 text-[11px] text-neutral-400" style={{ width: LW + timelineW }}>Добавьте операционные задачи в настройках</div>
              : (opTypes || []).map((op) => <OpRow key={op.id} op={op} />)}
          </Section>
          )}
          {(!onlyType || onlyType === "project") && (
          <Section id="gen" title="Проектные" count={projItems.length} doneCount={projDone.length}>
            {projItems.length === 0
              ? <div className="border-t border-neutral-100 px-2 py-2 text-[11px] text-neutral-400" style={{ width: LW + timelineW }}>Нет проектных задач в этом месяце</div>
              : projShown.length === 0
              ? <div className="border-t border-neutral-100 px-2 py-2 text-[11px] text-neutral-400" style={{ width: LW + timelineW }}>Все проектные задачи выполнены — нажмите глаз, чтобы показать</div>
              : projShown.map((x) => <Row key={x.j.id} row={{ key: x.j.id, label: x.j.title || "—", preset: null, items: [x] }} />)}
          </Section>
          )}
          {(!onlyType || onlyType === "product") && (
          <Section id="prod" title="Задачи по товарам" count={prodRows.length} doneCount={prodDoneCount}>
            {prodRows.length === 0
              ? <div className="border-t border-neutral-100 px-2 py-2 text-[11px] text-neutral-400" style={{ width: LW + timelineW }}>Нет задач по товарам в этом месяце</div>
              : prodRowsShown.map((row) => <Row key={row.key} row={row} />)}
          </Section>
          )}
        </div>
      </div>
    </div>

    {/* Нераспределённые задачи (без даты) — скрыты для «по товарам» и операционных */}
    {onlyType !== "product" && onlyType !== "op" && onlyType !== "project" && (
    <aside ref={unschedRef} className={"flex w-[250px] shrink-0 flex-col self-stretch border-l transition " + (overUnsched ? "border-orange-300 bg-orange-50/60" : "border-neutral-200 bg-neutral-50/40")}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <ListIcon size={14} className="text-neutral-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Нераспределённые</span>
        <span className="rounded-full bg-neutral-200/80 px-1.5 text-[10px] font-semibold leading-[16px] text-neutral-500">{unscheduled.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-auto px-3 pb-3">
        {unscheduled.length === 0 ? (
          <p className="px-1 py-6 text-center text-[11px] text-neutral-400">Все задачи на ганте. Перетащите бар сюда, чтобы снять дату.</p>
        ) : unscheduled.map((j) => {
          const pm = PRIORITIES[j.priority];
          const cl = Array.isArray(j.checklist) ? j.checklist : [];
          const cdone = cl.filter((c) => c.done).length;
          return (
            <div key={j.id} onPointerDown={(e) => startCardDrag(e, j)} onClick={() => onOpen(j)}
              className="cursor-grab rounded-xl p-2.5 shadow-sm transition hover:shadow-md"
              style={{ background: pm ? pm.soft : "#fff", border: `1.5px solid ${pm ? pm.color : "#e5e5e5"}`, touchAction: "none" }}>
              <div className={"mb-2 text-sm font-semibold leading-snug " + (j.done ? "text-neutral-400 line-through" : "text-neutral-800")}>{(markIcon(j.mark) ? markIcon(j.mark) + " " : "") + (stripProdSuffix(j.title, (products.find((x) => x.id === j.productId) || {}).name) || "Без названия")}</div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StageIcon j={j} />
                {cl.length > 0 && <span className={"inline-flex items-center gap-1 text-[11px] font-semibold " + (cdone === cl.length ? "text-green-600" : "text-neutral-400")}><ListChecks size={12} />{cdone}/{cl.length}</span>}
                <AssigneeAvatars j={j} personById={personById} size={20} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-neutral-100 px-3 py-2 text-[10px] leading-snug text-neutral-400">Перетащите карточку на гант → назначить дату. Перетащите бар сюда → снять дату.</div>
    </aside>
    )}

    {/* Плавающий «призрак» перетаскиваемой карточки */}
    {cardDrag && (
      <div className="pointer-events-none fixed z-[90] max-w-[220px] truncate rounded-xl bg-white px-2.5 py-1.5 text-[12px] font-semibold text-neutral-800 shadow-lg"
        style={{ left: cardDrag.x + 12, top: cardDrag.y + 12, border: `1.5px solid ${cardDrag.color}` }}>
        {cardDrag.title}
      </div>
    )}
    </div>
  );
}

const TASK_TYPE_META = [
  { key: "op", label: "Операционная", short: "Операц.", Icon: Repeat, tint: "#6366f1", bg: "#eef2ff", hint: "раздел «Операционные»" },
  { key: "project", label: "Проектная", short: "Проектная", Icon: FileText, tint: "#7c3aed", bg: "#f5f3ff", hint: "раздел «Проектные»" },
  { key: "product", label: "Товар", short: "Товар", Icon: Box, tint: "#ea580c", bg: "#fff7ed", hint: "раздел «Задачи по товарам»" },
];
// ===== Материалы задачи: таблицы с «/»-панелью (как в Notion) =====
const TT_STATUSES = [
  { id: "wait", label: "Ожидает", bg: "#dbeafe", fg: "#1d4ed8" },
  { id: "work", label: "В работе", bg: "#fef3c7", fg: "#b45309" },
  { id: "done", label: "Готово", bg: "#dcfce7", fg: "#15803d" },
  { id: "block", label: "Блок", bg: "#fee2e2", fg: "#b91c1c" },
  { id: "idea", label: "Идея", bg: "#ede9fe", fg: "#6d28d9" },
];
const TT_KINDS = [
  { k: "check", label: "Чекбокс", ic: "☑", kw: "чекбокс галочка check" },
  { k: "list", label: "Список с галочками", ic: "☰", kw: "список галочки пункты list" },
  { k: "status", label: "Статус / тег", ic: "●", kw: "статус тег метка status" },
  { k: "user", label: "Исполнитель", ic: "👤", kw: "исполнитель человек user" },
  { k: "date", label: "Дата", ic: "▣", kw: "дата date" },
  { k: "link", label: "Ссылка", ic: "↗", kw: "ссылка link url" },
  { k: "text", label: "Текст", ic: "Aa", kw: "текст text" },
];
function ttNewTable() {
  return { id: uid(), title: "Новая таблица", cols: [1, 2, 3].map((n) => ({ id: uid(), name: "Столбец " + n })), rows: [1, 2, 3].map(() => ({ id: uid(), cells: {} })) };
}
function ttCellText(cell, people) {
  if (!cell) return "";
  if (cell.k === "check") return cell.v ? "☑" : "☐";
  if (cell.k === "list") return (cell.v || []).filter((x) => x.text).map((x) => (x.done ? "☑ " : "☐ ") + x.text).join(", ");
  if (cell.k === "status") { const s = TT_STATUSES.find((x) => x.id === cell.v); return s ? s.label : ""; }
  if (cell.k === "user") { const p = (people || []).find((x) => x.id === cell.v); return p ? profileLabel(p) : ""; }
  if (cell.k === "date") return cell.v ? String(cell.v).split("-").reverse().slice(0, 2).join(".") : "";
  return String(cell.v || "");
}
function TaskTableEditor({ table, people = [], onChange, onClose, onDelete }) {
  const t = table;
  const [pop, setPop] = useState(null); // {kind:'slash'|'type'|'status'|'user', rid, cid, x, y, sel}
  const [delAsk, setDelAsk] = useState(false);
  const upd = (patch) => onChange({ ...t, ...patch });
  const setCell = (rid, cid, cell) => upd({ rows: t.rows.map((r) => (r.id === rid ? { ...r, cells: { ...r.cells, [cid]: cell } } : r)) });
  const addRow = () => { const id = uid(); upd({ rows: [...t.rows, { id, cells: {} }] }); return id; };
  const addCol = () => upd({ cols: [...t.cols, { id: uid(), name: "Столбец " + (t.cols.length + 1) }] });
  const delRow = (rid) => upd({ rows: t.rows.filter((r) => r.id !== rid) });
  const delCol = (cid) => { if (t.cols.length <= 1) return; upd({ cols: t.cols.filter((c) => c.id !== cid), rows: t.rows.map((r) => { const cells = { ...r.cells }; delete cells[cid]; return { ...r, cells }; }) }); };
  const focusCell = (key) => setTimeout(() => { const el = document.querySelector('[data-cell="' + key + '"]'); if (el) { el.focus(); if (el.select && el.type !== "date") el.select(); } }, 40);
  const posOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.max(8, Math.min(r.left, window.innerWidth - 236)), y: Math.min(r.bottom + 4, window.innerHeight - 290) }; };
  const slashItems = (q) => { const s = String(q || "").trim().toLowerCase(); return s ? TT_KINDS.filter((k) => k.label.toLowerCase().includes(s) || k.kw.includes(s)) : TT_KINDS; };
  const cellVal = (rid, cid) => { const r = t.rows.find((x) => x.id === rid); const c = r && r.cells[cid]; return c && c.k === "text" ? String(c.v || "") : ""; };
  const pickKind = (rid, cid, k, pos) => {
    const first = uid();
    const init = { check: false, list: [{ id: first, text: "", done: false }], status: null, user: null, date: "", link: "", text: "" }[k];
    setCell(rid, cid, { k, v: init });
    if (k === "status" || k === "user") setPop({ kind: k, rid, cid, x: pos.x, y: pos.y });
    else setPop(null);
    if (k === "list") focusCell(rid + ":" + cid + ":" + first);
    else if (k === "link" || k === "date" || k === "text") focusCell(rid + ":" + cid);
  };
  const onTextChange = (e, rid, cid) => {
    const v = e.target.value; setCell(rid, cid, { k: "text", v });
    if (v.startsWith("/")) { const pos = posOf(e.target); setPop({ kind: "slash", rid, cid, sel: 0, x: pos.x, y: pos.y }); }
    else setPop((p) => (p && p.kind === "slash" ? null : p));
  };
  const onTextKey = (e, ri, rid, cid, ci) => {
    const inSlash = pop && pop.kind === "slash" && pop.rid === rid && pop.cid === cid;
    if (inSlash) {
      const items = slashItems(cellVal(rid, cid).slice(1));
      if (items.length) {
        if (e.key === "ArrowDown") { e.preventDefault(); setPop({ ...pop, sel: (pop.sel + 1) % items.length }); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setPop({ ...pop, sel: (pop.sel - 1 + items.length) % items.length }); return; }
        if (e.key === "Enter") { e.preventDefault(); pickKind(rid, cid, items[pop.sel % items.length].k, pop); return; }
      }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPop(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const next = t.rows[ri + 1];
      if (next) focusCell(next.id + ":" + cid); else { const id = addRow(); focusCell(id + ":" + cid); }
    }
  };
  const onPaste = (e, ri, ci) => {
    const raw = e.clipboardData.getData("text").replace(/\r/g, "").replace(/\n$/, "");
    if (!/[\t\n]/.test(raw)) return;
    e.preventDefault();
    const lines = raw.split("\n").map((l) => l.split("\t"));
    const cols = [...t.cols], rows = [...t.rows];
    const needC = ci + Math.max(...lines.map((l) => l.length));
    while (cols.length < needC) cols.push({ id: uid(), name: "Столбец " + (cols.length + 1) });
    while (rows.length < ri + lines.length) rows.push({ id: uid(), cells: {} });
    lines.forEach((l, i) => { const r = rows[ri + i]; const cells = { ...r.cells }; l.forEach((v, j) => { cells[cols[ci + j].id] = { k: "text", v }; }); rows[ri + i] = { ...r, cells }; });
    upd({ cols, rows }); setPop(null);
  };
  const inCls = "h-[38px] w-full bg-transparent px-3 text-[13.5px] text-neutral-800 placeholder:text-neutral-300 focus:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500";
  const renderCell = (r, ri, c, ci) => {
    const cell = r.cells[c.id] || { k: "text", v: "" };
    const key = r.id + ":" + c.id;
    const typeBtn = (
      <button type="button" onClick={(e) => { const p = posOf(e.currentTarget.closest("td")); setPop({ kind: "type", rid: r.id, cid: c.id, x: p.x, y: p.y }); }}
        className="absolute right-1 top-[9px] hidden h-5 w-5 items-center justify-center rounded text-[13px] font-bold leading-none text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600 group-hover:flex" title="Сменить тип ячейки">⋯</button>
    );
    const tdp = (e) => posOf(e.currentTarget.closest("td"));
    let body;
    if (cell.k === "check") {
      body = (
        <div className="flex h-[38px] items-center px-3">
          <button type="button" onClick={() => setCell(r.id, c.id, { k: "check", v: !cell.v })} className={"flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-[1.5px] transition " + (cell.v ? "border-green-500 bg-green-500 text-white" : "border-neutral-300 bg-white hover:border-neutral-400")}>{cell.v && <Check size={12} strokeWidth={3} />}</button>
        </div>
      );
    } else if (cell.k === "list") {
      const arr = Array.isArray(cell.v) ? cell.v : [];
      const setArr = (a) => setCell(r.id, c.id, { k: "list", v: a });
      body = (
        <div className="px-3 py-[7px] pr-7">
          {arr.map((it, ii) => (
            <div key={it.id} className="flex items-center gap-2 py-[1px]">
              <button type="button" onClick={() => setArr(arr.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))} className={"flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] " + (it.done ? "border-green-500 bg-green-500 text-white" : "border-neutral-300 bg-white")}>{it.done && <Check size={11} strokeWidth={3} />}</button>
              <input data-cell={key + ":" + it.id} value={it.text} placeholder="Пункт"
                onChange={(e) => setArr(arr.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); const nid = uid(); const a = [...arr]; a.splice(ii + 1, 0, { id: nid, text: "", done: false }); setArr(a); focusCell(key + ":" + nid); }
                  else if (e.key === "Backspace" && !it.text) { e.preventDefault(); if (arr.length <= 1) { setCell(r.id, c.id, { k: "text", v: "" }); focusCell(key); } else { setArr(arr.filter((x) => x.id !== it.id)); const pv = arr[ii - 1] || arr[ii + 1]; if (pv) focusCell(key + ":" + pv.id); } }
                }}
                className={"min-w-0 flex-1 bg-transparent py-[3px] text-[13.5px] placeholder:text-neutral-300 focus:outline-none " + (it.done ? "text-neutral-400 line-through" : "text-neutral-800")} />
            </div>
          ))}
          <button type="button" onClick={() => { const nid = uid(); setArr([...arr, { id: nid, text: "", done: false }]); focusCell(key + ":" + nid); }} className="hidden text-[12px] font-semibold text-neutral-300 hover:text-neutral-500 group-hover:block">+ пункт</button>
        </div>
      );
    } else if (cell.k === "status") {
      const s = TT_STATUSES.find((x) => x.id === cell.v);
      body = (
        <button type="button" onClick={(e) => { const p = tdp(e); setPop({ kind: "status", rid: r.id, cid: c.id, x: p.x, y: p.y }); }} className="flex h-[38px] w-full items-center px-3 text-left">
          {s ? <span className="rounded-md px-2 py-[2px] text-[12.5px] font-bold" style={{ background: s.bg, color: s.fg }}>{s.label}</span> : <span className="text-[13px] text-neutral-300">выбрать статус…</span>}
        </button>
      );
    } else if (cell.k === "user") {
      const p = people.find((x) => x.id === cell.v);
      body = (
        <button type="button" onClick={(e) => { const pp = tdp(e); setPop({ kind: "user", rid: r.id, cid: c.id, x: pp.x, y: pp.y }); }} className="flex h-[38px] w-full items-center gap-2 px-3 text-left">
          {p ? <><PersonAvatar p={p} size={20} /><span className="truncate text-[13.5px] font-semibold text-neutral-800">{profileLabel(p)}</span></> : <span className="text-[13px] text-neutral-300">выбрать…</span>}
        </button>
      );
    } else if (cell.k === "date") {
      body = <input data-cell={key} type="date" value={cell.v || ""} onChange={(e) => setCell(r.id, c.id, { k: "date", v: e.target.value })} className={inCls + " pr-7"} />;
    } else if (cell.k === "link") {
      const url = String(cell.v || "").trim();
      body = (
        <div className="flex items-center">
          <input data-cell={key} value={cell.v || ""} placeholder="https://…" onChange={(e) => setCell(r.id, c.id, { k: "link", v: e.target.value })} className={inCls + " " + (url ? "text-violet-700 underline" : "")} />
          {url && <a href={/^https?:\/\//i.test(url) ? url : "https://" + url} target="_blank" rel="noreferrer" className="mr-7 shrink-0 text-neutral-300 hover:text-violet-600" title="Открыть"><ExternalLink size={13} /></a>}
        </div>
      );
    } else {
      body = <textarea data-cell={key} rows={1} value={cell.v || ""} ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }} onChange={(e) => onTextChange(e, r.id, c.id)} onKeyDown={(e) => onTextKey(e, ri, r.id, c.id, ci)} onPaste={(e) => onPaste(e, ri, ci)} onBlur={() => setPop((p) => (p && p.kind === "slash" ? null : p))} className={inCls.replace("h-[38px]", "block min-h-[38px] resize-none overflow-hidden py-[9px] leading-[20px]")} />;
    }
    return (
      <td key={c.id} className="group relative min-w-[170px] border border-neutral-200 p-0 align-top">
        {body}
        {cell.k !== "text" && typeBtn}
      </td>
    );
  };
  const popItems = pop && (pop.kind === "slash" ? slashItems(cellVal(pop.rid, pop.cid).slice(1)) : TT_KINDS);
  return (
    <div className="fixed inset-0 z-[85] flex flex-col bg-white" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-5 py-3">
        <button onClick={onClose} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] font-bold text-violet-600 hover:bg-violet-50"><ChevronLeft size={15} /> К задаче</button>
        <input value={t.title} onChange={(e) => upd({ title: e.target.value })} placeholder="Название таблицы" className="min-w-[160px] flex-1 border-none bg-transparent text-[17px] font-extrabold text-neutral-900 placeholder:text-neutral-300 focus:outline-none" />
        <button onClick={addRow} className="inline-flex h-8 items-center gap-1 rounded-[9px] border border-neutral-200 px-3 text-[12.5px] font-bold text-neutral-700 hover:bg-neutral-50"><Plus size={13} /> Строка</button>
        <button onClick={addCol} className="inline-flex h-8 items-center gap-1 rounded-[9px] border border-neutral-200 px-3 text-[12.5px] font-bold text-neutral-700 hover:bg-neutral-50"><Plus size={13} /> Столбец</button>
        {delAsk
          ? <button onClick={onDelete} onMouseLeave={() => setDelAsk(false)} className="inline-flex h-8 items-center rounded-[9px] bg-red-600 px-3 text-[12.5px] font-bold text-white">Точно удалить?</button>
          : <button onClick={() => setDelAsk(true)} className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-neutral-200 text-neutral-400 hover:text-red-500" title="Удалить таблицу"><Trash2 size={14} /></button>}
        <button onClick={onClose} className="inline-flex h-8 items-center rounded-[9px] bg-neutral-900 px-4 text-[12.5px] font-bold text-white hover:bg-neutral-700">Готово</button>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-7 border border-transparent" />
              {t.cols.map((c) => (
                <th key={c.id} className="group relative border border-neutral-200 bg-neutral-50 p-0 text-left">
                  <input value={c.name} onChange={(e) => upd({ cols: t.cols.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) })} className="h-[36px] w-full bg-transparent px-3 pr-7 text-[12px] font-extrabold uppercase tracking-wide text-neutral-500 focus:bg-violet-50 focus:outline-none" />
                  {t.cols.length > 1 && <button onClick={() => delCol(c.id)} className="absolute right-1.5 top-[9px] hidden h-[18px] w-[18px] items-center justify-center rounded text-neutral-300 hover:bg-neutral-200 hover:text-red-500 group-hover:flex" title="Удалить столбец"><X size={12} /></button>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, ri) => (
              <tr key={r.id} className="group/row">
                <td className="w-7 border border-transparent p-0 text-center align-top"><button onClick={() => delRow(r.id)} className="mt-[10px] hidden h-[18px] w-[18px] items-center justify-center rounded text-neutral-300 hover:bg-neutral-100 hover:text-red-500 group-hover/row:inline-flex" title="Удалить строку"><X size={12} /></button></td>
                {t.cols.map((c, ci) => renderCell(r, ri, c, ci))}
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => { const id = addRow(); focusCell(id + ":" + t.cols[0].id); }} className="ml-7 mt-1 inline-flex items-center gap-1 px-1 py-1.5 text-[13px] font-semibold text-neutral-400 hover:text-neutral-600"><Plus size={13} /> строка</button>
        <p className="ml-7 mt-3 text-[12px] text-neutral-400">«/» в ячейке — выбрать тип (чекбокс, статус, дата…). Enter — вниз, Shift+Enter — перенос строки, Tab — вправо. Cmd+V — вставка таблицы из Excel или Google Таблиц. Сохраняется автоматически.</p>
      </div>
      {pop && (
        <>
          {pop.kind !== "slash" && <div className="fixed inset-0 z-[1]" onClick={() => setPop(null)} />}
          <div className="fixed z-[2] w-[220px] rounded-[10px] border border-neutral-200 bg-white p-1 shadow-2xl" style={{ left: pop.x, top: pop.y }} onMouseDown={(e) => e.preventDefault()}>
            {(pop.kind === "slash" || pop.kind === "type") && (popItems.length === 0
              ? <div className="px-2 py-1.5 text-[12.5px] text-neutral-400">Ничего не найдено</div>
              : popItems.map((k, i) => (
                <button key={k.k} type="button" onClick={() => pickKind(pop.rid, pop.cid, k.k, pop)} className={"flex h-7 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] font-semibold text-neutral-800 " + (pop.kind === "slash" && i === pop.sel % popItems.length ? "bg-violet-50" : "hover:bg-neutral-50")}>
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-neutral-100 text-[11px] font-bold text-neutral-500">{k.ic}</span>{k.label}
                </button>
              )))}
            {pop.kind === "status" && (
              <>
                {TT_STATUSES.map((s) => <button key={s.id} type="button" onClick={() => { setCell(pop.rid, pop.cid, { k: "status", v: s.id }); setPop(null); }} className="flex h-7 w-full items-center rounded-[7px] px-2 hover:bg-neutral-50"><span className="rounded-md px-2 py-[2px] text-[12.5px] font-bold" style={{ background: s.bg, color: s.fg }}>{s.label}</span></button>)}
                <button type="button" onClick={() => { setCell(pop.rid, pop.cid, { k: "status", v: null }); setPop(null); }} className="h-7 w-full rounded-[7px] px-2 text-left text-[12.5px] text-neutral-400 hover:bg-neutral-50">Очистить</button>
              </>
            )}
            {pop.kind === "user" && (
              <>
                {people.map((p) => <button key={p.id} type="button" onClick={() => { setCell(pop.rid, pop.cid, { k: "user", v: p.id }); setPop(null); }} className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] font-semibold text-neutral-800 hover:bg-neutral-50"><PersonAvatar p={p} size={20} />{profileLabel(p)}</button>)}
                {people.length === 0 && <div className="px-2 py-1.5 text-[12.5px] text-neutral-400">Нет профилей</div>}
                <button type="button" onClick={() => { setCell(pop.rid, pop.cid, { k: "user", v: null }); setPop(null); }} className="h-7 w-full rounded-[7px] px-2 text-left text-[12.5px] text-neutral-400 hover:bg-neutral-50">Очистить</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const TASK_SIZES_MEM = {}; // размер окна запоминается отдельно для каждой задачи (в большом виде открывается только та, что была в нём)
const taskSizeGet = (id) => { if (!id) return 0; const m = TASK_SIZES_MEM[id]; if (m === 1 || m === 2) return m; const o = lsGet("rnp.taskSizes", {}); const v = o && o[id]; return v === 1 || v === 2 ? v : 0; };
const taskSizeSet = (id, v) => { if (!id) return; TASK_SIZES_MEM[id] = v; const o = { ...(lsGet("rnp.taskSizes", {}) || {}) }; if (v) o[id] = v; else delete o[id]; const k = Object.keys(o); if (k.length > 300) k.slice(0, k.length - 300).forEach((x) => delete o[x]); lsSet("rnp.taskSizes", o); };
const WS_BLOCKS = [["agents", "ИИ-агенты"], ["duties", "Функционал"], ["strategy", "Карты"]]; // блоки сервиса, доступные в «Рабочей среде» задачи
function JobEditor({ job, maps = [], onOpenWork, onCreateMap, liveLog = [], taskLabels, taskTags = [], people = [], products, opTypes, batches = [], onChange, onDelete, onDuplicate, onOpenProduct, onClose }) {
  const [j, setJ] = useState(job);
  const [size, setSize] = useState(() => taskSizeGet(job && job.id)); // размер окна задачи: 0 обычный · 1 широкий · 2 на весь экран
  const expanded = size >= 1, big = size === 2;
  const [showLog, setShowLog] = useState(false); // показывать «Историю» вместо деталей
  useEffect(() => { taskSizeSet(j.id, size); }, [size]); // eslint-disable-line react-hooks/exhaustive-deps
  const checkRefs = useRef({});          // ref на поля подзадач — для фокуса новой
  const [focusCheckId, setFocusCheckId] = useState(null);
  const [subDoneOpen, setSubDoneOpen] = useState(false); // раскрыт ли список выполненных подзадач
  const noteRef = useRef(null);
  const [tblOpen, setTblOpen] = useState(null); // id открытой таблицы-материала
  const [wsMenu, setWsMenu] = useState(false); // меню «+ Добавить» в рабочей среде
  const [wsPick, setWsPick] = useState(null); // null | "map" | "block"
  // авто-высота полей считается ТОЛЬКО при изменении контента/раскрытия,
  // а не на каждом ре-рендере — иначе layout дёргается и скролл прыгает наверх
  const sizeNote = () => { const el = noteRef.current; if (!el) return; el.style.height = "auto"; const lh = parseFloat(getComputedStyle(el).lineHeight) || 20; const max = lh * 12; el.style.height = Math.min(Math.max(el.scrollHeight, lh + 18), max) + "px"; el.style.overflowY = el.scrollHeight > max + 1 ? "auto" : "hidden"; };
  const sizeCheck = (el) => { if (!el) return; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
  const set = (k, v) => setJ((o) => ({ ...o, [k]: v }));
  const curType = j.type === "op" ? "op" : jobType(j);
  const setType = (t) => setJ((o) => {
    const n = { ...o, type: t };
    if (t === "op") n.recur = normRecur(o.recur);
    if (t !== "product") n.productId = null;
    if (t === "op" || t === "product") n.batchId = null;
    return n;
  });
  useEffect(() => { onChange(j); }, [j]); // автосохранение при любом изменении
  // после добавления подзадачи — фокус на новое поле (без «прыжка» наверх)
  useEffect(() => {
    if (!focusCheckId) return;
    const el = checkRefs.current[focusCheckId];
    if (el) { el.focus(); el.scrollIntoView({ block: "nearest" }); }
    setFocusCheckId(null);
  }, [focusCheckId, (j.checklist || []).length]);
  // пересчёт высоты заметки и подзадач по изменению их текста / раскрытия окна
  useLayoutEffect(() => { sizeNote(); const tm = setTimeout(sizeNote, 60); return () => clearTimeout(tm); }, [j.note, size]);
  useLayoutEffect(() => { Object.values(checkRefs.current).forEach(sizeCheck); }, [j.checklist, size, subDoneOpen]);
  const jtags = Array.isArray(j.tags) ? j.tags : [];
  const toggleTag = (id) => set("tags", jtags.includes(id) ? jtags.filter((x) => x !== id) : [...jtags, id]);
  const checklist = Array.isArray(j.checklist) ? j.checklist : [];
  const tables = Array.isArray(j.tables) ? j.tables : [];
  const openTable = tables.find((x) => x.id === tblOpen) || null;
  const fieldL = "text-[11px] font-bold uppercase tracking-wide text-neutral-400";
  const addTable = () => { const nt = ttNewTable(); set("tables", [...tables, nt]); setTblOpen(nt.id); };
  const work = Array.isArray(j.work) ? j.work : [];
  const addWork = (it) => { set("work", [...work, { id: uid(), ...it }]); setWsMenu(false); setWsPick(null); };
  const delWork = (id) => set("work", work.filter((x) => x.id !== id));
  const wsItem = "block w-full rounded-lg px-3 py-2 text-left text-[13px] font-bold text-neutral-700 hover:bg-violet-50";
  const addMenu = (
    <div className="relative">
      <button onClick={() => { setWsMenu((v) => !v); setWsPick(null); }} className="inline-flex h-7 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 text-[12px] font-bold text-neutral-600 hover:bg-neutral-50"><Plus size={12} /> Добавить <ChevronDown size={12} /></button>
      {wsMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setWsMenu(false); setWsPick(null); }} />
          <div className="absolute right-0 top-9 z-[61] max-h-80 w-72 overflow-auto rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl">
            {!wsPick && (
              <>
                <button onClick={() => { addTable(); setWsMenu(false); }} className={wsItem}>▦ Таблицу<span className="block text-[11.5px] font-medium text-neutral-400">строки и столбцы внутри задачи</span></button>
                <button onClick={() => setWsPick("map")} className={wsItem}>◇ Карту<span className="block text-[11.5px] font-medium text-neutral-400">новую или из раздела «Карты»</span></button>
                <button onClick={() => setWsPick("block")} className={wsItem}>⧉ Блок сервиса<span className="block text-[11.5px] font-medium text-neutral-400">откроется окном прямо из задачи</span></button>
              </>
            )}
            {wsPick === "map" && (
              <>
                <button onClick={() => setWsPick(null)} className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400 hover:text-neutral-600">← Карта</button>
                {maps.map((m) => <button key={m.id} onClick={() => addWork({ kind: "map", ref: m.id, title: m.name || "Карта" })} className={wsItem}>◇ {m.name || "Карта"}</button>)}
                <button onClick={() => { const nm = "Карта: " + ((j.title || "Задача").slice(0, 60)); const id = onCreateMap ? onCreateMap(nm) : null; if (id) addWork({ kind: "map", ref: id, title: nm }); }} className={wsItem + " text-violet-700"}>+ Новая карта для задачи</button>
              </>
            )}
            {wsPick === "block" && (
              <>
                <button onClick={() => setWsPick(null)} className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400 hover:text-neutral-600">← Блок сервиса</button>
                {WS_BLOCKS.map(([id, nm]) => <button key={id} onClick={() => addWork({ kind: "block", ref: id, title: nm })} className={wsItem}>⧉ {nm}</button>)}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
  const workChips = work.length > 0 ? (
    <div className="mb-3">
      <div className={fieldL + " mb-1.5"}>Быстрый доступ</div>
      <div className="flex flex-wrap gap-2">
        {work.map((w) => (
          <span key={w.id} className="group inline-flex items-center overflow-hidden rounded-xl border border-neutral-200 bg-white text-[13px] font-bold text-neutral-700">
            <button onClick={() => onOpenWork && onOpenWork(w)} className="inline-flex items-center gap-1.5 px-3 py-2 hover:bg-violet-50">{w.kind === "map" ? "◇" : "⧉"} {w.title}<span className="text-violet-500">⤢</span></button>
            <button onClick={() => delWork(w.id)} title="Убрать из задачи" className="px-2 py-2 text-neutral-300 hover:bg-red-50 hover:text-red-500">×</button>
          </span>
        ))}
      </div>
    </div>
  ) : null;
  const matBlock = big ? (
    <div>
              <div className="mb-3 flex items-center gap-2">
                <div className={fieldL + " flex-1"}>Рабочая среда</div>
                {addMenu}
              </div>
              {workChips}
              {tables.length === 0 && <button onClick={addTable} className="w-full rounded-[14px] border-[1.5px] border-dashed border-neutral-200 py-8 text-[13px] font-semibold text-neutral-400 hover:border-violet-300 hover:text-violet-600">＋ Добавить таблицу</button>}
              <div className="flex flex-col gap-4">
                {tables.map((tb) => (
                  <div key={tb.id} className="overflow-hidden rounded-[14px] border border-neutral-200 bg-white">
                    <button onClick={() => setTblOpen(tb.id)} className="flex w-full items-center gap-2 border-b border-neutral-100 px-3.5 py-2.5 text-left hover:bg-neutral-50"><span className="min-w-0 flex-1 truncate text-[14px] font-extrabold text-neutral-800">▦ {tb.title || "Таблица"}</span><span className="text-[12px] font-bold text-violet-600">развернуть ⤢</span></button>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[13px]">
                        <thead><tr>{tb.cols.map((c) => <th key={c.id} className="border border-neutral-100 bg-neutral-50 px-3 py-2 text-left text-[11.5px] font-extrabold uppercase tracking-wide text-neutral-500">{c.name}</th>)}</tr></thead>
                        <tbody>{tb.rows.map((r) => <tr key={r.id}>{tb.cols.map((c) => { const cl = r.cells[c.id]; const st = cl && cl.k === "status" ? TT_STATUSES.find((x) => x.id === cl.v) : null; return <td key={c.id} onClick={() => setTblOpen(tb.id)} className="h-[34px] cursor-pointer border border-neutral-100 px-3 text-neutral-700">{st ? <span className="rounded-md px-2 py-[2px] text-[12px] font-bold" style={{ background: st.bg, color: st.fg }}>{st.label}</span> : cl && cl.k === "check" ? <span className={"inline-flex h-4 w-4 items-center justify-center rounded-[5px] border-[1.5px] align-middle " + (cl.v ? "border-green-500 bg-green-500 text-white" : "border-neutral-300")}>{cl.v && <Check size={11} strokeWidth={3} />}</span> : ttCellText(cl, people)}</td>; })}</tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
  ) : (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <div className={fieldL + " flex-1"}>Рабочая среда</div>
                {addMenu}
              </div>
              {workChips}
              {tables.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {tables.map((tb) => (
                    <button key={tb.id} onClick={() => setTblOpen(tb.id)} className="flex min-w-0 flex-col rounded-[14px] border border-neutral-200 bg-white p-3 text-left transition hover:border-violet-300 hover:shadow-sm">
                      <div className="mb-2 flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[14px] font-extrabold text-neutral-800">▦ {tb.title || "Таблица"}</span><span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold text-neutral-500">таблица</span></div>
                      <table className="w-full table-fixed border-collapse text-[11.5px]">
                        <thead><tr>{tb.cols.slice(0, 3).map((c) => <th key={c.id} className="truncate border border-neutral-100 bg-neutral-50 px-1.5 py-1 text-left font-bold text-neutral-500">{c.name}</th>)}</tr></thead>
                        <tbody>{tb.rows.slice(0, 3).map((r) => <tr key={r.id}>{tb.cols.slice(0, 3).map((c) => <td key={c.id} className="h-[24px] truncate border border-neutral-100 px-1.5 text-neutral-700">{ttCellText(r.cells[c.id], people)}</td>)}</tr>)}</tbody>
                      </table>
                      <div className="mt-2 flex items-center justify-between text-[11.5px] text-neutral-400"><span>{tb.rows.length} стр. × {tb.cols.length} стлб.</span><span className="font-bold text-violet-600">Открыть →</span></div>
                    </button>
                  ))}
                </div>
              )}
            </div>
  );
  const setCl = (cl) => set("checklist", cl);
  const addCheck = () => { const id = uid(); setCl([...checklist, { id, text: "", done: false }]); setFocusCheckId(id); };
  const toggleCheck = (id) => setCl(checklist.map((c) => (c.id === id ? { ...c, done: !c.done } : c)));
  const setCheckText = (id, text) => setCl(checklist.map((c) => (c.id === id ? { ...c, text } : c)));
  const removeCheck = (id) => setCl(checklist.filter((c) => c.id !== id));
  const cdone = checklist.filter((c) => c.done).length;
  const renderSubRow = (c) => (
    <div key={c.id} className="group flex items-start gap-2.5 py-1">
      <button onClick={() => toggleCheck(c.id)} className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border" style={{ background: c.done ? "#16a34a" : "#fff", borderColor: c.done ? "#16a34a" : "#d4d4d8", color: "#fff" }}>{c.done && <Check size={10} strokeWidth={3} />}</button>
      <textarea value={c.text} rows={1}
        ref={(el) => { checkRefs.current[c.id] = el; }}
        onChange={(e) => setCheckText(c.id, e.target.value)}
        onInput={(e) => sizeCheck(e.target)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addCheck(); } }}
        placeholder="Подзадача…"
        className="min-w-0 flex-1 resize-none break-words border-none bg-transparent text-sm leading-snug text-neutral-700 focus:outline-none"
        style={c.done ? { textDecoration: "line-through", color: "#a3a3a3" } : undefined} />
      <button onClick={() => removeCheck(c.id)} className="mt-0.5 shrink-0 text-neutral-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"><X size={13} /></button>
    </div>
  );
  // вложения (картинки сжимаются до превью, прочие файлы — data URL; лимит 10 МБ)
  const files = Array.isArray(j.files) ? j.files : [];
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileMsg, setFileMsg] = useState("");
  const MAX_FILE = 10 * 1024 * 1024;
  const addFiles = async (fileList) => {
    const arr = [...(fileList || [])];
    const added = []; let skipped = 0;
    for (const f of arr) {
      if (f.size > MAX_FILE) { skipped++; continue; }
      const isImg = /^image\//.test(f.type);
      try {
        const dataUrl = isImg ? await fileToThumb(f, 1600) : await fileToDataURL(f);
        added.push({ id: uid(), name: f.name, type: f.type || "", size: f.size, isImage: isImg, dataUrl });
      } catch {}
    }
    if (added.length) set("files", [...files, ...added]);
    setFileMsg(skipped ? `Пропущено ${skipped} файл(а) больше 10 МБ` : "");
  };
  const removeFile = (id) => set("files", files.filter((x) => x.id !== id));
  const openFile = (f) => {
    try {
      if (f.isImage) { const w = window.open(); if (w) w.document.write(`<img src="${f.dataUrl}" style="max-width:100%">`); }
      else { const a = document.createElement("a"); a.href = f.dataUrl; a.download = f.name || "file"; a.click(); }
    } catch {}
  };
  const datesOn = !!(j.start || j.date);

  // ---- История задачи (логи) ----
  const STAGE_LBL = { wait: "Ожидает", progress: "В процессе", done: "Готово" };
  const authorName = (by) => { if (by == null) return "Вы"; if (by === "system") return "Триггер"; if (typeof by === "string" && by.includes("@")) return by; return ((people || []).find((p) => p.id === by) || {}).name || "Вы"; };
  const LOG_ICON = { created: [Plus, "#6366f1"], done: [Check, "#16a34a"], reopen: [Repeat, "#0ea5e9"], status: [Repeat, "#0ea5e9"], prio: [Flag, "#f59e0b"], assignee: [Users, "#8b5cf6"], date: [CalendarIcon, "#14b8a6"], sub_done: [ListChecks, "#64748b"], sub_del: [X, "#ef4444"] };
  const fmtD = (d) => d ? `${String(d).slice(8, 10)}.${String(d).slice(5, 7)}.${String(d).slice(2, 4)}` : "—";
  const logText = (e) => {
    switch (e.kind) {
      case "created": return <b>Создана</b>;
      case "done": return <b>Выполнена</b>;
      case "reopen": return <>Снова открыта <span className="rounded bg-sky-50 px-1.5 text-[11px] font-semibold text-sky-700">{STAGE_LBL[e.to] || e.to}</span></>;
      case "status": return <>Статус: <span className="rounded bg-neutral-100 px-1.5 text-[11px] font-semibold text-neutral-400 line-through">{STAGE_LBL[e.from] || e.from}</span> <ArrowRight size={11} className="inline text-neutral-300" /> <span className="rounded bg-sky-50 px-1.5 text-[11px] font-semibold text-sky-700">{STAGE_LBL[e.to] || e.to}</span></>;
      case "prio": return <>Приоритет: <span className="rounded px-1.5 text-[11px] font-semibold" style={{ background: (PRIORITIES[e.to] || {}).bg || "#f1f1f4", color: (PRIORITIES[e.to] || {}).color || "#555" }}>{(PRIORITIES[e.to] || {}).label || "—"}</span></>;
      case "assignee": { const n = e.to ? (((people || []).find((p) => p.id === e.to) || {}).name || "—") : null; return n ? <>Исполнитель: <b>{n}</b></> : <>Исполнитель снят</>; }
      case "date": return e.to ? <>Дедлайн: <b>{fmtD(e.to)}</b></> : <>Дедлайн снят</>;
      case "sub_done": return <>Подзадача <b>«{e.text}»</b> отмечена</>;
      case "sub_del": return <>Подзадача <b>«{e.text}»</b> удалена</>;
      default: return e.kind;
    }
  };
  const renderLog = () => {
    let items = (liveLog || []).slice().reverse();
    // у старых задач (и созданных автоматически до появления логов) записи нет — показываем «Создана» по дате создания
    if (!items.length && j.createdAt) { const cd = new Date(j.createdAt); if (!isNaN(cd)) items = [{ id: "created-fallback", ts: cd.toISOString(), kind: "created", by: (j.trgId || /^(Триггер|Партия)/.test(String(j.note || ""))) ? "system" : null }]; }
    const groups = [];
    items.forEach((e) => { const d = new Date(e.ts); const key = isoYMD(d); let g = groups.find((x) => x.key === key); if (!g) { g = { key, d, list: [] }; groups.push(g); } g.list.push(e); });
    const today = isoYMD(new Date()), yd = isoYMD(new Date(Date.now() - 864e5));
    const dayLabel = (key, d) => key === today ? "Сегодня" : key === yd ? "Вчера" : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    return (
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mb-1 text-lg font-bold leading-snug text-neutral-900">{stripProdSuffix(j.title, ((products || []).find((p) => p.id === j.productId) || {}).name) || "Без названия"}</div>
        <div className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-400"><History size={12} /> История</div>
        {!items.length ? (
          <div className="py-10 text-center text-sm text-neutral-400">Событий пока нет</div>
        ) : groups.map((g) => (
          <div key={g.key}>
            <div className="mb-2 mt-3 text-[10px] font-bold uppercase tracking-wide text-neutral-400">{dayLabel(g.key, g.d)}</div>
            {g.list.map((e, i) => { const [Ic, clr] = LOG_ICON[e.kind] || [Flag, "#9ca3af"]; const last = i === g.list.length - 1; return (
              <div key={e.id || i} className="relative flex gap-3 pb-3">
                {!last && <span className="absolute bottom-0 left-[11px] top-6 w-px bg-neutral-200" />}
                <span className="relative z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-white" style={{ background: clr }}><Ic size={12} strokeWidth={2.5} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] leading-snug text-neutral-700">{logText(e)}</div>
                  <div className="mt-0.5 text-[11px] text-neutral-400">{new Date(e.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · {authorName(e.by)}</div>
                </div>
              </div>
            ); })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      {openTable && <TaskTableEditor table={openTable} people={people} onChange={(nt) => set("tables", tables.map((x) => (x.id === nt.id ? nt : x)))} onClose={() => setTblOpen(null)} onDelete={() => { set("tables", tables.filter((x) => x.id !== openTable.id)); setTblOpen(null); }} />}
      <div className={"flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl " + (big ? "h-full max-h-full max-w-none" : expanded ? "max-w-5xl max-h-[94vh]" : "max-w-2xl max-h-[88vh]")} onClick={(e) => e.stopPropagation()}>
        {/* Шапка: компактный переключатель типа + создано + действия */}
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3.5 py-2.5">
          {/* тип выбирается только при создании; у созданной задачи — справочный бейдж без смены */}
          {!job._new ? (() => { const m = TASK_TYPE_META.find((x) => x.key === curType) || TASK_TYPE_META[0]; const MI = m.Icon; return (
            <span title="Тип задачи (после создания не меняется)" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: m.bg, color: m.tint }}><MI size={13} />{m.label}</span>
          ); })() : (
          <div className="inline-flex rounded-xl bg-neutral-100 p-0.5">
            {TASK_TYPE_META.map(({ key, label, short, Icon, tint, bg }) => { const on = curType === key; return (
              <button key={key} onClick={() => setType(key)} title={label}
                className={"inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition " + (on ? "shadow-sm" : "text-neutral-500 hover:text-neutral-700")}
                style={on ? { background: bg, color: tint } : undefined}>
                <Icon size={13} />{short}
              </button>
            ); })}
          </div>
          )}
          <span className="ml-auto flex items-center gap-1">
            {curType !== "op" && <>
              <button onClick={() => setShowLog((v) => !v)} title={showLog ? "К деталям" : "История"} className={"rounded-md p-1 transition " + (showLog ? "bg-sky-50 text-sky-600" : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700")}><History size={17} /></button>
              <span className="mx-0.5 h-4 w-px self-center bg-neutral-200" />
            </>}
            <button onClick={() => setSize((v) => (v + 1) % 3)} title={big ? "Обычный размер" : size === 1 ? "На весь экран" : "Шире"} className="rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700">{big ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
            {!job._new && <button onClick={() => onDelete(j.id)} title="Удалить задачу" className="rounded-md p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"><Trash2 size={18} /></button>}
            <button onClick={onClose} title="Закрыть" className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
          </span>
        </div>

        {showLog ? renderLog() : curType === "op" ? (
          /* ОПЕРАЦИОННАЯ: название · повтор/дни недели · исполнитель */
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
            <textarea value={j.title} rows={1} onChange={(e) => set("title", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} placeholder="Название операционной задачи…" autoFocus
              className="w-full resize-none break-words border-none bg-transparent text-lg font-bold leading-snug text-neutral-900 placeholder:text-neutral-300 focus:outline-none" />
            <RecurEditor recur={normRecur(j.recur)} onChange={(r) => set("recur", r)} />
            <div className="flex flex-col gap-1.5">
              <span className={fieldL}>Исполнитель</span>
              <AssigneePicker people={people || []} max={1} value={jobAssignees(j)} onChange={(arr) => setJ((o) => ({ ...o, assignees: arr, assignee: arr[0] || null }))} />
              {(people || []).length === 0 && <span className="text-[11px] text-neutral-400">Профили появляются после входа пользователей.</span>}
            </div>
          </div>
        ) : (
        <div className={"grid flex-1 grid-cols-1 overflow-y-auto " + (big ? "sm:grid-cols-[442px_1fr_300px]" : "sm:grid-cols-[1fr_300px]")}>
          {/* ЛЕВО: название · заметка · подзадачи */}
          <div className="flex flex-col gap-5 border-b border-neutral-100 p-5 sm:border-b-0 sm:border-r">
            <textarea value={j.title} rows={1} onChange={(e) => set("title", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} placeholder="Название задачи…" autoFocus
              ref={(el) => { if (el) { el.style.height = "auto"; const lh = parseFloat(getComputedStyle(el).lineHeight) || 24; const max = lh * 3; el.style.height = Math.min(el.scrollHeight, max) + "px"; el.style.overflowY = el.scrollHeight > max + 1 ? "auto" : "hidden"; } }}
              onInput={(e) => { const el = e.target; el.style.height = "auto"; const lh = parseFloat(getComputedStyle(el).lineHeight) || 24; const max = lh * 3; el.style.height = Math.min(el.scrollHeight, max) + "px"; el.style.overflowY = el.scrollHeight > max + 1 ? "auto" : "hidden"; }}
              className="w-full resize-none break-words border-none bg-transparent text-lg font-bold leading-snug text-neutral-900 placeholder:text-neutral-300 focus:outline-none" />
            <div>
              <div className={fieldL + " mb-1.5"}>Заметка</div>
              <textarea value={j.note || ""} onChange={(e) => set("note", e.target.value)} placeholder="Добавьте описание, контекст, ссылки…" rows={1}
                ref={noteRef} onInput={sizeNote}
                className="w-full resize-none rounded-xl border border-neutral-200 px-3 py-2 text-sm leading-relaxed text-neutral-700 placeholder:text-neutral-300 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2"><div className={fieldL}>Подзадачи</div>{checklist.length > 0 && <span className={"rounded-full px-2 py-0.5 text-[12px] font-extrabold " + (cdone === checklist.length ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500")}>{cdone}/{checklist.length}</span>}<span className="flex-1" /><button onClick={addCheck} className="inline-flex h-7 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 text-[12px] font-bold text-neutral-600 hover:bg-neutral-50"><Plus size={12} /> Подзадача</button></div>
              <div className="flex flex-col">
                {checklist.filter((c) => !c.done).map((c) => renderSubRow(c))}
              </div>
              {checklist.some((c) => c.done) && (() => { const doneSubs = checklist.filter((c) => c.done); return (
                <div className="mt-3 border-t border-neutral-100 pt-2">
                  <button onClick={() => setSubDoneOpen((v) => !v)} className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400 transition hover:text-neutral-600">
                    <ChevronRight size={13} className={"transition " + (subDoneOpen ? "rotate-90" : "")} /> Выполненные <span className="rounded-full bg-neutral-100 px-1.5 text-[11px] font-bold text-neutral-500">{doneSubs.length}</span>
                  </button>
                  {subDoneOpen && <div className="mt-1 flex flex-col">{doneSubs.map((c) => renderSubRow(c))}</div>}
                </div>
              ); })()}
            </div>

            {!big && matBlock}

            {/* Вложения */}
            <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}>
              <div className="mb-2 flex items-center gap-2"><div className={fieldL + " flex-1"}>Вложения</div><button onClick={() => fileInputRef.current?.click()} className="inline-flex h-7 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 text-[12px] font-bold text-neutral-600 hover:bg-neutral-50"><Plus size={12} /> Файл</button></div>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              <div className="flex flex-wrap items-center gap-2.5">
                {files.map((f) => (f.isImage ? (
                  <div key={f.id} className="group relative h-[84px] w-[84px] overflow-hidden rounded-xl border border-neutral-200">
                    <button onClick={() => openFile(f)} className="h-full w-full bg-neutral-100 bg-cover bg-center" style={{ backgroundImage: `url(${f.dataUrl})` }} title="Открыть" />
                    <button onClick={() => removeFile(f.id)} className="absolute right-1 top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75" title="Удалить"><X size={11} /></button>
                  </div>
                ) : (
                  <div key={f.id} className="group relative flex w-[180px] items-center gap-2.5 rounded-xl border border-neutral-200 px-2.5 py-2">
                    <button onClick={() => openFile(f)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" title="Скачать">
                      <span className="flex h-10 w-[34px] shrink-0 items-center justify-center rounded-md text-[9px] font-extrabold text-white" style={{ background: FILE_BADGE_COLORS[fileExt(f.name)] || "#737373" }}>{fileExt(f.name)}</span>
                      <span className="min-w-0"><span className="block truncate text-[12.5px] font-semibold text-neutral-700">{f.name}</span><span className="block text-[11px] text-neutral-400">{humanSize(f.size)}</span></span>
                    </button>
                    <button onClick={() => removeFile(f.id)} className="shrink-0 text-neutral-300 hover:text-red-500" title="Удалить"><X size={14} /></button>
                  </div>
                )))}
                {files.length === 0 && <span className="text-[12px] text-neutral-300">Перетащите файлы сюда · до 10 МБ</span>}
              </div>
              {(dragOver || fileMsg) && (
                <div className={"mt-2 rounded-xl border-[1.5px] border-dashed px-3 py-2 text-center text-[12px] transition " + (fileMsg ? "border-amber-200 text-amber-600" : "border-cyan-400 bg-cyan-50/50 text-cyan-700")}>
                  {fileMsg || "Отпустите файлы, чтобы прикрепить"}
                </div>
              )}
            </div>
          </div>

          {big && <div className="flex flex-col gap-5 border-b border-neutral-100 bg-neutral-50/50 p-5 sm:border-b-0 sm:border-r">{matBlock}</div>}
          {/* ПРАВО: настройки */}
          <div className="flex flex-col gap-4 bg-neutral-50/50 p-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-600">Даты</span>
                <button onClick={() => { if (datesOn) setJ((o) => ({ ...o, start: null, date: null })); else set("start", isoYMD(new Date())); }} title={datesOn ? "Убрать даты" : "Задать даты"} className="relative h-[22px] w-[38px] shrink-0 rounded-full transition" style={{ background: datesOn ? "#171717" : "#d4d4d8" }}>
                  <span className="absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all" style={{ left: datesOn ? 18 : 2 }} />
                </button>
              </div>
              {datesOn ? (
                <>
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm text-neutral-600">Начало</span>
                    <input type="date" value={j.start || ""} onChange={(e) => set("start", e.target.value || null)} max={j.date || undefined} className="rounded-lg border border-neutral-200 px-2 py-1 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none" />
                  </label>
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm text-neutral-600">Дедлайн</span>
                    <input type="date" value={j.date || ""} onChange={(e) => set("date", e.target.value || null)} className="rounded-lg border border-neutral-200 px-2 py-1 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none" />
                  </label>
                </>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-neutral-600">Статус</span>
              <div className="inline-flex rounded-lg bg-neutral-100 p-0.5">
                {STAGE_ORDER.map((k) => { const on = stageOf(j) === k; return (
                  <button key={k} onClick={() => setJ((o) => applyStage(o, k))} className={"flex-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-semibold " + (on ? "shadow-sm" : "")} style={on ? { background: STAGES[k].bg, color: STAGES[k].color } : { color: "#a3a3a3" }}>{STAGES[k].label}</button>
                ); })}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-neutral-600">Приоритет</span>
              <div className="inline-flex rounded-lg bg-neutral-100 p-0.5">
                {Object.keys(PRIORITIES).map((k) => (
                  <button key={k} onClick={() => set("priority", k)} className={"flex-1 rounded-md px-2 py-1 text-xs font-semibold " + (j.priority === k ? "shadow-sm" : "")} style={j.priority === k ? { background: PRIORITIES[k].bg, color: PRIORITIES[k].color } : { color: "#a3a3a3" }}>{PRIORITIES[k].label}</button>
                ))}
              </div>
            </div>
            {curType === "project" && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-neutral-600">Метка</span>
                <div className="inline-flex w-full rounded-lg bg-neutral-100 p-0.5">
                  {JOB_MARKS.map(([id, ic]) => (
                    <button key={id} onClick={() => set("mark", j.mark === id ? null : id)} className={"flex flex-1 items-center justify-center rounded-md px-2 py-1.5 text-[17px] leading-none transition " + (j.mark === id ? "bg-white shadow-sm" : "")}>{ic}</button>
                  ))}
                  <button onClick={() => set("mark", null)} className={"flex flex-1 items-center justify-center rounded-md px-2 py-1.5 text-xs font-bold transition " + (!j.mark ? "bg-white text-neutral-700 shadow-sm" : "text-neutral-400")}>нет</button>
                </div>
              </div>
            )}
            {curType === "product" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-neutral-600">Товар</span>
                  <button
                    type="button"
                    disabled={!j.productId}
                    onClick={() => j.productId && onOpenProduct && onOpenProduct(j.productId)}
                    title={j.productId ? "Открыть карточку товара" : "Сначала выберите товар"}
                    className={"inline-flex h-5 w-5 items-center justify-center rounded-md border transition " + (j.productId ? "border-neutral-200 text-neutral-500 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-600" : "cursor-not-allowed border-neutral-100 text-neutral-300")}
                  ><Maximize2 size={12} /></button>
                </div>
                <select value={j.productId || ""} onChange={(e) => set("productId", e.target.value || null)} className="w-full rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none">
                  <option value="">—</option>
                  {(products || []).map((p) => (<option key={p.id} value={p.id}>{(p.code || "—") + (p.name ? " · " + p.name : "")}</option>))}
                </select>
              </div>
            )}
            
            <div className="border-t border-neutral-200/70" />
            <div className="flex flex-col gap-1.5">
              <span className={fieldL}>Исполнители</span>
              <AssigneePicker people={people || []} max={2} value={jobAssignees(j)} onChange={(arr) => setJ((o) => ({ ...o, assignees: arr, assignee: arr[0] || null }))} />
              {(people || []).length === 0 && <span className="text-[11px] text-neutral-400">Профили появляются после входа пользователей.</span>}
            </div>
          </div>
        </div>
        )}

      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Блок «Стратегия» — свободный холст: блоки + стрелки (вручную), ветвления
---------------------------------------------------------------------------- */
// Типы блоков стратегии
const STRAT_TYPES = {
  stage: { label: "Этап", icon: Flag },
  goal: { label: "Цель", icon: Target },
  risk: { label: "Риск", icon: AlertTriangle },
  decision: { label: "Решение", icon: GitBranch },
};

// Шаблоны карт (как в xMind). Раскладка у каждого своя (см. computeStratLayout).
const STRAT_TPLS = {
  mind:      { label: "Майндкарта",         root: "Главная тема",    hint: "ветви по обе стороны от центра" },
  process:   { label: "Процесс",            root: "Старт",           hint: "поток шагов слева направо" },
  hierarchy: { label: "Иерархия",           root: "Верхний уровень", hint: "сверху вниз, как оргструктура" },
  logic:     { label: "Логическая цепочка", root: "Корень",          hint: "слева направо, ветвями" },
  stages:    { label: "Этапы",              root: "Старт",           hint: "этапы цепочкой, ответвления вниз" },
};
// цвет-маркер шаблона карты (для компактного селектора «Стратегия»)
const STRAT_TPL_COLOR = { mind: "#8b5cf6", process: "#f59e0b", hierarchy: "#0ea5e9", logic: "#10b981", stages: "#f43f5e" };
// непрозрачный «тусклый» оттенок: цвет смешанный с белым (чтобы фон не просвечивал)
const hexTint = (hex, a) => { const h = String(hex || "").replace("#", ""); if (h.length < 6) return "#fff"; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); const m = (c) => Math.round(255 * (1 - a) + c * a); return `rgb(${m(r)}, ${m(g)}, ${m(b)})`; };

function makeStratNode(o = {}) {
  return { id: uid(), title: o.title || "", note: o.note || "", color: o.color || "#2563eb", done: false, hasCheck: o.hasCheck === false ? false : true, type: STRAT_TYPES[o.type] ? o.type : "stage", collapsed: false, image: null, checklist: (o.cl || []).map((t) => ({ id: uid(), text: t, done: false })) };
}
// Новая карта выбранного шаблона — один корневой блок, дальше растим через «+».
function makeTemplatedMap(template, name) {
  const tpl = STRAT_TPLS[template] ? template : "mind";
  const root = makeStratNode({ title: STRAT_TPLS[tpl].root, color: "#a3a3a3", hasCheck: false });
  return { id: uid(), name, template: tpl, rootId: root.id, nodes: [root], edges: [] };
}

// Модель: { __v:2, maps:[{id,name,template,rootId,nodes,edges}], activeId }.
// Старый формат (свободный холст, без __v:2) очищается — начинаем с пустой майндкарты.
function normStrategy(v) {
  const normNode = (n) => ({
    id: n && n.id ? n.id : uid(),
    title: (n && n.title) || "",
    note: (n && n.note) || "",
    color: (n && n.color) || "#2563eb",
    done: !!(n && n.done),
    hasCheck: n && n.hasCheck === false ? false : true,
    type: n && STRAT_TYPES[n.type] ? n.type : "stage",
    collapsed: !!(n && n.collapsed),
    image: (n && typeof n.image === "string") ? n.image : null,
    checklist: n && Array.isArray(n.checklist)
      ? n.checklist.filter((c) => c && typeof c === "object").map((c) => ({ id: c.id || uid(), text: c.text || "", done: !!c.done }))
      : [],
    jobId: (n && typeof n.jobId === "string") ? n.jobId : null,
  });
  const normMap = (m, i) => {
    const template = m && STRAT_TPLS[m.template] ? m.template : "mind";
    const nodes = m && Array.isArray(m.nodes) && m.nodes.length ? m.nodes.map(normNode) : [makeStratNode({ title: STRAT_TPLS[template].root, color: "#6366f1", hasCheck: false })];
    const ids = new Set(nodes.map((n) => n.id));
    const edges = m && Array.isArray(m.edges) ? m.edges.filter((e) => e && ids.has(e.from) && ids.has(e.to)).map((e) => ({ id: e.id || uid(), from: e.from, to: e.to })) : [];
    const rootId = m && m.rootId && ids.has(m.rootId) ? m.rootId : nodes[0].id;
    return { id: m && m.id ? m.id : uid(), name: (m && m.name) || `Карта ${i + 1}`, template, rootId, nodes, edges };
  };
  if (!v || typeof v !== "object" || v.__v !== 2 || !Array.isArray(v.maps)) {
    const m = makeTemplatedMap("mind", "Карта 1");
    return { __v: 2, maps: [m], activeId: m.id };
  }
  let maps = v.maps.filter((m) => m && typeof m === "object").map(normMap);
  if (!maps.length) { const m = makeTemplatedMap("mind", "Карта 1"); maps = [m]; }
  const activeId = maps.some((m) => m.id === v.activeId) ? v.activeId : maps[0].id;
  return { __v: 2, maps, activeId };
}

// ---- Авто-раскладка дерева под выбранный шаблон. Возвращает { id:{x,y} }. ----
// hOf(id) — измеренная высота блока (для вертикальной упаковки). Ширина блоков фиксирована.
function computeStratLayout(nodes, edges, rootId, template, hOf) {
  const SW = 220, HGAP = 72, VGAP = 26, LVL_PAD = 40;
  const byId = {}; nodes.forEach((n) => (byId[n.id] = n));
  const kids = {}; nodes.forEach((n) => (kids[n.id] = []));
  edges.forEach((e) => { if (byId[e.from] && byId[e.to]) kids[e.from].push(e.to); });
  const vis = (id) => (byId[id] && byId[id].collapsed ? [] : (kids[id] || []));
  const hh = (id) => Math.max(40, hOf(id) || 92);
  const pos = {};
  if (!rootId || !byId[rootId]) { nodes.forEach((n, i) => (pos[n.id] = { x: 40, y: 40 + i * 140 })); return pos; }

  if (template === "hierarchy") {
    const ext = {};
    const meas = (id) => { const ch = vis(id); if (!ch.length) { ext[id] = SW; return SW; } let s = 0; ch.forEach((c) => (s += meas(c))); s += HGAP * (ch.length - 1); ext[id] = Math.max(SW, s); return ext[id]; };
    meas(rootId);
    const depth = {}; const setD = (id, d) => { depth[id] = d; vis(id).forEach((c) => setD(c, d + 1)); }; setD(rootId, 0);
    const maxH = {}; Object.keys(depth).forEach((id) => { const d = depth[id]; maxH[d] = Math.max(maxH[d] || 0, hh(id)); });
    const levelY = {}; let acc = 0; Object.keys(maxH).map(Number).sort((a, b) => a - b).forEach((d) => { levelY[d] = acc; acc += maxH[d] + VGAP + LVL_PAD; });
    const place = (id, xStart) => { const ch = vis(id); const cx = xStart + ext[id] / 2; pos[id] = { x: cx - SW / 2, y: levelY[depth[id]] }; const tot = ch.reduce((a, b) => a + ext[b], 0) + HGAP * Math.max(0, ch.length - 1); let c = cx - tot / 2; ch.forEach((k) => { place(k, c); c += ext[k] + HGAP; }); };
    place(rootId, 0);
  } else if (template === "stages") {
    // этапы (корень + дети) — горизонтальной цепочкой; у каждого этапа ответвления вниз (отступ-колонкой)
    const INDENT = 130, DVGAP = 16;
    const extW = (id) => { const ch = vis(id); if (!ch.length) return SW; return Math.max(SW, INDENT + Math.max(...ch.map(extW))); };
    const placeDown = (id, x, yTop) => { pos[id] = { x, y: yTop }; let y = yTop + hh(id) + DVGAP; vis(id).forEach((c) => { placeDown(c, x + INDENT, y); const sh = (function h(nid){ const k = vis(nid); if (!k.length) return hh(nid); return hh(nid) + DVGAP + k.reduce((a,b)=>a+h(b)+DVGAP,0) - DVGAP; })(c); y += sh + DVGAP; }); };
    pos[rootId] = { x: 0, y: 0 };
    let sx = SW + HGAP;
    vis(rootId).forEach((st) => { placeDown(st, sx, 0); sx += extW(st) + HGAP; });
  } else if (template === "logic" || template === "process") {
    const ext = {};
    const meas = (id) => { const ch = vis(id); if (!ch.length) { ext[id] = hh(id); return ext[id]; } let s = 0; ch.forEach((c) => (s += meas(c))); s += VGAP * (ch.length - 1); ext[id] = Math.max(hh(id), s); return ext[id]; };
    meas(rootId);
    const depth = {}; const setD = (id, d) => { depth[id] = d; vis(id).forEach((c) => setD(c, d + 1)); }; setD(rootId, 0);
    const place = (id, yStart) => { const ch = vis(id); const cy = yStart + ext[id] / 2; pos[id] = { x: depth[id] * (SW + HGAP), y: cy - hh(id) / 2 }; const tot = ch.reduce((a, b) => a + ext[b], 0) + VGAP * Math.max(0, ch.length - 1); let c = cy - tot / 2; ch.forEach((k) => { place(k, c); c += ext[k] + VGAP; }); };
    place(rootId, 0);
  } else { // mind — центр, ветви влево/вправо
    const ext = {};
    const meas = (id) => { const ch = vis(id); if (!ch.length) { ext[id] = hh(id); return ext[id]; } let s = 0; ch.forEach((c) => (s += meas(c))); s += VGAP * (ch.length - 1); ext[id] = Math.max(hh(id), s); return ext[id]; };
    const rootKids = vis(rootId); const mid = Math.ceil(rootKids.length / 2);
    const right = rootKids.slice(0, mid), left = rootKids.slice(mid);
    rootKids.forEach(meas);
    pos[rootId] = { x: 0, y: 0 };
    const rootH = hh(rootId);
    const placeSub = (id, xLeft, yStart, dir) => { const ch = vis(id); const cy = yStart + ext[id] / 2; pos[id] = { x: xLeft, y: cy - hh(id) / 2 }; const tot = ch.reduce((a, b) => a + ext[b], 0) + VGAP * Math.max(0, ch.length - 1); let c = cy - tot / 2; ch.forEach((k) => { placeSub(k, xLeft + dir * (SW + HGAP), c, dir); c += ext[k] + VGAP; }); };
    const sideExt = (arr) => arr.reduce((a, b) => a + ext[b], 0) + VGAP * Math.max(0, arr.length - 1);
    let cy = rootH / 2 - sideExt(right) / 2; right.forEach((k) => { placeSub(k, SW + HGAP, cy, +1); cy += ext[k] + VGAP; });
    cy = rootH / 2 - sideExt(left) / 2; left.forEach((k) => { placeSub(k, -(SW + HGAP), cy, -1); cy += ext[k] + VGAP; });
  }
  const vals = Object.values(pos);
  if (vals.length) { const minX = Math.min(...vals.map((p) => p.x)), minY = Math.min(...vals.map((p) => p.y)); vals.forEach((p) => { p.x += -minX + 60; p.y += -minY + 40; }); }
  return pos;
}

// прогресс блока: по подзадачам, иначе по галочке
function nodeIsDone(n) { return (n.checklist && n.checklist.length) ? n.checklist.every((c) => c.done) : !!n.done; }

// Обёртка: список карт-стратегий + переключатель. Новая карта создаётся по выбранному шаблону.
// ---- Вкладка «РНП»: данные РНП из карточек по всем товарам (дни × строки) ----
// ===== Сводка по кабинету WB: структура заказов/выкупов + график по дням =====
const SUM_GO = ["#15803d", "#22c55e", "#4ade80", "#86efac"], SUM_GS = ["#0f766e", "#14b8a6", "#2dd4bf", "#99f6e4"], SUM_GRAY = "#d4d4d4";
function sumPath(vals, x, y) {
  if (!vals.length) return "";
  let d = `M${x(0)},${y(vals[0])}`;
  for (let i = 0; i < vals.length - 1; i++) { const cx = (x(i) + x(i + 1)) / 2; d += ` C${cx},${y(vals[i])} ${cx},${y(vals[i + 1])} ${x(i + 1)},${y(vals[i + 1])}`; }
  return d;
}
function SummaryDonut({ parts, total, label }) {
  const R = 15.9; let off = 0;
  return (
    <div className="relative h-[116px] w-[116px] shrink-0">
      <svg viewBox="0 0 42 42" width="116" height="116" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="21" cy="21" r={R} fill="none" stroke="#f3f3f3" strokeWidth="7" />
        {total > 0 && parts.map((p, i) => { const pc = p.n / total * 100; const el = <circle key={i} cx="21" cy="21" r={R} fill="none" stroke={p.color} strokeWidth="7" strokeDasharray={`${Math.max(pc - 0.8, 0)} ${100 - Math.max(pc - 0.8, 0)}`} strokeDashoffset={-off} />; off += pc; return el; })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><b className="text-xl font-extrabold tabular-nums text-neutral-900">{total.toLocaleString("ru-RU")}</b><span className="text-[10px] text-neutral-500">{label}</span></div>
    </div>
  );
}
const SUM_OZ = ["#1e40af", "#2563eb", "#60a5fa", "#bfdbfe"];
const sumK = (v) => (v / 1000).toFixed(3); // рубли, тысячи через точку, всегда три знака: 167.300
const sumShort = (v) => v >= 1e6 ? (Math.round(v / 1e5) / 10).toLocaleString("ru-RU") + "м" : v >= 1000 ? Math.round(v / 1000) + "к" : String(Math.round(v));
// Универсальный линейный график сводки: series = [{ vals, color, labels }]
function SumLineChart({ days, series, labelEvery = 1, gid = "c", mode = "both" }) {
  const W = 1000, H = 330, padL = 52, padR = 28, padT = 40, padB = 28;
  const mxRaw = Math.max(1, ...series.flatMap((sr) => sr.vals));
  const mag = Math.pow(10, Math.floor(Math.log10(mxRaw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((st) => mxRaw / st <= 5) || mag * 10;
  const mx = Math.ceil(mxRaw * 1.1 / step) * step;
  const x = (i) => padL + (days.length === 1 ? 0 : i * (W - padL - padR) / (days.length - 1));
  const y = (v) => H - padB - (v / mx) * (H - padT - padB);
  const grid = []; for (let v = 0; v <= mx + 1e-9; v += step) grid.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 400 }}>
      <defs>{series.map((sr, k) => <linearGradient key={k} id={`${gid}${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={sr.color} stopOpacity=".2" /><stop offset="1" stopColor={sr.color} stopOpacity="0" /></linearGradient>)}</defs>
      {grid.map((v) => <g key={v}><line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#eee" /><text x={0} y={y(v) + 4} fontSize="11" fill="#a3a3a3">{sumShort(v)}</text></g>)}
      {series.map((sr, k) => <path key={"a" + k} d={`${sumPath(sr.vals, x, y)} L${x(days.length - 1)},${y(0)} L${x(0)},${y(0)}Z`} fill={`url(#${gid}${k})`} />)}
      {series.map((sr, k) => <path key={"l" + k} d={sumPath(sr.vals, x, y)} fill="none" stroke={sr.color} strokeWidth="3" strokeLinecap="round" />)}
      {series.map((sr, k) => sr.vals.map((v, i) => <g key={k + "p" + i}><circle cx={x(i)} cy={y(v)} r="3.5" fill="#fff" stroke={sr.color} strokeWidth="2" />{sr.labels && i % labelEvery === 0 && (sr.sub ? <g fontWeight="700" textAnchor="middle" stroke="#fff" strokeWidth="4" paintOrder="stroke">{mode !== "rub" && <text x={x(i)} y={y(v) - (mode === "both" ? 26 : 12)} fontSize="14" fill={sr.color}>{v}</text>}{mode !== "pcs" && <text x={x(i)} y={y(v) - (mode === "both" ? 12 : 12)} fontSize={mode === "rub" ? 13 : 10.5} fill={mode === "rub" ? sr.color : "#525252"}>{sr.sub[i]}</text>}</g> : <text x={x(i)} y={y(v) - 10} fontSize="12" fontWeight="700" textAnchor="middle" fill={sr.color}>{sumShort(v)}</text>)}</g>))}
      {days.map((d, i) => i % labelEvery === 0 && <text key={d.key} x={x(i)} y={H - 6} fontSize="11" textAnchor="middle" fill="#a3a3a3">{d.n}</text>)}
    </svg>
  );
}
function SummaryTab({ products = [], wbOrders = {}, way = null, wayLoading = false, wayMsg = "", onRefreshWay, oz = null, ozAd = null, ozReady = false, ozLoading = false, ozMsg = "", onRefreshOz }) {
  const [mp, setMp] = useState(() => { const v = lsGet("sum.mp", "wb"); return v === "oz" || v === "all" ? v : "wb"; }); // кабинет: wb | oz | all
  useEffect(() => lsSet("sum.mp", mp), [mp]);
  const [ozSer, setOzSer] = useState("orders");
  const [span, setSpan] = useState(() => lsGet("sum.span", 14));
  const [cut, setCut] = useState(() => lsGet("sum.cut", "product"));
  const [ser, setSer] = useState("both");
  const [lab, setLab] = useState(() => { const v = lsGet("sum.lab", "both"); return v === "pcs" || v === "rub" ? v : "both"; }); // подписи на графике: шт · шт + ₽ · ₽
  useEffect(() => lsSet("sum.lab", lab), [lab]);
  useEffect(() => lsSet("sum.span", span), [span]);
  useEffect(() => lsSet("sum.cut", cut), [cut]);
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const days = useMemo(() => { const out = []; const t = new Date(); t.setHours(0, 0, 0, 0); for (let i = span - 1; i >= 0; i--) { const d = new Date(t); d.setDate(d.getDate() - i); out.push({ key: iso(d), n: d.getDate() }); } return out; }, [span]);
  const data = useMemo(() => {
    const per = products.map((p) => {
      let o = 0, s = 0; const od = [], sd = [], os = [], ss = [];
      let sumAll = 0, nAll = 0; for (const d of days) { sumAll += rnpOrderSum(p, d.key); nAll += rnpOrdN(p, d.key); }
      const avg = nAll > 0 ? sumAll / nAll : 0; // средняя цена до СПП за период — на дни без заказов
      for (const d of days) {
        const a = rnpWbCount({ id: "orders" }, p, d.key, wbOrders) || 0, b = rnpWbCount({ src: "sales" }, p, d.key, wbOrders) || 0;
        const n = rnpOrdN(p, d.key), pr = n > 0 ? rnpOrderSum(p, d.key) / n : avg;
        o += a; s += b; od.push(a); sd.push(b); os.push(rnpOrderSum(p, d.key)); ss.push(b * pr);
      }
      return { p, o, s, od, sd, os, ss };
    });
    const col = (k) => days.map((_, i) => per.reduce((x, r) => x + r[k][i], 0));
    return { per, od: col("od"), sd: col("sd"), os: col("os"), ss: col("ss") };
  }, [products, wbOrders, days]);
  const wayTot = useMemo(() => {
    const t = { to: 0, from: 0, toSum: 0, fromSum: 0, st: 0, stSum: 0, byTo: [], byFrom: [], bySt: [] };
    if (!way || !way.items) return t;
    for (const p of products) {
      const w = way.items[p.code || ""] || way.items[String(p.wb || "")];
      if (!w) continue;
      t.to += w.to; t.from += w.from; t.toSum += w.toSum; t.fromSum += w.fromSum; t.st += w.st || 0; t.stSum += w.stSum || 0;
      const nm = p.name || p.code || p.wb || "Товар";
      if (w.to) t.byTo.push([nm, w.to, w.toSum]);
      if (w.from) t.byFrom.push([nm, w.from, w.fromSum]);
      if (w.st) t.bySt.push([nm, w.st, w.stSum || 0]);
    }
    t.byTo.sort((a, b) => b[2] - a[2]); t.byFrom.sort((a, b) => b[2] - a[2]); t.bySt.sort((a, b) => b[2] - a[2]);
    return t;
  }, [products, way]);
  const fmtMoney = (n) => n >= 1e6 ? (Math.round(n / 1e4) / 100).toLocaleString("ru-RU") + " млн ₽" : Math.round(n).toLocaleString("ru-RU") + " ₽";
  const wayTime = way && way.updatedAt ? new Date(way.updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
  const WayTile = ({ icon, title, qty, sum, color, bg, by }) => (
    <div className="flex flex-1 items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3" title={by.length ? by.slice(0, 8).map(([n, q, sm]) => `${n}: ${q} шт · ${Math.round(sm).toLocaleString("ru-RU")} ₽`).join("\n") : undefined}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: bg }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold text-neutral-500">{title}</div>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-2xl font-extrabold tabular-nums" style={{ color }}>{qty.toLocaleString("ru-RU")} <span className="text-xs font-semibold text-neutral-400">шт</span></span>
          <span className="text-lg font-extrabold tabular-nums text-neutral-800">{fmtMoney(sum)}</span>
        </div>
      </div>
    </div>
  );
  const sumA0 = (a) => a.reduce((x2, y2) => x2 + y2, 0);
  const totO = data.od.reduce((a, b) => a + b, 0), totS = data.sd.reduce((a, b) => a + b, 0);
  const PtLabel = ({ x: lx, y: ly, v, sum, mode, up, color }) => { const both = mode === "both", dy1 = up ? (both ? -26 : -10) : (both ? 22 : 20), dy2 = up ? -12 : 36; return (<g fontWeight="700" textAnchor="middle" stroke="#fff" strokeWidth="4" paintOrder="stroke">{mode !== "rub" && <text x={lx} y={ly + dy1} fontSize={both ? 14 : 12} fill={color}>{v}</text>}{mode !== "pcs" && <text x={lx} y={mode === "rub" ? ly + (up ? -10 : 20) : ly + dy2 + (up ? 0 : -1)} fontSize={mode === "rub" ? 12 : 10.5} fill={mode === "rub" ? color : "#525252"}>{sumK(sum)}</text>}</g>); };
  // структура: топ-4 + «Остальные»
  const group = (key, colors) => {
    const m = new Map();
    for (const r of data.per) { const k = cut === "subject" ? (r.p.subject || "Без предмета") : (r.p.name || r.p.code || r.p.wb || "Без названия"); m.set(k, (m.get(k) || 0) + r[key]); }
    const arr = [...m.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const top = arr.slice(0, 4).map(([name, n], i) => ({ name, n, color: colors[i] }));
    const rest = arr.slice(4).reduce((s, [, n]) => s + n, 0);
    if (rest > 0) top.push({ name: "Остальные", n: rest, color: SUM_GRAY });
    return top;
  };
  const partsO = group("o", SUM_GO), partsS = group("s", SUM_GS);
  // график
  const W = 1000, H = 420, padL = 52, padR = 28, padT = 44, padB = 44;
  const mxRaw = Math.max(1, ...(ser === "sales" ? data.sd : ser === "orders" ? data.od : [...data.od, ...data.sd]));
  const step = mxRaw <= 10 ? 2 : mxRaw <= 40 ? 10 : mxRaw <= 100 ? 20 : mxRaw <= 250 ? 50 : 100;
  const mx = Math.ceil(mxRaw * 1.12 / step) * step;
  const x = (i) => padL + (days.length === 1 ? 0 : i * (W - padL - padR) / (days.length - 1));
  const y = (v) => H - padB - (v / mx) * (H - padT - padB);
  const showO = ser !== "sales", showS = ser !== "orders";
  const labelEvery = span <= 14 ? 1 : span <= 30 ? 2 : 3;
  const grid = []; for (let v = 0; v <= mx; v += step) grid.push(v);
  const Seg = ({ items, value, onChange }) => (
    <div className="inline-flex rounded-lg bg-neutral-100 p-0.5">{items.map(([id, l]) => <button key={id} onClick={() => onChange(id)} className={"h-7 rounded-md px-3 text-xs font-semibold transition " + (value === id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800")}>{l}</button>)}</div>
  );
  const Struct = ({ title, parts, total, label }) => (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-extrabold text-neutral-900">{title}</h3>
      {total > 0 ? (
        <div className="flex items-center gap-4">
          <SummaryDonut parts={parts} total={total} label={label} />
          <div className="min-w-0 flex-1">
            {parts.map((p, i) => (
              <div key={i} className="flex h-[26px] items-center gap-2 text-[13px]">
                <i className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 truncate font-semibold text-neutral-800" title={p.name}>{p.name}</span>
                <span className="text-neutral-400 tabular-nums">{p.n}</span>
                <b className="w-10 text-right font-extrabold tabular-nums text-neutral-900">{Math.round(p.n / total * 100)}%</b>
              </div>
            ))}
          </div>
        </div>
      ) : <div className="py-8 text-center text-sm text-neutral-400">Нет данных за период</div>}
    </div>
  );
  const hdr = (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="mr-auto text-lg font-extrabold text-neutral-900">{mp === "wb" ? "Сводка по кабинету WB" : mp === "oz" ? "Сводка по кабинету Озон" : "Сводка по кабинетам"}</h2>
      <Seg items={[["wb", "WB"], ["oz", "Озон"], ["all", "Всё вместе"]]} value={mp} onChange={setMp} />
      <Seg items={[[7, "7 дней"], [14, "14 дней"], [30, "30 дней"]]} value={span} onChange={setSpan} />
    </div>
  );
  const WB_C = "#a4258b", OZ_C = "#005bff";
  const sumA = (a) => a.reduce((x2, y2) => x2 + y2, 0);
  const ozOrders = (oz && oz.orders) || {};
  const ozOd = days.map((d) => (ozOrders[d.key] || {}).n || 0), ozRd = days.map((d) => (ozOrders[d.key] || {}).sum || 0), ozAdd = days.map((d) => (ozAd && ozAd.ad && ozAd.ad[d.key]) || 0);
  const ozTotO = sumA(ozOd), ozTotR = sumA(ozRd), ozTotA = sumA(ozAdd);
  const ozDrr = ozTotR > 0 && ozTotA > 0 ? Math.round(ozTotA / ozTotR * 1000) / 10 : null;
  const ozTime = oz && oz.updatedAt ? new Date(oz.updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
  const ozBy = (w) => w && w.items ? Object.entries(w.items).map(([n, v]) => [n, v.n, v.sum]).sort((a, b) => b[2] - a[2] || b[1] - a[1]) : [];
  const ozWayTo = (oz && oz.way && oz.way.to) || { n: 0, sum: 0 }, ozWayFrom = (oz && oz.way && oz.way.from) || { n: 0, sum: 0 }, ozStock = (oz && oz.stock) || { n: 0, sum: 0 };
  const ozParts = (() => {
    const m = new Map();
    for (const d of days) { const pr = (ozOrders[d.key] || {}).p || {}; for (const [nm, n] of Object.entries(pr)) m.set(nm, (m.get(nm) || 0) + n); }
    const arr = [...m.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const top = arr.slice(0, 4).map(([name, n], i) => ({ name, n, color: SUM_OZ[i] }));
    const rest = arr.slice(4).reduce((s2, [, n]) => s2 + n, 0);
    if (rest > 0) top.push({ name: "Остальные", n: rest, color: SUM_GRAY });
    return top;
  })();
  const refreshBtn = (
    <div className="flex shrink-0 flex-col items-end justify-center gap-1 text-[11px] text-neutral-400">
      <button onClick={() => onRefreshOz && onRefreshOz()} disabled={ozLoading || !ozReady} className="h-8 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">{ozLoading ? "Загрузка…" : "Обновить Озон"}</button>
      <span className="max-w-[220px] text-right">{ozMsg || (ozTime ? `обновлено в ${ozTime}` : "данных пока нет")}</span>
    </div>
  );
  const labelEvery2 = span <= 14 ? 1 : span <= 30 ? 2 : 3;
  const Split = ({ a, b }) => { const t = a + b; return <div className="my-2.5 flex h-2 overflow-hidden rounded-full bg-neutral-100"><i style={{ width: t > 0 ? (a / t * 100) + "%" : "0%", background: WB_C }} /><i style={{ width: t > 0 ? (b / t * 100) + "%" : "0%", background: OZ_C }} /></div>; };
  const Line2 = ({ name, color, val }) => <div className="flex items-center justify-between py-0.5 text-[13.5px] text-neutral-600"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: color }} />{name}</span><b className="tabular-nums text-neutral-900">{val}</b></div>;
  if (mp === "oz") {
    if (!ozReady) return (
      <div className="space-y-3">{hdr}
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">Озон не подключён. Добавьте ключи: Настройки → Озон.</div>
      </div>
    );
    const ser = ozSer === "rev" ? { vals: ozRd, tot: fmtMoney(ozTotR), name: "выручка", color: "#0ea5e9" } : ozSer === "ad" ? { vals: ozAdd, tot: fmtMoney(ozTotA), name: "реклама", color: "#ea580c" } : { vals: ozOd, tot: ozTotO.toLocaleString("ru-RU"), name: "заказов", color: OZ_C, sub: ozRd.map(sumK) };
    return (
      <div className="space-y-3">{hdr}
        <div className="flex flex-wrap items-stretch gap-3">
          <WayTile icon="🚚" title="В пути до покупателя" qty={ozWayTo.n} sum={ozWayTo.sum} color="#005bff" bg="#e0ebff" by={ozBy(ozWayTo)} />
          <WayTile icon="↩️" title="В пути от покупателя" qty={ozWayFrom.n} sum={ozWayFrom.sum} color="#ea580c" bg="#ffedd5" by={ozBy(ozWayFrom)} />
          <WayTile icon="📦" title="Остатки на складах Озон" qty={ozStock.n} sum={ozStock.sum} color="#4f46e5" bg="#e0e7ff" by={ozBy(ozStock)} />
          {refreshBtn}
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.9fr_1fr]">
          <div className="rounded-2xl border border-neutral-200 bg-white p-5">
            <div className="mb-1 flex flex-wrap items-start gap-6">
              <div><b className="block text-3xl font-extrabold tabular-nums" style={{ color: OZ_C }}>{ozTotO.toLocaleString("ru-RU")}</b><span className="text-xs text-neutral-500">заказов</span></div>
              <div><b className="block text-3xl font-extrabold tabular-nums text-sky-500">{fmtMoney(ozTotR)}</b><span className="text-xs text-neutral-500">выручка</span></div>
              <div><b className="block text-3xl font-extrabold tabular-nums text-orange-600">{ozDrr != null ? String(ozDrr).replace(".", ",") + "%" : "—"}</b><span className="text-xs text-neutral-500">{ozAd ? `ДРР · реклама ${fmtMoney(ozTotA)}` : "ДРР · реклама не подключена"}</span></div>
              <div className="ml-auto flex flex-wrap items-center gap-2">{ozSer === "orders" && <Seg items={[["pcs", "Только шт"], ["both", "Шт + ₽"], ["rub", "Только ₽"]]} value={lab} onChange={setLab} />}<Seg items={[["orders", "Заказы"], ["rev", "Выручка"], ["ad", "Реклама"]]} value={ozSer} onChange={setOzSer} /></div>
            </div>
            <SumLineChart days={days} series={[{ vals: ser.vals, color: ser.color, labels: true, sub: ser.sub }]} labelEvery={labelEvery2} gid="oz" mode={lab} />
            <div className="mt-1 text-[11px] text-neutral-400">Данные Озон за последние 30 дней, обновляются при открытии сводки. Заказы без отменённых; суммы в рублях (167.300 = 167 300 ₽) — до соинвеста (цена продавца).</div>
          </div>
          <div className="flex flex-col gap-3"><Struct title="Структура заказов" parts={ozParts} total={ozTotO} label="заказов" /></div>
        </div>
      </div>
    );
  }
  if (mp === "all") {
    const wbR = sumA(days.map((d) => products.reduce((a, p2) => a + (rnpOrderSum(p2, d.key) || 0), 0)));
    const wbA = sumA(days.map((d) => products.reduce((a, p2) => a + (rnpAdDay(p2, d.key) || 0), 0)));
    const totR = wbR + ozTotR, totA = wbA + ozTotA;
    const drr = (a, r) => r > 0 && a > 0 ? String(Math.round(a / r * 1000) / 10).replace(".", ",") + "%" : "—";
    const Card = ({ title, big, a, b, la, lb }) => (
      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="text-xs font-bold text-neutral-500">{title}</div>
        <div className="text-3xl font-extrabold tabular-nums text-neutral-900">{big}</div>
        <Split a={a} b={b} />
        <Line2 name="WB" color={WB_C} val={la} /><Line2 name="Озон" color={OZ_C} val={lb} />
      </div>
    );
    return (
      <div className="space-y-3">{hdr}
        <div className="grid gap-3 md:grid-cols-3">
          <Card title="Заказов" big={(totO + ozTotO).toLocaleString("ru-RU")} a={totO} b={ozTotO} la={totO.toLocaleString("ru-RU")} lb={ozTotO.toLocaleString("ru-RU")} />
          <Card title="Выручка (заказы, до СПП у WB)" big={fmtMoney(totR)} a={wbR} b={ozTotR} la={fmtMoney(wbR)} lb={fmtMoney(ozTotR)} />
          <Card title="Реклама · ДРР" big={drr(totA, totR)} a={wbA} b={ozTotA} la={`${fmtMoney(wbA)} · ${drr(wbA, wbR)}`} lb={ozAd ? `${fmtMoney(ozTotA)} · ${drr(ozTotA, ozTotR)}` : "не подключена"} />
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-neutral-200 bg-white p-5">
            <div className="mb-1 flex items-center gap-4"><h3 className="mr-auto text-sm font-extrabold text-neutral-900">Заказы по дням</h3><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500"><i className="h-2 w-2 rounded-full" style={{ background: WB_C }} />WB</span><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500"><i className="h-2 w-2 rounded-full" style={{ background: OZ_C }} />Озон</span></div>
            <SumLineChart days={days} series={[{ vals: data.od, color: WB_C }, { vals: ozOd, color: OZ_C }]} labelEvery={labelEvery2} gid="al" />
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-extrabold text-neutral-900">В пути · остатки</h3>
            <Line2 name="🚚 к покупателю" color="transparent" val={`${(wayTot.to + ozWayTo.n).toLocaleString("ru-RU")} шт · ${fmtMoney(wayTot.toSum + ozWayTo.sum)}`} />
            <Line2 name="↩️ от покупателя" color="transparent" val={`${(wayTot.from + ozWayFrom.n).toLocaleString("ru-RU")} шт · ${fmtMoney(wayTot.fromSum + ozWayFrom.sum)}`} />
            <Line2 name="📦 на складах" color="transparent" val={`${(wayTot.st + ozStock.n).toLocaleString("ru-RU")} шт · ${fmtMoney(wayTot.stSum + ozStock.sum)}`} />
            <div className="mt-3 text-[11px] text-neutral-400">WB и Озон суммируются; отдельно по кабинету — переключатель сверху. {ozReady ? (ozMsg || "") : "Озон не подключён (Настройки → Озон)."}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {hdr}
      <div className="flex flex-wrap items-stretch gap-3">
        <WayTile icon="🚚" title="В пути к клиенту" qty={wayTot.to} sum={wayTot.toSum} color="#16a34a" bg="#dcfce7" by={wayTot.byTo} />
        <WayTile icon="↩️" title="В пути от клиента" qty={wayTot.from} sum={wayTot.fromSum} color="#ea580c" bg="#ffedd5" by={wayTot.byFrom} />
        <WayTile icon="📦" title="Остатки на складах WB" qty={wayTot.st} sum={wayTot.stSum} color="#2563eb" bg="#dbeafe" by={wayTot.bySt} />
        <div className="flex shrink-0 flex-col items-end justify-center gap-1 text-[11px] text-neutral-400">
          <button onClick={() => onRefreshWay && onRefreshWay()} disabled={wayLoading} className="h-8 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">{wayLoading ? "Загрузка…" : "↻ Обновить"}</button>
          <span>{wayMsg || (wayTime ? `обновлено в ${wayTime} · цена до СПП` : "данных пока нет")}</span>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.9fr_1fr]">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="mb-1 flex flex-wrap items-start gap-4">
            <div className="flex gap-8">
              <div><b className="block text-3xl font-extrabold tabular-nums" style={{ color: "#a10d88" }}>{totO.toLocaleString("ru-RU")}</b><span className="text-xs text-neutral-500">заказов</span><span className="block text-sm font-bold tabular-nums text-neutral-700">{fmtMoney(sumA0(data.os))}</span></div>
              <div><b className="block text-3xl font-extrabold tabular-nums" style={{ color: "#481173" }}>{totS.toLocaleString("ru-RU")}</b><span className="text-xs text-neutral-500">выкупов</span><span className="block text-sm font-bold tabular-nums text-neutral-700">≈ {fmtMoney(sumA0(data.ss))}</span></div>
              <div><b className="block text-3xl font-extrabold tabular-nums text-neutral-800">{totO > 0 ? (Math.round(totS / totO * 1000) / 10).toLocaleString("ru-RU") + "%" : "—"}</b><span className="text-xs text-neutral-500">выкуп к заказам</span></div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2"><Seg items={[["pcs", "Только шт"], ["both", "Шт + ₽"], ["rub", "Только ₽"]]} value={lab} onChange={setLab} /><Seg items={[["both", "Оба"], ["orders", "Заказы"], ["sales", "Выкупы"]]} value={ser} onChange={setSer} /></div>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 420 }}>
            <defs>
              <linearGradient id="sumGa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#cb11ab" stopOpacity=".22" /><stop offset="1" stopColor="#cb11ab" stopOpacity="0" /></linearGradient>
              <linearGradient id="sumGb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#481173" stopOpacity=".2" /><stop offset="1" stopColor="#481173" stopOpacity="0" /></linearGradient>
            </defs>
            {grid.map((v) => <g key={v}><line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#eee" /><text x={0} y={y(v) + 4} fontSize="11" fill="#a3a3a3">{v}</text></g>)}
            {showO && <path d={`${sumPath(data.od, x, y)} L${x(days.length - 1)},${y(0)} L${x(0)},${y(0)}Z`} fill="url(#sumGa)" />}
            {showS && <path d={`${sumPath(data.sd, x, y)} L${x(days.length - 1)},${y(0)} L${x(0)},${y(0)}Z`} fill="url(#sumGb)" />}
            {showO && <path d={sumPath(data.od, x, y)} fill="none" stroke="#cb11ab" strokeWidth="3" strokeLinecap="round" />}
            {showS && <path d={sumPath(data.sd, x, y)} fill="none" stroke="#481173" strokeWidth="3" strokeLinecap="round" />}
            {showO && data.od.map((v, i) => <g key={"o" + i}><circle cx={x(i)} cy={y(v)} r="3.5" fill="#fff" stroke="#cb11ab" strokeWidth="2" />{i % labelEvery === 0 && <PtLabel x={x(i)} y={y(v)} v={v} sum={data.os[i]} mode={lab} up color="#a10d88" />}</g>)}
            {showS && data.sd.map((v, i) => <g key={"s" + i}><circle cx={x(i)} cy={y(v)} r="3.5" fill="#fff" stroke="#481173" strokeWidth="2" />{i % labelEvery === 0 && <PtLabel x={x(i)} y={y(v)} v={v} sum={data.ss[i]} mode={lab} color="#481173" />}</g>)}
            {days.map((d, i) => i % labelEvery === 0 && <text key={d.key} x={x(i)} y={H - 8} fontSize="11" textAnchor="middle" fill="#a3a3a3">{d.n}</text>)}
          </svg>
          <div className="mt-1 text-[11px] text-neutral-400">Суммы на графике — в рублях (167.300 = 167 300 ₽): заказы по цене до СПП, выкупы — оценка (выкупы × средняя цена до СПП). Данные из РНП: если период длиннее загруженного в РНП, дни вне него будут пустыми. Обновить заказы можно в РНП (↻ у строки «Заказы»).</div>
        </div>
        <div className="flex flex-col gap-3">
          <Seg items={[["product", "Товары"], ["subject", "Предметы"]]} value={cut} onChange={setCut} />
          <Struct title="Структура заказов" parts={partsO} total={totO} label="заказов" />
          <Struct title="Структура выкупов" parts={partsS} total={totS} label="выкупов" />
        </div>
      </div>
    </div>
  );
}

function RnpOverview({ products = [], statuses = [], wbOrders = {}, purchaseBatches = [], onOpen, onOpenPopup, onOpenDB, onSetCell, onSetFlag, onSetBudget, onSetFunds }) {
  const iso = (d) => { const x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
  const todayISO = iso(new Date());
  const SPAN = 14;
  const [endOff, setEndOff] = useState(0); // сдвиг конца периода от сегодня, дней
  const [rows, setRows] = useState(() => lsGet("rnp.ovRows", ["orders", "bloggers", "razdachi"]));
  const [onlyData, setOnlyData] = useState(() => lsGet("rnp.ovOnly", true));
  const [st, setSt] = useState("");
  const [pur, setPur] = useState(""); // фильтр по закупке (партии)
  const [rowsOpen, setRowsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusId, setFocusId] = useState(null); // фокус на одном товаре: остальные размыты
  const [fundPop, setFundPop] = useState(null); // { pid, top, left } — окно выбора фонда
  const openFund = (e, pid) => { const r = e.currentTarget.getBoundingClientRect(); setFundPop({ pid, top: Math.max(8, Math.min(r.top, window.innerHeight - 380)), left: r.right + 8 }); };
  const dm = (iso) => (iso ? iso.slice(8, 10) + "." + iso.slice(5, 7) : "");
  // длинный статус из нескольких слов: первое слово целиком, остальные — первыми буквами («Образцы п. р.»)
  const shortStatus = (name) => { const w = String(name || "").trim().split(/\s+/); return w.length > 1 && String(name).length > 12 ? w[0] + " " + w.slice(1).map((x) => x[0] + ".").join(" ") : name; };
  const [q, setQ] = useState("");
  useEffect(() => lsSet("rnp.ovRows", rows), [rows]);
  useEffect(() => lsSet("rnp.ovOnly", onlyData), [onlyData]);
  const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + endOff);
  const start = new Date(end); start.setDate(start.getDate() - (SPAN - 1));
  const dayList = buildDays(iso(start), SPAN);
  const fmtRange = (a, b) => { const f = (d) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); return f(a) + " – " + f(b) + " " + b.getFullYear(); };
  const dow = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const statusColor = (name) => (statuses.find((x) => x.name === name) || {}).color || "#a3a3a3";
  const shownTasks = RNP_TASKS.filter((t) => rows.includes(t.id));
  const hasData = (p) => {
    const r = p.rnp || {};
    return Object.keys(r.entries || {}).some((k) => (r.entries[k] || []).length) || Object.keys(r.cells || {}).some((k) => String(r.cells[k] || "") !== "") || Object.keys(r.flags || {}).some((k) => r.flags[k]) || (parseFloat(String(r.budget?.allocated || "").replace(/\s/g, "").replace(",", ".")) > 0)
      || dayList.some((d) => (wbOrders[`${p.code || p.wb || ""}:${d.key}`] || wbOrders[`${p.wb}:${d.key}`] || 0) > 0);
  };
  const list = (products || []).filter((p) => p && !p.deletedAt && p.rnp)
    .filter((p) => !st || p.status === st)
    .filter((p) => { if (!pur) return true; const bt = (purchaseBatches || []).find((x) => x.id === pur); return !!bt && (bt.items || []).some((it) => it.productId === p.id); })
    .filter((p) => !q.trim() || ((p.name || "") + " " + (p.code || "") + " " + (p.wb || "")).toLowerCase().includes(q.trim().toLowerCase()))
    .filter((p) => !onlyData || hasData(p));
  const rub = (n) => Math.round(n).toLocaleString("ru-RU");
  const cellTxt = (t, v) => { if (!v) return ""; if (t.kind === "wbOrders") return rnpWbFmt(t, v.count); if (t.kind === "checkbox" || t.kind === "rangeTask") return t.kind === "checkbox" ? "✓" : ""; return v.cost > 0 ? (v.cost >= 10000 ? (Math.round(v.cost / 100) / 10).toLocaleString("ru-RU") + " т" : rub(v.cost)) : (v.count ? String(v.count) : ""); };
  // итого по дням (по показанным товарам)
  const W_P = 240, W_F = 96, W_L = 156;
  const stk = (left, w, bg, z = 3) => ({ position: "sticky", left, width: w, minWidth: w, maxWidth: w, background: bg, zIndex: z });
  const chip = "rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition ";
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3.5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-1.5 text-base font-semibold text-neutral-900">РНП</h2>
        <div className="inline-flex items-center rounded-lg bg-neutral-100 p-0.5">
          <button onClick={() => setEndOff((o) => o - 7)} title="Неделей раньше" className="flex h-7 w-8 items-center justify-center rounded-md text-neutral-400 transition hover:bg-white hover:text-neutral-700"><ChevronLeft size={16} /></button>
          <span className="flex h-7 items-center rounded-md bg-white px-3 text-xs font-bold text-neutral-800 shadow-sm">{fmtRange(start, end)}</span>
          <button onClick={() => setEndOff((o) => o + 7)} title="Неделей позже" className="flex h-7 w-8 items-center justify-center rounded-md text-neutral-400 transition hover:bg-white hover:text-neutral-700"><ChevronRight size={16} /></button>
        </div>
        <button onClick={() => setEndOff(0)} className="inline-flex h-8 items-center rounded-lg border border-neutral-200 px-2.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">Сегодня</button>
        {fundPop && (() => {
          const p = products.find((x) => x.id === fundPop.pid); if (!p) return null;
          const funds = p.rnp.funds || [];
          const bs = (purchaseBatches || []).filter((x) => x && !x.deletedAt && (x.items || []).some((i) => i.productId === p.id));
          const setF = (nf) => onSetFunds && onSetFunds(p.id, nf);
          const upd = (id, patch) => setF(funds.map((f) => (f.id === id ? { ...f, ...patch } : f)));
          const bd = rnpBudget(p);
          return (<><div className="fixed inset-0 z-40" onClick={() => setFundPop(null)} />
            <div className="fixed z-50 w-[360px] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl" style={{ top: fundPop.top, left: Math.min(fundPop.left, window.innerWidth - 376) }}>
              <div className="flex items-center gap-2 border-b border-neutral-100 px-3.5 py-2.5"><span className="text-[13px] font-bold text-neutral-800">Фонд маркетинга · {p.code}</span><button onClick={() => setFundPop(null)} className="ml-auto rounded-md p-0.5 text-neutral-400 hover:bg-neutral-100"><X size={14} /></button></div>
              <div className="space-y-2 p-3">
                {bs.length === 0 && <div className="rounded-lg bg-neutral-50 px-3 py-2 text-[12px] text-neutral-500">Товара нет ни в одной партии — добавьте его в блоке «Закупки».</div>}
                {funds.map((f) => (
                  <div key={f.id} className="rounded-xl border border-neutral-200 p-2">
                    <div className="flex items-center gap-1.5">
                      <select value={f.batchId || ""} onChange={(e) => upd(f.id, { batchId: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[12px] font-semibold focus:outline-none">
                        <option value="">Партия…</option>
                        {bs.map((x) => <option key={x.id} value={x.id}>{x.name || "Партия"}</option>)}
                      </select>
                      <button onClick={() => setF(funds.filter((x) => x.id !== f.id))} title="Убрать фонд" className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500"><X size={13} /></button>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-neutral-500">
                      <span>Начало реализации</span>
                      <input type="date" value={f.start || ""} onChange={(e) => upd(f.id, { start: e.target.value })} className="rounded-lg border border-neutral-200 px-1.5 py-0.5 text-[12px] font-semibold text-neutral-800 focus:outline-none" />
                      <span className="ml-auto font-bold tabular-nums text-neutral-700">{f.batchId ? rub(rnpFundAmount(p, f.batchId)) + " ₽" : ""}</span>
                    </div>
                  </div>
                ))}
                {bs.length > 0 && <button onClick={() => setF([...funds, { id: uid(), batchId: (bs.find((x) => !funds.some((f) => f.batchId === x.id)) || bs[0]).id, start: "" }])} className="w-full rounded-lg border border-dashed border-neutral-300 py-1.5 text-[12px] font-bold text-neutral-500 hover:bg-neutral-50">+ Добавить фонд</button>}
                <div className="text-[10.5px] leading-snug text-neutral-400">Фонд партии считается в карточке товара (кол-во × цена × ДРР). Затраты — внутренняя реклама, блогеры, раздачи, выкупы и др. — с даты начала реализации списываются из фонда до старта следующего фонда.{bd.fund ? " Сейчас: затрачено " + rub(bd.spent) + " ₽ из " + rub(bd.allocated) + " ₽." : ""}</div>
              </div>
            </div></>);
        })()}
        <span className="ml-auto" />
        <div className="relative">
          <Box size={14} className={"pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 " + (pur ? "text-orange-600" : "text-neutral-400")} />
          <select value={pur} onChange={(e) => setPur(e.target.value)} title="Показать только товары выбранной закупки" className={"h-8 max-w-[210px] cursor-pointer appearance-none rounded-lg border pl-8 pr-7 text-xs font-semibold focus:outline-none " + (pur ? "border-orange-300 bg-orange-50 text-orange-700" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50")}>
            <option value="">Закупка: все</option>
            {(purchaseBatches || []).filter((x) => x && !x.deletedAt).map((x) => <option key={x.id} value={x.id}>{x.name || "Без названия"}</option>)}
          </select>
          <ChevronDown size={13} className={"pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 " + (pur ? "text-orange-600" : "text-neutral-400")} />
        </div>
        <div className="relative">
          <select value={st} onChange={(e) => setSt(e.target.value)} className={"h-8 cursor-pointer appearance-none rounded-lg border pl-2.5 pr-7 text-xs font-semibold focus:outline-none " + (st ? "border-orange-300 bg-orange-50 text-orange-700" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50")}>
            <option value="">Статус: все</option>
            {statuses.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
          </select>
          <ChevronDown size={13} className={"pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 " + (st ? "text-orange-600" : "text-neutral-400")} />
        </div>
        <button onClick={() => setOnlyData((v) => !v)} className={"inline-flex h-8 w-8 items-center justify-center rounded-lg border transition " + (onlyData ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50")} title={onlyData ? "Показаны только товары с данными РНП — нажмите, чтобы показать все" : "Показывать только товары, у которых есть данные РНП"}>{onlyData ? <Eye size={15} /> : <EyeOff size={15} />}</button>
        {searchOpen || q ? (
          <div className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-900 bg-white px-2.5" style={{ width: 190 }}>
            <Search size={14} className="shrink-0 text-neutral-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => { if (!q.trim()) setSearchOpen(false); }} onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); setSearchOpen(false); } }} placeholder="Поиск по товару…" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-neutral-800 outline-none placeholder:text-neutral-400" />
            <button onClick={() => { setQ(""); setSearchOpen(false); }} className="shrink-0 text-neutral-300 hover:text-neutral-600" title="Очистить"><X size={14} /></button>
          </div>
        ) : (
          <button onClick={() => setSearchOpen(true)} title="Поиск по товару" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><Search size={15} /></button>
        )}
        <div className="relative">
          <button onClick={() => setRowsOpen((o) => !o)} title="Настройка строк РНП" className={"flex h-8 w-8 items-center justify-center rounded-lg border transition " + (rowsOpen ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50")}>
            <Settings2 size={15} />
          </button>
          {rowsOpen && (<><div className="fixed inset-0 z-40" onClick={() => setRowsOpen(false)} />
            <div className="absolute right-0 z-50 mt-1.5 w-[250px] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl">
              <div className="flex items-center gap-2 border-b border-neutral-100 px-3.5 py-2.5"><span className="text-[13px] font-bold text-neutral-800">Строки РНП</span><span className="rounded-full bg-neutral-100 px-1.5 text-[10px] font-bold text-neutral-500">{rows.length}</span><button onClick={() => setRowsOpen(false)} className="ml-auto rounded-md p-0.5 text-neutral-400 hover:bg-neutral-100"><X size={14} /></button></div>
              <div className="max-h-[340px] overflow-auto p-1.5">
                {RNP_TASKS.map((t) => { const on = rows.includes(t.id); return (
                  <button key={t.id} onClick={() => setRows((r) => on ? r.filter((x) => x !== t.id) : [...r, t.id])} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-50">
                    <span className={"flex-1 text-[12.5px] font-semibold " + (on ? "text-neutral-800" : "text-neutral-400")}>{t.label}</span>
                    <span className="relative h-[18px] w-[32px] shrink-0 rounded-full transition" style={{ background: on ? "#16a34a" : "#d4d4d8" }}><span className="absolute top-0.5 h-[14px] w-[14px] rounded-full bg-white shadow transition-all" style={{ left: on ? 16 : 2 }} /></span>
                  </button>
                ); })}
              </div>
            </div></>)}
        </div>
      </div>
      {list.length === 0 ? <div className="py-12 text-center text-sm text-neutral-400">Нет товаров с данными РНП. Выключите «Только с данными», чтобы вносить записи по любым товарам</div> : (
        <div className="overflow-auto rounded-xl border border-neutral-100" style={{ maxHeight: "calc(100vh / " + 0.8 + " - 190px)" }}>
          <table className="border-separate text-[11.5px]" style={{ borderSpacing: 0, minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...stk(0, W_P + W_F + W_L, "#fff", 5), position: "sticky", top: 0, textAlign: "left", padding: "6px 10px", color: "#a3a3a3", fontWeight: 600, borderBottom: "1px solid #e5e5e5" }} colSpan={3}></th>
                {dayList.map((d) => { const dt = new Date(d.key + "T00:00:00"); const tdy = d.key === todayISO; return <th key={d.key} style={{ position: "sticky", top: 0, zIndex: 4, background: tdy ? "#fff7ed" : "#fff", minWidth: 50, padding: "4px 0", textAlign: "center", borderBottom: "1px solid #e5e5e5", color: tdy ? "#c2410c" : "#a3a3a3", fontWeight: 600 }}><div style={{ fontSize: 12, fontWeight: 800, color: tdy ? "#c2410c" : "#525252" }}>{dt.getDate()}</div><div style={{ fontSize: 10 }}>{dow[dt.getDay()]}</div></th>; })}
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const b = rnpBudget(p); const pct = b.allocated > 0 ? Math.min(100, Math.round(b.spent / b.allocated * 100)) : 0; const bar = pct < 70 ? "#16a34a" : pct < 95 ? "#f59e0b" : "#dc2626";
                const trs = shownTasks.length ? shownTasks : [null];
                return trs.map((t, ti) => (
                  <tr key={p.id + ":" + (t ? t.id : "none")} className={focusId && focusId !== p.id && list.some((x) => x.id === focusId) ? "rnp-dim" : ""}>
                    {ti === 0 && (
                      <>
                        <td rowSpan={trs.length} style={{ ...stk(0, W_P, "#fff", 2), borderBottom: "2px solid #e5e5e5", borderRight: "1px solid #f1f1f1", verticalAlign: "middle", padding: 0 }}>
                          <div className="group/foc relative">
                          <button onClick={() => onOpen && onOpen(p.id)} className="flex w-full items-center gap-2.5 px-2 py-2 text-left hover:bg-neutral-50" title="Открыть карточку">
                            {p.image ? <img src={p.image} alt="" className="h-[72px] w-[54px] shrink-0 rounded-lg object-cover" /> : <span className="h-[72px] w-[54px] shrink-0 rounded-lg bg-neutral-100" />}
                            <span className="flex h-[72px] min-w-0 flex-col justify-center gap-[2px]"><span className="text-[10px] font-extrabold leading-none text-neutral-400">{p.code || "—"}</span><span className="line-clamp-2 text-[12px] font-bold leading-tight text-neutral-800">{p.name || "Без названия"}</span>{p.status ? <span title={p.status} className="mt-[3px] max-w-full self-start truncate whitespace-nowrap rounded-full px-1.5 text-[10px] font-extrabold leading-[14px]" style={{ background: statusColor(p.status) + "22", color: statusColor(p.status) }}>{shortStatus(p.status)}</span> : <span />}</span>
                          </button>
                          <button onClick={() => setFocusId((f) => (f === p.id ? null : p.id))} title={focusId === p.id ? "Выйти из фокуса" : "Фокус на этом товаре"} className={"absolute right-1.5 top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-[5px] transition " + (focusId === p.id ? "bg-neutral-900 text-white opacity-100" : "text-neutral-400 opacity-0 hover:text-neutral-800 group-hover/foc:opacity-100")}><Focus size={14} /></button>
                          </div>
                        </td>
                        <td rowSpan={trs.length} style={{ ...stk(W_P, W_F, "#fff", 2), borderBottom: "2px solid #e5e5e5", borderRight: "1px solid #f1f1f1", verticalAlign: "middle", padding: "0 10px" }}>
                          <div className="relative flex flex-col leading-[1.15]">
                            {b.fund ? (
                              <>
                                <b className="text-[14px] font-extrabold" style={{ color: b.fund.upcoming ? "#a3a3a3" : (b.allocated > 0 ? bar : "#a3a3a3") }} title={"Фонд партии " + b.fund.batchName + ". Затрачено " + rub(b.spent) + " ₽ из " + rub(b.allocated) + " ₽"}>{b.allocated > 0 ? rub(b.ostatok) : "—"}</b>
                                <span className="text-[9.5px] font-semibold text-neutral-400">из {rub(b.allocated)}</span>
                              </>
                            ) : (
                              <>
                                <b className="text-[14px] font-extrabold" style={{ color: b.allocated > 0 ? bar : "#a3a3a3" }} title={"Остаток фонда. Затрачено " + rub(b.spent) + " ₽" + (b.allocated > 0 ? " из " + rub(b.allocated) + " ₽ (" + pct + "%)" : "")}>{b.allocated > 0 ? rub(b.ostatok) : "—"}</b>
                                <span className="flex items-baseline gap-0.5 text-[9.5px] font-semibold text-neutral-400">из <input value={(p.rnp.budget && p.rnp.budget.allocated) ?? ""} onChange={(e) => onSetBudget && onSetBudget(p.id, e.target.value)} inputMode="decimal" placeholder="0" title="Фонд маркетинга, ₽ — вручную" className="w-[52px] rounded border border-transparent bg-transparent px-0.5 text-[9.5px] font-semibold text-neutral-500 placeholder:text-neutral-300 hover:border-neutral-200 focus:border-neutral-300 focus:text-neutral-800 focus:outline-none focus:ring-2 focus:ring-orange-200" /></span>
                              </>
                            )}
                          </div>
                          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-100"><i className="block h-full" style={{ width: Math.max(pct, b.spent > 0 ? 3 : 0) + "%", background: bar }} /></div>
                          {b.fund ? <div className="mt-0.5 flex items-center justify-between text-[9.5px] font-extrabold text-neutral-400"><span>{b.fund.upcoming ? "старт " : "с "}{dm(b.fund.start)}</span><button onClick={(e) => openFund(e, p.id)} title="Выбрать фонд и дату старта" className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-neutral-400 hover:text-neutral-800"><Settings2 size={14} /></button></div> : <button onClick={(e) => openFund(e, p.id)} title="Выбрать фонд из закупки и дату старта" className="mt-1 rounded-lg border border-dashed border-neutral-300 px-1.5 text-[9.5px] font-bold leading-[15px] text-neutral-400 hover:border-orange-300 hover:text-orange-600">+ фонд</button>}
                        </td>
                      </>
                    )}
                    <td style={{ ...stk(W_P + W_F, W_L, "#fff", 2), padding: 0, fontWeight: 700, color: "#525252", whiteSpace: "nowrap", borderRight: "1px solid #f1f1f1", borderBottom: ti === trs.length - 1 ? "2px solid #e5e5e5" : "1px solid #f1f1f1" }}>{t ? ((t.kind === "twoRow" || t.kind === "rangeTask") ? <button onClick={() => onOpenDB && onOpenDB(p.id, t)} title="Все записи по строке" className="h-full w-full px-2.5 text-left font-bold hover:bg-neutral-50 hover:text-neutral-900">{t.label}</button> : <span className="px-2.5">{t.label}</span>) : ""}</td>
                    {t ? dayList.map((d) => {
                      const v = rnpDayActivity(t, p, d.key, wbOrders); const fill = (p.rnp.fills || {})[`${t.id}:${d.key}`]; const col = RNP_COLORS[t.id] || "#64748b";
                      const isTd = d.key === todayISO;
                      const arr = t.kind === "twoRow" ? ((p.rnp.entries || {})[`${t.id}:${d.key}`] || []) : [];
                      const allDone = arr.length > 0 && arr.every((e) => e.done);
                      const bg = fill || (v ? (t.kind === "wbOrders" ? "#f0fdf4" : t.kind === "twoRow" ? (allDone ? col + "22" : "#e5e5e5") : col + "22") : (isTd ? "#fff7ed" : "transparent"));
                      const base = { background: bg, color: t.kind === "wbOrders" ? (t.src === "drr" ? (v && v.count > 20 ? "#b91c1c" : v && v.count > 10 ? "#b45309" : "#15803d") : "#15803d") : col, textAlign: "center", fontWeight: 700, height: 27, padding: 0, borderLeft: "1px solid #f7f7f7", borderBottom: ti === trs.length - 1 ? "2px solid #e5e5e5" : "1px solid #f1f1f1" };
                      if (t.kind === "wbOrders") return <td key={d.key} title={rnpWbTip(t, p, d.key) || t.label} style={base}>{cellTxt(t, v)}</td>;
                      if (t.kind === "singleCost") {
                        const ad = rnpAdDay(p, d.key);
                        if (t.id === "internal" && ad !== undefined) return <td key={d.key} title="Факт из WB (внутренняя реклама)" style={{ ...base, background: fill || (ad > 0 ? col + "22" : (isTd ? "#fff7ed" : "transparent")), color: col }}>{ad > 0 ? Math.round(ad).toLocaleString("ru-RU") : ""}</td>;
                        const key = `${t.id}:cost:${d.key}`; const val = (p.rnp.cells || {})[key] ?? ""; const has = val !== "" && parseFloat(String(val).replace(",", ".")) > 0;
                        return <td key={d.key} title={t.label} style={{ ...base, background: fill || (has ? col + "22" : (isTd ? "#fff7ed" : "transparent")) }}><input value={val} onChange={(e) => onSetCell && onSetCell(p.id, key, e.target.value)} inputMode="decimal" className="h-full w-full bg-transparent px-1 text-center text-[11.5px] font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ color: col }} /></td>;
                      }
                      if (t.kind === "checkbox") {
                        const key = `${t.id}:${d.key}`; const on = !!(p.rnp.flags || {})[key];
                        return <td key={d.key} title={t.label} style={{ ...base, background: fill || (on ? "#f0fdf4" : base.background) }}><label className="flex h-full cursor-pointer items-center justify-center"><input type="checkbox" checked={on} onChange={() => onSetFlag && onSetFlag(p.id, key, !on)} className="h-3.5 w-3.5 accent-green-600" /></label></td>;
                      }
                      // записи (блогеры, раздачи, выкупы, Wibes) и диапазоны (баллы, А/Б) — то же окно, что в карточке
                      const open = () => (t.kind === "rangeTask" ? (onOpenDB && onOpenDB(p.id, t)) : (onOpenPopup && onOpenPopup(p.id, t, d.key)));
                      return <td key={d.key} onClick={open} title={t.label + (arr.length ? " · записей: " + arr.length : "") + " — клик: открыть записи"} className="group cursor-pointer" style={base}>{cellTxt(t, v)}{!v && <span className="text-[13px] font-bold text-neutral-300 opacity-0 transition group-hover:opacity-100">+</span>}</td>;
                    }) : <td colSpan={dayList.length} style={{ borderBottom: "2px solid #e5e5e5", color: "#a3a3a3", padding: "0 12px" }}>Включите строки РНП выше</td>}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StrategySection({ strategy, onChange, onCreateTask, onOpenTask }) {
  const st = normStrategy(strategy);
  const maps = st.maps;
  const active = maps.find((m) => m.id === st.activeId) || maps[0];
  const [editingId, setEditingId] = useState(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [docView, setDocView] = useState(() => lsGet("rnp.stratView", "map") === "doc"); // режим отображения карты: холст | документ
  useEffect(() => lsSet("rnp.stratView", docView ? "doc" : "map"), [docView]);

  const save = (next) => onChange({ __v: 2, ...next });
  const updateActive = (next) => save({ maps: maps.map((m) => (m.id === active.id ? { ...m, nodes: next.nodes, edges: next.edges } : m)), activeId: active.id });
  const selectMap = (id) => { setEditingId(null); save({ maps, activeId: id }); };
  const addMap = (template) => { const m = makeTemplatedMap(template, `Карта ${maps.length + 1}`); setTplOpen(false); save({ maps: [...maps, m], activeId: m.id }); };
  const dupMap = (id) => {
    const src = maps.find((m) => m.id === id); if (!src) return;
    const copy = JSON.parse(JSON.stringify(src)); copy.id = uid(); copy.name = `${src.name} (копия)`;
    const idmap = {}; copy.nodes.forEach((n) => { const nid = uid(); idmap[n.id] = nid; n.id = nid; });
    copy.edges.forEach((e) => { e.id = uid(); e.from = idmap[e.from] || e.from; e.to = idmap[e.to] || e.to; });
    copy.rootId = idmap[src.rootId] || copy.nodes[0]?.id;
    const at = maps.findIndex((m) => m.id === id); const next = maps.slice(); next.splice(at + 1, 0, copy);
    save({ maps: next, activeId: copy.id });
  };
  const renameMap = (id, name) => save({ maps: maps.map((m) => (m.id === id ? { ...m, name: name.trim() || "Без названия" } : m)), activeId: st.activeId });
  const removeMap = (id) => {
    if (maps.length <= 1) { const m = makeTemplatedMap("mind", "Карта 1"); save({ maps: [m], activeId: m.id }); return; }
    const rest = maps.filter((m) => m.id !== id);
    save({ maps: rest, activeId: id === st.activeId ? rest[0].id : st.activeId });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Компактный селектор активной карты */}
        <div className="relative">
          {editingId === active.id ? (
            <input autoFocus defaultValue={active.name}
              onBlur={(e) => { renameMap(active.id, e.target.value); setEditingId(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); else if (e.key === "Escape") setEditingId(null); }}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-800 focus:outline-none" style={{ width: 210 }} />
          ) : (
            <button onClick={() => { setMapOpen((o) => !o); setTplOpen(false); }} title="Выбрать карту"
              className="inline-flex max-w-full items-center gap-2 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STRAT_TPL_COLOR[active.template] || "#9ca3af" }} />
              <span className="max-w-[360px] truncate" title={active.name}>{active.name}</span>
              <span className="rounded bg-white/20 px-1 py-px text-[9px] font-bold uppercase text-white/80">{(STRAT_TPLS[active.template]?.label || "").slice(0, 4)}</span>
              <ChevronDown size={13} className="shrink-0 opacity-80" />
            </button>
          )}
          {mapOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMapOpen(false)} />
              <div className="absolute left-0 z-20 mt-1 w-72 overflow-hidden rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
                <div className="max-h-72 overflow-auto">
                  {maps.map((m) => {
                    const on = m.id === active.id;
                    return (
                      <div key={m.id} onClick={() => { selectMap(m.id); setMapOpen(false); }}
                        className={"group/mi flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 " + (on ? "bg-neutral-100" : "hover:bg-neutral-50")}>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STRAT_TPL_COLOR[m.template] || "#9ca3af" }} />
                        <span className={"min-w-0 flex-1 truncate text-sm " + (on ? "font-semibold text-neutral-900" : "text-neutral-700")}>{m.name}</span>
                        <span className="shrink-0 text-[9px] font-bold uppercase text-neutral-400">{(STRAT_TPLS[m.template]?.label || "").slice(0, 4)}</span>
                        {maps.length > 1 && (
                          <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Удалить карту «${m.name}»?`)) removeMap(m.id); }}
                            className="shrink-0 rounded p-0.5 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover/mi:opacity-100" title="Удалить карту"><X size={13} /></button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Действия над активной картой */}
        <button onClick={() => setEditingId(active.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700" title="Переименовать"><Pencil size={13} /> Переименовать</button>
        <button onClick={() => dupMap(active.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700" title="Дублировать карту"><Copy size={13} /> Дублировать</button>
        <button onClick={() => { if (window.confirm(`Удалить карту «${active.name}»?`)) removeMap(active.id); }} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-500 hover:bg-red-50 hover:text-red-600" title="Удалить карту"><Trash2 size={13} /> Удалить</button>

        {/* Режим отображения: холст (карта) или документ (заголовки/подзаголовки) */}
        <div className="ml-auto inline-flex rounded-lg bg-neutral-100 p-0.5">
          {[[false, "Карта", GitBranch], [true, "Документ", FileText]].map(([v, lbl, Ic]) => (
            <button key={String(v)} onClick={() => setDocView(v)} title={v ? "Показать как документ с заголовками" : "Показать как карту"}
              className={"flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition " + (docView === v ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>
              <Ic size={13} /> {lbl}
            </button>
          ))}
        </div>

        {/* Новая карта — выбор шаблона */}
        <div className="relative">
          <button onClick={() => { setTplOpen((o) => !o); setMapOpen(false); }} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800" title="Создать новую карту"><Plus size={14} /> Карта <ChevronDown size={13} className="opacity-80" /></button>
          {tplOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setTplOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Новая карта — шаблон</div>
                {Object.keys(STRAT_TPLS).map((k) => (
                  <button key={k} onClick={() => { addMap(k); setTplOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-neutral-50">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STRAT_TPL_COLOR[k] }} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800">{STRAT_TPLS[k].label}</span>
                    {k === "stages" && <span className="shrink-0 rounded bg-rose-50 px-1.5 text-[9px] font-bold uppercase text-rose-600">новое</span>}
                    <Plus size={13} className="shrink-0 text-neutral-400" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {docView
        ? <StrategyDoc key={active.id + "-doc"} rootId={active.rootId} strategy={{ nodes: active.nodes, edges: active.edges }} onChange={updateActive} onCreateTask={onCreateTask} onOpenTask={onOpenTask} />
        : <StrategyBoard key={active.id} template={active.template} rootId={active.rootId} strategy={{ nodes: active.nodes, edges: active.edges }} onChange={updateActive} onCreateTask={onCreateTask} onOpenTask={onOpenTask} />}
    </div>
  );
}

const GROUP_COLORS = ["#6366f1", "#0ea5e9", "#f59e0b", "#ec4899", "#10b981", "#8b5cf6"];
const TYPE_COLOR = { stage: "#a3a3a3", goal: "#059669", risk: "#d97706", decision: "#7c3aed" };

// ---- Режим «Документ»: то же дерево, развёрнутое в текст с заголовками ----
function StrategyDoc({ strategy, rootId, onChange }) {
  const nodes = (strategy && strategy.nodes) || [];
  const edges = (strategy && strategy.edges) || [];
  const sref = useRef({ nodes, edges }); sref.current = { nodes, edges };
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const kids = {}; nodes.forEach((n) => (kids[n.id] = [])); edges.forEach((e) => { if (kids[e.from]) kids[e.from].push(e.to); });

  const [focusId, setFocusId] = useState(null);
  const [noteFocusId, setNoteFocusId] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [openNotes, setOpenNotes] = useState(() => new Set());
  const titleRefs = useRef({});
  const noteRefs = useRef({});

  const apply = (next) => onChange(next);
  const descendantsOf = (id) => { const set = new Set(); const stack = [id]; while (stack.length) { const u = stack.pop(); (kids[u] || []).forEach((c) => { if (!set.has(c)) { set.add(c); stack.push(c); } }); } return set; };
  const setNode = (id, p) => { const s = sref.current; apply({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }); };
  const addChild = (pid) => { const s = sref.current; const id = uid(); const node = { id, title: "", note: "", color: "#a3a3a3", done: false, hasCheck: false, type: "stage", collapsed: false, image: null, checklist: [] }; apply({ ...s, nodes: s.nodes.map((n) => (n.id === pid ? { ...n, collapsed: false } : n)).concat(node), edges: [...s.edges, { id: uid(), from: pid, to: id }] }); setFocusId(id); };
  const removeNode = (id) => { if (id === rootId) return; const s = sref.current; const kill = descendantsOf(id); kill.add(id); apply({ ...s, nodes: s.nodes.filter((n) => !kill.has(n.id)), edges: s.edges.filter((e) => !kill.has(e.from) && !kill.has(e.to)) }); };
  const addCheck = (id) => { const s = sref.current; apply({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: [...(n.checklist || []), { id: uid(), text: "", done: false }] } : n)) }); };
  const toggleCheck = (id, cid) => { const s = sref.current; apply({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: (n.checklist || []).map((c) => (c.id === cid ? { ...c, done: !c.done } : c)) } : n)) }); };
  const setCheckText = (id, cid, text) => { const s = sref.current; apply({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: (n.checklist || []).map((c) => (c.id === cid ? { ...c, text } : c)) } : n)) }); };
  const removeCheck = (id, cid) => { const s = sref.current; apply({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: (n.checklist || []).filter((c) => c.id !== cid) } : n)) }); };

  const sizeNote = (el) => { if (!el) return; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
  useLayoutEffect(() => { Object.values(noteRefs.current).forEach(sizeNote); });
  useEffect(() => { if (focusId && titleRefs.current[focusId]) titleRefs.current[focusId].focus(); }, [focusId]);
  useEffect(() => { if (noteFocusId && noteRefs.current[noteFocusId]) { noteRefs.current[noteFocusId].focus(); setNoteFocusId(null); } }, [noteFocusId]);

  const root = byId[rootId];
  if (!root) return <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">Пустая карта</div>;

  const isListLeaf = (id) => (kids[id] || []).length === 0; // лист без детей — остаётся в списке даже с заметкой/галочкой
  const childrenAllSimple = (id) => { const ch = kids[id] || []; return ch.length > 0 && ch.every(isListLeaf); };
  const scrollTo = (id) => { const el = document.getElementById("stratsec-" + id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };

  const DOC_COLORS = ["#a3a3a3", "#2563eb", "#0ea5e9", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#7c3aed"];
  const noteVisible = (id) => !!((byId[id].note || "").trim()) || openNotes.has(id);
  const openNote = (id) => { setOpenNotes((s) => { const n = new Set(s); n.add(id); return n; }); setNoteFocusId(id); setMenuFor(null); };
  const hideNote = (id) => { if ((byId[id].note || "").trim()) return; setOpenNotes((s) => { const n = new Set(s); n.delete(id); return n; }); };
  const toggleNote = (id) => { noteVisible(id) ? hideNote(id) : openNote(id); };

  const renderToggle = (on) => (
    <span className={"relative h-[20px] w-[34px] shrink-0 rounded-full transition " + (on ? "bg-neutral-900" : "bg-neutral-200")}><span className={"absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white transition-all " + (on ? "left-[16px]" : "left-[2px]")} /></span>
  );
  const renderSettings = (id, { check = false, color = false } = {}) => (
    <div className="relative shrink-0">
      <button onClick={(e) => { e.stopPropagation(); setMenuFor((m) => (m === id ? null : id)); }} className={"rounded p-1 transition hover:bg-neutral-100 " + (menuFor === id ? "text-violet-600" : "text-neutral-300 hover:text-neutral-600")} title="Настройки строки"><Settings2 size={13} /></button>
      {menuFor === id && (
        <div className="absolute right-0 top-8 z-20 w-56 rounded-xl border border-neutral-200 bg-white p-2 shadow-xl" onClick={(e) => e.stopPropagation()}>
          {check && (
            <button onClick={() => setNode(id, { hasCheck: !(byId[id].hasCheck !== false) })} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-neutral-50"><span className="text-[13px] font-medium text-neutral-700">Чекбокс</span>{renderToggle(byId[id].hasCheck !== false)}</button>
          )}
          {color && (<>
            {check && <div className="my-1 h-px bg-neutral-100" />}
            <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Цвет</div>
            <div className="flex flex-wrap gap-1.5 px-2 pb-1">
              {DOC_COLORS.map((c) => <button key={c} onClick={() => setNode(id, { color: c })} className="h-[19px] w-[19px] rounded-full transition hover:scale-110" style={{ background: c, boxShadow: (byId[id].color || "") === c ? "0 0 0 2px #fff, 0 0 0 4px #111" : "none" }} />)}
            </div>
          </>)}
          {(check || color) && <div className="my-1 h-px bg-neutral-100" />}
          <button onClick={() => toggleNote(id)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-neutral-50"><span className="text-[13px] font-medium text-neutral-700">Заметка</span>{renderToggle(noteVisible(id))}</button>
        </div>
      )}
    </div>
  );
  const renderPlus = (onClick, title, extra = "") => (
    <button onClick={onClick} title={title} className={"mt-1 inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-dashed border-neutral-200 text-neutral-400 transition hover:border-violet-300 hover:text-violet-600 " + extra}><Plus size={14} /></button>
  );

  // --- хелперы рендера (функции, НЕ компоненты — чтобы поля не теряли фокус) ---
  const renderTitle = (id, cls, ph) => (
    <input ref={(el) => (titleRefs.current[id] = el)} value={byId[id].title} placeholder={ph || "Без названия"}
      onChange={(e) => setNode(id, { title: e.target.value })}
      onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      className={cls + " w-full bg-transparent outline-none placeholder:text-neutral-300"} />
  );
  const renderNote = (id) => (
    <textarea ref={(el) => { noteRefs.current[id] = el; }} value={byId[id].note || ""} rows={1} placeholder="Заметка…"
      onChange={(e) => { setNode(id, { note: e.target.value }); sizeNote(e.target); }} onInput={(e) => sizeNote(e.target)}
      className="w-full resize-none overflow-hidden bg-transparent text-[14px] leading-relaxed text-neutral-600 outline-none placeholder:text-neutral-300" />
  );
  const renderLeafList = (pid) => (
    <div className="mb-2 mt-1 max-w-[640px]">
      {(kids[pid] || []).map((cid) => { const c = byId[cid]; const checkable = c.hasCheck !== false; const accent = c.color && c.color !== "#a3a3a3" ? c.color : "#16a34a"; const bul = c.color && c.color !== "#a3a3a3" ? c.color : "#c4b5fd"; const actsOpen = menuFor === cid; return (
        <div key={cid}>
          <div className="group/li flex items-center gap-2.5 py-1">
            {checkable
              ? <button onClick={() => setNode(cid, { done: !c.done })} className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border-[1.6px]" style={c.done ? { background: accent, borderColor: accent, color: "#fff" } : { borderColor: "#d2d2d8", color: "transparent" }}><Check size={11} strokeWidth={3} /></button>
              : <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: bul }} />}
            <input ref={(el) => (titleRefs.current[cid] = el)} value={c.title} placeholder="Пункт…"
              onChange={(e) => setNode(cid, { title: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChild(pid); } }}
              className={"min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-neutral-300 " + (checkable && c.done ? "text-neutral-400 line-through" : "text-neutral-700")} />
            <div className={"flex shrink-0 items-center transition " + (actsOpen ? "opacity-100" : "opacity-0 group-hover/li:opacity-100")}>
              <button onClick={() => removeNode(cid)} className="rounded p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить пункт"><X size={13} /></button>
              {renderSettings(cid, { check: true, color: true })}
            </div>
          </div>
          {noteVisible(cid) && <div className="mb-1 ml-[16px] max-w-[600px] border-l-2 border-violet-100 pl-3">{renderNote(cid)}</div>}
        </div>
      ); })}
      {renderPlus(() => addChild(pid), "Добавить пункт")}
    </div>
  );
  const renderCheckList = (id) => { const cl = byId[id].checklist || []; if (!cl.length) return null; return (
    <div className="mb-2 mt-1 max-w-[640px]">
      {cl.map((c) => (
        <div key={c.id} className="group/ci flex items-center gap-2.5 py-1">
          <button onClick={() => toggleCheck(id, c.id)} className={"flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border-[1.6px] " + (c.done ? "border-green-600 bg-green-600 text-white" : "border-neutral-300 text-transparent hover:border-neutral-400")}><Check size={11} strokeWidth={3} /></button>
          <input value={c.text} placeholder="Пункт…" onChange={(e) => setCheckText(id, c.id, e.target.value)} className={"min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-neutral-300 " + (c.done ? "text-neutral-400 line-through" : "text-neutral-700")} />
          <button onClick={() => removeCheck(id, c.id)} className="shrink-0 rounded p-0.5 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover/ci:opacity-100" title="Удалить пункт"><X size={13} /></button>
        </div>
      ))}
      <button onClick={() => addCheck(id)} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-neutral-400 hover:text-green-600"><Plus size={13} /> пункт</button>
    </div>
  ); };
  const renderHeadActions = (id, { color = true } = {}) => { const open = menuFor === id; return (
    <div className={"flex shrink-0 items-center gap-0.5 transition " + (open ? "opacity-100" : "opacity-0 group-hover/h:opacity-100")}>
      <button onClick={() => addChild(id)} className="rounded p-1 text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600" title="Добавить подтему"><Plus size={14} /></button>
      {renderSettings(id, { color })}
      {id !== rootId && <button onClick={() => removeNode(id)} className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить раздел"><Trash2 size={13} /></button>}
    </div>
  ); };
  const renderSection = (id, depth, num) => {
    const n = byId[id]; const clr = n.color && n.color !== "#a3a3a3" ? n.color : "#8b5cf6";
    const head = depth === 1
      ? <div id={"stratsec-" + id} className="group/h mb-1 mt-8 flex items-center gap-2.5 border-l-[3px] pl-3" style={{ borderColor: clr }}><span className="text-[15px] font-bold text-neutral-300">{num}</span>{renderTitle(id, "text-[20px] font-extrabold tracking-tight text-neutral-900")}{renderHeadActions(id)}</div>
      : depth === 2
      ? <div id={"stratsec-" + id} className="group/h mb-1 mt-5 flex items-center gap-2"><span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: clr }} />{renderTitle(id, "text-[15.5px] font-extrabold text-neutral-800")}{renderHeadActions(id)}</div>
      : <div id={"stratsec-" + id} className="group/h mb-1 mt-4 flex items-center gap-2"><span className="text-neutral-300">—</span>{renderTitle(id, "text-[14px] font-bold text-neutral-700")}{renderHeadActions(id)}</div>;
    return (
      <div key={id}>
        {head}
        <div className="pl-[15px]">
          {noteVisible(id) && renderNote(id)}
          {renderCheckList(id)}
          {childrenAllSimple(id)
            ? renderLeafList(id)
            : <>{(kids[id] || []).map((cid) => renderSection(cid, depth + 1))}{renderPlus(() => addChild(id), "Добавить подзаголовок")}</>}
        </div>
      </div>
    );
  };

  const topKids = (kids[rootId] || []).map((id) => byId[id]).filter(Boolean);
  const cnt = Math.max(0, nodes.length - 1);
  const word = (cnt % 10 === 1 && cnt % 100 !== 11) ? "подтема" : ([2, 3, 4].includes(cnt % 10) && ![12, 13, 14].includes(cnt % 100)) ? "подтемы" : "подтем";

  return (
    <>
      {menuFor && <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />}
    <div className="grid grid-cols-[232px_1fr] rounded-2xl border border-neutral-200 bg-white">
      <nav className="rounded-l-2xl border-r border-neutral-100 bg-neutral-50/60 p-5">
        <div className="sticky top-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Содержание</div>
          <button onClick={() => scrollTo(rootId)} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] font-bold text-neutral-800 hover:bg-neutral-100">{root.title || "Без названия"}</button>
          {topKids.map((n) => <button key={n.id} onClick={() => scrollTo(n.id)} className="block w-full truncate rounded-md py-1.5 pl-5 pr-2 text-left text-[12.5px] text-neutral-500 hover:bg-neutral-100">{n.title || "Без названия"}</button>)}
        </div>
      </nav>
      <article className="px-10 py-8">
        <div className="mb-1 flex items-center gap-2 text-[12px] text-neutral-400"><span className="h-[9px] w-[9px] rounded-full bg-neutral-300" />Карты · {cnt} {word}</div>
        <div id={"stratsec-" + rootId} className="group/h flex items-center gap-2">{renderTitle(rootId, "text-[28px] font-extrabold tracking-tight text-neutral-900")}{renderHeadActions(rootId, { color: false })}</div>
        {noteVisible(rootId) && <div className="mb-4 mt-1 max-w-[680px]">{renderNote(rootId)}</div>}
        {childrenAllSimple(rootId)
          ? renderLeafList(rootId)
          : <>{topKids.map((n, i) => renderSection(n.id, 1, i + 1))}{renderPlus(() => addChild(rootId), "Добавить раздел", "mt-8")}</>}
      </article>
    </div>
    </>
  );
}

function StrategyBoard({ strategy, onChange, onCreateTask, onOpenTask, template, rootId }) {
  const W = 220, GRID = 20, CW = 6000, CH = 4200;
  const tpl = STRAT_TPLS[template] ? template : "mind";
  const nodes = (strategy && strategy.nodes) || [];
  const edges = (strategy && strategy.edges) || [];
  const stateRef = useRef({ nodes, edges });
  stateRef.current = { nodes, edges };

  const vpRef = useRef(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const histRef = useRef({ past: [], future: [] });
  const sizeRef = useRef({});       // id → измеренная высота блока
  const contentElRef = useRef(null);
  const focusRef = useRef(null);

  const [view, setView] = useState({ s: 1, tx: 40, ty: 20 });
  const viewRef = useRef(view); viewRef.current = view;
  const [sel, setSel] = useState([]);
  const selRef = useRef(sel); selRef.current = sel;
  const [settingsFor, setSettingsFor] = useState(null);
  const [imgView, setImgView] = useState(null);
  const [taskFor, setTaskFor] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [vpSize, setVpSize] = useState({ w: 1000, h: 600 });
  const [toast, setToast] = useState("");
  const [, force] = useState(0);

  // ---- история ----
  const snap = () => JSON.parse(JSON.stringify(stateRef.current));
  const apply = (next) => onChange(next);
  const pushHist = () => { const h = histRef.current; h.past.push(snap()); if (h.past.length > 60) h.past.shift(); h.future = []; force((n) => n + 1); };
  const commit = (next) => { pushHist(); apply(next); };
  const undo = () => { const h = histRef.current; if (!h.past.length) return; h.future.push(snap()); apply(h.past.pop()); force((n) => n + 1); };
  const redo = () => { const h = histRef.current; if (!h.future.length) return; h.past.push(snap()); apply(h.future.pop()); force((n) => n + 1); };

  // ---- авто-раскладка ----
  const pos = computeStratLayout(nodes, edges, rootId, tpl, (id) => sizeRef.current[id]);
  const P = (id) => pos[id] || { x: 40, y: 40 };
  const pnodes = nodes.map((n) => ({ ...n, x: P(n.id).x, y: P(n.id).y }));
  const byId = Object.fromEntries(pnodes.map((n) => [n.id, n]));

  const kidsMap = {}; nodes.forEach((n) => (kidsMap[n.id] = [])); edges.forEach((e) => { if (kidsMap[e.from]) kidsMap[e.from].push(e.to); });
  const childCount = (id) => (kidsMap[id] || []).length;
  const parentEdge = (id) => stateRef.current.edges.find((e) => e.to === id);
  const descendantsOf = (id) => { const km = {}; stateRef.current.nodes.forEach((n) => (km[n.id] = [])); stateRef.current.edges.forEach((e) => { if (km[e.from]) km[e.from].push(e.to); }); const set = new Set(); const stack = [id]; while (stack.length) { const u = stack.pop(); (km[u] || []).forEach((c) => { if (!set.has(c)) { set.add(c); stack.push(c); } }); } return set; };

  // ---- мутаторы ----
  const patchLive = (id, p) => { const s = stateRef.current; apply({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }); };
  const patchNode = (id, p) => { const s = stateRef.current; commit({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }); };
  const toggleCollapse = (id) => patchNode(id, { collapsed: !byId[id]?.collapsed });
  const attachImage = async (id, file) => { try { const thumb = await fileToThumb(file, 560); patchNode(id, { image: thumb }); } catch {} };
  const addChild = (parentId) => {
    const s = stateRef.current; const parent = s.nodes.find((n) => n.id === parentId); if (!parent) return;
    const id = uid();
    const node = { id, title: "", note: "", color: "#a3a3a3", done: false, hasCheck: false, type: "stage", collapsed: false, image: null, checklist: [] };
    commit({ ...s, nodes: s.nodes.map((n) => (n.id === parentId ? { ...n, collapsed: false } : n)).concat(node), edges: [...s.edges, { id: uid(), from: parentId, to: id }] });
    setSel([id]); setSettingsFor(null); focusRef.current = id;
  };
  const addSibling = (nodeId) => { if (nodeId === rootId) { addChild(rootId); return; } const pe = parentEdge(nodeId); addChild(pe ? pe.from : rootId); };
  const removeSubtree = (id) => {
    if (id === rootId) { setToast("Корневой блок удалить нельзя"); return; }
    const s = stateRef.current; const kill = descendantsOf(id); kill.add(id);
    commit({ ...s, nodes: s.nodes.filter((n) => !kill.has(n.id)), edges: s.edges.filter((e) => !kill.has(e.from) && !kill.has(e.to)) });
    setSel([]); setSettingsFor(null);
  };
  const duplicateNode = (id) => {
    const s = stateRef.current; const src = s.nodes.find((n) => n.id === id); if (!src || id === rootId) return;
    const pe = parentEdge(id); if (!pe) return;
    const nid = uid(); const copy = { ...JSON.parse(JSON.stringify(src)), id: nid, collapsed: false, checklist: (src.checklist || []).map((c) => ({ ...c, id: uid() })) };
    commit({ ...s, nodes: [...s.nodes, copy], edges: [...s.edges, { id: uid(), from: pe.from, to: nid }] });
    setSel([nid]);
  };
  const reparent = (dragId, targetId) => {
    if (!dragId || !targetId || dragId === rootId || dragId === targetId) return;
    const desc = descendantsOf(dragId); if (desc.has(targetId)) return;
    const s = stateRef.current; const pe = s.edges.find((e) => e.to === dragId); if (!pe || pe.from === targetId) return;
    commit({ ...s, nodes: s.nodes.map((n) => (n.id === targetId ? { ...n, collapsed: false } : n)), edges: s.edges.map((e) => (e === pe ? { ...e, from: targetId } : e)) });
    setToast("Блок перемещён");
  };
  // чек-лист
  const addCheck = (id) => { const s = stateRef.current; commit({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: [...(n.checklist || []), { id: uid(), text: "", done: false }] } : n)) }); };
  const toggleCheck = (id, cid) => { const s = stateRef.current; commit({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: n.checklist.map((c) => (c.id === cid ? { ...c, done: !c.done } : c)) } : n)) }); };
  const setCheckText = (id, cid, text) => { const s = stateRef.current; apply({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: n.checklist.map((c) => (c.id === cid ? { ...c, text } : c)) } : n)) }); };
  const removeCheck = (id, cid) => { const s = stateRef.current; commit({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: n.checklist.filter((c) => c.id !== cid) } : n)) }); };

  // ---- координаты ----
  const toWorld = (cx, cy) => { const r = vpRef.current.getBoundingClientRect(); const v = viewRef.current; return { x: (cx - r.left - v.tx) / v.s, y: (cy - r.top - v.ty) / v.s }; };

  // ---- drag = переупорядочивание (смена родителя) ----
  const onNodeMove = (e) => {
    const d = dragRef.current; if (!d) return;
    if (!d.moved) { if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 4) return; d.moved = true; }
    d.cx = e.clientX; d.cy = e.clientY;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const host = el && el.closest ? el.closest("[data-node]") : null;
    const to = host ? host.getAttribute("data-node") : null;
    const desc = d.desc;
    setDropTarget(to && to !== d.id && !desc.has(to) ? to : null);
  };
  const onNodeUp = () => {
    const d = dragRef.current; dragRef.current = null;
    window.removeEventListener("pointermove", onNodeMove); window.removeEventListener("pointerup", onNodeUp);
    const t = dropTargetRef.current;
    if (d && d.moved && t) reparent(d.id, t);
    setDropTarget(null);
  };
  const dropTargetRef = useRef(null); dropTargetRef.current = dropTarget;
  const onNodeDown = (e, n) => {
    if (e.button !== 0) return; e.stopPropagation(); setTaskFor(null);
    setSel([n.id]);
    setSettingsFor((p) => (p === n.id ? p : null));
    if (n.id === rootId) return; // корень не перетаскиваем
    dragRef.current = { id: n.id, sx: e.clientX, sy: e.clientY, moved: false, desc: descendantsOf(n.id) };
    window.addEventListener("pointermove", onNodeMove); window.addEventListener("pointerup", onNodeUp);
  };

  // ---- панорамирование фона ----
  const onPanMove = (e) => { const p = panRef.current; if (!p) return; setView((v) => ({ ...v, tx: p.tx + (e.clientX - p.sx), ty: p.ty + (e.clientY - p.sy) })); };
  const onPanUp = () => { panRef.current = null; window.removeEventListener("pointermove", onPanMove); window.removeEventListener("pointerup", onPanUp); };
  const onBgDown = (e) => {
    if (e.button !== 0) return; setSel([]); setTaskFor(null); setSettingsFor(null);
    const v = viewRef.current; panRef.current = { sx: e.clientX, sy: e.clientY, tx: v.tx, ty: v.ty };
    window.addEventListener("pointermove", onPanMove); window.addEventListener("pointerup", onPanUp);
  };

  // ---- зум / вписать ----
  const zoomAt = (cx, cy, factor) => setView((v) => { const ns = Math.min(2, Math.max(0.3, v.s * factor)); const k = ns / v.s; return { s: ns, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k }; });
  const zoomBtn = (factor) => { const r = vpRef.current.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, factor); };
  const fitView = () => {
    const ps = Object.values(pos); const r = vpRef.current.getBoundingClientRect(); const pad = 56;
    if (!ps.length) { setView({ s: 1, tx: 40, ty: 20 }); return; }
    const minX = Math.min(...ps.map((p) => p.x)), minY = Math.min(...ps.map((p) => p.y));
    const maxX = Math.max(...ps.map((p) => p.x + W)), maxY = Math.max(...ps.map((p) => p.y + (sizeRef.current[Object.keys(pos).find((k) => pos[k] === p)] || 100)));
    const sc = Math.min((r.width - pad * 2) / (maxX - minX || 1), (r.height - pad * 2) / (maxY - minY || 1), 1.2);
    const ns = Math.max(0.3, Math.min(2, sc));
    setView({ s: ns, tx: (r.width - (maxX - minX) * ns) / 2 - minX * ns, ty: (r.height - (maxY - minY) * ns) / 2 - minY * ns });
  };

  // ---- эффекты ----
  const actRef = useRef({});
  actRef.current = {
    undo, redo,
    del: () => { const ids = selRef.current; if (ids.length === 1) removeSubtree(ids[0]); },
    child: () => { const ids = selRef.current; if (ids.length === 1) addChild(ids[0]); },
    sib: () => { const ids = selRef.current; if (ids.length === 1) addSibling(ids[0]); },
  };
  useEffect(() => {
    const el = vpRef.current; if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      // pinch на тачпаде (ctrl) или Ctrl/⌘+колесо — масштаб; обычный свайп двумя пальцами — панорама
      if (e.ctrlKey || e.metaKey) { const r = el.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.1 : 1 / 1.1); }
      else { setView((v) => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY })); }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setVpSize({ w: r.width, h: r.height }); });
    ro.observe(el);
    const t = setTimeout(() => { fitView(); const r = el.getBoundingClientRect(); setVpSize({ w: r.width, h: r.height }); }, 30);
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? actRef.current.redo() : actRef.current.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); actRef.current.redo(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); actRef.current.del(); }
      else if (e.key === "Tab") { e.preventDefault(); actRef.current.child(); }
      else if (e.key === "Enter") { e.preventDefault(); actRef.current.sib(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { el.removeEventListener("wheel", onWheel); ro.disconnect(); clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => {
    if (!imgView) return;
    const onEsc = (e) => { if (e.key === "Escape") setImgView(null); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [imgView]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 1600); return () => clearTimeout(t); }, [toast]);
  // измеряем высоты блоков → пересчитываем раскладку
  useLayoutEffect(() => {
    if (!contentElRef.current) return; let changed = false;
    contentElRef.current.querySelectorAll("[data-node]").forEach((el) => { const id = el.getAttribute("data-node"); const h = el.offsetHeight; if (sizeRef.current[id] !== h) { sizeRef.current[id] = h; changed = true; } });
    if (changed) force((n) => n + 1);
  });

  const createTask = (n, date) => { if (onCreateTask) onCreateTask({ title: n.title || "Задача", note: n.note, checklist: n.checklist, date }); setTaskFor(null); setToast("Задача создана во вкладке «Задачи»"); };
  const sendToTask = (n) => {
    if (n.jobId && onOpenTask && onOpenTask(n.jobId)) return;
    if (!onCreateTask) return;
    const id = onCreateTask({ title: n.title || "Задача", note: n.note, checklist: n.checklist });
    if (id) { patchNode(n.id, { jobId: id }); setToast("Задача создана во вкладке «Задачи»"); }
  };
  const stop = (e) => e.stopPropagation();

  // ---- стрелки/связи ----
  const nh = (id) => sizeRef.current[id] || 92;
  const sideAnchor = (n, side) => { const h = nh(n.id); if (side === "top") return { x: n.x + W / 2, y: n.y }; if (side === "bottom") return { x: n.x + W / 2, y: n.y + h }; if (side === "left") return { x: n.x, y: n.y + h / 2 }; return { x: n.x + W, y: n.y + h / 2 }; };
  const ctrlOff = (p, side, k) => ({ x: p.x + (side === "left" ? -k : side === "right" ? k : 0), y: p.y + (side === "top" ? -k : side === "bottom" ? k : 0) });
  const pickSides = (a, b) => {
    if (tpl === "hierarchy") return ["bottom", "top"];
    if (tpl === "stages") { if (b.y > a.y + 8) return ["bottom", "left"]; const ax = a.x + W / 2, bx = b.x + W / 2; return bx >= ax ? ["right", "left"] : ["left", "right"]; }
    const ax = a.x + W / 2, bx = b.x + W / 2; return bx >= ax ? ["right", "left"] : ["left", "right"];
  };
  const edgePath = (a, b) => {
    const [sa, sb] = pickSides(a, b); const p1 = sideAnchor(a, sa), p2 = sideAnchor(b, sb);
    if (tpl === "stages" && sa === "bottom" && sb === "left") {
      // ёлочка: вертикальный ствол от низа этапа вниз, короткий отвод вправо к ребёнку
      const r = Math.min(7, Math.max(0, (p2.x - p1.x) / 2), Math.max(0, (p2.y - p1.y) / 2));
      return `M${p1.x},${p1.y} V${p2.y - r} Q ${p1.x},${p2.y} ${p1.x + r},${p2.y} H${p2.x}`;
    }
    const k = tpl === "hierarchy" ? 40 : 46; const c1 = ctrlOff(p1, sa, k), c2 = ctrlOff(p2, sb, k); return `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  };

  const counted = (n) => n.hasCheck !== false;
  const countTotal = nodes.filter(counted).length;
  const doneCount = nodes.filter((n) => counted(n) && nodeIsDone(n)).length;
  const todayISO = new Date().toISOString().slice(0, 10);
  const canUndo = histRef.current.past.length > 0, canRedo = histRef.current.future.length > 0;

  // мини-карта
  const mmW = 168, mmH = 116;
  const its = pnodes.map((n) => ({ x: n.x, y: n.y, w: W, h: nh(n.id) }));
  const bMinX = its.length ? Math.min(0, ...its.map((i) => i.x)) : 0;
  const bMinY = its.length ? Math.min(0, ...its.map((i) => i.y)) : 0;
  const bMaxX = its.length ? Math.max(800, ...its.map((i) => i.x + i.w)) : 800;
  const bMaxY = its.length ? Math.max(600, ...its.map((i) => i.y + i.h)) : 600;
  const mm = Math.min(mmW / (bMaxX - bMinX || 1), mmH / (bMaxY - bMinY || 1));
  const mmx = (x) => (x - bMinX) * mm, mmy = (y) => (y - bMinY) * mm;
  const vx = -view.tx / view.s, vy = -view.ty / view.s, vw = vpSize.w / view.s, vh = vpSize.h / view.s;
  const onMiniDown = (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); const wx = bMinX + (e.clientX - r.left) / mm, wy = bMinY + (e.clientY - r.top) / mm; setView((v) => ({ ...v, tx: vpSize.w / 2 - wx * v.s, ty: vpSize.h / 2 - wy * v.s })); };

  const tBtn = "flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50 disabled:opacity-30";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-100 px-3 py-2.5">
        <button onClick={() => { const ids = selRef.current; addChild(ids.length === 1 ? ids[0] : rootId); }} className="rounded-lg inline-flex items-center gap-1.5 bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800" title="Добавить дочерний блок к выбранному (или к корню). Tab"><Plus size={14} /> Подтема</button>
        <div className="mx-1 h-6 w-px bg-neutral-200" />
        <button onClick={() => actRef.current.undo()} disabled={!canUndo} className={tBtn} title="Отменить (Ctrl+Z)"><Undo2 size={15} /></button>
        <button onClick={() => actRef.current.redo()} disabled={!canRedo} className={tBtn} title="Повторить (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
        <div className="mx-1 h-6 w-px bg-neutral-200" />
        <button onClick={() => zoomBtn(1 / 1.2)} className={tBtn} title="Отдалить"><ZoomOut size={15} /></button>
        <span className="w-10 text-center text-xs font-semibold text-neutral-500">{Math.round(view.s * 100)}%</span>
        <button onClick={() => zoomBtn(1.2)} className={tBtn} title="Приблизить"><ZoomIn size={15} /></button>
        <button onClick={fitView} className={tBtn} title="Вписать в экран"><Maximize2 size={15} /></button>
      </div>

      <div ref={vpRef} onPointerDown={onBgDown} className="relative overflow-hidden" style={{ height: `calc(${zvh(100)} - 215px)`, minHeight: 360, touchAction: "none", cursor: "default", background: "#fafafa" }}>
        <div ref={contentElRef} style={{ position: "absolute", left: 0, top: 0, width: CW, height: CH, transformOrigin: "0 0", transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, backgroundImage: "radial-gradient(#e2e2e5 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
          <svg width={CW} height={CH} className="pointer-events-none absolute inset-0" style={{ zIndex: 2 }}>
            <defs><marker id="stratArr" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" fill="#94a3b8" /></marker></defs>
            {edges.map((ed) => {
              const a = byId[ed.from], b = byId[ed.to]; if (!a || !b) return null;
              // оба конца должны быть реально размещены (скрытые под свёрнутой веткой позиции не получают)
              if (!pos[ed.from] || !pos[ed.to]) return null;
              return <path key={ed.id} d={edgePath(a, b)} stroke="#cbd5e1" strokeWidth="1.8" fill="none" markerEnd={tpl === "process" ? "url(#stratArr)" : undefined} />;
            })}
          </svg>

          {pnodes.map((n) => {
            const hidden = (() => { let pe = parentEdge(n.id); let guard = 0; while (pe && guard++ < 999) { if (byId[pe.from]?.collapsed) return true; pe = parentEdge(pe.from); } return false; })();
            if (hidden) return null;
            const on = sel.includes(n.id); const isDrop = dropTarget === n.id; const cnt = n.hasCheck !== false; const done = nodeIsDone(n); const showDone = cnt && done; const hasCl = !!(n.checklist && n.checklist.length);
            const cdone = hasCl ? n.checklist.filter((c) => c.done).length : 0;
            const col = n.color || "#a3a3a3"; const kids = childCount(n.id); const isRoot = n.id === rootId;
            // заливка: тусклый тон цвета блока (серый — почти белый), выполненные — зелёные
            const fill = showDone ? "#f0fdf4" : hexTint(col, col === "#a3a3a3" ? 0.05 : 0.08);
            return (
              <div key={n.id} data-node={n.id} onPointerDown={(e) => onNodeDown(e, n)}
                className="group absolute select-none rounded-xl shadow-sm"
                style={{ left: n.x, top: n.y, width: W, cursor: isRoot ? "default" : "grab", border: `1.5px solid ${isDrop ? "#16a34a" : col}`, background: fill, boxShadow: isDrop ? "0 0 0 3px #16a34a55" : (on ? `0 0 0 2px ${col}40` : undefined), zIndex: on ? 6 : 3 }}>
                {n.image && (
                  <div className="group/img relative overflow-hidden rounded-t-[10px]" style={{ height: 110 }}>
                    <img src={n.image} alt="" className="h-full w-full object-cover" draggable={false} />
                    <button onPointerDown={stop} onClick={() => patchNode(n.id, { image: null })} className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition hover:bg-black/60 group-hover/img:opacity-100" title="Убрать картинку"><X size={12} /></button>
                    <button onPointerDown={stop} onClick={(e) => { e.stopPropagation(); setImgView(n.image); }} className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded bg-black/40 text-white opacity-0 transition hover:bg-black/60 group-hover/img:opacity-100" title="Открыть в полном размере"><Maximize2 size={11} /></button>
                  </div>
                )}
                <div className={"relative flex items-start gap-1.5 pt-2.5 pl-2.5 " + ((kids > 0 && n.collapsed) ? "pr-9" : "pr-2.5")}>
                  {cnt && (hasCl ? (
                    <span title="Прогресс по подзадачам" className="mt-0.5 flex shrink-0 items-center justify-center" style={{ width: 18, height: 18, borderRadius: 6, background: done ? "#16a34a" : "#fff", border: done ? "2px solid #16a34a" : "2px solid #d4d4d4", color: "#fff" }}>{done ? <Check size={12} strokeWidth={3} /> : (cdone > 0 && <Minus size={12} strokeWidth={3} style={{ color: "#a3a3a3" }} />)}</span>
                  ) : (
                    <button onPointerDown={stop} onClick={() => patchNode(n.id, { done: !n.done })} className="mt-0.5 flex shrink-0 items-center justify-center" style={{ width: 18, height: 18, borderRadius: 6, background: n.done ? "#16a34a" : "#fff", border: n.done ? "2px solid #16a34a" : "2px solid #d4d4d4", color: "#fff" }} title={n.done ? "Выполнено" : "Отметить"}>{n.done && <Check size={12} strokeWidth={3} />}</button>
                  ))}
                  <textarea value={n.title} rows={1} ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; if (focusRef.current === n.id) { focusRef.current = null; setTimeout(() => el.focus(), 0); } } }} onPointerDown={(e) => { e.stopPropagation(); setSel([n.id]); }} onFocus={pushHist} onChange={(e) => patchLive(n.id, { title: e.target.value })} onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }} placeholder={isRoot ? "Тема…" : "Блок…"} className="min-w-0 flex-1 resize-none overflow-hidden break-words bg-transparent text-sm font-semibold leading-snug text-neutral-800 focus:outline-none" style={showDone ? { textDecoration: "line-through", color: "#737373" } : undefined} />
                  <div className="absolute right-1.5 top-1.5 flex items-start gap-0.5">
                    {kids > 0 && (
                      <button onPointerDown={stop} onClick={() => toggleCollapse(n.id)} title={n.collapsed ? "Развернуть ветку" : "Свернуть ветку"} style={{ background: fill }} className={"flex h-6 items-center gap-0.5 rounded px-1 text-[10px] font-bold text-neutral-400 transition hover:text-neutral-600 " + (n.collapsed ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>{n.collapsed ? <><ChevronRight size={13} />{kids}</> : <ChevronDown size={13} />}</button>
                    )}
                    <button onPointerDown={stop} onClick={() => addChild(n.id)} title="Добавить дочерний блок (Tab)" style={{ background: fill }} className={"flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 transition hover:text-neutral-700 " + (on ? "opacity-100" : "opacity-0 group-hover:opacity-100")}><Plus size={14} /></button>
                    <button onPointerDown={stop} onClick={() => { setSel([n.id]); setSettingsFor(settingsFor === n.id ? null : n.id); setTaskFor(null); }} title="Настройки блока" style={{ background: fill }} className={"flex h-6 w-6 shrink-0 items-center justify-center rounded transition hover:text-neutral-700 " + (settingsFor === n.id ? "text-neutral-700 opacity-100" : (on ? "text-neutral-400 opacity-100" : "text-neutral-400 opacity-0 group-hover:opacity-100"))}><Settings2 size={14} /></button>
                  </div>
                </div>

                {hasCl && (
                  <div className="mt-1 flex items-center gap-1.5 px-2.5">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full" style={{ width: `${Math.round((cdone / n.checklist.length) * 100)}%`, background: done ? "#16a34a" : col }} /></div>
                    <span className="text-[10px] font-semibold text-neutral-400">{cdone}/{n.checklist.length}</span>
                  </div>
                )}

                {settingsFor !== n.id && <div style={{ height: 10 }} />}

                {settingsFor === n.id && (
                  <div className="border-t border-neutral-100">
                    <textarea value={n.note || ""} onPointerDown={stop} onFocus={pushHist} onChange={(e) => patchLive(n.id, { note: e.target.value })} placeholder="заметка…" rows={2} className="w-full resize-none bg-transparent px-2.5 pt-2 pb-1 text-[11px] leading-snug text-neutral-500 focus:outline-none" />
                    <div className="flex flex-wrap items-center gap-1 border-t border-neutral-100 px-2.5 py-1.5">
                      {SWATCHES.map((c) => (<button key={c} onPointerDown={stop} onClick={() => patchNode(n.id, { color: c })} className="h-4 w-4 rounded-full transition" style={{ background: c, boxShadow: n.color === c ? `0 0 0 2px #fff, 0 0 0 3.5px ${c}` : "none" }} />))}
                    </div>
                    {/* строка действий: картинка · чекбокс · дубль/удалить */}
                    <div className="flex items-center gap-1.5 border-t border-neutral-100 px-2.5 py-1.5">
                      {n.image ? (
                        <span className="group/im relative inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-md border border-neutral-200" title="Картинка">
                          <img src={n.image} alt="" className="h-full w-full object-cover" />
                          <button onPointerDown={stop} onClick={() => patchNode(n.id, { image: null })} className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition group-hover/im:opacity-100" title="Убрать картинку"><X size={12} /></button>
                        </span>
                      ) : (
                        <label onPointerDown={stop} className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-neutral-200 text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-700" title="Прикрепить картинку"><ImagePlus size={14} /><input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) attachImage(n.id, f); e.target.value = ""; }} /></label>
                      )}
                      <button onPointerDown={stop} onClick={() => patchNode(n.id, { hasCheck: !cnt })} title={cnt ? "Убрать чекбокс выполнения" : "Добавить чекбокс выполнения"} className={"inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition " + (cnt ? "border-green-200 bg-green-50" : "border-neutral-200 hover:bg-neutral-50")}>
                        <span className="flex h-4 w-4 items-center justify-center rounded" style={{ background: cnt ? "#16a34a" : "#fff", border: cnt ? "2px solid #16a34a" : "2px solid #d4d4d4", color: "#fff" }}>{cnt && <Check size={10} strokeWidth={3} />}</span>
                      </button>
                      {cnt && (
                        <button onPointerDown={stop} onClick={() => sendToTask(n)} title={n.jobId ? "Перейти к задаче" : "Перенести в Задачи"} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-600 transition hover:bg-sky-100">
                          {n.jobId ? <ExternalLink size={14} /> : (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 12H3" /><path d="M16 6H3" /><path d="M16 18H3" /><path d="m17 10 4 4-4 4" /></svg>)}
                        </button>
                      )}
                      {!isRoot && (
                        <span className="ml-auto flex items-center gap-1">
                          <button onPointerDown={stop} onClick={() => duplicateNode(n.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" title="Дублировать блок"><Copy size={13} /></button>
                          <button onPointerDown={stop} onClick={() => removeSubtree(n.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-500" title="Удалить блок и ветку"><Trash2 size={13} /></button>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {pnodes.length > 0 && (
          <div onPointerDown={onMiniDown} className="absolute bottom-3 right-3 cursor-pointer overflow-hidden rounded-lg border border-neutral-200 bg-white/90 shadow-sm" style={{ width: mmW, height: mmH }} title="Клик — перейти">
            <svg width={mmW} height={mmH}>
              {pnodes.map((n) => <rect key={n.id} x={mmx(n.x)} y={mmy(n.y)} width={W * mm} height={Math.max(3, nh(n.id) * mm)} rx="1.5" fill={nodeIsDone(n) ? "#16a34a" : (n.color || "#94a3b8")} opacity="0.85" />)}
              <rect x={mmx(vx)} y={mmy(vy)} width={vw * mm} height={vh * mm} fill="none" stroke="#111827" strokeWidth="1" />
            </svg>
          </div>
        )}

        {imgView && (
          <div onPointerDown={(e) => { e.stopPropagation(); setImgView(null); }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-6" title="Закрыть">
            <img src={imgView} alt="" onPointerDown={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" draggable={false} />
            <button onPointerDown={(e) => { e.stopPropagation(); setImgView(null); }} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/30" title="Закрыть (Esc)"><X size={18} /></button>
          </div>
        )}

        {toast && <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">{toast}</div>}
      </div>
    </div>
  );
}

function SettingsModal({ tgLinks = {}, tgBot = "", saveTgBot, myProfileId = null, statuses, setStatuses, defaultTasks, setDefaultTasks, taskLabels, setTaskLabels, taskTags, setTaskTags, taskTriggers = [], setTaskTriggers, cycleTriggers = [], setCycleTriggers, opTypes, setOpTypes, subjects, setSubjects, prodCycle, setProdCycle, taskPeople = [], unitConst, setUnitConst, initialTab, navCfg, setNavCfg, mq, setMq, uiZoom, setUiZoom, wbApiKey, setWbApiKey, onFetchWb, wbAdKey, setWbAdKey, onFetchAd, adLoading, adMsg, ozCfg = {}, setOzCfg, onFetchOz, ozLoading = false, ozMsg = "", msCfg = {}, setMsCfg, onFetchMs, msLoading = false, msMsg = "", msData = null, onClose }) {
  const [tab, setTab] = useState(() => (initialTab === "wbapi" || initialTab === "oz" || initialTab === "tg" ? "integr" : initialTab || "statuses"));
  const [intg, setIntg] = useState(() => (initialTab === "oz" ? "oz" : initialTab === "tg" ? "tg" : "wb")); // раздел «Интеграции»: wb | oz | tg
  const [trgOpen, setTrgOpen] = useState({}); // какие правила триггеров раскрыты
  const toggleTrgOpen = (id) => setTrgOpen((o) => ({ ...o, [id]: !o[id] }));

  // --- производственный цикл ---
  const cycStages = (prodCycle && Array.isArray(prodCycle.stages)) ? prodCycle.stages : [];
  const setCyc = (stages) => setProdCycle({ ...prodCycle, stages });
  const cyclesList = (prodCycle && Array.isArray(prodCycle.cycles)) ? prodCycle.cycles : [];
  const [cycSel, setCycSel] = useState(null);
  const [libName, setLibName] = useState("");
  const curCycle = cyclesList.find((c) => c.id === cycSel) || cyclesList[0] || null;
  const setCycles = (cs) => setProdCycle({ ...prodCycle, cycles: cs });
  const patchCycle = (id, p) => setCycles(cyclesList.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const addCycle = () => { const id = uid(); setCycles([...cyclesList, { id, name: "Новый цикл", stages: [] }]); setCycSel(id); };
  const removeCycle = (id) => { if (cyclesList.length <= 1) { alert("Должен остаться хотя бы один цикл."); return; } const c = cyclesList.find((x) => x.id === id); if (!c || !window.confirm(`Удалить цикл «${c.name}»? Уже запущенные партии не изменятся.`)) return; setCycles(cyclesList.filter((x) => x.id !== id)); setCycSel(null); };
  const addToCycle = (L) => { if (!curCycle || curCycle.stages.some((x) => x.id === L.id)) return; patchCycle(curCycle.id, { stages: [...curCycle.stages, { id: L.id, days: Math.max(0, parseInt(L.days) || 1) }] }); };
  const rmFromCycle = (sid) => curCycle && patchCycle(curCycle.id, { stages: curCycle.stages.filter((x) => x.id !== sid) });
  const moveInCycle = (sid, dir) => { if (!curCycle) return; const a = curCycle.stages.slice(); const i = a.findIndex((x) => x.id === sid); const j = i + dir; if (i < 0 || j < 0 || j >= a.length) return; const [x] = a.splice(i, 1); a.splice(j, 0, x); patchCycle(curCycle.id, { stages: a }); };
  const setCycleDays = (sid, v) => curCycle && patchCycle(curCycle.id, { stages: curCycle.stages.map((x) => (x.id === sid ? { ...x, days: Math.max(0, parseInt(v) || 0) } : x)) });
  const renameLib = (id, name) => setCyc(cycStages.map((x) => (x.id === id ? { ...x, name } : x)));
  const addLib = () => { const name = libName.trim(); if (!name) return; setCyc([...cycStages, { id: uid(), name, days: 5, task: { enabled: false, text: "", scope: "batch", when: "enter", priority: null, assignee: null } }]); setLibName(""); };
  const stageInCycles = (id) => cyclesList.filter((c) => c.stages.some((x) => x.id === id)).length;
  const stageTrgCount = (id) => (cycleTriggers || []).filter((r) => r.stageId === id).length;
  const removeLib = (id) => { if (stageInCycles(id) || stageTrgCount(id)) { alert("Этап используется в цикле или в правиле триггера — сначала уберите его оттуда."); return; } setCyc(cycStages.filter((x) => x.id !== id)); };
  const patchCycStage = (id, p) => setCyc(cycStages.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const addCycStage = () => setCyc([...cycStages, { id: uid(), name: "Новый этап", days: 1, task: { enabled: false, text: "", scope: "batch", when: "enter", priority: null, assignee: null } }]);
  const removeCycStage = (id) => setCyc(cycStages.filter((s) => s.id !== id));
  const moveCycStage = (id, dir) => { const i = cycStages.findIndex((s) => s.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= cycStages.length) return; const a = cycStages.slice(); const [x] = a.splice(i, 1); a.splice(j, 0, x); setCyc(a); };

  // --- задачи по триггерам (смена статуса товара) ---
  // новое правило создаётся ВЫКЛЮЧЕННЫМ и РАСКРЫТЫМ — сначала настроить, потом включить тумблер (иначе срабатывает на дефолтах)
  const addTrigger = () => { const id = uid(); setTaskTriggers((list) => [...(list || []), { id, enabled: false, statusName: (statuses[0] && statuses[0].name) || "", text: "", taskType: "product", assignee: null, priority: "low", hasDate: false, durDays: 1 }]); setTrgOpen((o) => ({ ...o, [id]: true })); };
  const patchTrigger = (id, p) => setTaskTriggers((list) => (list || []).map((r) => (r.id === id ? { ...r, ...p } : r)));
  const removeTrigger = (id) => setTaskTriggers((list) => (list || []).filter((r) => r.id !== id));

  // --- задачи по триггерам (этап партии / произв. цикл) ---
  // новое правило создаётся ВЫКЛЮЧЕННЫМ и РАСКРЫТЫМ
  const addCycleTrigger = () => { const id = uid(); setCycleTriggers((list) => [...(list || []), { id, enabled: false, stageId: (cycStages[0] && cycStages[0].id) || "", when: "enter", scope: "product", text: "", priority: "low", assignee: null, hasDate: false, dateFrom: "start", durDays: 1 }]); setTrgOpen((o) => ({ ...o, [id]: true })); };
  const patchCycleTrigger = (id, p) => setCycleTriggers((list) => (list || []).map((r) => (r.id === id ? { ...r, ...p } : r)));
  const removeCycleTrigger = (id) => setCycleTriggers((list) => (list || []).filter((r) => r.id !== id));
  // сводка-чип и имена для свёрнутых строк правил
  const trgChip = (txt, bg, color) => <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: bg, color }}>{txt}</span>;
  const personName = (id) => (taskPeople || []).find((p) => p.id === id)?.name;
  const stageName = (id) => (cycStages.find((s) => s.id === id) || {}).name || "этап";
  const allRuleIds = [...(taskTriggers || []).map((r) => r.id), ...(cycleTriggers || []).map((r) => r.id)];
  const anyTrgOpen = allRuleIds.some((id) => trgOpen[id]);
  const toggleAllTrg = () => { if (anyTrgOpen) setTrgOpen({}); else setTrgOpen(Object.fromEntries(allRuleIds.map((id) => [id, true]))); };

  // --- предметы и комиссии ВБ (загрузка таблицей, опора на FBW) ---
  const [subjName, setSubjName] = useState("");
  const [subjSearch, setSubjSearch] = useState("");
  const [subjBusy, setSubjBusy] = useState(false);
  const [subjErr, setSubjErr] = useState("");
  const subjFileRef = useRef(null);
  const onCommFile = async (file) => {
    if (!file) return;
    setSubjBusy(true); setSubjErr("");
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parseCommissionsXlsx(buf);
      setSubjects(parsed);
    } catch (e) {
      setSubjErr(e?.message || "Не удалось обработать файл.");
    } finally {
      setSubjBusy(false);
      if (subjFileRef.current) subjFileRef.current.value = "";
    }
  };
  const addSubject = () => {
    const t = subjName.trim();
    if (!t || (subjects || []).some((s) => s.name === t)) return;
    setSubjects((list) => [{ id: uid(), name: t, commission: "" }, ...(list || [])]);
    setSubjName("");
  };
  const setSubjectName = (id, name) => setSubjects((list) => (list || []).map((x) => (x.id === id ? { ...x, name } : x)));
  const setSubjectComm = (id, commission) => setSubjects((list) => (list || []).map((x) => (x.id === id ? { ...x, commission } : x)));
  const removeSubject = (id) => setSubjects((list) => (list || []).filter((x) => x.id !== id));
  const subjQuery = subjSearch.trim().toLowerCase();
  const subjMatches = subjQuery
    ? (subjects || []).filter((s) => (s.name || "").toLowerCase().includes(subjQuery)).slice(0, 60)
    : (subjects || []).slice(0, 12);

  // --- операционные задачи (регулярные строки Ганта) ---
  const [opName, setOpName] = useState("");
  const [opOpen, setOpOpen] = useState(null); // id раскрытой задачи
  const addOpType = () => {
    const t = opName.trim();
    if (!t || (opTypes || []).some((o) => o.name === t)) return;
    const id = uid();
    setOpTypes((list) => [...(list || []), { id, name: t, recur: { mode: "weekly", weekdays: [1, 2, 3, 4, 5], ordinal: 1, weekday: 1 } }]);
    setOpName("");
    setOpOpen(id);
  };
  const setOpTypeName = (id, name) => setOpTypes((list) => (list || []).map((x) => (x.id === id ? { ...x, name } : x)));
  const setOpTypeRecur = (id, recur) => setOpTypes((list) => (list || []).map((x) => (x.id === id ? { ...x, recur } : x)));
  const removeOpType = (id) => setOpTypes((list) => (list || []).filter((x) => x.id !== id));

  // --- статусы ---
  const [sName, setSName] = useState("");
  const [sColor, setSColor] = useState(SWATCHES[0]);
  const addStatus = () => {
    const trimmed = sName.trim();
    if (!trimmed || statuses.some((s) => s.name === trimmed)) return;
    setStatuses((s) => [...s, { name: trimmed, color: sColor }]);
    setSName("");
  };
  const removeStatus = (n) => setStatuses((s) => s.filter((x) => x.name !== n));

  // --- задачи по умолчанию ---
  const [tText, setTText] = useState("");
  const addDefault = () => {
    const t = tText.trim();
    if (!t) return;
    setDefaultTasks((list) => [...(list || []), { id: uid(), text: t }]);
    setTText("");
  };
  const setDefaultText = (id, text) => setDefaultTasks((list) => (list || []).map((x) => (x.id === id ? { ...x, text } : x)));
  const setDefaultLabel = (id, labelId) => setDefaultTasks((list) => (list || []).map((x) => (x.id === id ? { ...x, labelId } : x)));
  const removeDefault = (id) => setDefaultTasks((list) => (list || []).filter((x) => x.id !== id));

  // --- метки ---
  const [lName, setLName] = useState("");
  const [lColor, setLColor] = useState(SWATCHES[0]);
  const addLabel = () => {
    const trimmed = lName.trim();
    if (!trimmed || (taskLabels || []).some((l) => l.name === trimmed)) return;
    setTaskLabels((list) => [...(list || []), { id: uid(), name: trimmed, color: lColor }]);
    setLName("");
  };
  const removeLabel = (id) => setTaskLabels((list) => (list || []).filter((x) => x.id !== id));
  const [tgName, setTgName] = useState("");
  const [tgColor, setTgColor] = useState(SWATCHES[0]);
  const addTag = () => { const t = tgName.trim(); if (!t || (taskTags || []).some((x) => x.name === t)) return; setTaskTags((list) => [...(list || []), { id: uid(), name: t, color: tgColor }]); setTgName(""); };
  const removeTag = (id) => setTaskTags((list) => (list || []).filter((x) => x.id !== id));

  const TabBtn = ({ id, children }) => (
    <button
      onClick={() => setTab(id)}
      className={"rounded-lg px-3 py-1.5 text-sm font-medium transition " + (tab === id ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100")}
    >
      {children}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      <div className={"rounded-2xl flex w-full flex-col overflow-hidden bg-white shadow-xl transition-[max-width] " + ((tab === "triggers" || tab === "cycles" || tab === "integr") ? "max-w-4xl" : "max-w-lg")} style={{ maxHeight: zvh(85) }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-neutral-900"><Settings2 size={18} /> Настройки</h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-neutral-100 px-5 py-2.5">
          <TabBtn id="statuses">Статусы</TabBtn>
          <TabBtn id="nav">Вид</TabBtn>
          <TabBtn id="triggers">Задачи по триггерам</TabBtn>
          <TabBtn id="cycles">Циклы</TabBtn>
          <TabBtn id="subjects">Комиссии ВБ</TabBtn>
          <TabBtn id="unit">Единые данные</TabBtn>
          <TabBtn id="integr">Интеграции</TabBtn>
        </div>

        <div className={"flex-1 overflow-auto " + (tab === "integr" ? "flex p-0" : "p-5")}>
          {tab === "integr" && (() => {
            const tgN = taskPeople.filter((x) => tgLinks[x.id]).length;
            const wbN = (wbApiKey ? 1 : 0) + (wbAdKey ? 1 : 0), ozN = (ozCfg.clientId && ozCfg.apiKey ? 1 : 0) + (ozCfg.perfId && ozCfg.perfSecret ? 1 : 0);
            const items = [
              { id: "wb", short: "WB", name: "Wildberries", bg: "linear-gradient(135deg,#cb11ab,#481173)", badge: wbN ? wbN + " " + (wbN === 1 ? "ключ" : "ключа") : "не подключено", ok: wbN > 0 },
              { id: "oz", short: "Oz", name: "Озон", bg: "#005bff", badge: ozN ? ozN + " " + (ozN === 1 ? "ключ" : "ключа") : "не подключено", ok: ozN > 0 },
              { id: "ms", short: "МС", name: "МойСклад", bg: "#16a34a", badge: msCfg.token ? "подключено" : "не подключено", ok: !!msCfg.token },
              { id: "tg", short: "TG", name: "Telegram", bg: "#2481cc", badge: tgN + " из " + taskPeople.length, ok: tgN > 0, warn: tgN < taskPeople.length },
            ];
            return (
              <div className="w-[260px] shrink-0 border-r border-neutral-100 bg-neutral-50 p-4">
                <div className="mb-2.5 px-1.5 text-[11px] font-extrabold tracking-wider text-neutral-400">ИНТЕГРАЦИИ</div>
                {items.map((it) => (
                  <button key={it.id} onClick={() => setIntg(it.id)} className={"mb-1.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition " + (intg === it.id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:bg-white/60")}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-extrabold text-white" style={{ background: it.bg }}>{it.short}</span>
                    <span className="min-w-0 flex-1 truncate">{it.name}</span>
                    <span className={"rounded-full px-2 py-0.5 text-[11px] font-extrabold " + (it.ok ? (it.warn ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700") : "bg-neutral-200 text-neutral-500")}>{it.badge}</span>
                  </button>
                ))}
                {[["ЯМ", "Яндекс Маркет", "#f59e0b"]].map(([sh, nm, bg]) => (
                  <div key={sh} className="mb-1.5 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-neutral-400 opacity-70">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-extrabold text-white" style={{ background: bg }}>{sh}</span>
                    <span className="min-w-0 flex-1 truncate">{nm}</span>
                    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-extrabold text-neutral-500">скоро</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <div className={tab === "integr" ? "min-w-0 flex-1 overflow-auto p-6" : ""}>
          {tab === "integr" && (() => {
            const M = { wb: ["Wildberries", "Заказы, выкупы, остатки, в пути и реклама. Данные попадают в РНП и сводку.", "linear-gradient(135deg,#cb11ab,#481173)", "WB"], oz: ["Озон", "Заказы, остатки, возвраты и реклама (Performance). Данные попадают в сводку.", "#005bff", "Oz"], tg: ["Telegram-бот", "Поручения, напоминания о сроках и создание задач из чата.", "#2481cc", "TG"], ms: ["МойСклад", "Остатки по складам и размерам, себестоимость. Основа для плитки «Остатки» и агента по остаткам.", "#16a34a", "МС"] }[intg];
            return (
              <div className="mb-5 flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold text-white" style={{ background: M[2] }}>{M[3]}</span>
                <div><h3 className="text-xl font-extrabold text-neutral-900">{M[0]}</h3><p className="text-[13px] text-neutral-500">{M[1]}</p></div>
              </div>
            );
          })()}
          {tab === "nav" && (() => {
            const ord = (navCfg.order || []).filter((id) => TABS.some((t) => t.id === id));
            const list = [...ord, ...TABS.map((t) => t.id).filter((id) => !ord.includes(id))].map((id) => TABS.find((t) => t.id === id));
            const hid = navCfg.hidden || {};
            const shown = list.filter((t) => !hid[t.id]).length;
            const setOrder = (ids) => setNavCfg((c) => ({ ...c, order: ids }));
            const move = (id, d) => { const ids = list.map((t) => t.id); const i = ids.indexOf(id), j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; setOrder(ids); };
            return (
              <>
                <h3 className="text-sm font-bold text-neutral-900">Масштаб интерфейса</h3>
                <p className="mb-2 text-xs text-neutral-500">Личная настройка. Если вы уже уменьшали масштаб в браузере, поставьте 100%.</p>
                <div className="mb-5 inline-flex rounded-xl border border-neutral-200 bg-white p-1">
                  {[0.7, 0.8, 0.9, 1].map((z) => <button key={z} onClick={() => setUiZoom(z)} className={"rounded-lg px-3.5 py-1.5 text-sm font-semibold transition " + (uiZoom === z ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100")}>{Math.round(z * 100)}%</button>)}
                </div>
                <h3 className="text-sm font-bold text-neutral-900">Бегущая строка с мотивацией</h3>
                <p className="mb-2 text-xs text-neutral-500">Личная настройка, показывается в самой верхней строке рядом с логотипом. Каждая фраза с новой строки. Если поле пустое, остаётся один логотип.</p>
                <textarea value={mq?.text || ""} onChange={(e) => setMq((m) => ({ ...m, text: e.target.value }))} rows={4} className="w-full max-w-xl rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400" placeholder="Работаем, братья!" />
                <div className="mb-5 mt-2 flex flex-wrap items-center gap-3 text-sm text-neutral-700">
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!mq?.on} onChange={(e) => setMq((m) => ({ ...m, on: e.target.checked }))} />Показывать строку</label>
                  <span className="ml-3 text-neutral-500">Скорость</span>
                  <div className="inline-flex rounded-xl border border-neutral-200 bg-white p-1">
                    {[[1, "медленно"], [2, "средне"], [3, "быстро"]].map(([v, l]) => <button key={v} onClick={() => setMq((m) => ({ ...m, speed: v }))} className={"rounded-lg px-3 py-1 text-xs font-semibold transition " + (mq?.speed === v ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100")}>{l}</button>)}
                  </div>
                </div>
                <h3 className="text-sm font-bold text-neutral-900">Быстрый доступ к блокам</h3>
                <p className="mb-3 text-xs text-neutral-500">Выбранные блоки — на верхней панели, остальные — в меню «⋯». Настройка личная, на других пользователей не влияет.</p>
                <div>
                  {list.map((t, i) => (
                    <div key={t.id} className="flex items-center gap-2.5 border-t border-neutral-100 py-2 first:border-t-0">
                      <div className="flex flex-col"><button onClick={() => move(t.id, -1)} disabled={i === 0} className="text-[9px] leading-none text-neutral-400 hover:text-neutral-800 disabled:opacity-20">▲</button><button onClick={() => move(t.id, 1)} disabled={i === list.length - 1} className="text-[9px] leading-none text-neutral-400 hover:text-neutral-800 disabled:opacity-20">▼</button></div>
                      <span className="flex-1 text-sm font-semibold text-neutral-800">{t.label}</span>
                      <button onClick={() => setNavCfg((c) => ({ ...c, hidden: { ...(c.hidden || {}), [t.id]: !hid[t.id] } }))} className={"relative h-[21px] w-9 shrink-0 rounded-full transition " + (hid[t.id] ? "bg-neutral-300" : "bg-neutral-900")}><span className={"absolute top-[2px] h-[17px] w-[17px] rounded-full bg-white shadow transition-all " + (hid[t.id] ? "left-[2px]" : "left-[17px]")} /></button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center text-xs text-neutral-500">В быстром доступе: {shown} из {list.length}<button onClick={() => setNavCfg({ order: [], hidden: {} })} className="ml-auto font-bold text-blue-600 hover:underline">Сбросить — показать все</button></div>
              </>
            );
          })()}
          {tab === "statuses" && (
            <>
              <div className="mb-4 space-y-1.5">
                {statuses.map((s) => (
                  <div key={s.name} className="flex items-center justify-between rounded-lg border border-neutral-100 px-3 py-2">
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-neutral-700">
                      <span className="rounded-full h-3 w-3" style={{ background: s.color }} />
                      {s.name}
                    </span>
                    <button onClick={() => removeStatus(s.name)} className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить статус"><Trash2 size={15} /></button>
                  </div>
                ))}
                {statuses.length === 0 && <p className="py-2 text-center text-sm text-neutral-400">Нет статусов</p>}
              </div>

              <div className="rounded-xl bg-neutral-50 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">Новый статус</p>
                <div className="flex items-center gap-2">
                  <input value={sName} onChange={(e) => setSName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStatus()} placeholder="Например: Под заказ" className="rounded-lg flex-1 border border-neutral-200 px-3 py-1.5 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
                  <button onClick={addStatus} className="rounded-md inline-flex items-center gap-1 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"><Plus size={15} /> Добавить</button>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  {SWATCHES.map((c) => (
                    <button key={c} onClick={() => setSColor(c)} className="h-6 w-6 rounded transition" style={{ background: c, boxShadow: sColor === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : "none" }} />
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === "ops" && (
            <>
              <p className="mb-3 text-xs text-neutral-400">Регулярные задачи — строки в Ганте блока «Задачи». У каждой свой график повтора (дни недели или порядковый день месяца); в эти дни появляется чек-бокс выполнения.</p>
              <div className="mb-4 space-y-1.5">
                {(opTypes || []).map((o) => {
                  const open = opOpen === o.id;
                  return (
                    <div key={o.id} className="rounded-lg border border-neutral-100 hover:border-neutral-200">
                      <div className="group flex items-center gap-2 px-2 py-2">
                        <button onClick={() => setOpOpen(open ? null : o.id)} className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-100" title={open ? "Свернуть" : "График"}>
                          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <input
                            value={o.name}
                            onChange={(e) => setOpTypeName(o.id, e.target.value)}
                            className="w-full bg-transparent text-sm text-neutral-800 focus:outline-none"
                          />
                          <div className="truncate text-[11px] text-neutral-400">{describeRecur(o.recur)}</div>
                        </div>
                        <button onClick={() => removeOpType(o.id)} className="shrink-0 rounded p-0.5 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100" title="Удалить"><Trash2 size={14} /></button>
                      </div>
                      {open && (
                        <div className="border-t border-neutral-100 bg-neutral-50/50 px-3 py-3">
                          <RecurEditor recur={o.recur} onChange={(r) => setOpTypeRecur(o.id, r)} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {(!opTypes || opTypes.length === 0) && <p className="py-2 text-center text-sm text-neutral-400">Операционных задач пока нет</p>}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={opName}
                  onChange={(e) => setOpName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addOpType()}
                  placeholder="Новая операционная задача…"
                  className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
                <button onClick={addOpType} disabled={!opName.trim()} className="rounded-lg inline-flex items-center gap-1 bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40">
                  <Plus size={14} /> Добавить
                </button>
              </div>
            </>
          )}

          {tab === "triggers" && (
            <>
              <div className="mb-3 flex items-center gap-2">
                <p className="text-xs text-neutral-500">Когда срабатывает триггер — автоматически создаётся задача в разделе «Задачи». Создаётся один раз на событие.</p>
                {allRuleIds.length > 0 && <button onClick={toggleAllTrg} className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-500 hover:bg-neutral-50">{anyTrgOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{anyTrgOpen ? "Свернуть все" : "Развернуть все"}</button>}
              </div>

              {/* — Триггер: смена статуса товара — */}
              <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-indigo-500"><span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-indigo-50 text-indigo-600"><Flag size={12} /></span> Смена статуса товара</div>
              <div className="space-y-2.5">
                {(taskTriggers || []).map((r) => { const open = !!trgOpen[r.id]; const pr = PRIORITIES[r.priority]; const asg = personName(r.assignee); return (
                  <div key={r.id} className={"overflow-hidden rounded-xl border " + (open ? "border-neutral-300" : "border-neutral-200")}>
                    {/* свёрнутая строка */}
                    <div className={"flex items-center gap-2.5 px-3 py-2.5 " + (open ? "border-b border-neutral-100 bg-neutral-50/70" : "")}>
                      <button onClick={() => toggleTrgOpen(r.id)} className="shrink-0 text-neutral-300 hover:text-neutral-600" title={open ? "Свернуть" : "Настроить"}><ChevronRight size={14} className={"transition " + (open ? "rotate-90" : "")} /></button>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.enabled ? "#6366f1" : "#cbd5e1" }} />
                      <button onClick={() => toggleTrgOpen(r.id)} className="min-w-0 flex-1 text-left">
                        <div className={"truncate text-sm font-medium " + (r.text ? "text-neutral-800" : "text-neutral-400")}>{r.text || "Новое правило"}</div>
                        <div className="truncate text-[11px] text-neutral-400">когда статус → <b className="font-semibold text-neutral-500">«{r.statusName || "—"}»</b></div>
                      </button>
                      <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                        {trgChip(r.taskType === "project" ? "проектная" : "по товару", r.taskType === "project" ? "#f5f3ff" : "#fff7ed", r.taskType === "project" ? "#6d28d9" : "#c2410c")}
                        {pr && trgChip(pr.label, pr.bg, pr.color)}
                        {asg && trgChip(asg, "#eef2ff", "#4f46e5")}
                      </div>
                      <button onClick={() => patchTrigger(r.id, { enabled: !r.enabled })} className="relative h-[20px] w-[34px] shrink-0 rounded-full transition" style={{ background: r.enabled ? "#16a34a" : "#d4d4d8" }} title={r.enabled ? "Включено" : "Выключено"}><span className="absolute top-0.5 h-[16px] w-[16px] rounded-full bg-white shadow transition-all" style={{ left: r.enabled ? 16 : 2 }} /></button>
                      <button onClick={() => removeTrigger(r.id)} className="shrink-0 rounded-md p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить правило"><Trash2 size={14} /></button>
                    </div>
                    {/* раскрытые настройки */}
                    {open && (
                    <div className="space-y-2.5 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-neutral-600">Когда статус становится</span>
                        <select value={r.statusName} onChange={(e) => patchTrigger(r.id, { statusName: e.target.value })} className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none">
                          {(statuses || []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                          {!(statuses || []).some((s) => s.name === r.statusName) && r.statusName && <option value={r.statusName}>{r.statusName}</option>}
                        </select>
                      </div>
                      <div>
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Текст задачи · {"{товар}"} подставит название</div>
                        <input value={r.text} onChange={(e) => patchTrigger(r.id, { text: e.target.value })} placeholder="Напр.: Проверить карточку после запуска · {товар}" className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm focus:border-neutral-400 focus:outline-none" />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-600">
                        <label className="inline-flex items-center gap-1.5">тип:
                          <select value={r.taskType || "product"} onChange={(e) => patchTrigger(r.id, { taskType: e.target.value })} className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 focus:outline-none"><option value="product">Товар</option><option value="project">Проектная</option></select>
                        </label>
                        <label className="inline-flex items-center gap-1.5">приоритет:
                          <select value={r.priority || "low"} onChange={(e) => patchTrigger(r.id, { priority: e.target.value })} className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 focus:outline-none">{Object.keys(PRIORITIES).map((k) => <option key={k} value={k}>{PRIORITIES[k].label}</option>)}</select>
                        </label>
                        <label className="inline-flex items-center gap-1.5">исполнитель:
                          <select value={r.assignee || ""} onChange={(e) => patchTrigger(r.id, { assignee: e.target.value || null })} className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 focus:outline-none"><option value="">—</option>{(taskPeople || []).map((pp) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}</select>
                        </label>
                        <label className="inline-flex items-center gap-1.5">дата:
                          <select value={r.hasDate ? "date" : "none"} onChange={(e) => patchTrigger(r.id, { hasDate: e.target.value === "date" })} className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 focus:outline-none" title="Старт задачи = день смены статуса, дедлайн = старт + длительность"><option value="none">без даты</option><option value="date">от события</option></select>
                        </label>
                        {r.hasDate && (
                          <label className="inline-flex items-center gap-1.5">длительность:
                            <input value={r.durDays} onChange={(e) => patchTrigger(r.id, { durDays: Math.max(1, parseInt(e.target.value) || 1) })} inputMode="numeric" className="w-12 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-center focus:outline-none" /> дн.
                          </label>
                        )}
                      </div>
                    </div>
                    )}
                  </div>
                ); })}
                {(!taskTriggers || taskTriggers.length === 0) && <p className="py-2 text-center text-sm text-neutral-400">Правил по статусу пока нет</p>}
              </div>
              <button onClick={addTrigger} className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:border-indigo-400 hover:text-indigo-700"><Plus size={14} /> Добавить правило</button>

              {/* — Триггер: этап производственного цикла (плоский список, несколько правил на этап) — */}
              <div className="mb-2 mt-6 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-amber-600"><span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-amber-50 text-amber-600"><Repeat size={12} /></span> Этап партии (произв. цикл)</div>
              <div className="space-y-2.5">
                {(cycleTriggers || []).map((r) => { const open = !!trgOpen[r.id]; const pr = PRIORITIES[r.priority]; const asg = personName(r.assignee); return (
                  <div key={r.id} className={"overflow-hidden rounded-xl border " + (open ? "border-neutral-300" : "border-neutral-200")}>
                    {/* свёрнутая строка */}
                    <div className={"flex items-center gap-2.5 px-3 py-2.5 " + (open ? "border-b border-neutral-100 bg-neutral-50/70" : "")}>
                      <button onClick={() => toggleTrgOpen(r.id)} className="shrink-0 text-neutral-300 hover:text-neutral-600" title={open ? "Свернуть" : "Настроить"}><ChevronRight size={14} className={"transition " + (open ? "rotate-90" : "")} /></button>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.enabled ? "#f59e0b" : "#cbd5e1" }} />
                      <button onClick={() => toggleTrgOpen(r.id)} className="min-w-0 flex-1 text-left">
                        <div className={"truncate text-sm font-medium " + (r.text ? "text-neutral-800" : "text-neutral-400")}>{r.text || "Новое правило"}</div>
                        <div className="truncate text-[11px] text-neutral-400">когда <b className="font-semibold text-neutral-500">«{stageName(r.stageId)}»</b> {r.when === "complete" ? "пройден" : "начат"}</div>
                      </button>
                      <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                        {trgChip(r.scope === "product" ? "по товару" : "на партию", r.scope === "product" ? "#fff7ed" : "#ecfeff", r.scope === "product" ? "#c2410c" : "#0e7490")}
                        {pr && trgChip(pr.label, pr.bg, pr.color)}
                        {asg && trgChip(asg, "#eef2ff", "#4f46e5")}
                      </div>
                      <button onClick={() => patchCycleTrigger(r.id, { enabled: !r.enabled })} className="relative h-[20px] w-[34px] shrink-0 rounded-full transition" style={{ background: r.enabled ? "#16a34a" : "#d4d4d8" }} title={r.enabled ? "Включено" : "Выключено"}><span className="absolute top-0.5 h-[16px] w-[16px] rounded-full bg-white shadow transition-all" style={{ left: r.enabled ? 16 : 2 }} /></button>
                      <button onClick={() => removeCycleTrigger(r.id)} className="shrink-0 rounded-md p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить правило"><Trash2 size={14} /></button>
                    </div>
                    {/* раскрытые настройки */}
                    {open && (
                    <div className="space-y-2.5 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-neutral-600">Когда этап</span>
                        <select value={r.stageId} onChange={(e) => patchCycleTrigger(r.id, { stageId: e.target.value })} className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none">
                          {cycStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          {!cycStages.some((s) => s.id === r.stageId) && r.stageId && <option value={r.stageId}>этап удалён</option>}
                        </select>
                        <select value={r.when} onChange={(e) => patchCycleTrigger(r.id, { when: e.target.value })} className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none"><option value="enter">начат</option><option value="complete">пройден</option></select>
                      </div>
                      <div>
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Текст задачи · {"{партия}"} подставит имя партии</div>
                        <input value={r.text} onChange={(e) => patchCycleTrigger(r.id, { text: e.target.value })} placeholder="Напр.: Формирование фонда маркетинга по партии «{партия}»" className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm focus:border-neutral-400 focus:outline-none" />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-600">
                        <label className="inline-flex items-center gap-1.5">для:
                          <select value={r.scope} onChange={(e) => patchCycleTrigger(r.id, { scope: e.target.value })} className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 focus:outline-none"><option value="batch">одна на партию</option><option value="product">по задаче на каждый товар</option></select>
                        </label>
                        <label className="inline-flex items-center gap-1.5">приоритет:
                          <select value={r.priority || ""} onChange={(e) => patchCycleTrigger(r.id, { priority: e.target.value || null })} className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 focus:outline-none"><option value="">—</option>{Object.keys(PRIORITIES).map((k) => <option key={k} value={k}>{PRIORITIES[k].label}</option>)}</select>
                        </label>
                        <label className="inline-flex items-center gap-1.5">исполнитель:
                          <select value={r.assignee || ""} onChange={(e) => patchCycleTrigger(r.id, { assignee: e.target.value || null })} className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 focus:outline-none"><option value="">—</option>{(taskPeople || []).map((pp) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}</select>
                        </label>
                        <label className="inline-flex items-center gap-1.5">дата:
                          <select value={r.hasDate ? (r.dateFrom === "end" ? "end" : "start") : "none"} onChange={(e) => patchCycleTrigger(r.id, e.target.value === "none" ? { hasDate: false } : { hasDate: true, dateFrom: e.target.value })} className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 focus:outline-none" title="Всегда от фактической даты: начало этапа = конец предыдущего, конец этапа = его факт. Пока факта нет — берётся план. Задача попадёт на гант"><option value="none">без даты</option><option value="start">от начала этапа</option><option value="end">от конца этапа</option></select>
                        </label>
                        {r.hasDate && (
                          <label className="inline-flex items-center gap-1.5">длительность:
                            <input value={r.durDays} onChange={(e) => patchCycleTrigger(r.id, { durDays: Math.max(1, parseInt(e.target.value) || 1) })} inputMode="numeric" className="w-12 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-center focus:outline-none" /> дн.
                          </label>
                        )}
                      </div>
                    </div>
                    )}
                  </div>
                ); })}
                {(!cycleTriggers || cycleTriggers.length === 0) && <p className="py-2 text-center text-sm text-neutral-400">Правил по этапам пока нет</p>}
                {cycStages.length === 0 && <p className="py-2 text-center text-sm text-neutral-400">Стандартных этапов цикла нет</p>}
              </div>
              <button onClick={addCycleTrigger} disabled={cycStages.length === 0} className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:border-amber-400 hover:text-amber-700 disabled:opacity-40"><Plus size={14} /> Добавить правило</button>
            </>
          )}

          {tab === "cycles" && (
            <div className="flex min-h-[420px] gap-0">
              <div className="w-[210px] shrink-0 border-r border-neutral-100 bg-neutral-50/70 p-3">
                <div className="mb-2 text-[10.5px] font-extrabold uppercase tracking-wider text-neutral-400">Циклы</div>
                {cyclesList.map((c) => (
                  <button key={c.id} onClick={() => setCycSel(c.id)} className={"mb-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px] font-bold " + ((curCycle && curCycle.id === c.id) ? "border-neutral-200 bg-white shadow-sm" : "border-transparent text-neutral-600 hover:bg-white")}>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span><span className="shrink-0 text-[11px] font-semibold text-neutral-400">{c.stages.length}</span>
                  </button>
                ))}
                <button onClick={addCycle} className="mt-1 w-full rounded-lg border-[1.5px] border-dashed border-neutral-300 py-1.5 text-[12.5px] font-bold text-neutral-500 hover:bg-white">＋ Новый цикл</button>
              </div>
              <div className="min-w-0 flex-1 overflow-y-auto p-4" style={{ maxHeight: zvh(70) }}>
                {curCycle && (<>
                  <div className="mb-1 flex items-center gap-2">
                    <input value={curCycle.name} onChange={(e) => patchCycle(curCycle.id, { name: e.target.value })} className="min-w-0 flex-1 rounded-md border border-transparent px-1 text-[17px] font-extrabold text-neutral-900 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none" />
                    <button onClick={() => removeCycle(curCycle.id)} title="Удалить цикл" className="rounded-md p-1.5 text-neutral-300 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
                  </div>
                  <div className="mb-3 text-xs text-neutral-500">Этапы идут сверху вниз. В закупке выбирается этот цикл, а длительность можно подправить для конкретной партии.</div>
                  {curCycle.stages.map((x, i) => { const L = cycStages.find((y) => y.id === x.id); if (!L) return null; const tc = stageTrgCount(x.id); return (
                    <div key={x.id} className="mb-1.5 flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-white px-2.5 py-2">
                      <span className="flex flex-col text-[9px] leading-none text-neutral-300"><button onClick={() => moveInCycle(x.id, -1)} disabled={i === 0} className="hover:text-neutral-600 disabled:opacity-30">▲</button><button onClick={() => moveInCycle(x.id, 1)} disabled={i === curCycle.stages.length - 1} className="mt-0.5 hover:text-neutral-600 disabled:opacity-30">▼</button></span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-neutral-800">{L.name}</span>
                      <span className={"shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold " + (tc ? "bg-orange-50 text-orange-700" : "bg-neutral-100 text-neutral-400")}>{tc ? `${tc} ${plural(tc, "триггер", "триггера", "триггеров")}` : "нет триггеров"}</span>
                      <div className="inline-flex shrink-0 items-center overflow-hidden rounded-[9px] border border-neutral-200 text-[13px]">
                        <button onClick={() => setCycleDays(x.id, (parseInt(x.days, 10) || 0) - 1)} className="w-6 text-center font-bold text-neutral-500 hover:bg-neutral-100">−</button>
                        <input value={x.days} onChange={(e) => setCycleDays(x.id, e.target.value)} inputMode="numeric" className="w-[36px] border-x border-neutral-200 py-[3px] text-center focus:outline-none" />
                        <button onClick={() => setCycleDays(x.id, (parseInt(x.days, 10) || 0) + 1)} className="w-6 text-center font-bold text-neutral-500 hover:bg-neutral-100">+</button>
                      </div>
                      <button onClick={() => rmFromCycle(x.id)} title="Убрать из цикла" className="shrink-0 text-neutral-300 hover:text-red-500"><X size={14} /></button>
                    </div>
                  ); })}
                  <div className="mb-3 mt-2 max-w-[320px]"><StagePicker dashed label="＋ Добавить этап из справочника" options={cycStages.filter((l) => !curCycle.stages.some((x) => x.id === l.id))} onPick={addToCycle} /></div>
                  <div className="rounded-xl bg-emerald-50 px-3 py-2 text-[12.5px] font-bold text-emerald-800">🏁 Завершение цикла · {curCycle.stages.reduce((a, x) => a + (parseInt(x.days, 10) || 0), 0)} дн</div>
                </>)}
                <div className="mb-2 mt-6 text-[10.5px] font-extrabold uppercase tracking-wider text-neutral-400">Справочник этапов</div>
                <div className="space-y-1">
                  {cycStages.map((L) => { const n = stageInCycles(L.id); const tc = stageTrgCount(L.id); return (
                    <div key={L.id} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1">
                      <input value={L.name} onChange={(e) => renameLib(L.id, e.target.value)} className="min-w-0 flex-1 rounded-md border border-transparent px-1 py-0.5 text-[13px] font-semibold text-neutral-800 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none" />
                      <span className="shrink-0 text-[11px] text-neutral-400">{n ? `в циклах: ${n}` : "не используется"}{tc ? ` · триггеров: ${tc}` : ""}</span>
                      <button onClick={() => removeLib(L.id)} title="Удалить из справочника" className="shrink-0 text-neutral-300 hover:text-red-500"><X size={13} /></button>
                    </div>
                  ); })}
                </div>
                <div className="mt-2 flex max-w-[360px] items-center gap-1.5">
                  <input value={libName} onChange={(e) => setLibName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLib(); }} placeholder="＋ Новый этап в справочник…" className="min-w-0 flex-1 rounded-lg border border-dashed border-neutral-300 px-2.5 py-1.5 text-[13px] focus:border-neutral-400 focus:outline-none" />
                  <button onClick={addLib} disabled={!libName.trim()} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">Добавить</button>
                </div>
                <div className="mt-2 text-[11.5px] text-neutral-400">Название этапа меняется здесь один раз — в циклах, закупках и триггерах оно обновится. Удалить этап нельзя, пока он используется.</div>
              </div>
            </div>
          )}

          {tab === "subjects" && (
            <>
              <p className="mb-3 text-xs text-neutral-400">Загрузите таблицу комиссий ВБ (.xlsx). Комиссия берётся из колонки «Склад WB (FBW), %» и сопоставляется по столбцу «Предмет». В юнит-экономике ВБ у товара берётся комиссия его предмета.</p>

              <input ref={subjFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onCommFile(e.target.files?.[0])} />
              <button
                onClick={() => subjFileRef.current?.click()}
                disabled={subjBusy}
                className="mb-3 flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-200 py-5 text-sm text-neutral-500 hover:border-sky-300 hover:bg-sky-50/40 disabled:opacity-50"
              >
                <Download size={18} className="rotate-180 text-neutral-400" />
                {subjBusy ? "Обработка…" : "Загрузить таблицу комиссий ВБ — .xlsx"}
              </button>
              {subjErr && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{subjErr}</p>}

              {(subjects || []).length > 0 && (
                <div className="mb-3 flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
                  <span className="text-xs text-neutral-600">Загружено предметов: <b>{subjects.length}</b> · комиссия из <b>FBW</b></span>
                  <button onClick={() => { if (confirm("Очистить все предметы и комиссии?")) setSubjects([]); }} className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-red-50 hover:text-red-600">Очистить</button>
                </div>
              )}

              <input
                value={subjSearch}
                onChange={(e) => setSubjSearch(e.target.value)}
                placeholder="Найти предмет…"
                className="mb-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
              <div className="mb-3 space-y-1.5">
                {subjMatches.map((s) => (
                  <div key={s.id} className="group flex items-center gap-2 rounded-lg border border-neutral-100 px-2 py-2 hover:border-neutral-200">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" />
                    <div className="min-w-0 flex-1">
                      <input
                        value={s.name}
                        onChange={(e) => setSubjectName(s.id, e.target.value)}
                        className="w-full bg-transparent text-sm text-neutral-800 focus:outline-none"
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <input
                        value={s.commission ?? ""}
                        onChange={(e) => setSubjectComm(s.id, e.target.value)}
                        inputMode="decimal"
                        placeholder="0"
                        className="w-16 rounded-lg border border-neutral-200 px-2 py-1 text-right text-sm tabular-nums text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                      />
                      <span className="w-3 text-xs text-neutral-400">%</span>
                    </div>
                    <button onClick={() => removeSubject(s.id)} className="shrink-0 rounded p-0.5 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100" title="Удалить"><Trash2 size={14} /></button>
                  </div>
                ))}
                {(subjects || []).length === 0 && <p className="py-2 text-center text-sm text-neutral-400">Предметов пока нет — загрузите таблицу</p>}
                {(subjects || []).length > 0 && subjMatches.length === 0 && <p className="py-2 text-center text-sm text-neutral-400">Ничего не найдено</p>}
                {!subjQuery && (subjects || []).length > subjMatches.length && <p className="pt-1 text-center text-[11px] text-neutral-400">Показаны первые {subjMatches.length}. Используйте поиск.</p>}
              </div>

              <div className="flex items-center gap-2">
                <input
                  value={subjName}
                  onChange={(e) => setSubjName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addSubject()}
                  placeholder="Добавить предмет вручную…"
                  className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
                <button onClick={addSubject} disabled={!subjName.trim()} className="rounded-lg inline-flex items-center gap-1 bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40">
                  <Plus size={14} /> Добавить
                </button>
              </div>
            </>
          )}

          {tab === "unit" && (
            <>
              <p className="mb-4 text-xs text-neutral-400">Применяются ко всем товарам — в расчёте юнит-экономики и закупки.</p>
              <div className="space-y-2.5">
                {[
                  { k: "tax", label: "Налог, %" },
                  { k: "acqWb", label: "Эквайринг ВБ, %" },
                  { k: "acqOz", label: "Эквайринг Озон, %" },
                  { k: "whCoeffWb", label: "КФ склада ВБ, %" },
                  { k: "cny", label: "Курс юаня, ₽" },
                  { k: "usd", label: "Курс доллара, ₽" },
                  { k: "cargo", label: "Ставка карго, $/кг" },
                ].map((r) => (
                  <label key={r.k} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-neutral-700">{r.label}</span>
                    <input
                      value={(unitConst || {})[r.k] ?? ""}
                      onChange={(e) => setUnitConst((c) => ({ ...c, [r.k]: e.target.value }))}
                      inputMode="decimal"
                      placeholder="0"
                      className="w-28 rounded-lg border border-neutral-200 px-3 py-1.5 text-right text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    />
                  </label>
                ))}
              </div>
            </>
          )}

          {tab === "integr" && intg === "tg" && (() => {
            const me = taskPeople.find((p) => p.id === myProfileId) || null;
            const linked = (id) => !!tgLinks[id];
            const connect = async () => {
              if (!me || !tgBot) return;
              const arr = new Uint8Array(9); crypto.getRandomValues(arr);
              const code = Array.from(arr, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
              try { await upsertSetting("tgCodes", { [code]: { pid: me.id, exp: Date.now() + 15 * 60 * 1000 } }); } catch (_) {}
              window.open(`https://t.me/${tgBot}?start=${code}`, "_blank");
            };
            const unlink = async () => { if (!me) return; const n = { ...tgLinks }; delete n[me.id]; try { await upsertSetting("tgLinks", n); } catch (_) {} };
            return (
              <>
                <p className="mb-3 text-xs text-neutral-500">Бот присылает в Telegram «Вам поручена задача» и напоминания о сроке (за день и в день срока, в 10:00 по Москве), а ещё принимает задачи текстом: «Позвонить в Китай завтра» или «Проверить приёмку до 25.11 @Анна».</p>
                <label className="mb-1 block text-xs font-medium text-neutral-500">Имя бота (из BotFather, без @)</label>
                <input defaultValue={tgBot} onBlur={(e) => saveTgBot && saveTgBot(e.target.value)} placeholder="rnp_pro_bot" className="w-full max-w-sm rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ fontFamily: "monospace" }} />
                <div className="mt-5 rounded-xl border border-neutral-200 p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-neutral-900">Мой Telegram</div>
                      <div className="text-xs text-neutral-500">{!me ? "Для вашей почты не создан профиль (Настройки → профили)" : linked(me.id) ? "✓ Привязан. Уведомления приходят в Telegram" : "Не привязан"}</div>
                    </div>
                    {me && linked(me.id) && <button onClick={unlink} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">Отвязать</button>}
                    <button onClick={connect} disabled={!me || !tgBot} title={!tgBot ? "Сначала укажите имя бота" : ""} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-neutral-800 disabled:opacity-40">{me && linked(me.id) ? "Привязать заново" : "Привязать"}</button>
                  </div>
                  <p className="mt-2 text-[11px] text-neutral-400">Откроется Telegram — нажмите «Запустить» (Start). Ссылка действует 15 минут.</p>
                </div>
                <div className="mt-4">
                  <div className="mb-1.5 text-xs font-bold text-neutral-700">Команда</div>
                  {taskPeople.length === 0 ? <p className="text-xs text-neutral-400">Профилей нет</p> : taskPeople.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 border-t border-neutral-100 py-1.5 text-sm first:border-t-0">
                      <PersonAvatar p={p} size={22} />
                      <span className="flex-1 font-semibold text-neutral-800">{profileLabel(p)}</span>
                      <span className={"text-xs font-semibold " + (linked(p.id) ? "text-emerald-600" : "text-neutral-400")}>{linked(p.id) ? "в Telegram" : "не привязан"}</span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
          {tab === "integr" && intg === "oz" && (
            <>
              <p className="mb-1 text-xs text-neutral-400">Seller API: кабинет Озон → Настройки → Seller API → «Сгенерировать ключ» (роль «Администратор» или «Только чтение»). Нужен для заказов, остатков и «в пути».</p>
              <label className="mb-1 mt-3 block text-xs font-medium text-neutral-500">Client-Id</label>
              <input value={ozCfg.clientId || ""} onChange={(e) => setOzCfg({ ...ozCfg, clientId: e.target.value })} placeholder="1234567" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ fontFamily: "monospace" }} />
              <label className="mb-1 mt-3 block text-xs font-medium text-neutral-500">Api-Key</label>
              <input value={ozCfg.apiKey || ""} onChange={(e) => setOzCfg({ ...ozCfg, apiKey: e.target.value })} type="password" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ fontFamily: "monospace" }} />
              <div className="mt-6 border-t border-neutral-100 pt-4">
                <p className="mb-1 text-xs text-neutral-400">Performance API (реклама): кабинет Озон Performance → Настройки → Ключи API. Это отдельная пара ключей — без неё реклама не покажется.</p>
              <label className="mb-1 mt-3 block text-xs font-medium text-neutral-500">Client-Id (Performance)</label>
              <input value={ozCfg.perfId || ""} onChange={(e) => setOzCfg({ ...ozCfg, perfId: e.target.value })} placeholder="12345678-1234567890@advertising.performance.ozon.ru" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ fontFamily: "monospace" }} />
              <label className="mb-1 mt-3 block text-xs font-medium text-neutral-500">Client-Secret (Performance)</label>
              <input value={ozCfg.perfSecret || ""} onChange={(e) => setOzCfg({ ...ozCfg, perfSecret: e.target.value })} type="password" placeholder="••••••••" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ fontFamily: "monospace" }} />
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <button onClick={() => onFetchOz && onFetchOz()} disabled={!ozCfg.clientId || !ozCfg.apiKey || ozLoading} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40">{ozLoading ? "Загрузка…" : "Сохранить и загрузить"}</button>
                <span className="text-xs text-neutral-400">{ozMsg || (ozCfg.clientId && ozCfg.apiKey ? "✓ ключи заданы" : "ключи не заданы")}</span>
              </div>
            </>
          )}
          {tab === "integr" && intg === "ms" && (
            <>
              <p className="mb-1 text-xs text-neutral-400">Токен: МойСклад → Настройки → Безопасность → Токены → «Создать токен» (доступ на чтение достаточно). Токен хранится в настройках сервиса и виден только команде.</p>
              <label className="mb-1 mt-3 block text-xs font-medium text-neutral-500">Токен МойСклад</label>
              <input value={msCfg.token || ""} onChange={(e) => setMsCfg({ ...msCfg, token: e.target.value })} type="password" placeholder="••••••••••••••••" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ fontFamily: "monospace" }} />
              <div className="mt-4 flex items-center justify-between gap-2">
                <button onClick={() => onFetchMs && onFetchMs()} disabled={!msCfg.token || msLoading} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40">{msLoading ? "Загрузка…" : "Сохранить и загрузить"}</button>
                <span className="text-xs text-neutral-400">{msMsg || (msCfg.token ? (msData && msData.updatedAt ? "✓ данные от " + new Date(msData.updatedAt).toLocaleString("ru-RU") : "токен задан") : "токен не задан")}</span>
              </div>
              {msData && (msData.stores || []).length > 0 && <p className="mt-3 text-xs text-neutral-500">Склады: {(msData.stores || []).join(", ")}</p>}
            </>
          )}
          {tab === "integr" && intg === "wb" && (
            <>
              <p className="mb-3 text-xs text-neutral-400">Ключ берётся в кабинете ВБ → Настройки → Доступ к API → категория «Статистика». Хранится в базе, доступен только вашей команде. Нужен для подгрузки заказов в блок «Продвижение».</p>
              <label className="mb-1 block text-xs font-medium text-neutral-500">API-ключ (Статистика)</label>
              <input
                value={wbApiKey || ""}
                onChange={(e) => setWbApiKey(e.target.value)}
                type="password"
                placeholder="eyJhbGci..."
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
                style={{ fontFamily: "monospace" }}
              />
              <div className="mt-4 flex items-center justify-between gap-2">
                <button onClick={() => onFetchWb && onFetchWb()} disabled={!wbApiKey} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40">
                  Сохранить и загрузить
                </button>
                <span className="text-xs text-neutral-400">{wbApiKey ? "✓ ключ задан" : "ключ не задан"}</span>
              </div>
              <div className="mt-6 border-t border-neutral-100 pt-4">
                <p className="mb-3 text-xs text-neutral-400">Для внутренней рекламы нужен отдельный ключ: кабинет ВБ → Настройки → Доступ к API → категория «Продвижение». Расход по дням подтягивается в строку «Внутренняя реклама» (по артикулу ВБ) и попадает в фонд маркетинга.</p>
                <label className="mb-1 block text-xs font-medium text-neutral-500">API-ключ (Продвижение)</label>
                <input value={wbAdKey || ""} onChange={(e) => setWbAdKey(e.target.value)} type="password" placeholder="eyJhbGci..." className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ fontFamily: "monospace" }} />
                <div className="mt-4 flex items-center justify-between gap-2">
                  <button onClick={() => onFetchAd && onFetchAd()} disabled={!wbAdKey || adLoading} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40">{adLoading ? "Загрузка…" : "Сохранить и загрузить рекламу"}</button>
                  <span className="text-xs text-neutral-400">{adMsg || (wbAdKey ? "✓ ключ задан" : "ключ не задан")}</span>
                </div>
              </div>
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
