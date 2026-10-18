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

// ---------- state ----------
let S = blankGroup(null);
let unsubs = [];
let db, auth, uid = null, account = null;   // account = signed-in (non-anonymous) user, else null
let forceJoin = false, migrating = false;
function blankGroup(id) { return { id, name: "", currency: "USD", legacy: false, people: [], peopleDocs: [], expenses: [], loaded: { people: false } } }

const me = () => S.peopleDocs.find(p => p.uid && p.uid === uid) || null;
const amAdmin = () => { const m = me(); return !!m && m.role === "admin" };
const canEditGroup = () => amAdmin() || (S.legacy && !!me());

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
function fillCurrencySelect(sel, value) {
  const opt = c => `<option value="${c}">${c} · ${esc(curName(c))}</option>`;
  const common = COMMON.filter(c => ALL.includes(c));
  sel.innerHTML = `<optgroup label="${t("common")}">${common.map(opt).join("")}</optgroup><optgroup label="${t("allCurrencies")}">${ALL.filter(c => !common.includes(c)).map(opt).join("")}</optgroup>`;
  sel.value = value || "USD";
}
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
function status(msg, warn) { $("statusBanner").hidden = !msg; $("statusBanner").classList.toggle("warn", !!warn); $("statusText").textContent = msg || "" }
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200) }
async function act(fn) {
  try { const r = await fn(); status(""); return r }
  catch (e) { console.error(e); status(t("saveFail"), true) }
}
function show(view) { for (const v of ["startView", "joinView", "groupView"]) $(v).hidden = v !== view }

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

// ---------- routing ----------
const groupIdFromHash = () => (location.hash.match(/^#([A-Za-z0-9]{16,40})$/) || [])[1] || null;
window.addEventListener("hashchange", route);
$("homeLink").onclick = e => { e.preventDefault(); session.set("settleup.stayHome", "1"); location.hash = "" };

function route() {
  if (!uid) return;
  unsubs.forEach(u => u()); unsubs = [];
  forceJoin = false; selectedPerson = null;
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
  show("startView");
  document.title = "Settle Up";
  renderAccount();
  const local = store.get("settleup.recent", []);
  const remote = await myGroups();
  const seen = new Set(); const list = [];
  for (const g of [...remote.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)), ...local]) {
    if (!seen.has(g.id)) { seen.add(g.id); list.push(g) }
  }
  if (S.id) return; // user navigated into a group meanwhile
  $("recentCard").hidden = !list.length;
  $("recent").innerHTML = list.map(g => `<a href="#${esc(g.id)}">${esc(g.name || t("groupFallback"))}</a>`).join("");
}
function rememberGroup() {
  const recent = store.get("settleup.recent", []).filter(g => g.id !== S.id);
  recent.unshift({ id: S.id, name: S.name });
  store.set("settleup.recent", recent.slice(0, 20));
}

// ---------- accounts ----------
function renderAccount() {
  $("acctOut").hidden = !!account; $("acctIn").hidden = !account;
  if (account) $("acctEmail").textContent = account.email || account.displayName || t("acctFallback");
  $("acctErr").textContent = "";
}
// Sign in with an account, then move this device's group names over to it
async function signInWith(doSignIn) {
  const oldUid = uid, oldGroups = await myGroups(oldUid);
  migrating = true;
  try {
    const cred = await doSignIn();
    const newUid = cred.user.uid;
    if (newUid !== oldUid) await migrate(oldGroups, oldUid, newUid);
    toast(t("signedInToast"));
  } finally { migrating = false; uid = auth.currentUser?.uid || uid; route() }
}
async function migrate(groups, oldUid, newUid) {
  for (const g of groups) {
    try {
      if (!g.personId) continue;
      const pref = doc(db, "groups", g.id, "people", g.personId);
      const p = await getDoc(pref);
      if (!p.exists() || p.data().uid !== oldUid) continue;   // someone else holds this name now
      const b = writeBatch(db);
      b.update(pref, { uid: newUid });
      b.set(doc(db, "groups", g.id, "members", newUid), { personId: g.personId });
      b.set(doc(userGroupsCol(newUid), g.id), { name: g.name || "", personId: g.personId, openedAt: Date.now() });
      await b.commit();
    } catch (e) { console.warn("migrate", g.id, e) }
  }
}
$("googleBtn").onclick = () => signInWith(() => signInWithPopup(auth, new GoogleAuthProvider())).catch(e => {
  console.error(e);
  $("acctErr").textContent = e.code === "auth/popup-closed-by-user" ? "" : t("googleFail");
});
$("emailToggle").onclick = () => { $("emailForm").hidden = !$("emailForm").hidden; if (!$("emailForm").hidden) $("emailInput").focus() };
$("emailForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("emailInput").value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return $("acctErr").textContent = t("invalidEmail");
  try {
    await sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname + "?signin=1", handleCodeInApp: true });
    store.set("settleup.signinEmail", email);
    $("emailForm").hidden = true; $("emailSent").hidden = false; $("acctErr").textContent = "";
    $("emailSentText").textContent = t("emailSent", { email });
  } catch (err) { console.error(err); $("acctErr").textContent = t("emailFail") }
});
$("pasteBtn").onclick = () => {
  const link = $("pasteLink").value.trim();
  if (!isSignInWithEmailLink(auth, link)) return $("acctErr").textContent = t("notLink");
  finishEmail(link);
};
async function finishEmail(link, email = store.get("settleup.signinEmail", "")) {
  if (!email) { pendingLink = link; $("finishForm").hidden = false; show("startView"); return }
  try {
    await signInWith(() => signInWithEmailLink(auth, email, link));
    store.del("settleup.signinEmail"); $("finishForm").hidden = true; $("emailSent").hidden = true;
  } catch (e) {
    console.error(e);
    $("acctErr").textContent = e.code === "auth/invalid-action-code" ? t("linkExpired") : t("linkFail");
  }
}
let pendingLink = null;
$("finishForm").addEventListener("submit", e => { e.preventDefault(); const em = $("finishEmail").value.trim(); if (em && pendingLink) finishEmail(pendingLink, em) });
$("signOutBtn").onclick = async () => { store.del("settleup.last"); store.del("settleup.recent"); await signOut(auth) };
$("saveGroupsBtn").onclick = () => { session.set("settleup.stayHome", "1"); location.hash = ""; setTimeout(() => $("accountCard").scrollIntoView({ behavior: "smooth" }), 300) };

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
    b.set(gref, { name, currency, createdAt: serverTimestamp(), createdBy: uid });
    b.set(pref, { name: founder, uid, role: "admin", createdAt: Date.now() });
    b.set(doc(gref, "members", uid), { personId: pref.id });
    b.set(doc(userGroupsCol(uid), gref.id), { name, personId: pref.id, openedAt: Date.now() });
    await b.commit();
    $("groupName").value = ""; $("founderName").value = "";
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
    if (!snap.exists()) { store.del("settleup.last"); session.set("settleup.stayHome", "1"); location.hash = ""; status(t("badLink"), true); return }
  } catch (e) { status(t("loadFail"), true); return }
  if (S.id !== gid) return;
  const onErr = e => { console.error(e); status(t("offline"), true) };
  unsubs.push(onSnapshot(gref, s => {
    const d = s.data() || {}; S.name = d.name || t("groupFallback"); S.currency = d.currency || "USD"; S.legacy = !d.createdBy;
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
  if (!S.id || !S.loaded.people || migrating) return;
  const m = me();
  if (!m || forceJoin) { renderJoin(); show("joinView") }
  else { show("groupView"); render(); indexGroup(m.id) }
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
// Become person `pid` in this group (creating them when `create` is set), releasing any name held before
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
    return true;
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
$("notMe").onclick = () => { forceJoin = true; armed = null; update() };
$("joinBack").onclick = e => { e.preventDefault(); forceJoin = false; armed = null; update() };

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

// ---------- admin ----------
let selectedPerson = null;
function renderAdminPanel() {
  const panel = $("adminPanel"), p = S.peopleDocs.find(x => x.id === selectedPerson);
  if (!amAdmin() || !p) { panel.hidden = true; return }
  const mine = me(), isMe = p.id === mine.id;
  const used = S.expenses.some(e => e.payer === p.name || e.split.includes(p.name));
  const admins = S.peopleDocs.filter(x => x.role === "admin").length;
  const acts = [];
  {
    if (p.role !== "admin") acts.push(`<button class="btn small ghost" data-adm="promote" type="button">${t("makeAdmin")}</button>`);
    else if (!(isMe && admins <= 1)) acts.push(`<button class="btn small ghost" data-adm="demote" type="button">${t("removeAdmin")}</button>`);
  }
  if (p.uid && !isMe) acts.push(`<button class="btn small ghost" data-adm="unlink" type="button">${t("unlink")}</button>`);
  if (!used && !isMe) acts.push(`<button class="btn small ghost" data-adm="remove" type="button">${t("removeFromGroup")}</button>`);
  panel.hidden = false;
  panel.innerHTML = `<div><strong>${esc(p.name)}</strong> <span class="hint">${p.role === "admin" ? t("adminLabel") + " · " : ""}${p.uid ? (isMe ? t("tagYou") : t("joined")) : t("notJoined")}</span></div>
    ${acts.length ? `<div class="row-actions">${acts.join("")}</div>` : ""}
    ${used ? `<p class="hint">${t("usedNote", { name: esc(p.name) })}</p>` : ""}`;
  panel.querySelectorAll("[data-adm]").forEach(b => b.onclick = () => {
    const a = b.dataset.adm;
    if (a === "promote") act(() => api.updatePerson(p.id, { role: "admin" })).then(() => toast(t("promotedToast", { name: p.name })));
    if (a === "demote") act(() => api.updatePerson(p.id, { role: "member" }));
    if (a === "unlink") act(() => api.updatePerson(p.id, { uid: null })).then(() => toast(t("unlinkedToast", { name: p.name })));
    if (a === "remove") { if (b.dataset.armed) { selectedPerson = null; act(() => api.removePerson(p.id)) } else { b.dataset.armed = 1; b.textContent = t("tapAgainRemove") } }
  });
}
$("renameWrap").addEventListener("click", async e => {
  if (e.target.id === "renameBtn") {
    $("renameWrap").innerHTML = `<span class="inline"><input id="renameInput" maxlength="60" value="${esc(S.name)}"><button class="btn small primary" id="renameSave" type="button">${t("save")}</button></span>`;
    $("renameInput").focus();
  } else if (e.target.id === "renameSave") {
    const n = $("renameInput").value.trim();
    if (n && n !== S.name) await act(() => api.updateGroup({ name: n }));
    $("renameWrap").innerHTML = `<button class="link" id="renameBtn" type="button">${t("rename")}</button>`;
  }
});

// ---------- render group ----------
function render() {
  const mine = me(), myName = mine.name, admin = amAdmin();
  $("gName").textContent = S.name;
  $("meName").textContent = myName;
  $("adminTag").hidden = !(mine.role === "admin");
  $("saveNudge").hidden = !!account;
  $("currency").value = S.currency;
  const editGroup = canEditGroup();
  $("currency").disabled = S.expenses.length > 0 || !editGroup;
  $("curNote").textContent = S.expenses.length ? t("curLocked") : !editGroup ? t("curAdminOnly") : "";
  $("renameWrap").hidden = !editGroup;

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
    return `<div class="bal-row"><span class="name" title="${esc(p)}">${esc(p)}${p === myName ? t("youSuffix") : ""}</span><div class="bar">${bar}</div><span class="v num ${cls}">${label}</span></div>`;
  }).join("") : `<p class="empty">${t("noOneHere")}</p>`;

  // people chips: admins tap a name to manage it; others can remove invites nobody has joined as
  $("people").innerHTML = S.peopleDocs.map(p => {
    const used = S.expenses.some(e => e.payer === p.name || e.split.includes(p.name));
    const rm = !admin && !p.uid && !used ? `<button type="button" data-rm="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button>` : "";
    const tag = p.id === mine.id ? t("youSuffix") : p.uid ? "" : t("invited");
    const cls = `chip${rm ? "" : " fixed"}${admin ? " selectable" : ""}${selectedPerson === p.id ? " selected" : ""}`;
    return `<span class="${cls}" ${admin ? `data-sel="${esc(p.id)}" role="button" tabindex="0"` : ""}>${esc(p.name)}${p.role === "admin" ? ` <span class="badge">${t("admin")}</span>` : ""}<span class="tagtxt">${tag}</span>${rm}</span>`;
  }).join("");
  document.querySelectorAll("[data-rm]").forEach(btn => btn.onclick = () => act(() => api.removePerson(btn.dataset.rm)));
  document.querySelectorAll("[data-sel]").forEach(c => c.onclick = () => { selectedPerson = selectedPerson === c.dataset.sel ? null : c.dataset.sel; render() });
  $("peopleHint").textContent = admin ? t("peopleHintAdmin") : t("peopleHintMember");
  renderAdminPanel();

  // split options, keeping current choices
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
    const fx = e.origCurrency && e.origCurrency !== S.currency ? `<span class="fxline num">${t("paidOrig", { amount: fmtAmount(e.origAmount, e.origCurrency), from: e.origCurrency, rate: niceRate(e.rate), to: S.currency })}</span>` : "";
    const when = e.createdAt ? new Date(e.createdAt).toLocaleDateString(locale(), { month: "short", day: "numeric" }) : "";
    const by = [e.addedByName ? t("addedBy", { name: esc(e.addedByName) }) : "", when].filter(Boolean).join(" · ");
    const canDelete = !e.addedBy || e.addedBy === mine.id || admin;
    return `<div class="exp"><span class="d">${esc(e.desc)}</span><span class="a num">${fmtMinor(e.cents)}</span><span class="meta">${meta}</span>${canDelete ? `<button class="link danger del" type="button" data-del="${esc(e.id)}">${t("del")}</button>` : "<span></span>"}${fx}${by ? `<span class="by">${by}</span>` : ""}</div>`;
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

// ---------- wiring ----------
$("amount").oninput = preview;
$("currency").onchange = e => act(() => api.updateGroup({ currency: e.target.value })).then(() => { fx.cur = null; $("expCurrency").dataset.group = "" });
$("shareBtn").onclick = async () => {
  const link = location.href.split("#")[0].split("?")[0] + "#" + S.id;
  if (navigator.share) { try { await navigator.share({ title: S.name, text: t("shareText", { name: S.name }), url: link }); return } catch { } }
  try { await navigator.clipboard.writeText(link); toast(t("copied")) }
  catch { prompt(t("copyPrompt"), link) }
};
function addPerson() {
  const n = $("newPerson").value.trim(), err = $("personErr");
  if (!n) return err.textContent = t("errNameFirst");
  if (S.people.some(p => p.toLowerCase() === n.toLowerCase())) return err.textContent = t("errOnList", { name: n });
  err.textContent = ""; $("newPerson").value = ""; act(() => api.addPerson(n));
}
$("addPerson").onclick = addPerson;
$("newPerson").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addPerson() } };
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
  act(() => api.addExpense(entry));
  toast(t("addedToast"));
});

// ---------- language ----------
function applyLanguage() {
  applyStatic();
  fillAllCurrencySelects();
  $("langSel").value = lang;
  if (S.id && !$("groupView").hidden) render();
  else if (S.id && !$("joinView").hidden) renderJoin();
  if (!$("emailSent").hidden) $("emailSentText").textContent = t("emailSent", { email: store.get("settleup.signinEmail", "") });
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
  // Arriving from an email sign-in link
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
