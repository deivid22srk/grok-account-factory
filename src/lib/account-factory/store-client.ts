/**
 * Browser-side account store. Uses localStorage.
 *
 * Also supports exporting accounts to the grok-proxy-cli JSON format
 * so the user can download them and drop into ~/.local/share/GrokDesktop/accounts/.
 */
import type { AccountInfo } from "./oauth-client";

export interface StoredAccount extends AccountInfo {
  label: string;
  created_at: string;
  updated_at: string;
}

const STORAGE_KEY = "grok_accounts_v1";
const ACTIVE_KEY = "grok_active_account_v1";

function readAll(): StoredAccount[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(accs: StoredAccount[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accs));
}

function nowIso(): string {
  return new Date().toISOString();
}

export function saveAccount(acc: AccountInfo, makeActive = true): StoredAccount {
  const all = readAll();
  const existing = all.find((a) => a.id === acc.id);
  const createdAt = existing?.created_at || nowIso();
  const label = acc.email || existing?.label || `Conta ${acc.id.slice(0, 8)}`;
  const stored: StoredAccount = {
    ...acc,
    label,
    created_at: createdAt,
    updated_at: nowIso(),
  };
  const next = all.filter((a) => a.id !== acc.id);
  next.push(stored);
  writeAll(next);
  if (makeActive) setActive(acc.id);
  return stored;
}

export function listAccounts(): StoredAccount[] {
  const all = readAll();
  const activeId = getActiveId();
  // sort: active first, then by created_at desc
  return all.sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function getActiveId(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(ACTIVE_KEY) || "";
}

export function setActive(id: string): boolean {
  const all = readAll();
  if (!all.find((a) => a.id === id)) return false;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(ACTIVE_KEY, id);
  }
  return true;
}

export function removeAccount(id: string): boolean {
  const all = readAll();
  const next = all.filter((a) => a.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  if (getActiveId() === id) {
    const newActive = next[0]?.id || "";
    if (typeof localStorage !== "undefined") {
      if (newActive) localStorage.setItem(ACTIVE_KEY, newActive);
      else localStorage.removeItem(ACTIVE_KEY);
    }
  }
  return true;
}

export async function refreshAccount(id: string): Promise<StoredAccount> {
  const all = readAll();
  const acc = all.find((a) => a.id === id);
  if (!acc) throw new Error(`account ${id} not found`);
  // Lazy-load OAuthClient to avoid circular imports
  const { OAuthClient } = await import("./oauth-client");
  const client = new OAuthClient({ clientId: acc.client_id, issuer: acc.issuer });
  const tok = await client.refresh(acc.refresh_token);
  const newAcc = await client.accountFromToken(tok);
  newAcc.email = acc.email || newAcc.email;
  return saveAccount(newAcc, true);
}

/** Export all accounts as a single JSON file (the user can drop these into GrokDesktop/accounts/). */
export function exportAllAsJson(): string {
  const all = readAll();
  return JSON.stringify(all, null, 2);
}

/** Export a single account in the exact grok-proxy-cli file format. */
export function exportAccountAsGrokFormat(acc: StoredAccount): string {
  return JSON.stringify({
    id: acc.id,
    label: acc.label,
    email: acc.email,
    team_id: acc.team_id,
    user_id: acc.user_id,
    access_token: acc.access_token,
    refresh_token: acc.refresh_token,
    expires_at: acc.expires_at,
    client_id: acc.client_id,
    issuer: acc.issuer,
    scope: acc.scope,
    created_at: acc.created_at,
    updated_at: acc.updated_at,
  }, null, 2);
}

export function downloadAsFile(filename: string, contents: string, mime = "application/json") {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
