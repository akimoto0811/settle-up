// Settle Up — shared bill splitting. Static app (GitHub Pages) + Firebase (Auth + Firestore) for live sync.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, setDoc, addDoc, deleteDoc, updateDoc, getDoc, getDocs, onSnapshot,
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
let forceJoin = false, migrating = false, tab = "add";
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
export function balances(people, expenses) {
  const b = Object.fromEntries(people.map(p => [p, 0]));
  for (const e of expenses) {
    if (b[e.payer] !== undefined) b[e.payer] += e.cents;
    for (const [p, c] of shares(e.cents, e.split)) if (b[p] !== undefined) b[p] -= c;
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
function show(view) {
  const inGroup = view === "group";
  $("barStart").hidden = inGroup; $("barGroup").hidden = !inGroup;
  $("startView").hidden = view !== "start";
  $("joinView").hidden = view !== "join";
  $("tabAdd").hidden = !(inGroup && tab === "add");
  $("tabBalances").hidden = !(inGroup && tab === "balances");
  $("tabbar").hidden = !inGroup;
  document.body.classList.toggle("has-tabs", inGroup);
  $("tabBtnAdd").classList.toggle("on", tab === "add");
  $("tabBtnBal").classList.toggle("on", tab === "balances");
}
const groupLink = () => location.href.split("#")[0].split("?")[0] + "#" + S.id;
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return true }
  catch { prompt(t("copyPrompt"), text); return false }
}

// ---------- sheets ----------
let sheetName = null, sheetRender = null;
function openSheet(name, renderFn) {
  sheetName = name; sheetRender = renderFn;
  $("sheetWrap").hidden = false; document.body.classList.add("sheet-open");
  renderFn($("sheet"));
}
function closeSheet() { sheetName = null; sheetRender = null; $("sheetWrap").hidden = true; $("sheet").innerHTML = ""; document.body.classList.remove("sheet-open") }
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
function goHome() { session.set("settleup.stayHome", "1"); location.hash = "" }

function route() {
  if (!uid) return;
  unsubs.forEach(u => u()); unsubs = [];
  forceJoin = false; selectedPerson = null;
  if (sheetName && sheetName !== "signin") closeSheet();
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
    await b.commit();
    $("groupName").value = ""; $("founderName").value = ""; $("createForm").hidden = true;
    tab = "add";
    location.hash = gref.id;
    setTimeout(() => toast(t("createdToast")), 400);
  } catch (e2) { console.error(e2); err.textContent = t("createFail") }
});

// ---------- open group (live) ----------
async function openGroup(gid) {
  S = blankGroup(gid);
  const gref = doc(db, "groups", gid);
  try {
    const snap = await getDoc(gref);
    if (!snap.exists()) { forgetGroup(gid); goHome(); status(t("badLink"), true); return }
  } catch (e) { status(t("loadFail"), true); return }
  if (S.id !== gid) return;
  const onErr = e => { console.error(e); if (S.id === gid) status(t("offline"), true) };
  unsubs.push(onSnapshot(gref, s => {
    if (!s.exists()) { if (S.id === gid) { forgetGroup(gid); goHome(); toast(t("deletedToast")) } return }
    const d = s.data() || {}; S.name = d.name || t("groupFallback"); S.currency = d.currency || "USD"; S.legacy = !d.createdBy; S.hasAdminFlag = !!d.hasAdmin;
    document.title = S.name + " · Settle Up"; rememberGroup(); update();
  }, onErr));
  unsubs.push(onSnapshot(collection(gref, "people"), s => {
    S.peopleDocs = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    S.people = S.peopleDocs.map(p => p.name); S.loaded.people = true; update();
  }, onErr));
  unsubs.push(onSnapshot(collection(gref, "expenses"), s => {
    S.expenses = s.docs.map(d => ({ id: d.id, ...d.data() })); update();
  }, onErr));
}

function update() {
  if (!S.id || !S.loaded.people || migrating || deleting) return;
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
  updateGroup: data => updateDoc(doc(db, "groups", S.id), data),
};

// ---------- top bar ----------
$("switchBtn").onclick = () => openSheet("switch", async el => {
  el.innerHTML = `${sheetHead(t("switchGroup"))}<div class="menu" id="gList"><p class="hint">…</p></div>
    <button class="btn ghost wide" id="toHome" type="button">${esc(t("allGroupsNew"))}</button>`;
  wireClose(el);
  $("toHome").onclick = () => { closeSheet(); goHome() };
  const list = await allMyGroups();
  if (sheetName !== "switch") return;
  $("gList").innerHTML = list.map(g => `<button class="mi" type="button" data-g="${esc(g.id)}">${g.id === S.id ? ICON.check : ICON.users}<span>${esc(g.name || t("groupFallback"))}</span>${g.id === S.id ? `<span class="side">${esc(t("current"))}</span>` : ""}</button>`).join("");
  $("gList").querySelectorAll("[data-g]").forEach(b => b.onclick = () => { closeSheet(); if (b.dataset.g !== S.id) { tab = "add"; location.hash = b.dataset.g } });
});
async function shareInvite() {
  const url = groupLink();
  if (navigator.share) { try { await navigator.share({ title: S.name, text: t("inviteText", { name: S.name, url: "" }).trim(), url }); return } catch (e) { if (e.name === "AbortError") return } }
  copyText(url, t("copied"));
}
$("inviteBtn").onclick = shareInvite;
$("menuBtn").onclick = openSettings;
document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; show("group"); window.scrollTo({ top: 0 }) });

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
  closeSheet(); toast(t("deletedToast")); goHome();
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
    for (const [p, c] of shares(e.cents, e.split)) if (by[p]) by[p].share += c;
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

// ---------- render group ----------
function render() {
  const mine = me(), myName = mine.name, admin = amAdmin();
  $("gName").textContent = S.name;

  // balances tab
  const b = balances(S.people, S.expenses), tx = settle(b);
  $("txCount").textContent = tx.length ? (tx.length > 1 ? t("payments", { n: tx.length }) : t("payment1")) : "";
  $("transfers").innerHTML = tx.length ? tx.map((x, k) => {
    const involved = x.from === myName || x.to === myName;
    return `<div class="tx${involved ? " mine" : ""}"><div class="who">${esc(x.from === myName ? t("you") : x.from)}<span class="arrow">${x.from === myName ? t("pay") : t("pays")}</span>${esc(x.to === myName ? t("youObj") : x.to)}</div><div class="amt num">${fmtMinor(x.cents)}</div>${involved ? `<button class="btn small ghost done-btn" data-pay="${k}" type="button">${t("markPaid")}</button>` : ""}</div>`;
  }).join("")
    : `<div class="settled">${S.expenses.length ? t("settledEven") : S.people.length < 2 ? t("settledInvite") : t("settledLog")}</div>`;
  document.querySelectorAll("[data-pay]").forEach(btn => btn.onclick = () => {
    const x = tx[+btn.dataset.pay]; btn.disabled = true;
    act(() => api.addExpense({ desc: t("paymentDesc", { from: x.from, to: x.to }), cents: x.cents, payer: x.from, split: [x.to], payment: true }));
  });
  const total = S.expenses.filter(e => !e.payment).reduce((s, e) => s + e.cents, 0);
  $("total").textContent = total ? t("totalSpent", { x: fmtMinor(total) }) : "";
  const max = Math.max(1, ...Object.values(b).map(Math.abs));
  $("balances").innerHTML = S.people.length ? S.people.map(p => {
    const v = b[p], w = Math.abs(v) / max * 50, cls = v > 0 ? "pos" : v < 0 ? "neg" : "zero";
    const bar = v ? `<i style="${v > 0 ? "left:50%" : "right:50%"};width:${w}%;background:var(${v > 0 ? "--get" : "--owe"})"></i>` : "";
    const label = v > 0 ? t("gets", { x: fmtMinor(v) }) : v < 0 ? t("owes", { x: fmtMinor(-v) }) : t("even");
    return `<div class="bal-row"><span class="name" title="${esc(p)}">${esc(p)}${p === myName ? t("youSuffix") : ""}</span><div class="bar-track">${bar}</div><span class="v num ${cls}">${label}</span></div>`;
  }).join("") : `<p class="empty">${t("noOneHere")}</p>`;
  $("shareSumBtn").hidden = !S.expenses.length;

  // add tab: split options, keeping current choices
  const prevSplit = new Set([...document.querySelectorAll("#splitOpts input:checked")].map(i => i.value));
  const known = new Set([...document.querySelectorAll("#splitOpts input")].map(i => i.value));
  $("splitOpts").innerHTML = S.people.map((p, i) => `<label><input type="checkbox" id="sp${i}" value="${esc(p)}" ${!known.has(p) || prevSplit.has(p) ? "checked" : ""}>${esc(p === myName ? p + t("youSuffix") : p)}</label>`).join("");
  $("splitOpts").querySelectorAll("input").forEach(i => i.onchange = preview);
  initExpCurrency();
  preview();

  const n = S.expenses.length; $("expCount").textContent = n ? (n > 1 ? t("items", { n }) : t("item1")) : "";
  $("ledger").innerHTML = n ? [...S.expenses].sort((a, c) => (c.createdAt || 0) - (a.createdAt || 0)).map(e => {
    const each = e.split.length > 1 ? t("each", { x: fmtMinor(Math.ceil(e.cents / e.split.length)) }) : "";
    const meta = e.payment ? t("repayment") : e.split.length === S.people.length
      ? t("paidSplitAll", { payer: esc(e.payer), each })
      : t("paidSplitWith", { payer: esc(e.payer), names: e.split.map(esc).join(lang === "zh-Hant" ? "、" : ", "), each });
    const fxl = e.origCurrency && e.origCurrency !== S.currency ? `<span class="fxline num">${t("paidOrig", { amount: fmtAmount(e.origAmount, e.origCurrency), from: e.origCurrency, rate: niceRate(e.rate), to: S.currency })}</span>` : "";
    const when = e.createdAt ? new Date(e.createdAt).toLocaleDateString(locale(), { month: "short", day: "numeric" }) : "";
    const by = [e.addedByName ? t("addedBy", { name: esc(e.addedByName) }) : "", when].filter(Boolean).join(" · ");
    const canDelete = !e.addedBy || e.addedBy === mine.id || admin;
    return `<div class="exp"><span class="d">${esc(e.desc)}</span><span class="a num">${fmtMinor(e.cents)}</span><span class="meta">${meta}</span>${canDelete ? `<button class="link danger del" type="button" data-del="${esc(e.id)}">${t("del")}</button>` : "<span></span>"}${fxl}${by ? `<span class="by">${by}</span>` : ""}</div>`;
  }).join("") : `<p class="empty">${t("noExpenses")}</p>`;
  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.armed) return act(() => api.deleteExpense(btn.dataset.del));
      btn.dataset.armed = "1"; btn.textContent = t("tapAgainDelete");
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = t("del") } }, 3000);
    };
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
function preview() {
  if (!S.id) return;
  const c = $("expCurrency").value, amt = parseAmount(), cents = homeCents(), s = checked();
  if (!amt) return $("preview").textContent = "";
  if (!cents) return $("preview").textContent = t("enterRate");
  const conv = c !== S.currency ? `${fmtAmount(amt, c)} = ${fmtMinor(cents)}` : fmtMinor(cents);
  $("preview").textContent = s.length ? t("previewEach", { conv, n: s.length, x: fmtMinor(Math.round(cents / s.length)) }) : conv;
}
$("amount").oninput = preview;
$("selAll").onclick = () => { document.querySelectorAll("#splitOpts input").forEach(i => i.checked = true); preview() };
$("selNone").onclick = () => { document.querySelectorAll("#splitOpts input").forEach(i => i.checked = false); preview() };
$("expForm").addEventListener("submit", e => {
  e.preventDefault(); const err = $("expErr");
  const desc = $("desc").value.trim(), amt = parseAmount(), cents = homeCents(), split = checked(), c = $("expCurrency").value;
  if (S.people.length < 2) return err.textContent = t("errNeedFriend");
  if (!desc) return err.textContent = t("errDesc");
  if (!amt) return err.textContent = t("errAmount");
  if (!cents) return err.textContent = t("errRate");
  if (!split.length) return err.textContent = t("errSplit");
  const entry = { desc, cents, payer: me().name, split };
  if (c !== S.currency) Object.assign(entry, { origAmount: amt, origCurrency: c, rate: fx.rate });
  err.textContent = ""; $("desc").value = ""; $("amount").value = ""; preview();
  document.activeElement?.blur();
  act(() => api.addExpense(entry));
  toast(t("addedToast"));
});

// ---------- language ----------
function applyLanguage() {
  applyStatic();
  fillAllCurrencySelects();
  $("langSel").value = lang;
  $("inviteBtn").setAttribute("aria-label", t("copyInviteRow"));
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
  db = getFirestore(app);
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

// Block pinch-zoom on iOS Safari, which ignores user-scalable=no
document.addEventListener("gesturestart", e => e.preventDefault(), { passive: false });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
