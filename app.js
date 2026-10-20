// Settle Up — shared bill splitting. Static app (GitHub Pages) + Firebase (Auth + Firestore) for live sync.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, initializeFirestore, deleteField, persistentLocalCache, persistentMultipleTabManager, doc, collection, setDoc, addDoc, deleteDoc, updateDoc, getDoc, getDocs, onSnapshot,
  serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { t, setLang, applyStatic, lang, locale } from "./i18n.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { } },
  del(k) { try { localStorage.removeItem(k) } catch { } }
};
const session = {
  get(k) { try { return sessionStorage.getItem(k) } catch { return null } },
  set(k, v) { try { sessionStorage.setItem(k, v) } catch { } }
};
const ICON = {
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 4a4 4 0 0 1 0 8M22 21v-1a6 6 0 0 0-4-5.6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg>',
  money: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 16 0v1"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>',
  wa: '<svg viewBox="0 0 24 24"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1.2-1.2 1.8.8-.4 1.6c-3.6.4-7.7-3.7-7.3-7.3l1.6-.4.8 1.8z"/></svg>',
  signal: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.5-1.2A9 9 0 1 0 12 3z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  more: '<svg viewBox="0 0 24 24"><path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  google: '<svg viewBox="0 0 24 24"><path d="M20 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.5a3.9 3.9 0 0 1-1.7 2.5v2h2.7c1.6-1.4 2.5-3.6 2.5-6.1z"/><path d="M12 20.5c2.3 0 4.2-.8 5.5-2.1l-2.7-2a5 5 0 0 1-7.5-2.7H4.5v2.1A8.5 8.5 0 0 0 12 20.5zM7.3 13.7a5 5 0 0 1 0-3.4V8.2H4.5a8.5 8.5 0 0 0 0 7.6zM12 6.9c1.3 0 2.5.5 3.4 1.3l2.5-2.5A8.5 8.5 0 0 0 4.5 8.2l2.8 2.1A5 5 0 0 1 12 6.9z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
};

// ---------- state ----------
let S = blankGroup(null);
let unsubs = [];
let db, auth, uid = null, account = null;
let forceJoin = false, migrating = false, tab = "home", actFilter = "all";
function blankGroup(id) { return { id, name: "", currency: "USD", legacy: false, hasAdminFlag: false, people: [], peopleDocs: [], expenses: [], loaded: { people: false } } }

const me = () => S.peopleDocs.find(p => p.uid && p.uid === uid) || null;
const amAdmin = () => { const m = me(); return !!m && m.role === "admin" };
const canEditGroup = () => amAdmin() || (S.legacy && !!me());
const canDeleteGroup = () => amAdmin() || (S.legacy && !!me());
const noAdmin = () => !S.peopleDocs.some(p => p.role === "admin");

// ---------- currencies ----------
const COMMON = ["USD", "EUR", "GBP", "JPY", "CNY", "HKD", "TWD", "KRW", "SGD", "MYR", "THB", "IDR", "PHP", "VND", "INR", "AUD", "NZD", "CAD", "CHF", "AED"];
const FALLBACK = ["AED", "ARS", "AUD", "BDT", "BGN", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "CZK", "DKK", "EGP", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KES", "KRW", "KHR", "LKR", "MAD", "MXN", "MYR", "NGN", "NOK", "NPR", "NZD", "PEN", "PHP", "PKR", "PLN", "QAR", "RON", "RSD", "RUB", "SAR", "SEK", "SGD", "THB", "TRY", "TWD", "UAH", "USD", "VND", "ZAR"];
const ALL = (() => { try { return Intl.supportedValuesOf("currency") } catch { return FALLBACK } })();
const curName = c => { try { return new Intl.DisplayNames([locale()], { type: "currency" }).of(c) || c } catch { return c } };
const digitsCache = {};
function digits(c) {
  if (digitsCache[c] === undefined) {
    try { digitsCache[c] = new Intl.NumberFormat("en", { style: "currency", currency: c }).resolvedOptions().maximumFractionDigits }
    catch { digitsCache[c] = 2 }
  }
  return digitsCache[c];
}
const unit = c => 10 ** digits(c);
function fmtMinor(minor, c = S.currency) { return fmtAmount(minor / unit(c), c) }
function fmtAmount(amt, c) {
  try { return new Intl.NumberFormat(locale(), { style: "currency", currency: c }).format(amt) }
  catch { return amt.toFixed(digits(c)) + " " + c }
}
function currencyOptions() {
  const opt = c => `<option value="${c}">${c} · ${esc(curName(c))}</option>`;
  const common = COMMON.filter(c => ALL.includes(c));
  return `<optgroup label="${t("common")}">${common.map(opt).join("")}</optgroup><optgroup label="${t("allCurrencies")}">${ALL.filter(c => !common.includes(c)).map(opt).join("")}</optgroup>`;
}
function fillCurrencySelect(sel, value) { sel.innerHTML = currencyOptions(); sel.value = value || "USD" }
function fillAllCurrencySelects() { document.querySelectorAll(".currency-select").forEach(s => fillCurrencySelect(s, s.value)) }

// ---------- exchange rates ----------
const rateCache = {};
async function fetchRate(from, to) {
  if (!rateCache[from]) {
    rateCache[from] = fetch(`https://open.er-api.com/v6/latest/${from}`).then(r => r.json()).then(j => {
      if (j.result !== "success") throw new Error("rate");
      return j;
    });
  }
  try {
    const j = await rateCache[from];
    const rate = j.rates[to];
    if (!rate) throw new Error("missing");
    return { rate, updated: j.time_last_update_unix * 1000 };
  } catch (e) { delete rateCache[from]; throw e }
}
const niceRate = r => Number(r.toPrecision(6));

// ---------- settle-up math (all in home-currency minor units) ----------
export function shares(cents, people) {
  const n = people.length, b = Math.floor(cents / n); let r = cents - b * n;
  return people.map(p => [p, b + (r-- > 0 ? 1 : 0)]);
}
// What each person owes for one expense: exact amounts when set, otherwise an equal split
export function expShares(e) {
  if (e.splitAmounts && typeof e.splitAmounts === "object") return Object.entries(e.splitAmounts).filter(([, c]) => c > 0);
  return shares(e.cents, e.split);
}
export function balances(people, expenses) {
  const b = Object.fromEntries(people.map(p => [p, 0]));
  for (const e of expenses) {
    if (b[e.payer] !== undefined) b[e.payer] += e.cents;
    for (const [p, c] of expShares(e)) if (b[p] !== undefined) b[p] -= c;
  }
  return b;
}
export function settle(b) {
  const cr = [], dr = [];
  for (const [p, v] of Object.entries(b)) { if (v > 0) cr.push([p, v]); else if (v < 0) dr.push([p, -v]) }
  cr.sort((a, c) => c[1] - a[1]); dr.sort((a, c) => c[1] - a[1]);
  const out = []; let i = 0, j = 0;
  while (i < dr.length && j < cr.length) {
    const a = Math.min(dr[i][1], cr[j][1]);
    out.push({ from: dr[i][0], to: cr[j][0], cents: a });
    dr[i][1] -= a; cr[j][1] -= a; if (!dr[i][1]) i++; if (!cr[j][1]) j++;
  }
  return out;
}

// ---------- UI helpers ----------
function status(msg, warn) { $("statusBanner").hidden = !msg; $("statusText").textContent = msg || "" }
let toastT;
function toast(msg) { const el = $("toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2200) }
async function act(fn) {
  try { const r = await fn(); status(""); return r ?? true }
  catch (e) { console.error(e); status(t("saveFail"), true); return false }
}
let loadingT;
function showLoading() {
  clearTimeout(loadingT);
  // Only show the spinner if loading takes a moment, so cached groups open without a flash
  loadingT = setTimeout(() => { if (S.id && !S.loaded.people) show("loading") }, 150);
}
function show(view) {
  if (view !== "loading") clearTimeout(loadingT);
  $("loadingView").hidden = view !== "loading";
  const inGroup = view === "group";
  document.body.classList.toggle("in-group", inGroup);
  $("startView").hidden = view !== "start";
  $("joinView").hidden = view !== "join";
  $("homeView").hidden = !(inGroup && tab === "home");
  $("activityView").hidden = !(inGroup && tab === "activity");
  $("dock").hidden = !inGroup;
  $("tabBtnHome").classList.toggle("on", tab === "home");
  $("tabBtnAct").classList.toggle("on", tab === "activity");
}
const groupLink = () => location.href.split("#")[0].split("?")[0] + "#" + S.id;
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return true }
  catch { prompt(t("copyPrompt"), text); return false }
}

// ---------- sheets ----------
let sheetName = null, sheetRender = null;
// Each open sheet adds a history entry, so Android's back gesture (and browser back) closes the sheet first
let sheetPushed = false;
function openSheet(name, renderFn) {
  if (!sheetName && !sheetPushed) { history.pushState({ sheet: 1 }, ""); sheetPushed = true }
  if (sheetName === "add" && name !== "add") { const f = $("expForm"); if (f) $("addHolder").appendChild(f) }
  sheetName = name; sheetRender = renderFn;
  $("sheet").classList.toggle("full", name === "add");
  $("sheetWrap").hidden = false; document.body.classList.add("sheet-open");
  renderFn($("sheet"));
}
function hideSheet() {
  sheetName = null; sheetRender = null; $("sheetWrap").hidden = true;
  const f = $("expForm"); if (f && f.parentElement !== $("addHolder")) $("addHolder").appendChild(f);
  $("sheet").innerHTML = ""; $("sheet").classList.remove("full"); document.body.classList.remove("sheet-open");
}
function closeSheet() {
  if (!sheetName && !sheetPushed) return;
  hideSheet();
  if (sheetPushed) { sheetPushed = false; history.back() }
}
// Go somewhere from inside a sheet: replace the sheet's history entry instead of stacking a new one
function navTo(hash) {
  if (sheetName) hideSheet();
  if (sheetPushed) { sheetPushed = false; location.replace(location.pathname + location.search + (hash ? "#" + hash : "#")) }
  else location.hash = hash;
}
window.addEventListener("popstate", () => { if (sheetPushed || sheetName) { sheetPushed = false; hideSheet() } });
function refreshSheet() { if (sheetRender) sheetRender($("sheet")) }
$("sheetWrap").addEventListener("click", e => { if (e.target === $("sheetWrap")) closeSheet() });
document.addEventListener("keydown", e => { if (e.key === "Escape" && sheetName) closeSheet() });
const sheetHead = title => `<div class="sheet-head"><h2>${esc(title)}</h2><button class="link" data-close type="button">${t("close")}</button></div>`;
function wireClose(el) { el.querySelectorAll("[data-close]").forEach(b => b.onclick = closeSheet) }

// ---------- per-user group list ----------
const userGroupsCol = u => collection(db, "users", u, "groups");
async function indexGroup(personId) {
  if (!uid || !S.id) return;
  const key = `${uid}|${S.id}|${personId}|${S.name}`;
  if (indexGroup.last === key) return;
  indexGroup.last = key;
  try { await setDoc(doc(userGroupsCol(uid), S.id), { name: S.name, personId, openedAt: Date.now() }) } catch (e) { console.warn(e) }
}
async function myGroups(u = uid) {
  try { return (await getDocs(userGroupsCol(u))).docs.map(d => ({ id: d.id, ...d.data() })) } catch { return [] }
}
async function allMyGroups() {
  const local = store.get("settleup.recent", []);
  const remote = await myGroups();
  const seen = new Set(), list = [];
  for (const g of [...remote.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)), ...local]) {
    if (!seen.has(g.id)) { seen.add(g.id); list.push(g) }
  }
  return list;
}
function forgetGroup(gid) {
  store.set("settleup.recent", store.get("settleup.recent", []).filter(g => g.id !== gid));
  if (store.get("settleup.last", null) === gid) store.del("settleup.last");
}

// ---------- routing ----------
const groupIdFromHash = () => (location.hash.match(/^#([A-Za-z0-9]{16,40})$/) || [])[1] || null;
window.addEventListener("hashchange", route);
function goHome() { session.set("settleup.stayHome", "1"); navTo("") }

function route() {
  if (!uid) return;
  unsubs.forEach(u => u()); unsubs = [];
  forceJoin = false; selectedPerson = null;
  if (sheetName && sheetName !== "signin") { sheetPushed = false; hideSheet() }
  const gid = groupIdFromHash();
  if (!gid) {
    const last = store.get("settleup.last", null);
    if (last && !session.get("settleup.stayHome")) { location.replace("#" + last); return }
    return showStart();
  }
  store.set("settleup.last", gid);
  openGroup(gid);
}

async function showStart() {
  S = blankGroup(null);
  show("start");
  document.title = "Settle Up";
  renderAccount();
  const list = await allMyGroups();
  if (S.id) return;
  $("groupsCard").hidden = !list.length;
  $("groupSel").innerHTML = list.map(g => `<option value="${esc(g.id)}">${esc(g.name || t("groupFallback"))}</option>`).join("");
  if (!list.length) $("createForm").hidden = false;
  $("newGroupBtn").hidden = !list.length;
}
$("openGroupBtn").onclick = () => { const id = $("groupSel").value; if (id) location.hash = id };
$("newGroupBtn").onclick = () => { $("createForm").hidden = !$("createForm").hidden; if (!$("createForm").hidden) $("groupName").focus() };
function rememberGroup() {
  const recent = store.get("settleup.recent", []).filter(g => g.id !== S.id);
  recent.unshift({ id: S.id, name: S.name });
  store.set("settleup.recent", recent.slice(0, 20));
}

// ---------- accounts ----------
function renderAccount() {
  $("acctBtn").textContent = account ? t("accountShort") : t("signInShort");
  $("acctNote").innerHTML = account
    ? esc(t("signedInNote", { email: account.email || account.displayName || t("acctFallback") }))
    : `${esc(t("notSignedInNote"))} <button class="link" type="button" id="acctNoteBtn">${esc(t("signInShort"))}</button>`;
  const b = $("acctNoteBtn"); if (b) b.onclick = openSignIn;
  if (sheetName === "signin") refreshSheet();
}
$("acctBtn").onclick = () => openSignIn();

let signinState = { mode: "choose", err: "" };   // choose | email | sent | finish
let pendingLink = null;
function openSignIn(mode) {
  signinState = { mode: mode || "choose", err: "" };
  openSheet("signin", el => {
    if (account) {
      el.innerHTML = `${sheetHead(t("accountRow"))}
        <p style="margin:0">${esc(t("signedInAs"))} <strong>${esc(account.email || account.displayName || t("acctFallback"))}</strong></p>
        <p class="hint">${esc(t("savedToAccount"))}</p>
        <button class="btn ghost wide" id="signOutBtn" type="button">${esc(t("signOut"))}</button>`;
      wireClose(el);
      $("signOutBtn").onclick = async () => { store.del("settleup.last"); store.del("settleup.recent"); closeSheet(); await signOut(auth) };
      return;
    }
    const m = signinState.mode;
    el.innerHTML = `${sheetHead(m === "finish" ? t("finishSignIn") : t("keepGroups"))}
      ${m === "choose" ? `<p class="hint">${esc(t("keepGroupsHint"))}</p>
        <button class="btn ghost wide" id="googleBtn" type="button">${ICON.google} ${esc(t("google"))}</button>
        <button class="btn ghost wide" id="emailBtn" type="button">${ICON.mail} ${esc(t("emailMe"))}</button>
        <button class="link" data-close type="button" style="align-self:center">${esc(t("notNow"))}</button>` : ""}
      ${m === "email" ? `<form id="emailForm" class="inline" novalidate><input id="emailInput" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com"><button class="btn primary" type="submit">${esc(t("sendLink"))}</button></form>` : ""}
      ${m === "sent" ? `<p class="hint">${esc(t("emailSent", { email: store.get("settleup.signinEmail", "") }))}</p>
        <label class="field"><span>${esc(t("pasteHint"))}</span><span class="inline"><input id="pasteLink" placeholder="${esc(t("pastePh"))}" autocomplete="off"><button class="btn primary" id="pasteBtn" type="button">${esc(t("signIn"))}</button></span></label>` : ""}
      ${m === "finish" ? `<p class="hint">${esc(t("finishHint"))}</p>
        <form id="finishForm" class="inline" novalidate><input id="finishEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com"><button class="btn primary" type="submit">${esc(t("signIn"))}</button></form>` : ""}
      <p class="err" id="acctErr">${esc(signinState.err)}</p>`;
    wireClose(el);
    const err = msg => { signinState.err = msg; $("acctErr").textContent = msg };
    if (m === "choose") {
      $("googleBtn").onclick = () => signInWith(() => signInWithPopup(auth, new GoogleAuthProvider())).then(closeSheet).catch(e => {
        console.error(e); if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") err(t("googleFail"));
      });
      $("emailBtn").onclick = () => { signinState.mode = "email"; refreshSheet(); $("emailInput").focus() };
    }
    if (m === "email") $("emailForm").onsubmit = async e => {
      e.preventDefault();
      const email = $("emailInput").value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(t("invalidEmail"));
      try {
        await sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname + "?signin=1", handleCodeInApp: true });
        store.set("settleup.signinEmail", email);
        signinState = { mode: "sent", err: "" }; refreshSheet();
      } catch (x) { console.error(x); err(t("emailFail")) }
    };
    if (m === "sent") $("pasteBtn").onclick = () => {
      const link = $("pasteLink").value.trim();
      if (!isSignInWithEmailLink(auth, link)) return err(t("notLink"));
      finishEmail(link);
    };
    if (m === "finish") $("finishForm").onsubmit = e => { e.preventDefault(); const em = $("finishEmail").value.trim(); if (em && pendingLink) finishEmail(pendingLink, em) };
  });
}
// Sign in with an account, then move this device's group names over to it
async function signInWith(doSignIn) {
  const oldUid = uid, oldGroups = await myGroups(oldUid);
  migrating = true;
  try {
    const cred = await doSignIn();
    if (cred.user.uid !== oldUid) await migrate(oldGroups, oldUid, cred.user.uid);
    toast(t("signedInToast"));
  } finally { migrating = false; uid = auth.currentUser?.uid || uid; account = auth.currentUser && !auth.currentUser.isAnonymous ? auth.currentUser : null; renderAccount(); route() }
}
async function migrate(groups, oldUid, newUid) {
  for (const g of groups) {
    try {
      if (!g.personId) continue;
      const pref = doc(db, "groups", g.id, "people", g.personId);
      const p = await getDoc(pref);
      if (!p.exists() || p.data().uid !== oldUid) continue;
      const b = writeBatch(db);
      b.update(pref, { uid: newUid });
      b.set(doc(db, "groups", g.id, "members", newUid), { personId: g.personId });
      b.set(doc(userGroupsCol(newUid), g.id), { name: g.name || "", personId: g.personId, openedAt: Date.now() });
      await b.commit();
    } catch (e) { console.warn("migrate", g.id, e) }
  }
}
async function finishEmail(link, email = store.get("settleup.signinEmail", "")) {
  if (!email) { pendingLink = link; openSignIn("finish"); return }
  try {
    await signInWith(() => signInWithEmailLink(auth, email, link));
    store.del("settleup.signinEmail"); closeSheet();
  } catch (e) {
    console.error(e);
    signinState.err = e.code === "auth/invalid-action-code" ? t("linkExpired") : t("linkFail");
    if (!sheetName) openSignIn(signinState.mode); else refreshSheet();
  }
}

// ---------- create group ----------
$("createForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("groupName").value.trim(), founder = $("founderName").value.trim(), currency = $("newCurrency").value;
  const err = $("createErr");
  if (!name) return err.textContent = t("errGroupName");
  if (!founder) return err.textContent = t("errFounder");
  err.textContent = "";
  try {
    const gref = doc(collection(db, "groups"));
    const pref = doc(collection(gref, "people"));
    const b = writeBatch(db);
    b.set(gref, { name, currency, createdAt: serverTimestamp(), createdBy: uid, hasAdmin: true });
    b.set(pref, { name: founder, uid, role: "admin", createdAt: Date.now() });
    b.set(doc(gref, "members", uid), { personId: pref.id });
    b.set(doc(userGroupsCol(uid), gref.id), { name, personId: pref.id, openedAt: Date.now() });
    // Show the new group straight away; live updates start once the server has saved it
    const saving = b.commit();
    pendingGroups[gref.id] = {
      saving,
      initial: { name, currency, legacy: false, hasAdminFlag: true, peopleDocs: [{ id: pref.id, name: founder, uid, role: "admin", createdAt: Date.now() }] },
    };
    saving.catch(e3 => { console.error(e3); delete pendingGroups[gref.id]; forgetGroup(gref.id); goHome(); status(t("createFail"), true) });
    $("groupName").value = ""; $("founderName").value = ""; $("createForm").hidden = true;
    tab = "home";
    location.hash = gref.id;
    setTimeout(() => toast(t("createdToast")), 300);
  } catch (e2) { console.error(e2); err.textContent = t("createFail") }
});

// ---------- open group (live) ----------
const pendingGroups = {};   // groups created on this phone that the server is still saving
async function openGroup(gid) {
  S = blankGroup(gid);
  S.loaded.group = false;
  const pending = pendingGroups[gid];
  if (pending) {
    // Fill in what we already know so the screen appears instantly
    Object.assign(S, pending.initial, { people: pending.initial.peopleDocs.map(p => p.name), expenses: [] });
    S.loaded = { people: true, group: true };
    document.title = S.name + " · Settle Up"; rememberGroup(); update();
    try { await pending.saving } catch { return }
    delete pendingGroups[gid];
    if (S.id !== gid) return;
  } else showLoading();
  subscribeGroup(gid, 0);
}

// Live listeners for one group. If the server refuses or drops a listener, retry quietly a few times
// before telling the person; a working snapshot clears any warning.
function subscribeGroup(gid, attempt) {
  unsubs.forEach(u => u()); unsubs = [];
  const gref = doc(db, "groups", gid);
  let failed = false;
  const onErr = e => {
    console.warn("listener", e.code || e);
    if (S.id !== gid || failed) return;
    failed = true;
    if (attempt < 4) setTimeout(() => { if (S.id === gid) subscribeGroup(gid, attempt + 1) }, 800 * (attempt + 1));
    else status(navigator.onLine === false ? t("offline") : t("syncFail"), true);
  };
  const ok = s => { if (!fromCache(s) && attempt > 0 && !$("statusBanner").hidden) status("") };
  const fromCache = s => !!(s.metadata && s.metadata.fromCache);
  // Snapshots come from the phone's cache first (instant), then from the server
  unsubs.push(onSnapshot(gref, { includeMetadataChanges: false }, s => {
    if (S.id !== gid) return;
    if (!s.exists()) {
      if (fromCache(s)) return;                       // not cached yet: wait for the server
      forgetGroup(gid); goHome();
      if (S.loaded.group) toast(t("deletedToast")); else status(t("badLink"), true);
      return;
    }
    ok(s);
    S.loaded.group = true;
    const d = s.data() || {}; S.name = d.name || t("groupFallback"); S.currency = d.currency || "USD"; S.legacy = !d.createdBy; S.hasAdminFlag = !!d.hasAdmin;
    document.title = S.name + " · Settle Up"; rememberGroup(); update();
  }, onErr));
  unsubs.push(onSnapshot(collection(gref, "people"), { includeMetadataChanges: false }, s => {
    if (S.id !== gid) return;
    if (s.empty && fromCache(s)) return;              // nothing cached yet: wait for the server
    ok(s);
    S.peopleDocs = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    S.people = S.peopleDocs.map(p => p.name); S.loaded.people = true; update();
  }, onErr));
  unsubs.push(onSnapshot(collection(gref, "expenses"), { includeMetadataChanges: false }, s => {
    if (S.id !== gid) return;
    ok(s);
    S.expenses = s.docs.map(d => ({ id: d.id, ...d.data() })); update();
  }, onErr));
}
// Coming back online: reconnect the group straight away
window.addEventListener("online", () => { if (S.id && !$("statusBanner").hidden) { status(""); subscribeGroup(S.id, 0) } });

function update() {
  if (!S.id || !S.loaded.people || S.loaded.group === false || migrating || deleting) return;
  const m = me();
  if (!m || forceJoin) { renderJoin(); show("join") }
  else { show("group"); render(); indexGroup(m.id) }
  if (["people", "settings", "share"].includes(sheetName)) refreshSheet();
}

// ---------- join ----------
let armed = null;
function renderJoin() {
  $("joinGroupName").textContent = S.name;
  const mine = me();
  $("joinBack").hidden = !mine;
  $("joinList").innerHTML = S.peopleDocs.length ? S.peopleDocs.map(p => {
    const isMe = mine && p.id === mine.id, claimed = !!p.uid && !isMe;
    const tag = isMe ? t("tagYou") : claimed ? (armed === p.id ? t("tagConfirm") : t("tagOther")) : t("tagJoin");
    return `<button type="button" class="join-btn${claimed ? " claimed" : ""}${armed === p.id ? " confirm" : ""}" data-claim="${esc(p.id)}" ${isMe ? "disabled" : ""}><span class="nm">${esc(p.name)}</span><span class="tag">${tag}</span></button>`;
  }).join("") : `<p class="hint">${t("noOneJoined")}</p>`;
  document.querySelectorAll("[data-claim]").forEach(b => b.onclick = () => {
    const p = S.peopleDocs.find(x => x.id === b.dataset.claim); if (!p) return;
    if (p.uid && armed !== p.id) { armed = p.id; renderJoin(); return }
    armed = null; joinAs(p.id, p.name);
  });
}
async function joinAs(pid, name, create = false) {
  const old = me();
  const ok = await act(async () => {
    const b = writeBatch(db);
    const people = collection(db, "groups", S.id, "people");
    if (old && old.id !== pid) b.update(doc(people, old.id), { uid: null });
    const pref = create ? doc(people) : doc(people, pid);
    if (create) b.set(pref, { name, uid, role: "member", createdAt: Date.now() });
    else b.update(pref, { uid });
    b.set(doc(db, "groups", S.id, "members", uid), { personId: pref.id });
    b.set(doc(userGroupsCol(uid), S.id), { name: S.name, personId: pref.id, openedAt: Date.now() });
    await b.commit();
  });
  if (ok) { forceJoin = false; toast(t("welcome", { name })); update() }
}
$("joinNewBtn").onclick = () => {
  const n = $("joinName").value.trim(), err = $("joinErr");
  if (!n) return err.textContent = t("errNameFirst");
  const existing = S.peopleDocs.find(p => p.name.toLowerCase() === n.toLowerCase());
  if (existing) return err.textContent = t("errExistsJoin", { name: existing.name });
  err.textContent = ""; $("joinName").value = "";
  joinAs(null, n, true);
};
$("joinName").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("joinNewBtn").click() } };
$("joinBack").onclick = () => { forceJoin = false; armed = null; update() };

// ---------- actions ----------
const gcol = name => collection(db, "groups", S.id, name);
const api = {
  addPerson: name => addDoc(gcol("people"), { name, uid: null, role: "member", createdAt: Date.now() }),
  removePerson: id => deleteDoc(doc(gcol("people"), id)),
  updatePerson: (id, data) => updateDoc(doc(gcol("people"), id), data),
  addExpense: e => { const m = me(); return addDoc(gcol("expenses"), { ...e, createdAt: Date.now(), addedBy: m.id, addedByName: m.name }) },
  deleteExpense: id => deleteDoc(doc(gcol("expenses"), id)),
  editExpense: (id, data) => updateDoc(doc(gcol("expenses"), id), data),
  updateGroup: data => updateDoc(doc(db, "groups", S.id), data),
};

// ---------- top bar ----------
$("switchBtn").onclick = () => openSheet("switch", async el => {
  el.innerHTML = `${sheetHead(t("switchGroup"))}<div class="menu" id="gList"><p class="hint">…</p></div>
    <button class="btn ghost wide" id="toHome" type="button">${esc(t("allGroupsNew"))}</button>`;
  wireClose(el);
  $("toHome").onclick = () => goHome();
  const list = await allMyGroups();
  if (sheetName !== "switch") return;
  $("gList").innerHTML = list.map(g => `<button class="mi" type="button" data-g="${esc(g.id)}">${g.id === S.id ? ICON.check : ICON.users}<span>${esc(g.name || t("groupFallback"))}</span>${g.id === S.id ? `<span class="side">${esc(t("current"))}</span>` : ""}</button>`).join("");
  $("gList").querySelectorAll("[data-g]").forEach(b => b.onclick = () => { if (b.dataset.g !== S.id) { tab = "home"; navTo(b.dataset.g) } else closeSheet() });
});
async function shareInvite() {
  const url = groupLink();
  if (navigator.share) { try { await navigator.share({ title: S.name, text: t("inviteText", { name: S.name, url: "" }).trim(), url }); return } catch (e) { if (e.name === "AbortError") return } }
  copyText(url, t("copied"));
}
$("inviteBtn").onclick = shareInvite;
$("menuBtn").onclick = openSettings;
document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; show("group"); window.scrollTo({ top: 0 }) });
$("seeAllBtn").onclick = () => { tab = "activity"; show("group"); window.scrollTo({ top: 0 }) };
$("filters").addEventListener("click", e => {
  const b = e.target.closest("[data-f]"); if (!b) return;
  actFilter = b.dataset.f;
  $("filters").querySelectorAll("[data-f]").forEach(x => x.classList.toggle("on", x === b));
  renderActivity();
});
$("plusBtn").onclick = openAdd;
$("emptyAdd").onclick = openAdd;
$("emptyInvite").onclick = () => shareInvite();
$("addClose").onclick = () => closeSheet();
let editingId = null, splitMode = "equal";
function resetForm() {
  $("amount").value = ""; $("desc").value = ""; $("expErr").textContent = "";
  $("splitOpts").innerHTML = ""; $("exactList").innerHTML = "";
  setSplitMode("equal");
}
function showForm() {
  openSheet("add", el => {
    if ($("expForm").parentElement !== el) { el.innerHTML = ""; el.appendChild($("expForm")) }
    renderSplit(); refreshFxLabels(); preview(); updateDescIcon(); formLabels();
  });
}
function formLabels() {
  const e = editingId && S.expenses.find(x => x.id === editingId);
  $("addTitle").textContent = editingId ? t("editExpense") : t("addExpenseTitle");
  $("saveBtn").textContent = editingId ? t("saveChanges") : t("addExpense");
  $("paidByVal").textContent = e ? (e.payer === me()?.name ? t("you") : e.payer) : t("you");
}
function openAdd() {
  if (!me()) return;
  if (editingId) { editingId = null; $("expCurrency").dataset.group = "" }   // start fresh after an edit
  resetForm();
  showForm();
  setTimeout(() => $("amount").focus(), 250);
}
function openEdit(id) {
  const e = S.expenses.find(x => x.id === id);
  if (!e || !me()) return;
  editingId = id;
  resetForm();
  const fxE = e.origCurrency && e.origCurrency !== S.currency;
  const cur = fxE ? e.origCurrency : S.currency;
  const sel = $("expCurrency"); sel.dataset.group = S.id; sel.value = cur;
  fx = { cur, rate: fxE ? e.rate : null, edited: true, req: fx.req + 1 };
  $("fxRate").value = fxE ? niceRate(e.rate) : ""; $("fxNote").textContent = "";
  const amt = fxE ? e.origAmount : e.cents / unit(S.currency);
  $("amount").value = amt.toFixed(digits(cur));
  $("desc").value = e.desc || "";
  // tick exactly the people in this expense
  $("splitOpts").innerHTML = S.people.map((p, i) => `<label class="sp"><input type="checkbox" id="sp${i}" value="${esc(p)}" ${e.split.includes(p) ? "checked" : ""}>${avatar(p, "xs")}${esc(p === me().name ? t("you") : p)}</label>`).join("");
  if (e.splitAmounts) {
    setSplitMode("exact");
    const orig = e.splitOrig || {};
    renderExact(Object.fromEntries(S.people.map(p => {
      const v = fxE ? (orig[p] ?? (e.splitAmounts[p] || 0) / unit(S.currency) / e.rate) : (e.splitAmounts[p] || 0) / unit(S.currency);
      return [p, v ? (+v).toFixed(digits(cur)) : ""];
    })));
  }
  showForm();
}
function setSplitMode(m) {
  splitMode = m;
  $("splitMode").querySelectorAll("[data-m]").forEach(b => b.classList.toggle("on", b.dataset.m === m));
  $("equalBox").hidden = m !== "equal"; $("exactBox").hidden = m !== "exact";
  if (m === "exact" && !$("exactList").children.length) renderExact();
  preview();
}
$("splitMode").addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (b) setSplitMode(b.dataset.m) });
// Exact-amount rows, keeping anything already typed
function renderExact(values) {
  const mine = me(); if (!mine) return;
  const prev = values || Object.fromEntries([...document.querySelectorAll("#exactList input")].map(i => [i.dataset.p, i.value]));
  $("exactList").innerHTML = S.people.map((p, i) => `<label class="ex-row">${avatar(p, "sm")}<span class="ex-name">${esc(p === mine.name ? t("you") : p)}</span><input id="ex${i}" data-p="${esc(p)}" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(prev[p] || "")}"></label>`).join("");
  $("exactList").querySelectorAll("input").forEach(i => i.oninput = preview);
}

// ---------- settings sheet ----------
function openSettings() {
  openSheet("settings", el => {
    const editGroup = canEditGroup();
    el.innerHTML = `${sheetHead(t("groupSettings"))}<div class="menu">
      <button class="mi" type="button" id="mInvite">${ICON.link}<span>${esc(t("copyInviteRow"))}</span></button>
      <button class="mi" type="button" id="mPeople">${ICON.users}<span>${esc(t("peopleAdmins"))}</span><span class="side">${S.people.length}</span></button>
      ${editGroup ? `<button class="mi" type="button" id="mRename">${ICON.edit}<span>${esc(t("rename"))}</span></button>` : ""}
      <button class="mi" type="button" id="mCurrency">${ICON.money}<span>${esc(t("homeCurrencyRow", { c: S.currency }))}</span></button>
      <div class="mi">${ICON.globe}<span>${esc(t("languageRow"))}</span><select id="mLang" aria-label="${esc(t("languageRow"))}"><option value="en">English</option><option value="zh-Hant">繁體中文</option></select></div>
      <button class="mi" type="button" id="mAcct">${ICON.user}<span>${esc(t("accountRow"))}</span><span class="side">${esc(account ? (account.email || t("acctFallback")) : t("signInShort"))}</span></button>
      <button class="mi" type="button" id="mSwitch">${ICON.swap}<span>${esc(t("switchName"))}</span></button>
      ${noAdmin() && !S.hasAdminFlag ? `<button class="mi" type="button" id="mBecome">${ICON.user}<span>${esc(t("becomeAdmin"))}<br><span class="hint">${esc(t("becomeAdminHint"))}</span></span></button>` : ""}
      ${canDeleteGroup() ? `<button class="mi danger" type="button" id="mDelete">${ICON.trash}<span>${esc(t("deleteGroup"))}</span><span class="side">${esc(t("adminsOnly"))}</span></button>` : ""}
    </div>`;
    wireClose(el);
    $("mInvite").onclick = () => { closeSheet(); copyText(groupLink(), t("copied")) };
    $("mPeople").onclick = openPeople;
    if ($("mRename")) $("mRename").onclick = openRename;
    $("mCurrency").onclick = openCurrency;
    $("mLang").value = lang;
    $("mLang").onchange = e => { setLang(e.target.value); applyLanguage(); refreshSheet() };
    $("mAcct").onclick = () => openSignIn();
    $("mSwitch").onclick = () => { closeSheet(); forceJoin = true; armed = null; update() };
    if ($("mBecome")) $("mBecome").onclick = becomeAdmin;
    if ($("mDelete")) $("mDelete").onclick = openDelete;
  });
}

function openRename() {
  openSheet("rename", el => {
    el.innerHTML = `${sheetHead(t("rename"))}
      <form id="renameForm" class="inline" novalidate><input id="renameInput" maxlength="60" value="${esc(S.name)}"><button class="btn primary" type="submit">${esc(t("save"))}</button></form>`;
    wireClose(el);
    $("renameForm").onsubmit = async e => {
      e.preventDefault();
      const n = $("renameInput").value.trim();
      if (n && n !== S.name) await act(() => api.updateGroup({ name: n }));
      closeSheet();
    };
  });
}

function openCurrency() {
  openSheet("currency", el => {
    const locked = S.expenses.length > 0, can = canEditGroup();
    el.innerHTML = `${sheetHead(t("homeCurrency"))}
      <select id="curSel" ${locked || !can ? "disabled" : ""}>${currencyOptions()}</select>
      <p class="hint">${esc(locked ? t("currencyLockedNote") : !can ? t("curAdminOnly") : t("homeCurrencyHint"))}</p>
      ${!locked && can ? `<button class="btn primary wide" id="curSave" type="button">${esc(t("save"))}</button>` : ""}`;
    wireClose(el);
    $("curSel").value = S.currency;
    if ($("curSave")) $("curSave").onclick = async () => {
      const c = $("curSel").value;
      if (c !== S.currency) { await act(() => api.updateGroup({ currency: c })); fx.cur = null; $("expCurrency").dataset.group = "" }
      closeSheet();
    };
  });
}

// ---------- people sheet ----------
let selectedPerson = null;
function openPeople() {
  openSheet("people", el => {
    const mine = me(); if (!mine) return closeSheet();
    const admin = amAdmin();
    const chips = S.peopleDocs.map(p => {
      const used = S.expenses.some(e => e.payer === p.name || e.split.includes(p.name));
      const rm = !admin && !p.uid && !used ? `<button type="button" class="x" data-rm="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button>` : "";
      const tag = p.id === mine.id ? t("youSuffix") : p.uid ? "" : t("invited");
      return `<span class="chip${admin ? " selectable" : ""}${selectedPerson === p.id ? " selected" : ""}" ${admin ? `data-sel="${esc(p.id)}" role="button" tabindex="0"` : ""}>${esc(p.name)}${p.role === "admin" ? ` <span class="badge">${t("admin")}</span>` : ""}<span class="tagtxt">${tag}</span>${rm}</span>`;
    }).join("");
    el.innerHTML = `${sheetHead(t("peopleAdmins"))}
      <div class="chips">${chips}</div>
      <div id="adminPanel" class="admin-panel" hidden></div>
      <p class="hint">${esc(admin ? t("peopleHintAdmin") : t("peopleHintMember"))}</p>
      <form class="inline" id="addPersonForm" novalidate><input id="newPerson" placeholder="${esc(t("addFriendPh"))}" maxlength="24" autocomplete="off"><button class="btn primary" type="submit">${esc(t("add"))}</button></form>
      <p class="err" id="personErr"></p>`;
    wireClose(el);
    el.querySelectorAll("[data-rm]").forEach(b => b.onclick = e => { e.stopPropagation(); act(() => api.removePerson(b.dataset.rm)) });
    el.querySelectorAll("[data-sel]").forEach(c => c.onclick = () => { selectedPerson = selectedPerson === c.dataset.sel ? null : c.dataset.sel; refreshSheet() });
    $("addPersonForm").onsubmit = e => {
      e.preventDefault();
      const n = $("newPerson").value.trim(), err = $("personErr");
      if (!n) return err.textContent = t("errNameFirst");
      if (S.people.some(p => p.toLowerCase() === n.toLowerCase())) return err.textContent = t("errOnList", { name: n });
      err.textContent = ""; $("newPerson").value = ""; act(() => api.addPerson(n));
    };
    renderAdminPanel();
  });
}
function renderAdminPanel() {
  const panel = $("adminPanel"); if (!panel) return;
  const p = S.peopleDocs.find(x => x.id === selectedPerson);
  if (!amAdmin() || !p) { panel.hidden = true; return }
  const mine = me(), isMe = p.id === mine.id;
  const used = S.expenses.some(e => e.payer === p.name || e.split.includes(p.name));
  const admins = S.peopleDocs.filter(x => x.role === "admin").length;
  const acts = [];
  if (p.role !== "admin") acts.push(`<button class="btn small ghost" data-adm="promote" type="button">${t("makeAdmin")}</button>`);
  else if (!(isMe && admins <= 1)) acts.push(`<button class="btn small ghost" data-adm="demote" type="button">${t("removeAdmin")}</button>`);
  if (p.uid && !isMe) acts.push(`<button class="btn small ghost" data-adm="unlink" type="button">${t("unlink")}</button>`);
  if (!used && !isMe) acts.push(`<button class="btn small ghost" data-adm="remove" type="button">${t("removeFromGroup")}</button>`);
  panel.hidden = false;
  panel.innerHTML = `<div><strong>${esc(p.name)}</strong> <span class="hint">${p.role === "admin" ? t("adminLabel") + " · " : ""}${p.uid ? (isMe ? t("tagYou") : t("joined")) : t("notJoined")}</span></div>
    ${acts.length ? `<div class="row-actions">${acts.join("")}</div>` : ""}
    ${used ? `<p class="hint">${t("usedNote", { name: esc(p.name) })}</p>` : ""}`;
  panel.querySelectorAll("[data-adm]").forEach(b => b.onclick = () => {
    const a = b.dataset.adm;
    if (a === "promote") act(() => api.updatePerson(p.id, { role: "admin" })).then(ok => ok && toast(t("promotedToast", { name: p.name })));
    if (a === "demote") act(() => api.updatePerson(p.id, { role: "member" }));
    if (a === "unlink") act(() => api.updatePerson(p.id, { uid: null })).then(ok => ok && toast(t("unlinkedToast", { name: p.name })));
    if (a === "remove") { if (b.dataset.armed) { selectedPerson = null; act(() => api.removePerson(p.id)) } else { b.dataset.armed = 1; b.textContent = t("tapAgainRemove") } }
  });
}

// Older groups were made before admins existed: the first member to ask becomes admin
async function becomeAdmin() {
  const m = me(); if (!m) return;
  const ok = await act(async () => {
    const b = writeBatch(db);
    b.set(doc(db, "groups", S.id, "members", uid), { personId: m.id });
    b.update(doc(db, "groups", S.id, "people", m.id), { role: "admin" });
    b.update(doc(db, "groups", S.id), { hasAdmin: true });
    await b.commit();
  });
  if (ok) toast(t("nowAdmin"));
}

// ---------- delete group ----------
let deleting = false;
function openDelete() {
  openSheet("delete", el => {
    el.innerHTML = `${sheetHead(t("deleteTitle", { name: S.name }))}
      <p class="hint">${esc(t("deleteHint"))}</p>
      <p style="margin:0;font-weight:700">${esc(S.name)}</p>
      <input id="delInput" autocomplete="off" placeholder="${esc(S.name)}">
      <p class="err" id="delErr"></p>
      <button class="btn danger wide" id="delBtn" type="button">${esc(t("deleteBtn"))}</button>`;
    wireClose(el);
    $("delBtn").onclick = async () => {
      if ($("delInput").value.trim() !== S.name.trim()) return $("delErr").textContent = t("deleteMismatch");
      $("delBtn").disabled = true; $("delBtn").textContent = t("deleting");
      try { await deleteGroup(); }
      catch (e) { console.error(e); deleting = false; $("delErr").textContent = t("deleteFail"); $("delBtn").disabled = false; $("delBtn").textContent = t("deleteBtn") }
    };
  });
}
async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(ref => b.delete(ref));
    await b.commit();
  }
}
async function deleteGroup() {
  const gid = S.id, mine = me();
  const g = doc(db, "groups", gid);
  const [exps, people, members] = await Promise.all(["expenses", "people", "members"].map(c => getDocs(collection(g, c))));
  deleting = true;
  // Order matters for the security rules: admin rights are checked against your own name, so it goes last
  await commitInChunks(exps.docs.map(d => d.ref));
  await commitInChunks([
    ...people.docs.filter(d => d.id !== mine?.id).map(d => d.ref),
    ...members.docs.filter(d => d.id !== uid).map(d => d.ref),
  ]);
  if (S.legacy) {
    // Older groups without admins: remove your own name first, then the group
    if (mine) await deleteDoc(doc(g, "people", mine.id));
    await deleteDoc(doc(g, "members", uid)).catch(() => { });
    await deleteDoc(g);
  } else {
    await deleteDoc(g);
    if (mine) await deleteDoc(doc(g, "people", mine.id));
    await deleteDoc(doc(g, "members", uid)).catch(() => { });
  }
  await deleteDoc(doc(userGroupsCol(uid), gid)).catch(() => { });
  unsubs.forEach(u => u()); unsubs = [];
  forgetGroup(gid);
  deleting = false;
  toast(t("deletedToast")); goHome();
}

// ---------- share summary ----------
function buildSummary(includeExpenses) {
  const b = balances(S.people, S.expenses), tx = settle(b);
  const total = S.expenses.filter(e => !e.payment).reduce((s, e) => s + e.cents, 0);
  const lines = [t("sumTitle", { name: S.name }), t("sumTotal", { x: fmtMinor(total), n: S.people.length }), "", t("sumWho")];
  if (tx.length) tx.forEach(x => lines.push(t("sumPays", { from: x.from, to: x.to, x: fmtMinor(x.cents) })));
  else lines.push(t("sumEven"));
  lines.push("", t("sumBalances"));
  [...S.people].sort((a, c) => b[c] - b[a]).forEach(p => {
    const v = b[p]; lines.push(`${p} ${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtMinor(Math.abs(v))}`);
  });
  const exps = S.expenses.filter(e => !e.payment).sort((a, c) => (a.createdAt || 0) - (c.createdAt || 0));
  if (includeExpenses && exps.length) {
    lines.push("", t("sumExpenses"));
    let anyFx = false;
    exps.forEach(e => {
      const fx = e.origCurrency && e.origCurrency !== S.currency;
      if (fx) anyFx = true;
      lines.push(t("sumExpLine", { desc: e.desc, x: fmtMinor(e.cents), orig: fx ? ` (${fmtAmount(e.origAmount, e.origCurrency)})` : "", payer: e.payer }));
    });
    if (anyFx) lines.push(t("sumFx"));
  }
  lines.push("", t("sumOpen", { url: groupLink() }));
  return lines.join("\n");
}
let includeExp = store.get("settleup.sumExp", true);

// Per person: what they paid and their share of expenses (repayments excluded), and net balance
function breakdown() {
  const b = balances(S.people, S.expenses);
  const rows = S.people.map(p => ({ name: p, paid: 0, share: 0, net: b[p] }));
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  let hasPayments = false;
  for (const e of S.expenses) {
    if (e.payment) { hasPayments = true; continue }
    if (by[e.payer]) by[e.payer].paid += e.cents;
    for (const [p, c] of expShares(e)) if (by[p]) by[p].share += c;
  }
  return { rows: rows.sort((a, c) => c.net - a.net), tx: settle(b), hasPayments };
}

// Draw the summary as a picture with real tables, so it looks the same in every chat or email app
async function drawSummaryImage(withExpenses) {
  try { await document.fonts.ready } catch { }
  const { rows, tx, hasPayments } = breakdown();
  const total = S.expenses.filter(e => !e.payment).reduce((x, e) => x + e.cents, 0);
  const exps = withExpenses ? S.expenses.filter(e => !e.payment).sort((a, c) => (a.createdAt || 0) - (c.createdAt || 0)) : [];
  const MAXEXP = 40, shownExps = exps.slice(0, MAXEXP);
  const W = 1080, P = 64, RH = 64, font = getComputedStyle(document.body).fontFamily;
  const C = { bg: "#ffffff", fg: "#17231f", muted: "#5d6d67", line: "#d7e0dc", strong: "#9fb0a9", accent: "#1f6f5c", soft: "#e1efe9", owe: "#b4442e" };
  const sections = [
    { rows: Math.max(tx.length, 1) },
    { rows: rows.length },
    ...(shownExps.length ? [{ rows: shownExps.length + (exps.length > MAXEXP ? 1 : 0) }] : []),
  ];
  let H = P + 64 + 44 + 40;
  sections.forEach(sec => { H += 56 + 52 + sec.rows * RH + 36 });
  if (hasPayments) H += 40;
  H += 60;
  H += 60 + P - 36;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = C.accent; g.fillRect(0, 0, W, 12);
  const txt = (s, x, y, { size = 30, weight = 400, color = C.fg, align = "left", max } = {}) => {
    g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = "middle";
    let str = String(s);
    if (max && g.measureText(str).width > max) { while (str.length > 1 && g.measureText(str + "…").width > max) str = str.slice(0, -1); str += "…" }
    g.fillText(str, x, y);
  };
  const hline = (y, color = C.line, w = 2) => { g.fillStyle = color; g.fillRect(P, y, W - 2 * P, w) };
  let y = P + 30;
  txt(S.name, P, y, { size: 52, weight: 700, max: W - 2 * P }); y += 64;
  txt(t("imgSubtitle", { x: fmtMinor(total), n: S.people.length, date: new Date().toLocaleDateString(locale(), { year: "numeric", month: "short", day: "numeric" }) }), P, y, { size: 28, color: C.muted, max: W - 2 * P }); y += 44 + 40;

  // table helper: cols = [{label, w (fraction), align}]
  const table = (title, cols, data) => {
    txt(title, P, y, { size: 34, weight: 700 }); y += 56;
    let x = P; const xs = cols.map(c => { const cx = x; x += c.w * (W - 2 * P); return cx });
    cols.forEach((c, i) => txt(c.label, c.align === "right" ? xs[i] + c.w * (W - 2 * P) : xs[i], y, { size: 24, weight: 600, color: C.muted, align: c.align || "left" }));
    y += 26; hline(y, C.strong, 3); y += 6;
    data.forEach((r, ri) => {
      r.forEach((cell, i) => {
        const c = cols[i], cw = c.w * (W - 2 * P) - 16;
        const v = typeof cell === "object" ? cell : { v: cell };
        txt(v.v, c.align === "right" ? xs[i] + c.w * (W - 2 * P) : xs[i], y + RH / 2, { size: 30, weight: v.bold ? 700 : 400, color: v.color || C.fg, align: c.align || "left", max: cw });
      });
      y += RH;
      if (ri < data.length - 1) hline(y);
    });
    y += 44;
  };
  table(t("whoPays"), [{ label: t("colFrom"), w: .38 }, { label: t("colTo"), w: .38 }, { label: t("colAmount"), w: .24, align: "right" }],
    tx.length ? tx.map(x => [x.from, x.to, { v: fmtMinor(x.cents), color: C.owe, bold: true }]) : [[{ v: t("sumEven"), color: C.accent, bold: true }, "", ""]]);
  const sign = v => v > 0 ? "+" : v < 0 ? "−" : "";
  table(t("balances"), [{ label: t("colName"), w: .34 }, { label: t("colPaid"), w: .22, align: "right" }, { label: t("colShare"), w: .22, align: "right" }, { label: t("colNet"), w: .22, align: "right" }],
    rows.map(r => [r.name, fmtMinor(r.paid), fmtMinor(r.share), { v: sign(r.net) + fmtMinor(Math.abs(r.net)), color: r.net > 0 ? C.accent : r.net < 0 ? C.owe : C.muted, bold: true }]));
  if (hasPayments) { y -= 24; txt(t("netNote"), P, y, { size: 24, color: C.muted }); y += 52 }
  if (shownExps.length) {
    const data = shownExps.map(e => [e.desc, e.payer, { v: fmtMinor(e.cents) + (e.origCurrency && e.origCurrency !== S.currency ? "*" : "") }]);
    if (exps.length > MAXEXP) data.push([{ v: t("moreRows", { n: exps.length - MAXEXP }), color: C.muted }, "", ""]);
    table(t("sumExpenses").replace(/\*/g, ""), [{ label: t("colItem"), w: .5 }, { label: t("colPaidBy"), w: .26 }, { label: t("colAmount"), w: .24, align: "right" }], data);
    if (shownExps.some(e => e.origCurrency && e.origCurrency !== S.currency)) { y -= 24; txt(t("fxStar"), P, y, { size: 24, color: C.muted }); y += 52 }
  }
  hline(y - 20); txt(t("madeWith"), P, y + 14, { size: 24, color: C.muted });
  // Crop to the content actually drawn
  const out = document.createElement("canvas"); out.width = W; out.height = Math.min(H, Math.ceil(y + 14 + P));
  out.getContext("2d").drawImage(cv, 0, 0);
  return out;
}
const canvasBlob = cv => new Promise(r => cv.toBlob(r, "image/png"));
function textSummary() { return buildSummary(includeExp) }

$("shareSumBtn").onclick = () => openSheet("share", async el => {
  el.innerHTML = `${sheetHead(t("shareSummary"))}
    <label class="toggle"><span>${esc(t("includeExpenses"))}</span><input type="checkbox" id="incExp" ${includeExp ? "checked" : ""}></label>
    <div class="sum-img-wrap"><img id="sumImg" alt="${esc(t("shareSummary"))}"></div>
    <button class="btn primary wide" id="shImg" type="button" disabled>${ICON.more} ${esc(t("shareImage"))}</button>
    <p class="hint" id="imgNote">${esc(t("shareImgNote"))}</p>
    <div class="sec-label">${esc(t("sendAsText"))}</div>
    <div class="share-grid three">
      <a class="btn ghost" id="shWa" target="_blank" rel="noopener">${ICON.wa} ${esc(t("whatsapp"))}</a>
      <a class="btn ghost" id="shMail">${ICON.mail} ${esc(t("email"))}</a>
      <button class="btn ghost" id="shCopy" type="button">${ICON.copy} ${esc(t("copyText"))}</button>
    </div>`;
  wireClose(el);
  $("incExp").onchange = e => { includeExp = e.target.checked; store.set("settleup.sumExp", includeExp); refreshSheet() };
  const text = textSummary();
  $("shWa").href = "https://wa.me/?text=" + encodeURIComponent(text);
  $("shMail").href = "mailto:?subject=" + encodeURIComponent(t("sumTitle", { name: S.name }).replace(/\*/g, "")) + "&body=" + encodeURIComponent(text.replace(/\*/g, ""));
  $("shCopy").onclick = () => copyText(text, t("textCopied"));
  const cv = await drawSummaryImage(includeExp);
  if (sheetName !== "share" || !$("sumImg")) return;
  const blob = await canvasBlob(cv);
  const url = URL.createObjectURL(blob);
  $("sumImg").src = url;
  const safe = (S.name || "settle-up").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "settle-up";
  const file = new File([blob], `${safe}-settle-up.png`, { type: "image/png" });
  const canFiles = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  $("shImg").disabled = false;
  if (!canFiles) $("imgNote").textContent = t("imgHint");
  $("shImg").onclick = async () => {
    if (canFiles) {
      try { await navigator.share({ files: [file], title: t("sumTitle", { name: S.name }).replace(/\*/g, ""), text: t("sumOpen", { url: groupLink() }) }); return }
      catch (e) { if (e.name === "AbortError") return }
    }
    $("imgNote").textContent = t("imgHint");
  };
});

// ---------- look helpers ----------
const initials = n => { const w = String(n).trim().split(/\s+/); return (w.length > 1 ? w[0][0] + w[1][0] : String(n).slice(0, 2)).toUpperCase() };
const avClass = n => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return "av" + (h % 6) };
const avatar = (n, size = "") => `<span class="av ${avClass(n)} ${size}" aria-hidden="true">${esc(initials(n))}</span>`;
const CATS = [
  ["food", /dinner|lunch|breakfast|brunch|meal|food|restaurant|eat|pizza|sushi|bbq|burger|noodle|ramen|snack|晚餐|午餐|早餐|餐|飯|食|宵夜/i, '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10"/>'],
  ["drink", /coffee|cafe|tea|drink|bar|beer|wine|cocktail|pub|咖啡|茶|飲|酒|啤/i, '<path d="M5 8h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM17 9h2a2 2 0 0 1 0 4h-2M8 3v2M12 3v2"/>'],
  ["flight", /flight|plane|airline|airport|air ?ticket|機票|航班|飛機|機場/i, '<path d="M10 14l-6-2 1-2 7 1 4-5a1.5 1.5 0 0 1 2 2l-5 4 1 7-2 1-2-6z"/>'],
  ["transport", /taxi|uber|grab|lyft|bus|train|metro|mrt|subway|car|gas|fuel|petrol|parking|toll|scooter|bike|ferry|boat|的士|計程車|車|巴士|地鐵|油|泊車|船/i, '<path d="M5 17h14M6 17l1.5-6h9L18 17M7 17v2M17 17v2"/><circle cx="8" cy="14" r=".6"/><circle cx="16" cy="14" r=".6"/>'],
  ["stay", /hotel|airbnb|villa|hostel|room|lodge|resort|apartment|rent|酒店|住宿|民宿|房|租/i, '<path d="M3 18V8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0-.01"/>'],
  ["grocery", /grocer|supermarket|market|7-?eleven|mart|超市|買餸|街市|便利店/i, '<path d="M4 5h2l2 10h10l2-7H7M10 19.5a1 1 0 1 0 0-.01M17 19.5a1 1 0 1 0 0-.01"/>'],
  ["fun", /ticket|tour|museum|park|show|movie|cinema|concert|game|karaoke|spa|massage|diving|surf|門票|活動|戲|演唱會|遊|按摩/i, '<path d="M4 8a2 2 0 0 0 0 4v4h16v-4a2 2 0 0 1 0-4V4H4zM10 4v12" stroke-dasharray="2 2"/>'],
  ["shop", /shop|gift|store|souvenir|clothes|mall|購物|禮物|手信|衫/i, '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>'],
];
const OTHER_ICON = '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>';
const REPAY_ICON = '<path d="M7 7h12l-3-3M17 17H5l3 3"/>';
function category(desc, payment) {
  if (payment) return { c: "repay", svg: REPAY_ICON };
  for (const [c, re, svg] of CATS) if (re.test(desc || "")) return { c, svg };
  return { c: "other", svg: OTHER_ICON };
}
const catIcon = (desc, payment) => { const k = category(desc, payment); return `<span class="cat-icon c-${k.c}" aria-hidden="true"><svg viewBox="0 0 24 24">${k.svg}</svg></span>` };
function updateDescIcon() { const k = category($("desc").value, false); $("descIcon").className = "cat-icon c-" + k.c; $("descIcon").innerHTML = `<svg viewBox="0 0 24 24">${k.svg}</svg>` }
$("desc").addEventListener("input", updateDescIcon);
const dayKey = ts => { const d = new Date(ts || 0); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() };
function dayLabel(k) {
  const today = dayKey(Date.now()), y = today - 864e5;
  if (k === today) return t("today");
  if (k === y) return t("yesterday");
  return new Date(k).toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric" });
}

// One expense row in the feed
function expenseRow(e, myName) {
  const fx = e.origCurrency && e.origCurrency !== S.currency;
  let title = e.desc, sub, end2 = "";
  if (e.payment) {
    title = t("repaidLine", { from: e.payer === myName ? t("you") : e.payer, to: e.split[0] === myName ? t("youObj") : e.split[0] });
    sub = t("repayment");
  } else {
    sub = (e.payer === myName ? t("youPaid") : t("xPaid", { name: e.payer })) + " · " + (fx ? fmtAmount(e.origAmount, e.origCurrency) : e.splitAmounts ? t("splitCustom") : t("splitWays", { n: e.split.length }));
    const myShare = (expShares(e).find(([p]) => p === myName) || [, 0])[1];
    if (e.payer === myName) { const lent = e.cents - myShare; end2 = lent > 0 ? `<div class="sub get-t">${esc(t("youLentX", { x: fmtMinor(lent) }))}</div>` : "" }
    else if (myShare) end2 = `<div class="sub owe-t">${esc(t("youOweX", { x: fmtMinor(myShare) }))}</div>`;
    else end2 = `<div class="sub">${esc(t("notInvolved"))}</div>`;
  }
  return `<button class="it" type="button" data-exp="${esc(e.id)}">${catIcon(e.desc, e.payment)}<div class="mid"><div class="ttl">${esc(title)}</div><div class="sub">${esc(sub)}</div></div><div class="end"><div class="v">${fmtMinor(e.cents)}</div>${end2}</div></button>`;
}
function wireExpenseRows(root) { root.querySelectorAll("[data-exp]").forEach(b => b.onclick = () => openExpense(b.dataset.exp)) }

// ---------- render group ----------
function render() {
  const mine = me(), myName = mine.name;
  $("gName").textContent = S.name;
  const b = balances(S.people, S.expenses), tx = settle(b);
  const total = S.expenses.filter(e => !e.payment).reduce((x, e) => x + e.cents, 0);
  const myNet = b[myName] || 0;

  // balance card
  $("heroNum").textContent = myNet === 0 ? fmtMinor(0) : (myNet > 0 ? "+" : "−") + fmtMinor(Math.abs(myNet));
  $("heroSub").textContent = (myNet < 0 ? t("youOweOverall") : myNet > 0 ? t("youAreOwed") : t("allSettled")) + (total ? " · " + t("groupSpent", { x: fmtMinor(total) }) : "");
  const myTx = tx.filter(x => x.from === myName || x.to === myName);
  $("heroPays").innerHTML = myTx.map(x => {
    const iPay = x.from === myName, other = iPay ? x.to : x.from;
    return `<div class="pay-row">${avatar(other, "sm")}<span class="txt">${iPay ? t("payX", { name: `<b>${esc(other)}</b>` }) : t("xPaysYou", { name: `<b>${esc(other)}</b>` })} <span class="num">${fmtMinor(x.cents)}</span></span><button type="button" data-pay="${tx.indexOf(x)}">${esc(iPay ? t("markPaid") : t("markReceived"))}</button></div>`;
  }).join("");
  document.querySelectorAll("[data-pay]").forEach(btn => btn.onclick = () => {
    const x = tx[+btn.dataset.pay]; btn.disabled = true;
    act(() => api.addExpense({ desc: t("paymentDesc", { from: x.from, to: x.to }), cents: x.cents, payer: x.from, split: [x.to], payment: true }))
      .then(ok => ok && toast(t("markedPaid")));
  });

  // people strip
  $("peopleStrip").innerHTML = S.people.map(p => {
    const v = b[p] || 0;
    return `<button class="pp" type="button" data-person="${esc(p)}">${avatar(p)}<span class="nm">${esc(p === myName ? t("you") : p)}</span><span class="nv ${v > 0 ? "get-t" : v < 0 ? "owe-t" : ""}">${v === 0 ? "0" : (v > 0 ? "+" : "−") + (Math.abs(v) / unit(S.currency)).toFixed(digits(S.currency))}</span></button>`;
  }).join("") + `<button class="pp" type="button" id="stripInvite"><span class="av add" aria-hidden="true">+</span><span class="nm" style="color:var(--muted)">${esc(t("invite"))}</span></button>`;
  $("peopleStrip").querySelectorAll("[data-person]").forEach(x => x.onclick = () => openPerson(x.dataset.person));
  $("stripInvite").onclick = shareInvite;

  // other people's payments
  const others = tx.filter(x => x.from !== myName && x.to !== myName);
  $("othersHead").hidden = !others.length; $("othersList").hidden = !others.length;
  $("othersList").innerHTML = others.map(x => `<div class="lrow">${avatar(x.from, "sm")}<span class="txt">${t("xPaysY", { from: `<b>${esc(x.from)}</b>`, to: `<b>${esc(x.to)}</b>` })}</span><span class="amt">${fmtMinor(x.cents)}</span></div>`).join("");

  // recent
  const sorted = [...S.expenses].sort((a, c) => (c.createdAt || 0) - (a.createdAt || 0));
  const empty = !sorted.length;
  $("emptyCard").hidden = !empty; $("recentHead").hidden = empty; $("recentList").hidden = empty;
  $("emptyText").textContent = S.people.length < 2 ? t("emptyInviteText") : t("emptyAddText");
  $("emptyInvite").hidden = S.people.length >= 2;
  $("recentList").innerHTML = sorted.slice(0, 4).map(e => expenseRow(e, myName)).join("");
  wireExpenseRows($("recentList"));
  $("seeAllBtn").hidden = sorted.length <= 4;
  $("shareSumBtn").hidden = !S.expenses.length;

  renderActivity();
  if (sheetName === "add") renderSplit();
}

function renderActivity() {
  const mine = me(); if (!mine) return;
  const myName = mine.name;
  let list = [...S.expenses].sort((a, c) => (c.createdAt || 0) - (a.createdAt || 0));
  if (actFilter === "mine") list = list.filter(e => !e.payment && e.payer === myName);
  if (actFilter === "repay") list = list.filter(e => e.payment);
  if (!list.length) { $("activityList").innerHTML = `<p class="empty-state">${esc(t("emptyActivity"))}</p>`; return }
  let html = "", last = null;
  for (const e of list) {
    const k = dayKey(e.createdAt);
    if (k !== last) { html += `<div class="day">${esc(dayLabel(k))}</div>`; last = k }
    html += expenseRow(e, myName);
  }
  $("activityList").innerHTML = `<div class="feed">${html}</div>`;
  wireExpenseRows($("activityList"));
}

// Split chips inside the add form, keeping current choices
function renderSplit() {
  const mine = me(); if (!mine) return;
  const prevSplit = new Set([...document.querySelectorAll("#splitOpts input:checked")].map(i => i.value));
  const known = new Set([...document.querySelectorAll("#splitOpts input")].map(i => i.value));
  $("splitOpts").innerHTML = S.people.map((p, i) => `<label class="sp"><input type="checkbox" id="sp${i}" value="${esc(p)}" ${!known.has(p) || prevSplit.has(p) ? "checked" : ""}>${avatar(p, "xs")}${esc(p === mine.name ? t("you") : p)}</label>`).join("");
  $("splitOpts").querySelectorAll("input").forEach(i => i.onchange = preview);
  if (splitMode === "exact") renderExact();
  initExpCurrency();
}

// Tap an expense: details, and Delete when allowed
function openExpense(id) {
  openSheet("expense", el => {
    const e = S.expenses.find(x => x.id === id), mine = me();
    if (!e || !mine) return closeSheet();
    const fx = e.origCurrency && e.origCurrency !== S.currency;
    const canDelete = !e.addedBy || e.addedBy === mine.id || amAdmin();
    const when = e.createdAt ? new Date(e.createdAt).toLocaleString(locale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    const per = expShares(e);
    el.innerHTML = `${sheetHead(e.payment ? t("repayment") : e.desc)}
      <div style="display:flex;align-items:center;gap:12px">${catIcon(e.desc, e.payment)}<p class="detail-amt num">${fmtMinor(e.cents)}</p></div>
      ${fx ? `<p class="hint">${esc(t("paidOrig", { amount: fmtAmount(e.origAmount, e.origCurrency), from: e.origCurrency, rate: niceRate(e.rate), to: S.currency }))}</p>` : ""}
      <div class="list-card">
        <div class="kv"><span>${esc(t("paidBy"))}</span><span>${esc(e.payer)}</span></div>
        ${per.map(([p, c]) => `<div class="kv"><span>${esc(p)}</span><span class="num">${fmtMinor(c)}</span></div>`).join("")}
        ${e.addedByName ? `<div class="kv"><span>${esc(t("addedByLabel"))}</span><span>${esc(e.addedByName)}${when ? " · " + esc(when) : ""}</span></div>` : ""}
        ${e.editedAt ? `<div class="kv"><span>${esc(t("editedLabel"))}</span><span>${esc(e.editedByName || "")}${e.editedByName ? " · " : ""}${esc(new Date(e.editedAt).toLocaleString(locale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</span></div>` : ""}
      </div>
      ${canDelete ? `<div class="detail-actions">${e.payment ? "" : `<button class="btn primary" id="expEdit" type="button">${esc(t("edit"))}</button>`}<button class="btn ghost" id="expDel" type="button" style="color:var(--owe)">${esc(t("del"))}</button></div>` : ""}`;
    wireClose(el);
    if ($("expEdit")) $("expEdit").onclick = () => openEdit(id);
    if (canDelete) $("expDel").onclick = async () => {
      if (!$("expDel").dataset.armed) { $("expDel").dataset.armed = 1; $("expDel").textContent = t("tapAgainDelete"); return }
      closeSheet(); await act(() => api.deleteExpense(id));
    };
  });
}

// Tap a person: what they paid, their share, and net
function openPerson(name) {
  openSheet("person", el => {
    const { rows } = breakdown(), r = rows.find(x => x.name === name); if (!r) return closeSheet();
    const mine = me();
    el.innerHTML = `${sheetHead(name === mine?.name ? t("you") : name)}
      <div style="display:flex;align-items:center;gap:12px">${avatar(name)}<p class="detail-amt num ${r.net > 0 ? "get-t" : r.net < 0 ? "owe-t" : ""}">${r.net === 0 ? fmtMinor(0) : (r.net > 0 ? "+" : "−") + fmtMinor(Math.abs(r.net))}</p></div>
      <div class="list-card">
        <div class="kv"><span>${esc(t("colPaid"))}</span><span class="num">${fmtMinor(r.paid)}</span></div>
        <div class="kv"><span>${esc(t("colShare"))}</span><span class="num">${fmtMinor(r.share)}</span></div>
        <div class="kv"><span>${esc(t("colNet"))}</span><span class="num">${r.net === 0 ? fmtMinor(0) : (r.net > 0 ? "+" : "−") + fmtMinor(Math.abs(r.net))}</span></div>
      </div>
      <button class="btn ghost wide" id="toPeople" type="button">${esc(t("peopleAdmins"))}</button>`;
    wireClose(el);
    $("toPeople").onclick = openPeople;
  });
}

// ---------- expense form: currency + exchange rate ----------
let fx = { cur: null, rate: null, edited: false, req: 0 };
const lastCurKey = () => "settleup.cur." + S.id;
function initExpCurrency() {
  const sel = $("expCurrency");
  if (sel.dataset.group !== S.id) {
    sel.dataset.group = S.id;
    sel.value = store.get(lastCurKey(), S.currency);
    if (!sel.value) sel.value = S.currency;
    onCurrencyChange();
  } else if (fx.cur === null) onCurrencyChange();
  else refreshFxLabels();
}
function refreshFxLabels() {
  const c = $("expCurrency").value;
  $("curChipText").textContent = c;
  $("fxBox").hidden = c === S.currency;
  $("fxFrom").textContent = `1 ${c} =`;
  $("fxTo").textContent = S.currency;
  $("amount").placeholder = digits(c) ? (0).toFixed(digits(c)) : "0";
}
async function onCurrencyChange() {
  const c = $("expCurrency").value;
  store.set(lastCurKey(), c);
  fx = { cur: c, rate: null, edited: false, req: fx.req + 1 };
  refreshFxLabels(); $("fxRate").value = ""; preview();
  if (c === S.currency) return;
  const req = fx.req, home = S.currency;
  $("fxNote").textContent = t("gettingRate");
  try {
    const { rate, updated } = await fetchRate(c, home);
    if (req !== fx.req || fx.edited) return;
    fx.rate = rate; $("fxRate").value = niceRate(rate);
    $("fxNote").textContent = t("rateNote", { date: new Date(updated).toLocaleDateString(locale(), { month: "short", day: "numeric" }) });
  } catch {
    if (req !== fx.req) return;
    $("fxNote").textContent = t("rateFail");
  }
  preview();
}
$("expCurrency").onchange = onCurrencyChange;
$("fxRate").oninput = () => { fx.edited = true; const r = parseFloat($("fxRate").value.replace(",", ".")); fx.rate = isFinite(r) && r > 0 ? r : null; preview() };

function parseAmount() {
  const c = $("expCurrency").value;
  const n = parseFloat($("amount").value.replace(/[^0-9.,]/g, "").replace(",", "."));
  return isFinite(n) && n > 0 ? Math.round(n * unit(c)) / unit(c) : 0;
}
function homeCents() {
  const c = $("expCurrency").value, amt = parseAmount();
  if (!amt) return 0;
  if (c === S.currency) return Math.round(amt * unit(c));
  if (!fx.rate) return 0;
  return Math.round(amt * fx.rate * unit(S.currency));
}
const checked = () => [...document.querySelectorAll("#splitOpts input:checked")].map(i => i.value);
const num = v => { const n = parseFloat(String(v).replace(/[^0-9.,]/g, "").replace(",", ".")); return isFinite(n) && n > 0 ? n : 0 };
// Exact amounts typed in the expense's currency: { name: amount } (only people with an amount)
function exactValues() {
  const c = $("expCurrency").value, out = {};
  document.querySelectorAll("#exactList input").forEach(i => { const v = Math.round(num(i.value) * unit(c)) / unit(c); if (v > 0) out[i.dataset.p] = v });
  return out;
}
// Convert exact amounts to home-currency minor units that add up exactly to the total
function exactHomeCents(vals, totalCents) {
  const c = $("expCurrency").value, rate = c === S.currency ? 1 : fx.rate;
  const sumOrig = Object.values(vals).reduce((a, b) => a + b, 0);
  const out = {};
  for (const [p, v] of Object.entries(vals)) out[p] = Math.round(v * (c === S.currency ? unit(c) : rate * unit(S.currency)));
  // Fix rounding so the parts add up to the total exactly
  const diff = totalCents - Object.values(out).reduce((a, b) => a + b, 0);
  if (diff && sumOrig) { const big = Object.keys(out).sort((a, b) => out[b] - out[a])[0]; out[big] += diff }
  return out;
}
function preview() {
  if (!S.id) return;
  const c = $("expCurrency").value, amt = parseAmount(), cents = homeCents(), s = checked();
  $("convLine").textContent = c !== S.currency && cents ? "= " + fmtMinor(cents) : "";
  $("preview").classList.remove("warn-t", "ok-t");
  if (splitMode === "exact") {
    const vals = exactValues(), sum = Object.values(vals).reduce((a, b) => a + b, 0);
    const left = Math.round((amt - sum) * unit(c)) / unit(c);
    if (!amt) return $("preview").textContent = "";
    if (left > 0) { $("preview").textContent = t("remainingX", { x: fmtAmount(left, c) }); $("preview").classList.add("warn-t") }
    else if (left < 0) { $("preview").textContent = t("overX", { x: fmtAmount(-left, c) }); $("preview").classList.add("warn-t") }
    else { $("preview").textContent = t("exactOk"); $("preview").classList.add("ok-t") }
    return;
  }
  if (!amt) return $("preview").textContent = "";
  if (!cents) return $("preview").textContent = t("enterRate");
  $("preview").textContent = s.length ? t("eachX", { x: fmtMinor(Math.round(cents / s.length)), n: s.length }) : "";
}
$("amount").oninput = preview;
$("selAll").onclick = () => { document.querySelectorAll("#splitOpts input").forEach(i => i.checked = true); preview() };
$("selNone").onclick = () => { document.querySelectorAll("#splitOpts input").forEach(i => i.checked = false); preview() };
$("expForm").addEventListener("submit", e => {
  e.preventDefault(); const err = $("expErr");
  const desc = $("desc").value.trim(), amt = parseAmount(), cents = homeCents(), c = $("expCurrency").value;
  const old = editingId && S.expenses.find(x => x.id === editingId);
  if (editingId && !old) { editingId = null; closeSheet(); return }
  if (S.people.length < 2) return err.textContent = t("errNeedFriend");
  if (!desc) return err.textContent = t("errDesc");
  if (!amt) return err.textContent = t("errAmount");
  if (!cents) return err.textContent = t("errRate");
  let split, splitAmounts = null, splitOrig = null;
  if (splitMode === "exact") {
    const vals = exactValues(), sum = Object.values(vals).reduce((a, b) => a + b, 0);
    if (!Object.keys(vals).length) return err.textContent = t("errSplit");
    if (Math.round((amt - sum) * unit(c)) !== 0) return err.textContent = t("errExact");
    split = S.people.filter(p => vals[p]);
    splitAmounts = exactHomeCents(vals, cents);
    if (c !== S.currency) splitOrig = vals;
  } else {
    split = checked();
    if (!split.length) return err.textContent = t("errSplit");
  }
  const entry = { desc, cents, payer: old ? old.payer : me().name, split };
  const fxOn = c !== S.currency;
  if (fxOn) Object.assign(entry, { origAmount: amt, origCurrency: c, rate: fx.rate });
  if (splitAmounts) entry.splitAmounts = splitAmounts;
  if (splitOrig) entry.splitOrig = splitOrig;
  err.textContent = ""; document.activeElement?.blur();
  if (old) {
    const id = editingId, m = me();
    const patch = { ...entry, editedAt: Date.now(), editedByName: m.name };
    // Clear fields that no longer apply (e.g. switched back to the home currency or to an equal split)
    if (!fxOn) Object.assign(patch, { origAmount: deleteField(), origCurrency: deleteField(), rate: deleteField() });
    if (!splitAmounts) patch.splitAmounts = deleteField();
    if (!splitOrig) patch.splitOrig = deleteField();
    act(() => api.editExpense(id, patch));
    editingId = null; $("expCurrency").dataset.group = "";
    closeSheet(); toast(t("editedToast"));
    return;
  }
  act(() => api.addExpense(entry));
  resetForm(); updateDescIcon();
  closeSheet(); tab = "home"; show("group"); window.scrollTo({ top: 0 });
  toast(t("addedToast"));
});

// ---------- language ----------
function applyLanguage() {
  applyStatic();
  fillAllCurrencySelects();
  $("langSel").value = lang;
  $("inviteBtn").setAttribute("aria-label", t("copyInviteRow"));
  $("plusBtn").setAttribute("aria-label", t("addExpenseTitle"));
  if (sheetName === "add") formLabels();
  $("menuBtn").setAttribute("aria-label", t("groupSettings"));
  if (S.id && me() && !forceJoin) render();
  else if (S.id && S.loaded.people) renderJoin();
  if (uid) renderAccount();
}
$("langSel").onchange = e => { setLang(e.target.value); applyLanguage() };
applyLanguage();

// ---------- boot ----------
async function boot() {
  const app = initializeApp(firebaseConfig);
  // Keep a copy of groups on the phone so they open instantly and work offline
  try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }) }
  catch (e) { console.warn("cache off", e); db = getFirestore(app) }
  auth = getAuth(app);
  await auth.authStateReady();
  if (!auth.currentUser) {
    try { await signInAnonymously(auth) }
    catch (e) { console.error(e); status(t("connectFail"), true); return }
  }
  uid = auth.currentUser.uid; account = auth.currentUser.isAnonymous ? null : auth.currentUser;
  onAuthStateChanged(auth, async u => {
    if (!u) { try { await signInAnonymously(auth) } catch (e) { console.error(e) } return }
    const changed = u.uid !== uid;
    uid = u.uid; account = u.isAnonymous ? null : u;
    renderAccount();
    if (changed && !migrating) { indexGroup.last = null; route() }
  });
  if (isSignInWithEmailLink(auth, location.href)) {
    const link = location.href;
    history.replaceState(null, "", location.pathname);
    session.set("settleup.stayHome", "1");
    route();
    finishEmail(link);
    return;
  }
  route();
}
if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE")) {
  status(t("setupNeeded"), true);
} else boot();

// ---------- pull to refresh (home-screen app only; browsers have their own) ----------
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if (standalone) {
  const ptr = $("ptr"), TRIGGER = 60;
  let startY = null, dist = 0, busy = false;
  const canStart = () => window.scrollY <= 0 && !sheetName && !busy;
  window.addEventListener("touchstart", e => { startY = canStart() && e.touches.length === 1 ? e.touches[0].clientY : null; dist = 0 }, { passive: true });
  window.addEventListener("touchmove", e => {
    if (startY === null) return;
    dist = Math.max(0, e.touches[0].clientY - startY);
    if (dist <= 0 || window.scrollY > 0) { ptr.hidden = true; return }
    const d = Math.min(dist * 0.5, 90);
    ptr.hidden = false;
    ptr.style.transform = `translate(-50%, ${d}px)`;
    ptr.style.transition = "none";
    ptr.classList.toggle("ready", d >= TRIGGER);
    ptr.querySelector("svg").style.transform = `rotate(${d * 4}deg)`;
  }, { passive: true });
  window.addEventListener("touchend", () => {
    if (startY === null) return;
    startY = null;
    ptr.style.transition = "";
    if (ptr.classList.contains("ready")) {
      busy = true; ptr.classList.add("spin");
      ptr.style.transform = `translate(-50%, 56px)`;
      setTimeout(() => location.reload(), 250);
    } else { ptr.style.transform = "translate(-50%, 0)"; setTimeout(() => { if (!busy) ptr.hidden = true }, 200) }
  });
}

// Block pinch-zoom on iOS Safari, which ignores user-scalable=no
document.addEventListener("gesturestart", e => e.preventDefault(), { passive: false });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
