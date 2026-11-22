import { supabase } from "./supabase";

export function projectTables(project = "melori") {
  if (!["melori", "droprise"].includes(project)) throw new Error("Неизвестный проект");
  const prefix = project === "droprise" ? "droprise_" : "";
  return { products: prefix + "products", jobs: prefix + "jobs", settings: prefix + "settings" };
}

export function createProjectCloud(project = "melori") {
  const tables = projectTables(project);
  const queue = new Map();
  function write(key, action) {
    const pending = (queue.get(key) || Promise.resolve()).catch(() => {}).then(action);
    queue.set(key, pending);
    pending.finally(() => { if (queue.get(key) === pending) queue.delete(key); }).catch(() => {});
    return pending;
  }


  async function fetchAll() {
    const [{ data: prods, error: e1 }, { data: sett, error: e2 }] = await Promise.all([
      supabase.from(tables.products).select("id,data"),
      supabase.from(tables.settings).select("key,value"),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const products = (prods || []).map((r) => r.data);
    const settings = {};
    (sett || []).forEach((r) => { settings[r.key] = r.value; });
    // Задачи — построчно в отдельной таблице. Если таблицы ещё нет (до миграции),
    // возвращаем null, и приложение откатывается на settings.jobs.
    let jobs = null;
    try {
      const { data: jr, error: e3 } = await supabase.from(tables.jobs).select("id,data");
      if (e3 && project !== "melori") throw e3;
      if (!e3 && Array.isArray(jr)) jobs = jr.map((r) => r.data);
    } catch (error) { if (project !== "melori") throw error; /* Старые проекты поддерживают settings.jobs. */ }
    if (project !== "melori") {
      const { data, error } = await supabase.from("settings").select("value").eq("key", "profiles").maybeSingle();
      if (error) throw error;
      settings.profiles = data?.value || [];
    }
    return { products, settings, jobs };
  }

  async function upsertProduct(p) {
    return supabase.from(tables.products).upsert({ id: p.id, data: p, updated_at: new Date().toISOString() });
  }
  async function deleteProductRow(id) {
    return supabase.from(tables.products).delete().eq("id", id);
  }
  async function upsertSetting(key, value) {
    return supabase.from(key === "profiles" ? "settings" : tables.settings).upsert({ key, value, updated_at: new Date().toISOString() });
  }

  // — задачи построчно —
  async function upsertJobRow(j) {
    return supabase.from(tables.jobs).upsert({ id: j.id, data: j, updated_at: new Date().toISOString() });
  }
  async function deleteJobRow(id) {
    return supabase.from(tables.jobs).delete().eq("id", id);
  }

  function subscribe({ onProduct, onProductDelete, onSetting, onJob, onJobDelete }) {
    const ch = supabase.channel("rnp-realtime-" + project)
      .on("postgres_changes", { event: "*", schema: "public", table: tables.products }, (payload) => {
        if (payload.eventType === "DELETE") { if (payload.old?.id) onProductDelete(payload.old.id); }
        else if (payload.new?.data) onProduct(payload.new.data);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: tables.settings }, (payload) => {
        if (payload.new?.key) onSetting(payload.new.key, payload.new.value);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: tables.jobs }, (payload) => {
        if (payload.eventType === "DELETE") { if (payload.old?.id && onJobDelete) onJobDelete(payload.old.id); }
        else if (payload.new?.data && onJob) onJob(payload.new.data);
      });
    if (project !== "melori") ch.on("postgres_changes", { event: "*", schema: "public", table: "settings", filter: "key=eq.profiles" }, (payload) => {
      if (payload.new?.key === "profiles") onSetting("profiles", payload.new.value);
    });
    ch.subscribe();
    return () => supabase.removeChannel(ch);
  }


  return {
    fetchAll, subscribe,
    upsertProduct: (row) => write("product:" + row.id, () => upsertProduct(row)),
    deleteProductRow: (id) => write("product:" + id, () => deleteProductRow(id)),
    upsertJobRow: (row) => write("job:" + row.id, () => upsertJobRow(row)),
    deleteJobRow: (id) => write("job:" + id, () => deleteJobRow(id)),
    upsertSetting: (key, value) => write("setting:" + key, () => upsertSetting(key, value)),
  };
}
const primary = createProjectCloud("melori");
export const { fetchAll, subscribe, upsertProduct, deleteProductRow, upsertSetting, upsertJobRow, deleteJobRow } = primary;
