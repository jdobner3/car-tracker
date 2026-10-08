// Receipt reading: a photo or PDF of a service receipt in, the service form's fields out.
// Uses Claude (vision + structured outputs). Needs the ANTHROPIC_API_KEY secret.

import Anthropic from '@anthropic-ai/sdk';
import { HttpError, json, formData, bytesToBase64, localToday } from './util.js';

const MODEL = 'claude-opus-5-5';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;    // API limit per image; the browser shrinks photos before sending
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_receipt', 'date', 'odometer', 'shop', 'total', 'item_ids', 'other_work', 'notes'],
  properties: {
    is_receipt: { type: 'boolean', description: 'False if this is not a vehicle service/parts receipt or invoice.' },
    date: { type: 'string', description: 'Service date as YYYY-MM-DD, or empty if not shown.' },
    odometer: { type: 'string', description: 'Odometer reading (mileage in) as digits only, or empty.' },
    shop: { type: 'string', description: 'Business name, or empty.' },
    total: { type: 'string', description: 'Total paid including tax, digits and decimal point only (e.g. 94.50), or empty.' },
    item_ids: { type: 'array', items: { type: 'integer' }, description: 'IDs from the maintenance list that this receipt shows were done.' },
    other_work: { type: 'string', description: 'Short comma-separated list of other work or parts not covered by item_ids, or empty.' },
    notes: { type: 'string', description: 'Useful details in one or two short sentences: part numbers/brands, oil used, technician recommendations. Empty if none.' },
  },
};

export async function scanReceipt(env, vehicleId, request) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'Receipt reading is not set up yet');

  const vehicle = await env.DB.prepare('SELECT year, make, model, trim, engine FROM vehicles WHERE id = ?').bind(vehicleId).first();
  if (!vehicle) throw new HttpError(404, 'Car not found');
  const { results: items } = await env.DB.prepare('SELECT id, name FROM items WHERE vehicle_id = ? AND active = 1 ORDER BY sort, id')
    .bind(vehicleId).all();

  const form = await formData(request);
  const f = form.get('file');
  if (!f || typeof f !== 'object') throw new HttpError(400, 'No file attached');
  const type = (f.type || '').toLowerCase();
  const isPdf = type === 'application/pdf';
  if (!isPdf && !IMAGE_TYPES.includes(type)) throw new HttpError(415, 'Use a photo (JPG/PNG) or a PDF');
  if (f.size > (isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) throw new HttpError(413, 'That file is too large to read. Try a smaller photo.');

  const data = bytesToBase64(new Uint8Array(await f.arrayBuffer()));
  const fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: type, data } };

  const car = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim, vehicle.engine].filter(Boolean).join(' ');
  const prompt = [
    `This is a receipt or invoice for work on a ${car}. Today is ${localToday()}.`,
    'Fill in the fields from what the document shows. Leave a field empty rather than guess.',
    'Use the date the work was done, not a print or due date. For mileage, use the odometer reading when the car came in.',
    'Maintenance items for this car (id: name):',
    ...items.map((i) => `${i.id}: ${i.name}`),
  ].join('\n');

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Receipt reader is busy. Try again in a minute.');
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'Receipt reader API key is not valid');
    if (err instanceof Anthropic.BadRequestError) throw new HttpError(422, 'The receipt reader could not process that file');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, 'Receipt reader is unavailable right now');
    throw err;
  }

  if (response.stop_reason === 'refusal') throw new HttpError(422, 'The receipt reader declined to read that file');
  if (response.stop_reason === 'max_tokens') throw new HttpError(502, 'The receipt reader ran out of room. Try again.');
  const textBlock = response.content.find((b) => b.type === 'text');
  let out;
  try { out = JSON.parse(textBlock?.text ?? ''); } catch { throw new HttpError(502, 'The receipt reader returned something unreadable'); }

  return json(sanitize(out, new Set(items.map((i) => i.id))));
}

// Never trust model output shape: keep only well-formed values.
function sanitize(o, validIds) {
  const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(o.date) && !Number.isNaN(Date.parse(o.date)) ? o.date : '';
  const odo = String(o.odometer ?? '').replace(/[^\d]/g, '');
  const total = String(o.total ?? '').replace(/[^\d.]/g, '');
  return {
    is_receipt: o.is_receipt !== false,
    date,
    miles: odo && Number(odo) < 2_000_000 ? Number(odo) : null,
    shop: str(o.shop, 120),
    cost: total && Number.isFinite(Number(total)) ? Number(total).toFixed(2) : '',
    item_ids: (Array.isArray(o.item_ids) ? o.item_ids : []).map(Number).filter((id) => validIds.has(id)),
    title: str(o.other_work, 200),
    notes: str(o.notes, 600),
  };
}
