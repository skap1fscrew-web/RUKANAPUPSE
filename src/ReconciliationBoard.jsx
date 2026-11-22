import { useEffect, useState } from "react";
import { RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { supabase } from "./lib/supabase";

const prefix = "reconciliation:";
const problemStatuses = ["Открыта", "В работе", "Исправлено, ожидает проверки", "Решено", "Требует повторной проверки"];
const control = "rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-700";
const periodName = (period) => new Date(period + "-02T12:00:00").toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
const stamp = (date) => new Date(date).toLocaleString("ru-RU");
const problemKey = (row) => prefix + "problem:" + row.reconciliation_id + ":" + row.posting_number;
const runKey = (row) => prefix + "run:" + row.id;

export default function ReconciliationBoard({ people = [], userEmail }) {
  const [records, setRecords] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("runs");
  const [selected, setSelected] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [organization, setOrganization] = useState("");
  const [assignee, setAssignee] = useState("");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState(null);
  const [comment, setComment] = useState("");
  const [history, setHistory] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closureNote, setClosureNote] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    const { data, error: failure } = await supabase.from("settings").select("key,value,updated_at").like("key", prefix + "%");
    if (failure) setError("Не удалось загрузить сверки: " + failure.message);
    else setRecords(Object.fromEntries((data || []).map((row) => [row.key, row])));
    setLoading(false);
  }
  useEffect(() => {
    refresh();
    const channel = supabase.channel("reconciliation-board").on("postgres_changes", { event: "*", schema: "public", table: "settings" }, ({ new: row, old, eventType }) => {
      const key = row?.key || old?.key;
      if (!key?.startsWith(prefix)) return;
      setRecords((current) => {
        const next = { ...current };
        if (eventType === "DELETE") delete next[key];
        else next[key] = row;
        return next;
      });
    }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Each problem has its own record. A version check prevents overwriting another employee's changes.
  async function save(key, value, previous) {
    setSaving(true);
    setError("");
    const row = { key, value, updated_at: new Date().toISOString() };
    const request = previous
      ? supabase.from("settings").update(row).eq("key", key).eq("updated_at", previous.updated_at).select()
      : supabase.from("settings").insert(row).select();
    const { data, error: failure } = await request;
    setSaving(false);
    if (failure || !data?.length) {
      setError("Изменения не сохранены. Обновите данные и повторите: " + (failure?.message || "запись уже изменена другим пользователем."));
      return false;
    }
    setRecords((current) => ({ ...current, [key]: data[0] }));
    return true;
  }

  const runs = Object.values(records).filter((row) => row.key.startsWith(prefix + "run:")).map((row) => row.value).sort((a, b) => a.period.localeCompare(b.period));
  const problems = Object.values(records).filter((row) => row.key.startsWith(prefix + "problem:")).map((row) => row.value);
  const selectedId = selected || runs[0]?.id;
  const run = runs.find((row) => row.id === selectedId);
  const name = (id) => people.find((person) => person.id === id)?.name || id || "Не назначен";
  const visible = problems.filter((row) => {
    const parent = runs.find((item) => item.id === row.reconciliation_id);
    return (view === "problems" || row.reconciliation_id === selectedId)
      && (!status || row.status === status)
      && (!organization || parent?.organization === organization)
      && (!assignee || row.assignee === assignee)
      && (!search || (row.posting_number + " " + row.reasons).toLowerCase().includes(search.toLowerCase()));
  });
  function openProblem(row) {
    setEditor({ key: problemKey(row), previous: records[problemKey(row)], draft: { ...row } });
    setComment("");
  }
  async function saveProblem() {
    const draft = editor.draft;
    const changed = draft.status !== editor.previous?.value?.status;
    const value = { ...draft, verified_at: draft.status === "Решено" ? new Date().toISOString() : null, events: [...(draft.events || []), {
      at: new Date().toISOString(), by: userEmail, status: draft.status, assignee: draft.assignee || null,
      text: comment.trim(), kind: changed ? "Изменён статус" : "Обновлена запись",
    }] };
    if (await save(editor.key, value, editor.previous)) setEditor(null);
  }
  async function closeRun() {
    if (!closureNote.trim()) return;
    const value = { ...run, status: "Закрыта", closed_by: userEmail, closed_at: new Date().toISOString(),
      events: [...(run.events || []), { at: new Date().toISOString(), by: userEmail, text: closureNote.trim(), kind: "Исполнитель подтвердил закрытие" }] };
    if (await save(runKey(run), value, records[runKey(run)])) { setClosing(false); setClosureNote(""); }
  }
  const button = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50";
  return <section className="w-full rounded-2xl border border-neutral-200 bg-white p-3">
    <header className="flex flex-wrap items-center gap-2">
      <h2 className="mr-3 text-lg font-bold text-neutral-900">Сверка</h2>
      <div className="flex rounded-lg bg-neutral-100 p-0.5">{[["runs", "Сверки"], ["problems", "Проблемные заказы"]].map(([key, label]) => <button key={key} onClick={() => setView(key)} className={"rounded-md px-2.5 py-1.5 text-xs font-semibold " + (view === key ? "bg-white shadow-sm" : "text-neutral-500")}>{label}</button>)}</div>
      <button disabled={loading || saving} onClick={refresh} className={button + " ml-auto"}><RefreshCw size={14} />{loading ? "Загрузка…" : "Обновить"}</button>
    </header>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <p className="mt-3 text-xs text-neutral-400">Сохранённый реестр сверок. Кнопка «Обновить» загружает записи AllPlugs. Данные Ozon и МС — по состоянию на указанную отсечку.</p>
    {view === "runs" && <>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm">
        <thead className="text-[11px] text-neutral-400"><tr>{["ИП / организация", "Маркетплейс", "Период", "Статус сверки", "Проблемных отправлений"].map((label) => <th key={label} className="p-2 font-semibold">{label}</th>)}</tr></thead>
        <tbody>{runs.map((item) => <tr key={item.id} onClick={() => { setSelected(item.id); setHistory(false); }} className={"cursor-pointer border-t border-neutral-100 " + (selectedId === item.id ? "bg-neutral-50" : "hover:bg-neutral-50")}>
          <td className="p-2 font-semibold">{item.organization}</td><td className="p-2">{item.marketplace}</td><td className="p-2 capitalize">{periodName(item.period)}</td><td className="p-2">{item.status}</td>
          <td className="p-2">{problems.filter((problem) => problem.reconciliation_id === item.id && problem.status !== "Решено").length}{item.status.includes("обновления") && <span className="ml-1 text-xs text-neutral-400">по старой сверке</span>}</td>
        </tr>)}</tbody>
      </table></div>
      {run && <div className="mt-4 border-t border-neutral-100 pt-4">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-base font-bold">{run.organization} · {run.marketplace} · {periodName(run.period)}</h3>
          <button className={button} onClick={() => setHistory((value) => !value)}>{history ? "Проблемные отправления" : "История"}</button>
          {run.status !== "Закрыта" && <button disabled={loading || saving} className={button} onClick={() => setClosing(true)}>Подтвердить закрытие</button>}
        </div>
        <p className="mt-1 text-xs text-neutral-400">Данные по {run.checked_through} · {run.conditions}</p>
      </div>}
    </>}
    {history && view === "runs" ? <div className="mt-4 space-y-3 text-sm">

      {(run?.events || []).map((event, index) => <p key={index}>{stamp(event.at)} · {event.by} · {event.kind} · {event.text}</p>)}
    </div> : <>
      <div className="mt-4 flex items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Проблемные отправления</h3>
        <button aria-label="Фильтры проблемных заказов" aria-expanded={filterOpen} onClick={() => setFilterOpen((value) => !value)} className={button}><SlidersHorizontal size={15} /></button>
      </div>
      {filterOpen && <div className="mt-2 flex flex-wrap gap-2 rounded-xl bg-neutral-50 p-3">
        <input aria-label="Поиск отправления" className={control} placeholder="Отправление или причина" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="Статус проблемы" className={control} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Все статусы</option>{problemStatuses.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Организация" className={control} value={organization} onChange={(event) => setOrganization(event.target.value)}><option value="">Все организации</option>{[...new Set(runs.map((item) => item.organization))].map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Исполнитель" className={control} value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="">Все исполнители</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
        <button className={button} onClick={() => { setStatus(""); setOrganization(""); setAssignee(""); setSearch(""); }}>Сбросить</button>
      </div>}
      <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm">
        <thead className="text-[11px] text-neutral-400"><tr>{["Отправление", "Причины расхождений", "Статус", "Исполнитель", ""].map((label, index) => <th key={index} className="p-2 font-semibold">{label}</th>)}</tr></thead>
        <tbody>{visible.map((row) => <tr key={problemKey(row)} className="border-t border-neutral-100 hover:bg-neutral-50">
          <td className="p-2 align-top font-semibold">{row.posting_number}<div className="mt-1 text-xs font-normal text-neutral-400">{row.scheme} · {runs.find((item) => item.id === row.reconciliation_id)?.period}</div></td>
          <td className="max-w-lg p-2 align-top">{row.reasons.split(" • ").map((reason, index) => <p key={index}>{reason}</p>)}</td><td className="p-2 align-top">{row.status}</td><td className="p-2 align-top">{name(row.assignee)}</td>
          <td className="p-2 align-top"><button disabled={loading} onClick={() => openProblem(row)} className="text-xs font-semibold text-neutral-600">Открыть →</button></td>
        </tr>)}</tbody>
      </table>{!visible.length && <p className="p-5 text-sm text-neutral-400">По выбранным условиям проблемных отправлений нет.</p>}</div>
    </>}
    {editor && <div className="fixed inset-0 z-[85] flex items-center justify-center bg-neutral-900/40 p-4" onClick={() => !saving && setEditor(null)}>
      <div role="dialog" aria-modal="true" aria-label="Проблемное отправление" className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2"><h3 className="mr-auto text-lg font-bold">{editor.draft.posting_number}</h3><button disabled={saving} aria-label="Закрыть" onClick={() => setEditor(null)}><X size={18} /></button></div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600">{editor.draft.reasons}</p>
        <div className="mt-4 flex flex-wrap gap-2"><select aria-label="Статус" className={control} value={editor.draft.status} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, status: event.target.value } })}>{problemStatuses.map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="Ответственный" className={control} value={editor.draft.assignee || ""} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, assignee: event.target.value || null } })}><option value="">Не назначен</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
        </div>
        <label className="mt-4 block text-xs text-neutral-500">Решение / результат проверки<textarea rows={3} className={control + " mt-1 w-full text-sm"} value={editor.draft.resolution || ""} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, resolution: event.target.value } })} /></label>
        <label className="mt-3 block text-xs text-neutral-500">Комментарий<textarea rows={2} className={control + " mt-1 w-full text-sm"} value={comment} onChange={(event) => setComment(event.target.value)} /></label>
        <h4 className="mt-4 text-xs font-semibold text-neutral-400">ИСТОРИЯ</h4>
        <p className="mt-2 text-xs text-neutral-500">Впервые обнаружено: {editor.draft.first_seen} · последняя сверка: {editor.draft.last_seen}</p>
        {(editor.draft.events || []).map((event, index) => <p key={index} className="mt-2 text-xs text-neutral-600">{stamp(event.at)} · {event.by} · {event.status} · {event.text}</p>)}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <button disabled={saving} onClick={saveProblem} className="mt-4 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Сохранение…" : "Сохранить"}</button>
      </div>
    </div>}
    {closing && <div className="fixed inset-0 z-[85] flex items-center justify-center bg-neutral-900/40 p-4">
      <div role="dialog" aria-modal="true" aria-label="Закрытие сверки" className="w-full max-w-md rounded-2xl bg-white p-5">
        <h3 className="text-lg font-bold">Закрываем сверку?</h3><p className="mt-2 text-sm">{run.organization} · {run.marketplace} · {periodName(run.period)}</p>
        <p className="mt-2 text-sm">Открытых проблем: {problems.filter((row) => row.reconciliation_id === run.id && row.status !== "Решено").length}. {run.conditions}</p>
        <p className="mt-2 text-xs text-neutral-500">Подтверждение будет записано от {userEmail}. Проблемные отправления и их история сохранятся.</p>
        <textarea aria-label="Основание закрытия" placeholder="Основание закрытия и ограничения" className={control + " mt-3 w-full"} value={closureNote} onChange={(event) => setClosureNote(event.target.value)} />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex gap-2"><button disabled={saving || !closureNote.trim()} className="rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50" onClick={closeRun}>Подтверждаю закрытие</button><button disabled={saving} className={button} onClick={() => setClosing(false)}>Отмена</button></div>
      </div>
    </div>}
  </section>;
}
