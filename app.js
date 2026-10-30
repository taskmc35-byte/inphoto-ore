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
  const [c, p, u, t, l, ec, kc, sp, sl, se] = await Promise.all([
    sb.from("clients").select("*").order("name"),
    sb.from("projects").select("*").order("name"),
    sb.from("profiles").select("*").order("full_name"),
    sb.from("project_types").select("*").order("sort").order("name"),
    sb.from("project_type_links").select("project_id, type_id"),
    sb.from("entries").select("type_id").limit(1),
    sb.from("clients").select("kind").limit(1),
    sb.from("subprojects").select("*").order("name"),
    sb.from("subproject_type_links").select("subproject_id, type_id"),
    sb.from("entries").select("subproject_id").limit(1),
  ]);
  if (c.error || p.error || u.error) toast("Non riesco a caricare clienti e progetti");
  S.clients = c.data || []; S.projects = p.data || []; S.profiles = u.data || [];
  // tipologie: se il database non è ancora aggiornato la funzione resta semplicemente nascosta
  S.typesOn = !t.error && !l.error;
  S.typeCol = S.typesOn && !ec.error;   // colonna "tipologia della fascia" presente nel database
  S.kindOn = !kc.error;                 // tipo cliente (commerciale / privato) presente nel database
  document.querySelectorAll("[data-kind]").forEach(el => el.hidden = !S.kindOn);
  S.types = S.typesOn ? t.data : [];
  S.ptypes = new Map();
  (S.typesOn ? l.data : []).forEach(x => { if (!S.ptypes.has(x.project_id)) S.ptypes.set(x.project_id, new Set()); S.ptypes.get(x.project_id).add(x.type_id); });
  document.querySelectorAll("[data-types]").forEach(el => el.hidden = !S.typesOn);
  // sottoprogetti: compaiono solo dove qualcuno li ha aggiunti
  S.subOn = !sp.error && !se.error;
  S.subs = S.subOn ? sp.data : [];
  S.stypes = new Map();
  (S.subOn && S.typesOn && !sl.error ? sl.data : []).forEach(x => { if (!S.stypes.has(x.subproject_id)) S.stypes.set(x.subproject_id, new Set()); S.stypes.get(x.subproject_id).add(x.type_id); });
  document.querySelectorAll("[data-sub]").forEach(el => el.hidden = !(S.subOn && S.subs.length));
}
/* tipologie di un progetto, nell'ordine dell'elenco */
const projTypes = pid => { const set = S.ptypes?.get(pid); return set ? S.types.filter(t => set.has(t.id)).map(t => t.id) : []; };
const subTypes = sid => { const set = S.stypes?.get(sid); return set ? S.types.filter(t => set.has(t.id)).map(t => t.id) : []; };
/* tipologie valide per una fascia: quelle del sottoprogetto, se ne ha; altrimenti quelle del progetto */
const slotTypes = (pid, sid) => { if (!pid) return []; const st = sid ? subTypes(sid) : []; return st.length ? st : projTypes(pid); };
const typeName = id => S.types.find(t => t.id === id)?.name || "Tipologia eliminata";
const typeLabel = pid => projTypes(pid).map(typeName).join(", ");
/* tipologia di una fascia: quella scelta, oppure l'unica del progetto.
   "0" = progetto senza tipologie (o nessun progetto), "nd" = progetto con più tipologie ma nessuna scelta */
function slotType(e) {
  if (e.type_id) return String(e.type_id);
  const t = slotTypes(e.project_id, e.subproject_id);
  return t.length === 1 ? String(t[0]) : t.length > 1 ? "nd" : "0";
}
const slotTypeName = e => { const k = slotType(e); return k === "0" ? "" : k === "nd" ? "non indicata" : typeName(Number(k)); };
/* tipologia da salvare quando si sceglie un progetto: l'unica, oppure quella già scelta se è ancora valida */
function typeFor(project_id, prev, sub_id) {
  const t = slotTypes(project_id, sub_id);
  if (t.length === 1) return t[0];
  return prev && t.includes(prev) ? prev : null;
}
/* sub = true: tipologie di un sottoprogetto */
async function toggleProjType(pid, tid, sub) {
  const M = sub ? S.stypes : S.ptypes, tbl = sub ? "subproject_type_links" : "project_type_links", col = sub ? "subproject_id" : "project_id";
  const on = M.get(pid)?.has(tid);
  const q = on ? sb.from(tbl).delete().eq(col, pid).eq("type_id", tid)
               : sb.from(tbl).insert({ [col]: pid, type_id: tid });
  const { error } = await q;
  if (error) { toast("Non sono riuscito a salvare la tipologia"); return false; }
  if (!M.has(pid)) M.set(pid, new Set());
  on ? M.get(pid).delete(tid) : M.get(pid).add(tid);
  return true;
}
/* fila di pulsanti-tipologia da accendere e spegnere */
function typeChips(pid, onChange, sub) {
  const box = document.createElement("span"), M = sub ? S.stypes : S.ptypes; box.className = "tchips";
  S.types.forEach(t => {
    const b = document.createElement("button"); b.type = "button"; b.className = "tchip"; b.textContent = t.name;
    const paint = () => b.setAttribute("aria-pressed", M.get(pid)?.has(t.id) ? "true" : "false");
    paint();
    b.onclick = async () => { b.disabled = true; if (await toggleProjType(pid, t.id, sub)) { paint(); onChange && onChange(); } b.disabled = false; };
    box.appendChild(b);
  });
  return box;
}
const clientById = id => S.clients.find(c => c.id === id);
const projectById = id => S.projects.find(p => p.id === id);
const profileById = id => S.profiles.find(p => p.id === id);
const subById = id => S.subs.find(x => x.id === id);
const subName = id => id ? (subById(id)?.name || "—") : "";
/* "Progetto › Sottoprogetto" (o solo il progetto) */
const projFull = (pid, sid) => pid ? projectName(pid) + (sid ? " › " + subName(sid) : "") : "";
const chip = clientId => {
  if (!clientId) return "var(--muted)";
  const i = S.clients.findIndex(c => c.id === clientId);
  return "var(--c" + ((i < 0 ? 0 : i) % 8) + ")";
};
const clientName = id => id ? (clientById(id)?.name || "Cliente eliminato") : "Senza cliente";
const projectName = id => id ? (projectById(id)?.name || "—") : "";
const KINDS = { commerciale: "Commerciale", privato: "Privato" };
const kindKey = cid => { if (!cid) return "0"; const k = clientById(cid)?.kind; return k || "nd"; };
const kindName = k => k === "0" ? "Senza cliente" : k === "nd" ? "Tipo non indicato" : KINDS[k] || k;
/* scelta Commerciale / Privato a pulsanti; value = "" finché non si sceglie */
function kindPicker(cur, onPick) {
  const box = document.createElement("span"); box.className = "kchips"; box.dataset.v = cur || "";
  Object.entries(KINDS).forEach(([k, label]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "tchip"; b.textContent = label;
    b.setAttribute("aria-pressed", cur === k ? "true" : "false");
    b.onclick = async () => {
      if (onPick && !(await onPick(k))) return;
      box.dataset.v = k; box.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      box.classList.remove("need");
    };
    box.appendChild(b);
  });
  return box;
}

/* ---------- Scelta cliente/progetto con ricerca ----------
   Valori: "" (nessuno), "c:ID" (cliente, tutto il cliente), "p:ID" (progetto). */
const norm = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function cpLabel(v) {
  if (!v) return "";
  const [k, id] = v.split(":"), n = Number(id);
  if (k === "c") return clientName(n);
  if (k === "s") { const x = subById(n), p = x && projectById(x.project_id); return p ? clientName(p.client_id) + " › " + p.name + " › " + x.name : ""; }
  const p = projectById(n); return p ? clientName(p.client_id) + " › " + p.name : "";
}
/* valore del picker -> { client_id, project_id, subproject_id } */
function cpIds(v) {
  if (!v) return { client_id: null, project_id: null, subproject_id: null };
  const [k, id] = v.split(":"), n = Number(id);
  if (k === "c") return { client_id: n, project_id: null, subproject_id: null };
  if (k === "s") { const x = subById(n), p = x && projectById(x.project_id); return { client_id: p?.client_id ?? null, project_id: x?.project_id ?? null, subproject_id: n }; }
  return { client_id: projectById(n)?.client_id ?? null, project_id: n, subproject_id: null };
}
function cpClient(v) { return cpIds(v).client_id; }
function cpMatches(q, current) {
  const nq = norm(q), out = [];
  const clients = [...S.clients].sort((a, b) => (nq && norm(b.name).startsWith(nq)) - (nq && norm(a.name).startsWith(nq)));
  clients.forEach(c => {
    if (c.archived && cpClient(current) !== c.id) return;
    const projs = S.projects.filter(p => p.client_id === c.id && (!p.archived || "p:" + p.id === current));
    const cm = !nq || norm(c.name).includes(nq);
    const pm = projs.filter(p => cm || norm(p.name).includes(nq) || norm(c.name + " " + p.name).includes(nq) || (S.typesOn && norm(typeLabel(p.id)).includes(nq)));
    if (cm) out.push({ v: "c:" + c.id, main: c.name, sub: [projs.length ? "tutto il cliente" : "", S.kindOn && c.kind ? KINDS[c.kind] : ""].filter(Boolean).join(" · "), cid: c.id });
    projs.forEach(p => {
      const subs = S.subs.filter(x => x.project_id === p.id && (!x.archived || "s:" + x.id === current));
      const pIn = pm.includes(p);
      const sm = subs.filter(x => pIn || norm(x.name).includes(nq) || norm(p.name + " " + x.name).includes(nq) || norm(c.name + " " + p.name + " " + x.name).includes(nq));
      if (pIn || sm.length) out.push({ ctx: !pIn, v: "p:" + p.id, main: p.name, sub: c.name + (subs.length ? " · tutto il progetto" : "") + (S.typesOn && projTypes(p.id).length ? " · " + typeLabel(p.id) : ""), cid: c.id, proj: true });
      sm.forEach(x => out.push({ v: "s:" + x.id, main: x.name, sub: c.name + " › " + p.name + (S.typesOn && subTypes(x.id).length ? " · " + subTypes(x.id).map(typeName).join(", ") : ""), cid: c.id, proj: true, subp: true }));
    });
  });
  return out;
}
/* ultimi clienti/progetti usati nella settimana caricata, dal più recente */
function cpRecent() {
  const seen = new Set(), out = [];
  Object.keys(S.days).sort().reverse().forEach(d => {
    Object.keys(S.days[d]).map(Number).sort((a, b) => b - a).forEach(sl => {
      const v = cpValue(S.days[d][sl]);
      if (v && !seen.has(v) && cpLabel(v) && !(clientById(cpClient(v))?.archived)) { seen.add(v); out.push(v); }
    });
  });
  return out.slice(0, 5);
}
const CP = { input: null, onPick: null, opts: [], idx: -1 };
const cpList = document.createElement("div");
cpList.className = "cplist"; cpList.id = "cpList"; cpList.setAttribute("role", "listbox"); cpList.hidden = true;
document.body.appendChild(cpList);
/* Sul telefono la scelta si apre in un pannello dal basso: niente tastiera finché non la chiedi, niente elenchi che saltano */
const cpSheet = document.createElement("div");
cpSheet.className = "cpsheet"; cpSheet.hidden = true;
cpSheet.innerHTML = '<div class="cpsheet-card" role="dialog" aria-label="Scegli cliente e progetto">' +
  '<div class="cpsheet-head"><b>Cliente e progetto</b><button type="button" class="btn sm" id="cpSheetClose">Chiudi</button></div>' +
  '<input id="cpSearch" type="search" placeholder="Cerca cliente o progetto" autocomplete="off" spellcheck="false" enterkeyhint="done">' +
  '<div class="cpsheet-list" id="cpSheetList" role="listbox"></div></div>';
document.body.appendChild(cpSheet);
const cpSheetList = cpSheet.querySelector("#cpSheetList"), cpSearch = cpSheet.querySelector("#cpSearch");
const isTouch = () => matchMedia("(max-width:680px), (pointer:coarse)").matches;
CP.box = cpList;
function cpOpenSheet(input, onPick) {
  CP.input = input; CP.onPick = onPick; CP.box = cpSheetList;
  cpSearch.value = ""; cpSheet.hidden = false; document.body.classList.add("noscroll");
  cpRender(""); cpSheetList.scrollTop = 0;
}
function cpAttach(input, onPick) {
  input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-controls", "cpList");
  input.autocomplete = "off"; input.spellcheck = false;
  if (isTouch()) { input.readOnly = true; input.setAttribute("inputmode", "none"); }
  input.addEventListener("click", () => { if (isTouch()) { input.blur(); cpOpenSheet(input, onPick); } });
  input.addEventListener("focus", () => { if (isTouch()) return; CP.input = input; CP.onPick = onPick; CP.box = cpList; requestAnimationFrame(() => input.select()); cpRender(""); });
  input.addEventListener("input", () => { if (CP.input === input && !isTouch()) cpRender(input.value); });
  input.addEventListener("keydown", e => {
    if (cpList.hidden) { if (e.key === "ArrowDown") cpRender(""); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); cpMove(e.key === "ArrowDown" ? 1 : -1); }
    else if (e.key === "Enter") { e.preventDefault(); if (CP.idx >= 0) cpChoose(CP.opts[CP.idx]); }
    else if (e.key === "Escape") { e.preventDefault(); cpClose(true); input.blur(); }
    else if (e.key === "Tab") cpClose(true);
  });
}
function cpSet(input, v) {
  input.dataset.v = v || ""; input.value = cpLabel(v);
  const cid = cpClient(v);
  input.classList.toggle("set", !!cid);
  input.style.setProperty("--chip", cid ? chip(cid) : "var(--line)");
}
function cpRender(q) {
  const cur = CP.input.dataset.v || "", qq = q.trim();
  let h = "", opts = [];
  const opt = (v, main, sub, cid, cls) => {
    opts.push(v);
    return '<div class="cpopt' + (cls ? " " + cls : "") + (v === cur ? " cur" : "") + '" role="option" data-i="' + (opts.length - 1) + '"' + (cid ? ' style="--chip:' + chip(cid) + '"' : "") + '>' +
      '<span class="m">' + main + '</span>' + (sub ? '<span class="s">' + sub + '</span>' : "") + '</div>';
  };
  const typed = qq && qq !== cpLabel(cur);
  const list = cpMatches(typed ? qq : "", cur);
  if (!typed) {
    const rec = cpRecent();
    if (rec.length) {
      h += '<div class="cphead">Usati di recente</div>';
      rec.forEach(v => { const [k] = v.split(":"), ids = cpIds(v);
        const main = k === "s" ? subName(ids.subproject_id) : k === "p" ? projectName(ids.project_id) : clientName(ids.client_id);
        const sub = k === "s" ? clientName(ids.client_id) + " › " + projectName(ids.project_id) : k === "p" ? clientName(ids.client_id) : "tutto il cliente";
        h += opt(v, esc(main), esc(sub), ids.client_id, k === "s" ? "proj subp" : k === "p" ? "proj" : ""); });
      h += '<div class="cphead">Tutti</div>';
    }
  }
  const hl = t => { if (!typed) return esc(t); const i = norm(t).indexOf(norm(qq)); return i < 0 ? esc(t) : esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + qq.length)) + "</mark>" + esc(t.slice(i + qq.length)); };
  list.forEach(o => { h += opt(o.v, hl(o.main), o.proj ? hl(o.sub) : esc(o.sub), o.cid, o.subp ? "proj subp" : o.proj ? "proj" : "cli"); });
  if (typed && !list.length) h += '<div class="cpempty">Nessun cliente o progetto contiene “' + esc(qq) + '”.</div>';
  h += '<div class="cpfoot">';
  if (cur) h += opt("", "Nessun cliente", "", null, "clear");
  h += opt("__new:" + qq, typed ? "+ Crea “" + esc(qq) + "”" : "+ Nuovo cliente o progetto", "", null, "new");
  h += "</div>";
  CP.box.innerHTML = h; CP.opts = opts;
  const first = list.find(o => !o.ctx) || list[0];   // il progetto mostrato solo come contesto non si sceglie da solo
  CP.idx = typed ? (first ? opts.indexOf(first.v) : opts.length - 1) : -1;
  cpPaintIdx();
  if (CP.box === cpList) { cpList.hidden = false; cpPosition(); }
}
function cpMove(d) { const n = CP.opts.length; CP.idx = (CP.idx + d + n) % n; cpPaintIdx(true); }
function cpPaintIdx(scroll) {
  CP.box.querySelectorAll(".cpopt").forEach(el => el.classList.toggle("act", Number(el.dataset.i) === CP.idx));
  const a = CP.box.querySelector(".cpopt.act"); if (a && scroll) a.scrollIntoView({ block: "nearest" });
}
function cpPosition() {
  if (!CP.input || cpList.hidden) return;
  const r = CP.input.getBoundingClientRect(), vv = window.visualViewport;
  const vh = vv ? vv.height + vv.offsetTop : innerHeight, vw = innerWidth;
  const navH = matchMedia("(max-width:680px)").matches ? 70 : 0;
  const w = Math.min(Math.max(r.width, 300), vw - 16);
  const left = Math.min(Math.max(8, r.left), vw - w - 8);
  const below = vh - navH - r.bottom - 8, above = r.top - 8;
  const openUp = below < 220 && above > below;
  const maxH = Math.max(140, Math.min(320, openUp ? above : below));
  Object.assign(cpList.style, { left: left + "px", width: w + "px", maxHeight: maxH + "px",
    top: openUp ? "auto" : (r.bottom + 4) + "px", bottom: openUp ? (innerHeight - r.top + 4) + "px" : "auto" });
}
function cpClose(restore) {
  cpList.hidden = true;
  if (!cpSheet.hidden) { cpSheet.hidden = true; document.body.classList.remove("noscroll"); cpSearch.blur(); }
  if (restore && CP.input) CP.input.value = cpLabel(CP.input.dataset.v);
  CP.input = null; CP.onPick = null;
}
function cpChoose(v) {
  const input = CP.input, cb = CP.onPick; if (!input) return;
  cpClose(false);
  if (v.startsWith("__new:")) { input.value = cpLabel(input.dataset.v); input.blur(); cb(v); return; }
  cpSet(input, v); input.blur(); cb(v);
}
cpList.addEventListener("pointerdown", e => e.preventDefault());   // non perdere il focus mentre si sceglie
cpList.addEventListener("click", e => { const o = e.target.closest(".cpopt"); if (o) cpChoose(CP.opts[Number(o.dataset.i)]); });
cpSheetList.addEventListener("click", e => { const o = e.target.closest(".cpopt"); if (o) cpChoose(CP.opts[Number(o.dataset.i)]); });
cpSearch.addEventListener("input", () => { if (CP.input) cpRender(cpSearch.value); });
cpSearch.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); if (CP.idx >= 0) cpChoose(CP.opts[CP.idx]); else cpSearch.blur(); }
  else if (e.key === "Escape") cpClose(true);
});
cpSheet.querySelector("#cpSheetClose").onclick = () => cpClose(true);
cpSheet.addEventListener("click", e => { if (e.target === cpSheet) cpClose(true); });
document.addEventListener("pointerdown", e => { if (!cpList.hidden && e.target !== CP.input && !cpList.contains(e.target)) cpClose(true); });
addEventListener("scroll", () => cpPosition(), true);
addEventListener("resize", () => cpPosition());
if (window.visualViewport) visualViewport.addEventListener("resize", () => cpPosition());

const cpValue = e => e && e.subproject_id ? "s:" + e.subproject_id : e && e.project_id ? "p:" + e.project_id : e && e.client_id ? "c:" + e.client_id : "";

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
      '<span class="side"><input class="cp" id="c' + s + '" placeholder="Cliente / progetto" aria-label="Cliente e progetto ' + slotTime(s) + '">' +
      '<button class="lun" id="l' + s + '" aria-pressed="false" title="Segna come pausa pranzo">Pranzo</button>' +
      '<button class="rep" id="r' + s + '" title="Copia la fascia precedente" aria-label="Copia la fascia precedente"' + (s === 0 ? " disabled" : "") + '>↑</button></span>' +
      '<span class="ty" id="y' + s + '" hidden></span>';
    grid.appendChild(row);
    const txt = row.querySelector(".txt"), sel = row.querySelector(".cp");
    txt.addEventListener("input", () => { grow(txt); setSlot(s, { description: txt.value }); });
    txt.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (s < 47) $("t" + (s + 1)).focus(); } });
    cpAttach(sel, v => {
      if (v.startsWith("__new:")) { openQuickAdd(s, v.slice(6)); return; }
      applyCp(s, v);
    });
    row.querySelector(".lun").addEventListener("click", () => { const e = dayMap()[s]; setSlot(s, { is_lunch: !(e && e.is_lunch) }); });
    row.querySelector(".rep").addEventListener("click", () => {
      const p = dayMap()[s - 1];
      if (!p || !filled(p)) { toast("La fascia precedente è vuota"); return; }
      setSlot(s, { description: p.description, client_id: p.client_id, project_id: p.project_id, subproject_id: p.subproject_id || null, is_lunch: p.is_lunch, type_id: p.type_id || null });
      paintRow(s, true);
    });
  });
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => document.querySelectorAll(".row .txt").forEach(grow), 150); });
}
function grow(el) { el.style.height = "auto"; el.style.height = (el.scrollHeight + 2) + "px"; }
function applyCp(s, v) {
  const ids = cpIds(v), prev = dayMap()[s]?.type_id;
  setSlot(s, { ...ids, type_id: ids.project_id ? typeFor(ids.project_id, prev, ids.subproject_id) : null });
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
  if (CP.input !== sel) cpSet(sel, cpValue(e));
  const L = !!(e && e.is_lunch);
  row.classList.toggle("filled", !!filled(e) && !L);
  row.classList.toggle("lunch", L);
  $("l" + s).setAttribute("aria-pressed", L ? "true" : "false");
  txt.placeholder = L ? "Pausa pranzo" : "Su cosa hai lavorato?";
  paintTypes(s, e);
}
/* scelta della tipologia nella fascia: compare solo se il progetto ne ha più di una */
function paintTypes(s, e) {
  const box = $("y" + s), list = S.typeCol && e && e.project_id && !e.is_lunch ? slotTypes(e.project_id, e.subproject_id) : [];
  if (list.length < 2) { box.hidden = true; box.innerHTML = ""; $("grid").children[s].classList.remove("hasty"); return; }
  box.hidden = false; $("grid").children[s].classList.add("hasty");
  box.innerHTML = '<span class="ty-l' + (e.type_id && list.includes(e.type_id) ? "" : " warn") + '">' + (e.type_id && list.includes(e.type_id) ? "Tipologia" : "Scegli la tipologia") + "</span>" +
    list.map(t => '<button type="button" class="tchip" data-t="' + t + '" aria-pressed="' + (e.type_id === t) + '">' + esc(typeName(t)) + "</button>").join("");
  box.querySelectorAll("button").forEach(b => b.onclick = () => { const t = Number(b.dataset.t); setSlot(s, { type_id: dayMap()[s]?.type_id === t ? null : t }); });
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
    const st = $("dayStick"), off = (parseFloat(getComputedStyle(st).top) || 0) + st.getBoundingClientRect().height + 8;
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
  const base = map[s] || { user_id: S.me.id, day: ds, slot: s, description: "", client_id: null, project_id: null, subproject_id: null, is_lunch: false, type_id: null };
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
  else {
    const row = { user_id: S.me.id, day: ds, slot: s, description: (e.description || "").slice(0, 500),
      client_id: e.client_id, project_id: e.project_id, is_lunch: !!e.is_lunch };
    if (S.typeCol) row.type_id = e.is_lunch ? null : (e.type_id || null);
    if (S.subOn) row.subproject_id = e.project_id ? (e.subproject_id || null) : null;
    ({ error } = await sb.from("entries").upsert(row, { onConflict: "user_id,day,slot" }));
  }
  inflight--;
  if (error) { failed++; setSync("Salvataggio non riuscito: controlla la connessione. Riprovo…", true); setTimeout(() => { if (!pending.has(key)) { pending.set(key, 0); save(ds, s); } }, 4000); return; }
  if (!inflight && !pending.size) setSync("Salvato");
}
addEventListener("beforeunload", e => { if (pending.size || inflight) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- Aggiunta rapida cliente/progetto ---------- */
let qaSlot = null;
function openQuickAdd(s, typed) {
  qaSlot = s; typed = (typed || "").trim();
  $("qaClient").innerHTML = '<option value="__new">+ Nuovo cliente</option>' +
    S.clients.filter(c => !c.archived).map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join("");
  $("qaClient").value = S.clients.some(c => !c.archived) ? String(S.clients.find(c => !c.archived).id) : "__new";
  // se il testo scritto è il nome di un cliente esistente, si aggiunge un progetto a quel cliente
  const match = typed && S.clients.find(c => !c.archived && norm(c.name) === norm(typed));
  if (typed) $("qaClient").value = match ? String(match.id) : "__new";
  $("qaNewClientWrap").hidden = $("qaClient").value !== "__new";
  qaFillProjects();
  $("qaNewClient").value = typed && !match ? typed : ""; $("qaProject").value = ""; $("qaMsg").hidden = true;
  $("qaKind").replaceChildren(...kindPicker("").childNodes); $("qaKind").dataset.v = "";
  $("qaKind").querySelectorAll("button").forEach(b => b.onclick = () => { $("qaKind").dataset.v = b.textContent === "Privato" ? "privato" : "commerciale"; $("qaKind").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false")); });
  $("qaTypes").innerHTML = S.types.map(t => '<label class="tpick"><input type="checkbox" value="' + t.id + '"><span>' + esc(t.name) + '</span></label>').join("");
  $("qa").hidden = false;
  ($("qaClient").value === "__new" && !typed ? $("qaNewClient") : $("qaProject")).focus();
}
/* con un cliente esistente si può scegliere un suo progetto e aggiungergli un sottoprogetto */
function qaFillProjects() {
  const c = $("qaClient").value, projs = S.subOn && c !== "__new" ? S.projects.filter(p => p.client_id === Number(c) && !p.archived) : [];
  $("qaProjSelWrap").hidden = !projs.length;
  $("qaProjSel").innerHTML = '<option value="__new">+ Nuovo progetto</option>' + projs.map(p => '<option value="' + p.id + '">' + esc(p.name) + "</option>").join("");
  qaProjMode();
}
function qaProjMode() {
  const sub = !$("qaProjSelWrap").hidden && $("qaProjSel").value !== "__new";
  $("qaProjectLbl").textContent = sub ? "Nome del sottoprogetto" : "Progetto (facoltativo)";
  $("qaProject").placeholder = sub ? "es. Campagna Natale" : "es. Shooting catalogo autunno";
  $("qaTypesLbl").textContent = sub ? "Tipologie del sottoprogetto (facoltative: senza, valgono quelle del progetto)" : "Tipologie del progetto (facoltative)";
}
$("qaClient").onchange = () => { $("qaNewClientWrap").hidden = $("qaClient").value !== "__new"; qaFillProjects(); };
$("qaProjSel").onchange = qaProjMode;
$("qaCancel").onclick = () => { $("qa").hidden = true; };
$("qa").addEventListener("click", e => { if (e.target === $("qa")) $("qa").hidden = true; });
$("qaForm").addEventListener("submit", async e => {
  e.preventDefault();
  const showErr = m => { $("qaMsg").textContent = m; $("qaMsg").hidden = false; };
  try {
    let cid = $("qaClient").value;
    if (cid === "__new") {
      const name = $("qaNewClient").value.trim(); if (!name) return showErr("Scrivi il nome del cliente.");
      const kind = $("qaKind").dataset.v;
      if (S.kindOn && !kind) return showErr("Indica se il cliente è commerciale o privato.");
      cid = (await addClient(name, kind)).id;
    } else cid = Number(cid);
    let pid = null, sid = null; const pn = $("qaProject").value.trim();
    const existing = !$("qaProjSelWrap").hidden && $("qaProjSel").value !== "__new" ? Number($("qaProjSel").value) : null;
    if (existing) {
      if (!pn) return showErr("Scrivi il nome del sottoprogetto.");
      pid = existing; sid = (await addSub(pid, pn)).id;
      for (const cb of $("qaTypes").querySelectorAll("input:checked")) await toggleProjType(sid, Number(cb.value), true);
    } else if (pn) {
      pid = (await addProject(cid, pn)).id;
      for (const cb of $("qaTypes").querySelectorAll("input:checked")) await toggleProjType(pid, Number(cb.value));
    }
    $("qa").hidden = true;
    const v = sid ? "s:" + sid : pid ? "p:" + pid : "c:" + cid;
    if (qaSlot === "range") { cpSet($("rngCp"), v); RT = null; paintRangeTypes(); }
    else if (qaSlot !== null) applyCp(qaSlot, v);
    renderDay(); toast("Aggiunto");
  } catch (err) { showErr(err.message); }
});
async function addClient(name, kind) {
  const row = { name, created_by: S.me.id }; if (S.kindOn) row.kind = kind || null;
  const { data, error } = await sb.from("clients").insert(row).select().single();
  if (error) throw new Error(error.code === "23505" ? "Esiste già un cliente con questo nome." : "Non sono riuscito ad aggiungere il cliente.");
  S.clients.push(data); S.clients.sort((a, b) => a.name.localeCompare(b.name, "it")); return data;
}
async function addProject(clientId, name) {
  const { data, error } = await sb.from("projects").insert({ client_id: clientId, name, created_by: S.me.id }).select().single();
  if (error) throw new Error(error.code === "23505" ? "Questo cliente ha già un progetto con questo nome." : "Non sono riuscito ad aggiungere il progetto.");
  S.projects.push(data); S.projects.sort((a, b) => a.name.localeCompare(b.name, "it")); return data;
}

async function addSub(projectId, name) {
  const { data, error } = await sb.from("subprojects").insert({ project_id: projectId, name, created_by: S.me.id }).select().single();
  if (error) throw new Error(error.code === "23505" ? "Questo progetto ha già un sottoprogetto con questo nome." : "Non sono riuscito ad aggiungere il sottoprogetto.");
  S.subs.push(data); S.subs.sort((a, b) => a.name.localeCompare(b.name, "it"));
  document.querySelectorAll("[data-sub]").forEach(el => el.hidden = false);
  return data;
}

/* ---------- Intervallo: compila più fasce in un colpo ---------- */
let rngConfirm = false;
function openRange() {
  const ds = iso(S.cur), map = dayMap();
  $("rngDay").textContent = GIORNI[S.cur.getDay()] + " " + S.cur.getDate() + " " + MESI[S.cur.getMonth()];
  $("rngFrom").innerHTML = SLOTS.map(s => '<option value="' + s + '">' + slotTime(s) + "</option>").join("");
  $("rngTo").innerHTML = SLOTS.map(s => '<option value="' + (s + 1) + '">' + slotEnd(s) + "</option>").join("");
  // proposta: dalla prima fascia vuota dalle 9 in poi, per 4 ore
  let start = 18; while (start < 47 && filled(map[start])) start++;
  $("rngFrom").value = String(start); $("rngTo").value = String(Math.min(48, start + 8));
  cpSet($("rngCp"), ""); paintRangeTypes();
  $("rngTxt").value = ""; $("rngLunch").checked = false; $("rngMsg").hidden = true;
  resetRangeWarn(); rangeLen();
  $("rng").hidden = false;   // nessun campo attivo all'apertura: su iPhone aprirebbe subito la tendina
}
function resetRangeWarn() { rngConfirm = false; $("rngWarn").hidden = true; $("rngEmpty").hidden = true; $("rngOk").textContent = "Compila le fasce"; }
function rangeBounds() { return [Number($("rngFrom").value), Number($("rngTo").value)]; }
function rangeLen() {
  const [a, b] = rangeBounds();
  $("rngLen").textContent = b > a ? slotTime(a) + "–" + slotEnd(b - 1) + " · " + fmtH((b - a) / 2) + " · " + (b - a) + " fasce" : "L'orario di fine deve venire dopo quello di inizio.";
}
["rngFrom", "rngTo"].forEach(id => $(id).addEventListener("change", () => {
  if (id === "rngFrom" && Number($("rngTo").value) <= Number($("rngFrom").value)) $("rngTo").value = String(Math.min(48, Number($("rngFrom").value) + 1));
  resetRangeWarn(); rangeLen();
}));
["rngTxt", "rngLunch"].forEach(id => $(id).addEventListener("input", resetRangeWarn));
cpAttach($("rngCp"), v => { resetRangeWarn(); if (v.startsWith("__new:")) openQuickAdd("range", v.slice(6)); else { RT = null; paintRangeTypes(); } });
let RT = null;   // tipologia scelta nell'intervallo
function paintRangeTypes() {
  const ids = cpIds($("rngCp").dataset.v || "");
  const list = S.typeCol && ids.project_id ? slotTypes(ids.project_id, ids.subproject_id) : [], box = $("rngTypes");
  if (list.length < 2) { box.hidden = true; RT = list.length === 1 ? list[0] : null; return; }
  box.hidden = false;
  const chips = $("rngTypeChips");
  chips.innerHTML = list.map(t => '<button type="button" class="tchip" data-t="' + t + '" aria-pressed="' + (RT === t) + '">' + esc(typeName(t)) + "</button>").join("");
  chips.querySelectorAll("button").forEach(b => b.onclick = () => { const t = Number(b.dataset.t); RT = RT === t ? null : t; paintRangeTypes(); });
}
$("rangeBtn").onclick = openRange;
$("rngCancel").onclick = () => { $("rng").hidden = true; };
$("rng").addEventListener("click", e => { if (e.target === $("rng")) $("rng").hidden = true; });
$("rngEmpty").onclick = () => applyRange(true);
$("rngForm").addEventListener("submit", e => { e.preventDefault(); applyRange(false); });

async function applyRange(onlyEmpty) {
  const [a, b] = rangeBounds(), err = m => { $("rngMsg").textContent = m; $("rngMsg").hidden = false; };
  $("rngMsg").hidden = true;
  if (b <= a) return err("L'orario di fine deve venire dopo quello di inizio.");
  const txt = $("rngTxt").value.trim(), cp = $("rngCp").dataset.v || "", lunch = $("rngLunch").checked;
  if (!txt && !cp && !lunch) return err("Scegli un cliente o scrivi su cosa hai lavorato.");
  const map = dayMap(), ds = iso(S.cur);
  const busy = []; for (let s = a; s < b; s++) if (filled(map[s])) busy.push(s);
  if (busy.length && !rngConfirm && !onlyEmpty) {
    rngConfirm = true;
    $("rngWarnTitle").textContent = busy.length === b - a ? "Tutte le fasce scelte sono già compilate." : busy.length + (busy.length === 1 ? " fascia è già compilata." : " fasce sono già compilate.");
    $("rngWarnList").textContent = toRuns(busy).join(", ") + ". Vuoi sostituirle?";
    $("rngWarn").hidden = false; $("rngEmpty").hidden = busy.length === b - a; $("rngOk").textContent = "Sostituisci";
    return;
  }
  const { client_id, project_id, subproject_id } = cpIds(cp);
  const rows = [];
  for (let s = a; s < b; s++) {
    if (onlyEmpty && filled(map[s])) continue;
    const key = ds + "|" + s; clearTimeout(pending.get(key)); pending.delete(key);
    const e = { user_id: S.me.id, day: ds, slot: s, description: txt, client_id, project_id, is_lunch: lunch };
    if (S.subOn) e.subproject_id = subproject_id;
    if (S.typeCol) e.type_id = lunch || !project_id ? null : (RT && slotTypes(project_id, subproject_id).includes(RT) ? RT : typeFor(project_id, null, subproject_id));
    map[s] = e; rows.push(e);
  }
  $("rngOk").disabled = true;
  setSync("Salvataggio…");
  const { error } = await sb.from("entries").upsert(rows, { onConflict: "user_id,day,slot" });
  $("rngOk").disabled = false;
  if (error) { setSync("Salvataggio non riuscito: controlla la connessione", true); return err("Non sono riuscito a salvare. Controlla la connessione e riprova."); }
  setSync("Salvato");
  $("rng").hidden = true; renderDay();
  toast(rows.length ? "Compilate " + rows.length + " fasce (" + fmtH(rows.length / 2) + ")" : "Nessuna fascia vuota da compilare");
}
/* [18,19,20,24] -> ["09:00–10:30", "12:00–12:30"] */
function toRuns(list) {
  const out = []; let st = list[0], pr = list[0];
  for (let i = 1; i <= list.length; i++) {
    if (list[i] === pr + 1) { pr = list[i]; continue; }
    out.push(slotTime(st) + "–" + slotEnd(pr)); st = pr = list[i];
  }
  return out;
}

/* ================= Lettura fasce in un intervallo ================= */
async function fetchEntries(from, to, f = {}) {
  const out = []; const size = 1000;
  for (let off = 0; ; off += size) {
    let q = sb.from("entries").select("user_id, day, slot, description, client_id, project_id, is_lunch" + (S.typeCol ? ", type_id" : "") + (S.subOn ? ", subproject_id" : ""))
      .gte("day", from).lte("day", to).eq("is_lunch", false);
    if (f.user) q = q.eq("user_id", f.user);
    if (f.client === "none") q = q.is("client_id", null); else if (f.client) q = q.eq("client_id", Number(f.client));
    if (f.project === "none") q = q.is("project_id", null); else if (f.project) q = q.eq("project_id", Number(f.project));
    if (S.subOn && f.sub === "none") q = q.is("subproject_id", null); else if (S.subOn && f.sub) q = q.eq("subproject_id", Number(f.sub));
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
        last.client_id === e.client_id && last.project_id === e.project_id && (last.subproject_id || null) === (e.subproject_id || null) && (last.type_id || null) === (e.type_id || null) && (last.description || "") === (e.description || "")) {
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
    const c = byC.get(k); c.h += .5; const pk = r.project_id ? r.project_id + "|" + (r.subproject_id || "") : "0"; c.p.set(pk, (c.p.get(pk) || 0) + .5);
  });
  const list = [...byC.entries()].sort((x, y) => (x[0] === 0) - (y[0] === 0) || y[1].h - x[1].h);
  const max = Math.max(...list.map(x => x[1].h));
  list.forEach(([cid, c]) => {
    box.appendChild(barEl(clientName(cid), c.h, tot, max, chip(cid)));
    if (cid && (c.p.size > 1 || !c.p.has("0"))) {
      [...c.p.entries()].sort((x, y) => y[1] - x[1]).forEach(([pk, h]) => { const [pid, sid] = pk.split("|").map(Number);
        box.appendChild(barEl(pid ? projFull(pid, sid || null) : "Generale", h, tot, max, chip(cid), true)); });
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
    S.profiles.map(p => '<option value="' + p.id + '">' + esc(p.full_name) + (p.deleted_at ? " (eliminato)" : p.active ? "" : " (disattivato)") + '</option>').join("");
  $("fClient").innerHTML = '<option value="">Tutti i clienti</option><option value="none">Senza cliente</option>' +
    S.clients.map(x => '<option value="' + x.id + '">' + esc(x.name) + (x.archived ? " (archiviato)" : "") + '</option>').join("");
  $("fUser").value = u; $("fClient").value = c;
  const t = $("fType").value;
  $("fType").innerHTML = '<option value="">Tutte le tipologie</option>' + S.types.map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join("") + '<option value="nd">Non indicata</option><option value="none">Senza tipologia</option>';
  $("fType").value = [...$("fType").options].some(o => o.value === t) ? t : "";
  // "Sottoprogetto" tra i raggruppamenti solo se ne esiste almeno uno (Safari non nasconde le option: si tolgono)
  const subAv = S.subOn && S.subs.length > 0;
  ["fGroup", "fCross"].forEach(id => {
    const sel = $(id), o = [...sel.options].find(x => x.value === "sub");
    if (!subAv && o) { if (sel.value === "sub") sel.value = id === "fGroup" ? "project" : ""; o.remove(); }
    if (subAv && !o) { const n = new Option("Sottoprogetto", "sub"); sel.insertBefore(n, [...sel.options].find(x => x.value === "project").nextSibling); }
  });
  fillProjectFilter();
}
function fillProjectFilter() {
  const c = $("fClient").value, cur = $("fProject").value;
  const list = c && c !== "none" ? S.projects.filter(p => p.client_id === Number(c)) : S.projects;
  $("fProject").innerHTML = '<option value="">Tutti i progetti</option>' + (c && c !== "none" ? '<option value="none">Solo generale (senza progetto)</option>' : "") +
    list.map(p => '<option value="' + p.id + '">' + esc((c ? "" : clientName(p.client_id) + " › ") + p.name) + '</option>').join("");
  $("fProject").disabled = c === "none";
  $("fProject").value = [...$("fProject").options].some(o => o.value === cur) ? cur : "";
  fillSubFilter();
}
/* filtro sottoprogetto: compare solo per un progetto che ne ha */
function fillSubFilter() {
  const p = Number($("fProject").value) || null, cur = $("fSub").value;
  const list = p && S.subOn ? S.subs.filter(x => x.project_id === p) : [];
  $("fSubWrap").hidden = !list.length;
  $("fSub").innerHTML = '<option value="">Tutti i sottoprogetti</option><option value="none">Solo il progetto (senza sottoprogetto)</option>' +
    list.map(x => '<option value="' + x.id + '">' + esc(x.name) + (x.archived ? " (archiviato)" : "") + "</option>").join("");
  $("fSub").value = list.length && [...$("fSub").options].some(o => o.value === cur) ? cur : "";
}
function initReport() {
  if (R.ready) return; R.ready = true;
  if (matchMedia("(max-width:680px)").matches) $("fBox").open = false;
  const [a, b] = presetRange("month"); $("fFrom").value = iso(a); $("fTo").value = iso(b);
  fillFilterSelects();
  $("fPreset").onchange = () => { const r = presetRange($("fPreset").value); if (r) { $("fFrom").value = iso(r[0]); $("fTo").value = iso(r[1]); } loadReport(); };
  ["fFrom", "fTo"].forEach(id => $(id).onchange = () => { $("fPreset").value = "custom"; loadReport(); });
  $("fUser").onchange = loadReport;
  $("fClient").onchange = () => { fillProjectFilter(); loadReport(); };
  $("fProject").onchange = () => { fillSubFilter(); loadReport(); };
  $("fSub").onchange = loadReport;
  $("fType").onchange = renderReport; $("fKind").onchange = renderReport;
  $("fGroup").onchange = renderReport; $("fCross").onchange = renderReport;
  let tt; $("fText").oninput = () => { clearTimeout(tt); tt = setTimeout(renderReport, 250); };
  $("fReset").onclick = () => {
    $("fPreset").value = "month"; const r = presetRange("month"); $("fFrom").value = iso(r[0]); $("fTo").value = iso(r[1]);
    $("fUser").value = ""; $("fClient").value = ""; $("fProject").value = ""; fillProjectFilter(); $("fText").value = ""; $("fType").value = ""; $("fKind").value = "";
    $("fGroup").value = "client"; $("fCross").value = "user"; loadReport();
  };
  $("moreRows").onclick = () => { R.shown += 100; renderDetail(); };
  $("exportXlsx").onclick = () => exportExcel("view");
  $("exportFull").onclick = () => exportExcel("full");
}
let repSeq = 0;
async function loadReport() {
  const from = $("fFrom").value, to = $("fTo").value;
  if (!from || !to || from > to) { $("repStatus").textContent = "Controlla le date: la data iniziale deve venire prima di quella finale."; return; }
  const seq = ++repSeq; $("repStatus").textContent = "Caricamento…";
  try {
    const rows = await fetchEntries(from, to, { user: $("fUser").value, client: $("fClient").value, project: $("fProject").value, sub: $("fSubWrap").hidden ? "" : $("fSub").value });
    if (seq !== repSeq) return;
    R.rows = rows; $("repStatus").textContent = "";
    renderReport();
  } catch { if (seq === repSeq) $("repStatus").textContent = "Non riesco a caricare i dati. Controlla la connessione e riprova."; }
}
function updateFilterSummary() {
  const parts = [$("fPreset").value === "custom" ? fmtDate($("fFrom").value) + " – " + fmtDate($("fTo").value) : $("fPreset").selectedOptions[0].text];
  ["fUser", "fKind", "fClient", "fProject", "fSub", "fType"].forEach(id => { if ($(id).value && !(id === "fSub" && $("fSubWrap").hidden)) parts.push($(id).selectedOptions[0].text); });
  if ($("fText").value.trim()) parts.push("“" + $("fText").value.trim() + "”");
  parts.push("per " + DIM[$("fGroup").value].label + ($("fCross").value ? " × " + DIM[$("fCross").value].label : ""));
  $("fSummary").textContent = parts.join(" · ");
}
function filteredRows() {
  const q = $("fText").value.trim().toLowerCase(), t = S.typesOn ? $("fType").value : "", kf = S.kindOn ? $("fKind").value : "";
  return R.rows.filter(r => (!q || (r.description || "").toLowerCase().includes(q)) &&
    (!t || (t === "none" ? slotType(r) === "0" : slotType(r) === t)) &&
    (!kf || kindKey(r.client_id) === kf));
}
const DIM = {
  client: { label: "cliente", key: r => String(r.client_id || 0), name: k => clientName(Number(k) || null), color: k => chip(Number(k) || null) },
  project: { label: "progetto", key: r => r.project_id ? "p" + r.project_id : "c" + (r.client_id || 0),
    name: k => k[0] === "p" ? clientName(projectById(Number(k.slice(1)))?.client_id) + " › " + projectName(Number(k.slice(1))) : (k === "c0" ? "Senza cliente" : clientName(Number(k.slice(1))) + " › generale"),
    color: k => k[0] === "p" ? chip(projectById(Number(k.slice(1)))?.client_id) : chip(Number(k.slice(1)) || null) },
  sub: { label: "sottoprogetto", key: r => r.subproject_id ? "s" + r.subproject_id : r.project_id ? "p" + r.project_id : "c" + (r.client_id || 0),
    name: k => { if (k[0] === "s") { const x = subById(Number(k.slice(1))), p = x && projectById(x.project_id); return (p ? clientName(p.client_id) + " › " + p.name + " › " : "") + subName(Number(k.slice(1))); }
      return DIM.project.name(k) + (k[0] === "p" && S.subs.some(x => x.project_id === Number(k.slice(1))) ? " › senza sottoprogetto" : ""); },
    color: k => { if (k[0] === "s") { const x = subById(Number(k.slice(1))); return chip(projectById(x?.project_id)?.client_id); } return DIM.project.color(k); } },
  user: { label: "persona", key: r => r.user_id, name: k => profileById(k)?.full_name || "Utente rimosso", color: k => "var(--c" + (Math.max(0, S.profiles.findIndex(p => p.id === k)) % 8) + ")" },
  day: { label: "giorno", key: r => r.day, name: k => G3[parse(k).getDay()] + " " + fmtDate(k), color: () => "var(--accent)", sort: true },
  week: { label: "settimana", key: r => { const [y, w] = isoWeek(parse(r.day)); return y + "-W" + pad(w); }, name: k => { const [y, w] = k.split("-W"); return "Settimana " + Number(w) + " · " + y; }, color: () => "var(--accent)", sort: true },
  month: { label: "mese", key: r => r.day.slice(0, 7), name: k => cap(MESI[Number(k.slice(5)) - 1]) + " " + k.slice(0, 4), color: () => "var(--accent)", sort: true },
  kind: { label: "tipo cliente", key: r => kindKey(r.client_id), name: kindName, color: k => k === "commerciale" ? "var(--c0)" : k === "privato" ? "var(--c5)" : "var(--muted)" },
  type: { label: "tipologia", key: r => slotType(r),
    name: k => k === "0" ? "Senza tipologia" : k === "nd" ? "Tipologia non indicata" : typeName(Number(k)),
    color: k => k === "0" || k === "nd" ? "var(--muted)" : "var(--c" + ((S.types.findIndex(t => String(t.id) === k) + 3) % 8) + ")" },
};
const dimKeys = (dim, r) => DIM[dim].keys ? DIM[dim].keys(r) : [DIM[dim].key(r)];
function groupBy(rows, dim) {
  const m = new Map(); rows.forEach(r => dimKeys(dim, r).forEach(k => m.set(k, (m.get(k) || 0) + 0.5)));
  const list = [...m.entries()];
  if (DIM[dim].sort) list.sort((a, b) => a[0] < b[0] ? -1 : 1); else list.sort((a, b) => b[1] - a[1]);
  return list;
}
function renderReport() {
  const rows = filteredRows(), tot = rows.length * 0.5;
  updateFilterSummary();
  $("rTot").textContent = fmtH(tot);
  $("rPeople").textContent = new Set(rows.map(r => r.user_id)).size;
  $("rClients").textContent = new Set(rows.filter(r => r.client_id).map(r => r.client_id)).size;
  $("rNone").textContent = fmtH(rows.filter(r => !r.client_id).length * 0.5);

  const g = $("fGroup").value, x = $("fCross").value;
  $("groupLabel").textContent = "Ore per " + DIM[g].label + (["client", "user", "project", "sub", "type", "kind"].includes(g) ? " · tocca una riga per filtrare" : "");
  const nd = (g === "type" || x === "type") && rows.some(r => slotType(r) === "nd");
  $("multiNote").hidden = !nd; $("multiNote").textContent = "“Tipologia non indicata”: ore su progetti con più tipologie in cui la fascia non dice quale. Si sistemano dal registro di chi le ha compilate.";
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
    const cell = new Map(); rows.forEach(r => dimKeys(g, r).forEach(a => dimKeys(x, r).forEach(b => { const k = a + "|" + b; cell.set(k, (cell.get(k) || 0) + .5); })));
    let h = "<thead><tr><th>" + esc(cap(DIM[g].label)) + "</th>" + cols.map(c => '<th class="num">' + esc(DIM[x].name(c)) + "</th>").join("") + '<th class="num">Totale</th></tr></thead><tbody>';
    list.forEach(([k, t]) => {
      h += "<tr><td>" + esc(DIM[g].name(k)) + "</td>" + cols.map(c => { const v = cell.get(k + "|" + c) || 0; return '<td class="num' + (v ? "" : " zero") + '">' + (v ? fmtH(v).replace(" h", "") : "·") + "</td>"; }).join("") + '<td class="num tot">' + fmtH(t).replace(" h", "") + "</td></tr>";
    });
    const colMap = new Map(groupBy(rows, x)), colTot = cols.map(c => colMap.get(c) || 0);
    h += '<tr class="tot"><td>Totale</td>' + colTot.map(v => '<td class="num">' + fmtH(v).replace(" h", "") + "</td>").join("") + '<td class="num">' + fmtH(tot).replace(" h", "") + "</td></tr></tbody>";
    $("matrix").innerHTML = h;
  }
  // nel dettaglio a schermo le lavorazioni più recenti in alto
  R.blocks = toBlocks(rows).sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : 0); R.shown = 50; renderDetail();
}
function drillFor(dim, k) {
  if (dim === "client") return () => { $("fClient").value = k === "0" ? "none" : k; fillProjectFilter(); $("fGroup").value = "project"; loadReport(); };
  if (dim === "user") return () => { $("fUser").value = k; $("fGroup").value = "client"; if ($("fCross").value === "user") $("fCross").value = "project"; loadReport(); };
  if (dim === "kind") return () => { $("fKind").value = k === "0" ? "" : k; $("fGroup").value = "client"; renderReport(); };
  if (dim === "type") return () => { $("fType").value = k === "0" ? "none" : k; $("fGroup").value = "project"; renderReport(); };
  if (dim === "project" && k[0] === "p") return () => { const p = projectById(Number(k.slice(1))); $("fClient").value = String(p.client_id); fillProjectFilter(); $("fProject").value = String(p.id); fillSubFilter();
    const hasSub = !$("fSubWrap").hidden; $("fGroup").value = hasSub ? "sub" : "user"; $("fCross").value = hasSub ? "user" : ""; loadReport(); };
  if (dim === "sub" && k[0] === "s") return () => { const x = subById(Number(k.slice(1))), p = projectById(x.project_id); $("fClient").value = String(p.client_id); fillProjectFilter(); $("fProject").value = String(p.id); fillSubFilter(); $("fSub").value = String(x.id); $("fGroup").value = "user"; $("fCross").value = ""; loadReport(); };
  if (dim === "sub" && k[0] === "p") return drillFor("project", k);
  return null;
}
function renderDetail() {
  const b = R.blocks;
  if (!b.length) { $("detail").innerHTML = '<tbody><tr><td class="note">Nessuna riga.</td></tr></tbody>'; $("moreRows").hidden = true; return; }
  let h = '<thead><tr><th>Data</th><th>Persona</th><th>Orario</th><th class="num">Ore</th><th>Cliente</th><th>Progetto</th><th>Descrizione</th></tr></thead><tbody>';
  b.slice(0, R.shown).forEach(r => {
    h += '<tr><td class="mono">' + fmtDate(r.day) + '</td><td class="nw">' + esc(profileById(r.user_id)?.full_name || "—") + '</td><td class="mono">' + slotTime(r.startSlot) + "–" + slotEnd(r.endSlot) +
      '</td><td class="num">' + fmtH(r.hours).replace(" h", "") + '</td><td><span class="chip" style="--chip:' + chip(r.client_id) + '">' + esc(clientName(r.client_id)) + '</span></td><td>' + esc(projFull(r.project_id, r.subproject_id)) + (S.typesOn && slotTypeName(r) ? '<div class="tsmall">' + esc(slotTypeName(r)) + '</div>' : "") +
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
/* Costruttore di fogli: sezioni una sotto l'altra, con stili e formati per colonna */
const XS = {
  title: { font: { bold: true, sz: 15, color: { rgb: "CC2633" } } },
  sub: { font: { italic: true, color: { rgb: "61646B" } } },
  section: { font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "191B1D" } } },
  head: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "CC2633" } }, alignment: { wrapText: true, vertical: "center" } },
  total: { font: { bold: true }, fill: { fgColor: { rgb: "EEEEF0" } }, border: { top: { style: "thin", color: { rgb: "191B1D" } } } },
  label: { font: { bold: true } },
  kpi: { font: { bold: true, sz: 14 } },
};
function Sheet(name) { this.name = name; this.rows = []; this.st = []; this.fmt = []; this.filter = null; }
Sheet.prototype.row = function (cells, style, fmts) {
  const r = this.rows.length; this.rows.push(cells);
  if (style) this.st.push([r, style, Math.max(cells.length, 1)]);
  if (fmts) this.fmt.push([r, fmts]);
  return r;
};
Sheet.prototype.gap = function () { this.rows.push([]); };
Sheet.prototype.section = function (t) { this.row([t], "section"); };
/* tabella: fmts per colonna = "h" ore, "p" percentuale, "d" data, "t" testo */
Sheet.prototype.table = function (head, body, total, fmts, autoFilter) {
  const h = this.row(head, "head");
  body.forEach(b => this.row(b, null, fmts));
  if (total) this.row(total, "total", fmts);
  if (autoFilter && body.length) this.filter = { s: { r: h, c: 0 }, e: { r: h + body.length, c: head.length - 1 } };
  this.gap();
};
Sheet.prototype.build = function (X) {
  const ws = X.utils.aoa_to_sheet(this.rows, { cellDates: true });
  const Z = { h: "0.0", p: "0%", d: "dd/mm/yyyy", n: "0" };
  this.fmt.forEach(([r, f]) => f.forEach((k, c) => { const a = X.utils.encode_cell({ r, c }); if (ws[a] && Z[k] && ws[a].t !== "s") ws[a].z = Z[k]; }));
  this.st.forEach(([r, k, n]) => { const width = k === "section" ? Math.max(n, this.maxCols()) : n;
    for (let c = 0; c < width; c++) { const a = X.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { t: "s", v: "" }; ws[a].s = XS[k]; } });
  const w = [];
  this.rows.forEach((row, r) => row.forEach((v, c) => {
    if (this.st.some(([sr, k]) => sr === r && (k === "title" || k === "section" || k === "sub"))) return;
    const len = v instanceof Date ? 10 : String(v ?? "").length; w[c] = Math.min(60, Math.max(w[c] || 8, len + 2));
  }));
  ws["!cols"] = w.map(x => ({ wch: x || 10 }));
  if (this.filter) ws["!autofilter"] = { ref: X.utils.encode_range(this.filter) };
  const ref = X.utils.decode_range(ws["!ref"] || "A1"); ref.e.c = Math.max(ref.e.c, this.maxCols() - 1); ws["!ref"] = X.utils.encode_range(ref);
  return ws;
};
Sheet.prototype.maxCols = function () { return Math.max(1, ...this.rows.map(r => r.length)); };

const pct = (h, tot) => tot ? h / tot : 0;
const personName = id => profileById(id)?.full_name || "Utente rimosso";
const projKey = r => r.project_id ? "p" + r.project_id : "c" + (r.client_id || 0);
/* la colonna Sottoprogetto c'è solo se nel sistema esiste almeno un sottoprogetto */
const hasSubCol = () => S.subOn && S.subs.length > 0;
function blockRow(b) {
  const r = [parse(b.day), GIORNI[parse(b.day).getDay()], personName(b.user_id), slotTime(b.startSlot), slotEnd(b.endSlot), b.hours,
    clientName(b.client_id), b.client_id ? kindName(kindKey(b.client_id)) : "", b.project_id ? projectName(b.project_id) : (b.client_id ? "generale" : "")];
  if (hasSubCol()) r.push(subName(b.subproject_id));
  r.push(slotTypeName(b), b.description || ""); return r;
}
const detHead = () => ["Data", "Giorno", "Persona", "Inizio", "Fine", "Ore", "Cliente", "Tipo cliente", "Progetto", ...(hasSubCol() ? ["Sottoprogetto"] : []), "Tipologia", "Descrizione"];
const detFmt = () => detHead().map((h, i) => i === 0 ? "d" : h === "Ore" ? "h" : "t");
function filterLines() {
  return [
    ["Periodo", fmtDate($("fFrom").value) + " – " + fmtDate($("fTo").value)],
    ["Persona", $("fUser").value ? personName($("fUser").value) : "Tutte"],
    ["Cliente", $("fClient").selectedOptions[0]?.text || "Tutti"],
    ["Progetto", $("fProject").selectedOptions[0]?.text || "Tutti"],
    ...(hasSubCol() ? [["Sottoprogetto", !$("fSubWrap").hidden && $("fSub").value ? $("fSub").selectedOptions[0].text : "Tutti"]] : []),
    ["Tipo cliente", $("fKind").value ? $("fKind").selectedOptions[0].text : "Tutti"],
    ["Tipologia", $("fType").value ? $("fType").selectedOptions[0].text : "Tutte"],
    ["Testo cercato", $("fText").value.trim() || "—"],
  ];
}
function headerBlock(sh, title, rows) {
  sh.row([title], "title");
  sh.row(["Esportato il " + new Date().toLocaleString("it-IT")], "sub");
  sh.gap();
  filterLines().forEach(l => sh.row(l, null)); sh.st.push(...filterLines().map((_, i) => [3 + i, "label", 1]));
  sh.gap();
  const tot = rows.length * .5;
  sh.row(["Ore totali", "Persone", "Clienti", "Progetti", "Senza cliente"], "head");
  sh.row([tot, new Set(rows.map(r => r.user_id)).size, new Set(rows.filter(r => r.client_id).map(r => r.client_id)).size,
    new Set(rows.filter(r => r.project_id).map(r => r.project_id)).size, rows.filter(r => !r.client_id).length * .5], "kpi", ["h", "n", "n", "n", "h"]);
  sh.gap();
}
function groupTable(sh, rows, dim, title) {
  const tot = rows.length * .5;
  sh.section(title || "Ore per " + DIM[dim].label);
  const body = groupBy(rows, dim).map(([k, h]) => [DIM[dim].name(k), h, pct(h, tot)]);
  sh.table([cap(DIM[dim].label), "Ore", "%"], body, ["Totale", tot, 1], ["t", "h", "p"]);
}
function matrixTable(sh, rows, g, x, title) {
  const rl = groupBy(rows, g), cl = groupBy(rows, x).map(c => c[0]), tot = rows.length * .5;
  const cell = new Map(); rows.forEach(r => dimKeys(g, r).forEach(a => dimKeys(x, r).forEach(b => { const k = a + "|" + b; cell.set(k, (cell.get(k) || 0) + .5); })));
  sh.section(title || cap(DIM[g].label) + " × " + DIM[x].label + " (ore)");
  const body = rl.map(([k, t]) => [DIM[g].name(k), ...cl.map(c => cell.get(k + "|" + c) || null), t]);
  const colMap = new Map(groupBy(rows, x)), total = ["Totale", ...cl.map(c => colMap.get(c) || 0), tot];
  sh.table([cap(DIM[g].label) + " \\ " + DIM[x].label, ...cl.map(c => DIM[x].name(c)), "Totale"], body, total, ["t", ...cl.map(() => "h"), "h"]);
}
function detailTable(sh, rows, title, filter) {
  sh.section(title || "Dettaglio lavorazioni");
  const blocks = toBlocks(rows);
  const head = detHead(), total = head.map((h, i) => i === 0 ? "Totale" : h === "Ore" ? rows.length * .5 : "");
  sh.table(head, blocks.map(blockRow), total, detFmt(), filter);
}
function safeSheetName(name, used) {
  let n = String(name).replace(/[\[\]:*?\/\\]/g, "-").trim() || "Foglio";
  if (n.length > 31) n = n.slice(0, 30).trim() + "…";
  let base = n, i = 2; while (used.has(n.toLowerCase())) { const suf = " (" + i++ + ")"; n = base.slice(0, 31 - suf.length) + suf; }
  used.add(n.toLowerCase()); return n;
}

/* 1) Esattamente quello che si vede a schermo */
function buildViewWorkbook(X, rows) {
  const g = $("fGroup").value, x = $("fCross").value;
  const sh = new Sheet("Vista");
  headerBlock(sh, "Resoconto ore InPhoto Studio — vista a schermo", rows);
  sh.row(["Raggruppato per " + DIM[g].label + (x && x !== g ? ", incrociato con " + DIM[x].label : "")], "sub"); sh.gap();
  groupTable(sh, rows, g);
  if (x && x !== g && rows.length) matrixTable(sh, rows, g, x);
  detailTable(sh, rows, null, false);
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, sh.build(X), "Vista"); return wb;
}

/* 2) Resoconto completo: riepilogo, incroci, dettaglio, un foglio per persona e uno per progetto */
function buildFullWorkbook(X, rows) {
  const wb = X.utils.book_new(), used = new Set(), add = sh => X.utils.book_append_sheet(wb, sh.build(X), safeSheetName(sh.name, used));
  const tot = rows.length * .5;

  const r0 = new Sheet("Riepilogo");
  headerBlock(r0, "Resoconto completo ore InPhoto Studio", rows);
  groupTable(r0, rows, "user"); groupTable(r0, rows, "client"); groupTable(r0, rows, "project");
  if (rows.some(r => r.subproject_id)) groupTable(r0, rows, "sub", "Ore per progetto e sottoprogetto");
  if (S.kindOn) groupTable(r0, rows, "kind");
  if (S.typesOn && S.types.length) groupTable(r0, rows, "type");
  add(r0);

  if (rows.length) {
    const m1 = new Sheet("Persone x progetti"); matrixTable(m1, rows, "project", "user", "Ore per progetto e persona"); matrixTable(m1, rows, "client", "user", "Ore per cliente e persona");
    if (S.typesOn && S.types.length) matrixTable(m1, rows, "type", "user", "Ore per tipologia e persona"); add(m1);
    const m2 = new Sheet("Giorni x persone"); matrixTable(m2, rows, "day", "user", "Ore per giorno e persona"); matrixTable(m2, rows, "week", "user", "Ore per settimana e persona"); add(m2);
  }
  const det = new Sheet("Dettaglio"); detailTable(det, rows, "Tutte le lavorazioni (usa i filtri delle colonne)", true); add(det);

  // un foglio per ogni persona
  groupBy(rows, "user").forEach(([uid, h]) => {
    const rr = rows.filter(r => r.user_id === uid), sh = new Sheet(personName(uid));
    sh.row([personName(uid)], "title"); sh.row([fmtDate($("fFrom").value) + " – " + fmtDate($("fTo").value) + " · " + fmtH(h) + " · " + Math.round(pct(h, tot) * 100) + "% del totale"], "sub"); sh.gap();
    groupTable(sh, rr, "project", "Ore per progetto"); groupTable(sh, rr, "day", "Ore per giorno");
    detailTable(sh, rr, "Dettaglio", true); add(sh);
  });
  // un foglio per ogni progetto (le ore sul cliente senza progetto vanno in "Cliente · generale")
  groupBy(rows, "project").forEach(([k, h]) => {
    const rr = rows.filter(r => projKey(r) === k), name = DIM.project.name(k);
    const short = k === "c0" ? "Senza cliente" : k[0] === "p" ? projectName(Number(k.slice(1))) + " · " + clientName(projectById(Number(k.slice(1)))?.client_id) : clientName(Number(k.slice(1))) + " · generale";
    const sh = new Sheet(short);
    sh.row([name], "title"); sh.row([fmtDate($("fFrom").value) + " – " + fmtDate($("fTo").value) + " · " + fmtH(h) + " · " + Math.round(pct(h, tot) * 100) + "% del totale"], "sub"); sh.gap();
    if (rr.some(r => r.subproject_id)) groupTable(sh, rr, "sub", "Ore per sottoprogetto");
    groupTable(sh, rr, "user", "Ore per persona"); groupTable(sh, rr, "day", "Ore per giorno");
    detailTable(sh, rr, "Dettaglio", true); add(sh);
  });
  return wb;
}

async function exportExcel(kind) {
  const btn = $(kind === "full" ? "exportFull" : "exportXlsx"); btn.disabled = true; const old = btn.textContent; btn.textContent = "Preparo il file…";
  try {
    await loadXlsx();
    const X = window.XLSX, rows = filteredRows();
    if (!rows.length) throw new Error("Non ci sono ore da esportare con questi filtri.");
    const wb = kind === "full" ? buildFullWorkbook(X, rows) : buildViewWorkbook(X, rows);
    X.writeFile(wb, (kind === "full" ? "resoconto-completo_" : "resoconto-vista_") + $("fFrom").value + "_" + $("fTo").value + ".xlsx");
    toast("File Excel scaricato");
  } catch (e) { toast(e.message || "Esportazione non riuscita"); }
  btn.disabled = false; btn.textContent = old;
}

/* ================= Impostazioni ================= */
function showSub(name) {
  document.querySelectorAll(".subtabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.sub === name));
  ["cp", "team", "acc"].forEach(n => $("sub-" + n).hidden = n !== name);
  if (name === "cp") { renderClients(); renderTypes(); }
  if (name === "team") renderTeam();
  if (name === "acc") renderAccount();
}
document.querySelectorAll(".subtabs button").forEach(b => b.onclick = () => showSub(b.dataset.sub));

/* ---------- Clienti e progetti ---------- */
function renderClients() {
  $("cpNote").textContent = isAdmin()
    ? "Tutti possono aggiungere, rinominare e archiviare clienti, progetti e sottoprogetti: gli archiviati spariscono dai menu ma restano nei resoconti. Solo tu puoi eliminarli, e solo se non sono mai stati usati."
    : "Puoi aggiungere, rinominare e archiviare clienti, progetti e sottoprogetti. Gli archiviati spariscono dai menu ma restano nei resoconti.";
  const showArch = $("showArchived").checked, box = $("clist"); box.innerHTML = "";
  const list = S.clients.filter(c => showArch || !c.archived);
  if (!list.length) { box.innerHTML = '<div class="empty">Ancora nessun cliente. Scrivi un nome qui sopra e premi “Aggiungi cliente”.</div>'; return; }
  list.forEach(c => {
    const el = document.createElement("div"); el.className = "client" + (c.archived ? " arch" : ""); el.style.setProperty("--chip", chip(c.id));
    const head = document.createElement("div"); head.className = "chead";
    const nm = document.createElement("span"); nm.className = "cname"; nm.textContent = c.name;
    if (c.archived) nm.insertAdjacentHTML("beforeend", ' <span class="tag">archiviato</span>');
    head.appendChild(nm);
    head.appendChild(itemActs("clients", c));
    if (S.kindOn) {
      const kp = kindPicker(c.kind, async k => {
        const { error } = await sb.from("clients").update({ kind: k }).eq("id", c.id);
        if (error) { toast("Non sono riuscito a salvare il tipo"); return false; }
        c.kind = k; setTimeout(renderClients); return true;
      });
      if (!c.kind) kp.classList.add("need");
      const wrap = document.createElement("div"); wrap.className = "kline";
      wrap.innerHTML = '<span class="ty-l' + (c.kind ? "" : " warn") + '">' + (c.kind ? "Tipo" : "Indica il tipo") + "</span>";
      wrap.appendChild(kp); el._kline = wrap;
    }
    el.appendChild(head);
    if (el._kline) el.appendChild(el._kline);
    const pl = document.createElement("div"); pl.className = "plist";
    S.projects.filter(p => p.client_id === c.id && (showArch || !p.archived)).forEach(p => {
      const r = document.createElement("div"); r.className = "prow" + (p.archived ? " arch" : "");
      const pn = document.createElement("span"); pn.className = "pn"; pn.textContent = p.name;
      if (p.archived) pn.insertAdjacentHTML("beforeend", ' <span class="tag">archiviato</span>');
      const acts = itemActs("projects", p);
      if (S.subOn && !p.archived) {
        const add = document.createElement("button"); add.type = "button"; add.textContent = "+ Sottoprogetto";
        add.onclick = () => { const f = r.nextElementSibling?.classList.contains("addsub") ? r.nextElementSibling : null; if (f) { f.hidden = !f.hidden; if (!f.hidden) f.querySelector("input").focus(); } };
        acts.prepend(add);
      }
      r.appendChild(pn); r.appendChild(acts);
      if (S.typesOn && S.types.length) r.appendChild(typeChips(p.id));
      pl.appendChild(r);
      if (!S.subOn) return;
      // sottoprogetti: si vedono solo se ce ne sono
      if (!p.archived) {
        const f = document.createElement("form"); f.className = "addproj addsub"; f.hidden = true;
        f.innerHTML = '<input maxlength="80" placeholder="Nuovo sottoprogetto di ' + esc(p.name) + '" aria-label="Nuovo sottoprogetto di ' + esc(p.name) + '"><button class="btn" type="submit">Aggiungi</button>';
        f.onsubmit = async e => { e.preventDefault(); const v = f.querySelector("input").value.trim(); if (!v) return;
          try { await addSub(p.id, v); toast("Sottoprogetto aggiunto"); renderClients(); } catch (err) { toast(err.message); } };
        pl.appendChild(f);
      }
      S.subs.filter(x => x.project_id === p.id && (showArch || !x.archived)).forEach(x => {
        const sr = document.createElement("div"); sr.className = "prow subrow" + (x.archived ? " arch" : "");
        const sn = document.createElement("span"); sn.className = "pn"; sn.textContent = x.name;
        if (x.archived) sn.insertAdjacentHTML("beforeend", ' <span class="tag">archiviato</span>');
        sr.appendChild(sn); sr.appendChild(itemActs("subprojects", x));
        if (S.typesOn && S.types.length) {
          const tc = typeChips(x.id, () => setTimeout(renderClients), true);
          if (!subTypes(x.id).length) tc.insertAdjacentHTML("beforeend", '<span class="tinh">' + (projTypes(p.id).length ? "come il progetto: " + esc(typeLabel(p.id)) : "nessuna tipologia") + "</span>");
          sr.appendChild(tc);
        }
        pl.appendChild(sr);
      });
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
/* elenco delle tipologie (solo amministratore) */
function renderTypes() {
  const box = $("tlist"); if (!box) return; box.innerHTML = "";
  if (!S.typesOn) return;
  if (!S.types.length) { box.innerHTML = '<div class="note">Nessuna tipologia. Aggiungine una qui sopra.</div>'; return; }
  S.types.forEach(t => {
    const row = document.createElement("div"); row.className = "trow";
    const used = [...S.ptypes.values(), ...S.stypes.values()].filter(set => set.has(t.id)).length;
    const nm = document.createElement("span"); nm.className = "pn"; nm.textContent = t.name;
    nm.insertAdjacentHTML("beforeend", ' <span class="tag">' + used + (used === 1 ? " progetto" : " progetti") + "</span>");
    const a = document.createElement("span"); a.className = "acts";
    const ren = document.createElement("button"); ren.type = "button"; ren.textContent = "Rinomina";
    ren.onclick = () => {
      const inp = document.createElement("input"); inp.value = t.name; inp.maxLength = 40;
      inp.style.cssText = "border:1px solid var(--accent);border-radius:8px;height:36px;padding:0 10px;background:var(--bg);min-width:0;flex:1";
      nm.replaceWith(inp); inp.focus(); inp.select();
      const done = async ok => {
        const v = inp.value.trim();
        if (ok && v && v !== t.name) { const { error } = await sb.from("project_types").update({ name: v }).eq("id", t.id);
          if (error) toast(error.code === "23505" ? "Esiste già una tipologia con questo nome" : "Non sono riuscito a rinominare"); else t.name = v; }
        renderTypes(); renderClients();
      };
      inp.onkeydown = e => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); };
      inp.onblur = () => done(true);
    };
    const del = document.createElement("button"); del.type = "button"; del.className = "del"; del.textContent = "Elimina";
    del.onclick = async () => {
      if (!del.classList.contains("confirm")) { del.classList.add("confirm"); del.textContent = used ? "Conferma: la tolgo da " + used + (used === 1 ? " progetto" : " progetti") : "Conferma"; setTimeout(() => { del.classList.remove("confirm"); del.textContent = "Elimina"; }, 4000); return; }
      const { error } = await sb.from("project_types").delete().eq("id", t.id);
      if (error) return toast("Eliminazione non riuscita");
      S.types = S.types.filter(x => x.id !== t.id); S.ptypes.forEach(set => set.delete(t.id)); S.stypes.forEach(set => set.delete(t.id));
      renderTypes(); renderClients(); toast("Tipologia eliminata");
    };
    a.append(ren, del); row.append(nm, a); box.appendChild(row);
  });
}
function itemActs(table, item) {
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
    if (error) return toast(error.code === "23503" ? "È già usato in alcune fasce o contiene progetti o sottoprogetti: archivialo invece di eliminarlo." : "Eliminazione non riuscita");
    if (table === "clients") S.clients = S.clients.filter(x => x.id !== item.id);
    else if (table === "subprojects") S.subs = S.subs.filter(x => x.id !== item.id);
    else S.projects = S.projects.filter(x => x.id !== item.id);
    renderClients(); toast("Eliminato");
  };
  a.append(ren, arc); if (isAdmin()) a.append(del); return a;
}
$("showArchived").onchange = renderClients;
function resetNewKind() { const k = kindPicker(""); $("newKind").replaceChildren(...k.childNodes); $("newKind").dataset.v = "";
  $("newKind").querySelectorAll("button").forEach(b => b.onclick = () => { $("newKind").dataset.v = b.textContent === "Privato" ? "privato" : "commerciale"; $("newKind").classList.remove("need"); $("newKind").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false")); }); }
resetNewKind();
$("addTypeForm").addEventListener("submit", async e => {
  e.preventDefault(); const v = $("newType").value.trim(); if (!v) return;
  const { data, error } = await sb.from("project_types").insert({ name: v, sort: (Math.max(0, ...S.types.map(t => t.sort || 0)) + 1) }).select().single();
  if (error) return toast(error.code === "23505" ? "Esiste già una tipologia con questo nome" : "Non sono riuscito ad aggiungere la tipologia");
  S.types.push(data); $("newType").value = ""; renderTypes(); renderClients(); toast("Tipologia aggiunta");
});
$("addClientForm").addEventListener("submit", async e => {
  e.preventDefault(); const v = $("newClient").value.trim(); if (!v) return;
  const kind = $("newKind").dataset.v;
  if (S.kindOn && !kind) { $("newKind").classList.add("need"); return toast("Indica se il cliente è commerciale o privato"); }
  try { await addClient(v, kind); $("newClient").value = ""; resetNewKind(); renderClients(); toast("Cliente aggiunto"); } catch (err) { toast(err.message); }
});

/* ---------- Team ---------- */
async function renderTeam() {
  const { data } = await sb.from("profiles").select("*").order("full_name");
  if (data) S.profiles = data;
  const box = $("ulist"); box.innerHTML = "";
  S.profiles.filter(p => !p.deleted_at).forEach(p => {
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
    const del = document.createElement("button"); del.textContent = "Elimina"; del.className = "del";
    del.title = "Cancella l'account. Le sue ore restano nei resoconti con il suo nome.";
    del.onclick = async () => {
      if (!del.classList.contains("confirm")) {
        del.classList.add("confirm"); del.textContent = "Conferma: elimina " + p.full_name;
        setTimeout(() => { del.classList.remove("confirm"); del.textContent = "Elimina"; }, 4000); return;
      }
      try { await callAdmin("delete", { id: p.id }); toast("Account eliminato. Le ore restano nei resoconti."); renderTeam(); R.ready && fillFilterSelects(); }
      catch (e) { toast(e.message); }
    };
    if (p.id === S.me.id) a.append(pw); else a.append(pw, role, act, del);
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

/* altezza della testata fissa, per far fermare la data subito sotto */
const topbar = document.querySelector(".topbar");
const setTopbarH = () => document.documentElement.style.setProperty("--topbar-h", (getComputedStyle(topbar).position === "sticky" ? topbar.offsetHeight : 0) + "px");
if (window.ResizeObserver) new ResizeObserver(setTopbarH).observe(topbar); addEventListener("resize", setTopbarH);

if ("serviceWorker" in navigator && location.protocol === "https:") addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

start();
})();
