// E-mailing reports. Needs an SMTP account in the environment (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, optional SMTP_FROM / SMTP_SECURE).
// The mail is always sent from that account: mail servers refuse an arbitrary sender, so the "From" the user types becomes the display name and the Reply-To.
import nodemailer from 'nodemailer';
import { jsPDF } from 'jspdf';
import * as autoTableMod from 'jspdf-autotable';
const autoTable = autoTableMod.default?.default || autoTableMod.default || autoTableMod.autoTable;
import { HttpError, bad, sstr } from './util.js';

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
export const mailConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const list = (v, label) => {
  const out = sstr(v).split(/[,;\s]+/).filter(Boolean);
  for (const e of out) if (!EMAIL.test(e)) throw bad(`${label}: "${e}" is not a valid e-mail address`);
  if (out.length > 10) throw bad(`${label}: at most 10 addresses`);
  return out;
};

export function toPdf(title, columns, rows) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(12); doc.text(String(title), 30, 30);
  autoTable(doc, { startY: 40, styles: { fontSize: 7 }, headStyles: { fillColor: [11, 74, 143] }, head: [columns], body: rows.map((r) => columns.map((c) => (r[c] === null || r[c] === undefined ? '' : String(r[c])))) });
  return Buffer.from(doc.output('arraybuffer'));
}

export async function sendReport({ to, cc, bcc, subject, message, from, user, filename, content, contentType }) {
  if (!mailConfigured()) throw new HttpError(503, 'E-mail is not set up on the server. Ask the administrator to add the SMTP settings (SMTP_HOST, SMTP_USER, SMTP_PASS) in Vercel.');
  const rcpt = list(to, 'To'); if (!rcpt.length) throw bad('Enter at least one "To" address');
  const copy = list(cc, 'Cc'); const blind = list(bcc, 'Bcc');
  const fromName = sstr(from).replace(/[<>"\r\n]/g, '').trim();
  const replyTo = EMAIL.test(fromName) ? fromName : user.email && EMAIL.test(user.email) ? user.email : undefined;
  const tx = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  await tx.sendMail({
    from: `"${(EMAIL.test(fromName) ? user.name || fromName : fromName) || 'Cure Surgicals ERP'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    replyTo, to: rcpt, cc: copy.length ? copy : undefined, bcc: blind.length ? blind : undefined, subject: sstr(subject).slice(0, 200) || filename,
    text: `${sstr(message).slice(0, 5000)}\n\n— Sent from the Cure Surgicals ERP by ${user.name || user.id}`, attachments: [{ filename, content, contentType }],
  });
  return { sent: rcpt.length + copy.length + blind.length };
}
