// Small helpers shared by the Worker modules.

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function match(path, re) {
  const m = path.match(re);
  return m ? m.slice(1) : null;
}

export async function run(stmt) {
  const res = await stmt.run();
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  return json({ ok: true });
}

export async function mustExist(env, table, id) {
  const row = await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) throw new HttpError(404, 'Not found');
}

export async function body(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Expected JSON'); }
}

export async function formData(request) {
  try { return await request.formData(); } catch { throw new HttpError(400, 'Expected a file upload'); }
}

// Keep only known fields, coerced to their type. Missing fields are left out (so PUT is a partial update).
export function clean(b, spec) {
  const out = {};
  for (const [k, type] of Object.entries(spec)) {
    if (!(k in b)) continue;
    out[k] = type === 'int' ? toInt(b[k]) : type === 'date' ? toDate(b[k]) : type === 'emails' ? toEmails(b[k]) : text(b[k]);
  }
  return out;
}

export function text(v) {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 4000);
  return s || null;
}

export function toInt(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new HttpError(400, `"${v}" is not a number`);
  return Math.round(n);
}

export function toDate(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `"${v}" is not a date`);
  return s;
}

export function toEmails(v) {
  const list = String(v ?? '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const e of list) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpError(400, `"${e}" is not an email address`);
  return list.length ? [...new Set(list)].join(', ') : null;
}

// Today's date where the cars live (the Worker runs in UTC).
export function localToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
