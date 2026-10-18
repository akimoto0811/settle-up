// Settle Up — shared bill splitting. Static app (GitHub Pages) + Firebase Firestore for live sync.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, setDoc, addDoc, deleteDoc, updateDoc, getDoc,
  onSnapshot, writeBatch, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { } }
};

// ---------- state ----------
let S = { id: null, name: "", currency: "USD", people: [], expenses: [] };
let unsubs = [];
let db, uid;

// ---------- money helpers ----------
const zeroDec = () => S.currency === "JPY";
const unit = () => zeroDec() ? 1 : 100;
function fmt(c) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: S.currency, minimumFractionDigits: zeroDec() ? 0 : 2 }).format(c / unit()) }
  catch { return (c / unit()).toFixed(2) }
}
// Split cents fairly: leftover cents go to the first people in the list
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
// Greedy: biggest debtor pays biggest creditor until everyone is even
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
const meKey = () => "settleup.me." + S.id;
const me = () => store.get(meKey(), "");

// ---------- routing ----------
const groupIdFromHash = () => (location.hash.match(/^#([A-Za-z0-9]{16,40})$/) || [])[1] || null;
window.addEventListener("hashchange", route);
$("homeLink").onclick = e => { e.preventDefault(); location.hash = "" };

function route() {
  unsubs.forEach(u => u()); unsubs = [];
  const gid = groupIdFromHash();
  if (!gid) return showStart();
  openGroup(gid);
}

function showStart() {
  $("groupView").hidden = true; $("startView").hidden = false;
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
    await setDoc(gref, { name, currency, createdAt: serverTimestamp(), createdBy: uid });
    await addDoc(collection(gref, "people"), { name: founder, createdAt: Date.now() });
    store.set("settleup.me." + gref.id, founder);
    location.hash = gref.id;
    setTimeout(() => toast("Group created. Tap “Copy invite link” to share it."), 400);
  } catch (e2) { console.error(e2); err.textContent = "Couldn't create the group. Check your connection and the Firebase setup." }
});

// ---------- open group (live) ----------
async function openGroup(gid) {
  $("startView").hidden = true; $("groupView").hidden = false;
  S = { id: gid, name: "", currency: "USD", people: [], expenses: [] };
  let peopleDocs = [];
  const gref = doc(db, "groups", gid);
  try {
    const snap = await getDoc(gref);
    if (!snap.exists()) { status("This group link doesn't work. Ask the person who shared it to send it again.", true); $("groupView").hidden = true; $("startView").hidden = false; showStart(); return }
  } catch (e) { status("Couldn't load the group. Check your connection.", true); return }

  const onErr = e => { console.error(e); status("Lost connection. Changes will sync when you're back online.", true) };
  unsubs.push(onSnapshot(gref, s => {
    const d = s.data() || {}; S.name = d.name || "Group"; S.currency = d.currency || "USD";
    document.title = S.name + " · Settle Up"; rememberGroup(); render();
  }, onErr));
  unsubs.push(onSnapshot(collection(gref, "people"), s => {
    peopleDocs = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    S.people = peopleDocs.map(p => p.name); S.peopleDocs = peopleDocs; render();
  }, onErr));
  unsubs.push(onSnapshot(collection(gref, "expenses"), s => {
    S.expenses = s.docs.map(d => ({ id: d.id, ...d.data() })); render();
  }, onErr));
}

// ---------- actions ----------
const gcol = name => collection(db, "groups", S.id, name);
const api = {
  addPerson: name => addDoc(gcol("people"), { name, createdAt: Date.now() }),
  removePerson: name => { const d = S.peopleDocs.find(x => x.name === name); return d && deleteDoc(doc(gcol("people"), d.id)) },
  addExpense: e => addDoc(gcol("expenses"), { ...e, createdAt: Date.now(), addedBy: me() || null }),
  deleteExpense: id => deleteDoc(doc(gcol("expenses"), id)),
  setCurrency: c => updateDoc(doc(db, "groups", S.id), { currency: c }),
};

// ---------- render ----------
function render() {
  if (!S.id) return;
  $("gName").textContent = S.name;
  $("currency").value = S.currency;

  // who am I
  const mine = me();
  $("meSel").innerHTML = `<option value="">choose your name</option>` + S.people.map(p => `<option ${p === mine ? "selected" : ""}>${esc(p)}</option>`).join("");

  const b = balances(S.people, S.expenses), tx = settle(b);
  $("txCount").textContent = tx.length ? `${tx.length} payment${tx.length > 1 ? "s" : ""}` : "";
  $("transfers").innerHTML = tx.length ? tx.map((t, k) => `<div class="tx${t.from === mine || t.to === mine ? " mine" : ""}"><div class="who">${esc(t.from)}<span class="arrow">pays</span>${esc(t.to)}</div><div class="amt num">${fmt(t.cents)}</div><button class="btn small ghost done-btn" data-pay="${k}" type="button">Mark as paid</button></div>`).join("")
    : `<div class="settled">${S.expenses.length ? "Everyone is even. Nothing to pay." : S.people.length < 2 ? "Add your friends under People, then log the first expense." : "Log an expense to see who owes whom."}</div>`;
  document.querySelectorAll("[data-pay]").forEach(btn => btn.onclick = () => {
    const t = tx[+btn.dataset.pay]; btn.disabled = true;
    act(() => api.addExpense({ desc: `Payment: ${t.from} → ${t.to}`, cents: t.cents, payer: t.from, split: [t.to], payment: true }));
  });

  const total = S.expenses.filter(e => !e.payment).reduce((s, e) => s + e.cents, 0);
  $("total").textContent = total ? `Total spent ${fmt(total)}` : "";
  const max = Math.max(1, ...Object.values(b).map(Math.abs));
  $("balances").innerHTML = S.people.length ? S.people.map(p => {
    const v = b[p], w = Math.abs(v) / max * 50, cls = v > 0 ? "pos" : v < 0 ? "neg" : "zero";
    const bar = v ? `<i style="${v > 0 ? "left:50%" : "right:50%"};width:${w}%;background:var(${v > 0 ? "--get" : "--owe"})"></i>` : "";
    const label = v > 0 ? `gets ${fmt(v)}` : v < 0 ? `owes ${fmt(-v)}` : "even";
    return `<div class="bal-row"><span class="name" title="${esc(p)}">${esc(p)}${p === mine ? " (you)" : ""}</span><div class="bar">${bar}</div><span class="v num ${cls}">${label}</span></div>`;
  }).join("") : `<p class="empty">No one here yet.</p>`;

  $("people").innerHTML = S.people.map(p => `<span class="chip">${esc(p)}<button type="button" data-rm="${esc(p)}" aria-label="Remove ${esc(p)}">×</button></span>`).join("");
  document.querySelectorAll("[data-rm]").forEach(btn => btn.onclick = () => {
    const p = btn.dataset.rm;
    if (S.expenses.some(e => e.payer === p || e.split.includes(p))) { $("personErr").textContent = `${p} is on an expense. Delete those expenses first.`; return }
    $("personErr").textContent = ""; act(() => api.removePerson(p));
  });

  // form options, keeping the user's current choices
  const prevPayer = $("payer").value, prevSplit = new Set([...document.querySelectorAll("#splitOpts input:checked")].map(i => i.value));
  const known = new Set([...document.querySelectorAll("#splitOpts input")].map(i => i.value));
  $("payer").innerHTML = S.people.map(p => `<option>${esc(p)}</option>`).join("");
  if (S.people.includes(prevPayer)) $("payer").value = prevPayer; else if (S.people.includes(mine)) $("payer").value = mine;
  $("splitOpts").innerHTML = S.people.map((p, i) => `<label><input type="checkbox" id="sp${i}" value="${esc(p)}" ${!known.has(p) || prevSplit.has(p) ? "checked" : ""}>${esc(p)}</label>`).join("");
  $("splitOpts").querySelectorAll("input").forEach(i => i.onchange = preview);
  preview();

  const n = S.expenses.length; $("expCount").textContent = n ? `${n} item${n > 1 ? "s" : ""}` : "";
  $("ledger").innerHTML = n ? [...S.expenses].sort((a, c) => (c.createdAt || 0) - (a.createdAt || 0)).map(e => {
    const each = e.split.length > 1 ? ` · ${fmt(Math.ceil(e.cents / e.split.length))} each` : "";
    const meta = e.payment ? "Repayment" : `${esc(e.payer)} paid · split ${e.split.length === S.people.length ? "between everyone" : "with " + e.split.map(esc).join(", ")}${each}`;
    const when = e.createdAt ? new Date(e.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    const by = [e.addedBy ? "Added by " + esc(e.addedBy) : "", when].filter(Boolean).join(" · ");
    return `<div class="exp"><span class="d">${esc(e.desc)}</span><span class="a num">${fmt(e.cents)}</span><span class="meta">${meta}</span><button class="link danger del" type="button" data-del="${esc(e.id)}">Delete</button>${by ? `<span class="by">${by}</span>` : ""}</div>`;
  }).join("") : `<p class="empty">No expenses yet. Whoever pays for something adds it here.</p>`;
  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.armed) return act(() => api.deleteExpense(btn.dataset.del));
      btn.dataset.armed = "1"; btn.textContent = "Tap again to delete";
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = "Delete" } }, 3000);
    };
  });
}

function parseCents() { const n = parseFloat($("amount").value.replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? Math.round(n * unit()) : 0 }
const checked = () => [...document.querySelectorAll("#splitOpts input:checked")].map(i => i.value);
function preview() { const c = parseCents(), s = checked(); $("preview").textContent = c && s.length ? `${fmt(c)} ÷ ${s.length} = about ${fmt(Math.round(c / s.length))} each` : "" }

// ---------- wiring ----------
$("amount").oninput = preview;
$("currency").onchange = e => act(() => api.setCurrency(e.target.value));
$("meSel").onchange = e => { store.set(meKey(), e.target.value); render() };
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
  const desc = $("desc").value.trim(), cents = parseCents(), payer = $("payer").value, split = checked();
  if (S.people.length < 2) return err.textContent = "Add at least two people first.";
  if (!desc) return err.textContent = "Say what the expense was for.";
  if (!cents) return err.textContent = "Enter an amount greater than zero.";
  if (!split.length) return err.textContent = "Pick at least one person to split with.";
  err.textContent = ""; $("desc").value = ""; $("amount").value = ""; preview();
  act(() => api.addExpense({ desc, cents, payer, split }));
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
