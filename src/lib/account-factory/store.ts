/**
 * Store writer — TypeScript port of account_factory/store_writer.py
 *
 * Persists accounts in the exact on-disk format grok-proxy-cli expects,
 * so the binary picks them up automatically.
 *
 * Layout (Linux):
 *   <data_dir>/
 *     settings.json
 *     usage.json
 *     history.json
 *     accounts/
 *       <user_id>.json
 *     logs/
 */
import fs from "fs";
import path from "path";
import os from "os";
import { AccountInfo, DEFAULT_CLIENT_ID, DEFAULT_ISSUER, DEFAULT_SCOPES, OAuthClient, TokenResponse } from "./oauth";

export function defaultDataDir(): string {
  const override = process.env.GROK_DATA_DIR;
  if (override) return override;
  const platform = process.platform;
  if (platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "GrokDesktop");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "GrokDesktop");
  }
  // linux
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return path.join(xdg, "GrokDesktop");
  return path.join(os.homedir(), ".local", "share", "GrokDesktop");
}

function safeFilename(id: string): string {
  let safe = id;
  for (const c of ["\\", "/", ":", "*", "?", '"', "<", ">", "|"]) {
    safe = safe.split(c).join("_");
  }
  return safe + ".json";
}

function nowIso(): string {
  return new Date().toISOString();
}

function atomicWrite(p: string, contents: string): void {
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, contents, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, p);
}

export function writeAccount(account: AccountInfo, dataDir?: string, makeActive = true): string {
  const dir = dataDir || defaultDataDir();
  const accountsDir = path.join(dir, "accounts");
  fs.mkdirSync(accountsDir, { recursive: true });
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });

  const filePath = path.join(accountsDir, safeFilename(account.id));
  const now = nowIso();
  let createdAt = now;
  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      createdAt = existing.created_at || now;
    } catch {}
  }
  const label = account.email || `Conta ${account.id.slice(0, 8)}`;
  const payload = {
    id: account.id,
    label,
    email: account.email,
    team_id: account.team_id,
    user_id: account.user_id,
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expires_at: account.expires_at,
    client_id: account.client_id,
    issuer: account.issuer,
    scope: account.scope,
    created_at: createdAt,
    updated_at: now,
  };
  atomicWrite(filePath, JSON.stringify(payload, null, 2));
  if (makeActive) setActive(dir, account.id);
  return filePath;
}

function setActive(dir: string, accountId: string): void {
  const p = path.join(dir, "settings.json");
  let settings: any = {};
  if (fs.existsSync(p)) {
    try {
      settings = JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {}
  }
  settings.default_model = settings.default_model || "grok-4.5";
  settings.reasoning_effort = settings.reasoning_effort || "high";
  settings.api_mode = settings.api_mode || "responses";
  settings.upstream_base = settings.upstream_base || "https://cli-chat-proxy.grok.com/v1";
  settings.client_version = settings.client_version || "0.2.93";
  settings.proxy_listen = settings.proxy_listen || "127.0.0.1:8787";
  settings.proxy_enabled = settings.proxy_enabled ?? true;
  settings.store_responses = settings.store_responses ?? true;
  settings.active_account_id = accountId;
  atomicWrite(p, JSON.stringify(settings, null, 2));
}

export interface StoredAccount {
  id: string;
  label: string;
  email: string;
  team_id?: string;
  user_id?: string;
  access_token: string;
  refresh_token?: string;
  expires_at: string;
  client_id: string;
  issuer: string;
  scope?: string;
  created_at: string;
  updated_at: string;
  _path?: string;
}

export function listAccounts(dataDir?: string): StoredAccount[] {
  const dir = dataDir || defaultDataDir();
  const accountsDir = path.join(dir, "accounts");
  if (!fs.existsSync(accountsDir)) return [];
  const out: StoredAccount[] = [];
  for (const f of fs.readdirSync(accountsDir).sort()) {
    if (!f.endsWith(".json")) continue;
    try {
      const a = JSON.parse(fs.readFileSync(path.join(accountsDir, f), "utf-8"));
      a._path = path.join(accountsDir, f);
      out.push(a);
    } catch {}
  }
  return out;
}

export function loadSettings(dataDir?: string): any {
  const dir = dataDir || defaultDataDir();
  const p = path.join(dir, "settings.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

export function removeAccount(accountId: string, dataDir?: string): boolean {
  const dir = dataDir || defaultDataDir();
  const accountsDir = path.join(dir, "accounts");
  let target = path.join(accountsDir, safeFilename(accountId));
  if (!fs.existsSync(target)) {
    // try prefix match
    const matches = fs
      .readdirSync(accountsDir)
      .filter((f) => f.startsWith(accountId) && f.endsWith(".json"));
    if (matches.length === 0) return false;
    target = path.join(accountsDir, matches[0]);
  }
  fs.unlinkSync(target);
  const settings = loadSettings(dir);
  if (settings.active_account_id === accountId) {
    const remaining = listAccounts(dir);
    settings.active_account_id = remaining.length > 0 ? remaining[0].id : "";
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  }
  return true;
}

export function setActiveAccount(accountId: string, dataDir?: string): boolean {
  const dir = dataDir || defaultDataDir();
  const accounts = listAccounts(dir);
  if (!accounts.find((a) => a.id === accountId)) return false;
  setActive(dir, accountId);
  return true;
}

export async function refreshAccount(accountId: string, dataDir?: string): Promise<AccountInfo> {
  const dir = dataDir || defaultDataDir();
  const accounts = listAccounts(dir);
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) throw new Error(`account ${accountId} not found in ${dir}`);
  const client = new OAuthClient({ clientId: acc.client_id, issuer: acc.issuer });
  const tok = await client.refresh(acc.refresh_token || "");
  const newAcc = await client.accountFromToken(tok);
  newAcc.email = acc.email || newAcc.email;
  writeAccount(newAcc, dir, true);
  return newAcc;
}

export async function importFromToken(
  accessToken: string,
  refreshToken: string = "",
  opts?: { clientId?: string; issuer?: string; dataDir?: string; makeActive?: boolean }
): Promise<AccountInfo> {
  const client = new OAuthClient({
    clientId: opts?.clientId || DEFAULT_CLIENT_ID,
    issuer: opts?.issuer || DEFAULT_ISSUER,
  });
  const tok: TokenResponse = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 21600,
    token_type: "Bearer",
    scope: DEFAULT_SCOPES,
  };
  const acc = await client.accountFromToken(tok);
  writeAccount(acc, opts?.dataDir, opts?.makeActive ?? true);
  return acc;
}
