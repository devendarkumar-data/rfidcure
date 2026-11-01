// Supporting documents (invoice scan, delivery challan ...) kept in the "Attachment Store" sheet as base64 chunks.
// Simple and needs no extra service; sized for small files. Move to object storage if bigger files are needed.
import { TABLE_BY_SLUG } from '../shared/registry.js';
import { assertCan } from './access.js';
import { bad, forbidden, notFound } from './util.js';
import { sstr } from './util.js';
import { randomBytes } from 'node:crypto';

const TAB = 'Attachment Store', CHUNK = 40000, MAX_BYTES = 1_500_000, MAX_PER_DOC = 5;
const TYPES = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };
const DOCS = { grn: 'grn-mrn' }; // which document types may carry attachments (and the stage that governs them)

export async function upload(ctx, body) {
  const t = TABLE_BY_SLUG[DOCS[body?.docType] || '']; if (!t) throw bad('Unknown document type');
  assertCan(ctx, t, 'create');
  const name = sstr(body.fileName).replace(/[^\w.\- ()]+/g, '_').slice(0, 120); const mime = sstr(body.mime);
  if (!name) throw bad('File name is required');
  if (!TYPES[mime]) throw bad('Only PDF, PNG or JPG files can be attached');
  const data = sstr(body.data).replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) throw bad('File data is not valid');
  const size = Math.floor(data.length * 3 / 4);
  if (size > MAX_BYTES) throw bad(`File is too large (${(size / 1e6).toFixed(1)} MB). The limit is ${MAX_BYTES / 1e6} MB`);
  const id = 'ATT' + randomBytes(5).toString('hex').toUpperCase();
  const parts = Math.ceil(data.length / CHUNK);
  const now = new Date().toISOString();
  await ctx.store.append(TAB, Array.from({ length: parts }, (_, i) => ({ 'Attachment Id': id, 'Doc Type': body.docType, 'File Name': name, Mime: mime, Size: size, Part: i + 1, Parts: parts, Data: data.slice(i * CHUNK, (i + 1) * CHUNK), 'Uploaded By': ctx.user.name, 'Uploaded At': now })));
  return { id, name, size, max: MAX_PER_DOC };
}

export async function download(ctx, id) {
  const { rows } = await ctx.store.read(TAB, { fresh: true });
  const mine = rows.filter((r) => sstr(r['Attachment Id']) === sstr(id));
  if (!mine.length) throw notFound('Attachment not found');
  const t = TABLE_BY_SLUG[DOCS[sstr(mine[0]['Doc Type'])] || '']; if (!t) throw forbidden('Not available');
  assertCan(ctx, t, 'view');
  mine.sort((a, b) => Number(a.Part) - Number(b.Part));
  if (mine.length !== Number(mine[0].Parts)) throw bad('Attachment is incomplete');
  return { name: sstr(mine[0]['File Name']), mime: sstr(mine[0].Mime), data: mine.map((r) => sstr(r.Data)).join('') };
}
