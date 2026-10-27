import { config, assertConfig } from '../config.js';
import { MemoryStore } from './memory.js';
import { SheetsStore } from './sheets.js';

let instance = null;
export function getStore() {
  if (instance) return instance;
  const c = config(); assertConfig(c);
  instance = c.storeKind === 'sheets'
    ? new SheetsStore({ sheetId: c.sheetId, clientEmail: c.clientEmail, privateKey: c.privateKey })
    : new MemoryStore();
  return instance;
}
export const setStore = (s) => { instance = s; };
