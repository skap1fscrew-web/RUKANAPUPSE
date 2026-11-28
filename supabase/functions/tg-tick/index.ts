// Supabase Edge Function — раз в минуту (pg_cron): шлёт в Telegram
//  • «Вам поручена задача» — когда человека добавили исполнителем;
//  • напоминания о сроке: за день и в день дедлайна (с 10:00 МСК), а также о просрочке (раз в сутки, до 3 дней).
// Состояние (кому что уже отправлено) — в settings.tgState. При первом запуске только запоминает текущие задачи.
// Деплой: supabase functions deploy tg-tick --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { SECRET, getSetting, setSetting, tg, esc, jobAssignees, mskNow, addDays, fmtDM, profLabel, loadNotificationJobs, loadJobAssigner, notificationStateJson } from "../_shared/tg.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const MAX_SENDS = 40;

serve(async (req) => {
  if (!SECRET || req.headers.get("x-tick-secret") !== SECRET) return json({ error: "forbidden" }, 401);
  try {
    const links: Record<string, number> = (await getSetting("tgLinks")) || {};
    const profiles: Any[] = (await getSetting("profiles")) || [];
    const jobs: Any[] = await loadNotificationJobs();
    const stored = await getSetting("tgState");
    const first = !stored;
    const state: { seen: Record<string, string[]>; due: Record<string, string[]> } = { seen: {}, due: {}, ...(stored || {}) };
    const before = notificationStateJson(state);
    const { date: today, hour } = mskNow();
    const tomorrow = addDays(today, 1);
    let sends = 0;
    const nameOf = (pid: string) => profLabel(profiles.find((p) => p.id === pid));

    const send = async (pid: string, title: string, job: Any, head: string) => {
      const chat = links[pid];
      if (!chat || sends >= MAX_SENDS) return false;
      sends++;
      const others = jobAssignees(job).filter((x) => x !== pid).map(nameOf);
      const txt = `${head}\n<b>${esc(title)}</b>${job.date ? `\nСрок: ${fmtDM(job.date)}` : ""}${others.length ? `\nВместе с: ${esc(others.join(", "))}` : ""}`;
      const r = await tg("sendMessage", { chat_id: chat, text: txt, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "✅ Выполнено", callback_data: `done:${job.id}` }]] } });
      return !!r?.ok;
    };

    const newSeen: Record<string, string[]> = {};
    const newDue: Record<string, string[]> = {};
    for (const j of jobs) {
      if (!j || !j.id) continue;
      const open = !j.deletedAt && j.stage !== "done" && !j.done;
      const asg = jobAssignees(j);
      const seen = state.seen[j.id];
      // новые исполнители
      if (!first && open && seen) {
        const added = asg.filter((x) => !seen.includes(x));
        const by = added.length ? (await loadJobAssigner(j.id)) || j.createdBy || null : null;
        for (const pid of added) {
          if (by === pid) continue; // сам себе назначил
          await send(pid, j.title || "Задача", j, "📌 <b>Вам поручена задача</b>");
        }
      } else if (!first && open && !seen && asg.length) {
        // новая задача, появившаяся после базового снимка
        const by = j.createdBy || ((Array.isArray(j.log) && j.log[0] && j.log[0].by) || null);
        for (const pid of asg) { if (by === pid) continue; await send(pid, j.title || "Задача", j, "📌 <b>Вам поручена задача</b>"); }
      }
      newSeen[j.id] = asg;
      // напоминания о сроке
      const sentKeys = new Set(state.due[j.id] || []);
      if (open && j.date && hour >= 10) {
        const key = j.date === today ? `0:${j.date}` : j.date === tomorrow ? `1:${j.date}` : (j.date < today && j.date >= addDays(today, -3)) ? `o:${today}` : null;
        if (key && !sentKeys.has(key)) {
          const head = key.startsWith("0:") ? "⏰ <b>Срок — сегодня</b>" : key.startsWith("1:") ? "🔔 <b>Срок — завтра</b>" : "🔴 <b>Задача просрочена</b>";
          let any = false;
          for (const pid of asg) { if (await send(pid, j.title || "Задача", j, head)) any = true; }
          if (any || !asg.some((p) => links[p])) sentKeys.add(key);
        }
      }
      if (sentKeys.size) newDue[j.id] = [...sentKeys].filter((k) => !k.startsWith("o:") || k === `o:${today}`);
    }
    state.seen = newSeen; state.due = newDue;
    if (first || notificationStateJson(state) !== before) await setSetting("tgState", state);
    return json({ ok: true, first, sends });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
