import { supabase } from "./supabase";

export async function fetchAll() {
  const [{ data: prods, error: e1 }, { data: sett, error: e2 }] = await Promise.all([
    supabase.from("products").select("id,data"),
    supabase.from("settings").select("key,value"),
  ]);
  if (e1) throw e1; if (e2) throw e2;
  const products = (prods || []).map((r) => r.data);
  const settings = {};
  (sett || []).forEach((r) => { settings[r.key] = r.value; });
  // Задачи — построчно в отдельной таблице. Если таблицы ещё нет (до миграции),
  // возвращаем null, и приложение откатывается на settings.jobs.
  let jobs = null;
  try {
    const { data: jr, error: e3 } = await supabase.from("jobs").select("id,data");
    if (!e3 && Array.isArray(jr)) jobs = jr.map((r) => r.data);
  } catch { /* таблицы jobs ещё нет — используем фолбэк */ }
  return { products, settings, jobs };
}

export async function upsertProduct(p) {
  return supabase.from("products").upsert({ id: p.id, data: p, updated_at: new Date().toISOString() });
}
export async function deleteProductRow(id) {
  return supabase.from("products").delete().eq("id", id);
}
export async function upsertSetting(key, value) {
  return supabase.from("settings").upsert({ key, value, updated_at: new Date().toISOString() });
}

// — задачи построчно —
export async function upsertJobRow(j) {
  return supabase.from("jobs").upsert({ id: j.id, data: j, updated_at: new Date().toISOString() });
}
export async function deleteJobRow(id) {
  return supabase.from("jobs").delete().eq("id", id);
}

export function subscribe({ onProduct, onProductDelete, onSetting, onJob, onJobDelete }) {
  const ch = supabase.channel("rnp-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, (payload) => {
      if (payload.eventType === "DELETE") { if (payload.old?.id) onProductDelete(payload.old.id); }
      else if (payload.new?.data) onProduct(payload.new.data);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, (payload) => {
      if (payload.new?.key) onSetting(payload.new.key, payload.new.value);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, (payload) => {
      if (payload.eventType === "DELETE") { if (payload.old?.id && onJobDelete) onJobDelete(payload.old.id); }
      else if (payload.new?.data && onJob) onJob(payload.new.data);
    })
    .subscribe();
  return () => supabase.removeChannel(ch);
}
