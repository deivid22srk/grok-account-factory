/**
 * Temp mail client (mail.tm API) — TypeScript port of account_factory/tempmail.py
 */
export interface TempMailAccount {
  address: string;
  password: string;
  token: string;
  accountId: string;
}

const MAIL_TM_BASE = "https://api.mail.tm";

function randomString(len: number, charset: string = "abcdefghijklmnopqrstuvwxyz0123456789") {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += charset[Math.floor(Math.random() * charset.length)];
  }
  return out;
}

export class TempMailClient {
  private base = MAIL_TM_BASE;
  private headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "grok-account-factory/1.0",
  };

  async listDomains(): Promise<string[]> {
    const r = await fetch(`${this.base}/domains`, { headers: this.headers });
    if (!r.ok) throw new Error(`mail.tm domains HTTP ${r.status}`);
    const data = await r.json();
    const members = Array.isArray(data)
      ? data
      : data["hydra:member"] || data["member"] || [];
    return members.filter((m: any) => m.isActive ?? true).map((m: any) => m.domain);
  }

  async createAccount(opts?: { address?: string; password?: string }): Promise<TempMailAccount> {
    const domains = await this.listDomains();
    const domain = domains[0] || "mail.tm";
    const address = opts?.address || `${randomString(12)}@${domain}`;
    const password = opts?.password || randomString(16, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");

    const r = await fetch(`${this.base}/accounts`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ address, password }),
    });
    if (r.status !== 200 && r.status !== 201) {
      const text = await r.text();
      throw new Error(`mail.tm create account HTTP ${r.status}: ${text}`);
    }
    const body = await r.json();
    const accountId = body.id || "";

    const token = await this.loginWithRetry(address, password);
    return { address, password, token, accountId };
  }

  async fetchInbox(acc: TempMailAccount): Promise<any[]> {
    const r = await fetch(`${this.base}/messages`, {
      headers: { ...this.headers, Authorization: `Bearer ${acc.token}` },
    });
    if (!r.ok) throw new Error(`mail.tm inbox HTTP ${r.status}`);
    const data = await r.json();
    return data["hydra:member"] || data["member"] || [];
  }

  async getMessage(acc: TempMailAccount, id: string): Promise<any> {
    const r = await fetch(`${this.base}/messages/${id}`, {
      headers: { ...this.headers, Authorization: `Bearer ${acc.token}` },
    });
    if (!r.ok) throw new Error(`mail.tm message HTTP ${r.status}`);
    return r.json();
  }

  async waitForEmail(
    acc: TempMailAccount,
    opts?: {
      senderContains?: string;
      subjectContains?: string;
      pattern?: string;
      timeoutMs?: number;
      pollIntervalMs?: number;
    }
  ): Promise<any | null> {
    const timeoutMs = opts?.timeoutMs ?? 180000;
    const pollIntervalMs = opts?.pollIntervalMs ?? 3000;
    const deadline = Date.now() + timeoutMs;
    const seen = new Set<string>();
    const rx = opts?.pattern ? new RegExp(opts.pattern) : null;

    while (Date.now() < deadline) {
      try {
        const inbox = await this.fetchInbox(acc);
        for (const msg of inbox) {
          const msgId = msg.id || (msg["@id"] || "").split("/").pop();
          if (!msgId || seen.has(msgId)) continue;
          seen.add(msgId);
          const sender =
            typeof msg.from === "object" && msg.from
              ? msg.from.address || ""
              : String(msg.from || "");
          const subject = msg.subject || "";
          if (opts?.senderContains && !sender.toLowerCase().includes(opts.senderContains.toLowerCase())) continue;
          if (opts?.subjectContains && !subject.toLowerCase().includes(opts.subjectContains.toLowerCase())) continue;
          const full = await this.getMessage(acc, msgId);
          const text = (full.text || "") + "\n" + (full.html || "");
          if (rx && !rx.test(text)) continue;
          return full;
        }
      } catch (e) {
        // network hiccup, retry
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    return null;
  }

  async deleteAccount(acc: TempMailAccount): Promise<void> {
    try {
      await fetch(`${this.base}/accounts/${acc.accountId}`, {
        method: "DELETE",
        headers: { ...this.headers, Authorization: `Bearer ${acc.token}` },
      });
    } catch {}
  }

  private async loginWithRetry(address: string, password: string, attempts = 8, delayMs = 1500): Promise<string> {
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await fetch(`${this.base}/token`, {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({ address, password }),
        });
        if (r.status === 200) {
          const body = await r.json();
          return body.token;
        }
        if (r.status === 401 || r.status === 422) {
          lastErr = `HTTP ${r.status}: ${await r.text()}`;
          await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
          continue;
        }
        lastErr = `HTTP ${r.status}: ${await r.text()}`;
      } catch (e: any) {
        lastErr = e.message || String(e);
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
    throw new Error(`mail.tm login failed after ${attempts} attempts: ${lastErr}`);
  }
}

export function extractCodeFromEmail(body: string, patterns?: string[]): string | null {
  const defaults = [
    "\\b(\\d{6})\\b",
    "\\b(\\d{4})\\b",
    "\\b(\\d{3}-\\d{3})\\b",
    "\\b([A-Z0-9]{6}-[A-Z0-9]{6})\\b",
    "\\bverification code[:\\s]+([A-Z0-9-]+)\\b",
    "\\bcode[:\\s]+([A-Z0-9]{4,8})\\b",
  ];
  const list = patterns || defaults;
  for (const p of list) {
    const m = new RegExp(p, "i").exec(body);
    if (m) return m[1];
  }
  return null;
}
