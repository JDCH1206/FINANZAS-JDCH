// js/state.js — estado global reactivo simple

import { DEFAULT_CATS } from "./config.js";

const state = {
  user: null,            // { uid, email }
  cloud: false,          // true si Firebase está activo
  loading: true,
  route: "home",
  profile: { name: "", income: 6000000 },
  cats: structuredClone(DEFAULT_CATS),
  txs: [],               // [{id, date, desc, amount, cat, sub}]
  incomes: [],           // [{id, date, desc, amount, type}]
  accounts: [],          // [{id, name, type, balance}]
  budgets: {},           // { 'YYYY-MM': { catName: amount } }
  payMethods: [],        // medios de pago personalizados (extienden los base)
  vehiclesEnabled: false,// módulo opcional de vehículos
  vehicles: [],          // [{ id, tipo, alias, placa, ... }]
  goals: [],             // metas de ahorro [{ id, nombre, objetivo, ahorrado, fecha }]
  recurrentes: [],       // gastos recurrentes [{ id, desc, amount, cat, sub, pay, acct, day, lastGen }]
};

const listeners = new Set();

export function getState() { return state; }

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// helpers de mutación de datos
export function setData({ profile, cats, txs, incomes, accounts, budgets, payMethods }) {
  if (profile) state.profile = profile;
  if (cats) state.cats = cats;
  if (txs) state.txs = txs;
  if (incomes) state.incomes = incomes;
  if (accounts) state.accounts = accounts;
  if (payMethods) state.payMethods = payMethods;
  if (budgets) state.budgets = budgets;
  listeners.forEach((fn) => fn(state));
}

export function dataSnapshot() {
  const { profile, cats, txs, incomes, accounts, budgets, payMethods, vehicles, vehiclesEnabled, goals, recurrentes } = state;
  return { profile, cats, txs, incomes, accounts, budgets, payMethods, vehicles, vehiclesEnabled, goals, recurrentes };
}
