// js/firebase-service.js — autenticación y persistencia
// Si firebase-config tiene credenciales reales → usa Firebase (nube + login).
// Si no → modo local con localStorage (un solo usuario en este navegador).

import { firebaseConfig, FIREBASE_READY } from "../firebase-config.js";
import { DEFAULT_CATS } from "./config.js";

let fb = null; // { app, auth, db, fns... }

/* ---------- Inicialización dinámica de Firebase ---------- */
async function initFirebase() {
  if (fb) return fb;
  const appMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const authMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  const fsMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const db = fsMod.getFirestore(app);
  fb = { auth, db, authMod, fsMod };
  return fb;
}

export const isCloud = () => FIREBASE_READY;

/* ============================================================
   API pública: onAuth, signUp, signIn, signOut, load, save
   ============================================================ */

export function onAuth(cb) {
  if (FIREBASE_READY) {
    initFirebase().then(({ auth, authMod }) => {
      authMod.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null));
    });
  } else {
    // modo local: sesión guardada en localStorage
    const raw = localStorage.getItem("fz_local_user");
    cb(raw ? JSON.parse(raw) : null);
  }
}

export async function signUp(email, password) {
  if (FIREBASE_READY) {
    const { auth, authMod } = await initFirebase();
    const cred = await authMod.createUserWithEmailAndPassword(auth, email, password);
    return { uid: cred.user.uid, email: cred.user.email };
  }
  const user = { uid: "local-" + btoa(email).slice(0, 10), email };
  localStorage.setItem("fz_local_user", JSON.stringify(user));
  return user;
}

export async function signIn(email, password) {
  if (FIREBASE_READY) {
    const { auth, authMod } = await initFirebase();
    const cred = await authMod.signInWithEmailAndPassword(auth, email, password);
    return { uid: cred.user.uid, email: cred.user.email };
  }
  const user = { uid: "local-" + btoa(email).slice(0, 10), email };
  localStorage.setItem("fz_local_user", JSON.stringify(user));
  return user;
}

export async function signInWithGoogle() {
  if (!FIREBASE_READY) throw new Error("google-needs-cloud");
  const { auth, authMod } = await initFirebase();
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await authMod.signInWithPopup(auth, provider);
  return { uid: cred.user.uid, email: cred.user.email };
}

export async function signOutUser() {
  if (FIREBASE_READY) {
    const { auth, authMod } = await initFirebase();
    await authMod.signOut(auth);
  } else {
    localStorage.removeItem("fz_local_user");
  }
}

/* ---------- Carga de datos ---------- */
export async function loadData(uid) {
  if (FIREBASE_READY) {
    const { db, fsMod } = await initFirebase();
    const docRef = fsMod.doc(db, "users", uid);
    const snap = await fsMod.getDoc(docRef);
    const base = snap.exists() ? snap.data() : null;
    // transacciones en subcolección
    const txCol = fsMod.collection(db, "users", uid, "transactions");
    const txSnap = await fsMod.getDocs(txCol);
    const txs = [];
    txSnap.forEach((d) => txs.push({ id: d.id, ...d.data() }));
    const incCol = fsMod.collection(db, "users", uid, "incomes");
    const incSnap = await fsMod.getDocs(incCol);
    const incomes = [];
    incSnap.forEach((d) => incomes.push({ id: d.id, ...d.data() }));
    return {
      profile: base?.profile || { name: "", income: 6000000 },
      cats: base?.cats || structuredClone(DEFAULT_CATS),
      budgets: base?.budgets || {},
      accounts: base?.accounts || [],
      payMethods: base?.payMethods || [],
      vehiclesEnabled: base?.vehiclesEnabled || false,
      vehicles: base?.vehicles || [],
      goals: base?.goals || [],
      txs, incomes,
      isNew: !snap.exists(),
    };
  }
  const raw = localStorage.getItem("fz_data_" + uid);
  if (!raw) return { profile: { name: "", income: 6000000 }, cats: structuredClone(DEFAULT_CATS), budgets: {}, accounts: [], payMethods: [], vehiclesEnabled: false, vehicles: [], goals: [], txs: [], incomes: [], isNew: true };
  const d = JSON.parse(raw);
  return { ...d, isNew: false };
}

/* ---------- Suscripción en vivo (tiempo real con onSnapshot) ----------
   Mantiene la pantalla sincronizada con Firebase: cualquier cambio hecho en
   otro dispositivo llega solo. Devuelve una función para cancelar (unsubscribe).
   En modo local no hay sincronización entre equipos: carga una sola vez. */
export function subscribeData(uid, onData) {
  if (!FIREBASE_READY) {
    loadData(uid).then(onData);
    return () => {};
  }

  let stop = false;
  const unsubs = [];
  let base = null, baseExists = false;
  let txs = [], incomes = [];
  let gotBase = false, gotTx = false, gotInc = false;

  const emit = (fromRemote) => {
    if (stop || !(gotBase && gotTx && gotInc)) return; // espera la 1ª señal de cada uno
    onData({
      profile: base?.profile || { name: "", income: 6000000 },
      cats: base?.cats || structuredClone(DEFAULT_CATS),
      budgets: base?.budgets || {},
      accounts: base?.accounts || [],
      payMethods: base?.payMethods || [],
      vehiclesEnabled: base?.vehiclesEnabled || false,
      vehicles: base?.vehicles || [],
      goals: base?.goals || [],
      txs: txs.slice(),
      incomes: incomes.slice(),
      isNew: !baseExists,
      fromRemote, // false = carga inicial; true = cambio en vivo
    });
  };

  initFirebase().then(({ db, fsMod }) => {
    if (stop) return;
    const { doc, collection, onSnapshot } = fsMod;

    unsubs.push(onSnapshot(doc(db, "users", uid), (snap) => {
      const fromRemote = gotBase;
      base = snap.exists() ? snap.data() : null;
      baseExists = snap.exists();
      gotBase = true;
      if (snap.metadata.hasPendingWrites && fromRemote) return; // ignora eco de tu propia escritura
      emit(fromRemote);
    }));

    unsubs.push(onSnapshot(collection(db, "users", uid, "transactions"), (snap) => {
      const fromRemote = gotTx;
      const arr = []; snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      txs = arr; gotTx = true;
      if (snap.metadata.hasPendingWrites && fromRemote) return;
      emit(fromRemote);
    }));

    unsubs.push(onSnapshot(collection(db, "users", uid, "incomes"), (snap) => {
      const fromRemote = gotInc;
      const arr = []; snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      incomes = arr; gotInc = true;
      if (snap.metadata.hasPendingWrites && fromRemote) return;
      emit(fromRemote);
    }));
  });

  return () => { stop = true; unsubs.forEach((u) => { try { u(); } catch {} }); };
}

/* ---------- Guardado de config (profile, cats, budgets) ---------- */
export async function saveConfig(uid, { profile, cats, budgets, accounts, payMethods, vehicles, vehiclesEnabled, goals }) {
  if (FIREBASE_READY) {
    const { db, fsMod } = await initFirebase();
    const payload = { profile, cats, budgets };
    if (accounts !== undefined) payload.accounts = accounts;
    if (payMethods !== undefined) payload.payMethods = payMethods;
    if (vehicles !== undefined) payload.vehicles = vehicles;
    if (vehiclesEnabled !== undefined) payload.vehiclesEnabled = vehiclesEnabled;
    if (goals !== undefined) payload.goals = goals;
    await fsMod.setDoc(fsMod.doc(db, "users", uid), payload, { merge: true });
  } else {
    persistLocal(uid);
  }
}

/* ---------- Transacciones ---------- */
export async function addTx(uid, tx) {
  if (FIREBASE_READY) {
    const { db, fsMod } = await initFirebase();
    const ref = fsMod.doc(db, "users", uid, "transactions", tx.id);
    await fsMod.setDoc(ref, { date: tx.date, desc: tx.desc, amount: tx.amount, cat: tx.cat, sub: tx.sub, pay: tx.pay || "", acct: tx.acct || "", vehicleId: tx.vehicleId || "", fuelId: tx.fuelId || "" });
  } else { persistLocal(uid); }
}

export async function deleteTx(uid, txId) {
  if (FIREBASE_READY) {
    const { db, fsMod } = await initFirebase();
    await fsMod.deleteDoc(fsMod.doc(db, "users", uid, "transactions", txId));
  } else { persistLocal(uid); }
}

// actualiza solo las transacciones dadas (sin borrar el resto) — para migrar categorías
export async function bulkUpdateTx(uid, txs) {
  if (!FIREBASE_READY) return;
  const { db, fsMod } = await initFirebase();
  let batch = fsMod.writeBatch(db), n = 0;
  for (const tx of txs) {
    batch.set(fsMod.doc(db, "users", uid, "transactions", tx.id), { date: tx.date, desc: tx.desc, amount: tx.amount, cat: tx.cat, sub: tx.sub, pay: tx.pay || "", acct: tx.acct || "", vehicleId: tx.vehicleId || "", fuelId: tx.fuelId || "" });
    if (++n >= 400) { await batch.commit(); batch = fsMod.writeBatch(db); n = 0; }
  }
  if (n) await batch.commit();
}

export async function bulkSetTx(uid, txs) {
  if (FIREBASE_READY) {
    const { db, fsMod } = await initFirebase();
    // borra existentes
    const col = fsMod.collection(db, "users", uid, "transactions");
    const snap = await fsMod.getDocs(col);
    let batch = fsMod.writeBatch(db); let n = 0;
    for (const d of snap.docs) { batch.delete(d.ref); if (++n >= 400) { await batch.commit(); batch = fsMod.writeBatch(db); n = 0; } }
    if (n) await batch.commit();
    // inserta nuevos
    batch = fsMod.writeBatch(db); n = 0;
    for (const tx of txs) {
      batch.set(fsMod.doc(db, "users", uid, "transactions", tx.id), { date: tx.date, desc: tx.desc, amount: tx.amount, cat: tx.cat, sub: tx.sub });
      if (++n >= 400) { await batch.commit(); batch = fsMod.writeBatch(db); n = 0; }
    }
    if (n) await batch.commit();
  } else { persistLocal(uid); }
}

/* ---------- Ingresos ---------- */
export async function addIncome(uid, inc) {
  if (FIREBASE_READY) {
    const { db, fsMod } = await initFirebase();
    await fsMod.setDoc(fsMod.doc(db, "users", uid, "incomes", inc.id), { date: inc.date, desc: inc.desc, amount: inc.amount, type: inc.type });
  } else { persistLocal(uid); }
}
export async function deleteIncome(uid, incId) {
  if (FIREBASE_READY) {
    const { db, fsMod } = await initFirebase();
    await fsMod.deleteDoc(fsMod.doc(db, "users", uid, "incomes", incId));
  } else { persistLocal(uid); }
}
export async function bulkSetIncomes(uid, incomes) {
  if (FIREBASE_READY) {
    const { db, fsMod } = await initFirebase();
    const col = fsMod.collection(db, "users", uid, "incomes");
    const snap = await fsMod.getDocs(col);
    let batch = fsMod.writeBatch(db); let n = 0;
    for (const d of snap.docs) { batch.delete(d.ref); if (++n >= 400) { await batch.commit(); batch = fsMod.writeBatch(db); n = 0; } }
    if (n) await batch.commit();
    batch = fsMod.writeBatch(db); n = 0;
    for (const inc of incomes) {
      batch.set(fsMod.doc(db, "users", uid, "incomes", inc.id), { date: inc.date, desc: inc.desc, amount: inc.amount, type: inc.type });
      if (++n >= 400) { await batch.commit(); batch = fsMod.writeBatch(db); n = 0; }
    }
    if (n) await batch.commit();
  } else { persistLocal(uid); }
}

/* ---------- Combustible (subcolección users/{uid}/fuel) ---------- */
export async function loadFuel(uid) {
  if (FIREBASE_READY) {
    const { db, fsMod } = await initFirebase();
    const snap = await fsMod.getDocs(fsMod.collection(db, "users", uid, "fuel"));
    const arr = []; snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    return arr;
  }
  const raw = localStorage.getItem("fz_fuel_" + uid);
  return raw ? JSON.parse(raw) : [];
}
export async function addFuel(uid, rec) {
  if (!FIREBASE_READY) return;
  const { db, fsMod } = await initFirebase();
  const { id, ...rest } = rec;
  await fsMod.setDoc(fsMod.doc(db, "users", uid, "fuel", id), rest);
}
export async function deleteFuel(uid, id) {
  if (!FIREBASE_READY) return;
  const { db, fsMod } = await initFirebase();
  await fsMod.deleteDoc(fsMod.doc(db, "users", uid, "fuel", id));
}
export async function bulkSetFuel(uid, vehicleId, recs) {
  if (!FIREBASE_READY) return;
  const { db, fsMod } = await initFirebase();
  const col = fsMod.collection(db, "users", uid, "fuel");
  const snap = await fsMod.getDocs(col);
  let batch = fsMod.writeBatch(db), n = 0;
  for (const d of snap.docs) {
    if (d.data().vehicleId === vehicleId) { batch.delete(d.ref); if (++n >= 400) { await batch.commit(); batch = fsMod.writeBatch(db); n = 0; } }
  }
  if (n) await batch.commit();
  batch = fsMod.writeBatch(db); n = 0;
  for (const r of recs) {
    const { id, ...rest } = r;
    batch.set(fsMod.doc(db, "users", uid, "fuel", id), rest);
    if (++n >= 400) { await batch.commit(); batch = fsMod.writeBatch(db); n = 0; }
  }
  if (n) await batch.commit();
}
export async function updateFuel(uid, id, fields) {
  if (!FIREBASE_READY) return;
  const { db, fsMod } = await initFirebase();
  await fsMod.setDoc(fsMod.doc(db, "users", uid, "fuel", id), fields, { merge: true });
}
export function persistFuelLocal(uid, arr) {
  if (!FIREBASE_READY) localStorage.setItem("fz_fuel_" + uid, JSON.stringify(arr));
}

/* ---------- Mantenimiento (subcolección users/{uid}/maintenance) ---------- */
export async function loadMaint(uid) {
  if (FIREBASE_READY) {
    const { db, fsMod } = await initFirebase();
    const snap = await fsMod.getDocs(fsMod.collection(db, "users", uid, "maintenance"));
    const arr = []; snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    return arr;
  }
  const raw = localStorage.getItem("fz_maint_" + uid);
  return raw ? JSON.parse(raw) : [];
}
export async function addMaint(uid, rec) {
  if (!FIREBASE_READY) return;
  const { db, fsMod } = await initFirebase();
  const { id, ...rest } = rec;
  await fsMod.setDoc(fsMod.doc(db, "users", uid, "maintenance", id), rest);
}
export async function deleteMaint(uid, id) {
  if (!FIREBASE_READY) return;
  const { db, fsMod } = await initFirebase();
  await fsMod.deleteDoc(fsMod.doc(db, "users", uid, "maintenance", id));
}
export function persistMaintLocal(uid, arr) {
  if (!FIREBASE_READY) localStorage.setItem("fz_maint_" + uid, JSON.stringify(arr));
}

/* ---------- Obligaciones legales (subcolección users/{uid}/obligations) ---------- */
export async function loadOblig(uid) {
  if (FIREBASE_READY) {
    const { db, fsMod } = await initFirebase();
    const snap = await fsMod.getDocs(fsMod.collection(db, "users", uid, "obligations"));
    const arr = []; snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    return arr;
  }
  const raw = localStorage.getItem("fz_oblig_" + uid);
  return raw ? JSON.parse(raw) : [];
}
export async function addOblig(uid, rec) {
  if (!FIREBASE_READY) return;
  const { db, fsMod } = await initFirebase();
  const { id, ...rest } = rec;
  await fsMod.setDoc(fsMod.doc(db, "users", uid, "obligations", id), rest);
}
export async function deleteOblig(uid, id) {
  if (!FIREBASE_READY) return;
  const { db, fsMod } = await initFirebase();
  await fsMod.deleteDoc(fsMod.doc(db, "users", uid, "obligations", id));
}
export function persistObligLocal(uid, arr) {
  if (!FIREBASE_READY) localStorage.setItem("fz_oblig_" + uid, JSON.stringify(arr));
}

/* ---------- persistencia local (modo sin Firebase) ---------- */
let _stateGetter = null;
export function bindLocalState(getter) { _stateGetter = getter; }
function persistLocal(uid) {
  if (!_stateGetter) return;
  const s = _stateGetter();
  localStorage.setItem("fz_data_" + uid, JSON.stringify({ profile: s.profile, cats: s.cats, budgets: s.budgets, accounts: s.accounts, payMethods: s.payMethods, vehicles: s.vehicles, vehiclesEnabled: s.vehiclesEnabled, goals: s.goals, txs: s.txs, incomes: s.incomes }));
}
export function forcePersistLocal(uid) { if (!FIREBASE_READY) persistLocal(uid); }
