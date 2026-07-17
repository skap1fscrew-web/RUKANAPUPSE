import { useState, useEffect, useRef } from "react";
import { fetchAll, upsertProduct, deleteProductRow, upsertSetting, subscribe } from "./lib/cloud";
import {
  Plus, Trash2, ImagePlus, Settings2, X, Check, Download,
  ChevronRight, ChevronDown, Minus, ArrowRight,
} from "lucide-react";

/* ----------------------------------------------------------------------------
   Конфигурация
---------------------------------------------------------------------------- */

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Фиксированная (примороженная) левая часть таблицы.
const FROZEN = [
  { id: "actions", label: "", width: 44 },
  { id: "image", label: "Фото", width: 64 },
  { id: "code", label: "Код", width: 92 },
  { id: "wb", label: "Артикул ВБ", width: 116 },
  { id: "name", label: "Наименование", width: 220 },
  { id: "status", label: "Статус", width: 156 },
];

// Группы. tab — к какой вкладке относится группа. kind:
//   "columns" — добавляет столбцы к каждой строке товара (как Юнит);
//   "matrix"  — раскрывается под строкой товара (метрики × интеграции, как Внешка).
const TABS = [
  { id: "assortment", label: "Ассортимент" },
  { id: "promotion", label: "Продвижение" },
  { id: "shipment", label: "План отгрузок ВБ" },
  { id: "purchases", label: "Закупки" },
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
const BLOGGER_FIELDS = [
  { id: "who", label: "Исполнитель", type: "text" },
  { id: "link", label: "Ссылка на пост", type: "link" },
  { id: "format", label: "Формат", type: "choice", options: ["инста пост", "инста сторис", "рилс", "тг пост", "тикток"] },
  { id: "integ", label: "Интеграция, ₽", type: "cost" },
  { id: "delivery", label: "Доставка, ₽", type: "cost" },
  { id: "prod", label: "Товар, ₽", type: "cost" },
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

const FILL_COLORS = ["#bbf7d0", "#fed7aa", "#fde68a", "#fecaca", "#e9d5ff", "#bae6fd"];

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
    label: "Юнит",
    accent: "#171717",
    tab: "assortment",
    kind: "columns",
    columns: [
      { id: "cost",       label: "Факт. себес",       field: "cost",       type: "input" },
      { id: "price",      label: "Наша цена",          field: "price",      type: "input" },
      { id: "spp",        label: "СПП, %",             field: "spp",        type: "input", suffix: "%" },
      { id: "priceAfterSpp", label: "Цена после СПП",  type: "calc",
        fn: (p) => { const pr = toNum(p.price), sp = toNum(p.spp); return (!isNaN(pr) && !isNaN(sp)) ? pr * (1 - sp / 100) : NaN; } },
      { id: "commission", label: "Комиссия, %",        field: "commission", type: "input", suffix: "%" },
      { id: "acquiring",  label: "Эквайринг, %",       field: "acquiring",  type: "input", suffix: "%" },
      { id: "buyback",    label: "% выкупа",            field: "buyback",    type: "input", suffix: "%" },
      { id: "logistics",  label: "Баз. логистика ВБ",   field: "logistics",  type: "input" },
      { id: "whCoeff",    label: "Ср. кф складов, %",   field: "whCoeff",    type: "input", suffix: "%" },
      { id: "constrTariff", label: "Констр. тарифов, %", field: "constrTariff", type: "input", suffix: "%" },
      { id: "irp",        label: "ИРП",                 field: "irp",        type: "input" },
      { id: "ktr",        label: "КТР",                 field: "ktr",        type: "input" },
      { id: "defect",     label: "Брак",                field: "defect",     type: "input" },
      { id: "storage",    label: "Хранение",            field: "storage",    type: "input" },
      { id: "logisticsFull", label: "Логист. с уч. % выкупа", type: "calc",
        fn: (p) => {
          const base = toNum(p.logistics), coeff = toNum(p.whCoeff), bb = toNum(p.buyback);
          if (isNaN(base) || isNaN(bb) || bb <= 0) return NaN;
          const cf = isNaN(coeff) ? 1 : coeff / 100;
          return base / (bb / 100) * (cf + 1 - bb / 100);
        } },
      { id: "taxRate",    label: "Налог. ставка, %",    field: "taxRate",    type: "input", suffix: "%" },
      { id: "totalCosts", label: "Общие затраты",       type: "calc",
        fn: (p, cols) => {
          const cost = toNum(p.cost), price = toNum(p.price), spp = toNum(p.spp), comm = toNum(p.commission), acq = toNum(p.acquiring), tax = toNum(p.taxRate);
          const irp = toNum(p.irp) || 0, ktr = toNum(p.ktr) || 0, defect = toNum(p.defect) || 0, stor = toNum(p.storage) || 0;
          if (isNaN(cost) || isNaN(price)) return NaN;
          const commRub = !isNaN(comm) ? price * comm / 100 : 0;
          const acqRub = !isNaN(acq) ? price * acq / 100 : 0;
          const priceAfterSpp = !isNaN(spp) ? price * (1 - spp / 100) : price;
          const taxRub = !isNaN(tax) ? priceAfterSpp * tax / 100 : 0;
          const logCol = cols.find((c) => c.id === "logisticsFull");
          const logVal = logCol ? logCol.fn(p) : 0;
          const log = isNaN(logVal) ? 0 : logVal;
          return cost + commRub + acqRub + log + irp + ktr + defect + stor + taxRub;
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
    id: "gantt",
    label: "РНП",
    accent: "#ea580c",
    tab: "promotion",
    kind: "gantt",
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
    image: null, code: "", wb: "", name: "", status: "", cost: "",
    ...p,
    id: p?.id || uid(),
    external: undefined,
    blocks,
    plan: { sizes: p?.plan?.sizes || [] },
    rnp: p?.rnp || { cells: {}, entries: {}, fills: {}, flags: {}, budget: { allocated: "" } },
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

export default function AssortmentTable() {
  const [products, setProducts] = useState([]);
  const [statuses, setStatuses] = useState(DEFAULT_STATUSES);
  const [metricsByGroup, setMetricsByGroup] = useState(DEFAULT_METRICS_BY_GROUP);
  const [warehouses, setWarehouses] = useState(DEFAULT_WAREHOUSES);
  const [purchases, setPurchases] = useState([]);
  const [rnpStartDate, setRnpStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10);
  });
  const [rnpDays, setRnpDays] = useState(28);
  const [hiddenTasks, setHiddenTasks] = useState({});
  const [enabled, setEnabled] = useState({ unit: true, external: true, razdachi: true, vykupy: true, shipment: true });
  const [activeTab, setActiveTab] = useState("assortment");
  const [expanded, setExpanded] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [statusMgr, setStatusMgr] = useState(false);
  const [ganttModal, setGanttModal] = useState(null);
  const [codeFilter, setCodeFilter] = useState("");
  const [bloggerDB, setBloggerDB] = useState([]);
  const [razdachDB, setRazdachDB] = useState([]);
  const [showBloggerDB, setShowBloggerDB] = useState(false);
  const [showRazdachDB, setShowRazdachDB] = useState(false);
  const [colSettings, setColSettings] = useState(false);
  const [wbApiKey, setWbApiKey] = useState("");
  const [wbOrders, setWbOrders] = useState({}); // { "articleCode:YYYY-MM-DD": count }
  const [wbLoading, setWbLoading] = useState(false);
  const [wbSettingsOpen, setWbSettingsOpen] = useState(false);
  const [panelW, setPanelW] = useState(0);

  const fileInputRef = useRef(null);
  const uploadTarget = useRef(null);
  const scrollRef = useRef(null);

  const syncedRef = useRef({ products: new Map(), settings: {} });
  const dirtyRef = useRef({ products: new Set(), settings: new Set() });

  // UI-настройки (личные) — localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("rnp-ui");
      if (raw) { const ui = JSON.parse(raw); if (ui.enabled) setEnabled((e) => ({ ...e, ...ui.enabled })); if (ui.activeTab) setActiveTab(ui.activeTab); if (ui.hiddenTasks) setHiddenTasks(ui.hiddenTasks); }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("rnp-ui", JSON.stringify({ enabled, activeTab, hiddenTasks })); } catch {}
  }, [enabled, activeTab, hiddenTasks]);

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
        if (Array.isArray(settings.bloggerDB)) { setBloggerDB(settings.bloggerDB); syncedRef.current.settings.bloggerDB = JSON.stringify(settings.bloggerDB); }
        if (Array.isArray(settings.razdachDB)) { setRazdachDB(settings.razdachDB); syncedRef.current.settings.razdachDB = JSON.stringify(settings.razdachDB); }
        if (settings.rnp) {
          if (settings.rnp.startDate) setRnpStartDate(settings.rnp.startDate);
          if (settings.rnp.days) setRnpDays(settings.rnp.days);
          syncedRef.current.settings.rnp = JSON.stringify(settings.rnp);
        }
        if (settings.wbApiKey) { setWbApiKey(settings.wbApiKey); syncedRef.current.settings.wbApiKey = JSON.stringify(settings.wbApiKey); }
      } catch (e) { console.error("Ошибка загрузки:", e); }
      setLoaded(true);
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
    const t = setTimeout(async () => {
      const items = { statuses, warehouses, purchases, bloggerDB, razdachDB, wbApiKey, rnp: { startDate: rnpStartDate, days: rnpDays } };
      for (const [key, value] of Object.entries(items)) {
        const js = JSON.stringify(value);
        if (syncedRef.current.settings[key] !== js) {
          dirtyRef.current.settings.add(key);
          const { error } = await upsertSetting(key, value);
          if (!error) { syncedRef.current.settings[key] = js; dirtyRef.current.settings.delete(key); }
        }
      }
    }, 600);
    return () => clearTimeout(t);
  }, [statuses, warehouses, purchases, bloggerDB, razdachDB, wbApiKey, rnpStartDate, rnpDays, loaded]);

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
        syncedRef.current.settings[key] = js;
        if (key === "statuses") setStatuses(value);
        else if (key === "warehouses") setWarehouses(value);
        else if (key === "purchases") setPurchases(value);
        else if (key === "bloggerDB") setBloggerDB(value);
        else if (key === "razdachDB") setRazdachDB(value);
        else if (key === "wbApiKey") setWbApiKey(value);
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

  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  // Загрузка заказов из WB API
  const fetchWbOrders = async () => {
    if (!wbApiKey) { setWbSettingsOpen(true); return; }
    const nmIdList = products.map(p => parseInt(p.wb)).filter(n => n > 0);
    if (nmIdList.length === 0) { alert("Нет артикулов ВБ"); return; }
    setWbLoading(true);
    try {
      const allDays = [];
      const cur = new Date(rnpStartDate + "T00:00:00");
      const fin = new Date();
      while (cur <= fin) { allDays.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
      const merged = {};
      for (let i = 0; i < allDays.length; i += 7) {
        const batch = allDays.slice(i, i + 7);
        const resp = await fetch("https://ubfqwbdvrynbmydmcysp.supabase.co/functions/v1/wb-orders", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: wbApiKey, days: batch, nmIds: nmIdList }),
        });
        if (resp.ok) { const data = await resp.json(); Object.assign(merged, data); }
      }
      setWbOrders(merged);
    } catch (e) { alert("Ошибка: " + e.message); }
    setWbLoading(false);
  };
  const expandAll = () => setExpanded(Object.fromEntries(products.map((p) => [p.id, true])));
  const collapseAll = () => setExpanded({});
  const statusColor = (name) => statuses.find((s) => s.name === name)?.color || "#a3a3a3";

  /* --- группы / раскладка --- */
  const tabGroups = GROUPS.filter((g) => g.tab === activeTab);
  const visibleGroups = tabGroups.filter((g) => g.kind === "gantt" || enabled[g.id]);
  const columnGroups = visibleGroups.filter((g) => g.kind === "columns");
  const matrixGroups = visibleGroups.filter((g) => g.kind === "matrix");
  const planGroup = visibleGroups.find((g) => g.kind === "plan");
  const ganttGroup = visibleGroups.find((g) => g.kind === "gantt");
  const expandableGroups = visibleGroups.filter((g) => g.kind === "matrix" || g.kind === "plan" || g.kind === "gantt");
  const hasExpandable = expandableGroups.length > 0;
  const allOpen = hasExpandable && products.length > 0 && products.every((p) => expanded[p.id]);
  const entryCount = (p) =>
    expandableGroups.reduce(
      (n, g) => n + (g.kind === "matrix" ? (p.blocks[g.id]?.entries.length || 0) : g.kind === "plan" ? (p.plan?.sizes.length || 0) : 0),
      0
    );

  const frozenCols = hasExpandable
    ? [{ id: "expander", label: "", width: 40 }, ...FROZEN]
    : FROZEN;

  const filteredProducts = codeFilter.trim()
    ? products.filter((p) => (p.code || "").toLowerCase().includes(codeFilter.trim().toLowerCase()))
    : products;

  const lefts = [];
  let acc = 0;
  for (const f of frozenCols) {
    lefts.push(acc);
    acc += f.width;
  }
  const lastFrozen = frozenCols.length - 1;
  const totalCols =
    frozenCols.length + columnGroups.reduce((a, g) => a + g.columns.length, 0);

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
      head = ["Предмет", "Наименование"];
      rows = purchases.map((p) => [p.subject, p.name]);
      fname = "purchases";
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
    } else {
      head = [
        "Код", "Артикул ВБ", "Наименование", "Статус",
        ...columnGroups.flatMap((g) => g.columns.map((c) => `${g.label}: ${c.label}`)),
      ];
      rows = products.map((p) => {
        const right = columnGroups.flatMap((g) =>
          g.columns.map((col) => {
            if (col.type === "input") return p[col.field] ?? "";
            const v = col.fn(p, g.columns);
            return isNaN(v) ? "" : Math.round(v * 100) / 100;
          })
        );
        return [p.code, p.wb, p.name, p.status, ...right];
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
            <span className="text-sm text-neutral-400">{activeTab === "purchases" ? `${purchases.length} в плане закупок` : `${filteredProducts.length} товаров`}</span>
            {activeTab !== "purchases" && (
              <input value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)} placeholder="Фильтр по коду" className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-200" style={{ width: 140 }} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeTab === "promotion" && (
              <>
                <button onClick={() => setWbSettingsOpen(true)} title="Настройки WB API" className="rounded-xl inline-flex items-center justify-center border border-neutral-200 bg-white px-2.5 py-1.5 text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700">
                  <Settings2 size={16} />
                </button>
                <button onClick={() => setShowBloggerDB(true)} className="rounded-xl inline-flex items-center gap-1.5 border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-100">
                  База блогеров
                </button>
                <button onClick={() => setShowRazdachDB(true)} className="rounded-xl inline-flex items-center gap-1.5 border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-100">
                  Раздачницы
                </button>
              </>
            )}
            {hasExpandable && products.length > 0 && (
              <button onClick={allOpen ? collapseAll : expandAll} className="rounded-xl inline-flex items-center gap-1.5 border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                {allOpen ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                {allOpen ? "Свернуть всё" : "Развернуть всё"}
              </button>
            )}
            <button onClick={exportCsv} className="rounded-xl inline-flex items-center gap-1.5 border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              <Download size={15} /> Экспорт CSV
            </button>
            <button onClick={() => setStatusMgr(true)} className="rounded-xl inline-flex items-center gap-1.5 border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              <Settings2 size={15} /> Статусы
            </button>
          </div>
        </div>

        {/* Группы столбцов текущей вкладки — компактный dropdown */}
        {tabGroups.length > 0 && (
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
                  {tabGroups.filter((g) => g.kind !== "gantt").map((g) => {
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

        {/* Таблица товаров (Ассортимент / Продвижение / План отгрузок) */}
        {activeTab !== "purchases" && (
        <div ref={scrollRef} className="rounded-xl overflow-auto border border-neutral-200 bg-white shadow-sm">
          <table className="text-sm" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
            <thead>
              <tr>
                {frozenCols.map((f, i) => (
                  <th
                    key={f.id}
                    rowSpan={2}
                    className="bg-neutral-50 px-3 py-2 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-neutral-500"
                    style={{ ...frozenCell(i), top: 0, zIndex: 40, borderBottom: "1px solid #e5e5e5" }}
                  >
                    {f.label}
                  </th>
                ))}
                {columnGroups.map((g) => (
                  <th
                    key={g.id}
                    colSpan={g.columns.length}
                    className="px-3 py-2 text-center text-xs font-bold uppercase tracking-wide"
                    style={{ position: "sticky", top: 0, zIndex: 30, background: g.accent + "14", color: g.accent, borderBottom: "1px solid " + g.accent + "33", borderLeft: "1px solid " + g.accent + "22" }}
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              <tr>
                {columnGroups.map((g) =>
                  g.columns.map((col, ci) => (
                    <th
                      key={g.id + col.id}
                      className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-neutral-500"
                      style={{ position: "sticky", top: 33, zIndex: 30, background: "#fafafa", borderBottom: "1px solid #e5e5e5", borderLeft: ci === 0 ? "1px solid " + g.accent + "22" : "none" }}
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
                              <button onClick={() => triggerUpload(p.id)} className="rounded-lg mx-auto flex h-11 w-11 items-center justify-center overflow-hidden border border-neutral-200 bg-neutral-50 text-neutral-400 hover:border-neutral-200 hover:text-neutral-600" title="Загрузить фото">
                                {p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={16} />}
                              </button>
                            </td>
                          );
                        if (f.id === "code")
                          return <td key="code" style={base}><CellInput value={p.code} onChange={(v) => updateProduct(p.id, "code", v)} placeholder="—" /></td>;
                        if (f.id === "wb")
                          return <td key="wb" style={base}><CellInput value={p.wb} onChange={(v) => updateProduct(p.id, "wb", v)} placeholder="—" mono /></td>;
                        if (f.id === "name")
                          return <td key="name" style={base}><CellInput value={p.name} onChange={(v) => updateProduct(p.id, "name", v)} placeholder="Название товара" /></td>;
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

                      {columnGroups.map((g) =>
                        g.columns.map((col, ci) => {
                          const isInput = col.type === "input";
                          const val = isInput ? (p[col.field] ?? "") : col.fn(p, g.columns);
                          const fmt = (n) => isNaN(n) ? "—" : (col.suffix === "%" ? n.toFixed(2).replace(/\.?0+$/, "") + "%" : money(n));
                          return (
                            <td
                              key={g.id + col.id}
                              className="px-1 py-1 text-right"
                              style={{ borderBottom: isOpen ? "none" : "1px solid #f5f5f5", borderLeft: ci === 0 ? "1px solid " + g.accent + "1a" : "none", background: isInput ? g.accent + "06" : "#fff" }}
                            >
                              {isInput ? (
                                <input value={val} onChange={(e) => updateProduct(p.id, col.field, e.target.value)} inputMode="decimal" placeholder="0" className="w-full bg-transparent px-1 py-0.5 text-right text-sm text-neutral-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-400" style={{ fontVariantNumeric: "tabular-nums", minWidth: 54 }} />
                              ) : (
                                <span className="text-sm text-neutral-600" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(val)}</span>
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

        {activeTab === "purchases" && (
          <PurchasesTable
            purchases={purchases}
            onAdd={addPurchase}
            onSetField={updatePurchase}
            onRemove={removePurchase}
            onTransfer={transferPurchase}
          />
        )}
      </div>

      {statusMgr && <StatusManager statuses={statuses} setStatuses={setStatuses} onClose={() => setStatusMgr(false)} />}

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
            onSetEntries={(k, arr) => setRnpEntries(gp.id, k, arr)}
            onClose={close}
          />
        );
      })()}

      {showBloggerDB && (
        <RefDB
          title="База блогеров"
          fields={[
            { id: "image", label: "Фото", type: "image" },
            { id: "name", label: "Исполнитель", type: "text" },
            { id: "inst", label: "Инстаграм", type: "link" },
            { id: "tg", label: "Телеграм", type: "link" },
            { id: "tiktok", label: "Тикток", type: "link" },
            { id: "count", label: "Кол-во интеграций", type: "num" },
            { id: "rating", label: "Рейтинг", type: "stars" },
            { id: "price", label: "Стоимость поста", type: "num" },
          ]}
          rows={bloggerDB}
          setRows={setBloggerDB}
          onClose={() => setShowBloggerDB(false)}
        />
      )}
      {showRazdachDB && (
        <RefDB
          title="Раздачницы"
          fields={[
            { id: "image", label: "Фото", type: "image" },
            { id: "name", label: "Исполнитель", type: "text" },
            { id: "inst", label: "Инстаграм", type: "link" },
            { id: "tg", label: "Телеграм", type: "link" },
            { id: "rating", label: "Рейтинг", type: "stars" },
            { id: "comment", label: "Комментарий", type: "text" },
          ]}
          rows={razdachDB}
          onClose={() => setShowRazdachDB(false)}
        />
      )}

      {wbSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4" onClick={() => setWbSettingsOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900">Настройки WB API</h2>
              <button onClick={() => setWbSettingsOpen(false)} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
            </div>
            <p className="mb-3 text-sm text-neutral-500">
              Ключ берётся в кабинете ВБ → Настройки → Доступ к API → категория «Статистика». Ключ хранится в базе, доступен только вашей команде.
            </p>
            <label className="block text-xs font-medium text-neutral-500 mb-1">API-ключ (Статистика)</label>
            <input
              value={wbApiKey}
              onChange={(e) => setWbApiKey(e.target.value)}
              type="password"
              placeholder="eyJhbGci..."
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
              style={{ fontFamily: "monospace" }}
            />
            <div className="mt-4 flex items-center justify-between">
              <button onClick={() => { setWbSettingsOpen(false); fetchWbOrders(); }} disabled={!wbApiKey} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40">
                Сохранить и загрузить
              </button>
              <span className="text-xs text-neutral-400">{wbApiKey ? "✓ ключ задан" : "ключ не задан"}</span>
            </div>
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
   Блок «РНП» — диаграмма Ганта (задачи × дни) + Фонд маркетинга. Один на товар.
---------------------------------------------------------------------------- */

function GanttBlock({ product, hiddenTasks = {}, startDate, days, onSetStartDate, onSetDays, onSetCell, onSetEntries, onSetFill, onSetFlag, onSetBudget, onOpenPopup, onOpenDB, wbOrders = {}, wbLoading, onFetchWb }) {
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

  const recordCost = (task, e) => (task.fields || []).reduce((a, f) => (f.type === "cost" ? a + (toNum(e[f.id]) || 0) : a), 0);
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
        <div className="text-sm font-bold italic" style={{ color: "#ea580c" }}>РНП</div>
        <label className="flex items-center gap-1 text-xs text-neutral-500">
          с
          <input type="date" value={startDate} onChange={(e) => onSetStartDate(e.target.value)} className="rounded-lg border border-neutral-200 px-1.5 py-0.5 text-xs" />
        </label>
        <label className="flex items-center gap-1 text-xs text-neutral-500">
          дней
          <input type="number" min="7" max="120" value={days} onChange={(e) => onSetDays(Math.max(7, Math.min(120, parseInt(e.target.value) || 7)))} className="rounded-lg w-16 border border-neutral-200 px-1.5 py-0.5 text-xs" />
        </label>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setFillMode((v) => !v)} className="rounded-lg border px-2.5 py-1 text-xs font-medium transition" style={fillMode ? { background: "#ea580c", color: "#fff", borderColor: "#ea580c" } : { color: "#737373", borderColor: "#e5e5e5" }}>
            Заливка {fillMode ? "вкл" : "выкл"}
          </button>
          {fillMode && FILL_COLORS.map((c) => (
            <button key={c} onClick={() => setFillColor(c)} className="h-5 w-5" style={{ background: c, boxShadow: fillColor === c ? "0 0 0 2px #fff, 0 0 0 4px #ea580c" : "none" }} />
          ))}
        </div>

        {/* Фонд маркетинга */}
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
      </div>

      <div style={{ overflowX: "auto", paddingBottom: 12 }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ ...sticky(0, LBL_W, "#fafafa", 4), borderTopLeftRadius: 8, borderBottom: "1px solid #e5e5e5" }}></th>
              {dayList.map((d) => (
                <th key={d.key} style={{ width: DAY_W, minWidth: DAY_W, background: d.weekend ? "#f5f5f5" : "#fafafa", borderLeft: d.key === today ? "1px solid #ea580c" : "1px solid #e5e5e5", borderRight: d.key === today ? "1px solid #ea580c" : "none", borderTop: d.key === today ? "1px solid #ea580c" : "none" }} className="px-0.5 py-1 text-center">
                  {d.firstOfMonth && <div className="font-bold text-orange-600" style={{ fontSize: 9 }}>{MONTHS[d.month]}</div>}
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
                          <button onClick={onFetchWb} className="text-left text-xs font-semibold text-orange-700 hover:underline" title={wbLoading ? "Загрузка…" : "Обновить заказы из WB"}>
                            {wbLoading ? "Загрузка…" : task.label} ↻
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
function GanttPopup({ state, cells, entries, onSetCell, onSetEntries, onClose }) {
  const { task, dateKey } = state;
  const isReviews = task.kind === "reviews";
  const entryKey = `${task.id}:${dateKey}`;
  const arr = entries[entryKey] || [];

  const fields = task.fields || [];
  const costFields = fields.filter((f) => f.type === "cost");
  const blankEntry = () => { const e = { id: uid(), done: false }; fields.forEach((f) => { e[f.id] = f.type === "bool" ? false : ""; }); return e; };
  const addEntry = () => onSetEntries(entryKey, [...arr, blankEntry()]);
  const setField = (id, field, val) => onSetEntries(entryKey, arr.map((e) => (e.id === id ? { ...e, [field]: val } : e)));
  const removeEntry = (id) => onSetEntries(entryKey, arr.filter((e) => e.id !== id));
  const recordCost = (e) => costFields.reduce((a, f) => a + (toNum(e[f.id]) || 0), 0);
  const totalCost = arr.reduce((a, e) => a + recordCost(e), 0);

  const optStyle = (sel, opt, choice) => {
    if (sel !== opt) return { background: "#fff", borderColor: "#e5e5e5", color: "#a3a3a3" };
    if (choice) return { background: "#ffedd5", borderColor: "#fdba74", color: "#c2410c" };
    if (opt === "да") return { background: "#f0fdf4", borderColor: "#86efac", color: "#15803d" };
    if (opt === "нет") return { background: "#fee2e2", borderColor: "#fca5a5", color: "#b91c1c" };
    return { background: "#e5e5e5", borderColor: "#d4d4d4", color: "#525252" };
  };

  const renderField = (e, f) => {
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
function EntriesDB({ task, entries, startDate, onSetEntries, onClose }) {
  const fields = task.fields || [];
  const costFields = fields.filter((f) => f.type === "cost");
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
      if (f.type === "bool") e[f.id] = false;
      else if (f.type === "date") e[f.id] = startDate;
      else e[f.id] = "";
    });
    if (isRange) {
      onSetEntries(rangeKey, [...rangeArr(), e]);
    } else {
      onSetEntries(`${task.id}:${startDate}`, [...arrAt(startDate), e]);
    }
  };
  const recordCost = (e) => costFields.reduce((a, f) => a + (toNum(e[f.id]) || 0), 0);
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
                  <th key={f.id} className="bg-neutral-50 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500" style={{ borderBottom: "1px solid #e5e5e5", minWidth: f.type === "text" || f.type === "link" ? 170 : f.type === "triple" ? 200 : f.type === "date" ? 140 : f.type === "bool" ? 118 : 120 }}>{f.label}</th>
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

function RefDB({ title, fields, rows, setRows, onClose }) {
  const fileRef = useRef(null);
  const target = useRef(null);

  const add = () => {
    const r = { id: uid() };
    fields.forEach((f) => { r[f.id] = ""; });
    setRows((prev) => [...prev, r]);
  };
  const set = (id, field, val) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  const remove = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  const pickImage = (id) => { target.current = id; fileRef.current?.click(); };
  const onFile = async (e) => {
    const f = e.target.files?.[0]; const id = target.current; e.target.value = "";
    if (!f || !id) return;
    try { set(id, "image", await fileToThumb(f)); } catch {}
  };

  const inp = "w-full rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      <div className="w-full overflow-auto rounded-2xl bg-white p-5 shadow-xl" style={{ maxWidth: "min(1100px, 95vw)", maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
            <p className="text-sm text-neutral-400">{rows.length} записей</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
        </div>

        <div className="overflow-auto rounded-xl border border-neutral-200">
          <table className="text-sm" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
            <thead>
              <tr>
                {fields.map((f) => (
                  <th key={f.id} className="bg-neutral-50 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500" style={{ borderBottom: "1px solid #e5e5e5", minWidth: f.type === "image" ? 64 : f.type === "link" ? 160 : f.type === "text" ? 160 : 110 }}>{f.label}</th>
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
   Управление статусами
---------------------------------------------------------------------------- */

function StatusManager({ statuses, setStatuses, onClose }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed || statuses.some((s) => s.name === trimmed)) return;
    setStatuses((s) => [...s, { name: trimmed, color }]);
    setName("");
  };
  const remove = (n) => setStatuses((s) => s.filter((x) => x.name !== n));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-md bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">Статусы</h2>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
        </div>

        <div className="mb-4 space-y-1.5">
          {statuses.map((s) => (
            <div key={s.name} className="flex items-center justify-between border border-neutral-100 px-3 py-2">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-neutral-700">
                <span className="rounded-full h-3 w-3" style={{ background: s.color }} />
                {s.name}
              </span>
              <button onClick={() => remove(s.name)} className="p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500" title="Удалить статус"><Trash2 size={15} /></button>
            </div>
          ))}
          {statuses.length === 0 && <p className="py-2 text-center text-sm text-neutral-400">Нет статусов</p>}
        </div>

        <div className="bg-neutral-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">Новый статус</p>
          <div className="flex items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Например: Под заказ" className="rounded-lg flex-1 border border-neutral-200 px-3 py-1.5 text-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            <button onClick={add} className="rounded-md inline-flex items-center gap-1 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"><Plus size={15} /> Добавить</button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {SWATCHES.map((c) => (
              <button key={c} onClick={() => setColor(c)} className="h-6 w-6 transition" style={{ background: c, boxShadow: color === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : "none" }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
