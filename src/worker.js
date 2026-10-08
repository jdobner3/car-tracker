// Car maintenance tracker API.
// Static UI comes from ./public (Workers Static Assets); everything under /api/* lands here.
// Data: D1 (env.DB). Receipts and manuals: R2 (env.FILES). Email: Resend (secret RESEND_API_KEY).
// Login: Cloudflare Access in front of the site; this Worker re-checks the Access JWT on every API call.
// A daily cron (wrangler.jsonc "triggers") checks recalls and sends reminder emails.

import {
  HttpError, json, match, run, mustExist, body, formData, clean, text, toInt, toDate, localToday,
} from './util.js';
import { scanReceipt } from './scan.js';
import { runDaily, checkRecalls, pendingEvents, composeDigest, sendEmail, emailReady } from './notify.js';
import { addMonths } from '../public/lib/maint.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = /^(image\/(jpeg|png|gif|webp|heic|heif)|application\/pdf)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      const user = await identify(request, env, url);
      return await route(request, env, url, user);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Server error' }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runDaily(env, loadVehicleData));
  },
};

// ---------------------------------------------------------------- routing

async function route(request, env, url, user) {
  const m = request.method;
  const p = url.pathname;
  let g;

  if (p === '/api/me' && m === 'GET') return json({ email: user });
  if (p === '/api/config' && m === 'GET') return json({ scan: !!env.ANTHROPIC_API_KEY, email: emailReady(env) });
  if (p === '/api/export' && m === 'GET') return exportAll(env);

  if (p === '/api/vehicles') {
    if (m === 'GET') return listVehicles(env);
    if (m === 'POST') return createVehicle(env, await body(request));
  }
  if ((g = match(p, /^\/api\/vehicles\/(\d+)$/))) {
    if (m === 'GET') return json(await loadVehicleData(env, g[0]));
    if (m === 'PUT') return updateVehicle(env, g[0], await body(request));
  }
  if ((g = match(p, /^\/api\/vehicles\/(\d+)\/odometer$/)) && m === 'POST')
    return addOdometer(env, g[0], await body(request), user);
  if ((g = match(p, /^\/api\/odometer\/(\d+)$/)) && m === 'DELETE')
    return run(env.DB.prepare('DELETE FROM odometer WHERE id = ?').bind(g[0]));

  if ((g = match(p, /^\/api\/vehicles\/(\d+)\/items$/)) && m === 'POST')
    return saveRow(env, 'items', ITEM_FIELDS, null, g[0], await body(request));
  if ((g = match(p, /^\/api\/items\/(\d+)$/))) {
    if (m === 'PUT') return saveRow(env, 'items', ITEM_FIELDS, g[0], null, await body(request));
    // Soft delete so past services keep their link to the item.
    if (m === 'DELETE') return run(env.DB.prepare('UPDATE items SET active = 0 WHERE id = ?').bind(g[0]));
  }

  if ((g = match(p, /^\/api\/vehicles\/(\d+)\/services$/)) && m === 'POST')
    return saveService(env, null, g[0], await body(request), user);
  if ((g = match(p, /^\/api\/services\/(\d+)$/))) {
    if (m === 'PUT') return saveService(env, g[0], null, await body(request), user);
    if (m === 'DELETE') return deleteService(env, g[0]);
  }
  if ((g = match(p, /^\/api\/vehicles\/(\d+)\/scan$/)) && m === 'POST')
    return scanReceipt(env, g[0], request);

  if ((g = match(p, /^\/api\/services\/(\d+)\/files$/)) && m === 'POST')
    return uploadReceipts(env, g[0], request, user);
  if ((g = match(p, /^\/api\/vehicles\/(\d+)\/documents$/)) && m === 'POST')
    return uploadDocument(env, g[0], request, user);
  if ((g = match(p, /^\/api\/files\/(\d+)$/))) {
    if (m === 'GET') return serveFile(env, g[0], url.searchParams.has('download'));
    if (m === 'DELETE') return deleteFile(env, g[0]);
  }

  // Warranties, renewals, other dated reminders
  if ((g = match(p, /^\/api\/vehicles\/(\d+)\/reminders$/)) && m === 'POST')
    return saveRow(env, 'reminders', REMINDER_FIELDS, null, g[0], validReminder(await body(request), true));
  if ((g = match(p, /^\/api\/reminders\/(\d+)$/))) {
    if (m === 'PUT') return saveRow(env, 'reminders', REMINDER_FIELDS, g[0], null, validReminder(await body(request), false));
    if (m === 'DELETE') return run(env.DB.prepare('DELETE FROM reminders WHERE id = ?').bind(g[0]));
  }
  if ((g = match(p, /^\/api\/reminders\/(\d+)\/renewed$/)) && m === 'POST') return renewReminder(env, g[0]);

  // Parts card
  if ((g = match(p, /^\/api\/vehicles\/(\d+)\/specs$/)) && m === 'POST')
    return saveRow(env, 'specs', SPEC_FIELDS, null, g[0], await body(request));
  if ((g = match(p, /^\/api\/specs\/(\d+)$/))) {
    if (m === 'PUT') return saveRow(env, 'specs', SPEC_FIELDS, g[0], null, await body(request));
    if (m === 'DELETE') return run(env.DB.prepare('DELETE FROM specs WHERE id = ?').bind(g[0]));
  }

  // Recalls
  if ((g = match(p, /^\/api\/vehicles\/(\d+)\/recalls\/check$/)) && m === 'POST') {
    const v = await env.DB.prepare('SELECT * FROM vehicles WHERE id = ?').bind(g[0]).first();
    if (!v) throw new HttpError(404, 'Car not found');
    try { return json({ added: await checkRecalls(env, v) }); }
    catch { throw new HttpError(502, 'Could not reach the NHTSA recall database'); }
  }
  if ((g = match(p, /^\/api\/recalls\/(\d+)$/)) && m === 'PUT') {
    const status = (await body(request)).status;
    if (!['open', 'done', 'not_applicable'].includes(status)) throw new HttpError(400, 'Unknown recall status');
    return run(env.DB.prepare('UPDATE recalls SET status = ? WHERE id = ?').bind(status, g[0]));
  }

  // Email
  if ((g = match(p, /^\/api\/vehicles\/(\d+)\/notify\/(preview|test)$/)) && m === 'POST')
    return notifyAction(env, g[0], g[1]);
  // Same as the daily cron (recall check + emails); handy right after changing settings.
  if (p === '/api/notify/run' && m === 'POST') return json(await runDaily(env, loadVehicleData));

  throw new HttpError(404, 'Not found');
}

// ---------------------------------------------------------------- vehicles

const VEHICLE_FIELDS = {
  name: 'text', year: 'int', make: 'text', model: 'text', trim: 'text', engine: 'text',
  vin: 'text', plate: 'text', color: 'text', in_service_date: 'date', start_miles: 'int', oil_spec: 'text',
  notify_emails: 'emails', recall_models: 'text',
};

const CURRENT_MILES_SQL = `MAX(
  COALESCE((SELECT MAX(miles) FROM odometer o WHERE o.vehicle_id = v.id), 0),
  COALESCE((SELECT MAX(miles) FROM services s WHERE s.vehicle_id = v.id), 0),
  v.start_miles)`;

async function listVehicles(env) {
  const { results } = await env.DB.prepare(
    `SELECT v.*, ${CURRENT_MILES_SQL} AS current_miles FROM vehicles v ORDER BY v.sort, v.id`
  ).all();
  return json(results);
}

async function createVehicle(env, b) {
  const v = clean(b, VEHICLE_FIELDS);
  if (!v.name) throw new HttpError(400, 'Give the car a name');
  v.start_miles ??= 0;
  const cols = Object.keys(v);
  const row = await env.DB.prepare(
    `INSERT INTO vehicles (${cols.join(',')}, sort)
     VALUES (${cols.map(() => '?').join(',')}, (SELECT COALESCE(MAX(sort), 0) + 1 FROM vehicles))
     RETURNING id`
  ).bind(...cols.map((c) => v[c])).first();
  return json({ id: row.id }, 201);
}

async function updateVehicle(env, id, b) {
  const v = clean(b, VEHICLE_FIELDS);
  if ('name' in v && !v.name) throw new HttpError(400, 'Give the car a name');
  if ('start_miles' in v) v.start_miles ??= 0;
  const cols = Object.keys(v);
  if (!cols.length) return json({ ok: true });
  const res = await env.DB.prepare(`UPDATE vehicles SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .bind(...cols.map((c) => v[c]), id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Car not found');
  return json({ ok: true });
}

// Everything the UI (and the daily job) needs for one car, in one round trip.
async function loadVehicleData(env, id) {
  const db = env.DB;
  const [veh, items, services, links, files, odo, reminders, recalls, specs] = await db.batch([
    db.prepare(`SELECT v.*, ${CURRENT_MILES_SQL} AS current_miles FROM vehicles v WHERE v.id = ?`).bind(id),
    db.prepare('SELECT * FROM items WHERE vehicle_id = ? ORDER BY sort, id').bind(id),
    db.prepare('SELECT * FROM services WHERE vehicle_id = ? ORDER BY date DESC, COALESCE(miles, 0) DESC, id DESC').bind(id),
    db.prepare(`SELECT si.service_id, si.item_id FROM service_items si
                JOIN services s ON s.id = si.service_id WHERE s.vehicle_id = ?`).bind(id),
    db.prepare(`SELECT id, service_id, kind, title, filename, content_type, size, created_by, created_at
                FROM files WHERE vehicle_id = ? ORDER BY created_at, id`).bind(id),
    db.prepare('SELECT * FROM odometer WHERE vehicle_id = ? ORDER BY date DESC, id DESC').bind(id),
    db.prepare('SELECT * FROM reminders WHERE vehicle_id = ? ORDER BY kind, sort, id').bind(id),
    db.prepare('SELECT * FROM recalls WHERE vehicle_id = ? ORDER BY report_date DESC, id DESC').bind(id),
    db.prepare('SELECT * FROM specs WHERE vehicle_id = ? ORDER BY sort, id').bind(id),
  ]);
  const vehicle = veh.results[0];
  if (!vehicle) throw new HttpError(404, 'Car not found');

  const byService = new Map(services.results.map((s) => [s.id, { ...s, item_ids: [], files: [] }]));
  for (const l of links.results) byService.get(l.service_id)?.item_ids.push(l.item_id);
  const documents = [];
  for (const f of files.results) {
    if (f.kind === 'document') documents.push(f);
    else byService.get(f.service_id)?.files.push(f);
  }

  return {
    vehicle,
    items: items.results,
    services: [...byService.values()],
    documents,
    odometer: odo.results,
    reminders: reminders.results,
    recalls: recalls.results,
    specs: specs.results,
  };
}

async function addOdometer(env, vehicleId, b, user) {
  const date = toDate(b.date) ?? localToday();
  const miles = toInt(b.miles);
  if (miles == null || miles < 0) throw new HttpError(400, 'Enter the mileage');
  await mustExist(env, 'vehicles', vehicleId);
  await env.DB.prepare('INSERT INTO odometer (vehicle_id, date, miles, created_by) VALUES (?, ?, ?, ?)')
    .bind(vehicleId, date, miles, user).run();
  return json({ ok: true }, 201);
}

// ---------------------------------------------------------------- simple per-car tables

const ITEM_FIELDS = {
  name: 'text', interval_miles: 'int', interval_months: 'int',
  first_miles: 'int', first_months: 'int', notes: 'text', source: 'text', sort: 'int',
};
const REMINDER_FIELDS = {
  kind: 'text', title: 'text', months: 'int', miles_limit: 'int', due_date: 'date',
  repeat_months: 'int', notes: 'text', source: 'text', sort: 'int',
};
const SPEC_FIELDS = { item: 'text', ask_for: 'text', part_numbers: 'text', notes: 'text', sort: 'int' };
const REQUIRED = { items: ['name', 'Name the maintenance item'], reminders: ['title', 'Give it a name'], specs: ['item', 'Name the part'] };

function validReminder(b, isNew) {
  if ((isNew || 'kind' in b) && !['warranty', 'renewal', 'other'].includes(b.kind)) throw new HttpError(400, 'Unknown reminder type');
  return b;
}

// Insert (id == null, under vehicleId) or partial update (by id) for items / reminders / specs.
async function saveRow(env, table, spec, id, vehicleId, b) {
  const v = clean(b, spec);
  for (const k of ['interval_miles', 'interval_months', 'first_miles', 'first_months', 'months', 'miles_limit', 'repeat_months'])
    if (v[k] != null && v[k] <= 0) v[k] = null;
  const [reqField, reqMsg] = REQUIRED[table];

  if (id == null) {
    if (!v[reqField]) throw new HttpError(400, reqMsg);
    await mustExist(env, 'vehicles', vehicleId);
    delete v.sort;
    v.vehicle_id = Number(vehicleId);
    const cols = Object.keys(v);
    const row = await env.DB.prepare(
      `INSERT INTO ${table} (${cols.join(',')}, sort)
       VALUES (${cols.map(() => '?').join(',')}, (SELECT COALESCE(MAX(sort), 0) + 10 FROM ${table} WHERE vehicle_id = ?))
       RETURNING id`
    ).bind(...cols.map((c) => v[c]), vehicleId).first();
    return json({ id: row.id }, 201);
  }

  if (reqField in v && !v[reqField]) throw new HttpError(400, reqMsg);
  const cols = Object.keys(v);
  if (!cols.length) return json({ ok: true });
  const res = await env.DB.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .bind(...cols.map((c) => v[c]), id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  return json({ ok: true });
}

// "Renewed": roll the due date forward one cycle (from the old due date, so the schedule doesn't drift).
async function renewReminder(env, id) {
  const r = await env.DB.prepare('SELECT * FROM reminders WHERE id = ?').bind(id).first();
  if (!r) throw new HttpError(404, 'Not found');
  if (!r.due_date || !r.repeat_months) throw new HttpError(400, 'Set a due date and how often it repeats first');
  let next = addMonths(r.due_date, r.repeat_months);
  while (next < localToday()) next = addMonths(next, r.repeat_months);
  await env.DB.prepare('UPDATE reminders SET due_date = ? WHERE id = ?').bind(next, id).run();
  return json({ due_date: next });
}

// ---------------------------------------------------------------- services

async function saveService(env, id, vehicleId, b, user) {
  const date = toDate(b.date);
  if (!date) throw new HttpError(400, 'Enter the service date');
  const miles = toInt(b.miles);
  if (miles != null && miles < 0) throw new HttpError(400, 'Mileage can\'t be negative');
  const cost = b.cost === '' || b.cost == null ? null : Math.round(Number(String(b.cost).replace(/[$,]/g, '')) * 100);
  if (cost != null && (!Number.isFinite(cost) || cost < 0)) throw new HttpError(400, 'Cost should be a dollar amount');
  const title = text(b.title);
  const itemIds = [...new Set((Array.isArray(b.item_ids) ? b.item_ids : []).map(Number).filter(Number.isInteger))];
  if (!itemIds.length && !title) throw new HttpError(400, 'Pick what was done, or describe it');

  if (id != null) {
    const row = await env.DB.prepare('SELECT vehicle_id FROM services WHERE id = ?').bind(id).first();
    if (!row) throw new HttpError(404, 'Service not found');
    vehicleId = row.vehicle_id;
  } else {
    await mustExist(env, 'vehicles', vehicleId);
  }

  // Only accept items that belong to this car.
  if (itemIds.length) {
    const { results } = await env.DB.prepare(
      `SELECT id FROM items WHERE vehicle_id = ? AND id IN (${itemIds.map(() => '?').join(',')})`
    ).bind(vehicleId, ...itemIds).all();
    if (results.length !== itemIds.length) throw new HttpError(400, 'Unknown maintenance item');
  }

  const fields = [date, miles, title, text(b.shop), cost, text(b.notes)];
  const db = env.DB;
  let serviceId = id;
  if (id == null) {
    const row = await db.prepare(
      `INSERT INTO services (vehicle_id, date, miles, title, shop, cost_cents, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(vehicleId, ...fields, user).first();
    serviceId = row.id;
  } else {
    await db.prepare(
      `UPDATE services SET date = ?, miles = ?, title = ?, shop = ?, cost_cents = ?, notes = ?,
       updated_at = datetime('now') WHERE id = ?`
    ).bind(...fields, id).run();
  }
  await db.batch([
    db.prepare('DELETE FROM service_items WHERE service_id = ?').bind(serviceId),
    ...itemIds.map((iid) => db.prepare('INSERT INTO service_items (service_id, item_id) VALUES (?, ?)').bind(serviceId, iid)),
  ]);
  return json({ id: Number(serviceId) }, id == null ? 201 : 200);
}

async function deleteService(env, id) {
  const { results } = await env.DB.prepare('SELECT r2_key FROM files WHERE service_id = ?').bind(id).all();
  if (results.length) await env.FILES.delete(results.map((r) => r.r2_key));
  const res = await env.DB.prepare('DELETE FROM services WHERE id = ?').bind(id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Service not found');
  return json({ ok: true });
}

// ---------------------------------------------------------------- files

async function uploadReceipts(env, serviceId, request, user) {
  const svc = await env.DB.prepare('SELECT vehicle_id FROM services WHERE id = ?').bind(serviceId).first();
  if (!svc) throw new HttpError(404, 'Service not found');
  const form = await formData(request);
  const files = form.getAll('file').filter((f) => typeof f === 'object');
  if (!files.length) throw new HttpError(400, 'No file attached');
  const ids = [];
  for (const f of files) ids.push(await storeFile(env, f, { vehicleId: svc.vehicle_id, serviceId, kind: 'receipt', user }));
  return json({ ids }, 201);
}

async function uploadDocument(env, vehicleId, request, user) {
  await mustExist(env, 'vehicles', vehicleId);
  const form = await formData(request);
  const f = form.get('file');
  if (!f || typeof f !== 'object') throw new HttpError(400, 'No file attached');
  const title = text(form.get('title')) || f.name;
  const id = await storeFile(env, f, { vehicleId, serviceId: null, kind: 'document', title, user });
  return json({ id }, 201);
}

async function storeFile(env, f, { vehicleId, serviceId, kind, title = null, user }) {
  const type = (f.type || '').toLowerCase();
  if (!ALLOWED_TYPES.test(type)) throw new HttpError(415, `${f.name}: only photos and PDFs can be uploaded`);
  if (f.size > MAX_FILE_BYTES) throw new HttpError(413, `${f.name} is over 50 MB`);
  const name = (f.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(-120);
  const key = `vehicles/${vehicleId}/${kind}s/${crypto.randomUUID()}/${name}`;
  await env.FILES.put(key, f.stream(), { httpMetadata: { contentType: type } });
  try {
    const row = await env.DB.prepare(
      `INSERT INTO files (vehicle_id, service_id, kind, title, r2_key, filename, content_type, size, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(vehicleId, serviceId, kind, title, key, f.name || name, type, f.size, user).first();
    return row.id;
  } catch (err) {
    await env.FILES.delete(key);
    throw err;
  }
}

async function serveFile(env, id, download) {
  const f = await env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first();
  if (!f) throw new HttpError(404, 'File not found');
  const obj = await env.FILES.get(f.r2_key);
  if (!obj) throw new HttpError(404, 'File is missing from storage');
  return new Response(obj.body, {
    headers: {
      'Content-Type': f.content_type,
      'Content-Length': String(obj.size),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function deleteFile(env, id) {
  const f = await env.DB.prepare('SELECT r2_key FROM files WHERE id = ?').bind(id).first();
  if (!f) throw new HttpError(404, 'File not found');
  await env.FILES.delete(f.r2_key);
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------- email actions

// preview: what the next daily email would say (nothing is sent or marked).
// test: send that preview (or a short hello) to this car's addresses now, without marking anything as sent.
async function notifyAction(env, vehicleId, action) {
  const data = await loadVehicleData(env, vehicleId);
  const events = await pendingEvents(env, data, localToday());
  const mail = composeDigest(env, data.vehicle, events.length ? events
    : [{ section: 'Mileage', line: 'Nothing is due right now. This is a test email from Garage.' }]);
  if (action === 'preview') return json({ events, subject: mail.subject, html: mail.html });

  if (!emailReady(env)) throw new HttpError(503, 'Email is not set up yet');
  const to = (data.vehicle.notify_emails || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!to.length) throw new HttpError(400, 'Add an email address for this car first');
  mail.subject = `[Test] ${mail.subject}`;
  const failed = [];
  for (const addr of to) {
    try { await sendEmail(env, addr, mail); } catch (err) { failed.push(`${addr}: ${err.message}`); }
  }
  if (failed.length) throw new HttpError(502, `Could not send to ${failed.join('; ')}`);
  return json({ sent: to });
}

// ---------------------------------------------------------------- export

async function exportAll(env) {
  const db = env.DB;
  const tables = ['vehicles', 'odometer', 'items', 'services', 'service_items', 'files', 'reminders', 'recalls', 'specs'];
  const res = await db.batch(tables.map((t) => db.prepare(`SELECT * FROM ${t}`)));
  const out = { exported_at: new Date().toISOString() };
  tables.forEach((t, i) => (out[t] = res[i].results));
  return new Response(JSON.stringify(out, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="car-tracker-${localToday()}.json"`,
    },
  });
}

// ---------------------------------------------------------------- auth

let certCache = { at: 0, keys: null };

async function identify(request, env, url) {
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) {
    // Not wired to Access yet: only answer local/LAN requests (wrangler dev). Fail closed everywhere else.
    if (isLocalHost(url.hostname)) return 'local';
    throw new HttpError(503, 'Login is not configured');
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, 'Not signed in');
  const claims = await verifyAccessJwt(token, env);
  return claims.email || claims.common_name || 'unknown';
}

function isLocalHost(h) {
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
    || /^192\.168\.\d+\.\d+$/.test(h) || /^10\.\d+\.\d+\.\d+$/.test(h);
}

async function verifyAccessJwt(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Bad token');
  const header = JSON.parse(b64urlText(parts[0]));
  const claims = JSON.parse(b64urlText(parts[1]));
  const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const keys = await accessKeys(team, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await accessKeys(team, true)).find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw new HttpError(401, 'Bad token');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!ok || !aud.includes(env.ACCESS_AUD) || claims.iss !== `https://${team}` || !(claims.exp > now))
    throw new HttpError(401, 'Bad token');
  return claims;
}

async function accessKeys(team, refresh) {
  if (!refresh && certCache.keys && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(502, 'Could not reach Cloudflare Access');
  certCache = { at: Date.now(), keys: (await res.json()).keys || [] };
  return certCache.keys;
}

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const b64urlText = (s) => new TextDecoder().decode(b64urlBytes(s));
