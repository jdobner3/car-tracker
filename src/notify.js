// Daily job: check recalls (weekly), work out what's newly due, and email each car's people.
// Every event gets a key in the `notices` table once emailed, so nothing is sent twice.

import { EmailMessage } from 'cloudflare:email';
import {
  mileage, itemStatus, reminderStatus, dueText, leftText, fmtDate, fmtMiles, num, daysBetween,
} from '../public/lib/maint.js';
import { localToday } from './util.js';

const RECALL_CHECK_DAYS = 6;
const MILEAGE_NUDGE_DAYS = 30;
const OVERDUE_REPEAT_DAYS = 30;

// ---------------------------------------------------------------- recalls (NHTSA)

export async function checkRecalls(env, vehicle) {
  const models = (vehicle.recall_models || vehicle.model || '').split(',').map((m) => m.trim()).filter(Boolean);
  if (!vehicle.year || !vehicle.make || !models.length) return 0;
  let added = 0;
  for (const model of models) {
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(vehicle.make)}`
      + `&model=${encodeURIComponent(model)}&modelYear=${vehicle.year}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`NHTSA ${res.status}`);
    const { results = [] } = await res.json();
    for (const r of results) {
      if (!r.NHTSACampaignNumber) continue;
      const out = await env.DB.prepare(
        `INSERT OR IGNORE INTO recalls (vehicle_id, campaign, report_date, component, summary, consequence, remedy)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(vehicle.id, r.NHTSACampaignNumber, nhtsaDate(r.ReportReceivedDate), r.Component || null,
        r.Summary || null, r.Consequence || null, r.Remedy || null).run();
      added += out.meta.changes;
    }
  }
  await env.DB.prepare(`UPDATE vehicles SET recalls_checked_at = datetime('now') WHERE id = ?`).bind(vehicle.id).run();
  return added;
}

function nhtsaDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ''); // dd/mm/yyyy
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// ---------------------------------------------------------------- what to tell people

// Returns [{ key, section, line }] for everything email-worthy today that hasn't been sent yet.
export async function pendingEvents(env, data, today) {
  const v = data.vehicle;
  const miles = mileage(data, today);
  const period = (days) => Math.floor(daysBetween('2000-01-01', today) / days);
  const events = [];

  for (const it of data.items.filter((i) => i.active && (i.interval_miles || i.interval_months))) {
    const st = itemStatus(it, data, today, miles);
    if (st.never || (st.status !== 'soon' && st.status !== 'overdue')) continue;
    const repeat = st.status === 'overdue' ? `:${period(OVERDUE_REPEAT_DAYS)}` : '';
    const left = leftText(st);
    events.push({
      key: `item:${it.id}:${st.last.id}:${st.status}${repeat}`,
      section: 'Maintenance',
      line: `${it.name}: ${st.status === 'overdue' ? 'overdue' : 'due soon'}. ${dueText(st)}${left ? ` (${left})` : ''}.`,
    });
  }

  for (const r of data.recalls.filter((x) => x.status === 'open')) {
    events.push({
      key: `recall:${r.campaign}`,
      section: 'Recalls',
      line: `${titleCase(r.component || 'Recall')} (NHTSA ${r.campaign}). ${shorten(r.summary, 220)} Ask a dealer to check your VIN.`,
    });
  }

  for (const r of data.reminders) {
    const st = reminderStatus(r, v, miles, today);
    if (r.kind === 'warranty' && st.status === 'ending') {
      const when = [st.endDate && fmtDate(st.endDate), r.miles_limit && fmtMiles(r.miles_limit)].filter(Boolean).join(' or ');
      events.push({ key: `warranty:${r.id}:ending`, section: 'Warranty', line: `${r.title} warranty ends soon (${when}). Get anything covered looked at before then.` });
    } else if (r.kind !== 'warranty' && (st.status === 'soon' || st.status === 'overdue')) {
      events.push({
        key: `reminder:${r.id}:${r.due_date}:${st.status}`,
        section: 'Coming up',
        line: `${r.title}: ${st.status === 'overdue' ? 'was due' : 'due'} ${fmtDate(r.due_date)}${st.daysLeft >= 0 ? ` (${st.daysLeft} days)` : ''}.`,
      });
    }
  }

  const sinceReading = miles.latest ? daysBetween(miles.latest.date, today) : null;
  if (sinceReading == null || sinceReading >= MILEAGE_NUDGE_DAYS) {
    events.push({
      key: `miles:${v.id}:${period(MILEAGE_NUDGE_DAYS)}`,
      section: 'Mileage',
      line: miles.latest
        ? `No mileage logged since ${fmtDate(miles.latest.date)} (${num(miles.latest.miles)} mi). Update it so reminders stay accurate${miles.rate ? `. Estimated now: about ${num(miles.estimate)} mi` : ''}.`
        : 'No mileage logged yet. Add the current odometer reading so mileage reminders work.',
    });
  }

  if (!events.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT key FROM notices WHERE key IN (${events.map(() => '?').join(',')})`
  ).bind(...events.map((e) => e.key)).all();
  const sent = new Set(results.map((r) => r.key));
  return events.filter((e) => !sent.has(e.key));
}

// NHTSA components arrive as "POWER TRAIN:AUTOMATIC TRANSMISSION".
function titleCase(s) {
  return s.toLowerCase().replace(/:/g, ': ').replace(/(^|[\s/(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

function shorten(s, n) {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t;
}

// ---------------------------------------------------------------- email

export function emailReady(env) {
  return !!(env.MAILER && env.MAIL_FROM);
}

export function composeDigest(env, vehicle, events) {
  const order = ['Recalls', 'Maintenance', 'Warranty', 'Coming up', 'Mileage'];
  const groups = order.map((s) => [s, events.filter((e) => e.section === s)]).filter(([, list]) => list.length);
  const subject = `${vehicle.name}: ${events.length === 1 ? events[0].section.toLowerCase() : `${events.length} things`} to check`;
  const url = env.APP_URL || '';
  const text = [
    `${vehicle.name}`, '',
    ...groups.flatMap(([s, list]) => [s.toUpperCase(), ...list.map((e) => `- ${e.line}`), '']),
    url ? `Open Garage: ${url}` : '',
  ].join('\n');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f2;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f1d">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dfe3dd;border-radius:14px;padding:20px 22px">
    <div style="font-size:13px;font-weight:700;color:#1f6f5c;letter-spacing:.04em;text-transform:uppercase">Garage</div>
    <h1 style="font-size:20px;margin:4px 0 16px">${esc(vehicle.name)}</h1>
    ${groups.map(([s, list]) => `<h2 style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#5f6964;margin:18px 0 6px">${esc(s)}</h2>
      <ul style="margin:0;padding-left:18px">${list.map((e) => `<li style="margin:4px 0">${esc(e.line)}</li>`).join('')}</ul>`).join('')}
    ${url ? `<p style="margin:22px 0 0"><a href="${esc(url)}" style="display:inline-block;background:#1f6f5c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">Open Garage</a></p>` : ''}
  </div>
  <p style="max-width:560px;margin:12px auto 0;font-size:12px;color:#5f6964;text-align:center">Change who gets these emails on the Car tab.</p>
  </body></html>`;
  return { subject, text, html };
}

export async function sendEmail(env, to, { subject, text, html }) {
  const from = env.MAIL_FROM;
  const fromAddr = /<([^>]+)>/.exec(from)?.[1] || from;
  const raw = buildMime({ from, to, subject, text, html, domain: fromAddr.split('@')[1] });
  await env.MAILER.send(new EmailMessage(fromAddr, to, raw));
}

function buildMime({ from, to, subject, text, html, domain }) {
  const boundary = `b_${crypto.randomUUID()}`;
  const b64 = (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/.{1,76}/g, '$&\r\n');
  };
  const encSubject = `=?UTF-8?B?${b64(subject).replace(/\r\n/g, '')}?=`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encSubject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

// ---------------------------------------------------------------- the daily run

export async function runDaily(env, loadVehicleData) {
  const today = localToday();
  const { results: vehicles } = await env.DB.prepare('SELECT * FROM vehicles ORDER BY sort, id').all();
  const report = [];
  for (const v of vehicles) {
    const entry = { vehicle: v.name, recallsAdded: 0, sent: 0, events: 0, errors: [] };
    try {
      const stale = !v.recalls_checked_at || daysBetween(v.recalls_checked_at.slice(0, 10), today) >= RECALL_CHECK_DAYS;
      if (stale) entry.recallsAdded = await checkRecalls(env, v);
    } catch (err) { entry.errors.push(`recalls: ${err.message}`); }

    try {
      const data = await loadVehicleData(env, v.id);
      const events = await pendingEvents(env, data, today);
      entry.events = events.length;
      const to = (v.notify_emails || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (events.length && to.length && emailReady(env)) {
        const mail = composeDigest(env, data.vehicle, events);
        for (const addr of to) {
          try { await sendEmail(env, addr, mail); entry.sent++; }
          catch (err) { entry.errors.push(`email ${addr}: ${err.message}`); }
        }
        // Mark as told once at least one person got it; otherwise retry tomorrow.
        if (entry.sent) {
          const db = env.DB;
          await db.batch(events.map((e) => db.prepare('INSERT OR IGNORE INTO notices (key, vehicle_id) VALUES (?, ?)').bind(e.key, v.id)));
        }
      }
    } catch (err) { entry.errors.push(err.message); }
    report.push(entry);
  }
  console.log(JSON.stringify({ daily: today, report }));
  return report;
}
