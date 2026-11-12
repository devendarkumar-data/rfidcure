// Auto-saved drafts of forms that were filled but never saved. Kept in this browser only (per user), newest first.
const KEY = 'cure.drafts.v1'; const MAX = 12;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a.slice(0, MAX))); } catch { /* storage full or blocked: drafts are a convenience only */ } };
export const listDrafts = (user) => read().filter((d) => d.user === user);
export const getDraft = (user, id) => read().find((d) => d.user === user && d.id === id) || null;
export const saveDraft = (user, id, meta, data) => write([{ id, user, ...meta, data, savedAt: new Date().toISOString() }, ...read().filter((d) => !(d.user === user && d.id === id))]);
export const removeDraft = (user, id) => write(read().filter((d) => !(d.user === user && d.id === id)));
