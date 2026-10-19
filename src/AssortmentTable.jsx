import { useState, useEffect, useLayoutEffect, useRef, useMemo, memo } from "react";
import { fetchAll, upsertProduct, deleteProductRow, upsertSetting, subscribe } from "./lib/cloud";
import {
  Plus, Trash2, ImagePlus, Settings2, X, Check, Download,
  ChevronRight, ChevronDown, ChevronUp, Minus, ArrowRight, Copy, ExternalLink, Paperclip, Pencil,
  Target, Flag, AlertTriangle, GitBranch, ZoomIn, ZoomOut, Maximize2, Undo2, Redo2, Square, CalendarPlus, Wand2, ListChecks, LayoutTemplate, Repeat, Users,
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

// Группы. tab — к какой вкладке относится группа. kind:
//   "columns" — добавляет столбцы к каждой строке товара (как Юнит);
//   "matrix"  — раскрывается под строкой товара (метрики × интеграции, как Внешка).
const TABS = [
  { id: "assortment", label: "Товары" },
  { id: "purchases", label: "Закупки" },
  { id: "tasks", label: "Задачи" },
  { id: "strategy", label: "Стратегия" },
  { id: "duties", label: "Функционал" },
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
  { id: "orders",   label: "Кол-во заказов", kind: "wbOrders" },
  { id: "internal", label: "Внутренняя реклама", kind: "singleCost", cost: true },
  { id: "vykupy",   label: "Выкупы", kind: "twoRow", top: "entries", cost: true, fields: VYKUP_FIELDS },
  { id: "bloggers", label: "Блогеры", kind: "twoRow", top: "entries", cost: true, fields: BLOGGER_FIELDS },
  { id: "razdachi", label: "Раздачи", kind: "twoRow", top: "entries", cost: true, fields: RAZDACHI_FIELDS },
  { id: "stars",    label: "Баллы за отзывы", kind: "rangeTask", cost: true, fields: STARS_FIELDS },
  { id: "wibes",    label: "Wibes", kind: "twoRow", top: "entries", cost: true, fields: VYKUP_FIELDS },
  { id: "promo",    label: "Акция", kind: "checkbox" },
  { id: "ab",       label: "А/Б тесты", kind: "rangeTask", cost: false, fields: AB_FIELDS },
];
const RNP_COST_TASKS = RNP_TASKS.filter((t) => t.cost);
const RNP_COLORS = { orders: "#16a34a", internal: "#2563eb", vykupy: "#16a34a", bloggers: "#db2777", razdachi: "#d97706", stars: "#7c3aed", wibes: "#0891b2", promo: "#ea580c", ab: "#64748b" };

// Сумма затрат по строке РНП за весь период (для превью «Фонд / Затраты / Остаток»)
function rnpTaskTotal(task, product) {
  const entries = product.rnp?.entries || {};
  const cells = product.rnp?.cells || {};
  const rec = (e) => calcRecordCost(task.fields, e);
  if (task.kind === "rangeTask") return (entries[`${task.id}:_ranges`] || []).reduce((a, e) => a + rec(e), 0);
  return task.top === "entries"
    ? Object.entries(entries).reduce((a, [k, arr]) => a + (k.startsWith(task.id + ":") && !k.endsWith(":_ranges") ? (arr || []).reduce((s, e) => s + rec(e), 0) : 0), 0)
    : Object.entries(cells).reduce((a, [k, v]) => { if (k.startsWith(task.id + ":cost:")) { const n = toNum(v); if (!isNaN(n)) return a + n; } return a; }, 0);
}
function rnpBudget(product) {
  const alc = toNum(product.rnp?.budget?.allocated);
  const allocated = isNaN(alc) ? 0 : alc;
  const spent = RNP_COST_TASKS.reduce((a, t) => a + rnpTaskTotal(t, product), 0);
  return { allocated, spent, ostatok: allocated - spent };
}
// Затраты по строке за конкретный день (для суммы затрат за день в календаре)
function rnpDayCost(task, product, dkey) {
  const entries = product.rnp?.entries || {};
  const cells = product.rnp?.cells || {};
  if (task.kind === "singleCost") { const n = toNum(cells[`${task.id}:cost:${dkey}`]); return isNaN(n) ? 0 : n; }
  if (task.kind === "twoRow" && task.top === "entries") return (entries[`${task.id}:${dkey}`] || []).reduce((s, e) => s + calcRecordCost(task.fields, e), 0);
  return 0;
}
// Активность по строке за день (для чипов): null если ничего нет
function rnpDayActivity(task, product, dkey, wbOrders = {}) {
  const entries = product.rnp?.entries || {};
  const cells = product.rnp?.cells || {};
  const flags = product.rnp?.flags || {};
  if (task.kind === "wbOrders") { const code = product.code || product.wb || ""; const c = wbOrders[`${code}:${dkey}`] || wbOrders[`${product.wb}:${dkey}`] || 0; return c > 0 ? { count: c, cost: 0 } : null; }
  if (task.kind === "singleCost") { const n = toNum(cells[`${task.id}:cost:${dkey}`]); return (!isNaN(n) && n > 0) ? { count: 0, cost: n } : null; }
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

const DEFAULT_METRICS_BY_GROUP = Object.fromEntries(
  MATRIX_GROUPS.map((g) => [g.id, g.metrics.map((label) => ({ id: uid(), label }))])
);

const SWATCHES = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444",
  "#0ea5e9", "#ec4899", "#84cc16", "#a3a3a3",
];


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
    plan: { sizes: p?.plan?.sizes || [] },
    rnp: p?.rnp || { cells: {}, entries: {}, fills: {}, flags: {}, budget: { allocated: "" } },
    calendar: normalizeCalendar(p?.calendar),
    tasks: Array.isArray(p?.tasks) ? p.tasks : [],
    competitors: Array.isArray(p?.competitors) ? p.competitors : [],
    seasonality: p?.seasonality || null,
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

export default function AssortmentTable() {
  const [products, setProducts] = useState([]);
  const [statuses, setStatuses] = useState(DEFAULT_STATUSES);
  const [metricsByGroup, setMetricsByGroup] = useState(DEFAULT_METRICS_BY_GROUP);
  const [warehouses, setWarehouses] = useState(DEFAULT_WAREHOUSES);
  const [purchases, setPurchases] = useState([]);
  const [purchaseBatches, setPurchaseBatches] = useState([]); // блок «Закупки» — партии [{id,name,status,cny,usd,cargo,items:[{id,productId,priceCny,qty}]}]
  const [jobs, setJobs] = useState([]); // блок «Задачи» — задачи с датой [{id,title,date,done,labelId,productId}]
  const [jobEditor, setJobEditor] = useState(null); // {id?...} открытое окно задачи
  const [rnpStartDate, setRnpStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10);
  });
  const [rnpDays, setRnpDays] = useState(28);
  const [hiddenTasks, setHiddenTasks] = useState({});
  const [hiddenCols, setHiddenCols] = useState({}); // скрытые столбцы юнита: { "unit:spp": true }
  const [colFilterOpen, setColFilterOpen] = useState(false);
  const [unitConst, setUnitConst] = useState({ tax: "8", acqWb: "2.5", acqOz: "1.5", whCoeffWb: "170", cny: "", usd: "", cargo: "" }); // единые для всех товаров
  const [subjects, setSubjects] = useState([]); // предметы с комиссией ВБ — [{id, name, commission}]
  const [enabled, setEnabled] = useState({ unit: true, unitoz: true, external: true, razdachi: true, vykupy: true, shipment: true });
  const [activeTab, setActiveTab] = useState("assortment");
  const [productsView, setProductsView] = useState("list"); // list | tiles
  const [expanded, setExpanded] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultTasks, setDefaultTasks] = useState([]); // задачи по умолчанию (общие) — [{id, text, labelId}]
  const [taskLabels, setTaskLabels] = useState([]); // метки задач (общие) — [{id, name, color}]
  const [opTypes, setOpTypes] = useState([]); // операционные задачи (регулярные строки Ганта) — [{id, name, recur}]
  const [opDone, setOpDone] = useState({}); // отметки выполнения операционных задач — {opId:{"YYYY-MM-DD":true}}
  const [opEditor, setOpEditor] = useState(null); // открытая настройка операционной задачи (из Ганта)
  const [ganttModal, setGanttModal] = useState(null);
  const [cardModal, setCardModal] = useState(null); // id товара для окна «Задачи по карточке»
  const [codeFilter, setCodeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState([]); // выбранные статусы (мультивыбор); пусто = все
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [bloggerDB, setBloggerDB] = useState([]);
  const [razdachDB, setRazdachDB] = useState([]);
  const [dbOpen, setDbOpen] = useState(false);
  const [dbActive, setDbActive] = useState("blogger"); // blogger | razdach | <customId>
  const [customDBs, setCustomDBs] = useState([]); // пользовательские виды базы — [{id, name, rows:[]}]
  const [strategy, setStrategy] = useState(() => normStrategy(null)); // блок «Стратегия» — карты холстов
  const [duties, setDuties] = useState(() => normDuties(null)); // блок «Обязанности» — области/функции/подфункции/исполнители
  const [colSettings, setColSettings] = useState(false);
  const [wbApiKey, setWbApiKey] = useState("");
  const [wbOrders, setWbOrders] = useState({}); // { "articleCode:YYYY-MM-DD": count }
  const [wbOrdersMeta, setWbOrdersMeta] = useState({}); // { "YYYY-MM-DD": "дата когда забрали" }
  const [wbLoading, setWbLoading] = useState(false);
  const [wbProgress, setWbProgress] = useState(null);
  const [settingsTab, setSettingsTab] = useState("statuses"); // стартовая вкладка окна настроек
  const [panelW, setPanelW] = useState(0);

  const fileInputRef = useRef(null);
  const uploadTarget = useRef(null);
  const scrollRef = useRef(null);

  const syncedRef = useRef({ products: new Map(), settings: {} });
  const dirtyRef = useRef({ products: new Set(), settings: new Set() });
  const desiredRef = useRef({ settings: {} }); // последнее желаемое значение каждого ключа (для защиты от гонки эха)
  const listSettingsRef = useRef({ bloggerDB: [], razdachDB: [], purchases: [], purchaseBatches: [], jobs: [], opTypes: [], subjects: [], customDBs: [] });
  listSettingsRef.current = { bloggerDB, razdachDB, purchases, purchaseBatches, jobs, opTypes, subjects, customDBs };

  // UI-настройки (личные) — localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("rnp-ui");
      if (raw) { const ui = JSON.parse(raw); if (ui.enabled) setEnabled((e) => ({ ...e, ...ui.enabled })); if (ui.activeTab && TABS.some((t) => t.id === ui.activeTab)) setActiveTab(ui.activeTab); if (ui.hiddenTasks) setHiddenTasks(ui.hiddenTasks); if (ui.hiddenCols) setHiddenCols(ui.hiddenCols); if (ui.productsView) setProductsView(ui.productsView); }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("rnp-ui", JSON.stringify({ enabled, activeTab, hiddenTasks, hiddenCols, productsView })); } catch {}
  }, [enabled, activeTab, hiddenTasks, hiddenCols, productsView]);

  // загрузка из Supabase
  useEffect(() => {
    (async () => {
      try {
        const { products: prods, settings } = await fetchAll();
        const norm = (prods || []).map(normalizeProduct);
        setProducts(norm);
        norm.forEach((p) => syncedRef.current.products.set(p.id, JSON.stringify(p)));
        if (Array.isArray(settings.statuses) && settings.statuses.length) { setStatuses(settings.statuses); syncedRef.current.settings.statuses = JSON.stringify(settings.statuses); }
        if (Array.isArray(settings.warehouses) && settings.warehouses.length) { setWarehouses(settings.warehouses); syncedRef.current.settings.warehouses = JSON.stringify(settings.warehouses); }
        if (Array.isArray(settings.purchases)) { setPurchases(settings.purchases); syncedRef.current.settings.purchases = JSON.stringify(settings.purchases); }
        if (Array.isArray(settings.purchaseBatches)) { setPurchaseBatches(settings.purchaseBatches); syncedRef.current.settings.purchaseBatches = JSON.stringify(settings.purchaseBatches); }
        if (Array.isArray(settings.jobs)) { setJobs(settings.jobs); syncedRef.current.settings.jobs = JSON.stringify(settings.jobs); }
        if (Array.isArray(settings.bloggerDB)) { setBloggerDB(settings.bloggerDB); syncedRef.current.settings.bloggerDB = JSON.stringify(settings.bloggerDB); }
        if (Array.isArray(settings.razdachDB)) { setRazdachDB(settings.razdachDB); syncedRef.current.settings.razdachDB = JSON.stringify(settings.razdachDB); }
        if (Array.isArray(settings.defaultTasks)) { setDefaultTasks(settings.defaultTasks); syncedRef.current.settings.defaultTasks = JSON.stringify(settings.defaultTasks); }
        if (Array.isArray(settings.taskLabels)) { setTaskLabels(settings.taskLabels); syncedRef.current.settings.taskLabels = JSON.stringify(settings.taskLabels); }
        if (Array.isArray(settings.opTypes)) { setOpTypes(settings.opTypes); syncedRef.current.settings.opTypes = JSON.stringify(settings.opTypes); }
        if (settings.opDone && typeof settings.opDone === "object") { setOpDone(settings.opDone); syncedRef.current.settings.opDone = JSON.stringify(settings.opDone); }
        if (Array.isArray(settings.subjects)) { setSubjects(settings.subjects); syncedRef.current.settings.subjects = JSON.stringify(settings.subjects); }
        if (Array.isArray(settings.customDBs)) { setCustomDBs(settings.customDBs); syncedRef.current.settings.customDBs = JSON.stringify(settings.customDBs); }
        if (settings.strategy && typeof settings.strategy === "object") { const ns = normStrategy(settings.strategy); setStrategy(ns); syncedRef.current.settings.strategy = JSON.stringify(ns); }
        if (settings.duties && typeof settings.duties === "object") { const nd = normDuties(settings.duties); setDuties(nd); syncedRef.current.settings.duties = JSON.stringify(nd); }
        if (settings.unitConst && typeof settings.unitConst === "object") { setUnitConst((c) => ({ ...c, ...settings.unitConst })); syncedRef.current.settings.unitConst = JSON.stringify(settings.unitConst); }
        if (settings.rnp) {
          if (settings.rnp.startDate) setRnpStartDate(settings.rnp.startDate);
          if (settings.rnp.days) setRnpDays(settings.rnp.days);
          syncedRef.current.settings.rnp = JSON.stringify(settings.rnp);
        }
        if (settings.wbApiKey) { setWbApiKey(settings.wbApiKey); syncedRef.current.settings.wbApiKey = JSON.stringify(settings.wbApiKey); }
        if (settings.wbOrders && typeof settings.wbOrders === "object") { setWbOrders(settings.wbOrders); syncedRef.current.settings.wbOrders = JSON.stringify(settings.wbOrders); }
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
      const cur = new Map(products.map((p) => [p.id, p]));
      for (const p of products) {
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
  }, [products, loaded]);

  // сохранение общих настроек
  useEffect(() => {
    if (!loaded) return;
    const items = { statuses, warehouses, purchases, purchaseBatches, jobs, bloggerDB, razdachDB, defaultTasks, taskLabels, opTypes, opDone, subjects, customDBs, strategy, duties, unitConst, wbApiKey, wbOrders, wbOrdersMeta, rnp: { startDate: rnpStartDate, days: rnpDays } };

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
  }, [statuses, warehouses, purchases, purchaseBatches, jobs, bloggerDB, razdachDB, defaultTasks, taskLabels, opTypes, opDone, subjects, customDBs, strategy, duties, unitConst, wbApiKey, wbOrders, wbOrdersMeta, rnpStartDate, rnpDays, loaded]);

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
        syncedRef.current.settings[key] = js;
        if (key === "statuses") setStatuses(value);
        else if (key === "warehouses") setWarehouses(value);
        else if (key === "purchases") setPurchases(value);
        else if (key === "purchaseBatches") setPurchaseBatches(value || []);
        else if (key === "jobs") setJobs(value || []);
        else if (key === "bloggerDB") setBloggerDB(value);
        else if (key === "razdachDB") setRazdachDB(value);
        else if (key === "defaultTasks") setDefaultTasks(value || []);
        else if (key === "taskLabels") setTaskLabels(value || []);
        else if (key === "opTypes") setOpTypes(value || []);
        else if (key === "opDone") setOpDone(value || {});
        else if (key === "subjects") setSubjects(value || []);
        else if (key === "customDBs") setCustomDBs(value || []);
        else if (key === "strategy") { if (value && typeof value === "object") setStrategy(normStrategy(value)); }
        else if (key === "duties") { if (value && typeof value === "object") setDuties(normDuties(value)); }
        else if (key === "unitConst") setUnitConst((c) => ({ ...c, ...(value || {}) }));
        else if (key === "wbApiKey") setWbApiKey(value);
        else if (key === "wbOrders") setWbOrders(value || {});
        else if (key === "wbOrdersMeta") setWbOrdersMeta(value || {});
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

  /* --- товары --- */
  const addProduct = () =>
    setProducts((p) => [
      ...p,
      normalizeProduct({ status: statuses[0]?.name || "" }),
    ]);
  const updateProduct = (id, field, value) =>
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, [field]: value } : x)));
  const setProductTasks = (id, tasks) =>
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, tasks } : x)));
  const setProductCompetitors = (id, competitors) =>
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, competitors } : x)));
  const setProductSeasonality = (id, seasonality) =>
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, seasonality } : x)));
  const upsertJob = (job) => setJobs((js) => { const i = js.findIndex((j) => j.id === job.id); if (i === -1) return [...js, job]; const c = js.slice(); c[i] = job; return c; });
  const removeJob = (id) => setJobs((js) => js.filter((j) => j.id !== id));
  const upsertOpType = (o) => setOpTypes((list) => { const i = (list || []).findIndex((x) => x.id === o.id); if (i === -1) return [...(list || []), o]; const c = list.slice(); c[i] = o; return c; });
  const removeOpType = (id) => setOpTypes((list) => (list || []).filter((x) => x.id !== id));
  const toggleOpDone = (opId, ds) => setOpDone((m) => { const day = { ...((m || {})[opId] || {}) }; if (day[ds]) delete day[ds]; else day[ds] = true; return { ...(m || {}), [opId]: day }; });
  const removeProduct = (id) => {
    if (!confirm("Вы точно хотите удалить товар?")) return;
    setProducts((p) => p.filter((x) => x.id !== id));
  };

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
    setProducts((ps) => ps.map((p) => (p.id === pid ? { ...p, plan: { sizes: fn(p.plan?.sizes || []) } } : p)));
  const addSize = (pid) =>
    editSizes(pid, (ss) => [...ss, { id: uid(), name: "", total: "", toShip: "", qty: {} }]);
  const removeSize = (pid, sid) => editSizes(pid, (ss) => ss.filter((s) => s.id !== sid));
  const setSize = (pid, sid, field, val) =>
    editSizes(pid, (ss) => ss.map((s) => (s.id === sid ? { ...s, [field]: val } : s)));
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
    setProducts((ps) => [...ps, normalizeProduct({ image: item.image, name: item.name, status: statuses[0]?.name || "" })]);
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
    if (daysToFetch.length === 0) return;

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

    if (failed.length) {
      console.warn(`[WB] не добрали ${failed.length} дней после 4 проходов: ${failed.join(", ")}`);
    }
  };
  const expandAll = () => setExpanded(Object.fromEntries(products.map((p) => [p.id, true])));
  const collapseAll = () => setExpanded({});
  const statusColor = (name) => statuses.find((s) => s.name === name)?.color || "#a3a3a3";

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

  const frozenCols = hasExpandable
    ? [{ id: "expander", label: "", width: 40 }, ...FROZEN]
    : FROZEN;

  const filteredProducts = products.filter((p) => {
    if (codeFilter.trim() && !(p.code || "").toLowerCase().includes(codeFilter.trim().toLowerCase())) return false;
    if (statusFilter.length && !statusFilter.includes(p.status)) return false;
    return true;
  });

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
  const exportCsv = () => {
    let head, rows, fname;
    if (activeTab === "purchases") {
      head = ["Партия", "Статус", "Код", "Товар", "Цена ¥/ед", "Вес, г", "Цена ₽/ед", "Кол-во", "Сумма ¥", "Сумма ₽"];
      const ST = { draft: "Черновик", paid: "Оплачено", transit: "В пути", received: "Получено" };
      rows = (purchaseBatches || []).flatMap((b) => {
        const cny = toNum(b.cny), usd = toNum(b.usd), cargo = toNum(b.cargo);
        return (b.items || []).map((it) => {
          const pr = products.find((p) => p.id === it.productId) || {};
          const w = toNum(pr?.purchase?.weightG), pc = toNum(it.priceCny), q = toNum(it.qty);
          const rub = (isNaN(cny) ? 0 : cny) * (isNaN(pc) ? 0 : pc) + (isNaN(cargo) ? 0 : cargo) * ((isNaN(w) ? 0 : w) / 1000) * (isNaN(usd) ? 0 : usd);
          return [b.name, ST[b.status] || "", pr.code || "", pr.name || "", it.priceCny || "", pr?.purchase?.weightG || "", Math.round(rub), it.qty || "", (isNaN(pc) || isNaN(q) ? "" : pc * q), (isNaN(q) ? "" : Math.round(rub * q))];
        });
      });
      fname = "zakupki";
    } else if (activeTab === "duties") {
      head = ["Область", "Функция", "Подфункция", "Исполнитель", "Периодичность"];
      const areaName = (id) => (duties.areas.find((a) => a.id === id) || {}).name || "";
      const personName = (id) => (duties.people.find((p) => p.id === id) || {}).name || "Не назначен";
      rows = (duties.functions || []).flatMap((f) => {
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

  return (
    <div
      style={{ fontFamily: '"Geist", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
      className="min-h-screen w-full bg-neutral-100 p-4 sm:p-6 text-neutral-900"
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');`}</style>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <div className="mx-auto max-w-full">
        {/* Шапка */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl inline-flex border border-neutral-200 bg-white p-1">
              {TABS.map((t) => {
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
            </div>
            <span className="text-sm text-neutral-400">{activeTab === "purchases" ? `${purchaseBatches.length} ${(() => { const n = purchaseBatches.length % 100, d = n % 10; return n > 10 && n < 20 ? "партий" : d === 1 ? "партия" : d >= 2 && d <= 4 ? "партии" : "партий"; })()}` : activeTab === "tasks" ? `${jobs.length} задач` : activeTab === "duties" ? `${(duties.functions || []).length} функций` : `${filteredProducts.length} товаров`}</span>
            {activeTab !== "purchases" && activeTab !== "tasks" && (
              <input value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)} placeholder="Фильтр по коду" className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ width: 140 }} />
            )}
            {activeTab !== "purchases" && activeTab !== "tasks" && (
              <div className="relative inline-block">
                <button
                  onClick={() => setStatusFilterOpen((v) => !v)}
                  className="rounded-lg inline-flex items-center gap-1.5 border bg-white px-2.5 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
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
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDbOpen(true)} className="rounded-xl inline-flex items-center gap-1.5 border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-100">
              База
            </button>
            {hasExpandable && products.length > 0 && (
              <button onClick={allOpen ? collapseAll : expandAll} className="rounded-xl inline-flex items-center gap-1.5 border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                {allOpen ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                {allOpen ? "Свернуть всё" : "Развернуть всё"}
              </button>
            )}
            <button onClick={exportCsv} className="rounded-xl inline-flex items-center gap-1.5 border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              <Download size={15} /> Экспорт CSV
            </button>
            <button onClick={() => { setSettingsTab("statuses"); setSettingsOpen(true); }} title="Настройки" className="rounded-xl inline-flex items-center gap-1.5 border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              <Settings2 size={15} /> Настройки
            </button>
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

        {/* Товары: переключатель вида список / плитки */}
        {activeTab === "assortment" && (
          <div className="mb-3 flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-neutral-100 p-0.5">
              <button onClick={() => setProductsView("list")} className={"rounded-md px-3 py-1 text-xs font-semibold transition " + (productsView === "list" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>Список</button>
              <button onClick={() => setProductsView("tiles")} className={"rounded-md px-3 py-1 text-xs font-semibold transition " + (productsView === "tiles" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>Плитки</button>
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
                {frozenCols.map((f, i) => (
                  <th
                    key={f.id}
                    rowSpan={2}
                    className="bg-neutral-50 px-2 py-2 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-neutral-500"
                    style={{ ...frozenCell(i), top: 0, zIndex: 40, borderBottom: "1px solid #e5e5e5" }}
                  >
                    {f.label}
                  </th>
                ))}
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filteredProducts.map((p) => {
              const sc = statusColor(p.status);
              return (
                <div key={p.id} className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:shadow-md">
                  <div className="relative aspect-square w-full overflow-hidden bg-neutral-50">
                    <button onClick={() => setCardModal(p.id)} className="block h-full w-full" title="Открыть карточку">
                      {p.image
                        ? <img src={p.image} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                        : <div className="flex h-full w-full items-center justify-center text-neutral-300"><ImagePlus size={28} /></div>}
                    </button>
                    {p.status && <span className="rounded-full absolute left-2 top-2 px-2 py-0.5 text-[11px] font-semibold" style={{ background: sc + "26", color: sc }}>{p.status}</span>}
                    <button onClick={() => triggerUpload(p.id)} className="rounded-lg absolute bottom-2 right-2 bg-white/90 p-1.5 text-neutral-500 opacity-0 shadow transition hover:text-neutral-800 group-hover:opacity-100" title="Загрузить фото"><ImagePlus size={14} /></button>
                    <button onClick={() => removeProduct(p.id)} className="rounded-md absolute right-2 top-2 bg-white/90 p-1 text-neutral-400 opacity-0 shadow transition hover:text-red-500 group-hover:opacity-100" title="Удалить"><Trash2 size={14} /></button>
                  </div>
                  <button onClick={() => setCardModal(p.id)} className="block w-full px-3 py-2 text-left">
                    <div className="flex items-center gap-1.5 truncate text-[11px] text-neutral-400">
                      <span className="font-semibold text-neutral-500">{p.code || "—"}</span>
                      {p.subject && <span className="truncate">· {p.subject}</span>}
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-neutral-800 group-hover:text-orange-700" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.name || <span className="text-neutral-400">Без названия</span>}</div>
                  </button>
                </div>
              );
            })}
            <button onClick={addProduct} className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 text-neutral-400 transition hover:border-orange-300 hover:bg-orange-50/30 hover:text-orange-600">
              <Plus size={22} /> <span className="text-sm font-medium">Добавить товар</span>
            </button>
          </div>
        )}

        {activeTab === "purchases" && (
          <PurchasesBoard
            batches={purchaseBatches}
            onChange={setPurchaseBatches}
            products={products}
            defaultRates={{ cny: unitConst.cny, usd: unitConst.usd, cargo: unitConst.cargo }}
          />
        )}

        {activeTab === "tasks" && (
          <TasksView
            jobs={jobs}
            taskLabels={taskLabels}
            products={products}
            opTypes={opTypes}
            opDone={opDone}
            onToggleDone={toggleOpDone}
            onEditOp={(op) => setOpEditor({ ...op })}
            onAddJob={(preset) => setJobEditor({ id: uid(), title: "", date: null, start: null, done: false, labelId: null, productId: null, _new: true, ...preset })}
            onOpen={(job) => setJobEditor({ ...job })}
          />
        )}

        {activeTab === "strategy" && (
          <StrategySection
            strategy={strategy}
            onChange={setStrategy}
            onCreateTask={(title, date) => upsertJob({ id: uid(), title: (title || "Задача").slice(0, 200), date: date || null, start: null, done: false, labelId: null, productId: null })}
          />
        )}

        {activeTab === "duties" && (
          <DutiesBoard
            duties={duties}
            onChange={setDuties}
            opNames={(opTypes || []).map((o) => o.name)}
            onAddOp={(name, recur) => {
              const t = (name || "").trim();
              if (!t) return "empty";
              if ((opTypes || []).some((o) => o.name === t)) return "exists";
              setOpTypes((list) => [...(list || []), { id: uid(), name: t, recur: normRecur(recur) }]);
              return "added";
            }}
          />
        )}
      </div>

      {jobEditor && (
        <JobEditor
          job={jobEditor}
          taskLabels={taskLabels}
          products={products}
          opTypes={opTypes}
          onSave={(j) => { const { _new, ...rest } = j; if (rest.title.trim()) upsertJob(rest); setJobEditor(null); }}
          onDelete={(id) => { removeJob(id); setJobEditor(null); }}
          onClose={() => setJobEditor(null)}
        />
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
          statuses={statuses}
          setStatuses={setStatuses}
          defaultTasks={defaultTasks}
          setDefaultTasks={setDefaultTasks}
          taskLabels={taskLabels}
          setTaskLabels={setTaskLabels}
          opTypes={opTypes}
          setOpTypes={setOpTypes}
          subjects={subjects}
          setSubjects={setSubjects}
          unitConst={unitConst}
          setUnitConst={setUnitConst}
          initialTab={settingsTab}
          wbApiKey={wbApiKey}
          setWbApiKey={setWbApiKey}
          onFetchWb={() => { setSettingsOpen(false); fetchWbOrders(); }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {cardModal && (() => {
        const cp = products.find((x) => x.id === cardModal);
        if (!cp) return null;
        return (
          <CardTasksModal
            product={withConst(cp)}
            defaultTasks={defaultTasks}
            taskLabels={taskLabels}
            onSetName={(v) => updateProduct(cp.id, "name", v)}
            onSetTasks={(tasks) => setProductTasks(cp.id, tasks)}
            onSetCompetitors={(c) => setProductCompetitors(cp.id, c)}
            onSetSeasonality={(s) => setProductSeasonality(cp.id, s)}
            onSetField={(f, v) => updateProduct(cp.id, f, v)}
            productList={products}
            onCalEntry={(v) => setCalEntry(cp.id, v)}
            onCalStart={(v) => setCalStart(cp.id, v)}
            onCalName={(v) => setCalName(cp.id, v)}
            onCalComponents={(c) => setCalComponents(cp.id, c)}
            onCalBuffer={(v) => setCalBuffer(cp.id, v)}
            onCalCopyFrom={(sid) => copyCalendarFrom(cp.id, sid)}
            hiddenTasks={hiddenTasks}
            rnpStartDate={rnpStartDate}
            rnpDays={rnpDays}
            onSetRnpStartDate={setRnpStartDate}
            onSetRnpDays={setRnpDays}
            onSetRnpCell={(k, v) => setRnpCell(cp.id, k, v)}
            onSetRnpEntries={(k, arr) => setRnpEntries(cp.id, k, arr)}
            onSetRnpFill={(k, c) => setRnpFill(cp.id, k, c)}
            onSetRnpFlag={(f, v) => setRnpFlag(cp.id, f, v)}
            onSetRnpBudget={(v) => setRnpBudget(cp.id, v)}
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
              refSources={{ bloggerDB, razdachDB }}
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
            refSources={{ bloggerDB, razdachDB }}
            onSetEntries={(k, arr) => setRnpEntries(gp.id, k, arr)}
            onClose={close}
          />
        );
      })()}

      {dbOpen && (() => {
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
          { id: "name", label: "Исполнитель", type: "text" },
          { id: "inst", label: "Инстаграм", type: "link" },
          { id: "tg", label: "Телеграм", type: "link" },
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
        const TabChip = ({ id, name, custom }) => (
          <span className={"group/chip inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-semibold transition " + (active === id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>
            <button onClick={() => setDbActive(id)}>{name}</button>
            {custom && active === id && <button onClick={() => removeType(id)} className="rounded p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить вид"><X size={12} /></button>}
          </span>
        );
        const tabs = (
          <div className="mt-2 inline-flex flex-wrap items-center gap-1 rounded-lg bg-neutral-100 p-0.5">
            <TabChip id="blogger" name="Блогеры" />
            <TabChip id="razdach" name="Раздачницы" />
            {(customDBs || []).map((c) => <TabChip key={c.id} id={c.id} name={c.name} custom />)}
            <button onClick={addType} className="rounded-md px-2 py-1 text-sm font-semibold text-neutral-400 hover:text-neutral-700" title="Добавить вид">+ Вид</button>
          </div>
        );
        return (
          <RefDB
            key={active}
            title={cfg.title}
            tabs={tabs}
            fields={cfg.fields}
            rows={cfg.rows}
            setRows={cfg.setRows}
            onClose={() => setDbOpen(false)}
          />
        );
      })()}

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
  const functions = Array.isArray(v.functions) ? v.functions.filter((f) => f && typeof f === "object").map((f) => ({ id: f.id || uid(), areaId: f.areaId || null, name: f.name || "", assignee: f.assignee || null, recur: normRecur(f.recur), subs: Array.isArray(f.subs) ? f.subs.map(normSub) : [] })) : [];
  return { areas, people, functions };
}

function DutiesBoard({ duties, onChange, onAddOp, opNames }) {
  const d = duties && duties.areas ? duties : normDuties(duties);
  const inTasks = new Set((opNames || []).map((n) => (n || "").trim()).filter(Boolean));
  const [expanded, setExpanded] = useState(() => new Set());
  const [toast, setToast] = useState("");
  const [filterArea, setFilterArea] = useState(null);
  const [filterPerson, setFilterPerson] = useState(null);
  const [fpOpen, setFpOpen] = useState(false);
  const [asgKey, setAsgKey] = useState(null);
  const [recKey, setRecKey] = useState(null);
  const [manageOpen, setManageOpen] = useState(false);
  const personById = Object.fromEntries(d.people.map((p) => [p.id, p]));
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 1800); return () => clearTimeout(t); }, [toast]);
  const addToTasks = (sub) => {
    const r = onAddOp ? onAddOp(sub.name, sub.recur) : "empty";
    setToast(r === "added" ? "Добавлено в Задачи" : r === "exists" ? "Уже в Задачах" : "Введите название подзадачи");
  };

  // Все мутации читают АКТУАЛЬНОЕ состояние из рефа, а не из устаревшего замыкания —
  // иначе быстрый ввод и перерисовки от облачного эха могли бы затирать правки.
  const stateRef = useRef(d); stateRef.current = d;
  const save = (next) => { stateRef.current = next; onChange(next); };
  const patchFn = (fid, p) => { const c = stateRef.current; save({ ...c, functions: c.functions.map((f) => (f.id === fid ? { ...f, ...p } : f)) }); };
  const patchSub = (fid, sid, p) => { const c = stateRef.current; save({ ...c, functions: c.functions.map((f) => (f.id === fid ? { ...f, subs: f.subs.map((s) => (s.id === sid ? { ...s, ...p } : s)) } : f)) }); };
  const addFunction = () => { const c = stateRef.current; const areaId = filterArea || c.areas[0]?.id || null; const id = uid(); save({ ...c, functions: [...c.functions, { id, areaId, name: "", assignee: null, recur: normRecur(null), subs: [] }] }); setExpanded((s) => new Set(s).add(id)); };
  const addFunctionTo = (areaId) => { const c = stateRef.current; const id = uid(); save({ ...c, functions: [...c.functions, { id, areaId, name: "", assignee: null, recur: normRecur(null), subs: [] }] }); setExpanded((s) => new Set(s).add(id)); };
  const removeFunction = (fid) => { const c = stateRef.current; save({ ...c, functions: c.functions.filter((f) => f.id !== fid) }); };
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
  let groups = [...d.areas.map((a) => ({ area: a, fns: d.functions.filter((f) => f.areaId === a.id) })), ...(orphan.length ? [{ area: null, fns: orphan }] : [])];
  if (filterArea) groups = groups.filter((g) => g.area && g.area.id === filterArea);
  const fpMatch = (f) => !filterPerson || f.assignee === filterPerson || f.subs.some((s) => s.assignee === filterPerson);

  const Avatar = ({ p, sm }) => <span className={"flex items-center justify-center rounded-full font-bold text-white " + (sm ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]")} style={{ background: p ? p.color : "#cfcfd6" }}>{p ? (p.name[0] || "?").toUpperCase() : "?"}</span>;

  const Pill = ({ who, k, onPick }) => {
    const p = who ? personById[who] : null; const open = asgKey === k;
    return (
      <span className="relative shrink-0">
        <button onClick={(e) => { e.stopPropagation(); setAsgKey(open ? null : k); setRecKey(null); }} className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 py-0.5 pl-0.5 pr-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
          <Avatar p={p} sm /><span className={p ? "" : "text-neutral-400"}>{p ? p.name : "Не назначен"}</span><ChevronDown size={11} className="text-neutral-300" />
        </button>
        {open && <><div className="fixed inset-0 z-10" onClick={() => setAsgKey(null)} /><div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
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
          <button onClick={addFunction} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800"><Plus size={14} /> Функция</button>
          <button onClick={() => setManageOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"><Users size={14} /> Управление</button>
        </div>
        {/* фильтры */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-100 px-4 py-2.5">
          <button onClick={() => setFilterArea(null)} className={"rounded-full px-3 py-1 text-xs font-semibold " + (!filterArea ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200")}>Все области</button>
          {d.areas.map((a) => <button key={a.id} onClick={() => setFilterArea(filterArea === a.id ? null : a.id)} className={"inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold " + (filterArea === a.id ? "text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200")} style={filterArea === a.id ? { background: a.color } : undefined}><span className="h-2 w-2 rounded-full" style={{ background: a.color }} />{a.name}</button>)}
          <div className="relative ml-2">
            <button onClick={() => setFpOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">{filterPerson ? (personById[filterPerson]?.name || "Исполнитель") : "Все исполнители"} <ChevronDown size={11} /></button>
            {fpOpen && <><div className="fixed inset-0 z-10" onClick={() => setFpOpen(false)} /><div className="absolute left-0 z-20 mt-1 w-44 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
              <button onClick={() => { setFilterPerson(null); setFpOpen(false); }} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-50">Все исполнители</button>
              {d.people.map((pp) => <button key={pp.id} onClick={() => { setFilterPerson(pp.id); setFpOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50"><Avatar p={pp} sm />{pp.name}</button>)}
            </div></>}
          </div>
        </div>

        {/* группы по областям */}
        {groups.map((g) => {
          const fns = g.fns.filter(fpMatch);
          const subCount = g.fns.reduce((a, f) => a + f.subs.length, 0);
          return (
            <div key={g.area ? g.area.id : "none"}>
              <div className="flex items-center gap-2 px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: g.area ? g.area.color : "#a3a3a3" }}>
                <span className="h-2.5 w-2.5 rounded" style={{ background: g.area ? g.area.color : "#cfcfd6" }} />{g.area ? g.area.name : "Без области"}
                <span className="font-semibold text-neutral-300">· {g.fns.length} функ. · {subCount} подф.</span>
              </div>
              {fns.map((f) => {
                const isOpen = expanded.has(f.id);
                return (
                  <div key={f.id} className="border-t border-neutral-100">
                    <div className="flex items-center gap-2 px-4 py-2">
                      <button onClick={() => setExpanded((s) => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })} className="shrink-0 text-neutral-300 hover:text-neutral-600" title={isOpen ? "Свернуть" : "Подфункции"}>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
                      <input value={f.name} onChange={(e) => patchFn(f.id, { name: e.target.value })} placeholder="Название функции…" className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-neutral-800 focus:outline-none" />
                      {f.subs.length > 0 && <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 text-[10px] font-semibold text-neutral-400">{f.subs.length}</span>}
                      <RecBadge recur={f.recur} k={`f:${f.id}`} onChange={(r) => patchFn(f.id, { recur: r })} />
                      <Pill who={f.assignee} k={`f:${f.id}`} onPick={(pid) => patchFn(f.id, { assignee: pid })} />
                      <button onClick={() => removeFunction(f.id)} className="shrink-0 text-neutral-300 hover:text-red-500" title="Удалить функцию"><X size={14} /></button>
                    </div>
                    {isOpen && (
                      <div className="flex flex-col gap-1 pb-2 pl-11 pr-4">
                        {f.subs.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 border-t border-dashed border-neutral-100 py-1.5">
                            <input value={s.name} onChange={(e) => patchSub(f.id, s.id, { name: e.target.value })} placeholder="Подфункция…" className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-600 focus:outline-none" />
                            <RecBadge recur={s.recur} k={`s:${f.id}:${s.id}`} onChange={(r) => patchSub(f.id, s.id, { recur: r })} />
                            <Pill who={s.assignee} k={`s:${f.id}:${s.id}`} onPick={(pid) => patchSub(f.id, s.id, { assignee: pid })} />
                            {(() => { const inT = inTasks.has((s.name || "").trim()); return (
                              <button onClick={() => addToTasks(s)} className={"shrink-0 rounded-md p-1 " + (inT ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100" : "text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700")} title={inT ? "Уже в Задачах" : "Добавить в Задачи (операционная задача)"}><CalendarPlus size={14} /></button>
                            ); })()}
                            <button onClick={() => removeSub(f.id, s.id)} className="shrink-0 text-neutral-300 hover:text-red-500"><X size={13} /></button>
                          </div>
                        ))}
                        <button onClick={() => addSub(f.id)} className="mt-0.5 inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-neutral-400 hover:text-neutral-600"><Plus size={12} /> Подфункция</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {g.area && !filterPerson && <button onClick={() => addFunctionTo(g.area.id)} className="m-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-400 hover:border-neutral-300 hover:text-neutral-600"><Plus size={13} /> Функция в «{g.area.name}»</button>}
            </div>
          );
        })}
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

      {toast && <div className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">{toast}</div>}
    </div>
  );
}

// Статусы партии закупки
const PU_STATUS = { draft: { label: "Черновик", cls: "bg-neutral-100 text-neutral-500" }, paid: { label: "Оплачено", cls: "bg-emerald-50 text-emerald-600" }, transit: { label: "В пути", cls: "bg-amber-50 text-amber-600" }, received: { label: "Получено", cls: "bg-blue-50 text-blue-600" } };

// Блок «Закупки» — партии (как карты в «Стратегии»); внутри партии товары из каталога.
function PurchasesBoard({ batches, onChange, products, defaultRates }) {
  const list = Array.isArray(batches) ? batches : [];
  const [activeId, setActiveId] = useState(list[0]?.id || null);
  const [editingId, setEditingId] = useState(null);
  const [picker, setPicker] = useState(false);
  const [pq, setPq] = useState("");
  const [stOpen, setStOpen] = useState(false);
  const active = list.find((b) => b.id === activeId) || list[0] || null;

  const addBatch = () => { const id = uid(); const b = { id, name: `Партия #${list.length + 1}`, status: "draft", cny: defaultRates.cny || "", usd: defaultRates.usd || "", cargo: defaultRates.cargo || "", items: [] }; onChange([...list, b]); setActiveId(id); };
  const dupBatch = (id) => { const src = list.find((b) => b.id === id); if (!src) return; const nid = uid(); const copy = JSON.parse(JSON.stringify({ ...src, id: nid, name: `${src.name} (копия)`, items: (src.items || []).map((it) => ({ ...it, id: uid() })) })); const at = list.findIndex((b) => b.id === id); const next = list.slice(); next.splice(at + 1, 0, copy); onChange(next); setActiveId(nid); };
  const renameBatch = (id, name) => onChange(list.map((b) => (b.id === id ? { ...b, name: name.trim() || "Партия" } : b)));
  const removeBatch = (id) => { const rest = list.filter((b) => b.id !== id); onChange(rest); if (id === activeId) setActiveId(rest[0]?.id || null); };
  const patchBatch = (p) => onChange(list.map((b) => (b.id === active.id ? { ...b, ...p } : b)));
  const addItem = (productId) => { patchBatch({ items: [...(active.items || []), { id: uid(), productId, priceCny: "", qty: "" }] }); setPicker(false); setPq(""); };
  const setItem = (iid, k, v) => patchBatch({ items: active.items.map((it) => (it.id === iid ? { ...it, [k]: v } : it)) });
  const removeItem = (iid) => patchBatch({ items: active.items.filter((it) => it.id !== iid) });

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
  const prodById = Object.fromEntries((products || []).map((p) => [p.id, p]));
  const rows = (active.items || []).map((it) => {
    const p = prodById[it.productId] || {};
    const w = toNum(p?.purchase?.weightG), pc = toNum(it.priceCny), q = toNum(it.qty);
    const hasUnit = !isNaN(pc);
    const rubUnit = (isNaN(cny) ? 0 : cny) * (isNaN(pc) ? 0 : pc) + (isNaN(cargo) ? 0 : cargo) * ((isNaN(w) ? 0 : w) / 1000) * (isNaN(usd) ? 0 : usd);
    return { it, p, w, rubUnit: hasUnit ? rubUnit : NaN, sumCny: (!isNaN(pc) && !isNaN(q)) ? pc * q : NaN, sumRub: (hasUnit && !isNaN(q)) ? rubUnit * q : NaN, wkg: (isNaN(w) ? 0 : w) / 1000 * (isNaN(q) ? 0 : q) };
  });
  const tot = rows.reduce((a, r) => ({ qty: a.qty + (isNaN(toNum(r.it.qty)) ? 0 : toNum(r.it.qty)), cnySum: a.cnySum + (isNaN(r.sumCny) ? 0 : r.sumCny), rubSum: a.rubSum + (isNaN(r.sumRub) ? 0 : r.sumRub), wkg: a.wkg + r.wkg }), { qty: 0, cnySum: 0, rubSum: 0, wkg: 0 });

  const inBatch = new Set((active.items || []).map((it) => it.productId));
  const q = pq.trim().toLowerCase();
  const pcands = (products || []).filter((p) => !inBatch.has(p.id)).filter((p) => !q || (p.code || "").toLowerCase().includes(q) || (p.name || "").toLowerCase().includes(q));
  const stCur = PU_STATUS[active.status] || PU_STATUS.draft;
  const rate = (label, k, suffix) => (
    <label className="flex items-center gap-1.5 text-xs text-neutral-500">{label}
      <input value={active[k] ?? ""} onChange={(e) => patchBatch({ [k]: e.target.value })} inputMode="decimal" className="w-16 rounded-md border border-neutral-200 px-2 py-1 text-right text-sm text-neutral-800 focus:outline-none focus:ring-2 focus:ring-orange-200" />
      <span className="text-neutral-400">{suffix}</span>
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((b) => {
          const on = b.id === active.id;
          if (editingId === b.id) return <input key={b.id} autoFocus defaultValue={b.name} onBlur={(e) => { renameBatch(b.id, e.target.value); setEditingId(null); }} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); else if (e.key === "Escape") setEditingId(null); }} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-800 focus:outline-none" style={{ width: 160 }} />;
          return (
            <button key={b.id} onClick={() => setActiveId(b.id)} onDoubleClick={() => setEditingId(b.id)} title="Клик — открыть · двойной клик — переименовать" className={"inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition " + (on ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200")}>
              <span className="max-w-[200px] truncate">{b.name}</span>
              {on && (<><Pencil size={12} className="opacity-70 hover:opacity-100" onClick={(e) => { e.stopPropagation(); setEditingId(b.id); }} /><Copy size={12} className="opacity-70 hover:opacity-100" onClick={(e) => { e.stopPropagation(); dupBatch(b.id); }} /><Trash2 size={12} className="opacity-70 hover:opacity-100 hover:text-red-300" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Удалить партию «${b.name}»?`)) removeBatch(b.id); }} /></>)}
            </button>
          );
        })}
        <button onClick={addBatch} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"><Plus size={14} /> Партия</button>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 px-4 py-3">
          <div className="relative">
            <button onClick={() => setStOpen((o) => !o)} className={"inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold " + stCur.cls}>{stCur.label} <ChevronDown size={12} /></button>
            {stOpen && <><div className="fixed inset-0 z-10" onClick={() => setStOpen(false)} /><div className="absolute left-0 z-20 mt-1 w-44 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">{Object.keys(PU_STATUS).map((k) => <button key={k} onClick={() => { patchBatch({ status: k }); setStOpen(false); }} className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-neutral-50"><span className={"rounded-full px-2 py-0.5 text-[11px] font-bold " + PU_STATUS[k].cls}>{PU_STATUS[k].label}</span></button>)}</div></>}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-l border-neutral-200 pl-3">{rate("Курс ¥", "cny", "₽")}{rate("Курс $", "usd", "₽")}{rate("Карго", "cargo", "$/кг")}</div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {[["Позиций", rows.length], ["Кол-во", tot.qty.toLocaleString("ru-RU")], ["Вес", (Math.round(tot.wkg * 10) / 10).toLocaleString("ru-RU") + " кг"], ["Сумма ¥", fmtCny(tot.cnySum)], ["Сумма ₽", fmtRub(tot.rubSum)]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-neutral-50 px-3 py-1.5"><div className="text-[10px] uppercase tracking-wide text-neutral-400">{k}</div><div className="text-sm font-bold text-neutral-800">{v}</div></div>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr className="text-[10px] uppercase tracking-wide text-neutral-400">
              <th className="px-3 py-2 text-left font-semibold">Товар</th>
              <th className="px-3 py-2 text-right font-semibold">Цена ¥/ед</th>
              <th className="px-3 py-2 text-right font-semibold">Вес, г</th>
              <th className="px-3 py-2 text-right font-semibold">Цена ₽/ед</th>
              <th className="px-3 py-2 text-right font-semibold">Кол-во</th>
              <th className="px-3 py-2 text-right font-semibold">Сумма ¥</th>
              <th className="px-3 py-2 text-right font-semibold">Сумма ₽</th>
              <th className="px-3 py-2 text-left font-semibold">Ссылка</th>
              <th className="px-3 py-2" />
            </tr></thead>
            <tbody>
              {rows.map(({ it, p, w, rubUnit, sumCny, sumRub }) => (
                <tr key={it.id} className="border-t border-neutral-100 text-sm text-neutral-700">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-11 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-100 text-neutral-300">{p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={14} />}</div>
                      <div className="min-w-0"><div className="text-[11px] text-neutral-400">{p.code || "—"}</div><div className="truncate font-medium text-neutral-800" style={{ maxWidth: 230 }}>{p.name || "Без названия"}</div></div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right"><input value={it.priceCny} onChange={(e) => setItem(it.id, "priceCny", e.target.value)} inputMode="decimal" placeholder="0" className="w-16 rounded-md border border-neutral-200 px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-orange-200" /></td>
                  <td className="px-3 py-2 text-right text-neutral-500">{isNaN(w) ? "—" : w}</td>
                  <td className="px-3 py-2 text-right text-neutral-500">{fmtRub(rubUnit)}</td>
                  <td className="px-3 py-2 text-right"><input value={it.qty} onChange={(e) => setItem(it.id, "qty", e.target.value)} inputMode="numeric" placeholder="0" className="w-16 rounded-md border border-neutral-200 px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-orange-200" /></td>
                  <td className="px-3 py-2 text-right">{fmtCny(sumCny)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-neutral-900">{fmtRub(sumRub)}</td>
                  <td className="px-3 py-2 text-left">{p?.purchase?.link ? <a href={p.purchase.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">ссылка <ExternalLink size={11} /></a> : <span className="text-xs text-neutral-300">—</span>}</td>
                  <td className="px-3 py-2 text-right"><button onClick={() => removeItem(it.id)} className="text-neutral-300 hover:text-red-500" title="Убрать из партии"><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="relative border-t border-neutral-100 px-3 py-3">
          <button onClick={() => setPicker((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"><Plus size={14} /> Товар в партию</button>
          {picker && <><div className="fixed inset-0 z-30" onClick={() => { setPicker(false); setPq(""); }} />
            <div className="absolute left-3 top-full z-40 mt-1 w-80 rounded-xl border border-neutral-200 bg-white p-2 shadow-xl">
              <input autoFocus value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Поиск по коду или названию…" className="mb-2 w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
              <div className="max-h-72 overflow-auto">
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

function GanttBlock({ product, hiddenTasks = {}, startDate, days, onSetStartDate, onSetDays, onSetCell, onSetEntries, onSetFill, onSetFlag, onSetBudget, onOpenPopup, onOpenDB, wbOrders = {}, wbLoading, wbProgress, onFetchWb, hideBudget = false }) {
  const [fillMode, setFillMode] = useState(false);
  const [fillColor, setFillColor] = useState(FILL_COLORS[0]);
  const [bd, setBd] = useState(null); // позиция окна разбивки затрат
  const bdBtnRef = useRef(null);
  const openBd = () => {
    const r = bdBtnRef.current?.getBoundingClientRect();
    if (r) setBd({ x: Math.min(r.left, (typeof window !== "undefined" ? window.innerWidth : 400) - 300), y: r.bottom + 6 });
  };

  const tasks = RNP_TASKS.filter((t) => !hiddenTasks[t.id]);

  const cells = product.rnp.cells || {};
  const entries = product.rnp.entries || {};
  const fills = product.rnp.fills || {};
  const flags = product.rnp.flags || {};
  const budget = product.rnp.budget || { allocated: "" };
  const dayList = buildDays(startDate, days);

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
      : (() => { const n = toNum(cells[`${task.id}:cost:${dkey}`]); return isNaN(n) ? 0 : n; })();
  };
  const taskTotal = (task) => {
    if (task.kind === "rangeTask") return rangeEntries(task).reduce((a, e) => a + recordCost(task, e), 0);
    return task.top === "entries"
      ? Object.entries(entries).reduce((a, [k, arr]) => a + (k.startsWith(task.id + ":") && !k.endsWith(":_ranges") ? entrySum(task, arr) : 0), 0)
      : Object.entries(cells).reduce((a, [k, v]) => { if (k.startsWith(task.id + ":cost:")) { const n = toNum(v); if (!isNaN(n)) return a + n; } return a; }, 0);
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
    const base = { width: DAY_W, minWidth: DAY_W, position: "relative", borderTop: "1px solid #f5f5f5", borderLeft: isToday ? "1px solid #ea580c" : "1px solid #f5f5f5", borderRight: isToday ? "1px solid #ea580c" : "none", background: baseBg };

    if (task.kind === "wbOrders") {
      const code = product.code || product.wb || "";
      const count = wbOrders[`${code}:${d.key}`] || wbOrders[`${product.wb}:${d.key}`] || 0;
      return (
        <td key={d.key} style={{ ...base, background: count > 0 ? "#f0fdf4" : baseBg }}>
          <div className="px-1 py-0.5 text-center text-xs font-semibold text-neutral-700" style={{ minHeight: 26, fontVariantNumeric: "tabular-nums" }}>
            {count > 0 ? count : <span className="text-neutral-300">—</span>}
          </div>
        </td>
      );
    }
    if (task.kind === "singleCost") {
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
        <td key={d.key} style={{ width: DAY_W, minWidth: DAY_W, borderTop: "1px solid #f5f5f5", borderLeft: "1px solid #f5f5f5", background: "#fff" }}>
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

      <div style={{ overflowX: "auto", paddingBottom: 12 }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ ...sticky(0, LBL_W, "#fafafa", 4), borderTopLeftRadius: 8, borderBottom: "1px solid #e5e5e5" }}></th>
              {dayList.map((d) => (
                <th key={d.key} style={{ width: DAY_W, minWidth: DAY_W, background: d.weekend ? "#f5f5f5" : "#fafafa", borderLeft: d.key === today ? "1px solid #ea580c" : "1px solid #e5e5e5", borderRight: d.key === today ? "1px solid #ea580c" : "none", borderTop: d.key === today ? "1px solid #ea580c" : "none" }} className="px-0.5 py-1 text-center">
                  {d.firstOfMonth && <div className="font-bold text-orange-600" style={{ fontSize: 9 }}>{MONTHS[d.month]} {d.key.slice(2, 4)}</div>}
                  <div className="text-xs font-semibold text-neutral-600">{String(d.day).padStart(2, "0")}</div>
                  <div className="text-neutral-400" style={{ fontSize: 9 }}>{d.wd}</div>
                </th>
              ))}
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
                        ) : task.kind === "wbOrders" ? (
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
      <div className="rounded-2xl w-full max-w-lg overflow-auto bg-white p-5 shadow-xl" style={{ maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
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
      <div className="rounded-2xl w-full overflow-auto bg-white p-5 shadow-xl" style={{ maxWidth: "min(1100px, 95vw)", maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
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

function RefDB({ title, fields, rows, setRows, tabs, onClose }) {
  const fileRef = useRef(null);
  const target = useRef(null);

  const add = () => {
    const r = { id: uid() };
    fields.forEach((f) => { if (f.type === "calc") return; r[f.id] = f.type === "select" ? (f.options[0]?.value ?? "") : ""; });
    setRows((prev) => [...prev, r]);
  };
  const set = (id, field, val) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  const remove = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  const pickImage = (id) => { target.current = id; fileRef.current?.click(); };
  const onFile = async (e) => {
    const f = e.target.files?.[0]; const id = target.current; e.target.value = "";
    if (!f || !id) return;
    try { set(id, "image", await fileToThumb(f, 96)); } catch (err) { console.error("[Фото] не удалось обработать:", err); }
  };

  const inp = "w-full rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      <div className="w-full overflow-auto rounded-2xl bg-white p-5 shadow-xl" style={{ maxWidth: "min(1100px, 95vw)", maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">База <span className="text-neutral-400">· {title}</span></h2>
            <p className="text-sm text-neutral-400">{rows.length} записей</p>
            {tabs}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
        </div>

        <div className="overflow-auto rounded-xl border border-neutral-200">
          <table className="text-sm" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
            <thead>
              <tr>
                {fields.map((f) => (
                  <th key={f.id} className="bg-neutral-50 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500" style={{ borderBottom: "1px solid #e5e5e5", minWidth: f.type === "image" ? 64 : f.type === "link" ? 160 : f.type === "text" ? 160 : f.type === "select" ? 130 : 110 }}>{f.label}</th>
                ))}
                <th className="bg-neutral-50 px-2 py-2" style={{ borderBottom: "1px solid #e5e5e5", width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="group">
                  {fields.map((f) => (
                    <td key={f.id} className="px-2 py-1.5" style={{ borderBottom: "1px solid #f5f5f5" }}>
                      {f.type === "image" ? (
                        <button onClick={() => pickImage(r.id)} className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-400 hover:border-neutral-300">
                          {r.image ? <img src={r.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={14} />}
                        </button>
                      ) : f.type === "stars" ? (
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button key={star} onClick={() => set(r.id, f.id, (toNum(r[f.id]) === star ? 0 : star).toString())} className="text-lg leading-none transition" style={{ color: star <= (toNum(r[f.id]) || 0) ? "#f59e0b" : "#e5e5e5" }}>★</button>
                          ))}
                        </div>
                      ) : f.type === "link" ? (
                        <div className="flex items-center gap-1">
                          <input value={r[f.id] ?? ""} onChange={(e) => set(r.id, f.id, e.target.value)} placeholder="https://…" className={inp} />
                          {r[f.id] && <a href={r[f.id]} target="_blank" rel="noopener noreferrer" className="shrink-0 text-orange-600 hover:text-orange-800"><ArrowRight size={13} /></a>}
                        </div>
                      ) : f.type === "select" ? (
                        (() => {
                          const opt = f.options.find((o) => o.value === r[f.id]) || f.options[0];
                          return (
                            <select
                              value={r[f.id] ?? ""}
                              onChange={(e) => set(r.id, f.id, e.target.value)}
                              className="w-full cursor-pointer rounded-lg border-0 px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-200"
                              style={{ background: (opt?.color || "#a3a3a3") + "1f", color: opt?.color || "#a3a3a3" }}
                            >
                              {f.options.map((o) => (
                                <option key={o.value} value={o.value} style={{ color: "#171717" }}>{o.value}</option>
                              ))}
                            </select>
                          );
                        })()
                      ) : f.type === "calc" ? (
                        <div className="px-1.5 py-1 text-right text-sm font-semibold text-neutral-700" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {f.fn(r) || <span className="font-normal text-neutral-300">0</span>}
                        </div>
                      ) : f.type === "num" ? (
                        <input value={r[f.id] ?? ""} onChange={(e) => set(r.id, f.id, e.target.value)} inputMode="decimal" className={inp + " text-right"} style={{ fontVariantNumeric: "tabular-nums" }} />
                      ) : (
                        <input value={r[f.id] ?? ""} onChange={(e) => set(r.id, f.id, e.target.value)} className={inp} />
                      )}
                    </td>
                  ))}
                  <td className="px-1 text-center" style={{ borderBottom: "1px solid #f5f5f5" }}>
                    <button onClick={() => remove(r.id)} className="rounded-md p-1 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={fields.length + 1} className="px-3 py-8 text-center text-sm text-neutral-400">Пока нет записей</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3">
          <button onClick={add} className="rounded-lg inline-flex items-center gap-1.5 border border-dashed border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-500 hover:bg-neutral-50">
            <Plus size={14} /> Добавить
          </button>
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
                    <span className="min-w-0 flex-1 truncate text-neutral-600">{t.label}{a.count ? " ·" + a.count : ""}</span>
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
              const code = product.code || product.wb || "";
              const c = wbOrders[`${code}:${dkey}`] || wbOrders[`${product.wb}:${dkey}`] || 0;
              return (<div key={t.id} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2"><span className="inline-flex items-center gap-2 text-sm text-neutral-700">{dot}{t.label}</span><span className="ml-auto text-sm font-semibold tabular-nums text-neutral-700">{c || "—"}</span></div>);
            }
            if (t.kind === "singleCost") {
              return (<div key={t.id} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2"><span className="inline-flex items-center gap-2 text-sm text-neutral-700">{dot}{t.label}</span><div className="ml-auto flex items-center gap-1"><input value={cells[`${t.id}:cost:${dkey}`] ?? ""} onChange={(e) => onSetCell(`${t.id}:cost:${dkey}`, e.target.value)} inputMode="decimal" placeholder="0" className="w-24 rounded-lg border border-neutral-200 px-2 py-1 text-right text-sm tabular-nums focus:border-neutral-400 focus:outline-none" /><span className="text-xs text-neutral-400">₽</span></div></div>);
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

function CardTasksModal({ product, defaultTasks, taskLabels, onSetName, onSetTasks, onSetCompetitors, onSetSeasonality, onSetField, productList, onCalEntry, onCalStart, onCalName, onCalComponents, onCalBuffer, onCalCopyFrom, hiddenTasks, rnpStartDate, rnpDays, onSetRnpStartDate, onSetRnpDays, onSetRnpCell, onSetRnpEntries, onSetRnpFill, onSetRnpFlag, onSetRnpBudget, onOpenPopup, onOpenDB, wbOrders, wbLoading, wbProgress, onFetchWb, onClose }) {
  // Если у карточки ещё нет своих задач — показываем задачи по умолчанию.
  // Любое изменение «материализует» их в собственный список карточки.
  const own = Array.isArray(product.tasks) ? product.tasks : [];
  const usingDefaults = own.length === 0;
  const tasks = usingDefaults ? (defaultTasks || []).map((t) => ({ id: t.id, text: t.text, done: false, labelId: t.labelId || null })) : own;
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
  const setPu = (k, v) => onSetField && onSetField("purchase", { ...(product.purchase || {}), [k]: v });
  const puCny = toNum(product.cny), puUsd = toNum(product.usd), puCargo = toNum(product.cargo);
  const puPriceCny = toNum(pu.priceCny), puWeightG = toNum(pu.weightG), puQty = toNum(pu.qty);
  const puRubPerUnit = !isNaN(puPriceCny)
    ? (isNaN(puCny) ? 0 : puCny) * puPriceCny + (isNaN(puCargo) ? 0 : puCargo) * ((isNaN(puWeightG) ? 0 : puWeightG) / 1000) * (isNaN(puUsd) ? 0 : puUsd)
    : NaN;
  const puLotRub = !isNaN(puRubPerUnit) && !isNaN(puQty) ? puRubPerUnit * puQty : NaN;
  const puLotCny = !isNaN(puPriceCny) && !isNaN(puQty) ? puPriceCny * puQty : NaN;
  const yuan = (n) => (isNaN(n) ? "—" : Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString("ru-RU") + " ¥" : (Math.round(n * 100) / 100).toLocaleString("ru-RU") + " ¥");
  const [mp, setMp] = useState("wb"); // маркетплейс для юнит-экономики: wb | oz
  const promoBudget = rnpBudget(product);
  const done = tasks.filter((t) => t.done).length;

  // id задач по умолчанию — такие задачи нельзя удалять из карточки
  const defaultIds = new Set((defaultTasks || []).map((t) => t.id));
  // метка задачи по умолчанию (чтобы подтягивать её в карточку, даже если
  // задача уже «материализована» без метки — например, была добавлена до меток)
  const defaultLabelMap = new Map((defaultTasks || []).map((t) => [t.id, t.labelId || null]));
  const effLabel = (t) => (t.labelId != null ? t.labelId : (defaultIds.has(t.id) ? (defaultLabelMap.get(t.id) || null) : null));
  const active = tasks.filter((t) => !t.done);
  const completed = tasks.filter((t) => t.done);

  const addTask = () => {
    const t = newText.trim();
    if (!t) return;
    onSetTasks([...tasks, { id: uid(), text: t, done: false, labelId: null }]);
    setNewText("");
  };
  const toggle = (id) => onSetTasks(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const setText = (id, text) => onSetTasks(tasks.map((t) => (t.id === id ? { ...t, text } : t)));
  const setLabel = (id, labelId) => onSetTasks(tasks.map((t) => (t.id === id ? { ...t, labelId } : t)));
  const remove = (id) => onSetTasks(tasks.filter((t) => t.id !== id));

  const renderRow = (t) => (
    <div key={t.id} className="group flex items-center gap-1.5 rounded-lg border border-neutral-100 px-1.5 py-1.5 hover:border-neutral-200">
      <input type="checkbox" checked={!!t.done} onChange={() => toggle(t.id)} className="h-4 w-4 shrink-0 accent-green-600" />
      {defaultIds.has(t.id) && <Paperclip size={13} className="shrink-0 text-neutral-400" title="Задача по умолчанию" />}
      <input
        value={t.text}
        onChange={(e) => setText(t.id, e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
        style={t.done ? { textDecoration: "line-through", color: "#a3a3a3" } : { color: "#171717" }}
      />
      <LabelSelect labels={taskLabels} value={effLabel(t)} onChange={(v) => setLabel(t.id, v)} compact />
      {defaultIds.has(t.id) ? (
        <span className="h-5 w-4 shrink-0" title="Задача по умолчанию — её нельзя удалить" />
      ) : (
        <button onClick={() => remove(t.id)} className="shrink-0 rounded p-0.5 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100" title="Удалить"><Trash2 size={14} /></button>
      )}
    </div>
  );

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

  // --- дашборды: готовность карточки по меткам ---
  const readiness = (() => {
    const map = new Map();
    tasks.forEach((t) => {
      const lid = effLabel(t) || "__none";
      const cur = map.get(lid) || { done: 0, total: 0 };
      cur.total++; if (t.done) cur.done++;
      map.set(lid, cur);
    });
    return [...map.entries()].map(([lid, v]) => {
      const lab = (taskLabels || []).find((l) => l.id === lid);
      return { id: lid, name: lab ? lab.name : "Без метки", color: lab ? lab.color : "#cbd5e1", done: v.done, total: v.total };
    }).sort((a, b) => b.total - a.total);
  })();
  const overallPct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const R = 30, C2 = 2 * Math.PI * R;

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
      <div className="flex items-start gap-4 border-b border-neutral-200 bg-white px-5 py-4 sm:px-8">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
          {product.image
            ? <img src={product.image} alt="" className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center text-neutral-300"><ImagePlus size={20} /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-xs text-neutral-400">
            {product.code && <span className="font-semibold text-neutral-500">{product.code}</span>}
            {product.wb && (
              <a href={`https://global.wildberries.ru/catalog/${String(product.wb).trim()}/detail.aspx`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-sky-600">· {product.wb} <ExternalLink size={11} /></a>
            )}
          </div>
          <input
            value={product.name}
            onChange={(e) => onSetName(e.target.value)}
            placeholder="Название товара"
            className="w-full max-w-2xl rounded-lg border border-transparent px-1.5 py-1 text-xl font-semibold text-neutral-900 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        </div>
        <button onClick={onClose} className="rounded-lg shrink-0 p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" title="Закрыть"><X size={20} /></button>
      </div>

      {/* Тело — дашборды */}
      <div className="flex-1 overflow-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 lg:flex-row lg:items-start">

          {/* Левая колонка — готовность + компактные задачи */}
          <aside className="w-full space-y-3 lg:w-[27rem] lg:shrink-0">
            {/* Готовность карточки — компактно, над задачами */}
            <section className="rounded-2xl border border-neutral-200 bg-white p-3">
              <div className="flex items-center gap-3">
                <svg width="52" height="52" viewBox="0 0 72 72" className="shrink-0">
                  <circle cx="36" cy="36" r={R} fill="none" stroke="#f1f5f9" strokeWidth="9" />
                  <circle cx="36" cy="36" r={R} fill="none" stroke={overallPct === 100 ? "#16a34a" : "#f97316"} strokeWidth="9" strokeLinecap="round" strokeDasharray={C2} strokeDashoffset={C2 * (1 - overallPct / 100)} transform="rotate(-90 36 36)" />
                  <text x="36" y="42" textAnchor="middle" fontSize="19" fontWeight="700" fill="#0f172a">{overallPct}%</text>
                </svg>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {readiness.map((r) => {
                    const rp = r.total ? Math.round(r.done / r.total * 100) : 0;
                    return (
                      <div key={r.id} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
                        <span className="w-24 shrink-0 truncate text-[11px] text-neutral-600">{r.name}</span>
                        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100">
                          <div className="h-full rounded-full" style={{ width: rp + "%", background: r.color }} />
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">{r.done}/{r.total}</span>
                      </div>
                    );
                  })}
                  {readiness.length === 0 && <p className="text-[11px] text-neutral-400">Нет задач.</p>}
                </div>
              </div>
            </section>

            {card(
              "Задачи",
              <>
                <div className="mb-2">
                  <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
                    <span>{done} из {tasks.length}</span>
                    <span>{overallPct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full rounded-full bg-green-500" style={{ width: overallPct + "%" }} />
                  </div>
                </div>
                <div className="space-y-1">
                  {active.map((t) => renderRow(t))}
                  {tasks.length === 0 && <div className="py-3 text-center text-xs text-neutral-400">Задач пока нет.</div>}
                  {tasks.length > 0 && active.length === 0 && <div className="py-3 text-center text-xs text-neutral-400">Все задачи выполнены 🎉</div>}
                </div>
                {completed.length > 0 && (
                  <div className="mt-3 border-t border-neutral-100 pt-2">
                    <button onClick={() => setShowDone((v) => !v)} className="flex w-full items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-700">
                      {showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      Выполненные
                      <span className="rounded-full bg-neutral-100 px-1.5 text-[11px] font-semibold text-neutral-500">{completed.length}</span>
                    </button>
                    {showDone && <div className="mt-2 space-y-1">{completed.map((t) => renderRow(t))}</div>}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-1.5">
                  <input
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addTask()}
                    placeholder="Новая задача…"
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-neutral-400">Цена для рента:</span>
                {[50, 100, 150, 200].map((r) => {
                  const v = targetPrice(r / 100);
                  return (
                    <button
                      key={r}
                      onClick={() => !isNaN(v) && onSetField && onSetField(MP.f.price, String(Math.round(v)))}
                      disabled={isNaN(v)}
                      title={isNaN(v) ? "Заполните себестоимость" : "Поставить эту цену"}
                      className="rounded-lg border border-neutral-100 bg-neutral-50/60 px-2 py-1 text-xs transition hover:border-sky-300 hover:bg-sky-50/50 disabled:cursor-default disabled:opacity-60 disabled:hover:border-neutral-100 disabled:hover:bg-neutral-50/60"
                    >
                      <span className="text-neutral-400">{r}%</span> <b className="tabular-nums text-neutral-800">{isNaN(v) ? "—" : money(v)}</b>
                    </button>
                  );
                })}
              </div>

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

            {/* Блоки-плитки: Продвижение / Закупка / Аналитика (раскрываются на весь экран) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button onClick={() => setFullBlock("promo")} className="group relative rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:border-orange-300 hover:shadow-sm">
                <Maximize2 size={13} className="absolute right-3 top-3 text-neutral-300 transition group-hover:text-orange-500" />
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400"><span className="h-2 w-2 rounded-full bg-orange-400" /> Продвижение</div>
                <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">{promoBudget.allocated > 0 ? Math.round((promoBudget.spent / promoBudget.allocated) * 100) : 0}<span className="text-base font-semibold text-neutral-400">%</span></div>
                <div className="text-[11px] text-neutral-400">израсходовано фонда</div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, promoBudget.allocated > 0 ? (promoBudget.spent / promoBudget.allocated) * 100 : 0))}%`, background: promoBudget.ostatok < 0 ? "#ef4444" : "#f59e0b" }} /></div>
              </button>

              <button onClick={() => setFullBlock("purchase")} className="group relative rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:border-sky-300 hover:shadow-sm">
                <Maximize2 size={13} className="absolute right-3 top-3 text-neutral-300 transition group-hover:text-sky-500" />
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400"><span className="h-2 w-2 rounded-full bg-sky-400" /> Закупка</div>
                <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">{isNaN(puLotRub) ? "—" : money(puLotRub)}</div>
                <div className="text-[11px] text-neutral-400">итоговая цена партии</div>
                <div className="mt-2 text-[11px] text-neutral-400">за ед.: <b className="text-neutral-600">{isNaN(puRubPerUnit) ? "—" : money(puRubPerUnit)}</b></div>
              </button>

              <button onClick={() => setFullBlock("analytics")} className="group relative rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:border-violet-300 hover:shadow-sm">
                <Maximize2 size={13} className="absolute right-3 top-3 text-neutral-300 transition group-hover:text-violet-500" />
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400"><span className="h-2 w-2 rounded-full bg-violet-400" /> Аналитика</div>
                <div className="mt-3 text-2xl font-bold tabular-nums text-neutral-900">—</div>
                <div className="text-[11px] text-neutral-400">рейтинг карточки</div>
                <div className="mt-2 text-[11px] text-neutral-400">{competitors.length > 0 ? `конкурентов: ${competitors.length}` : "появится после анализа"}</div>
              </button>
            </div>

            {/* Полноэкранный просмотр выбранного блока */}
            {fullBlock && (
              <div className="fixed inset-0 z-[70] flex items-start justify-center bg-neutral-900/40 p-3 sm:p-6" onClick={() => setFullBlock(null)}>
                <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-5 py-3">
                    <h3 className="text-sm font-semibold text-neutral-800">{fullBlock === "promo" ? "Продвижение" : fullBlock === "purchase" ? "Закупка" : "Аналитика"}</h3>
                    {fullBlock === "promo" && (
                      <div className="ml-2 inline-flex rounded-lg bg-neutral-100 p-0.5">
                        <button onClick={() => setPromoView("gantt")} className={"rounded-md px-3 py-1 text-xs font-semibold transition " + (promoView === "gantt" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}>Гант</button>
                        <button onClick={() => setPromoView("cal")} className={"rounded-md px-3 py-1 text-xs font-semibold transition " + (promoView === "cal" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}>Календарь</button>
                      </div>
                    )}
                    <button onClick={() => setFullBlock(null)} className="ml-auto rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" title="Свернуть"><X size={18} /></button>
                  </div>
                  <div className="min-w-0 flex-1 overflow-auto p-5">

                    {fullBlock === "promo" && (
                      <>
                        <div className="mb-4 flex flex-wrap items-center gap-2">
                          <div className="rounded-xl border border-neutral-200 px-3 py-1">
                            <div className="text-[10px] text-neutral-500">Фонд маркетинга</div>
                            <div className="flex items-baseline gap-0.5"><input value={product.rnp?.budget?.allocated ?? ""} onChange={(e) => onSetRnpBudget(e.target.value)} inputMode="decimal" placeholder="0" className="w-24 bg-transparent text-sm font-bold tabular-nums text-neutral-900 focus:outline-none" /><span className="text-xs text-neutral-400">₽</span></div>
                          </div>
                          <div className="rounded-xl border border-neutral-200 px-3 py-1"><div className="text-[10px] text-neutral-500">Затраты</div><div className="text-sm font-bold tabular-nums text-neutral-800">{money(promoBudget.spent)}</div></div>
                          <div className="rounded-xl border px-3 py-1" style={{ background: promoBudget.ostatok < 0 ? "#fef2f2" : "#f0fdf4", borderColor: promoBudget.ostatok < 0 ? "#fecaca" : "#dcfce7" }}><div className="text-[10px] text-neutral-500">Остаток</div><div className="text-sm font-bold tabular-nums" style={{ color: promoBudget.ostatok < 0 ? "#b91c1c" : "#15803d" }}>{money(promoBudget.ostatok)}</div></div>
                        </div>
                        {promoView === "gantt" ? (
                          <GanttBlock product={product} hiddenTasks={hiddenTasks} startDate={rnpStartDate} days={rnpDays} onSetStartDate={onSetRnpStartDate} onSetDays={onSetRnpDays} onSetCell={onSetRnpCell} onSetEntries={onSetRnpEntries} onSetFill={onSetRnpFill} onSetFlag={onSetRnpFlag} onSetBudget={onSetRnpBudget} onOpenPopup={onOpenPopup} onOpenDB={onOpenDB} wbOrders={wbOrders} wbLoading={wbLoading} wbProgress={wbProgress} onFetchWb={onFetchWb} hideBudget />
                        ) : (
                          <PromoCalendar product={product} wbOrders={wbOrders} onOpenDay={(ds) => setPromoDay(ds)} />
                        )}
                      </>
                    )}

                    {fullBlock === "purchase" && (
                      <>
                        {(isNaN(puCny) || isNaN(puUsd) || isNaN(puCargo)) && (<p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">Укажите курс юаня, курс доллара и ставку карго в «Настройки → Единые данные» — иначе расчёт неполный.</p>)}
                        <div className="mb-4 flex flex-wrap items-center gap-2">
                          <span className="shrink-0 text-xs text-neutral-600">Ссылка</span>
                          <div className="relative min-w-[180px] flex-[2]"><input value={pu.link ?? ""} onChange={(e) => setPu("link", e.target.value)} placeholder="https://…" className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 pr-8 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />{String(pu.link || "").trim() && <a href={pu.link} target="_blank" rel="noreferrer" className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-sky-600" title="Открыть"><ExternalLink size={14} /></a>}</div>
                          <span className="shrink-0 text-xs text-neutral-600">Параметр</span>
                          <input value={pu.param ?? ""} onChange={(e) => setPu("param", e.target.value)} placeholder="цвет / размер" className="min-w-[120px] flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="space-y-2">{puField("Цена в юанях за ед.", pu.priceCny, (v) => setPu("priceCny", v), "¥")}{puField("Вес, г", pu.weightG, (v) => setPu("weightG", v), "г")}{puField("Кол-во", pu.qty, (v) => setPu("qty", v), "шт")}</div>
                          <div className="flex flex-col justify-center gap-2 rounded-xl border border-neutral-100 bg-neutral-50/60 px-3 py-2.5">{resRow("Цена в руб за ед.", money(puRubPerUnit))}{resRow("Цена партии в рублях", money(puLotRub))}{resRow("Цена партии в юанях", yuan(puLotCny))}</div>
                        </div>
                      </>
                    )}

                    {fullBlock === "analytics" && (
                      <div className="space-y-5">
                        <div>
                          <div className="mb-2 flex items-center gap-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Конкуренты</h4>{competitors.length > 0 && <span className="rounded-full bg-neutral-100 px-1.5 text-xs font-semibold text-neutral-500">{competitors.length}</span>}</div>
                          {competitors.length > 0 ? (<div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">{competitors.map((c) => (<CompetitorThumb key={c.id} url={c.url} onRemove={() => removeComp(c.id)} />))}</div>) : (<p className="text-xs text-neutral-400">Пока пусто. Вставьте ссылку на карточку конкурента на ВБ ниже.</p>)}
                          <div className="mt-3 flex items-center gap-2"><input value={compUrl} onChange={(e) => setCompUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComp()} placeholder="Ссылка на карточку ВБ…" className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" /><button onClick={addComp} disabled={!wbNmFromUrl(compUrl.trim())} className="rounded-lg inline-flex shrink-0 items-center gap-1 bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40"><Plus size={14} /> Добавить</button></div>
                        </div>
                        <div className="border-t border-neutral-100 pt-4">
                          <button onClick={() => setSeasonOpen((v) => !v)} className="mb-2 flex w-full items-center gap-2 text-left">{seasonOpen ? <ChevronDown size={15} className="text-neutral-500" /> : <ChevronRight size={15} className="text-neutral-500" />}<h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Сезонность и производство</h4>{product.seasonality?.points?.length > 0 && <span className="ml-auto rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">график построен</span>}</button>
                          {seasonOpen && <SeasonalityPanel data={product.seasonality} onChange={onSetSeasonality} cal={normalizeCalendar(product.calendar)} onSetComponents={onCalComponents} onSetBuffer={onCalBuffer} />}
                        </div>
                        <div className="border-t border-neutral-100 pt-4">
                          <button onClick={() => setCalBlockOpen((v) => !v)} className="mb-2 flex w-full items-center gap-2 text-left">{calBlockOpen ? <ChevronDown size={15} className="text-neutral-500" /> : <ChevronRight size={15} className="text-neutral-500" />}<h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Подробный календарь по датам</h4></button>
                          {calBlockOpen && (<CalendarBlock product={product} productList={productList || []} onSetEntry={onCalEntry} onSetStart={onCalStart} onSetName={onCalName} onSetComponents={onCalComponents} onCopyFrom={onCalCopyFrom} />)}
                        </div>
                      </div>
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

function TasksView({ jobs, taskLabels, products, opTypes, opDone, onToggleDone, onEditOp, onAddJob, onOpen }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [view, setView] = useState("gantt"); // cal | gantt
  const todayStr = isoYMD(now);

  const labelColor = (id) => (taskLabels || []).find((l) => l.id === id)?.color || "#cbd5e1";
  const prevM = () => setYm((s) => { const d = new Date(s.y, s.m - 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const nextM = () => setYm((s) => { const d = new Date(s.y, s.m + 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const goToday = () => setYm({ y: now.getFullYear(), m: now.getMonth() });

  const SegBtn = ({ id, children }) => (
    <button
      onClick={() => setView(id)}
      className={"rounded-md px-3 py-1 text-xs font-semibold transition " + (view === id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}
    >{children}</button>
  );

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={prevM} className="rounded-lg flex h-7 w-7 items-center justify-center border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /></button>
        <button onClick={nextM} className="rounded-lg flex h-7 w-7 items-center justify-center border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><ChevronRight size={16} /></button>
        <h2 className="ml-1 text-base font-semibold capitalize text-neutral-900">{MONTHS_FULL[ym.m]} {ym.y}</h2>
        <button onClick={goToday} className="rounded-lg ml-1 border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50">Сегодня</button>
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-neutral-100 p-0.5">
            <SegBtn id="cal">Календарь</SegBtn>
            <SegBtn id="gantt">Гант</SegBtn>
          </div>
          <button onClick={() => onAddJob({ date: todayStr })} className="rounded-lg inline-flex items-center gap-1 bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800"><Plus size={14} /> Задача</button>
        </div>
      </div>

      {view === "cal"
        ? <CalendarGrid jobs={jobs} products={products} ym={ym} todayStr={todayStr} labelColor={labelColor} onAddOnDay={(ds) => onAddJob({ date: ds })} onOpen={onOpen} />
        : <GanttBoard jobs={jobs} products={products} opTypes={opTypes} opDone={opDone} onToggleDone={onToggleDone} onEditOp={onEditOp} ym={ym} todayStr={todayStr} labelColor={labelColor} onAddJob={onAddJob} onOpen={onOpen} />}
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
                    <span className="min-w-0 flex-1 truncate" style={j.done ? { textDecoration: "line-through", color: "#a3a3a3" } : { color: "#404040" }}>{j.title || "—"}</span>
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

function GanttBoard({ jobs, products, opTypes, opDone, onToggleDone, onEditOp, ym, todayStr, labelColor, onAddJob, onOpen }) {
  const LW = 200;      // ширина колонки с подписями
  const DW = 30;       // ширина дня
  const BAR_H = 20;    // высота бара
  const TRACK_H = 24;  // шаг дорожки (бар + зазор)

  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const monthFirst = new Date(ym.y, ym.m, 1);
  const monthLast = new Date(ym.y, ym.m, daysInMonth);
  const todayD = parseISO(todayStr);
  const todayInMonth = todayD >= monthFirst && todayD <= monthLast;
  const todayCol = todayInMonth ? todayD.getDate() : 0;

  // свёрнутые секции (сохраняем в localStorage)
  const [collapsed, setCollapsed] = useState(() => { try { return JSON.parse(localStorage.getItem("rnp-gantt-collapsed") || "{}"); } catch { return {}; } });
  const toggleSection = (id) => setCollapsed((c) => { const n = { ...c, [id]: !c[id] }; try { localStorage.setItem("rnp-gantt-collapsed", JSON.stringify(n)); } catch {} return n; });

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
  const genItems = visible.filter((x) => !x.j.productId);
  const prodMap = new Map();
  visible.forEach((x) => {
    if (!x.j.productId) return;
    (prodMap.get(x.j.productId) || prodMap.set(x.j.productId, []).get(x.j.productId)).push(x);
  });
  const prodRows = products
    .filter((p) => prodMap.has(p.id))
    .map((p) => ({ key: p.id, label: (p.code || "—") + (p.name ? " · " + p.name : ""), preset: { productId: p.id }, items: prodMap.get(p.id) }));

  const timelineW = daysInMonth * DW;

  const Bar = ({ x }) => {
    const { startCol, endCol, clipL, clipR } = x.pos;
    const left = (startCol - 1) * DW;
    const width = (endCol - startCol + 1) * DW - 4;
    const col = labelColor(x.j.labelId);
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onOpen(x.j); }}
        title={x.j.title}
        className="absolute flex items-center overflow-hidden px-1.5 text-left text-[11px] font-medium text-white shadow-sm transition hover:brightness-95"
        style={{
          left: left + 2, width: Math.max(width, DW - 4), top: x.track * TRACK_H + 3, height: BAR_H,
          background: col,
          borderRadius: 6,
          borderTopLeftRadius: clipL ? 0 : 6, borderBottomLeftRadius: clipL ? 0 : 6,
          borderTopRightRadius: clipR ? 0 : 6, borderBottomRightRadius: clipR ? 0 : 6,
          opacity: x.j.done ? 0.5 : 1,
        }}
      >
        <span className="truncate" style={x.j.done ? { textDecoration: "line-through" } : undefined}>{x.j.title || "—"}</span>
      </button>
    );
  };

  const Row = ({ row, emptyHint }) => {
    const { bars, tracks } = withTracks(row.items);
    const rowH = tracks * TRACK_H + 6;
    return (
      <div className="flex border-t border-neutral-100">
        <div className="group relative flex shrink-0 items-center gap-1 py-1 pr-2" style={{ width: LW }}>
          <span className="min-w-0 flex-1 truncate pl-1 text-[12px] text-neutral-700" title={row.label}>{row.label}</span>
          {row.preset && (
            <button
              onClick={() => onAddJob({ ...row.preset, date: todayStr })}
              className="shrink-0 rounded p-0.5 text-neutral-300 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100"
              title="Добавить задачу"
            ><Plus size={13} /></button>
          )}
        </div>
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
          className="group flex shrink-0 items-center py-2 pl-2 pr-2 text-left hover:bg-neutral-50"
          style={{ width: LW }}
          title="Настроить график"
        >
          <span className="w-full truncate text-[12px] text-neutral-700 group-hover:text-neutral-900">{op.name}</span>
        </button>
        <div className="relative flex shrink-0 items-center" style={{ width: timelineW, height: 44 }}>
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

  const Section = ({ id, title, count, children }) => {
    const open = !collapsed[id];
    return (
      <div className="mt-2 first:mt-0">
        <button
          onClick={() => toggleSection(id)}
          className="flex items-center gap-1.5 bg-neutral-50 px-2 py-1 text-left transition hover:bg-neutral-100"
          style={{ width: LW + timelineW }}
        >
          <ChevronDown size={13} className="shrink-0 text-neutral-400 transition-transform" style={{ transform: open ? "none" : "rotate(-90deg)" }} />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</span>
          <span className="rounded-full bg-neutral-200/80 px-1.5 text-[10px] font-semibold leading-[16px] text-neutral-500">{count}</span>
        </button>
        {open && children}
      </div>
    );
  };

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ minWidth: LW + timelineW }}>
        {/* линия «сегодня» на всю высоту */}
        {todayInMonth && (
          <div className="pointer-events-none absolute bottom-0 z-10 w-px bg-orange-400" style={{ left: LW + (todayCol - 1) * DW + DW / 2, top: 36 }} />
        )}

        {/* шапка дней */}
        <div className="flex" style={{ height: 36 }}>
          <div className="shrink-0" style={{ width: LW }} />
          <div className="flex shrink-0" style={{ width: timelineW }}>
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
          <Section id="op" title="Операционные задачи" count={(opTypes || []).length}>
            {(opTypes || []).length === 0
              ? <div className="border-t border-neutral-100 px-2 py-2 text-[11px] text-neutral-400" style={{ width: LW + timelineW }}>Добавьте операционные задачи в настройках</div>
              : (opTypes || []).map((op) => <OpRow key={op.id} op={op} />)}
          </Section>

          <Section id="gen" title="Общие задачи" count={genItems.length}>
            {genItems.length === 0
              ? <div className="border-t border-neutral-100 px-2 py-2 text-[11px] text-neutral-400" style={{ width: LW + timelineW }}>Нет общих задач в этом месяце</div>
              : genItems.map((x) => <Row key={x.j.id} row={{ key: x.j.id, label: x.j.title || "—", preset: null, items: [x] }} />)}
          </Section>

          <Section id="prod" title="Задачи по товарам" count={prodRows.length}>
            {prodRows.length === 0
              ? <div className="border-t border-neutral-100 px-2 py-2 text-[11px] text-neutral-400" style={{ width: LW + timelineW }}>Нет задач по товарам в этом месяце</div>
              : prodRows.map((row) => <Row key={row.key} row={row} />)}
          </Section>
        </div>
      </div>
    </div>
  );
}

function JobEditor({ job, taskLabels, products, opTypes, onSave, onDelete, onClose }) {
  const [j, setJ] = useState(job);
  const set = (k, v) => setJ((o) => ({ ...o, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-sm bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">{job._new ? "Новая задача" : "Задача"}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <input value={j.title} onChange={(e) => set("title", e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSave(j)} placeholder="Название задачи…" autoFocus className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-neutral-600">Начало</span>
            <input type="date" value={j.start || ""} onChange={(e) => set("start", e.target.value || null)} max={j.date || undefined} className="rounded-lg border border-neutral-200 px-2 py-1 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none" />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-neutral-600">Дедлайн</span>
            <input type="date" value={j.date || ""} onChange={(e) => set("date", e.target.value)} className="rounded-lg border border-neutral-200 px-2 py-1 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none" />
          </label>
          <p className="-mt-1 text-[11px] text-neutral-400">Без даты начала задача длится 1 день (дедлайн).</p>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-neutral-600">Метка</span>
            <select value={j.labelId || ""} onChange={(e) => set("labelId", e.target.value || null)} className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none">
              <option value="">Без метки</option>
              {(taskLabels || []).map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-neutral-600">Товар</span>
            <select value={j.productId || ""} onChange={(e) => set("productId", e.target.value || null)} className="max-w-[200px] rounded-lg border border-neutral-200 bg-white px-2 py-1 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none">
              <option value="">—</option>
              {(products || []).map((p) => (<option key={p.id} value={p.id}>{(p.code || "—") + (p.name ? " · " + p.name : "")}</option>))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={!!j.done} onChange={(e) => set("done", e.target.checked)} className="h-4 w-4 accent-green-600" />
            <span className="text-sm text-neutral-600">Выполнено</span>
          </label>
        </div>
        <div className="mt-5 flex items-center gap-2">
          <button onClick={() => onSave(j)} disabled={!j.title.trim()} className="rounded-lg flex-1 bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40">Сохранить</button>
          {!job._new && <button onClick={() => onDelete(j.id)} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-500 hover:bg-red-50 hover:text-red-600">Удалить</button>}
        </div>
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

// Приводит любое сохранённое значение стратегии к модели { maps:[{id,name,nodes,edges,groups}], activeId }
function normStrategy(v) {
  const normNode = (n, k) => ({
    id: n && n.id ? n.id : uid(),
    x: n && typeof n.x === "number" ? n.x : 60 + (k % 4) * 30,
    y: n && typeof n.y === "number" ? n.y : 60 + (k % 4) * 30,
    title: (n && n.title) || "",
    note: (n && n.note) || "",
    color: (n && n.color) || "#2563eb",
    done: !!(n && n.done),
    hasCheck: n && n.hasCheck === false ? false : true,
    type: n && STRAT_TYPES[n.type] ? n.type : "stage",
    checklist: n && Array.isArray(n.checklist)
      ? n.checklist.filter((c) => c && typeof c === "object").map((c) => ({ id: c.id || uid(), text: c.text || "", done: !!c.done }))
      : [],
  });
  const normGroup = (g) => ({
    id: g && g.id ? g.id : uid(),
    x: g && typeof g.x === "number" ? g.x : 40,
    y: g && typeof g.y === "number" ? g.y : 40,
    w: g && typeof g.w === "number" ? g.w : 360,
    h: g && typeof g.h === "number" ? g.h : 260,
    name: (g && g.name) || "Фаза",
    color: (g && g.color) || "#6366f1",
  });
  const normMap = (m, i) => ({
    id: m && m.id ? m.id : uid(),
    name: (m && m.name) || `Стратегия ${i + 1}`,
    mode: m && ["tree", "process", "duties"].includes(m.mode) ? m.mode : "tree",
    nodes: m && Array.isArray(m.nodes) ? m.nodes.map(normNode) : [],
    edges: m && Array.isArray(m.edges) ? m.edges.filter((e) => e && e.from && e.to).map((e) => ({ id: e.id || uid(), from: e.from, to: e.to })) : [],
    groups: m && Array.isArray(m.groups) ? m.groups.map(normGroup) : [],
  });
  const mk = () => normMap({ name: "Стратегия 1" }, 0);
  if (!v || typeof v !== "object") return { maps: [mk()], activeId: null };
  let maps;
  if (Array.isArray(v.maps)) {
    maps = v.maps.filter((m) => m && typeof m === "object").map(normMap);
  } else {
    // старый формат { nodes, edges } → одна карта
    maps = [normMap({ name: "Стратегия 1", nodes: v.nodes, edges: v.edges }, 0)];
  }
  if (!maps.length) maps = [mk()];
  const activeId = maps.some((m) => m.id === v.activeId) ? v.activeId : maps[0].id;
  return { maps, activeId };
}

// прогресс блока: по подзадачам, иначе по галочке
function nodeIsDone(n) { return (n.checklist && n.checklist.length) ? n.checklist.every((c) => c.done) : !!n.done; }

// Готовые шаблоны карт стратегии
function makeStrategyTemplate(kind) {
  const N = (x, y, title, o = {}) => ({ id: uid(), x, y, title, note: o.note || "", color: o.color || "#2563eb", done: false, hasCheck: o.hasCheck === false ? false : true, type: o.type || "stage", checklist: (o.cl || []).map((t) => ({ id: uid(), text: t, done: false })) });
  const E = (a, b) => ({ id: uid(), from: a.id, to: b.id });

  if (kind === "hierarchy") {
    const head = N(560, 40, "Руководитель", { type: "goal", color: "#6366f1", note: "стратегия, цели, контроль" });
    const mkt = N(120, 260, "Маркетинг", { color: "#2563eb" });
    const ops = N(560, 260, "Операции", { color: "#0ea5e9" });
    const fin = N(1000, 260, "Финансы", { color: "#10b981" });
    const mkt1 = N(120, 460, "Трафик и реклама", { color: "#2563eb" });
    const mkt2 = N(120, 620, "Контент и дизайн", { color: "#2563eb" });
    const ops1 = N(560, 460, "Логистика и поставки", { color: "#0ea5e9" });
    const ops2 = N(560, 620, "Закупки", { color: "#0ea5e9" });
    const fin1 = N(1000, 460, "Учёт и аналитика", { color: "#10b981" });
    const nodes = [head, mkt, ops, fin, mkt1, mkt2, ops1, ops2, fin1];
    const edges = [E(head, mkt), E(head, ops), E(head, fin), E(mkt, mkt1), E(mkt, mkt2), E(ops, ops1), E(ops, ops2), E(fin, fin1)];
    return { name: "Иерархия", mode: "tree", nodes, edges, groups: [] };
  }

  if (kind === "process") {
    const p1 = N(60, 140, "Выбор ниши / товара", { color: "#2563eb" });
    const p2 = N(360, 140, "Анализ спроса и конкурентов", { color: "#2563eb" });
    const p3 = N(660, 140, "Поиск поставщика", { color: "#2563eb" });
    const p4 = N(960, 140, "Закуп тестовой партии", { color: "#2563eb" });
    const p5 = N(960, 400, "Фотоконтент и карточка", { color: "#0ea5e9" });
    const p6 = N(660, 400, "Запуск и реклама", { color: "#0ea5e9" });
    const p7 = N(360, 400, "Сбор аналитики", { color: "#0ea5e9" });
    const p8 = N(60, 400, "Масштабировать?", { type: "decision", color: "#7c3aed", hasCheck: false });
    const yes = N(60, 640, "Докупка и рост", { type: "goal", color: "#10b981" });
    const no = N(360, 640, "Доработать / вывести", { type: "risk", color: "#dc2626" });
    const nodes = [p1, p2, p3, p4, p5, p6, p7, p8, yes, no];
    const edges = [E(p1, p2), E(p2, p3), E(p3, p4), E(p4, p5), E(p5, p6), E(p6, p7), E(p7, p8), E(p8, yes), E(p8, no)];
    return { name: "Процесс", mode: "process", nodes, edges, groups: [] };
  }

  // duties — функциональные обязанности
  const r1 = N(80, 150, "Руководитель", { type: "goal", color: "#6366f1", cl: ["Стратегия и цели", "Бюджет и P&L", "Найм и команда", "Контроль ключевых метрик"] });
  const r2 = N(380, 150, "Менеджер WB", { color: "#2563eb", cl: ["Карточки и SEO", "Цены и акции", "Остатки и поставки", "Отзывы и вопросы"] });
  const r3 = N(680, 150, "Контент и дизайн", { color: "#ec4899", cl: ["Фотосессии", "Инфографика", "Видео и рилс", "Обновление карточек"] });
  const r4 = N(980, 150, "Логистика и закупки", { color: "#0ea5e9", cl: ["Поиск поставщиков", "Закупки", "Отгрузки FBW / FBS", "Приёмка и возвраты"] });
  const groups = [{ id: uid(), x: 40, y: 80, w: 1220, h: 200, name: "Команда", color: "#6366f1" }];
  return { name: "Функциональные обязанности", mode: "duties", nodes: [r1, r2, r3, r4], edges: [], groups };
}

// Обёртка: список карт-стратегий + переключатель; каждая карта — отдельный холст.
function StrategySection({ strategy, onChange, onCreateTask }) {
  const st = normStrategy(strategy);
  const maps = st.maps;
  const active = maps.find((m) => m.id === st.activeId) || maps[0];
  const [editingId, setEditingId] = useState(null);
  const [tplOpen, setTplOpen] = useState(false);

  const updateActive = (next) => onChange({ maps: maps.map((m) => (m.id === active.id ? { ...m, nodes: next.nodes, edges: next.edges, groups: next.groups } : m)), activeId: active.id });
  const setActiveMode = (mode) => onChange({ maps: maps.map((m) => (m.id === active.id ? { ...m, mode } : m)), activeId: active.id });
  const selectMap = (id) => { setEditingId(null); onChange({ maps, activeId: id }); };
  const addMap = () => { const id = uid(); onChange({ maps: [...maps, { id, name: `Стратегия ${maps.length + 1}`, mode: "tree", nodes: [], edges: [], groups: [] }], activeId: id }); };
  const addTemplate = (kind) => { const t = makeStrategyTemplate(kind); const id = uid(); setTplOpen(false); onChange({ maps: [...maps, { id, name: t.name, mode: t.mode, nodes: t.nodes, edges: t.edges, groups: t.groups }], activeId: id }); };
  const dupMap = (id) => {
    const src = maps.find((m) => m.id === id); if (!src) return;
    const nid = uid();
    const copy = JSON.parse(JSON.stringify({ ...src, id: nid, name: `${src.name} (копия)` }));
    const at = maps.findIndex((m) => m.id === id);
    const next = maps.slice(); next.splice(at + 1, 0, copy);
    onChange({ maps: next, activeId: nid });
  };
  const renameMap = (id, name) => onChange({ maps: maps.map((m) => (m.id === id ? { ...m, name: name.trim() || "Без названия" } : m)), activeId: st.activeId });
  const removeMap = (id) => {
    if (maps.length <= 1) { const nid = uid(); onChange({ maps: [{ id: nid, name: "Стратегия 1", nodes: [], edges: [], groups: [] }], activeId: nid }); return; }
    const rest = maps.filter((m) => m.id !== id);
    onChange({ maps: rest, activeId: id === st.activeId ? rest[0].id : st.activeId });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {maps.map((m) => {
          const on = m.id === active.id;
          if (editingId === m.id) {
            return (
              <input key={m.id} autoFocus defaultValue={m.name}
                onBlur={(e) => { renameMap(m.id, e.target.value); setEditingId(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); else if (e.key === "Escape") setEditingId(null); }}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-800 focus:outline-none" style={{ width: 170 }} />
            );
          }
          return (
            <button key={m.id} onClick={() => selectMap(m.id)} onDoubleClick={() => setEditingId(m.id)}
              title="Клик — открыть · двойной клик — переименовать"
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${on ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>
              <span className="max-w-[220px] truncate">{m.name}</span>
              {on && (
                <>
                  <Pencil size={12} className="opacity-70 hover:opacity-100" onClick={(e) => { e.stopPropagation(); setEditingId(m.id); }} title="Переименовать" />
                  <Copy size={12} className="opacity-70 hover:opacity-100" onClick={(e) => { e.stopPropagation(); dupMap(m.id); }} title="Дублировать карту" />
                  <Trash2 size={12} className="opacity-70 hover:opacity-100 hover:text-red-300" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Удалить карту «${m.name}»?`)) removeMap(m.id); }} title="Удалить карту" />
                </>
              )}
            </button>
          );
        })}
        <button onClick={addMap} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"><Plus size={14} /> Карта</button>
        <div className="relative">
          <button onClick={() => setTplOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"><LayoutTemplate size={14} /> Шаблоны <ChevronDown size={13} /></button>
          {tplOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setTplOpen(false)} />
              <div className="absolute left-0 z-20 mt-1 w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
                {[["hierarchy", "Иерархия", "оргструктура: кто кому подчиняется"], ["process", "Процесс", "этапы вывода товара по шагам"], ["duties", "Функциональные обязанности", "роли и их задачи (чек-листы)"]].map(([k, t, d]) => (
                  <button key={k} onClick={() => addTemplate(k)} className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-neutral-50">
                    <div className="text-sm font-semibold text-neutral-800">{t}</div>
                    <div className="text-[11px] text-neutral-400">{d}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <StrategyBoard key={active.id} strategy={{ nodes: active.nodes, edges: active.edges, groups: active.groups }} onChange={updateActive} onCreateTask={onCreateTask} initialMode={active.mode} onModeChange={setActiveMode} />
    </div>
  );
}

const GROUP_COLORS = ["#6366f1", "#0ea5e9", "#f59e0b", "#ec4899", "#10b981", "#8b5cf6"];
const TYPE_COLOR = { stage: "#a3a3a3", goal: "#059669", risk: "#d97706", decision: "#7c3aed" };

function StrategyBoard({ strategy, onChange, onCreateTask, initialMode, onModeChange }) {
  const W = 220, PORTY = 26, GRID = 20, CW = 5200, CH = 3600;
  const nodes = (strategy && strategy.nodes) || [];
  const edges = (strategy && strategy.edges) || [];
  const groups = (strategy && strategy.groups) || [];
  const stateRef = useRef({ nodes, edges, groups });
  stateRef.current = { nodes, edges, groups };

  const vpRef = useRef(null);
  const dragRef = useRef(null);
  const connRef = useRef(null);
  const panRef = useRef(null);
  const marqueeRef = useRef(null);
  const gDragRef = useRef(null);
  const gResRef = useRef(null);
  const histRef = useRef({ past: [], future: [] });
  const sizeRef = useRef({});       // id → измеренная высота блока (для якорей стрелок)
  const contentElRef = useRef(null);

  const [view, setView] = useState({ s: 1, tx: 40, ty: 20 });
  const viewRef = useRef(view); viewRef.current = view;
  const [sel, setSel] = useState([]);
  const selRef = useRef(sel); selRef.current = sel;
  const [selGroup, setSelGroup] = useState(null);
  const [editGroup, setEditGroup] = useState(null);
  const [settingsFor, setSettingsFor] = useState(null); // id блока с открытой панелью настроек (⚙)
  const [childMode, setChildMode] = useState(initialMode || "tree"); // как добавляется дочерний блок: tree | process | duties
  const [cmOpen, setCmOpen] = useState(false);
  const focusRef = useRef(null); // id блока, которому нужно дать фокус после создания
  const [connPos, setConnPos] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [taskFor, setTaskFor] = useState(null);
  const [vpSize, setVpSize] = useState({ w: 1000, h: 600 });
  const [toast, setToast] = useState("");
  const [, force] = useState(0);
  const snapG = (v) => Math.round(v / GRID) * GRID;

  // ---- история ----
  const snap = () => JSON.parse(JSON.stringify(stateRef.current));
  const apply = (next) => onChange(next);
  const pushHist = () => { const h = histRef.current; h.past.push(snap()); if (h.past.length > 60) h.past.shift(); h.future = []; force((n) => n + 1); };
  const commit = (next) => { pushHist(); apply(next); };
  const undo = () => { const h = histRef.current; if (!h.past.length) return; h.future.push(snap()); apply(h.past.pop()); force((n) => n + 1); };
  const redo = () => { const h = histRef.current; if (!h.future.length) return; h.past.push(snap()); apply(h.future.pop()); force((n) => n + 1); };

  // ---- координаты ----
  const toWorld = (cx, cy) => { const r = vpRef.current.getBoundingClientRect(); const v = viewRef.current; return { x: (cx - r.left - v.tx) / v.s, y: (cy - r.top - v.ty) / v.s }; };

  // ---- мутаторы блоков ----
  const patchLive = (id, p) => { const s = stateRef.current; apply({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }); };
  const patchNode = (id, p) => { commit({ ...stateRef.current, nodes: stateRef.current.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }); };
  const removeNode = (id) => { const s = stateRef.current; commit({ ...s, nodes: s.nodes.filter((n) => n.id !== id), edges: s.edges.filter((e) => e.from !== id && e.to !== id) }); setSel((x) => x.filter((i) => i !== id)); };
  const removeSelected = () => { const s = stateRef.current; const ids = new Set(selRef.current); if (!ids.size) return; commit({ ...s, nodes: s.nodes.filter((n) => !ids.has(n.id)), edges: s.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to)) }); setSel([]); };
  const duplicateNode = (id) => { const s = stateRef.current; const src = s.nodes.find((n) => n.id === id); if (!src) return; const nid = uid(); const copy = { ...JSON.parse(JSON.stringify(src)), id: nid, x: snapG(src.x + 30), y: snapG(src.y + 30), checklist: (src.checklist || []).map((c) => ({ ...c, id: uid() })) }; commit({ ...s, nodes: [...s.nodes, copy] }); setSel([nid]); };
  // xMind: добавить дочерний блок от исходного, вид зависит от режима (childMode)
  const addChild = (parent) => {
    const s = stateRef.current; const kids = s.edges.filter((e) => e.from === parent.id).length;
    let x, y, extra;
    if (childMode === "duties") { x = parent.x + kids * (W + 30); y = parent.y + 150; extra = { type: "stage", color: parent.color, checklist: [{ id: uid(), text: "", done: false }] }; }
    else if (childMode === "process") { x = parent.x + W + 80; y = parent.y + kids * 150; extra = { type: "stage", color: "#2563eb" }; }
    else { x = parent.x + W + 80; y = parent.y + kids * 140; extra = { type: "stage", color: parent.color }; }
    const id = uid();
    const node = { id, x: snapG(x), y: snapG(y), title: "", note: "", color: extra.color || "#2563eb", done: false, hasCheck: true, type: extra.type || "stage", checklist: extra.checklist || [] };
    commit({ ...s, nodes: [...s.nodes, node], edges: [...s.edges, { id: uid(), from: parent.id, to: id }] });
    setSel([id]); setSettingsFor(null); focusRef.current = id;
  };
  const addEdge = (from, to) => { const s = stateRef.current; if (from === to || s.edges.some((e) => e.from === from && e.to === to)) return; commit({ ...s, edges: [...s.edges, { id: uid(), from, to }] }); };
  const removeEdge = (id) => { const s = stateRef.current; commit({ ...s, edges: s.edges.filter((e) => e.id !== id) }); };
  const addNode = () => {
    const s = stateRef.current; const r = vpRef.current.getBoundingClientRect(); const v = viewRef.current; const k = s.nodes.length;
    const cx = (r.width / 2 - v.tx) / v.s, cy = (r.height / 2 - v.ty) / v.s;
    const id = uid();
    commit({ ...s, nodes: [...s.nodes, { id, x: snapG(cx - W / 2 + (k % 3) * 20), y: snapG(cy - 40 + (k % 3) * 20), title: "Новый этап", note: "", color: SWATCHES[k % SWATCHES.length], done: false, hasCheck: true, type: "stage", checklist: [] }] });
    setSel([id]);
  };
  // чек-лист
  const addCheck = (id) => { const s = stateRef.current; commit({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: [...(n.checklist || []), { id: uid(), text: "", done: false }] } : n)) }); };
  const toggleCheck = (id, cid) => { const s = stateRef.current; commit({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: n.checklist.map((c) => (c.id === cid ? { ...c, done: !c.done } : c)) } : n)) }); };
  const setCheckText = (id, cid, text) => { const s = stateRef.current; apply({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: n.checklist.map((c) => (c.id === cid ? { ...c, text } : c)) } : n)) }); };
  const removeCheck = (id, cid) => { const s = stateRef.current; commit({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, checklist: n.checklist.filter((c) => c.id !== cid) } : n)) }); };
  // группы
  const addGroup = () => {
    const s = stateRef.current; let gx, gy, gw, gh;
    const sn = s.nodes.filter((n) => selRef.current.includes(n.id));
    if (sn.length) {
      const minX = Math.min(...sn.map((n) => n.x)), minY = Math.min(...sn.map((n) => n.y));
      const maxX = Math.max(...sn.map((n) => n.x + W)), maxY = Math.max(...sn.map((n) => n.y + 110));
      gx = snapG(minX - 24); gy = snapG(minY - 44); gw = snapG(maxX - minX + 48); gh = snapG(maxY - minY + 68);
    } else {
      const r = vpRef.current.getBoundingClientRect(); const v = viewRef.current;
      gx = snapG((40 - v.tx) / v.s + 10); gy = snapG((40 - v.ty) / v.s + 10); gw = 380; gh = 280;
    }
    const id = uid();
    commit({ ...s, groups: [...s.groups, { id, x: gx, y: gy, w: gw, h: gh, name: `Фаза ${s.groups.length + 1}`, color: GROUP_COLORS[s.groups.length % GROUP_COLORS.length] }] });
    setSelGroup(id); setSel([]);
  };
  const patchGroup = (id, p) => { const s = stateRef.current; commit({ ...s, groups: s.groups.map((g) => (g.id === id ? { ...g, ...p } : g)) }); };
  const removeGroup = (id) => { const s = stateRef.current; commit({ ...s, groups: s.groups.filter((g) => g.id !== id) }); setSelGroup(null); };

  // ---- перетаскивание блоков (с мультивыбором) ----
  const onNodeMove = (e) => {
    const d = dragRef.current; if (!d) return; const v = viewRef.current;
    if (!d.moved) { if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 3) return; pushHist(); d.moved = true; }
    const dx = (e.clientX - d.sx) / v.s, dy = (e.clientY - d.sy) / v.s; const s = stateRef.current;
    apply({ ...s, nodes: s.nodes.map((n) => (d.starts[n.id] ? { ...n, x: Math.max(0, snapG(d.starts[n.id].x + dx)), y: Math.max(0, snapG(d.starts[n.id].y + dy)) } : n)) });
  };
  const onNodeUp = () => { dragRef.current = null; window.removeEventListener("pointermove", onNodeMove); window.removeEventListener("pointerup", onNodeUp); };
  const onNodeDown = (e, n) => {
    if (e.button !== 0) return; e.stopPropagation(); setSelGroup(null); setTaskFor(null);
    let cur = selRef.current;
    if (e.shiftKey) cur = cur.includes(n.id) ? cur.filter((i) => i !== n.id) : [...cur, n.id];
    else if (!cur.includes(n.id)) cur = [n.id];
    setSel(cur);
    setSettingsFor((p) => (p === n.id ? p : null)); // не открывать настройки при перетаскивании/выборе
    const ids = cur.includes(n.id) ? cur : [n.id];
    const starts = {}; stateRef.current.nodes.forEach((nd) => { if (ids.includes(nd.id)) starts[nd.id] = { x: nd.x, y: nd.y }; });
    dragRef.current = { ids, starts, sx: e.clientX, sy: e.clientY, moved: false };
    window.addEventListener("pointermove", onNodeMove); window.addEventListener("pointerup", onNodeUp);
  };

  // ---- соединения ----
  const onConnMove = (e) => setConnPos(toWorld(e.clientX, e.clientY));
  const onConnUp = (e) => {
    const c = connRef.current; connRef.current = null; setConnPos(null);
    window.removeEventListener("pointermove", onConnMove); window.removeEventListener("pointerup", onConnUp);
    if (!c) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const host = el && el.closest ? el.closest("[data-node]") : null;
    if (host) { const to = host.getAttribute("data-node"); if (to && to !== c.from) addEdge(c.from, to); }
  };
  const onPortDown = (e, n, side) => { e.stopPropagation(); e.preventDefault(); connRef.current = { from: n.id, side }; setConnPos(toWorld(e.clientX, e.clientY)); window.addEventListener("pointermove", onConnMove); window.addEventListener("pointerup", onConnUp); };

  // ---- панорамирование / рамка выбора ----
  const onPanMove = (e) => { const p = panRef.current; if (!p) return; setView((v) => ({ ...v, tx: p.tx + (e.clientX - p.sx), ty: p.ty + (e.clientY - p.sy) })); };
  const onPanUp = () => { panRef.current = null; window.removeEventListener("pointermove", onPanMove); window.removeEventListener("pointerup", onPanUp); };
  const onMarqueeMove = (e) => { const m = marqueeRef.current; if (!m) return; const p = toWorld(e.clientX, e.clientY); setMarquee({ x: Math.min(m.x0, p.x), y: Math.min(m.y0, p.y), w: Math.abs(p.x - m.x0), h: Math.abs(p.y - m.y0) }); };
  const onMarqueeUp = (e) => {
    const m = marqueeRef.current; marqueeRef.current = null;
    window.removeEventListener("pointermove", onMarqueeMove); window.removeEventListener("pointerup", onMarqueeUp);
    const p = toWorld(e.clientX, e.clientY); const r = { x: Math.min(m.x0, p.x), y: Math.min(m.y0, p.y), w: Math.abs(p.x - m.x0), h: Math.abs(p.y - m.y0) };
    setMarquee(null); if (r.w < 5 && r.h < 5) return;
    const hit = stateRef.current.nodes.filter((n) => n.x < r.x + r.w && n.x + W > r.x && n.y < r.y + r.h && n.y + 80 > r.y).map((n) => n.id);
    setSel(hit);
  };
  const onBgDown = (e) => {
    if (e.button !== 0) return;
    setSel([]); setSelGroup(null); setTaskFor(null); setSettingsFor(null);
    if (e.shiftKey) {
      const p = toWorld(e.clientX, e.clientY); marqueeRef.current = { x0: p.x, y0: p.y }; setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
      window.addEventListener("pointermove", onMarqueeMove); window.addEventListener("pointerup", onMarqueeUp);
    } else {
      const v = viewRef.current; panRef.current = { sx: e.clientX, sy: e.clientY, tx: v.tx, ty: v.ty };
      window.addEventListener("pointermove", onPanMove); window.addEventListener("pointerup", onPanUp);
    }
  };

  // ---- перетаскивание/ресайз групп ----
  const onGroupMove = (e) => {
    const d = gDragRef.current; if (!d) return; const v = viewRef.current;
    if (!d.moved) { if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 3) return; pushHist(); d.moved = true; }
    const dx = (e.clientX - d.sx) / v.s, dy = (e.clientY - d.sy) / v.s; const s = stateRef.current;
    apply({ ...s, groups: s.groups.map((g) => (g.id === d.id ? { ...g, x: snapG(d.gx + dx), y: snapG(d.gy + dy) } : g)), nodes: s.nodes.map((n) => (d.starts[n.id] ? { ...n, x: snapG(d.starts[n.id].x + dx), y: snapG(d.starts[n.id].y + dy) } : n)) });
  };
  const onGroupUp = () => { gDragRef.current = null; window.removeEventListener("pointermove", onGroupMove); window.removeEventListener("pointerup", onGroupUp); };
  const onGroupDown = (e, g) => {
    if (e.button !== 0) return; e.stopPropagation(); setSelGroup(g.id); setSel([]); setTaskFor(null);
    const s = stateRef.current;
    const members = s.nodes.filter((n) => n.x + W / 2 >= g.x && n.x + W / 2 <= g.x + g.w && n.y + 30 >= g.y && n.y + 30 <= g.y + g.h);
    const starts = {}; members.forEach((n) => { starts[n.id] = { x: n.x, y: n.y }; });
    gDragRef.current = { id: g.id, gx: g.x, gy: g.y, starts, sx: e.clientX, sy: e.clientY, moved: false };
    window.addEventListener("pointermove", onGroupMove); window.addEventListener("pointerup", onGroupUp);
  };
  const onGResMove = (e) => { const d = gResRef.current; if (!d) return; const v = viewRef.current; if (!d.moved) { pushHist(); d.moved = true; } const dw = (e.clientX - d.sx) / v.s, dh = (e.clientY - d.sy) / v.s; const s = stateRef.current; apply({ ...s, groups: s.groups.map((g) => (g.id === d.id ? { ...g, w: Math.max(160, snapG(d.w + dw)), h: Math.max(120, snapG(d.h + dh)) } : g)) }); };
  const onGResUp = () => { gResRef.current = null; window.removeEventListener("pointermove", onGResMove); window.removeEventListener("pointerup", onGResUp); };
  const onGResDown = (e, g) => { e.stopPropagation(); e.preventDefault(); gResRef.current = { id: g.id, w: g.w, h: g.h, sx: e.clientX, sy: e.clientY, moved: false }; window.addEventListener("pointermove", onGResMove); window.addEventListener("pointerup", onGResUp); };

  // ---- зум ----
  const zoomAt = (cx, cy, factor) => setView((v) => { const ns = Math.min(2, Math.max(0.3, v.s * factor)); const k = ns / v.s; return { s: ns, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k }; });
  const zoomBtn = (factor) => { const r = vpRef.current.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, factor); };
  const fitView = () => {
    const s = stateRef.current; const its = [...s.nodes.map((n) => ({ x: n.x, y: n.y, w: W, h: 100 })), ...s.groups.map((g) => ({ x: g.x, y: g.y, w: g.w, h: g.h }))];
    const r = vpRef.current.getBoundingClientRect(); const pad = 48;
    if (!its.length) { setView({ s: 1, tx: 40, ty: 20 }); return; }
    const minX = Math.min(...its.map((i) => i.x)), minY = Math.min(...its.map((i) => i.y));
    const maxX = Math.max(...its.map((i) => i.x + i.w)), maxY = Math.max(...its.map((i) => i.y + i.h));
    const sc = Math.min((r.width - pad * 2) / (maxX - minX || 1), (r.height - pad * 2) / (maxY - minY || 1), 1.2);
    const ns = Math.max(0.3, Math.min(2, sc));
    setView({ s: ns, tx: (r.width - (maxX - minX) * ns) / 2 - minX * ns, ty: (r.height - (maxY - minY) * ns) / 2 - minY * ns });
  };
  // ---- авто-раскладка по стрелкам ----
  const autoLayout = () => {
    const s = stateRef.current; const ns = s.nodes; if (!ns.length) return;
    const idset = new Set(ns.map((n) => n.id)); const out = {}, indeg = {};
    ns.forEach((n) => { out[n.id] = []; indeg[n.id] = 0; });
    s.edges.forEach((e) => { if (idset.has(e.from) && idset.has(e.to)) { out[e.from].push(e.to); indeg[e.to] += 1; } });
    const layer = {}; ns.forEach((n) => (layer[n.id] = 0));
    const indc = { ...indeg }; const q = ns.filter((n) => indc[n.id] === 0).map((n) => n.id); let guard = 0;
    while (q.length && guard++ < 20000) { const u = q.shift(); out[u].forEach((v) => { layer[v] = Math.max(layer[v], layer[u] + 1); if (--indc[v] === 0) q.push(v); }); }
    const cols = {}; ns.forEach((n) => { (cols[layer[n.id]] = cols[layer[n.id]] || []).push(n.id); });
    const pos = {}; Object.keys(cols).sort((a, b) => a - b).forEach((L) => { cols[L].forEach((id, i) => { pos[id] = { x: 80 + Number(L) * 300, y: 60 + i * 160 }; }); });
    commit({ ...s, nodes: ns.map((n) => (pos[n.id] ? { ...n, x: pos[n.id].x, y: pos[n.id].y } : n)) });
    setTimeout(fitView, 20);
  };

  // ---- эффекты: wheel, клавиатура, размеры, fit на монтировании ----
  const actRef = useRef({}); actRef.current = { undo, redo, removeSelected, addChildSel: () => { const ids = selRef.current; if (ids.length === 1) { const p = stateRef.current.nodes.find((n) => n.id === ids[0]); if (p) addChild(p); } } };
  useEffect(() => {
    const el = vpRef.current; if (!el) return;
    const onWheel = (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.1 : 1 / 1.1); };
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setVpSize({ w: r.width, h: r.height }); });
    ro.observe(el);
    const t = setTimeout(() => { fitView(); const r = el.getBoundingClientRect(); setVpSize({ w: r.width, h: r.height }); }, 0);
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? actRef.current.redo() : actRef.current.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); actRef.current.redo(); }
      else if (e.key === "Delete") { e.preventDefault(); actRef.current.removeSelected(); }
      else if (e.key === "Tab") { e.preventDefault(); actRef.current.addChildSel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { el.removeEventListener("wheel", onWheel); ro.disconnect(); clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 1800); return () => clearTimeout(t); }, [toast]);
  // измеряем реальные высоты блоков, чтобы стрелки цеплялись за правильные стороны
  useLayoutEffect(() => {
    if (!contentElRef.current) return; let changed = false;
    contentElRef.current.querySelectorAll("[data-node]").forEach((el) => { const id = el.getAttribute("data-node"); const h = el.offsetHeight; if (sizeRef.current[id] !== h) { sizeRef.current[id] = h; changed = true; } });
    if (changed) force((n) => n + 1);
  });

  const createTask = (n, date) => { if (onCreateTask) onCreateTask(n.title || "Задача", date); setTaskFor(null); setToast("Задача создана во вкладке «Задачи»"); };

  const stop = (e) => e.stopPropagation();
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  // якоря сторон блока (с учётом измеренной высоты) и построение кривой с любой стороны
  const nh = (n) => sizeRef.current[n.id] || 92;
  const sideAnchor = (n, side) => {
    const h = nh(n);
    if (side === "top") return { x: n.x + W / 2, y: n.y };
    if (side === "bottom") return { x: n.x + W / 2, y: n.y + h };
    if (side === "left") return { x: n.x, y: n.y + h / 2 };
    return { x: n.x + W, y: n.y + h / 2 };
  };
  const ctrlOff = (p, side, k) => ({ x: p.x + (side === "left" ? -k : side === "right" ? k : 0), y: p.y + (side === "top" ? -k : side === "bottom" ? k : 0) });
  const pickSides = (a, b) => {
    const ax = a.x + W / 2, ay = a.y + nh(a) / 2, bx = b.x + W / 2, by = b.y + nh(b) / 2;
    const dx = bx - ax, dy = by - ay;
    if (Math.abs(dx) >= Math.abs(dy)) return [dx >= 0 ? "right" : "left", dx >= 0 ? "left" : "right"];
    return [dy >= 0 ? "bottom" : "top", dy >= 0 ? "top" : "bottom"];
  };
  const edgePath = (a, b) => { const [sa, sb] = pickSides(a, b); const p1 = sideAnchor(a, sa), p2 = sideAnchor(b, sb); const c1 = ctrlOff(p1, sa, 55), c2 = ctrlOff(p2, sb, 55); return `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`; };
  const tempPath = (a, side, p2) => { const p1 = sideAnchor(a, side); const c1 = ctrlOff(p1, side, 55); return `M${p1.x},${p1.y} C${c1.x},${c1.y} ${p2.x},${p2.y} ${p2.x},${p2.y}`; };
  const fromNode = connRef.current ? byId[connRef.current.from] : null;
  const counted = (n) => n.hasCheck !== false;
  const countTotal = nodes.filter(counted).length;
  const doneCount = nodes.filter((n) => counted(n) && nodeIsDone(n)).length;
  const todayISO = new Date().toISOString().slice(0, 10);
  const canUndo = histRef.current.past.length > 0, canRedo = histRef.current.future.length > 0;

  // мини-карта
  const mmW = 168, mmH = 116;
  const its = [...nodes.map((n) => ({ x: n.x, y: n.y, w: W, h: 100 })), ...groups.map((g) => ({ x: g.x, y: g.y, w: g.w, h: g.h }))];
  const bMinX = its.length ? Math.min(0, ...its.map((i) => i.x)) : 0;
  const bMinY = its.length ? Math.min(0, ...its.map((i) => i.y)) : 0;
  const bMaxX = its.length ? Math.max(800, ...its.map((i) => i.x + i.w)) : 800;
  const bMaxY = its.length ? Math.max(600, ...its.map((i) => i.y + i.h)) : 600;
  const mm = Math.min(mmW / (bMaxX - bMinX || 1), mmH / (bMaxY - bMinY || 1));
  const mmx = (x) => (x - bMinX) * mm, mmy = (y) => (y - bMinY) * mm;
  const vx = -view.tx / view.s, vy = -view.ty / view.s, vw = vpSize.w / view.s, vh = vpSize.h / view.s;
  const onMiniDown = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const wx = bMinX + (e.clientX - r.left) / mm, wy = bMinY + (e.clientY - r.top) / mm;
    setView((v) => ({ ...v, tx: vpSize.w / 2 - wx * v.s, ty: vpSize.h / 2 - wy * v.s }));
  };

  const tBtn = "flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50 disabled:opacity-30";
  const CM = { tree: { label: "Ветка", icon: GitBranch, hint: "вправо, вниз" }, process: { label: "Шаг", icon: ArrowRight, hint: "в линию" }, duties: { label: "Роль", icon: ListChecks, hint: "роль + чек-лист" } };
  const CMIcon = CM[childMode].icon;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-100 px-3 py-2.5">
        <button onClick={addNode} className="rounded-lg inline-flex items-center gap-1.5 bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800"><Plus size={14} /> Блок</button>
        <button onClick={addGroup} className="rounded-lg inline-flex items-center gap-1.5 border border-neutral-200 px-2.5 py-1.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50" title="Рамка-фаза вокруг выбранных блоков"><Square size={14} /> Фаза</button>
        <button onClick={autoLayout} className="rounded-lg inline-flex items-center gap-1.5 border border-neutral-200 px-2.5 py-1.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50" title="Выровнять по стрелкам"><Wand2 size={14} /> Раскладка</button>
        <div className="relative">
          <button onClick={() => setCmOpen((o) => !o)} title="Что добавляет кнопка «+» на блоке" className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"><CMIcon size={14} /> {CM[childMode].label} <ChevronDown size={13} /></button>
          {cmOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setCmOpen(false)} />
              <div className="absolute left-0 z-20 mt-1 w-56 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Как добавлять ветку</div>
                {Object.keys(CM).map((k) => { const Ic = CM[k].icon; return (
                  <button key={k} onClick={() => { setChildMode(k); if (onModeChange) onModeChange(k); setCmOpen(false); }} className={"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-neutral-50 " + (childMode === k ? "font-semibold text-neutral-900" : "text-neutral-600")}>
                    <Ic size={14} /> <span>{CM[k].label}</span><span className="ml-auto text-[10px] text-neutral-400">{CM[k].hint}</span>
                  </button>
                ); })}
              </div>
            </>
          )}
        </div>
        <div className="mx-1 h-6 w-px bg-neutral-200" />
        <button onClick={() => actRef.current.undo()} disabled={!canUndo} className={tBtn} title="Отменить (Ctrl+Z)"><Undo2 size={15} /></button>
        <button onClick={() => actRef.current.redo()} disabled={!canRedo} className={tBtn} title="Повторить (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
        <div className="mx-1 h-6 w-px bg-neutral-200" />
        <button onClick={() => zoomBtn(1 / 1.2)} className={tBtn} title="Отдалить"><ZoomOut size={15} /></button>
        <span className="w-10 text-center text-xs font-semibold text-neutral-500">{Math.round(view.s * 100)}%</span>
        <button onClick={() => zoomBtn(1.2)} className={tBtn} title="Приблизить"><ZoomIn size={15} /></button>
        <button onClick={fitView} className={tBtn} title="Вписать в экран"><Maximize2 size={15} /></button>
        {countTotal > 0 && <span className="ml-auto rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-500">Готово {doneCount}/{countTotal}</span>}
      </div>

      <div ref={vpRef} onPointerDown={onBgDown} className="relative overflow-hidden" style={{ height: "68vh", touchAction: "none", cursor: "default", background: "#fafafa" }}>
        <div ref={contentElRef} style={{ position: "absolute", left: 0, top: 0, width: CW, height: CH, transformOrigin: "0 0", transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, backgroundImage: "radial-gradient(#e2e2e5 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
          {/* группы (под блоками) */}
          {groups.map((g) => {
            const gs = selGroup === g.id;
            return (
              <div key={g.id} className="absolute rounded-xl" style={{ left: g.x, top: g.y, width: g.w, height: g.h, border: `2px ${gs ? "solid" : "dashed"} ${g.color}`, background: `${g.color}0d`, zIndex: 1 }}>
                <div className="absolute -top-0.5 left-0 flex max-w-full items-center gap-1 rounded-tl-xl rounded-br-lg px-2 py-0.5" style={{ background: g.color, transform: "translateY(-1px)" }}>
                  {editGroup === g.id ? (
                    <input autoFocus defaultValue={g.name} onPointerDown={stop}
                      onBlur={(e) => { patchGroup(g.id, { name: e.target.value.trim() || "Фаза" }); setEditGroup(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); else if (e.key === "Escape") setEditGroup(null); }}
                      className="w-32 rounded bg-white/90 px-1 text-xs font-bold text-neutral-800 focus:outline-none" />
                  ) : (
                    <span onPointerDown={(e) => onGroupDown(e, g)} onDoubleClick={() => setEditGroup(g.id)} className="cursor-grab select-none text-xs font-bold text-white" title="Тяните — переместить фазу (вместе с блоками) · двойной клик — переименовать">{g.name}</span>
                  )}
                  {gs && <Pencil size={11} className="shrink-0 cursor-pointer text-white/80 hover:text-white" onPointerDown={stop} onClick={() => setEditGroup(g.id)} title="Переименовать" />}
                  {gs && <Trash2 size={12} className="shrink-0 cursor-pointer text-white/80 hover:text-white" onPointerDown={stop} onClick={() => removeGroup(g.id)} title="Удалить фазу" />}
                </div>
                <div onPointerDown={(e) => onGResDown(e, g)} className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" style={{ borderRight: `3px solid ${g.color}`, borderBottom: `3px solid ${g.color}`, borderBottomRightRadius: 10 }} />
              </div>
            );
          })}

          <svg width={CW} height={CH} className="pointer-events-none absolute inset-0" style={{ zIndex: 2 }}>
            <defs><marker id="stratArrow" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" fill="#f59e0b" /></marker></defs>
            {edges.map((ed) => {
              const a = byId[ed.from], b = byId[ed.to]; if (!a || !b) return null;
              const d = edgePath(a, b);
              return (
                <g key={ed.id} className="pointer-events-auto" style={{ cursor: "pointer" }} onClick={() => removeEdge(ed.id)}>
                  <path d={d} stroke="transparent" strokeWidth="14" fill="none" />
                  <path d={d} stroke="#f59e0b" strokeWidth="2" fill="none" markerEnd="url(#stratArrow)" />
                </g>
              );
            })}
            {fromNode && connPos && <path d={tempPath(fromNode, connRef.current.side || "right", connPos)} stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 4" fill="none" />}
            {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="#3b82f61a" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4 3" />}
          </svg>

          {nodes.map((n) => {
            const on = sel.includes(n.id); const cnt = n.hasCheck !== false; const done = nodeIsDone(n); const showDone = cnt && done; const hasCl = !!(n.checklist && n.checklist.length);
            const cdone = hasCl ? n.checklist.filter((c) => c.done).length : 0;
            const TI = STRAT_TYPES[n.type || "stage"].icon; const tc = TYPE_COLOR[n.type || "stage"];
            const col = n.color || "#2563eb";
            const portCls = "absolute cursor-crosshair rounded-full bg-white opacity-0 transition group-hover:opacity-100";
            const portStyle = (extra) => ({ width: 12, height: 12, border: `2px solid ${col}`, zIndex: 8, ...extra });
            return (
              <div key={n.id} data-node={n.id} onPointerDown={(e) => onNodeDown(e, n)}
                className="group absolute select-none rounded-xl bg-white shadow-sm"
                style={{ left: n.x, top: n.y, width: W, cursor: "grab", border: `1.5px solid ${col}`, background: showDone ? "#f0fdf4" : "#fff", boxShadow: on ? `0 0 0 2px ${col}40` : undefined, zIndex: on ? 6 : 3 }}>
                <div className="flex items-start gap-1.5 px-2.5 pt-2.5">
                  {cnt && (hasCl ? (
                    <span title="Прогресс по подзадачам" className="mt-0.5 flex shrink-0 items-center justify-center" style={{ width: 18, height: 18, borderRadius: 6, background: done ? "#16a34a" : "#fff", border: done ? "2px solid #16a34a" : "2px solid #d4d4d4", color: "#fff" }}>{done ? <Check size={12} strokeWidth={3} /> : (cdone > 0 && <Minus size={12} strokeWidth={3} style={{ color: "#a3a3a3" }} />)}</span>
                  ) : (
                    <button onPointerDown={stop} onClick={() => patchNode(n.id, { done: !n.done })} className="mt-0.5 flex shrink-0 items-center justify-center" style={{ width: 18, height: 18, borderRadius: 6, background: n.done ? "#16a34a" : "#fff", border: n.done ? "2px solid #16a34a" : "2px solid #d4d4d4", color: "#fff" }} title={n.done ? "Выполнено" : "Отметить"}>{n.done && <Check size={12} strokeWidth={3} />}</button>
                  ))}
                  <TI size={14} className="mt-1 shrink-0" style={{ color: tc }} title={STRAT_TYPES[n.type || "stage"].label} />
                  <textarea value={n.title} rows={1} ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; if (focusRef.current === n.id) { focusRef.current = null; setTimeout(() => el.focus(), 0); } } }} onPointerDown={(e) => { e.stopPropagation(); setSel([n.id]); }} onFocus={pushHist} onChange={(e) => patchLive(n.id, { title: e.target.value })} onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }} placeholder="Этап…" className="min-w-0 flex-1 resize-none overflow-hidden break-words bg-transparent text-sm font-semibold leading-snug text-neutral-800 focus:outline-none" style={showDone ? { textDecoration: "line-through", color: "#737373" } : undefined} />
                  <button onPointerDown={stop} onClick={() => addChild(n)} title="Добавить дочерний блок (Tab)" className={"mt-0.5 shrink-0 rounded p-0.5 transition hover:bg-neutral-100 hover:text-neutral-700 " + (on ? "text-neutral-500 opacity-100" : "text-neutral-400 opacity-0 group-hover:opacity-100")}><Plus size={14} /></button>
                  <button onPointerDown={stop} onClick={() => { setSel([n.id]); setSettingsFor(settingsFor === n.id ? null : n.id); setTaskFor(null); }} title="Настройки блока" className={"mt-0.5 shrink-0 rounded p-0.5 transition hover:bg-neutral-100 hover:text-neutral-700 " + (settingsFor === n.id ? "bg-neutral-100 text-neutral-700" : (on ? "text-neutral-400 opacity-100" : "text-neutral-400 opacity-0 group-hover:opacity-100"))}><Settings2 size={14} /></button>
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
                    {/* заметка */}
                    <textarea value={n.note || ""} onPointerDown={stop} onFocus={pushHist} onChange={(e) => patchLive(n.id, { note: e.target.value })} placeholder="заметка…" rows={2} className="w-full resize-none bg-transparent px-2.5 pt-2 pb-1 text-[11px] leading-snug text-neutral-500 focus:outline-none" />
                    {/* подзадачи */}
                    <div className="px-2.5 py-1.5">
                      {(n.checklist || []).map((c) => (
                        <div key={c.id} className="flex items-center gap-1.5 py-0.5">
                          <button onPointerDown={stop} onClick={() => toggleCheck(n.id, c.id)} className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border" style={{ background: c.done ? "#16a34a" : "#fff", borderColor: c.done ? "#16a34a" : "#d4d4d4", color: "#fff" }}>{c.done && <Check size={9} strokeWidth={3} />}</button>
                          <input value={c.text} onPointerDown={stop} onFocus={pushHist} onChange={(e) => setCheckText(n.id, c.id, e.target.value)} placeholder="подзадача…" className="min-w-0 flex-1 bg-transparent text-[11px] text-neutral-700 focus:outline-none" style={c.done ? { textDecoration: "line-through", color: "#a3a3a3" } : undefined} />
                          <X size={11} className="shrink-0 cursor-pointer text-neutral-300 hover:text-red-500" onPointerDown={stop} onClick={() => removeCheck(n.id, c.id)} />
                        </div>
                      ))}
                      <button onPointerDown={stop} onClick={() => addCheck(n.id)} className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-400 hover:text-neutral-600"><Plus size={11} /> подзадача</button>
                    </div>
                    {/* тип */}
                    <div className="flex items-center gap-1 border-t border-neutral-100 px-2.5 py-1.5">
                      {Object.keys(STRAT_TYPES).map((tk) => { const Ic = STRAT_TYPES[tk].icon; const act = (n.type || "stage") === tk; return (
                        <button key={tk} onPointerDown={stop} onClick={() => patchNode(n.id, { type: tk })} title={STRAT_TYPES[tk].label} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold" style={{ background: act ? `${TYPE_COLOR[tk]}1a` : "transparent", color: act ? TYPE_COLOR[tk] : "#a3a3a3" }}><Ic size={12} />{act && STRAT_TYPES[tk].label}</button>
                      ); })}
                    </div>
                    {/* цвет */}
                    <div className="flex flex-wrap items-center gap-1 border-t border-neutral-100 px-2.5 py-1.5">
                      {SWATCHES.map((c) => (<button key={c} onPointerDown={stop} onClick={() => patchNode(n.id, { color: c })} className="h-4 w-4 rounded-full transition" style={{ background: c, boxShadow: n.color === c ? `0 0 0 2px #fff, 0 0 0 3.5px ${c}` : "none" }} />))}
                    </div>
                    {/* чекбокс вкл/выкл */}
                    <div className="flex items-center gap-2 border-t border-neutral-100 px-2.5 py-1.5">
                      <span className="text-[11px] text-neutral-500">Чекбокс выполнения</span>
                      <button onPointerDown={stop} onClick={() => patchNode(n.id, { hasCheck: !cnt })} title={cnt ? "Убрать чекбокс" : "Добавить чекбокс"} className="relative ml-auto h-4 w-7 shrink-0 rounded-full transition" style={{ background: cnt ? "#16a34a" : "#d4d4d4" }}>
                        <span className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all" style={{ left: cnt ? 14 : 2 }} />
                      </button>
                    </div>
                    {/* действия */}
                    <div className="flex items-center gap-1 border-t border-neutral-100 px-2.5 py-1.5">
                      <button onPointerDown={stop} onClick={() => setTaskFor(taskFor === n.id ? null : n.id)} className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-200"><CalendarPlus size={12} /> В задачу</button>
                      <button onPointerDown={stop} onClick={() => duplicateNode(n.id)} className="ml-auto rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" title="Дублировать блок"><Copy size={13} /></button>
                      <button onPointerDown={stop} onClick={() => removeNode(n.id)} className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500" title="Удалить блок"><Trash2 size={13} /></button>
                    </div>
                    {taskFor === n.id && (
                      <div className="flex items-center gap-1.5 border-t border-neutral-100 bg-neutral-50 px-2.5 py-2">
                        <input type="date" defaultValue={todayISO} onPointerDown={stop} id={`sd-${n.id}`} className="rounded-md border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-700 focus:outline-none" />
                        <button onPointerDown={stop} onClick={() => { const el = document.getElementById(`sd-${n.id}`); createTask(n, el ? el.value : todayISO); }} className="rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-neutral-800">Создать задачу</button>
                      </div>
                    )}
                  </div>
                )}
                {["top", "right", "bottom", "left"].map((sd) => (
                  <span key={sd} onPointerDown={(e) => onPortDown(e, n, sd)} className={portCls + (on ? " opacity-100" : "")} style={portStyle(
                    sd === "top" ? { left: "50%", top: -6, transform: "translateX(-50%)" } :
                    sd === "bottom" ? { left: "50%", bottom: -6, transform: "translateX(-50%)" } :
                    sd === "left" ? { left: -6, top: "50%", transform: "translateY(-50%)" } :
                    { right: -6, top: "50%", transform: "translateY(-50%)" }
                  )} title="Потяните к другому блоку, чтобы соединить" />
                ))}
              </div>
            );
          })}
        </div>

        {/* мини-карта */}
        {(nodes.length > 0 || groups.length > 0) && (
          <div onPointerDown={onMiniDown} className="absolute bottom-3 right-3 cursor-pointer overflow-hidden rounded-lg border border-neutral-200 bg-white/90 shadow-sm" style={{ width: mmW, height: mmH }} title="Клик — перейти">
            <svg width={mmW} height={mmH}>
              {groups.map((g) => <rect key={g.id} x={mmx(g.x)} y={mmy(g.y)} width={g.w * mm} height={g.h * mm} fill={`${g.color}14`} stroke={g.color} strokeWidth="0.5" rx="2" />)}
              {nodes.map((n) => <rect key={n.id} x={mmx(n.x)} y={mmy(n.y)} width={W * mm} height={Math.max(3, 70 * mm)} rx="1.5" fill={nodeIsDone(n) ? "#16a34a" : (n.color || "#94a3b8")} opacity="0.85" />)}
              <rect x={mmx(vx)} y={mmy(vy)} width={vw * mm} height={vh * mm} fill="none" stroke="#111827" strokeWidth="1" />
            </svg>
          </div>
        )}

        {nodes.length === 0 && groups.length === 0 && (
          <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 text-center text-sm text-neutral-400">Пусто. «+ Блок» — добавить этап, «+ Фаза» — рамку.</div>
        )}
        {toast && <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">{toast}</div>}
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-white/80 px-2 py-1 text-[10px] text-neutral-400">Перетаскивание фона — панорама · Shift+рамка — выбор · колесо — зум</div>
      </div>
    </div>
  );
}

function SettingsModal({ statuses, setStatuses, defaultTasks, setDefaultTasks, taskLabels, setTaskLabels, opTypes, setOpTypes, subjects, setSubjects, unitConst, setUnitConst, initialTab, wbApiKey, setWbApiKey, onFetchWb, onClose }) {
  const [tab, setTab] = useState(initialTab || "statuses");

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
      <div className="rounded-2xl flex w-full max-w-lg flex-col overflow-hidden bg-white shadow-xl" style={{ maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-neutral-900"><Settings2 size={18} /> Настройки</h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-neutral-100 px-5 py-2.5">
          <TabBtn id="statuses">Статусы</TabBtn>
          <TabBtn id="tasks">Задачи по умолчанию</TabBtn>
          <TabBtn id="labels">Метки</TabBtn>
          <TabBtn id="subjects">Комиссии ВБ</TabBtn>
          <TabBtn id="unit">Единые данные</TabBtn>
          <TabBtn id="wbapi">API ВБ</TabBtn>
        </div>

        <div className="flex-1 overflow-auto p-5">
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

          {tab === "tasks" && (
            <>
              <p className="mb-3 text-xs text-neutral-400">Эти задачи показываются в карточке, у которой ещё нет своих задач.</p>
              <div className="mb-4 space-y-1.5">
                {(defaultTasks || []).map((t) => (
                  <div key={t.id} className="group flex items-center gap-2 rounded-lg border border-neutral-100 px-2 py-2 hover:border-neutral-200">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" />
                    <input
                      value={t.text}
                      onChange={(e) => setDefaultText(t.id, e.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-sm text-neutral-800 focus:outline-none"
                    />
                    <LabelSelect labels={taskLabels} value={t.labelId} onChange={(v) => setDefaultLabel(t.id, v)} />
                    <button onClick={() => removeDefault(t.id)} className="shrink-0 rounded p-0.5 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100" title="Удалить"><Trash2 size={14} /></button>
                  </div>
                ))}
                {(!defaultTasks || defaultTasks.length === 0) && <p className="py-2 text-center text-sm text-neutral-400">Задач по умолчанию пока нет</p>}
              </div>

              <div className="flex items-center gap-2">
                <input
                  value={tText}
                  onChange={(e) => setTText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addDefault()}
                  placeholder="Новая задача по умолчанию…"
                  className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
                <button onClick={addDefault} disabled={!tText.trim()} className="rounded-lg inline-flex items-center gap-1 bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40">
                  <Plus size={14} /> Добавить
                </button>
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

          {tab === "labels" && (
            <>
              <p className="mb-3 text-xs text-neutral-400">Метки можно присваивать задачам в карточке и в задачах по умолчанию.</p>
              <div className="mb-4 space-y-1.5">
                {(taskLabels || []).map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded-lg border border-neutral-100 px-3 py-2">
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-neutral-700">
                      <span className="rounded-full h-3 w-3" style={{ background: l.color }} />
                      {l.name}
                    </span>
                    <button onClick={() => removeLabel(l.id)} className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить метку"><Trash2 size={15} /></button>
                  </div>
                ))}
                {(!taskLabels || taskLabels.length === 0) && <p className="py-2 text-center text-sm text-neutral-400">Меток пока нет</p>}
              </div>

              <div className="rounded-xl bg-neutral-50 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">Новая метка</p>
                <div className="flex items-center gap-2">
                  <input value={lName} onChange={(e) => setLName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLabel()} placeholder="Например: Срочно" className="rounded-lg flex-1 border border-neutral-200 px-3 py-1.5 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
                  <button onClick={addLabel} className="rounded-md inline-flex items-center gap-1 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"><Plus size={15} /> Добавить</button>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  {SWATCHES.map((c) => (
                    <button key={c} onClick={() => setLColor(c)} className="h-6 w-6 rounded transition" style={{ background: c, boxShadow: lColor === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : "none" }} />
                  ))}
                </div>
              </div>
            </>
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

          {tab === "wbapi" && (
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
