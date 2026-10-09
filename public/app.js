// Garage: car maintenance tracker front end. No framework, no build step.

import {
  toISO, daysBetween, mileage as calcMileage, itemStatus as calcItemStatus, reminderStatus,
  num, fmtMiles, fmtDate, fmtMonth, dueText, leftText,
} from './lib/maint.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const TABS = ['overview', 'history', 'schedule', 'codes', 'docs', 'car'];

const state = {
  vehicles: [],
  vid: null,
  data: null,           // { vehicle, items, services, documents, odometer, reminders, recalls, specs }
  miles: null,          // { latest, rate, estimate, estimated } for the current car
  config: { scan: false, email: false },
  tab: 'overview',
};

// ------------------------------------------------------------------ api

async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, init);
  const ct = res.headers.get('Content-Type') || '';
  const data = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// ------------------------------------------------------------------ formatting

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtMoney = (cents) => (cents == null ? '' : (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const todayStr = () => toISO(new Date());

function fmtSize(b) {
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}
function intervalText(it) {
  const parts = [];
  if (it.interval_miles) parts.push(`${num(it.interval_miles)} mi`);
  if (it.interval_months) parts.push(monthsText(it.interval_months));
  return parts.length ? `Every ${parts.join(' or ')}` : 'As needed';
}
function monthsText(m) {
  return m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} months`;
}
function firstText(it) {
  if (!it.first_miles && !it.first_months) return '';
  const parts = [];
  if (it.first_miles) parts.push(`${num(it.first_miles)} mi`);
  if (it.first_months) parts.push(monthsText(it.first_months));
  return `First at ${parts.join(' or ')}`;
}
function serviceTitle(s, items = state.data.items) {
  const names = s.item_ids.map((id) => items.find((i) => i.id === id)?.name).filter(Boolean);
  if (s.title) names.push(s.title);
  return names.join(', ') || 'Service';
}
function carLabel(v) {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
}
function reminderText(r, st) {
  if (r.kind === 'warranty') {
    const limits = [st.endDate && fmtDate(st.endDate), r.miles_limit && fmtMiles(r.miles_limit)].filter(Boolean);
    if (st.status === 'expired') return `Ended at ${limits.join(' or ')}`;
    const base = limits.length ? `Ends ${limits.join(' or ')}` : (r.months ? `${r.months / 12} years from in-service date` : 'No limits set');
    const left = leftText(st);
    return `${base}${left ? ` · ${left}` : ''}`;
  }
  if (!r.due_date) return 'No date set';
  const d = st.daysLeft;
  return d < 0 ? `Was due ${fmtDate(r.due_date)}` : `Due ${fmtDate(r.due_date)}${d <= 60 ? ` · ${d} day${d === 1 ? '' : 's'}` : ''}`;
}

// ------------------------------------------------------------------ maintenance status

// Estimated odometer today (falls back to the last known reading).
function currentMiles() {
  return state.miles?.estimate || 0;
}
const itemStatus = (it) => calcItemStatus(it, state.data, todayStr(), state.miles);

// ------------------------------------------------------------------ boot

async function boot() {
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#car-select').addEventListener('change', (e) => selectVehicle(Number(e.target.value)));
  $('#log-btn').addEventListener('click', () => openServiceForm());
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

  const fromHash = location.hash.slice(1);
  state.tab = TABS.includes(fromHash) ? fromHash : store('tab') || 'overview';
  window.addEventListener('hashchange', () => {
    const t = location.hash.slice(1);
    if (TABS.includes(t) && t !== state.tab) setTab(t);
  });
  try { state.config = await api('/api/config'); } catch { /* keep defaults */ }
  try {
    await loadVehicles();
    const saved = Number(store('vid'));
    const vid = state.vehicles.some((v) => v.id === saved) ? saved : state.vehicles[0]?.id;
    if (vid) await selectVehicle(vid);
    else render();
  } catch (err) {
    $('#view').innerHTML = `<div class="card empty">Couldn't load: ${esc(err.message)}</div>`;
  }
}

function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(`garage.${k}`);
    localStorage.setItem(`garage.${k}`, v);
  } catch { /* private mode */ }
  return null;
}

async function loadVehicles() {
  state.vehicles = await api('/api/vehicles');
  $('#car-select').innerHTML = state.vehicles
    .map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
  if (state.vid) $('#car-select').value = state.vid;
}

async function selectVehicle(id) {
  state.vid = id;
  store('vid', id);
  $('#car-select').value = id;
  await reload();
}

async function reload() {
  state.data = await api(`/api/vehicles/${state.vid}`);
  state.miles = calcMileage(state.data, todayStr());
  render();
}

function setTab(tab) {
  state.tab = tab;
  store('tab', tab);
  history.replaceState(null, '', `#${tab}`);
  window.scrollTo({ top: 0 });
  render();
}

function render() {
  $$('#tabs button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.tab === state.tab));
  $$('#tabs button[aria-current]').forEach((b) => b.setAttribute('aria-current', 'page'));
  if (!state.data) {
    $('#view').innerHTML = '<div class="card empty">No cars yet.</div>';
    return;
  }
  document.title = `${state.data.vehicle.name} · Garage`;
  const views = { overview: renderOverview, history: renderHistory, schedule: renderSchedule, codes: renderCodes, docs: renderDocs, car: renderCar };
  (views[state.tab] || renderOverview)();
}

// ------------------------------------------------------------------ overview

function milesMeta() {
  const m = state.miles;
  if (!m?.latest) return 'No mileage logged yet';
  const bits = [];
  if (m.estimated) bits.push(`Estimated from ${num(m.latest.miles)} on ${fmtDate(m.latest.date)}`);
  else bits.push(`Logged ${fmtDate(m.latest.date)}`);
  if (m.rate) bits.push(`about ${num(Math.round(m.rate * 30.4))} mi/month`);
  return bits.join(' · ');
}

// Recalls still open, plus renewals and warranties that need attention soon.
function alertsHtml() {
  const { vehicle: v, recalls, reminders } = state.data;
  const open = recalls.filter((r) => r.status === 'open');
  const today = todayStr();
  const upcoming = reminders
    .map((r) => ({ r, st: reminderStatus(r, v, state.miles, today) }))
    .filter(({ r, st }) => (r.kind === 'warranty' ? st.status === 'ending' : st.status === 'soon' || st.status === 'overdue'));
  let html = '';
  if (open.length) {
    html += `<button class="note-box alert-red" data-act="goto-recalls" style="margin:12px 0 0;width:100%;border:0;cursor:pointer;text-align:left">
      <span><strong>${open.length} open recall${open.length > 1 ? 's' : ''}</strong> for ${esc(carLabel(v))}. Check whether yours was fixed.</span>
      <span class="btn small">Review</span></button>`;
  }
  if (upcoming.length) {
    html += `<h2>Coming up</h2><div class="card list">${upcoming.map(({ r, st }) => `
      <button class="row" data-act="reminder" data-id="${r.id}">
        <span class="dot ${st.status === 'overdue' ? 'overdue' : 'soon'}"></span>
        <span class="main"><span class="title">${esc(r.kind === 'warranty' ? `${r.title} warranty` : r.title)}</span>
          <span class="sub" style="display:block">${esc(reminderText(r, st))}</span></span>
        <span class="side"><span class="pill ${st.status === 'overdue' ? 'overdue' : 'soon'}">${r.kind === 'warranty' ? 'Ending' : st.status === 'overdue' ? 'Overdue' : 'Soon'}</span></span>
      </button>`).join('')}</div>`;
  }
  return html;
}

function renderOverview() {
  const { vehicle: v, items, services } = state.data;
  const cur = currentMiles();
  const scheduled = items.filter((i) => i.active && (i.interval_miles || i.interval_months));
  const rows = scheduled.map((it) => ({ it, st: itemStatus(it) }));
  const logged = rows.filter((r) => !r.st.never);
  const never = rows.filter((r) => r.st.never);
  const group = (s) => logged.filter((r) => r.st.status === s);
  const overdue = group('overdue'), soon = group('soon'), ok = group('ok'), unknown = group('unknown');

  const year = String(new Date().getFullYear());
  const spentYear = services.filter((s) => s.date.startsWith(year)).reduce((a, s) => a + (s.cost_cents || 0), 0);
  const lastSvc = services[0];

  const order = { overdue: 0, soon: 1, ok: 2, unknown: 3 };
  const byUrgency = (a, b) => order[a.st.status] - order[b.st.status]
    || (a.st.milesLeft ?? 1e9) - (b.st.milesLeft ?? 1e9) || (a.st.daysLeft ?? 1e9) - (b.st.daysLeft ?? 1e9);

  const needs = [];
  if (!cur) needs.push(['Add the current mileage so due dates work.', 'Update mileage', 'miles']);
  else if (!state.miles.rate) needs.push(['Log mileage again in a few weeks and the app will start estimating it for you.', 'Update mileage', 'miles']);

  $('#view').innerHTML = `
    <section class="card hero">
      <div class="hero-top">
        <div>
          <p class="car-name">${esc(v.name)}</p>
          <div class="car-sub">${esc(carLabel(v))}${v.engine ? ` · ${esc(v.engine)}` : ''}</div>
        </div>
        <button class="btn small" data-act="miles">Update mileage</button>
      </div>
      <div>
        <div class="miles-big">${cur ? `${state.miles.estimated ? '~' : ''}${num(cur)}` : '—'} <small>miles${state.miles.estimated ? ' (est.)' : ''}</small></div>
        <div class="miles-meta">${esc(milesMeta())}</div>
      </div>
      <div class="stats">
        <div class="stat ${overdue.length ? 'red' : ''}"><div class="k">Overdue</div><div class="v">${overdue.length}</div></div>
        <div class="stat ${soon.length ? 'amber' : ''}"><div class="k">Due soon</div><div class="v">${soon.length}</div></div>
        <div class="stat"><div class="k">Spent in ${year}</div><div class="v">${fmtMoney(spentYear) || '$0.00'}</div></div>
        <div class="stat"><div class="k">Last service</div><div class="v" style="font-size:15px">${lastSvc ? fmtDate(lastSvc.date) : '—'}</div></div>
      </div>
    </section>

    ${needs.map(([msg, label, act]) => `<p class="note-box" style="margin:12px 0 0"><span>${esc(msg)}</span><button class="btn small" data-act="${act}">${label}</button></p>`).join('')}

    ${alertsHtml()}

    ${logged.length ? `
      <h2>Upcoming <span class="count">· ${logged.length}</span></h2>
      <div class="card list">${[...overdue, ...soon, ...ok, ...unknown].sort(byUrgency).map(statusRow).join('')}</div>` : ''}

    ${never.length ? `
      <details class="group" ${logged.length ? '' : 'open'}>
        <summary><h2>No record yet <span class="count">· ${never.length}</span></h2></summary>
        <p class="muted small" style="margin:0 4px 8px">Not logged yet. Dates shown are from the factory schedule. Log the last time each was done to start tracking it.</p>
        <div class="card list">${never.sort(byUrgency).map(statusRow).join('')}</div>
      </details>` : ''}
  `;
  bindActs();
}

function statusRow({ it, st }) {
  // Never-logged items are judged against the factory schedule, so they get softer labels.
  const [pillClass, label] = {
    overdue: ['overdue', st.never ? 'Likely due' : 'Overdue'],
    soon: ['soon', 'Due soon'],
    ok: [st.never ? 'none' : 'ok', st.never ? 'Factory' : 'OK'],
    unknown: ['none', st.never ? 'Needs date' : 'Needs mileage'],
  }[st.status];
  const lastBits = st.last
    ? `Last: ${fmtDate(st.last.date)}${st.last.miles != null ? ` at ${fmtMiles(st.last.miles)}` : ''}`
    : intervalText(it);
  const due = dueText(st);
  const left = leftText(st);
  // At the current pace, roughly when it comes due (only worth showing when miles drive it).
  const when = st.expected && st.status !== 'overdue' && st.expected !== st.dueDate ? ` · around ${fmtMonth(st.expected)}` : '';
  return `
    <button class="row" data-act="log-item" data-id="${it.id}" title="Log this">
      <span class="dot ${pillClass}"></span>
      <span class="main">
        <span class="title">${esc(it.name)}</span>
        <span class="sub" style="display:block">${esc(lastBits)}</span>
        ${due ? `<span class="sub" style="display:block">${esc(due)}${left ? ` · <b class="left ${pillClass}">${esc(left)}</b>` : ''}${esc(when)}</span>` : ''}
      </span>
      <span class="side"><span class="pill ${pillClass}">${label}</span></span>
    </button>`;
}

// ------------------------------------------------------------------ history

function renderHistory() {
  const { services } = state.data;
  if (!services.length) {
    $('#view').innerHTML = `
      <h2>Service history</h2>
      <div class="card empty">Nothing logged yet.<br><br>
        <button class="btn primary" data-act="new-service">Log your first service</button><br><br>
        <span class="small">Old receipts without mileage are fine. Just leave mileage blank.</span></div>`;
    bindActs();
    return;
  }
  const byYear = new Map();
  for (const s of services) {
    const y = s.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(s);
  }
  const total = services.reduce((a, s) => a + (s.cost_cents || 0), 0);
  let html = `<div class="section-head"><h2>Service history <span class="count">· ${services.length}</span></h2><span class="muted small">${fmtMoney(total)} total</span></div>`;
  for (const [y, list] of byYear) {
    const spent = list.reduce((a, s) => a + (s.cost_cents || 0), 0);
    html += `<div class="year-head"><h2>${y}</h2><span>${spent ? fmtMoney(spent) : ''}</span></div>
      <div class="card list">${list.map(historyRow).join('')}</div>`;
  }
  $('#view').innerHTML = html;
  bindActs();
}

function historyRow(s) {
  const sub = [s.miles != null ? fmtMiles(s.miles) : 'mileage not recorded', s.shop].filter(Boolean).join(' · ');
  const clip = s.files.length
    ? `<span class="clip"><svg viewBox="0 0 24 24"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z"/></svg>${s.files.length}</span>`
    : '';
  return `
    <button class="row" data-act="service" data-id="${s.id}">
      <span class="main">
        <span class="title">${esc(serviceTitle(s))}</span>
        <span class="sub" style="display:block">${esc(sub)}</span>
      </span>
      <span class="side"><strong>${fmtDate(s.date, { month: 'short', day: 'numeric' })}</strong>${fmtMoney(s.cost_cents)} ${clip}</span>
    </button>`;
}

// ------------------------------------------------------------------ schedule

function renderSchedule() {
  const items = state.data.items.filter((i) => i.active);
  const sched = items.filter((i) => i.interval_miles || i.interval_months);
  const asNeeded = items.filter((i) => !i.interval_miles && !i.interval_months);
  const row = (it) => `
    <button class="row" data-act="item" data-id="${it.id}">
      <span class="main">
        <span class="title">${esc(it.name)}</span>
        <span class="sub" style="display:block">${esc([intervalText(it), firstText(it)].filter(Boolean).join(' · '))}</span>
        ${it.notes ? `<span class="sub" style="display:block">${esc(it.notes)}</span>` : ''}
      </span>
      <span class="side small">Edit</span>
    </button>`;
  const specs = state.data.specs;
  $('#view').innerHTML = `
    <div class="section-head"><h2>What to buy</h2><button class="btn small" data-act="spec-new">Add part</button></div>
    <div class="card list">${specs.map((s) => `
      <button class="row" data-act="spec" data-id="${s.id}">
        <span class="main">
          <span class="sub" style="display:block;font-weight:650;text-transform:uppercase;font-size:11.5px;letter-spacing:.05em">${esc(s.item)}</span>
          <span class="title" style="display:block">${esc(s.ask_for || '—')}</span>
          ${s.part_numbers && s.part_numbers !== s.ask_for ? `<span class="sub" style="display:block">${esc(s.part_numbers)}</span>` : ''}
          ${s.notes ? `<span class="sub" style="display:block">${esc(s.notes)}</span>` : ''}
        </span>
        <span class="side small">Edit</span>
      </button>`).join('') || '<div class="empty">No parts listed yet.</div>'}</div>
    <p class="muted small" style="margin:8px 4px 0">Show this at the parts counter, or search for it. Fill in part numbers from receipts as you learn them.</p>

    <div class="section-head"><h2>Maintenance schedule</h2><button class="btn small" data-act="item-new">Add item</button></div>
    <div class="card list">${sched.map(row).join('') || '<div class="empty">No scheduled items.</div>'}</div>
    <h2>As needed</h2>
    <div class="card list">${asNeeded.map(row).join('') || '<div class="empty">None.</div>'}</div>
    <p class="muted small" style="margin:12px 4px">Intervals come from ${esc(sourceList(items))}. Whichever comes first, miles or time.</p>
  `;
  bindActs();
}

function sourceList(items) {
  const s = [...new Set(items.map((i) => i.source).filter(Boolean).map((x) => x.replace(/ p\. \d+$/, '')))];
  return s.length ? s.join(' and ') : 'your own entries';
}

// ------------------------------------------------------------------ trouble codes

let codeList = null;      // [[code, description], ...] loaded on first visit
let codeQuery = '';
const CHECK_ENGINE = /^check engine/i;

const SYSTEMS = { P: 'Powertrain (engine / transmission)', B: 'Body', C: 'Chassis (brakes, steering, suspension)', U: 'Network (module communication)' };
const P_AREAS = {
  0: 'Fuel, air, and emissions', 1: 'Fuel and air metering', 2: 'Fuel and air metering (injectors)',
  3: 'Ignition or misfire', 4: 'Emissions controls (EGR, catalyst, evap, DEF/DPF)', 5: 'Speed, idle control, or inputs',
  6: 'Computer and output circuits', 7: 'Transmission', 8: 'Transmission', 9: 'Transmission', A: 'Hybrid system',
};

// What a code means from its shape alone, for codes not in the list.
function decodeCode(code) {
  const sys = code[0], d1 = code[1], d2 = code[2];
  let scope;
  if (sys === 'P') scope = d1 === '0' || d1 === '2' ? 'generic' : d1 === '1' ? 'maker' : code < 'P3400' ? 'maker' : 'generic';
  else scope = d1 === '0' ? 'generic' : 'maker';
  const area = sys === 'P' && d1 !== '3' ? P_AREAS[d2] : null;
  return { system: SYSTEMS[sys], scope, area };
}

async function loadCodes() {
  if (!codeList) codeList = await (await fetch('/codes.json')).json();
  return codeList;
}

function searchCodes(q) {
  const s = q.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) return [];
  // Code search needs a digit, so words like "DEF" or "CAB" (valid hex) are treated as keywords.
  if (/^[PBCU]?[0-9A-F]{1,4}$/.test(s) && /\d/.test(s)) {
    const withP = /^[PBCU]/.test(s) ? s : `P${s}`;
    return codeList.filter(([c]) => c.startsWith(withP));
  }
  // Everyday words -> the wording the standard uses.
  const ALIASES = { def: 'reductant', adblue: 'reductant', urea: 'reductant', dpf: 'particulate filter',
    soot: 'particulate', maf: 'mass or volume air flow', o2: 'o2 sensor', gas: 'fuel', cap: 'evaporative' };
  const words = s.toLowerCase().split(' ').map((w) => ALIASES[w] || w);
  return codeList.filter(([, d]) => words.every((w) => d.toLowerCase().includes(w)));
}

function webSearchUrl(code) {
  const v = state.data.vehicle;
  const q = [code, v.year, v.make, v.model, v.engine].filter(Boolean).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function codeRow(code, desc) {
  const d = decodeCode(code);
  return `
    <div class="row code-row" style="cursor:default">
      <span class="main">
        <span class="title"><span class="code">${esc(code)}</span> ${esc(desc)}</span>
        <span class="sub" style="display:block">${esc([d.system, d.area].filter(Boolean).join(' · '))}</span>
      </span>
      <span class="btn-row">
        <a class="btn small" href="${webSearchUrl(code)}" target="_blank" rel="noopener">Search web</a>
        <button class="btn small" data-act="log-code" data-code="${esc(code)}" data-desc="${esc(desc)}">Log it</button>
      </span>
    </div>`;
}

async function renderCodes() {
  const v = state.data.vehicle;
  const logged = state.data.services.filter((s) => s.title && CHECK_ENGINE.test(s.title));
  $('#view').innerHTML = `
    <h2>Trouble code lookup</h2>
    <div class="card sheet-body">
      <label class="field"><span>Code or keyword</span>
        <input id="code-q" type="search" placeholder="e.g. P20EE, DEF, turbo" value="${esc(codeQuery)}"
          autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="search"></label>
      <p class="muted small" style="margin:0">Codes come from a scan tool or the free code read at most auto parts stores.
        Covers the standard codes every car uses. Maker-specific codes (like P1xxx) can mean different things on a
        ${esc(v.make || 'this car')}, so use "Search web" for those.</p>
    </div>
    <div id="code-results"></div>
    ${logged.length ? `
      <h2>Logged for ${esc(v.name)} <span class="count">· ${logged.length}</span></h2>
      <div class="card list">${logged.map(historyRow).join('')}</div>` : ''}
    <p class="muted small" style="margin:14px 4px">Generic code definitions: <a href="https://github.com/fabiovila/OBDIICodes" target="_blank" rel="noopener">OBDIICodes</a>
      (<a href="/codes-LICENSE.txt" target="_blank">MIT license</a>). Not a diagnosis. A code tells you which system flagged a problem, not which part failed.</p>`;
  bindActs();

  const input = $('#code-q');
  const results = $('#code-results');
  results.innerHTML = '<p class="loading">Loading codes…</p>';
  try { await loadCodes(); } catch { results.innerHTML = '<div class="card empty">Couldn\'t load the code list.</div>'; return; }

  const show = () => {
    codeQuery = input.value;
    const q = codeQuery.trim().toUpperCase();
    if (!q) { results.innerHTML = ''; return; }
    const hits = searchCodes(q);
    let html = '';
    const full = !/\d/.test(q) ? null : /^[PBCU][0-9A-F]{4}$/.test(q) ? q : /^[0-9A-F]{4}$/.test(q) ? `P${q}` : null;
    if (full && !hits.some(([c]) => c === full)) {
      const d = decodeCode(full);
      html += `<h2>${esc(full)}</h2><div class="card sheet-body">
        <p style="margin:0"><strong>Not in the generic list.</strong> ${d.scope === 'maker'
          ? `This is a <strong>manufacturer-specific</strong> code, so its meaning depends on the brand (${esc(v.make || 'your car')}).`
          : 'It may be a newer or rarely used code.'}</p>
        <dl class="kv"><dt>System</dt><dd>${esc(d.system)}</dd>${d.area ? `<dt>Area</dt><dd>${esc(d.area)}</dd>` : ''}</dl>
        <div class="btn-row">
          <a class="btn primary small" href="${webSearchUrl(full)}" target="_blank" rel="noopener">Search web for ${esc(full)}</a>
          <button class="btn small" data-act="log-code" data-code="${esc(full)}" data-desc="">Log it</button>
        </div></div>`;
    }
    if (hits.length) {
      const shown = hits.slice(0, 60);
      html += `<h2>${hits.length === 1 ? '1 match' : `${hits.length} matches`}${hits.length > shown.length ? ` · showing ${shown.length}` : ''}</h2>
        <div class="card list">${shown.map(([c, d]) => codeRow(c, d)).join('')}</div>`;
    } else if (!full) {
      html += '<div class="card empty" style="margin-top:12px">No codes match.</div>';
    }
    results.innerHTML = html;
    bindActs(results);
  };
  input.addEventListener('input', show);
  show();
  if (!codeQuery && matchMedia('(pointer: fine)').matches) input.focus();
}

// ------------------------------------------------------------------ documents

function renderDocs() {
  const docs = state.data.documents;
  $('#view').innerHTML = `
    <div class="section-head"><h2>Manuals & documents</h2><button class="btn small" data-act="doc-new">Upload</button></div>
    <div class="card list">${docs.map((d) => `
      <div class="row" style="cursor:default">
        <span class="main">
          <a class="title" href="/api/files/${d.id}" target="_blank" rel="noopener">${esc(d.title || d.filename)}</a>
          <span class="sub" style="display:block">${esc(d.filename)} · ${fmtSize(d.size)}</span>
        </span>
        <span class="btn-row">
          <a class="btn small" href="/api/files/${d.id}" target="_blank" rel="noopener">Open</a>
          <button class="btn small danger" data-act="doc-del" data-id="${d.id}" aria-label="Delete">Delete</button>
        </span>
      </div>`).join('') || '<div class="empty">No manuals yet. Upload the owner\'s manual PDF to keep it handy.</div>'}
    </div>`;
  bindActs();
}

// ------------------------------------------------------------------ car settings

function renderCar() {
  const v = state.data.vehicle;
  const f = (name, label, type = 'text', extra = '') =>
    `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(v[name] ?? '')}" ${extra}></label>`;
  $('#view').innerHTML = `
    <h2>Car details</h2>
    <form class="card sheet-body" id="car-form">
      ${f('name', 'Name in the dropdown', 'text', 'required')}
      <div class="grid-2">${f('year', 'Year', 'number', 'inputmode="numeric"')}${f('make', 'Make')}</div>
      <div class="grid-2">${f('model', 'Model')}${f('trim', 'Trim')}</div>
      ${f('engine', 'Engine')}
      <div class="grid-2">${f('vin', 'VIN')}${f('plate', 'Plate')}</div>
      <div class="grid-2">
        ${f('in_service_date', 'In service / bought', 'date')}
        ${f('start_miles', 'Miles when bought', 'number', 'inputmode="numeric" min="0"')}
      </div>
      <p class="hint muted small" style="margin:-6px 0 0">Time-based items count from the in-service date until you log them.</p>
      <details>
        <summary class="small muted" style="cursor:pointer">Recall lookup</summary>
        <div style="margin-top:10px">${f('recall_models', 'Model names to check with NHTSA (comma-separated)')}</div>
      </details>
      <div class="btn-row"><button class="btn primary" type="submit">Save</button></div>
    </form>

    <div class="section-head"><h2>Email reminders</h2></div>
    <form class="card sheet-body" id="notify-form">
      <label class="field"><span>Send ${esc(v.name)}'s reminders to</span>
        <input name="notify_emails" type="text" inputmode="email" autocomplete="off" placeholder="you@example.com, kelsey@example.com"
          value="${esc(v.notify_emails ?? '')}"></label>
      <p class="muted small" style="margin:-6px 0 0">One email a day at most, only when something new comes up: maintenance due, a new recall,
        a renewal or warranty ending, or a monthly mileage check-in.${state.config.email ? '' : ' <strong>Sending turns on once the site is deployed.</strong>'}</p>
      <div class="btn-row">
        <button class="btn primary" type="submit">Save</button>
        <button class="btn" type="button" id="notify-preview">Preview</button>
        ${state.config.email ? '<button class="btn" type="button" id="notify-test">Send test</button>' : ''}
      </div>
    </form>

    <div class="section-head"><h2>Renewals & dates</h2><button class="btn small" data-act="reminder-new" data-kind="renewal">Add</button></div>
    <div class="card list">${reminderRows(['renewal', 'other']) || '<div class="empty">Nothing yet. Add plate renewal, insurance, inspections…</div>'}</div>

    <div class="section-head"><h2>Warranties</h2><button class="btn small" data-act="reminder-new" data-kind="warranty">Add</button></div>
    <div class="card list">${reminderRows(['warranty']) || '<div class="empty">No warranties listed.</div>'}</div>
    ${!v.in_service_date && state.data.reminders.some((r) => r.kind === 'warranty') ? '<p class="muted small" style="margin:8px 4px 0">Warranty end dates need the in-service date above. Until then they\'re tracked by miles only.</p>' : ''}

    <div class="section-head" id="recalls"><h2>Recalls</h2><button class="btn small" data-act="recall-check">Check now</button></div>
    <div class="card list">${recallRows() || '<div class="empty">No recalls found for this model.</div>'}</div>
    <p class="muted small" style="margin:8px 4px 0">From NHTSA for every ${esc(carLabel(v))}, checked weekly. To see which apply to your car,
      enter the VIN at <a href="https://www.nhtsa.gov/recalls" target="_blank" rel="noopener">nhtsa.gov/recalls</a>, then mark each one here.</p>

    <div class="section-head"><h2>Mileage log</h2><button class="btn small" data-act="miles">Add reading</button></div>
    <div class="card list">${state.data.odometer.map((o) => `
      <div class="row" style="cursor:default">
        <span class="main"><span class="title">${fmtMiles(o.miles)}</span>
          <span class="sub" style="display:block">${fmtDate(o.date)}${o.created_by && o.created_by !== 'local' ? ` · ${esc(o.created_by)}` : ''}</span></span>
        <button class="btn small danger" data-act="odo-del" data-id="${o.id}">Delete</button>
      </div>`).join('') || '<div class="empty">No readings yet.</div>'}</div>

    <h2>More</h2>
    <div class="card list">
      <button class="row" data-act="car-new"><span class="main"><span class="title">Add another car</span></span></button>
      <a class="row" href="/api/export" style="text-decoration:none;color:inherit"><span class="main"><span class="title">Export all data</span>
        <span class="sub" style="display:block">Every car, item, and service as a JSON file (receipts stay in storage)</span></span></a>
    </div>
    <p class="muted small" style="margin:14px 4px" id="whoami"></p>
  `;
  $('#car-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(e.submitter, async () => {
      await api(`/api/vehicles/${v.id}`, { method: 'PUT', json: formObj(e.target) });
      await loadVehicles();
      await reload();
      toast('Saved');
    });
  });
  $('#notify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(e.submitter, async () => {
      await api(`/api/vehicles/${v.id}`, { method: 'PUT', json: formObj(e.target) });
      await reload();
      toast('Saved');
    });
  });
  $('#notify-preview').addEventListener('click', async () => {
    try {
      const p = await api(`/api/vehicles/${v.id}/notify/preview`, { method: 'POST' });
      const body = openSheet('Next email preview', `
        <div class="sheet-body">
          <p class="muted small" style="margin:0">${p.events.length
            ? `${p.events.length} new thing${p.events.length > 1 ? 's' : ''} would go out in the next daily email. Subject: <strong>${esc(p.subject)}</strong>`
            : 'Nothing new to send right now. This is what a test email looks like.'}</p>
          <iframe title="Email preview" sandbox style="width:100%;height:60vh;border:1px solid var(--line);border-radius:10px;background:#fff"></iframe>
        </div>`, '<button class="btn" type="button" id="pv-close">Close</button>');
      $('iframe', body).srcdoc = p.html;
      $('#pv-close', body).addEventListener('click', closeSheet);
    } catch (err) { toast(err.message, true); }
  });
  // Send test saves whatever is typed first, so nobody has to remember to press Save.
  $('#notify-test')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    await busy(btn, async () => {
      const emails = $('#notify-form').elements.notify_emails.value.trim();
      if (!emails) throw new Error('Type an email address first');
      if (emails !== (v.notify_emails ?? '')) {
        await api(`/api/vehicles/${v.id}`, { method: 'PUT', json: { notify_emails: emails } });
        v.notify_emails = emails;
      }
      btn.textContent = 'Sending…';
      const r = await api(`/api/vehicles/${v.id}/notify/test`, { method: 'POST' });
      toast(`Saved, and a test was sent to ${r.sent.join(', ')}`);
    });
  });
  api('/api/me').then((me) => {
    $('#whoami').textContent = me.email === 'local' ? 'Running locally (no login).' : `Signed in as ${me.email}`;
  }).catch(() => {});
  bindActs();
  if (state.scrollTo) { $(`#${state.scrollTo}`)?.scrollIntoView(); state.scrollTo = null; }
}

function reminderRows(kinds) {
  const v = state.data.vehicle;
  const today = todayStr();
  return state.data.reminders.filter((r) => kinds.includes(r.kind)).map((r) => {
    const st = reminderStatus(r, v, state.miles, today);
    const [cls, label] = {
      ok: ['ok', 'OK'], soon: ['soon', 'Soon'], overdue: ['overdue', 'Overdue'], unknown: ['none', 'No date'],
      active: ['ok', 'Active'], ending: ['soon', 'Ending'], expired: ['none', 'Expired'],
    }[st.status];
    return `
      <button class="row" data-act="reminder" data-id="${r.id}">
        <span class="main"><span class="title">${esc(r.title)}</span>
          <span class="sub" style="display:block">${esc(reminderText(r, st))}</span>
          ${r.kind === 'warranty' && r.months ? `<span class="sub" style="display:block">${esc([monthsText(r.months), r.miles_limit && fmtMiles(r.miles_limit)].filter(Boolean).join(' / '))}${r.notes ? ` · ${esc(r.notes)}` : ''}</span>` : ''}
        </span>
        <span class="side"><span class="pill ${cls}">${label}</span></span>
      </button>`;
  }).join('');
}

function recallRows() {
  const label = { open: ['overdue', 'Open'], done: ['ok', 'Fixed'], not_applicable: ['none', 'Not mine'] };
  return state.data.recalls.map((r) => `
    <button class="row" data-act="recall" data-id="${r.id}">
      <span class="main"><span class="title">${esc(titleCase(r.component || 'Recall'))}</span>
        <span class="sub" style="display:block">NHTSA ${esc(r.campaign)}${r.report_date ? ` · ${fmtDate(r.report_date)}` : ''}</span></span>
      <span class="side"><span class="pill ${label[r.status][0]}">${label[r.status][1]}</span></span>
    </button>`).join('');
}

function titleCase(s) {
  return s.toLowerCase().replace(/:/g, ': ').replace(/(^|[\s/(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

// ------------------------------------------------------------------ actions

function bindActs(root = $('#view')) {
  $$('[data-act]', root).forEach((el) => el.addEventListener('click', () => act(el.dataset.act, Number(el.dataset.id), el)));
}

function act(name, id, el) {
  const d = state.data;
  switch (name) {
    case 'log-code': {
      const { code, desc } = el.dataset;
      return openServiceForm(null, [], {
        title: `Check engine light: ${code}`,
        notes: desc ? `${code}: ${desc}` : '',
      });
    }
    case 'miles': return openMilesForm();
    case 'car': return setTab('car');
    case 'new-service': return openServiceForm();
    case 'log-item': return openServiceForm(null, [id]);
    case 'service': return openServiceDetail(d.services.find((s) => s.id === id));
    case 'item': return openItemForm(d.items.find((i) => i.id === id));
    case 'item-new': return openItemForm(null);
    case 'doc-new': return openDocForm();
    case 'doc-del': return confirmDo('Delete this document?', () => api(`/api/files/${id}`, { method: 'DELETE' }));
    case 'odo-del': return confirmDo('Delete this mileage reading?', () => api(`/api/odometer/${id}`, { method: 'DELETE' }));
    case 'car-new': return openNewCar();
    case 'goto-recalls': state.scrollTo = 'recalls'; return setTab('car');
    case 'spec': return openSpecForm(d.specs.find((s) => s.id === id));
    case 'spec-new': return openSpecForm(null);
    case 'reminder': return openReminderForm(d.reminders.find((r) => r.id === id));
    case 'reminder-new': return openReminderForm(null, el.dataset.kind);
    case 'recall': return openRecall(d.recalls.find((r) => r.id === id));
    case 'recall-check': return checkRecallsNow(el);
  }
}

async function checkRecallsNow(btn) {
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const { added } = await api(`/api/vehicles/${state.vid}/recalls/check`, { method: 'POST' });
    state.scrollTo = 'recalls';
    await reload();
    toast(added ? `${added} new recall${added > 1 ? 's' : ''} found` : 'No new recalls');
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = 'Check now';
  }
}

async function confirmDo(msg, fn) {
  if (!confirm(msg)) return;
  try {
    await fn();
    await reload();
    toast('Deleted');
  } catch (err) { toast(err.message, true); }
}

// ------------------------------------------------------------------ sheet helpers

function openSheet(title, bodyHtml, footHtml = '') {
  $('#sheet-body').innerHTML = `
    <div class="sheet-head"><h3>${esc(title)}</h3><button class="sheet-close" type="button" aria-label="Close">×</button></div>
    ${bodyHtml}
    ${footHtml ? `<div class="sheet-foot">${footHtml}</div>` : ''}`;
  $('.sheet-close', $('#sheet-body')).addEventListener('click', closeSheet);
  const dlg = $('#sheet');
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  return $('#sheet-body');
}
function closeSheet() { $('#sheet').close(); }

function formObj(form) {
  const o = {};
  for (const [k, v] of new FormData(form)) if (typeof v === 'string') o[k] = v;
  return o;
}

async function busy(btn, fn) {
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try { await fn(); }
  catch (err) { toast(err.message, true); }
  finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${error ? ' error' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), error ? 5000 : 2200);
}

function fileTile(f, removable = false) {
  const inner = f.content_type.startsWith('image/')
    ? `<img src="/api/files/${f.id}" alt="${esc(f.filename)}" loading="lazy">`
    : `<span class="pdf"><b>PDF</b>${esc(f.filename)}</span>`;
  return `<span style="position:relative">
    <a class="file" href="/api/files/${f.id}" target="_blank" rel="noopener">${inner}</a>
    ${removable ? `<button type="button" class="x" data-del-file="${f.id}" aria-label="Remove ${esc(f.filename)}">×</button>` : ''}
  </span>`;
}

// ------------------------------------------------------------------ service form

function openServiceForm(svc = null, preselect = [], prefill = {}) {
  const items = state.data.items.filter((i) => i.active || svc?.item_ids.includes(i.id));
  const chosen = new Set(svc ? svc.item_ids : preselect);
  const sched = items.filter((i) => i.interval_miles || i.interval_months);
  const asNeeded = items.filter((i) => !i.interval_miles && !i.interval_months);
  const check = (i) => `<label><input type="checkbox" name="item" value="${i.id}" ${chosen.has(i.id) ? 'checked' : ''}>${esc(i.name)}</label>`;

  const body = openSheet(svc ? 'Edit service' : `Log service · ${state.data.vehicle.name}`, `
    <form id="svc-form" class="sheet-body">
      ${!svc && state.config.scan ? `
        <label class="drop scan">
          <input type="file" id="scan-input" accept="image/*,application/pdf">
          <span><strong>Scan a receipt</strong></span>
          <span class="small">Take a photo or pick a PDF and the form fills itself in. Check it before saving.</span>
        </label>
        <div class="pending" id="scan-status" role="status"></div>` : ''}
      <div class="grid-2">
        <label class="field"><span>Date</span><input type="date" name="date" required value="${esc(svc?.date || todayStr())}"></label>
        <label class="field"><span>Odometer</span><input type="number" name="miles" inputmode="numeric" min="0"
          placeholder="Optional" value="${svc?.miles ?? ''}"></label>
      </div>
      <div class="field"><span>What was done</span>
        <div class="checks">
          ${sched.length ? `<div class="sep">Scheduled</div>${sched.map(check).join('')}` : ''}
          ${asNeeded.length ? `<div class="sep">As needed</div>${asNeeded.map(check).join('')}` : ''}
        </div>
      </div>
      <label class="field"><span>Other work</span><input name="title" placeholder="Anything not on the list" value="${esc(svc?.title ?? prefill.title ?? '')}"></label>
      <div class="grid-2">
        <label class="field"><span>Shop</span><input name="shop" list="shops" placeholder="Dealer, Jiffy Lube, DIY…" value="${esc(svc?.shop ?? '')}"></label>
        <label class="field"><span>Cost</span><input name="cost" inputmode="decimal" placeholder="$0.00" value="${svc?.cost_cents != null ? (svc.cost_cents / 100).toFixed(2) : ''}"></label>
      </div>
      <datalist id="shops">${[...new Set(state.data.services.map((s) => s.shop).filter(Boolean))].map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <label class="field"><span>Notes</span><textarea name="notes" placeholder="Parts used, what the tech said, next time…">${esc(svc?.notes ?? prefill.notes ?? '')}</textarea></label>
      <div class="field"><span>Receipts & photos</span>
        ${svc?.files.length ? `<div class="files" id="existing-files">${svc.files.map((f) => fileTile(f, true)).join('')}</div>` : ''}
        <label class="drop">
          <input type="file" name="files" multiple accept="image/*,application/pdf">
          <span><strong>Take a photo or choose files</strong></span>
          <span class="small">Photos or PDFs, up to 50 MB each</span>
        </label>
        <div class="pending" id="pending"></div>
      </div>
    </form>`,
    `${svc ? '<button class="btn danger" type="button" id="svc-del">Delete</button><span class="spacer"></span>' : ''}
     <button class="btn" type="button" id="svc-cancel">Cancel</button>
     <button class="btn primary" type="submit" form="svc-form">Save</button>`);

  const form = $('#svc-form', body);
  const input = $('input[name=files]', form);
  const pending = [];   // files to upload on save (picked, or the scanned receipt)
  const showPending = () => {
    $('#pending', body).innerHTML = pending.map((f, i) =>
      `<span class="chip" style="display:inline-flex;gap:6px;align-items:center;margin:4px 6px 0 0">${esc(f.name)}
        <button type="button" data-unpend="${i}" aria-label="Remove ${esc(f.name)}" style="border:0;background:none;cursor:pointer;color:inherit;font-size:15px">×</button></span>`).join('');
    $$('[data-unpend]', body).forEach((b) => b.addEventListener('click', () => { pending.splice(Number(b.dataset.unpend), 1); showPending(); }));
  };
  input.addEventListener('change', () => { pending.push(...input.files); input.value = ''; showPending(); });

  $('#scan-input', body)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const status = $('#scan-status', body);
    status.textContent = 'Reading the receipt… (about 10–20 seconds)';
    try {
      const fd = new FormData();
      fd.append('file', await shrinkForScan(file));
      const r = await api(`/api/vehicles/${state.vid}/scan`, { method: 'POST', body: fd });
      if (!r.is_receipt) { status.textContent = 'That doesn\'t look like a service receipt. Fill the form in by hand.'; return; }
      const set = (name, val) => { if (val != null && val !== '') form.elements[name].value = val; };
      set('date', r.date);
      set('miles', r.miles);
      set('shop', r.shop);
      set('cost', r.cost);
      set('title', r.title);
      if (r.notes) form.elements.notes.value = [form.elements.notes.value, r.notes].filter(Boolean).join('\n');
      for (const c of $$('input[name=item]', form)) if (r.item_ids.includes(Number(c.value))) c.checked = true;
      pending.push(file);
      showPending();
      const found = [r.date && 'date', r.miles && 'mileage', r.shop && 'shop', r.cost && 'cost', r.item_ids.length && `${r.item_ids.length} item${r.item_ids.length > 1 ? 's' : ''}`].filter(Boolean);
      status.textContent = found.length ? `Filled in ${found.join(', ')}. The receipt is attached. Check everything, then Save.` : 'Couldn\'t read much from that one. Fill in the rest by hand.';
    } catch (err) {
      status.textContent = `Couldn't read it: ${err.message}`;
    }
  });
  $('#svc-cancel', body).addEventListener('click', closeSheet);
  $$('[data-del-file]', body).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this file?')) return;
    try {
      await api(`/api/files/${b.dataset.delFile}`, { method: 'DELETE' });
      b.parentElement.remove();
      svc.files = svc.files.filter((f) => f.id !== Number(b.dataset.delFile));
      await reload();
    } catch (err) { toast(err.message, true); }
  }));
  $('#svc-del', body)?.addEventListener('click', async () => {
    if (!confirm('Delete this service and its receipts?')) return;
    try {
      await api(`/api/services/${svc.id}`, { method: 'DELETE' });
      closeSheet();
      await reload();
      toast('Deleted');
    } catch (err) { toast(err.message, true); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('.sheet-foot .primary', body);
    await busy(btn, async () => {
      const o = formObj(form);
      const payload = {
        date: o.date, miles: o.miles, title: o.title, shop: o.shop, cost: o.cost, notes: o.notes,
        item_ids: $$('input[name=item]:checked', form).map((c) => Number(c.value)),
      };
      const res = svc
        ? await api(`/api/services/${svc.id}`, { method: 'PUT', json: payload })
        : await api(`/api/vehicles/${state.vid}/services`, { method: 'POST', json: payload });
      if (pending.length) {
        btn.textContent = 'Uploading…';
        const fd = new FormData();
        for (const f of pending) fd.append('file', f);
        await api(`/api/services/${res.id}/files`, { method: 'POST', body: fd });
      }
      closeSheet();
      await reload();
      toast(svc ? 'Saved' : 'Service logged');
    });
  });
}

// Phone photos are often 3-10 MB; the reader only needs ~2000 px. PDFs go as-is.
async function shrinkForScan(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    return blob ? new File([blob], 'receipt.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;   // e.g. HEIC on a browser that can't decode it; let the server say if it's too big
  }
}

function openServiceDetail(s) {
  const body = openSheet(fmtDate(s.date), `
    <div class="sheet-body">
      <div class="chips">${s.item_ids.map((id) => state.data.items.find((i) => i.id === id)).filter(Boolean)
        .map((i) => `<span class="chip">${esc(i.name)}</span>`).join('')}${s.title ? `<span class="chip">${esc(s.title)}</span>` : ''}</div>
      <dl class="kv">
        <dt>Odometer</dt><dd>${s.miles != null ? fmtMiles(s.miles) : '<span class="muted">Not recorded</span>'}</dd>
        ${s.shop ? `<dt>Shop</dt><dd>${esc(s.shop)}</dd>` : ''}
        ${s.cost_cents != null ? `<dt>Cost</dt><dd>${fmtMoney(s.cost_cents)}</dd>` : ''}
        ${s.created_by && s.created_by !== 'local' ? `<dt>Logged by</dt><dd>${esc(s.created_by)}</dd>` : ''}
      </dl>
      ${s.notes ? `<p class="notes">${esc(s.notes)}</p>` : ''}
      ${s.files.length ? `<div class="files">${s.files.map((f) => fileTile(f)).join('')}</div>` : '<p class="muted small" style="margin:0">No receipts attached.</p>'}
    </div>`,
    '<button class="btn" type="button" id="d-close">Close</button><button class="btn primary" type="button" id="d-edit">Edit</button>');
  $('#d-close', body).addEventListener('click', closeSheet);
  $('#d-edit', body).addEventListener('click', () => openServiceForm(s));
}

// ------------------------------------------------------------------ other forms

function openMilesForm() {
  const body = openSheet('Update mileage', `
    <form id="mi-form" class="sheet-body">
      <label class="field"><span>Odometer</span><input type="number" name="miles" inputmode="numeric" min="0" required autofocus
        placeholder="${currentMiles() ? num(currentMiles()) : 'e.g. 24500'}"></label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${todayStr()}" required></label>
    </form>`,
    '<button class="btn" type="button" id="mi-cancel">Cancel</button><button class="btn primary" type="submit" form="mi-form">Save</button>');
  $('#mi-cancel', body).addEventListener('click', closeSheet);
  $('#mi-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const o = formObj(e.target);
    const lastReal = state.miles.latest?.miles || 0;
    if (Number(o.miles) < lastReal && !confirm(`That's lower than the last reading (${num(lastReal)} mi). Save anyway?`)) return;
    await busy($('.sheet-foot .primary', body), async () => {
      await api(`/api/vehicles/${state.vid}/odometer`, { method: 'POST', json: o });
      closeSheet();
      await reload();
      toast('Mileage updated');
    });
  });
}

function openItemForm(it) {
  const body = openSheet(it ? 'Edit item' : 'Add maintenance item', `
    <form id="it-form" class="sheet-body">
      <label class="field"><span>Name</span><input name="name" required value="${esc(it?.name ?? '')}"></label>
      <div class="grid-2">
        <label class="field"><span>Every (miles)</span><input type="number" name="interval_miles" inputmode="numeric" min="0" value="${it?.interval_miles ?? ''}"></label>
        <label class="field"><span>Every (months)</span><input type="number" name="interval_months" inputmode="numeric" min="0" value="${it?.interval_months ?? ''}"></label>
      </div>
      <p class="muted small" style="margin:-6px 0 0">Leave both blank for "as needed" items.</p>
      <details ${it?.first_miles || it?.first_months ? 'open' : ''}>
        <summary class="small muted" style="cursor:pointer">Different first interval</summary>
        <div class="grid-2" style="margin-top:10px">
          <label class="field"><span>First at (miles)</span><input type="number" name="first_miles" inputmode="numeric" min="0" value="${it?.first_miles ?? ''}"></label>
          <label class="field"><span>First at (months)</span><input type="number" name="first_months" inputmode="numeric" min="0" value="${it?.first_months ?? ''}"></label>
        </div>
      </details>
      <label class="field"><span>Notes</span><textarea name="notes">${esc(it?.notes ?? '')}</textarea></label>
      ${it?.source ? `<p class="muted small" style="margin:0">Source: ${esc(it.source)}</p>` : ''}
    </form>`,
    `${it ? '<button class="btn danger" type="button" id="it-del">Remove</button><span class="spacer"></span>' : ''}
     <button class="btn" type="button" id="it-cancel">Cancel</button><button class="btn primary" type="submit" form="it-form">Save</button>`);
  $('#it-cancel', body).addEventListener('click', closeSheet);
  $('#it-del', body)?.addEventListener('click', async () => {
    if (!confirm(`Remove "${it.name}" from the schedule? Past services keep their record.`)) return;
    try {
      await api(`/api/items/${it.id}`, { method: 'DELETE' });
      closeSheet();
      await reload();
    } catch (err) { toast(err.message, true); }
  });
  $('#it-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy($('.sheet-foot .primary', body), async () => {
      const o = formObj(e.target);
      if (it) await api(`/api/items/${it.id}`, { method: 'PUT', json: o });
      else await api(`/api/vehicles/${state.vid}/items`, { method: 'POST', json: o });
      closeSheet();
      await reload();
      toast('Saved');
    });
  });
}

function openDocForm() {
  const body = openSheet('Upload document', `
    <form id="doc-form" class="sheet-body">
      <label class="field"><span>Title</span><input name="title" placeholder="Owner's manual"></label>
      <label class="field"><span>File</span><input type="file" name="file" accept="application/pdf,image/*" required></label>
    </form>`,
    '<button class="btn" type="button" id="doc-cancel">Cancel</button><button class="btn primary" type="submit" form="doc-form">Upload</button>');
  $('#doc-cancel', body).addEventListener('click', closeSheet);
  $('#doc-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy($('.sheet-foot .primary', body), async () => {
      await api(`/api/vehicles/${state.vid}/documents`, { method: 'POST', body: new FormData(e.target) });
      closeSheet();
      await reload();
      toast('Uploaded');
    });
  });
}

// Shared shape for the simple edit sheets: fields in, PUT/POST, optional delete.
function openRecordForm({ title, fields, record, createPath, updatePath, deletePath, deleteLabel = 'Delete', deleteConfirm, extraFoot = '', onExtra }) {
  const body = openSheet(title, `<form id="rec-form" class="sheet-body">${fields}</form>`,
    `${record && deletePath ? `<button class="btn danger" type="button" id="rec-del">${deleteLabel}</button>` : ''}
     ${extraFoot}<span class="spacer"></span>
     <button class="btn" type="button" id="rec-cancel">Cancel</button><button class="btn primary" type="submit" form="rec-form">Save</button>`);
  $('#rec-cancel', body).addEventListener('click', closeSheet);
  $('#rec-del', body)?.addEventListener('click', async () => {
    if (!confirm(deleteConfirm)) return;
    try { await api(deletePath, { method: 'DELETE' }); closeSheet(); await reload(); toast('Deleted'); }
    catch (err) { toast(err.message, true); }
  });
  if (onExtra) onExtra(body);
  $('#rec-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy($('.sheet-foot .primary', body), async () => {
      const o = formObj(e.target);
      if (record) await api(updatePath, { method: 'PUT', json: o });
      else await api(createPath, { method: 'POST', json: o });
      closeSheet();
      await reload();
      toast('Saved');
    });
  });
  return body;
}

const field = (name, label, value, attrs = '') =>
  `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;

function openSpecForm(s) {
  openRecordForm({
    title: s ? s.item : 'Add part',
    record: s,
    fields: `
      ${field('item', 'Part', s?.item, 'required placeholder="Oil filter"')}
      ${field('ask_for', 'What to ask for or search', s?.ask_for, 'placeholder="ACDelco PF2264G"')}
      ${field('part_numbers', 'Part numbers', s?.part_numbers)}
      <label class="field"><span>Notes</span><textarea name="notes">${esc(s?.notes ?? '')}</textarea></label>`,
    createPath: `/api/vehicles/${state.vid}/specs`,
    updatePath: s && `/api/specs/${s.id}`,
    deletePath: s && `/api/specs/${s.id}`,
    deleteConfirm: 'Remove this part from the list?',
  });
}

function openReminderForm(r, kind = r?.kind) {
  const warranty = kind === 'warranty';
  const renewable = r && !warranty && r.due_date && r.repeat_months;
  openRecordForm({
    title: r ? r.title : warranty ? 'Add warranty' : 'Add renewal or date',
    record: r,
    fields: `
      <input type="hidden" name="kind" value="${esc(kind)}">
      ${field('title', 'Name', r?.title, `required placeholder="${warranty ? 'Powertrain' : 'Plate sticker'}"`)}
      ${warranty ? `
        <div class="grid-2">
          ${field('months', 'Months from in-service date', r?.months, 'type="number" inputmode="numeric" min="0"')}
          ${field('miles_limit', 'Up to (odometer miles)', r?.miles_limit, 'type="number" inputmode="numeric" min="0"')}
        </div>` : `
        <div class="grid-2">
          ${field('due_date', 'Due date', r?.due_date, 'type="date"')}
          ${field('repeat_months', 'Repeats every (months)', r?.repeat_months, 'type="number" inputmode="numeric" min="0" placeholder="12"')}
        </div>`}
      <label class="field"><span>Notes</span><textarea name="notes">${esc(r?.notes ?? '')}</textarea></label>
      ${r?.source ? `<p class="muted small" style="margin:0">Source: ${esc(r.source)}</p>` : ''}`,
    createPath: `/api/vehicles/${state.vid}/reminders`,
    updatePath: r && `/api/reminders/${r.id}`,
    deletePath: r && `/api/reminders/${r.id}`,
    deleteConfirm: `Delete "${r?.title}"?`,
    extraFoot: renewable ? '<button class="btn" type="button" id="rec-renewed">Mark renewed</button>' : '',
    onExtra: (body) => $('#rec-renewed', body)?.addEventListener('click', async () => {
      try {
        const { due_date } = await api(`/api/reminders/${r.id}/renewed`, { method: 'POST' });
        closeSheet();
        await reload();
        toast(`Next due ${fmtDate(due_date)}`);
      } catch (err) { toast(err.message, true); }
    }),
  });
}

function openRecall(r) {
  const body = openSheet(titleCase(r.component || 'Recall'), `
    <div class="sheet-body">
      <dl class="kv"><dt>Campaign</dt><dd>NHTSA ${esc(r.campaign)}</dd>
        ${r.report_date ? `<dt>Issued</dt><dd>${fmtDate(r.report_date)}</dd>` : ''}</dl>
      ${r.summary ? `<div><strong class="small">What's wrong</strong><p class="notes">${esc(r.summary)}</p></div>` : ''}
      ${r.consequence ? `<div><strong class="small">Why it matters</strong><p class="notes">${esc(r.consequence)}</p></div>` : ''}
      ${r.remedy ? `<div><strong class="small">The fix</strong><p class="notes">${esc(r.remedy)}</p></div>` : ''}
      <p class="muted small" style="margin:0">This recall covers some ${esc(carLabel(state.data.vehicle))}s. Check your VIN at
        <a href="https://www.nhtsa.gov/recalls" target="_blank" rel="noopener">nhtsa.gov/recalls</a> or ask a dealer.</p>
    </div>`,
    `${r.status !== 'open' ? '<button class="btn" type="button" data-status="open">Reopen</button>' : ''}
     <span class="spacer"></span>
     ${r.status !== 'not_applicable' ? '<button class="btn" type="button" data-status="not_applicable">Doesn\'t apply to mine</button>' : ''}
     ${r.status !== 'done' ? '<button class="btn primary" type="button" data-status="done">Fixed</button>' : ''}`);
  $$('[data-status]', body).forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/recalls/${r.id}`, { method: 'PUT', json: { status: b.dataset.status } });
      closeSheet();
      state.scrollTo = 'recalls';
      await reload();
    } catch (err) { toast(err.message, true); }
  }));
}

function openNewCar() {
  const body = openSheet('Add a car', `
    <form id="car-new-form" class="sheet-body">
      <label class="field"><span>Name in the dropdown</span><input name="name" required placeholder="e.g. Justin's truck"></label>
      <div class="grid-2">
        <label class="field"><span>Year</span><input type="number" name="year" inputmode="numeric"></label>
        <label class="field"><span>Make</span><input name="make"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Model</span><input name="model"></label>
        <label class="field"><span>Trim</span><input name="trim"></label>
      </div>
      <p class="muted small" style="margin:0">It starts with an empty schedule. Add items on the Schedule tab.</p>
    </form>`,
    '<button class="btn" type="button" id="cn-cancel">Cancel</button><button class="btn primary" type="submit" form="car-new-form">Add car</button>');
  $('#cn-cancel', body).addEventListener('click', closeSheet);
  $('#car-new-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy($('.sheet-foot .primary', body), async () => {
      const { id } = await api('/api/vehicles', { method: 'POST', json: formObj(e.target) });
      closeSheet();
      await loadVehicles();
      await selectVehicle(id);
      setTab('schedule');
    });
  });
}

boot();
