import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import AssortmentTable from "./AssortmentTable";
export default function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="flex min-h-screen items-center justify-center text-neutral-400">Загрузка…</div>;
  if (!session) return <Login />;
  return (
    <div>
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-1.5 text-sm">
        <span className="font-semibold text-neutral-700">РНП</span>
        <div className="flex items-center gap-3 text-neutral-500">
          <span className="hidden sm:inline">{session.user.email}</span>
          <button onClick={() => supabase.auth.signOut()} className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium hover:bg-neutral-50">Выйти</button>
        </div>
      </div>
      <AssortmentTable />
    </div>
  );
}
function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const e = email.trim(); if (!e) return;
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithOtp({ email: e, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) setErr(error.message); else setSent(true);
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-neutral-900">Вход в РНП</h1>
        <p className="mt-1 text-sm text-neutral-500">Введите рабочий e-mail — пришлём ссылку для входа.</p>
        {sent ? (
          <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">Письмо отправлено на {email}. Откройте ссылку из письма.</div>
        ) : (
          <>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="you@company.com" className="mt-4 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200" />
            {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
            <button onClick={send} disabled={busy} className="mt-3 w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-60">{busy ? "Отправляем…" : "Получить ссылку"}</button>
          </>
        )}
      </div>
    </div>
  );
}
