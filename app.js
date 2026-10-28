/* InPhoto Ore — logica dell'app.
   Dati su Supabase: profiles, clients, projects, entries (una riga per fascia di 30 minuti). */
(function () {
"use strict";

/* ================= Utilità ================= */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const SLOTS = Array.from({ length: 48 }, (_, i) => i);           // 0 = 00:00 … 47 = 23:30
const slotTime = s => pad(Math.floor(s / 2)) + ":" + (s % 2 ? "30" : "00");
const slotEnd = s => s === 47 ? "24:00" : slotTime(s + 1);
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parse = s => { const [a, b, c] = s.split("-").map(Number); return new Date(a, b - 1, c); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => addDays(d, -((d.getDay() + 6) % 7));
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const fmtH = n => (Math.round(n * 10) / 10).toString().replace(".", ",") + " h";
const GIORNI = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
const G3 = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDate = s => { const d = parse(s); return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear(); };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return [t.getUTCFullYear(), Math.ceil(((t - y0) / 864e5 + 1) / 7)];
}
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2400); }
function genPassword() {
  const a = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = new Uint32Array(12); crypto.getRandomValues(r);
  return Array.from(r, x => a[x % a.length]).join("");
}
async function copyText(txt, fallbackEl) {
  try { await navigator.clipboard.writeText(txt); toast("Copiato"); }
  catch { const r = document.createRange(); r.selectNodeContents(fallbackEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Seleziona e copia"); }
}

/* ================= Configurazione ================= */
const CFG = window.INPHOTO_CONFIG || {};
if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) {
  document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">Configurazione mancante: compila <code>config.js</code> con indirizzo e chiave del progetto Supabase.</p>';
  return;
}
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "inphoto-ore-auth" }
});
const FN_URL = CFG.supabaseUrl.replace(/\/$/, "") + "/functions/v1/admin-users";

async function callAdmin(action, payload = {}, withAuth = true) {
  const headers = { "Content-Type": "application/json", apikey: CFG.supabaseKey };
  if (withAuth) {
    const { data } = await sb.auth.getSession();
    if (data.session) headers.Authorization = "Bearer " + data.session.access_token;
  }
  let res;
  try { res = await fetch(FN_URL, { method: "POST", headers, body: JSON.stringify({ action, ...payload }) }); }
  catch { throw new Error("Nessuna connessione. Controlla internet e riprova."); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Errore " + res.status);
  return body;
}

/* ================= Stato ================= */
const S = {
  me: null, profiles: [], clients: [], projects: [],
  cur: today0(), view: "day",
  days: {},            // "YYYY-MM-DD" -> { slot: entry }
  loadedWeeks: new Set(),
  sumPeriod: "week", sumRef: today0(),
};
const isAdmin = () => S.me && S.me.role === "admin";

/* ================= Tema ================= */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("inphoto-theme", t); } catch {}
  $("thDark").setAttribute("aria-pressed", t === "dark"); $("thLight").setAttribute("aria-pressed", t === "light");
  document.querySelector('meta[name="theme-color"]').content = t === "dark" ? "#121314" : "#f5f5f6";
}
$("thDark").onclick = () => setTheme("dark");
$("thLight").onclick = () => setTheme("light");

/* ================= Accesso ================= */
function authMsg(m) { $("authMsg").textContent = m || ""; $("authMsg").hidden = !m; }
async function showAuth() {
  $("app").hidden = true; $("auth").hidden = false; authMsg("");
  $("loginForm").hidden = true; $("bootForm").hidden = true;
  try {
    const st = await callAdmin("status", {}, false);
    if (st.hasAdmin) $("loginForm").hidden = false; else $("bootForm").hidden = false;
  } catch (e) { $("loginForm").hidden = false; }
}
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); authMsg(""); $("loginBtn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $("loginEmail").value.trim(), password: $("loginPass").value });
  $("loginBtn").disabled = false;
  if (error) { authMsg(/invalid/i.test(error.message) ? "Email o password non corrette." : /banned/i.test(error.message) ? "Questo account è disattivato. Parla con l'amministratore." : error.message); return; }
  $("loginPass").value = ""; start();
});
$("bootForm").addEventListener("submit", async e => {
  e.preventDefault(); authMsg(""); $("bootBtn").disabled = true;
  try {
    await callAdmin("bootstrap", { full_name: $("bootName").value, email: $("bootEmail").value, password: $("bootPass").value }, false);
    const { error } = await sb.auth.signInWithPassword({ email: $("bootEmail").value.trim(), password: $("bootPass").value });
    if (error) throw error;
    start();
  } catch (err) { authMsg(err.message); }
  $("bootBtn").disabled = false;
});
$("logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

async function start() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return showAuth();
  const uid = data.session.user.id;
  const { data: prof, error } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
  if (error || !prof || !prof.active) {
    await sb.auth.signOut(); await showAuth();
    authMsg("Questo account non è attivo. Parla con l'amministratore.");
    return;
  }
  S.me = prof;
  $("auth").hidden = true; $("app").hidden = false;
  document.querySelectorAll("[data-admin]").forEach(el => el.hidden = !isAdmin());
  $("who").textContent = prof.full_name + (isAdmin() ? " · amministratore" : "");
  await loadLookups();
  buildGrid();
  setTheme(document.documentElement.dataset.theme || "light");
  await goDay(S.cur, true);
}
sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT" && !$("app").hidden) location.reload(); });

/* ================= Clienti, progetti, persone ================= */
async function loadLookups() {
  const [c, p, u] = await Promise.all([
    sb.from("clients").select("*").order("name"),
    sb.from("projects").select("*").order("name"),
    sb.from("profiles").select("id, full_name, email, role, active, created_at").order("full_name"),
  ]);
  if (c.error || p.error || u.error) toast("Non riesco a caricare clienti e progetti");
  S.clients = c.data || []; S.projects = p.data || []; S.profiles = u.data || [];
}
const clientById = id => S.clients.find(c => c.id === id);
const projectById = id => S.projects.find(p => p.id === id);
const profileById = id => S.profiles.find(p => p.id === id);
const chip = clientId => {
  if (!clientId) return "var(--muted)";
  const i = S.clients.findIndex(c => c.id === clientId);
  return "var(--c" + ((i < 0 ? 0 : i) % 8) + ")";
};
const clientName = id => id ? (clientById(id)?.name || "Cliente eliminato") : "Senza cliente";
const projectName = id => id ? (projectById(id)?.name || "—") : "";

/* opzioni del menu Cliente/Progetto di una fascia */
function cpOptions(selClient, selProject) {
  let h = '<option value="">Cliente / progetto</option>';
  S.clients.forEach(c => {
    const projs = S.projects.filter(p => p.client_id === c.id && (!p.archived || p.id === selProject));
    if (c.archived && c.id !== selClient) return;
    h += '<optgroup label="' + esc(c.name) + '">';
    h += '<option value="c:' + c.id + '">' + esc(c.name) + (projs.length ? " · generale" : "") + '</option>';
    projs.forEach(p => { h += '<option value="p:' + p.id + '">' + esc(c.name) + " › " + esc(p.name) + '</option>'; });
    h += '</optgroup>';
  });
  h += '<option value="__new">+ Aggiungi cliente o progetto…</option>';
  return h;
}
const cpValue = e => e && e.project_id ? "p:" + e.project_id : e && e.client_id ? "c:" + e.client_id : "";

/* ================= Giorno ================= */
let built = false;
function buildGrid() {
  if (built) return; built = true;
  const grid = $("grid");
  SLOTS.forEach(s => {
    const row = document.createElement("div");
    row.className = "row" + (s % 2 ? " hour" : "");
    row.dataset.s = s;
    row.innerHTML =
      '<span class="tm"><b>' + slotTime(s) + '</b>–' + slotEnd(s) + '</span>' +
      '<textarea class="txt" rows="1" id="t' + s + '" maxlength="500" placeholder="Su cosa hai lavorato?" aria-label="Attività ' + slotTime(s) + '–' + slotEnd(s) + '"></textarea>' +
      '<span class="side"><select class="cp" id="c' + s + '" aria-label="Cliente e progetto ' + slotTime(s) + '"></select>' +
      '<button class="lun" id="l' + s + '" aria-pressed="false" title="Segna come pausa pranzo">Pranzo</button>' +
      '<button class="rep" id="r' + s + '" title="Copia la fascia precedente" aria-label="Copia la fascia precedente"' + (s === 0 ? " disabled" : "") + '>↑</button></span>';
    grid.appendChild(row);
    const txt = row.querySelector(".txt"), sel = row.querySelector(".cp");
    txt.addEventListener("input", () => { grow(txt); setSlot(s, { description: txt.value }); });
    txt.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (s < 47) $("t" + (s + 1)).focus(); } });
    sel.addEventListener("change", () => {
      const v = sel.value;
      if (v === "__new") { sel.value = cpValue(dayMap()[s]); openQuickAdd(s); return; }
      applyCp(s, v);
    });
    row.querySelector(".lun").addEventListener("click", () => { const e = dayMap()[s]; setSlot(s, { is_lunch: !(e && e.is_lunch) }); });
    row.querySelector(".rep").addEventListener("click", () => {
      const p = dayMap()[s - 1];
      if (!p || !filled(p)) { toast("La fascia precedente è vuota"); return; }
      setSlot(s, { description: p.description, client_id: p.client_id, project_id: p.project_id, is_lunch: p.is_lunch });
      paintRow(s, true);
    });
  });
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => document.querySelectorAll(".row .txt").forEach(grow), 150); });
}
function grow(el) { el.style.height = "auto"; el.style.height = (el.scrollHeight + 2) + "px"; }
function applyCp(s, v) {
  if (!v) return setSlot(s, { client_id: null, project_id: null });
  const [k, id] = v.split(":"); const n = Number(id);
  if (k === "c") setSlot(s, { client_id: n, project_id: null });
  else { const p = projectById(n); setSlot(s, { client_id: p.client_id, project_id: n }); }
}
const filled = e => e && ((e.description && e.description.trim()) || e.client_id || e.is_lunch);
const worked = e => e && !e.is_lunch && ((e.description && e.description.trim()) || e.client_id);
const dayMap = (ds = iso(S.cur)) => S.days[ds] || (S.days[ds] = {});
const hoursOf = ds => Object.values(S.days[ds] || {}).filter(worked).length * 0.5;
const lunchOf = ds => Object.values(S.days[ds] || {}).filter(e => e && e.is_lunch).length * 0.5;

async function loadWeek(d) {
  const m = monday(d), key = iso(m);
  if (S.loadedWeeks.has(key)) return;
  const { data, error } = await sb.from("entries").select("*").eq("user_id", S.me.id)
    .gte("day", key).lte("day", iso(addDays(m, 6)));
  if (error) { setSync("Non riesco a caricare i dati: controlla la connessione", true); return; }
  // rimpiazza la settimana con i dati del server, tenendo le fasce modificate e non ancora salvate
  for (let i = 0; i < 7; i++) {
    const k = iso(addDays(m, i)), old = S.days[k] || {}, fresh = {};
    Object.keys(old).forEach(s => { if (pending.has(k + "|" + s)) fresh[s] = old[s]; });
    S.days[k] = fresh;
  }
  data.forEach(e => { if (!pending.has(e.day + "|" + e.slot)) dayMap(e.day)[e.slot] = e; });
  S.loadedWeeks.add(key);
}

async function goDay(d, scroll) {
  S.cur = d;
  renderDayHead();
  await loadWeek(d);
  renderDay();
  if (scroll !== false) scrollToStart();
}
function renderDayHead() {
  const t = S.cur;
  $("dayTitle").innerHTML = esc(GIORNI[t.getDay()] + " " + t.getDate() + " " + MESI[t.getMonth()]) + ' <span class="y">' + t.getFullYear() + '</span>';
  $("pick").value = iso(t);
}
function renderDay() {
  renderDayHead();
  const ds = iso(S.cur), n = new Date(), isToday = ds === iso(n), nowS = n.getHours() * 2 + (n.getMinutes() >= 30 ? 1 : 0);
  SLOTS.forEach(s => {
    const row = $("grid").children[s];
    row.classList.toggle("now", isToday && s === nowS);
    paintRow(s, document.activeElement !== $("t" + s));
  });
  renderWeek(); updateTotals();
}
function paintRow(s, setText) {
  const e = dayMap()[s], row = $("grid").children[s], sel = $("c" + s), txt = $("t" + s);
  if (setText) { txt.value = e ? e.description || "" : ""; grow(txt); }
  sel.innerHTML = cpOptions(e && e.client_id, e && e.project_id);
  sel.value = cpValue(e);
  const L = !!(e && e.is_lunch);
  row.classList.toggle("filled", !!filled(e) && !L);
  row.classList.toggle("lunch", L);
  $("l" + s).setAttribute("aria-pressed", L ? "true" : "false");
  txt.placeholder = L ? "Pausa pranzo" : "Su cosa hai lavorato?";
  sel.classList.toggle("set", !!(e && e.client_id));
  sel.style.setProperty("--chip", e && e.client_id ? chip(e.client_id) : "var(--line)");
}
function renderWeek() {
  const w = $("week"); w.innerHTML = "";
  const m0 = monday(S.cur), td = iso(new Date());
  for (let i = 0; i < 7; i++) {
    const d = addDays(m0, i), ds = iso(d), h = hoursOf(ds);
    const b = document.createElement("button");
    b.className = "wd" + (i > 4 ? " we" : "") + (ds === iso(S.cur) ? " sel" : "") + (ds === td ? " today" : "");
    b.setAttribute("aria-label", GIORNI[d.getDay()] + " " + d.getDate() + ", " + fmtH(h));
    b.innerHTML = '<span class="n">' + G3[d.getDay()] + '</span><span class="d">' + d.getDate() + '</span><span class="h">' + (h ? fmtH(h) : "—") + '</span>';
    b.onclick = () => goDay(d);
    w.appendChild(b);
  }
}
function updateTotals() {
  const ds = iso(S.cur), l = lunchOf(ds);
  $("dayHours").textContent = fmtH(hoursOf(ds));
  $("lunchInfo").textContent = l ? " · pranzo " + fmtH(l) : "";
}
function scrollToStart() {
  requestAnimationFrame(() => {
    const n = new Date(), s = iso(S.cur) === iso(n) ? n.getHours() * 2 + (n.getMinutes() >= 30 ? 1 : 0) : 18;
    const row = $("grid").children[s]; if (!row) return;
    const off = $("dayStick").getBoundingClientRect().height + 8;
    window.scrollTo({ top: Math.max(0, row.getBoundingClientRect().top + scrollY - off), behavior: "auto" });
  });
}
$("prev").onclick = () => goDay(addDays(S.cur, -1));
$("next").onclick = () => goDay(addDays(S.cur, 1));
$("today").onclick = () => goDay(today0());
$("pick").onchange = e => { if (e.target.value) goDay(parse(e.target.value)); };

/* ---------- Salvataggio ---------- */
const pending = new Map();   // "day|slot" -> timeout
let inflight = 0, failed = 0;
function setSync(t, err) { const s = $("sync"); s.textContent = t; s.classList.toggle("err", !!err); }
function setSlot(s, patch) {
  const ds = iso(S.cur), map = dayMap(ds);
  const base = map[s] || { user_id: S.me.id, day: ds, slot: s, description: "", client_id: null, project_id: null, is_lunch: false };
  const e = Object.assign({}, base, patch);
  if (!filled(e)) delete map[s]; else map[s] = e;
  if (patch.description === undefined) paintRow(s, false); else {
    const row = $("grid").children[s]; row.classList.toggle("filled", !!filled(e) && !e.is_lunch);
  }
  renderWeek(); updateTotals();
  const key = ds + "|" + s;
  clearTimeout(pending.get(key));
  setSync("Salvataggio…");
  pending.set(key, setTimeout(() => save(ds, s), 500));
}
async function save(ds, s) {
  const key = ds + "|" + s; pending.delete(key); inflight++;
  const e = (S.days[ds] || {})[s];
  let error;
  if (!e) ({ error } = await sb.from("entries").delete().eq("user_id", S.me.id).eq("day", ds).eq("slot", s));
  else ({ error } = await sb.from("entries").upsert({
    user_id: S.me.id, day: ds, slot: s, description: (e.description || "").slice(0, 500),
    client_id: e.client_id, project_id: e.project_id, is_lunch: !!e.is_lunch
  }, { onConflict: "user_id,day,slot" }));
  inflight--;
  if (error) { failed++; setSync("Salvataggio non riuscito: controlla la connessione. Riprovo…", true); setTimeout(() => { if (!pending.has(key)) { pending.set(key, 0); save(ds, s); } }, 4000); return; }
  if (!inflight && !pending.size) setSync("Salvato");
}
addEventListener("beforeunload", e => { if (pending.size || inflight) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- Aggiunta rapida cliente/progetto ---------- */
let qaSlot = null;
function openQuickAdd(s) {
  qaSlot = s;
  $("qaClient").innerHTML = '<option value="__new">+ Nuovo cliente</option>' +
    S.clients.filter(c => !c.archived).map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join("");
  $("qaClient").value = S.clients.some(c => !c.archived) ? String(S.clients.find(c => !c.archived).id) : "__new";
  $("qaNewClientWrap").hidden = $("qaClient").value !== "__new";
  $("qaNewClient").value = ""; $("qaProject").value = ""; $("qaMsg").hidden = true;
  $("qa").hidden = false;
  ($("qaClient").value === "__new" ? $("qaNewClient") : $("qaProject")).focus();
}
$("qaClient").onchange = () => { $("qaNewClientWrap").hidden = $("qaClient").value !== "__new"; };
$("qaCancel").onclick = () => { $("qa").hidden = true; };
$("qa").addEventListener("click", e => { if (e.target === $("qa")) $("qa").hidden = true; });
$("qaForm").addEventListener("submit", async e => {
  e.preventDefault();
  const showErr = m => { $("qaMsg").textContent = m; $("qaMsg").hidden = false; };
  try {
    let cid = $("qaClient").value;
    if (cid === "__new") {
      const name = $("qaNewClient").value.trim(); if (!name) return showErr("Scrivi il nome del cliente.");
      cid = (await addClient(name)).id;
    } else cid = Number(cid);
    let pid = null; const pn = $("qaProject").value.trim();
    if (pn) pid = (await addProject(cid, pn)).id;
    $("qa").hidden = true;
    if (qaSlot !== null) setSlot(qaSlot, { client_id: cid, project_id: pid });
    renderDay(); toast("Aggiunto");
  } catch (err) { showErr(err.message); }
});
async function addClient(name) {
  const { data, error } = await sb.from("clients").insert({ name, created_by: S.me.id }).select().single();
  if (error) throw new Error(error.code === "23505" ? "Esiste già un cliente con questo nome." : "Non sono riuscito ad aggiungere il cliente.");
  S.clients.push(data); S.clients.sort((a, b) => a.name.localeCompare(b.name, "it")); return data;
}
async function addProject(clientId, name) {
  const { data, error } = await sb.from("projects").insert({ client_id: clientId, name, created_by: S.me.id }).select().single();
  if (error) throw new Error(error.code === "23505" ? "Questo cliente ha già un progetto con questo nome." : "Non sono riuscito ad aggiungere il progetto.");
  S.projects.push(data); S.projects.sort((a, b) => a.name.localeCompare(b.name, "it")); return data;
}

/* ================= Lettura fasce in un intervallo ================= */
async function fetchEntries(from, to, f = {}) {
  const out = []; const size = 1000;
  for (let off = 0; ; off += size) {
    let q = sb.from("entries").select("user_id, day, slot, description, client_id, project_id, is_lunch")
      .gte("day", from).lte("day", to).eq("is_lunch", false);
    if (f.user) q = q.eq("user_id", f.user);
    if (f.client === "none") q = q.is("client_id", null); else if (f.client) q = q.eq("client_id", Number(f.client));
    if (f.project === "none") q = q.is("project_id", null); else if (f.project) q = q.eq("project_id", Number(f.project));
    q = q.order("day").order("user_id").order("slot").range(off, off + size - 1);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out.filter(worked);
}
/* fasce consecutive identiche diventano un unico blocco */
function toBlocks(rows) {
  const out = [];
  rows.forEach(e => {
    const last = out[out.length - 1];
    if (last && last.user_id === e.user_id && last.day === e.day && last.endSlot === e.slot - 1 &&
        last.client_id === e.client_id && last.project_id === e.project_id && (last.description || "") === (e.description || "")) {
      last.endSlot = e.slot; last.hours += 0.5;
    } else out.push({ ...e, startSlot: e.slot, endSlot: e.slot, hours: 0.5 });
  });
  return out;
}

/* ================= Riepilogo personale ================= */
function sumRange() {
  const r = S.sumRef;
  if (S.sumPeriod === "week") { const a = monday(r); return [a, addDays(a, 6)]; }
  return [new Date(r.getFullYear(), r.getMonth(), 1), new Date(r.getFullYear(), r.getMonth() + 1, 0)];
}
async function renderSum() {
  const [a, b] = sumRange();
  $("sumLabel").textContent = S.sumPeriod === "week"
    ? "Settimana " + a.getDate() + (a.getMonth() !== b.getMonth() ? " " + MESI[a.getMonth()] : "") + " – " + b.getDate() + " " + MESI[b.getMonth()] + " " + b.getFullYear()
    : cap(MESI[a.getMonth()]) + " " + a.getFullYear();
  const box = $("sumBars"); box.innerHTML = '<p class="sync">Caricamento…</p>';
  let rows;
  try { rows = await fetchEntries(iso(a), iso(b), { user: S.me.id }); }
  catch { box.innerHTML = '<div class="empty">Non riesco a caricare il riepilogo. Controlla la connessione.</div>'; return; }
  // dati locali non ancora salvati
  const tot = rows.length * 0.5, none = rows.filter(r => !r.client_id).length * 0.5;
  $("sTot").textContent = fmtH(tot); $("sCli").textContent = fmtH(tot - none);
  $("sDays").textContent = new Set(rows.map(r => r.day)).size;
  box.innerHTML = "";
  if (!rows.length) { box.innerHTML = '<div class="empty">Nessuna fascia compilata in questo periodo.</div>'; return; }
  const byC = new Map();
  rows.forEach(r => {
    const k = r.client_id || 0; if (!byC.has(k)) byC.set(k, { h: 0, p: new Map() });
    const c = byC.get(k); c.h += .5; const pk = r.project_id || 0; c.p.set(pk, (c.p.get(pk) || 0) + .5);
  });
  const list = [...byC.entries()].sort((x, y) => (x[0] === 0) - (y[0] === 0) || y[1].h - x[1].h);
  const max = Math.max(...list.map(x => x[1].h));
  list.forEach(([cid, c]) => {
    box.appendChild(barEl(clientName(cid), c.h, tot, max, chip(cid)));
    if (cid && (c.p.size > 1 || !c.p.has(0))) {
      [...c.p.entries()].sort((x, y) => y[1] - x[1]).forEach(([pid, h]) =>
        box.appendChild(barEl(pid ? projectName(pid) : "Generale", h, tot, max, chip(cid), true)));
    }
  });
}
function barEl(name, h, tot, max, color, sub, onClick) {
  const el = document.createElement("div");
  el.className = "bar" + (sub ? " sub" : "") + (onClick ? " click" : "");
  el.style.setProperty("--chip", color);
  el.innerHTML = '<span class="nm"></span><span class="hv"><b>' + fmtH(h) + '</b> · ' + Math.round(h / tot * 100) + '%</span><span class="tr"><i style="width:' + (h / max * 100) + '%"></i></span>';
  el.querySelector(".nm").textContent = name;
  if (onClick) { el.tabIndex = 0; el.onclick = onClick; el.onkeydown = e => { if (e.key === "Enter") onClick(); }; }
  return el;
}
$("sp-week").onclick = () => { S.sumPeriod = "week"; $("sp-week").setAttribute("aria-pressed", "true"); $("sp-month").setAttribute("aria-pressed", "false"); renderSum(); };
$("sp-month").onclick = () => { S.sumPeriod = "month"; $("sp-month").setAttribute("aria-pressed", "true"); $("sp-week").setAttribute("aria-pressed", "false"); renderSum(); };
$("sprev").onclick = () => { const r = S.sumRef; S.sumRef = S.sumPeriod === "week" ? addDays(r, -7) : new Date(r.getFullYear(), r.getMonth() - 1, 1); renderSum(); };
$("snext").onclick = () => { const r = S.sumRef; S.sumRef = S.sumPeriod === "week" ? addDays(r, 7) : new Date(r.getFullYear(), r.getMonth() + 1, 1); renderSum(); };

/* ================= Resoconto (amministratore) ================= */
const R = { rows: [], blocks: [], shown: 50, ready: false };
function presetRange(p) {
  const t = today0();
  switch (p) {
    case "week": return [monday(t), addDays(monday(t), 6)];
    case "lastweek": return [addDays(monday(t), -7), addDays(monday(t), -1)];
    case "month": return [new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0)];
    case "lastmonth": return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)];
    case "year": return [new Date(t.getFullYear(), 0, 1), new Date(t.getFullYear(), 11, 31)];
  }
  return null;
}
function fillFilterSelects() {
  const u = $("fUser").value, c = $("fClient").value;
  $("fUser").innerHTML = '<option value="">Tutte le persone</option>' +
    S.profiles.map(p => '<option value="' + p.id + '">' + esc(p.full_name) + (p.active ? "" : " (disattivato)") + '</option>').join("");
  $("fClient").innerHTML = '<option value="">Tutti i clienti</option><option value="none">Senza cliente</option>' +
    S.clients.map(x => '<option value="' + x.id + '">' + esc(x.name) + (x.archived ? " (archiviato)" : "") + '</option>').join("");
  $("fUser").value = u; $("fClient").value = c;
  fillProjectFilter();
}
function fillProjectFilter() {
  const c = $("fClient").value, cur = $("fProject").value;
  const list = c && c !== "none" ? S.projects.filter(p => p.client_id === Number(c)) : S.projects;
  $("fProject").innerHTML = '<option value="">Tutti i progetti</option>' + (c && c !== "none" ? '<option value="none">Solo generale (senza progetto)</option>' : "") +
    list.map(p => '<option value="' + p.id + '">' + esc((c ? "" : clientName(p.client_id) + " › ") + p.name) + '</option>').join("");
  $("fProject").disabled = c === "none";
  $("fProject").value = [...$("fProject").options].some(o => o.value === cur) ? cur : "";
}
function initReport() {
  if (R.ready) return; R.ready = true;
  const [a, b] = presetRange("month"); $("fFrom").value = iso(a); $("fTo").value = iso(b);
  fillFilterSelects();
  $("fPreset").onchange = () => { const r = presetRange($("fPreset").value); if (r) { $("fFrom").value = iso(r[0]); $("fTo").value = iso(r[1]); } loadReport(); };
  ["fFrom", "fTo"].forEach(id => $(id).onchange = () => { $("fPreset").value = "custom"; loadReport(); });
  $("fUser").onchange = loadReport;
  $("fClient").onchange = () => { fillProjectFilter(); loadReport(); };
  $("fProject").onchange = loadReport;
  $("fGroup").onchange = renderReport; $("fCross").onchange = renderReport;
  let tt; $("fText").oninput = () => { clearTimeout(tt); tt = setTimeout(renderReport, 250); };
  $("fReset").onclick = () => {
    $("fPreset").value = "month"; const r = presetRange("month"); $("fFrom").value = iso(r[0]); $("fTo").value = iso(r[1]);
    $("fUser").value = ""; $("fClient").value = ""; fillProjectFilter(); $("fProject").value = ""; $("fText").value = "";
    $("fGroup").value = "client"; $("fCross").value = "user"; loadReport();
  };
  $("moreRows").onclick = () => { R.shown += 100; renderDetail(); };
  $("exportXlsx").onclick = exportExcel;
}
let repSeq = 0;
async function loadReport() {
  const from = $("fFrom").value, to = $("fTo").value;
  if (!from || !to || from > to) { $("repStatus").textContent = "Controlla le date: la data iniziale deve venire prima di quella finale."; return; }
  const seq = ++repSeq; $("repStatus").textContent = "Caricamento…";
  try {
    const rows = await fetchEntries(from, to, { user: $("fUser").value, client: $("fClient").value, project: $("fProject").value });
    if (seq !== repSeq) return;
    R.rows = rows; $("repStatus").textContent = "";
    renderReport();
  } catch { if (seq === repSeq) $("repStatus").textContent = "Non riesco a caricare i dati. Controlla la connessione e riprova."; }
}
function filteredRows() {
  const q = $("fText").value.trim().toLowerCase();
  return q ? R.rows.filter(r => (r.description || "").toLowerCase().includes(q)) : R.rows;
}
const DIM = {
  client: { label: "cliente", key: r => String(r.client_id || 0), name: k => clientName(Number(k) || null), color: k => chip(Number(k) || null) },
  project: { label: "progetto", key: r => r.project_id ? "p" + r.project_id : "c" + (r.client_id || 0),
    name: k => k[0] === "p" ? clientName(projectById(Number(k.slice(1)))?.client_id) + " › " + projectName(Number(k.slice(1))) : (k === "c0" ? "Senza cliente" : clientName(Number(k.slice(1))) + " › generale"),
    color: k => k[0] === "p" ? chip(projectById(Number(k.slice(1)))?.client_id) : chip(Number(k.slice(1)) || null) },
  user: { label: "persona", key: r => r.user_id, name: k => profileById(k)?.full_name || "Utente rimosso", color: k => "var(--c" + (Math.max(0, S.profiles.findIndex(p => p.id === k)) % 8) + ")" },
  day: { label: "giorno", key: r => r.day, name: k => G3[parse(k).getDay()] + " " + fmtDate(k), color: () => "var(--accent)", sort: true },
  week: { label: "settimana", key: r => { const [y, w] = isoWeek(parse(r.day)); return y + "-W" + pad(w); }, name: k => { const [y, w] = k.split("-W"); return "Settimana " + Number(w) + " · " + y; }, color: () => "var(--accent)", sort: true },
  month: { label: "mese", key: r => r.day.slice(0, 7), name: k => cap(MESI[Number(k.slice(5)) - 1]) + " " + k.slice(0, 4), color: () => "var(--accent)", sort: true },
};
function groupBy(rows, dim) {
  const m = new Map(); rows.forEach(r => { const k = DIM[dim].key(r); m.set(k, (m.get(k) || 0) + 0.5); });
  const list = [...m.entries()];
  if (DIM[dim].sort) list.sort((a, b) => a[0] < b[0] ? -1 : 1); else list.sort((a, b) => b[1] - a[1]);
  return list;
}
function renderReport() {
  const rows = filteredRows(), tot = rows.length * 0.5;
  $("rTot").textContent = fmtH(tot);
  $("rPeople").textContent = new Set(rows.map(r => r.user_id)).size;
  $("rClients").textContent = new Set(rows.filter(r => r.client_id).map(r => r.client_id)).size;
  $("rNone").textContent = fmtH(rows.filter(r => !r.client_id).length * 0.5);

  const g = $("fGroup").value, x = $("fCross").value;
  $("groupLabel").textContent = "Ore per " + DIM[g].label + (["client", "user", "project"].includes(g) ? " · tocca una riga per filtrare" : "");
  const box = $("repBars"); box.innerHTML = "";
  if (!rows.length) box.innerHTML = '<div class="empty">Nessuna lavorazione con questi filtri.</div>';
  const list = groupBy(rows, g), max = Math.max(1, ...list.map(l => l[1]));
  list.forEach(([k, h]) => box.appendChild(barEl(DIM[g].name(k), h, tot, max, DIM[g].color(k), false, drillFor(g, k))));

  // matrice
  const mw = $("matrixWrap");
  if (!x || x === g || !rows.length) { mw.hidden = true; }
  else {
    mw.hidden = false;
    $("matrixLabel").textContent = cap(DIM[g].label) + " × " + DIM[x].label + " (ore)";
    const cols = groupBy(rows, x).map(c => c[0]);
    const cell = new Map(); rows.forEach(r => { const k = DIM[g].key(r) + "|" + DIM[x].key(r); cell.set(k, (cell.get(k) || 0) + .5); });
    let h = "<thead><tr><th>" + esc(cap(DIM[g].label)) + "</th>" + cols.map(c => '<th class="num">' + esc(DIM[x].name(c)) + "</th>").join("") + '<th class="num">Totale</th></tr></thead><tbody>';
    list.forEach(([k, t]) => {
      h += "<tr><td>" + esc(DIM[g].name(k)) + "</td>" + cols.map(c => { const v = cell.get(k + "|" + c) || 0; return '<td class="num' + (v ? "" : " zero") + '">' + (v ? fmtH(v).replace(" h", "") : "·") + "</td>"; }).join("") + '<td class="num tot">' + fmtH(t).replace(" h", "") + "</td></tr>";
    });
    const colTot = cols.map(c => rows.filter(r => DIM[x].key(r) === c).length * .5);
    h += '<tr class="tot"><td>Totale</td>' + colTot.map(v => '<td class="num">' + fmtH(v).replace(" h", "") + "</td>").join("") + '<td class="num">' + fmtH(tot).replace(" h", "") + "</td></tr></tbody>";
    $("matrix").innerHTML = h;
  }
  // nel dettaglio a schermo le lavorazioni più recenti in alto
  R.blocks = toBlocks(rows).sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : 0); R.shown = 50; renderDetail();
}
function drillFor(dim, k) {
  if (dim === "client") return () => { $("fClient").value = k === "0" ? "none" : k; fillProjectFilter(); $("fGroup").value = "project"; loadReport(); };
  if (dim === "user") return () => { $("fUser").value = k; $("fGroup").value = "client"; if ($("fCross").value === "user") $("fCross").value = "project"; loadReport(); };
  if (dim === "project" && k[0] === "p") return () => { const p = projectById(Number(k.slice(1))); $("fClient").value = String(p.client_id); fillProjectFilter(); $("fProject").value = String(p.id); $("fGroup").value = "user"; $("fCross").value = ""; loadReport(); };
  return null;
}
function renderDetail() {
  const b = R.blocks;
  if (!b.length) { $("detail").innerHTML = '<tbody><tr><td class="note">Nessuna riga.</td></tr></tbody>'; $("moreRows").hidden = true; return; }
  let h = '<thead><tr><th>Data</th><th>Persona</th><th>Orario</th><th class="num">Ore</th><th>Cliente</th><th>Progetto</th><th>Descrizione</th></tr></thead><tbody>';
  b.slice(0, R.shown).forEach(r => {
    h += '<tr><td class="mono">' + fmtDate(r.day) + '</td><td class="nw">' + esc(profileById(r.user_id)?.full_name || "—") + '</td><td class="mono">' + slotTime(r.startSlot) + "–" + slotEnd(r.endSlot) +
      '</td><td class="num">' + fmtH(r.hours).replace(" h", "") + '</td><td><span class="chip" style="--chip:' + chip(r.client_id) + '">' + esc(clientName(r.client_id)) + '</span></td><td>' + esc(projectName(r.project_id)) +
      '</td><td class="desc">' + esc(r.description || "") + "</td></tr>";
  });
  $("detail").innerHTML = h + "</tbody>";
  $("moreRows").hidden = b.length <= R.shown;
  $("moreRows").textContent = "Mostra altre righe (" + (b.length - R.shown) + " rimanenti)";
}

/* ---------- Export Excel ---------- */
let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return xlsxLoading || (xlsxLoading = new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js";
    s.onload = ok; s.onerror = () => { xlsxLoading = null; ko(new Error("Non riesco a caricare il modulo Excel. Controlla la connessione.")); };
    document.head.appendChild(s);
  }));
}
async function exportExcel() {
  const btn = $("exportXlsx"); btn.disabled = true; const old = btn.textContent; btn.textContent = "Preparo il file…";
  try {
    await loadXlsx();
    const X = window.XLSX, rows = filteredRows(), blocks = toBlocks(rows), tot = rows.length * .5;
    const from = $("fFrom").value, to = $("fTo").value;
    const head = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "CC2633" } }, alignment: { vertical: "center" } };
    const totStyle = { font: { bold: true }, fill: { fgColor: { rgb: "EEEEF0" } } };
    function sheet(aoa, widths, opts = {}) {
      const ws = X.utils.aoa_to_sheet(aoa, { cellDates: true });
      ws["!cols"] = widths.map(w => ({ wch: w }));
      const rng = X.utils.decode_range(ws["!ref"]);
      for (let c = rng.s.c; c <= rng.e.c; c++) {
        const a = X.utils.encode_cell({ r: opts.headRow || 0, c }); if (ws[a]) ws[a].s = head;
        if (opts.totalRow) { const t = X.utils.encode_cell({ r: rng.e.r, c }); if (ws[t]) ws[t].s = totStyle; }
      }
      for (let r = (opts.headRow || 0) + 1; r <= rng.e.r; r++) for (let c = rng.s.c; c <= rng.e.c; c++) {
        const a = X.utils.encode_cell({ r, c }); if (!ws[a]) continue;
        if (ws[a].t === "d") ws[a].z = "dd/mm/yyyy"; else if (typeof ws[a].v === "number") ws[a].z = "0.0";
      }
      ws["!freeze"] = { xSplit: 0, ySplit: (opts.headRow || 0) + 1 };
      return ws;
    }
    const wb = X.utils.book_new();
    const filt = [
      ["Resoconto ore InPhoto Studio"], [],
      ["Periodo", fmtDate(from) + " – " + fmtDate(to)],
      ["Persona", $("fUser").value ? profileById($("fUser").value)?.full_name : "Tutte"],
      ["Cliente", $("fClient").selectedOptions[0]?.text || "Tutti"],
      ["Progetto", $("fProject").selectedOptions[0]?.text || "Tutti"],
      ["Testo cercato", $("fText").value || "—"],
      ["Ore totali", tot],
      ["Esportato il", new Date().toLocaleString("it-IT")],
    ];
    const wsF = X.utils.aoa_to_sheet(filt); wsF["!cols"] = [{ wch: 18 }, { wch: 44 }];
    wsF.A1.s = { font: { bold: true, sz: 14, color: { rgb: "CC2633" } } };
    ["A3", "A4", "A5", "A6", "A7", "A8", "A9"].forEach(a => wsF[a].s = { font: { bold: true } });
    X.utils.book_append_sheet(wb, wsF, "Filtri");

    const det = [["Data", "Giorno", "Persona", "Inizio", "Fine", "Ore", "Cliente", "Progetto", "Descrizione"]];
    blocks.forEach(b => det.push([parse(b.day), GIORNI[parse(b.day).getDay()], profileById(b.user_id)?.full_name || "", slotTime(b.startSlot), slotEnd(b.endSlot), b.hours, clientName(b.client_id), projectName(b.project_id), b.description || ""]));
    det.push(["Totale", "", "", "", "", tot, "", "", ""]);
    X.utils.book_append_sheet(wb, sheet(det, [11, 11, 22, 7, 7, 6, 24, 28, 60], { totalRow: true }), "Dettaglio");

    const simple = (dim, title) => {
      const a = [[cap(DIM[dim].label), "Ore", "%"]];
      groupBy(rows, dim).forEach(([k, h]) => a.push([DIM[dim].name(k), h, tot ? Math.round(h / tot * 1000) / 10 : 0]));
      a.push(["Totale", tot, 100]);
      X.utils.book_append_sheet(wb, sheet(a, [40, 9, 7], { totalRow: true }), title);
    };
    simple("client", "Per cliente"); simple("project", "Per progetto"); simple("user", "Per persona");
    { const a = [["Data", "Giorno", "Ore"]]; groupBy(rows, "day").forEach(([k, h]) => a.push([parse(k), GIORNI[parse(k).getDay()], h])); a.push(["Totale", "", tot]);
      X.utils.book_append_sheet(wb, sheet(a, [12, 12, 9], { totalRow: true }), "Per giorno"); }

    const matrix = (g, x, title) => {
      const rl = groupBy(rows, g), cl = groupBy(rows, x).map(c => c[0]);
      const cell = new Map(); rows.forEach(r => { const k = DIM[g].key(r) + "|" + DIM[x].key(r); cell.set(k, (cell.get(k) || 0) + .5); });
      const a = [[cap(DIM[g].label) + " \\ " + DIM[x].label, ...cl.map(c => DIM[x].name(c)), "Totale"]];
      rl.forEach(([k, t]) => a.push([DIM[g].name(k), ...cl.map(c => cell.get(k + "|" + c) || 0), t]));
      a.push(["Totale", ...cl.map(c => rows.filter(r => DIM[x].key(r) === c).length * .5), tot]);
      X.utils.book_append_sheet(wb, sheet(a, [36, ...cl.map(() => 14), 10], { totalRow: true }), title);
    };
    if (rows.length) { matrix("client", "user", "Cliente x persona"); matrix("project", "user", "Progetto x persona"); }

    X.writeFile(wb, "resoconto-ore_" + from + "_" + to + ".xlsx");
    toast("File Excel scaricato");
  } catch (e) { toast(e.message || "Esportazione non riuscita"); }
  btn.disabled = false; btn.textContent = old;
}

/* ================= Impostazioni ================= */
function showSub(name) {
  document.querySelectorAll(".subtabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.sub === name));
  ["cp", "team", "acc"].forEach(n => $("sub-" + n).hidden = n !== name);
  if (name === "cp") renderClients();
  if (name === "team") renderTeam();
  if (name === "acc") renderAccount();
}
document.querySelectorAll(".subtabs button").forEach(b => b.onclick = () => showSub(b.dataset.sub));

/* ---------- Clienti e progetti ---------- */
function renderClients() {
  $("cpNote").textContent = isAdmin()
    ? "Tutti possono aggiungere clienti e progetti. Tu puoi rinominarli, archiviarli (spariscono dai menu ma restano nei resoconti) o eliminarli se non sono mai stati usati."
    : "Puoi aggiungere clienti e progetti. Per rinominarli o archiviarli chiedi all'amministratore.";
  const showArch = $("showArchived").checked, box = $("clist"); box.innerHTML = "";
  const list = S.clients.filter(c => showArch || !c.archived);
  if (!list.length) { box.innerHTML = '<div class="empty">Ancora nessun cliente. Scrivi un nome qui sopra e premi “Aggiungi cliente”.</div>'; return; }
  list.forEach(c => {
    const el = document.createElement("div"); el.className = "client" + (c.archived ? " arch" : ""); el.style.setProperty("--chip", chip(c.id));
    const head = document.createElement("div"); head.className = "chead";
    const nm = document.createElement("span"); nm.className = "cname"; nm.textContent = c.name;
    if (c.archived) nm.insertAdjacentHTML("beforeend", ' <span class="tag">archiviato</span>');
    head.appendChild(nm);
    if (isAdmin()) head.appendChild(adminActs("clients", c));
    el.appendChild(head);
    const pl = document.createElement("div"); pl.className = "plist";
    S.projects.filter(p => p.client_id === c.id && (showArch || !p.archived)).forEach(p => {
      const r = document.createElement("div"); r.className = "prow" + (p.archived ? " arch" : "");
      const pn = document.createElement("span"); pn.className = "pn"; pn.textContent = p.name;
      if (p.archived) pn.insertAdjacentHTML("beforeend", ' <span class="tag">archiviato</span>');
      r.appendChild(pn); if (isAdmin()) r.appendChild(adminActs("projects", p));
      pl.appendChild(r);
    });
    el.appendChild(pl);
    if (!c.archived) {
      const f = document.createElement("form"); f.className = "addproj";
      f.innerHTML = '<input maxlength="80" placeholder="Nuovo progetto per ' + esc(c.name) + '" aria-label="Nuovo progetto per ' + esc(c.name) + '"><button class="btn" type="submit">Aggiungi</button>';
      f.onsubmit = async e => { e.preventDefault(); const v = f.querySelector("input").value.trim(); if (!v) return;
        try { await addProject(c.id, v); toast("Progetto aggiunto"); renderClients(); } catch (err) { toast(err.message); } };
      el.appendChild(f);
    }
    box.appendChild(el);
  });
}
function adminActs(table, item) {
  const a = document.createElement("span"); a.className = "acts";
  const ren = document.createElement("button"); ren.type = "button"; ren.textContent = "Rinomina";
  ren.onclick = () => {
    const holder = a.parentElement.querySelector(table === "clients" ? ".cname" : ".pn");
    const inp = document.createElement("input"); inp.value = item.name; inp.maxLength = 80;
    inp.style.cssText = "border:1px solid var(--accent);border-radius:8px;height:36px;padding:0 10px;background:var(--bg);min-width:0;flex:1";
    holder.replaceWith(inp); inp.focus(); inp.select();
    const done = async ok => {
      const v = inp.value.trim();
      if (ok && v && v !== item.name) {
        const { error } = await sb.from(table).update({ name: v }).eq("id", item.id);
        if (error) toast(error.code === "23505" ? "Nome già usato" : "Non sono riuscito a rinominare"); else item.name = v;
      }
      renderClients();
    };
    inp.onkeydown = e => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); };
    inp.onblur = () => done(true);
  };
  const arc = document.createElement("button"); arc.type = "button"; arc.textContent = item.archived ? "Ripristina" : "Archivia";
  arc.onclick = async () => {
    const { error } = await sb.from(table).update({ archived: !item.archived }).eq("id", item.id);
    if (error) return toast("Operazione non riuscita");
    item.archived = !item.archived; renderClients(); toast(item.archived ? "Archiviato" : "Ripristinato");
  };
  const del = document.createElement("button"); del.type = "button"; del.className = "del"; del.textContent = "Elimina";
  del.onclick = async () => {
    if (!del.classList.contains("confirm")) { del.classList.add("confirm"); del.textContent = "Conferma"; setTimeout(() => { del.classList.remove("confirm"); del.textContent = "Elimina"; }, 3000); return; }
    const { error } = await sb.from(table).delete().eq("id", item.id);
    if (error) return toast(error.code === "23503" ? "È già usato in alcune fasce o ha progetti: archivialo invece di eliminarlo." : "Eliminazione non riuscita");
    if (table === "clients") S.clients = S.clients.filter(x => x.id !== item.id); else S.projects = S.projects.filter(x => x.id !== item.id);
    renderClients(); toast("Eliminato");
  };
  a.append(ren, arc, del); return a;
}
$("showArchived").onchange = renderClients;
$("addClientForm").addEventListener("submit", async e => {
  e.preventDefault(); const v = $("newClient").value.trim(); if (!v) return;
  try { await addClient(v); $("newClient").value = ""; renderClients(); toast("Cliente aggiunto"); } catch (err) { toast(err.message); }
});

/* ---------- Team ---------- */
async function renderTeam() {
  const { data } = await sb.from("profiles").select("*").order("full_name");
  if (data) S.profiles = data;
  const box = $("ulist"); box.innerHTML = "";
  S.profiles.forEach(p => {
    const r = document.createElement("div"); r.className = "urow" + (p.active ? "" : " off");
    const info = document.createElement("div");
    info.innerHTML = '<div class="uname"></div><div class="umail"></div>';
    info.querySelector(".uname").textContent = p.full_name + (p.id === S.me.id ? " (tu)" : "");
    info.querySelector(".umail").textContent = p.email + " · " + (p.role === "admin" ? "Amministratore" : "Operatore") + (p.active ? "" : " · disattivato");
    const a = document.createElement("span"); a.className = "acts";
    const pw = document.createElement("button"); pw.textContent = "Nuova password";
    pw.onclick = async () => {
      const np = genPassword();
      try { await callAdmin("set_password", { id: p.id, password: np }); showCred(p.full_name, p.email, np); }
      catch (e) { toast(e.message); }
    };
    const role = document.createElement("button"); role.textContent = p.role === "admin" ? "Rendi operatore" : "Rendi amministratore";
    role.onclick = async () => { try { await callAdmin("update", { id: p.id, role: p.role === "admin" ? "operatore" : "admin" }); toast("Ruolo aggiornato"); renderTeam(); } catch (e) { toast(e.message); } };
    const act = document.createElement("button"); act.textContent = p.active ? "Disattiva" : "Riattiva"; if (p.active) act.className = "del";
    act.onclick = async () => {
      if (p.active && !act.classList.contains("confirm")) { act.classList.add("confirm"); act.textContent = "Conferma"; setTimeout(() => { act.classList.remove("confirm"); act.textContent = "Disattiva"; }, 3000); return; }
      try { await callAdmin("update", { id: p.id, active: !p.active }); toast(p.active ? "Account disattivato" : "Account riattivato"); renderTeam(); } catch (e) { toast(e.message); }
    };
    if (p.id === S.me.id) a.append(pw); else a.append(pw, role, act);
    r.append(info, a); box.appendChild(r);
  });
}
function showCred(name, email, pass) {
  $("credTxt").textContent = name + "\nIndirizzo: " + location.origin + location.pathname + "\nEmail: " + email + "\nPassword: " + pass;
  $("credBox").hidden = false; $("credBox").scrollIntoView({ block: "nearest" });
}
$("credCopy").onclick = () => copyText($("credTxt").textContent, $("credTxt"));
$("uGen").onclick = () => { $("uPass").value = genPassword(); };
$("addUserForm").addEventListener("submit", async e => {
  e.preventDefault(); $("uCreate").disabled = true;
  try {
    const payload = { full_name: $("uName").value, email: $("uEmail").value, password: $("uPass").value, role: $("uRole").value };
    await callAdmin("create", payload);
    showCred(payload.full_name.trim(), payload.email.trim().toLowerCase(), payload.password);
    $("addUserForm").reset(); toast("Account creato"); renderTeam(); R.ready && fillFilterSelects();
  } catch (err) { toast(err.message); }
  $("uCreate").disabled = false;
});

/* ---------- Account ---------- */
function renderAccount() {
  $("accName").textContent = S.me.full_name;
  $("accInfo").textContent = S.me.email + " · " + (isAdmin() ? "Amministratore" : "Operatore");
}
$("pwForm").addEventListener("submit", async e => {
  e.preventDefault();
  if ($("pw1").value !== $("pw2").value) return toast("Le due password non coincidono");
  const { error } = await sb.auth.updateUser({ password: $("pw1").value });
  if (error) return toast(/same/i.test(error.message) ? "Scegli una password diversa da quella attuale" : "Non sono riuscito a cambiare la password");
  $("pwForm").reset(); toast("Password aggiornata");
});

/* ================= Navigazione ================= */
function show(v) {
  S.view = v;
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.view === v));
  ["day", "sum", "rep", "set"].forEach(n => $("view-" + n).hidden = n !== v);
  window.scrollTo(0, 0);
  if (v === "day") { renderDay(); scrollToStart(); }
  if (v === "sum") { S.sumRef = new Date(S.cur); renderSum(); }
  if (v === "rep" && isAdmin()) { initReport(); fillFilterSelects(); loadReport(); }
  if (v === "set") showSub(document.querySelector('.subtabs button[aria-pressed="true"]')?.dataset.sub || "cp");
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.view));

/* Aggiorna clienti/progetti aggiunti dai colleghi quando si torna sull'app */
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !S.me) return;
  await loadLookups();
  if (S.view === "day") { S.loadedWeeks.clear(); await loadWeek(S.cur); renderDay(); }
});

if ("serviceWorker" in navigator && location.protocol === "https:") addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

start();
})();
