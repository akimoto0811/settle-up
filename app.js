// Settle Up — shared bill splitting. Static app (GitHub Pages) + Firebase Firestore for live sync.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, setDoc, addDoc, deleteDoc, updateDoc, getDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { } }
};

// ---------- state ----------
let S = { id: null, name: "", currency: "USD", people: [], peopleDocs: [], expenses: [], loaded: { people: false } };
let unsubs = [];
let db, uid;
let forceJoin = false;

const me = () => S.peopleDocs.find(p => p.uid && p.uid === uid) || null;

// ---------- currencies ----------
const COMMON = ["USD", "EUR", "GBP", "JPY", "CNY", "HKD", "TWD", "KRW", "SGD", "MYR", "THB", "IDR", "PHP", "VND", "INR", "AUD", "NZD", "CAD", "CHF", "AED"];
const FALLBACK = ["AED", "ARS", "AUD", "BDT", "BGN", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "CZK", "DKK", "EGP", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KES", "KRW", "KHR", "LKR", "MAD", "MXN", "MYR", "NGN", "NOK", "NPR", "NZD", "PEN", "PHP", "PKR", "PLN", "QAR", "RON", "RSD", "RUB", "SAR", "SEK", "SGD", "THB", "TRY", "TWD", "UAH", "USD", "VND", "ZAR"];
const ALL = (() => { try { return Intl.supportedValuesOf("currency") } catch { return FALLBACK } })();
const names = (() => { try { return new Intl.DisplayNames([navigator.language || "en"], { type: "currency" }) } catch { return null } })();
const curName = c => { try { return names?.of(c) || c } catch { return c } };
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
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(amt) }
  catch { return amt.toFixed(digits(c)) + " " + c }
}
function fillCurrencySelect(sel, value) {
  const opt = c => `<option value="${c}">${c} · ${esc(curName(c))}</option>`;
  const common = COMMON.filter(c => ALL.includes(c));
  sel.innerHTML = `<optgroup label="Common">${common.map(opt).join("")}</optgroup><optgroup label="All currencies">${ALL.filter(c => !common.includes(c)).map(opt).join("")}</optgroup>`;
  if (value) sel.value = value;
}
document.querySelectorAll(".currency-select").forEach(s => fillCurrencySelect(s, "USD"));

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
  try { await fn(); status("") }
  catch (e) { console.error(e); status("Couldn't save that change. Check your connection and try again.", true) }
}
function show(view) { for (const v of ["startView", "joinView", "groupView"]) $(v).hidden = v !== view }

// ---------- routing ----------
const groupIdFromHash = () => (location.hash.match(/^#([A-Za-z0-9]{16,40})$/) || [])[1] || null;
window.addEventListener("hashchange", route);
$("homeLink").onclick = e => { e.preventDefault(); location.hash = "" };

function route() {
  unsubs.forEach(u => u()); unsubs = [];
  forceJoin = false;
  const gid = groupIdFromHash();
  if (!gid) return showStart();
  openGroup(gid);
}

function showStart() {
  show("startView");
  document.title = "Settle Up";
  const recent = store.get("settleup.recent", []);
  $("recentCard").hidden = !recent.length;
  $("recent").innerHTML = recent.map(g => `<a href="#${esc(g.id)}">${esc(g.name)}</a>`).join("");
}
function rememberGroup() {
  const recent = store.get("settleup.recent", []).filter(g => g.id !== S.id);
  recent.unshift({ id: S.id, name: S.name });
  store.set("settleup.recent", recent.slice(0, 12));
}

// ---------- create group ----------
$("createForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("groupName").value.trim(), founder = $("founderName").value.trim(), currency = $("newCurrency").value;
  const err = $("createErr");
  if (!name) return err.textContent = "Give the group a name.";
  if (!founder) return err.textContent = "Add your name so friends know who started it.";
  err.textContent = "";
  try {
    const gref = doc(collection(db, "groups"));
    await setDoc(gref, { name, currency, createdAt: serverTimestamp() });
    await addDoc(collection(gref, "people"), { name: founder, uid, createdAt: Date.now() });
    location.hash = gref.id;
    setTimeout(() => toast("Group created. Tap “Copy invite link” to share it."), 400);
  } catch (e2) { console.error(e2); err.textContent = "Couldn't create the group. Check your connection and the Firebase setup." }
});

// ---------- open group (live) ----------
async function openGroup(gid) {
  S = { id: gid, name: "", currency: "USD", people: [], peopleDocs: [], expenses: [], loaded: { people: false } };
  const gref = doc(db, "groups", gid);
  try {
    const snap = await getDoc(gref);
    if (!snap.exists()) { showStart(); status("This group link doesn't work. Ask the person who shared it to send it again.", true); return }
  } catch (e) { status("Couldn't load the group. Check your connection.", true); return }

  const onErr = e => { console.error(e); status("Lost connection. Changes will sync when you're back online.", true) };
  unsubs.push(onSnapshot(gref, s => {
    const d = s.data() || {}; S.name = d.name || "Group"; S.currency = d.currency || "USD";
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

// Decide which screen the group shows: join (no identity on this device yet) or the group itself
function update() {
  if (!S.id || !S.loaded.people) return;
  if (!me() || forceJoin) { renderJoin(); show("joinView") }
  else { show("groupView"); render() }
}

// ---------- join ----------
let armed = null;
function renderJoin() {
  $("joinGroupName").textContent = S.name;
  const mine = me();
  $("joinBack").hidden = !mine;
  $("joinList").innerHTML = S.peopleDocs.length ? S.peopleDocs.map(p => {
    const isMe = mine && p.id === mine.id, claimed = !!p.uid && !isMe;
    const tag = isMe ? "this device" : claimed ? (armed === p.id ? "Tap again if this is really you" : "joined on another device") : "tap to join";
    return `<button type="button" class="join-btn${claimed ? " claimed" : ""}${armed === p.id ? " confirm" : ""}" data-claim="${esc(p.id)}" ${isMe ? "disabled" : ""}><span class="nm">${esc(p.name)}</span><span class="tag">${tag}</span></button>`;
  }).join("") : `<p class="hint">No one has joined yet.</p>`;
  document.querySelectorAll("[data-claim]").forEach(b => b.onclick = () => {
    const p = S.peopleDocs.find(x => x.id === b.dataset.claim); if (!p) return;
    if (p.uid && armed !== p.id) { armed = p.id; renderJoin(); return }
    armed = null; claim(p);
  });
}
async function claim(p) {
  const old = me();
  await act(async () => {
    if (old && old.id !== p.id) await updateDoc(doc(db, "groups", S.id, "people", old.id), { uid: null });
    await updateDoc(doc(db, "groups", S.id, "people", p.id), { uid });
  });
  forceJoin = false; toast(`Welcome, ${p.name}`); update();
}
$("joinNewBtn").onclick = async () => {
  const n = $("joinName").value.trim(), err = $("joinErr");
  if (!n) return err.textContent = "Type your name first.";
  const existing = S.peopleDocs.find(p => p.name.toLowerCase() === n.toLowerCase());
  if (existing) return err.textContent = `${existing.name} is already in the list. Tap the name above instead.`;
  err.textContent = ""; $("joinName").value = "";
  const old = me();
  await act(async () => {
    if (old) await updateDoc(doc(db, "groups", S.id, "people", old.id), { uid: null });
    await addDoc(collection(db, "groups", S.id, "people"), { name: n, uid, createdAt: Date.now() });
  });
  forceJoin = false; toast(`Welcome, ${n}`);
};
$("joinName").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("joinNewBtn").click() } };
$("notMe").onclick = () => { forceJoin = true; armed = null; update() };
$("joinBack").onclick = e => { e.preventDefault(); forceJoin = false; armed = null; update() };

// ---------- actions ----------
const gcol = name => collection(db, "groups", S.id, name);
const api = {
  addPerson: name => addDoc(gcol("people"), { name, uid: null, createdAt: Date.now() }),
  removePerson: id => deleteDoc(doc(gcol("people"), id)),
  addExpense: e => { const m = me(); return addDoc(gcol("expenses"), { ...e, createdAt: Date.now(), addedBy: m.id, addedByName: m.name }) },
  deleteExpense: id => deleteDoc(doc(gcol("expenses"), id)),
  setCurrency: c => updateDoc(doc(db, "groups", S.id), { currency: c }),
};

// ---------- render group ----------
function render() {
  const mine = me(), myName = mine.name;
  $("gName").textContent = S.name;
  $("meName").textContent = myName;
  $("currency").value = S.currency;
  $("currency").disabled = S.expenses.length > 0;
  $("curNote").textContent = S.expenses.length ? "Locked once expenses are added." : "";

  const b = balances(S.people, S.expenses), tx = settle(b);
  $("txCount").textContent = tx.length ? `${tx.length} payment${tx.length > 1 ? "s" : ""}` : "";
  $("transfers").innerHTML = tx.length ? tx.map((t, k) => {
    const involved = t.from === myName || t.to === myName;
    return `<div class="tx${involved ? " mine" : ""}"><div class="who">${esc(t.from === myName ? "You" : t.from)}<span class="arrow">${t.from === myName ? "pay" : "pays"}</span>${esc(t.to === myName ? "you" : t.to)}</div><div class="amt num">${fmtMinor(t.cents)}</div>${involved ? `<button class="btn small ghost done-btn" data-pay="${k}" type="button">Mark as paid</button>` : ""}</div>`;
  }).join("")
    : `<div class="settled">${S.expenses.length ? "Everyone is even. Nothing to pay." : S.people.length < 2 ? "Send the invite link so friends can join, then log the first expense." : "Log an expense to see who owes whom."}</div>`;
  document.querySelectorAll("[data-pay]").forEach(btn => btn.onclick = () => {
    const t = tx[+btn.dataset.pay]; btn.disabled = true;
    act(() => api.addExpense({ desc: `Payment: ${t.from} → ${t.to}`, cents: t.cents, payer: t.from, split: [t.to], payment: true }));
  });

  const total = S.expenses.filter(e => !e.payment).reduce((s, e) => s + e.cents, 0);
  $("total").textContent = total ? `Total spent ${fmtMinor(total)}` : "";
  const max = Math.max(1, ...Object.values(b).map(Math.abs));
  $("balances").innerHTML = S.people.length ? S.people.map(p => {
    const v = b[p], w = Math.abs(v) / max * 50, cls = v > 0 ? "pos" : v < 0 ? "neg" : "zero";
    const bar = v ? `<i style="${v > 0 ? "left:50%" : "right:50%"};width:${w}%;background:var(${v > 0 ? "--get" : "--owe"})"></i>` : "";
    const label = v > 0 ? `gets ${fmtMinor(v)}` : v < 0 ? `owes ${fmtMinor(-v)}` : "even";
    return `<div class="bal-row"><span class="name" title="${esc(p)}">${esc(p)}${p === myName ? " (you)" : ""}</span><div class="bar">${bar}</div><span class="v num ${cls}">${label}</span></div>`;
  }).join("") : `<p class="empty">No one here yet.</p>`;

  // people: only names nobody has joined as (and not used in expenses) can be removed
  $("people").innerHTML = S.peopleDocs.map(p => {
    const used = S.expenses.some(e => e.payer === p.name || e.split.includes(p.name));
    const rm = !p.uid && !used ? `<button type="button" data-rm="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button>` : "";
    const tag = p.id === mine.id ? " (you)" : p.uid ? "" : " · invited";
    return `<span class="chip${rm ? "" : " fixed"}">${esc(p.name)}<span class="tagtxt">${tag}</span>${rm}</span>`;
  }).join("");
  document.querySelectorAll("[data-rm]").forEach(btn => btn.onclick = () => act(() => api.removePerson(btn.dataset.rm)));

  // split options, keeping current choices
  const prevSplit = new Set([...document.querySelectorAll("#splitOpts input:checked")].map(i => i.value));
  const known = new Set([...document.querySelectorAll("#splitOpts input")].map(i => i.value));
  $("splitOpts").innerHTML = S.people.map((p, i) => `<label><input type="checkbox" id="sp${i}" value="${esc(p)}" ${!known.has(p) || prevSplit.has(p) ? "checked" : ""}>${esc(p === myName ? p + " (you)" : p)}</label>`).join("");
  $("splitOpts").querySelectorAll("input").forEach(i => i.onchange = preview);
  initExpCurrency();
  preview();

  const n = S.expenses.length; $("expCount").textContent = n ? `${n} item${n > 1 ? "s" : ""}` : "";
  $("ledger").innerHTML = n ? [...S.expenses].sort((a, c) => (c.createdAt || 0) - (a.createdAt || 0)).map(e => {
    const each = e.split.length > 1 ? ` · ${fmtMinor(Math.ceil(e.cents / e.split.length))} each` : "";
    const meta = e.payment ? "Repayment" : `${esc(e.payer)} paid · split ${e.split.length === S.people.length ? "between everyone" : "with " + e.split.map(esc).join(", ")}${each}`;
    const fx = e.origCurrency && e.origCurrency !== S.currency ? `<span class="fxline num">Paid ${fmtAmount(e.origAmount, e.origCurrency)} · 1 ${e.origCurrency} = ${niceRate(e.rate)} ${S.currency}</span>` : "";
    const when = e.createdAt ? new Date(e.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    const by = [e.addedByName ? "Added by " + esc(e.addedByName) : "", when].filter(Boolean).join(" · ");
    const canDelete = !e.addedBy || e.addedBy === mine.id;
    return `<div class="exp"><span class="d">${esc(e.desc)}</span><span class="a num">${fmtMinor(e.cents)}</span><span class="meta">${meta}</span>${canDelete ? `<button class="link danger del" type="button" data-del="${esc(e.id)}">Delete</button>` : "<span></span>"}${fx}${by ? `<span class="by">${by}</span>` : ""}</div>`;
  }).join("") : `<p class="empty">No expenses yet. Whoever pays for something adds it here.</p>`;
  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.armed) return act(() => api.deleteExpense(btn.dataset.del));
      btn.dataset.armed = "1"; btn.textContent = "Tap again to delete";
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = "Delete" } }, 3000);
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
  $("fxNote").textContent = "Getting today's rate…";
  try {
    const { rate, updated } = await fetchRate(c, home);
    if (req !== fx.req || fx.edited) return;
    fx.rate = rate; $("fxRate").value = niceRate(rate);
    $("fxNote").textContent = `Market rate from ${new Date(updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. Change it to match your card or cash exchange rate.`;
  } catch {
    if (req !== fx.req) return;
    $("fxNote").textContent = "Couldn't get a rate right now. Type the rate you got.";
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
// amount in home-currency minor units, or 0 if not computable yet
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
  if (!cents) return $("preview").textContent = "Enter an exchange rate to convert this.";
  const conv = c !== S.currency ? `${fmtAmount(amt, c)} = ${fmtMinor(cents)}` : fmtMinor(cents);
  $("preview").textContent = s.length ? `${conv} · ÷ ${s.length} = about ${fmtMinor(Math.round(cents / s.length))} each` : conv;
}

// ---------- wiring ----------
$("amount").oninput = preview;
$("currency").onchange = e => act(() => api.setCurrency(e.target.value)).then(() => { fx.cur = null; $("expCurrency").dataset.group = "" });
$("shareBtn").onclick = async () => {
  const link = location.href.split("#")[0] + "#" + S.id;
  if (navigator.share) { try { await navigator.share({ title: S.name, text: `Join "${S.name}" on Settle Up`, url: link }); return } catch { } }
  try { await navigator.clipboard.writeText(link); toast("Invite link copied") }
  catch { prompt("Copy this link and send it to your friends:", link) }
};
function addPerson() {
  const n = $("newPerson").value.trim(), err = $("personErr");
  if (!n) return err.textContent = "Type a name first.";
  if (S.people.some(p => p.toLowerCase() === n.toLowerCase())) return err.textContent = `${n} is already on the list.`;
  err.textContent = ""; $("newPerson").value = ""; act(() => api.addPerson(n));
}
$("addPerson").onclick = addPerson;
$("newPerson").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addPerson() } };
$("selAll").onclick = () => { document.querySelectorAll("#splitOpts input").forEach(i => i.checked = true); preview() };
$("selNone").onclick = () => { document.querySelectorAll("#splitOpts input").forEach(i => i.checked = false); preview() };
$("expForm").addEventListener("submit", e => {
  e.preventDefault(); const err = $("expErr");
  const desc = $("desc").value.trim(), amt = parseAmount(), cents = homeCents(), split = checked(), c = $("expCurrency").value;
  if (S.people.length < 2) return err.textContent = "Wait for at least one friend to join, or add them under People.";
  if (!desc) return err.textContent = "Say what the expense was for.";
  if (!amt) return err.textContent = "Enter an amount greater than zero.";
  if (!cents) return err.textContent = "Enter the exchange rate so it can be converted.";
  if (!split.length) return err.textContent = "Pick at least one person to split with.";
  const entry = { desc, cents, payer: me().name, split };
  if (c !== S.currency) Object.assign(entry, { origAmount: amt, origCurrency: c, rate: fx.rate });
  err.textContent = ""; $("desc").value = ""; $("amount").value = ""; preview();
  act(() => api.addExpense(entry));
  toast("Expense added");
});

// ---------- boot ----------
if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE")) {
  status("Setup needed: paste your Firebase settings into firebase-config.js (see README).", true);
} else {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  const auth = getAuth(app);
  onAuthStateChanged(auth, u => { if (u && !uid) { uid = u.uid; route() } });
  signInAnonymously(auth).catch(e => { console.error(e); status("Couldn't connect. Make sure Anonymous sign-in is turned on in Firebase (see README).", true) });
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
