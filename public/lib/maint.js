// Maintenance math shared by the browser (app.js) and the Worker's daily email job.
// Pure functions only: no DOM, no fetch.

export const SOON_MILES = 1000;
export const SOON_DAYS = 30;
const RATE_WINDOW_DAYS = 365;   // average miles/day over roughly the last year of readings
const MIN_SPAN_DAYS = 14;       // need at least two readings this far apart to estimate

// ---------------------------------------------------------------- dates

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addMonths(s, n) {
  const d = parseDate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return toISO(d);
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + Math.round(n));
  return toISO(d);
}
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

// ---------------------------------------------------------------- mileage

// Every dated odometer reading we know about: logged readings plus services that recorded miles.
export function readings(data) {
  const out = [];
  for (const o of data.odometer) out.push({ date: o.date, miles: o.miles });
  for (const s of data.services) if (s.miles != null) out.push({ date: s.date, miles: s.miles });
  const v = data.vehicle;
  if (v.in_service_date && v.start_miles != null) out.push({ date: v.in_service_date, miles: v.start_miles });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.miles - b.miles);
}

// Average miles per day and today's estimated odometer.
// Uses readings from the last year (back from the newest reading); falls back to all readings.
export function mileage(data, today) {
  const rs = readings(data);
  const latest = rs.reduce((best, r) => (!best || r.miles > best.miles ? r : best), null);
  if (!latest) return { latest: null, rate: null, estimate: 0, estimated: false };

  const rateFrom = (list) => {
    const first = list[0], last = list[list.length - 1];
    const days = daysBetween(first.date, last.date);
    if (days < MIN_SPAN_DAYS || last.miles <= first.miles) return null;
    return (last.miles - first.miles) / days;
  };
  const cutoff = addDays(latest.date, -RATE_WINDOW_DAYS);
  let rate = rateFrom(rs.filter((r) => r.date >= cutoff && r.date <= latest.date));
  if (rate == null) rate = rateFrom(rs.filter((r) => r.date <= latest.date));

  const since = Math.max(0, daysBetween(latest.date, today));
  const estimate = rate ? Math.round(latest.miles + rate * since) : latest.miles;
  return { latest, rate, estimate, estimated: !!rate && since > 0 };
}

// ---------------------------------------------------------------- maintenance items

export function lastServiceFor(data, itemId) {
  // services arrive newest first
  return data.services.find((s) => s.item_ids.includes(itemId)) || null;
}

export function itemStatus(it, data, today, miles = mileage(data, today)) {
  const v = data.vehicle;
  const cur = miles.estimate;
  const last = lastServiceFor(data, it.id);
  if (!it.interval_miles && !it.interval_months) return { status: 'asneeded', last };

  let baseMiles, baseDate, mi, mo;
  if (last) {
    baseMiles = last.miles;
    baseDate = last.date;
    mi = it.interval_miles;
    mo = it.interval_months;
  } else {
    baseMiles = 0; // the factory schedule counts from 0 mi and the in-service date
    baseDate = v.in_service_date;
    mi = it.first_miles || it.interval_miles;
    mo = it.first_months || it.interval_months;
  }
  const dueMiles = baseMiles != null && mi ? baseMiles + mi : null;
  const dueDate = baseDate && mo ? addMonths(baseDate, mo) : null;
  const milesLeft = dueMiles != null && cur > 0 ? dueMiles - cur : null;
  const daysLeft = dueDate ? daysBetween(today, dueDate) : null;

  // When the miles will run out at the current pace.
  const milesDate = milesLeft != null && miles.rate ? addDays(today, Math.max(0, milesLeft) / miles.rate) : null;
  const expected = [milesDate, dueDate].filter(Boolean).sort()[0] || null;

  let status;
  if (milesLeft == null && daysLeft == null) status = 'unknown';
  else if ((milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft <= 0)) status = 'overdue';
  else if ((milesLeft != null && milesLeft <= SOON_MILES) || (daysLeft != null && daysLeft <= SOON_DAYS)
    || (expected && daysBetween(today, expected) <= SOON_DAYS)) status = 'soon';
  else status = 'ok';

  return { status, last, dueMiles, dueDate, milesLeft, daysLeft, expected, never: !last };
}

// ---------------------------------------------------------------- wording (used on screen and in emails)

export const num = (n) => Number(n).toLocaleString('en-US');
export const fmtMiles = (n) => (n == null ? '' : `${num(n)} mi`);
export function fmtDate(s, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return s ? parseDate(s).toLocaleDateString('en-US', opts) : '';
}
export const fmtMonth = (s) => fmtDate(s, { month: 'short', year: 'numeric' });

export function dueText(st) {
  const parts = [];
  if (st.dueMiles != null) parts.push(fmtMiles(st.dueMiles));
  if (st.dueDate) parts.push(fmtMonth(st.dueDate));
  return parts.length ? `Due at ${parts.join(' or ')}` : '';
}

// When overdue, say only what made it overdue; otherwise what's left on each limit.
export function leftText(st) {
  const span = (d) => (d >= 60 ? `${Math.round(d / 30.4)} mo` : `${d} day${d === 1 ? '' : 's'}`);
  const over = [], left = [];
  if (st.milesLeft != null) (st.milesLeft <= 0 ? over : left).push(`${num(Math.abs(st.milesLeft))} mi`);
  if (st.daysLeft != null) (st.daysLeft <= 0 ? over : left).push(span(Math.abs(st.daysLeft)));
  if (over.length) return `${over.join(' / ')} overdue`;
  return left.length ? `${left.join(' or ')} left` : '';
}

// ---------------------------------------------------------------- warranties and renewals

// Warranty: ends at in-service date + months, or at miles_limit on the odometer, whichever first.
// Renewal / other: due_date (rolls forward by repeat_months when marked done).
export function reminderStatus(r, vehicle, miles, today) {
  if (r.kind === 'warranty') {
    const endDate = vehicle.in_service_date && r.months ? addMonths(vehicle.in_service_date, r.months) : null;
    const cur = miles.estimate;
    const milesLeft = r.miles_limit && cur > 0 ? r.miles_limit - cur : null;
    const daysLeft = endDate ? daysBetween(today, endDate) : null;
    const milesDate = milesLeft != null && miles.rate ? addDays(today, Math.max(0, milesLeft) / miles.rate) : null;
    const ends = [endDate, milesDate].filter(Boolean).sort()[0] || null;
    let status;
    if ((milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft <= 0)) status = 'expired';
    else if (daysLeft == null && milesLeft == null) status = 'unknown';
    else if ((daysLeft != null && daysLeft <= 60) || (milesLeft != null && milesLeft <= 2000)
      || (ends && daysBetween(today, ends) <= 60)) status = 'ending';
    else status = 'active';
    return { status, endDate, milesLeft, daysLeft, ends };
  }
  if (!r.due_date) return { status: 'unknown', daysLeft: null };
  const daysLeft = daysBetween(today, r.due_date);
  const status = daysLeft < 0 ? 'overdue' : daysLeft <= SOON_DAYS ? 'soon' : 'ok';
  return { status, daysLeft };
}
