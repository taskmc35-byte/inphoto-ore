// InPhoto Ore — gestione account del team.
// Solo un amministratore attivo può creare o modificare account.
// Eccezione: finché non esiste nessun amministratore, "bootstrap" crea il primo.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SECRET = (() => {
  try {
    const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (k.default) return k.default as string;
  } catch (_) { /* fallback sotto */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
})();

const admin = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => json({ error: message }, status);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanName = (s: unknown) => String(s ?? "").trim().slice(0, 80);
const cleanEmail = (s: unknown) => String(s ?? "").trim().toLowerCase();
const okPassword = (s: unknown) => typeof s === "string" && s.length >= 8 && s.length <= 72;

async function adminCount(): Promise<number> {
  const { count, error } = await admin.from("profiles").select("id", { count: "exact", head: true })
    .eq("role", "admin").eq("active", true);
  if (error) throw error;
  return count ?? 0;
}

async function createAccount(email: string, password: string, full_name: string, role: "admin" | "operatore") {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role } });
  if (error) {
    const msg = /already|registered|exists/i.test(error.message)
      ? "Esiste già un account con questa email."
      : "Non sono riuscito a creare l'account: " + error.message;
    return { error: msg };
  }
  const id = data.user!.id;
  const { error: pErr } = await admin.from("profiles").insert({ id, full_name, email, role, active: true });
  if (pErr) {
    await admin.auth.admin.deleteUser(id);
    return { error: "Non sono riuscito a salvare il profilo: " + pErr.message };
  }
  return { id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("Metodo non consentito", 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail("Richiesta non valida"); }
  const action = String(body.action ?? "");

  try {
    // ---- Azioni senza login ----
    if (action === "status") {
      return json({ hasAdmin: (await adminCount()) > 0 });
    }
    if (action === "bootstrap") {
      if ((await adminCount()) > 0) return fail("L'amministratore esiste già: accedi con il tuo account.", 403);
      const email = cleanEmail(body.email), name = cleanName(body.full_name);
      if (!EMAIL_RE.test(email)) return fail("Email non valida.");
      if (!name) return fail("Inserisci il tuo nome.");
      if (!okPassword(body.password)) return fail("La password deve avere almeno 8 caratteri.");
      const r = await createAccount(email, body.password as string, name, "admin");
      return r.error ? fail(r.error) : json({ ok: true, id: r.id });
    }

    // ---- Da qui serve un amministratore ----
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return fail("Accesso richiesto.", 401);
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return fail("Sessione scaduta: accedi di nuovo.", 401);
    const { data: me } = await admin.from("profiles").select("id, role, active").eq("id", u.user.id).maybeSingle();
    if (!me || !me.active || me.role !== "admin") return fail("Solo un amministratore può farlo.", 403);

    if (action === "create") {
      const email = cleanEmail(body.email), name = cleanName(body.full_name);
      const role = body.role === "admin" ? "admin" : "operatore";
      if (!name) return fail("Inserisci il nome.");
      if (!EMAIL_RE.test(email)) return fail("Email non valida.");
      if (!okPassword(body.password)) return fail("La password deve avere almeno 8 caratteri.");
      const r = await createAccount(email, body.password as string, name, role);
      return r.error ? fail(r.error) : json({ ok: true, id: r.id });
    }

    const id = String(body.id ?? "");
    const { data: target } = await admin.from("profiles").select("id, role, active").eq("id", id).maybeSingle();
    if (!target) return fail("Account non trovato.", 404);

    if (action === "update") {
      const patch: Record<string, unknown> = {};
      if (body.full_name !== undefined) {
        const n = cleanName(body.full_name); if (!n) return fail("Il nome non può essere vuoto."); patch.full_name = n;
      }
      if (body.role !== undefined) patch.role = body.role === "admin" ? "admin" : "operatore";
      if (body.active !== undefined) patch.active = !!body.active;

      // Non lasciare il team senza amministratori
      const losingAdmin = target.role === "admin" && target.active &&
        ((patch.role !== undefined && patch.role !== "admin") || patch.active === false);
      if (losingAdmin && (await adminCount()) <= 1) return fail("Serve almeno un amministratore attivo.");

      const { error } = await admin.from("profiles").update(patch).eq("id", id);
      if (error) return fail(error.message);
      if (patch.role !== undefined) await admin.auth.admin.updateUserById(id, { app_metadata: { role: patch.role } });
      if (patch.active !== undefined) {
        // Il blocco impedisce nuovi accessi; i dati sono già chiusi dalle policy (profilo non attivo)
        await admin.auth.admin.updateUserById(id, { ban_duration: patch.active ? "none" : "876000h" });
      }
      return json({ ok: true });
    }

    if (action === "delete") {
      // Elimina l'account ma conserva profilo (nome) e ore nei resoconti
      if (id === me.id) return fail("Non puoi eliminare il tuo account.");
      if (target.role === "admin" && target.active && (await adminCount()) <= 1) return fail("Serve almeno un amministratore attivo.");
      // prima si marca il profilo: se il database non è stato aggiornato (colonna mancante) ci si ferma qui, senza toccare le ore
      const { error: mErr } = await admin.from("profiles").update({ active: false, deleted_at: new Date().toISOString() }).eq("id", id);
      if (mErr) return fail("Il database non è pronto per l'eliminazione: esegui prima lo script SQL di aggiornamento.");
      const { error: dErr } = await admin.auth.admin.deleteUser(id);
      if (dErr && !/not.?found/i.test(dErr.message)) return fail("Non sono riuscito a eliminare l'account: " + dErr.message);
      return json({ ok: true });
    }

    if (action === "set_password") {
      if (!okPassword(body.password)) return fail("La password deve avere almeno 8 caratteri.");
      const { error } = await admin.auth.admin.updateUserById(id, { password: body.password as string });
      return error ? fail(error.message) : json({ ok: true });
    }

    return fail("Azione sconosciuta.");
  } catch (e) {
    console.error(e);
    return fail("Errore del server. Riprova tra poco.", 500);
  }
});
