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
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("login"); // login | reset

  const signIn = async () => {
    const e = email.trim();
    if (!e || !password) { setErr("Введите e-mail и пароль."); return; }
    setBusy(true); setErr(""); setInfo("");
    const { error } = await supabase.auth.signInWithPassword({ email: e, password });
    setBusy(false);
    if (error) {
      if (/invalid login credentials/i.test(error.message)) setErr("Неверный e-mail или пароль.");
      else setErr(error.message);
    }
  };

  const resetPassword = async () => {
    const e = email.trim();
    if (!e) { setErr("Введите e-mail, на который придёт ссылка для сброса."); return; }
    setBusy(true); setErr(""); setInfo("");
    const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: window.location.origin });
    setBusy(false);
    if (error) setErr(error.message);
    else setInfo(`Ссылка для сброса пароля отправлена на ${e}.`);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-neutral-900">Вход в РНП</h1>

        {mode === "login" ? (
          <>
            <p className="mt-1 text-sm text-neutral-500">Введите рабочий e-mail и пароль.</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="username"
              className="mt-4 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
              placeholder="Пароль"
              autoComplete="current-password"
              className="mt-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
            {info && <p className="mt-2 text-sm text-green-700">{info}</p>}
            <button onClick={signIn} disabled={busy} className="mt-3 w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-60">
              {busy ? "Входим…" : "Войти"}
            </button>
            <button onClick={() => { setMode("reset"); setErr(""); setInfo(""); }} className="mt-3 w-full text-center text-xs text-neutral-400 hover:text-neutral-600">
              Забыли пароль?
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-neutral-500">Введите e-mail — пришлём ссылку для сброса пароля.</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && resetPassword()}
              placeholder="you@company.com"
              autoComplete="username"
              className="mt-4 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
            {info && <p className="mt-2 text-sm text-green-700">{info}</p>}
            <button onClick={resetPassword} disabled={busy} className="mt-3 w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-60">
              {busy ? "Отправляем…" : "Отправить ссылку"}
            </button>
            <button onClick={() => { setMode("login"); setErr(""); setInfo(""); }} className="mt-3 w-full text-center text-xs text-neutral-400 hover:text-neutral-600">
              ← Назад ко входу
            </button>
          </>
        )}
      </div>
    </div>
  );
}
