import { normalizeWorkbenchScope } from '../../shared/dataWorkbench.js';
import { serializeWorkbenchEntry } from '../utils/workbenchTransfer.js';
import { listWorkbenchEntries, commitWorkbenchEntries } from './dataWorkbenchService.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
const fingerprint = value => JSON.stringify(canonical(value));

async function importCommitId(payload) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint(payload)));
  const hex = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function loadWorkbenchEntriesForExport(accounts = []) {
  const scopes = new Map();
  for (const account of accounts) {
    const scope = normalizeWorkbenchScope(account.scope || account);
    if (scope) scopes.set(fingerprint(scope), scope);
  }
  const entries = [];
  for (const scope of scopes.values()) {
    // eslint-disable-next-line no-await-in-loop -- bound full-scope reads to one request at a time
    entries.push(...await listWorkbenchEntries(scope));
  }
  return entries;
}

// Re-import uses the same private, server-validated save path as the workbench.
// Keep existing identities; conflicting revisions need explicit review, never overwrite.
export async function importWorkbenchEntries(entries = []) {
  const groups = new Map();
  for (const raw of entries) {
    const entry = serializeWorkbenchEntry(raw);
    const scope = normalizeWorkbenchScope(entry);
    if (!scope || !entry.draftId || !entry.entryId) throw new Error('补录条目缺少账号区服或稳定身份');
    const key = fingerprint([scope, entry.draftId]);
    if (!groups.has(key)) groups.set(key, { scope, draftId: entry.draftId, entries: [] });
    groups.get(key).entries.push(entry);
  }
  let saved = 0;
  let skipped = 0;
  for (const group of groups.values()) {
    // eslint-disable-next-line no-await-in-loop -- check and save each isolated scope sequentially
    const existing = await listWorkbenchEntries(group.scope);
    const pending = group.entries.filter(entry => {
      const prior = existing.find(row => (row.draftId ?? row.draft_id) === entry.draftId && (row.entryId ?? row.entry_id) === entry.entryId);
      if (!prior) return true;
      if (fingerprint(serializeWorkbenchEntry(prior)) !== fingerprint(entry)) throw new Error('补录条目已被修改，请在数据工作台核对后再导入');
      skipped += 1;
      return false;
    }).sort((a, b) => a.entryId.localeCompare(b.entryId));
    for (let index = 0; index < pending.length; index += 100) {
      const payload = { scope: group.scope, draftId: group.draftId, entries: pending.slice(index, index + 100) };
      // eslint-disable-next-line no-await-in-loop -- preserve bounded batches and deterministic retry identities
      const result = await commitWorkbenchEntries({ ...payload, commitId: await importCommitId(payload) });
      if (result?.saved !== payload.entries.length) throw new Error('补录保存结果不完整，请保留文件并重试');
      saved += result.saved;
    }
    if (pending.length) {
      // eslint-disable-next-line no-await-in-loop -- an old idempotent commit may refer to subsequently deleted entries
      const current = await listWorkbenchEntries(group.scope);
      if (pending.some(entry => !current.some(row => (row.draftId ?? row.draft_id) === entry.draftId && (row.entryId ?? row.entry_id) === entry.entryId))) {
        throw new Error('补录条目已删除或保存后发生变化，请在数据工作台核对');
      }
    }
  }
  return { saved, skipped };
}
