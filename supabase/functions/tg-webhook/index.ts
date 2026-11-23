// Supabase Edge Function — вебхук Telegram-бота.
// • /start КОД — привязка чата к профилю (код создаётся в приложении: Настройки → Telegram)
// • обычный текст — создаёт задачу (исполнитель — вы или «@имя», срок: «сегодня/завтра/послезавтра/25.11»)
// • /tasks — мои открытые задачи; кнопка «✅ Выполнено» под уведомлениями
// Первый запуск: открыть в браузере  <url функции>?setup=<TG_WEBHOOK_SECRET>
// Деплой: supabase functions deploy tg-webhook --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { SECRET, SB_URL, rest, getSetting, setSetting, tg, esc, jobAssignees, mskNow, addDays, fmtDM, profLabel, loadJobs } from "../_shared/tg.ts";

const commands = [
  { command: "tasks", description: "Мои открытые задачи" },
  { command: "blogger", description: "Добавить блогера в РНП Мелори" },
  { command: "start", description: "Привязать аккаунт" },
];
// Идемпотентно обновляем меню при запуске новой версии, без сообщений в чаты.
try {
  const installed = await tg("setMyCommands", { commands });
  console.info("telegram_commands_registered", installed?.ok === true);
} catch {
  console.error("telegram_commands_registration_failed");
}

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Any = any;

function parseTask(raw: string, profiles: Any[], selfId: string) {
  let text = raw.trim();
  let assignee = selfId;
  let unknown: string | null = null;
  let priority = "high";
  const pm = text.match(/(^|\s)!(низк\S*|средн\S*|высок\S*)/i);
  if (pm) { const w = pm[2].toLowerCase(); priority = w.startsWith("низк") ? "low" : w.startsWith("средн") ? "med" : "high"; text = text.replace(pm[0], " "); }
  const m = text.match(/(^|\s)@([\p{L}\p{N}_.-]+)/u);
  if (m) {
    const q = m[2].toLowerCase();
    const p = profiles.find((x) => profLabel(x).toLowerCase() === q) || profiles.find((x) => profLabel(x).toLowerCase().startsWith(q));
    if (p) { assignee = p.id; text = text.replace(m[0], " "); } else unknown = m[2];
  }
  const today = mskNow().date;
  let date: string | null = null;
  const kw = text.match(/(^|\s)(?:до\s+)?(сегодня|завтра|послезавтра)(?=\s|$|[.,!])/i);
  if (kw) { date = addDays(today, { "сегодня": 0, "завтра": 1, "послезавтра": 2 }[kw[2].toLowerCase()] as number); text = text.replace(kw[0], " "); }
  else {
    const dm = text.match(/(^|\s)(?:до\s+)?(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?=\s|$|[.,!])/);
    if (dm) {
      const dd = +dm[2], mm = +dm[3]; let yy = dm[4] ? +dm[4] : +today.slice(0, 4); if (yy < 100) yy += 2000;
      let ds = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      if (!dm[4] && ds < today) ds = `${yy + 1}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) { date = ds; text = text.replace(dm[0], " "); }
    }
  }
  const title = text.replace(/\s+/g, " ").trim().replace(/^[-–—:,.\s]+|[,\s]+$/g, "");
  return { title, assignee, date, priority, unknown };
}

serve(async (req) => {
  const url = new URL(req.url);
  // разовая настройка вебхука
  if (req.method === "GET") {
    if (!SECRET || url.searchParams.get("setup") !== SECRET) return json({ error: "forbidden" }, 403);
    const hook = `${SB_URL}/functions/v1/tg-webhook`;
    const a = await tg("setWebhook", { url: hook, secret_token: SECRET, allowed_updates: ["message", "callback_query"] });
    const b = await tg("setMyCommands", { commands });
    const me = await tg("getMe", {});
    return json({ webhook: a, commands: b, bot: me?.result?.username });
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== SECRET || !SECRET) return json({ error: "forbidden" }, 401);
  try {
    const upd = await req.json();
    const links: Record<string, number> = (await getSetting("tgLinks")) || {};
    const profiles: Any[] = (await getSetting("profiles")) || [];
    const byChat = (chat: number) => Object.keys(links).find((pid) => links[pid] === chat) || null;

    // кнопка «Выполнено»
    if (upd.callback_query) {
      const cq = upd.callback_query, chat = cq.message?.chat?.id, pid = byChat(chat);
      const mm = String(cq.data || "").match(/^done:(.+)$/);
      if (!pid || !mm) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Не удалось" }); return json({ ok: true }); }
      const jobs = await loadJobs();
      const job = jobs.find((j: Any) => j.id === mm[1]);
      if (!job || !jobAssignees(job).includes(pid)) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Задача не найдена или не ваша" }); return json({ ok: true }); }
      const nj = { ...job, stage: "done", done: true };
      await rest(`jobs?id=eq.${encodeURIComponent(job.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ data: nj, updated_at: new Date().toISOString() }) });
      await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Отмечено выполненным" });
      await tg("editMessageText", { chat_id: chat, message_id: cq.message.message_id, parse_mode: "HTML", text: `✅ <s>${esc(job.title)}</s> — выполнено` });
      return json({ ok: true });
    }

    const msg = upd.message;
    if (!msg || !msg.text) return json({ ok: true });
    const chat = msg.chat.id, text: string = msg.text.trim();
    const say = (t: string, extra: Record<string, unknown> = {}) => tg("sendMessage", { chat_id: chat, text: t, parse_mode: "HTML", ...extra });

    if (/^\/start/i.test(text)) {
      const code = text.split(/\s+/)[1] || "";
      const codes: Record<string, { pid: string; exp: number }> = (await getSetting("tgCodes")) || {};
      const c = code && codes[code];
      if (c && c.exp > Date.now()) {
        links[c.pid] = chat; delete codes[code];
        await setSetting("tgLinks", links); await setSetting("tgCodes", codes);
        const p = profiles.find((x) => x.id === c.pid);
        await say(`✅ Готово, ${esc(profLabel(p))}! Теперь я присылаю сюда поручения и напоминания о дедлайнах.\n\nЧтобы создать задачу, просто напишите её текстом, например:\n<i>Позвонить в Китай завтра</i>\n<i>Проверить приёмку до 25.11 @Анна</i>\n\n/tasks — ваши открытые задачи.\n/blogger — добавить блогера в РНП Мелори.`);
      } else if (byChat(chat)) {
        await say("Аккаунт уже привязан. Напишите текст — создам задачу, /tasks — список ваших задач. /blogger — добавить блогера в РНП Мелори.");
      } else {
        await say("Чтобы привязать аккаунт: откройте приложение → Настройки → Telegram → «Привязать» и перейдите по ссылке.");
      }
      return json({ ok: true });
    }

    const pid = byChat(chat);
    if (!pid) { await say("Сначала привяжите аккаунт: приложение → Настройки → Telegram → «Привязать»."); return json({ ok: true }); }

    if (/^\/blogger(?:@\w+)?(?:\s|$)/i.test(text)) {
      if (msg.chat.type !== "private") { await say("Откройте личный чат с ботом и отправьте /blogger."); return json({ ok: true }); }
      await tg("setMyCommands", { commands });
      await say("Добавьте интеграцию блогера в РНП проекта «Мелори».", { reply_markup: { inline_keyboard: [[{ text: "Добавить блогера", web_app: { url: "https://skap1fscrew-web-rukanapupse-09ae.twc1.net/?miniapp=blogger" } }]] } });
      return json({ ok: true });
    }

    if (/^\/tasks/i.test(text)) {
      const jobs = (await loadJobs()).filter((j: Any) => !j.deletedAt && j.stage !== "done" && !j.done && jobAssignees(j).includes(pid));
      jobs.sort((a: Any, b: Any) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
      if (!jobs.length) { await say("Открытых задач нет 🎉"); return json({ ok: true }); }
      const today = mskNow().date;
      const lines = jobs.slice(0, 20).map((j: Any) => `${j.date ? (j.date < today ? "🔴" : j.date === today ? "🟠" : "▫️") : "▫️"} ${esc(j.title)}${j.date ? ` — ${fmtDM(j.date)}` : ""}`);
      await say(`<b>Ваши задачи (${jobs.length})</b>\n` + lines.join("\n") + (jobs.length > 20 ? `\n… и ещё ${jobs.length - 20}` : ""));
      return json({ ok: true });
    }
    if (text.startsWith("/")) { await say("Напишите текст — создам задачу, /tasks — задачи, /blogger — блогеры."); return json({ ok: true }); }

    const t = parseTask(text, profiles, pid);
    if (t.unknown) { await say(`Не нашёл «@${esc(t.unknown)}». Исполнители: ${profiles.map((x) => esc(profLabel(x))).join(", ")}. Напишите задачу ещё раз.`); return json({ ok: true }); }
    if (!t.title) { await say("Не понял, о чём задача. Напишите текст задачи."); return json({ ok: true }); }
    const now = new Date().toISOString();
    const job = {
      id: crypto.randomUUID(), title: t.title, date: t.date, start: null, done: false, labelId: null, productId: null, priority: t.priority,
      assignee: t.assignee, assignees: [t.assignee], tags: [], stage: "wait", note: "Из Telegram", checklist: [], createdAt: now.slice(0, 10), createdBy: pid,
      log: [{ id: crypto.randomUUID().slice(0, 8), ts: now, kind: "created", by: pid }],
    };
    await rest("jobs?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: job.id, data: job, updated_at: now }) });
    const who = t.assignee === pid ? "на вас" : `на ${esc(profLabel(profiles.find((x) => x.id === t.assignee)))}`;
    await say(`✅ Задача создана ${who}\n<b>${esc(t.title)}</b>${t.date ? `\nСрок: ${fmtDM(t.date)}` : "\nСрок не указан"}\nПриоритет: ${t.priority === "high" ? "высокий" : t.priority === "med" ? "средний" : "низкий"}`);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: true }); // Telegram не должен ретраить
  }
});
