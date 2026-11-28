// Общие помощники для Telegram-функций (tg-webhook, tg-tick).
// Секреты (задаются через `supabase secrets set`): TG_BOT_TOKEN, TG_WEBHOOK_SECRET.
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.

export const TOKEN = Deno.env.get("TG_BOT_TOKEN") || "";
export const SECRET = Deno.env.get("TG_WEBHOOK_SECRET") || "";
export const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

export const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...((init.headers as Record<string, string>) || {}) },
  });

export async function getSetting(key: string) {
  const r = await rest(`settings?key=eq.${encodeURIComponent(key)}&select=value`);
  const a = await r.json();
  return Array.isArray(a) && a[0] ? a[0].value : null;
}
export async function setSetting(key: string, value: unknown) {
  await rest("settings?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
}
export async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return await r.json();
}
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
// задачи: до двух исполнителей (assignees), иначе assignee
// deno-lint-ignore no-explicit-any
export const jobAssignees = (j: any): string[] => (j && Array.isArray(j.assignees) && j.assignees.length ? j.assignees : (j && j.assignee ? [j.assignee] : [])).filter(Boolean);
// «сейчас» по Москве
export function mskNow() { const d = new Date(Date.now() + 3 * 3600e3); return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() }; }
export function addDays(ds: string, n: number) { const d = new Date(ds + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const fmtDM = (ds: string) => `${ds.slice(8, 10)}.${ds.slice(5, 7)}`;
// deno-lint-ignore no-explicit-any
export const profLabel = (p: any) => (p && (p.name || (p.email ? String(p.email).split("@")[0] : ""))) || "Исполнитель";
export async function loadJobs() {
  const r = await rest("jobs?select=id,data");
  const a = await r.json();
  return Array.isArray(a) ? a.map((x: { id: string; data: Record<string, unknown> }) => x.data) : [];
}

// Для минутной проверки уведомлений не нужны вложения, таблицы и история задачи.
export async function loadNotificationJobs() {
  const fields = "id,title:data->title,date:data->date,stage:data->stage,done:data->done,deletedAt:data->deletedAt,assignee:data->assignee,assignees:data->assignees,createdBy:data->createdBy";
  const result: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await rest(`jobs?select=${encodeURIComponent(fields)}&order=id&limit=1000&offset=${offset}`);
    if (!r.ok) throw new Error(`Не удалось загрузить задачи для уведомлений: ${r.status}`);
    const page = await r.json();
    if (!Array.isArray(page)) throw new Error("Некорректный ответ задач");
    result.push(...page);
    if (page.length < 1000) return result;
  }
}
// История нужна лишь при изменении исполнителя, а не каждую минуту для всех задач.
export async function loadJobAssigner(id: string) {
  const r = await rest(`jobs?id=eq.${encodeURIComponent(id)}&select=log:data->log`);
  if (!r.ok) throw new Error(`Не удалось проверить автора назначения: ${r.status}`);
  const rows = await r.json();
  const log = rows?.[0]?.log;
  return Array.isArray(log) ? [...log].reverse().find((event) => event?.kind === "assignee")?.by || null : null;
}
export function notificationStateJson(state: unknown) {
  return JSON.stringify(state, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.keys(item).sort().reduce((out: Record<string, unknown>, key) => { out[key] = item[key]; return out; }, Object.create(null));
  });
}
