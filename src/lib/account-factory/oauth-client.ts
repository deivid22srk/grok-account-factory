/**
 * Browser-side OAuth 2.0 device-code flow for xAI.
 *
 * Talks to auth.x.ai via a CORS proxy (because auth.x.ai doesn't send
 * CORS headers). Default proxy is proxy.cors.sh which is free for low
 * volume. You can override via the CORS_PROXY env var or localStorage.
 */

export const DEFAULT_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const DEFAULT_ISSUER = "https://auth.x.ai";
export const DEFAULT_SCOPES =
  "openid profile email offline_access api:access grok-cli:access conversations:read conversations:write";
export const DEFAULT_CLIENT_VERSION = "0.2.93";

// Public CORS proxies that allow POST with form-urlencoded body.
// Tried in order until one succeeds.
const CORS_PROXIES = [
  "https://proxy.cors.sh/",
  "https://corsproxy.io/?url=",
];

function getCorsProxy(): string {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem("cors_proxy");
    if (stored) return stored;
  }
  return CORS_PROXIES[0];
}

export function setCorsProxy(proxy: string) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("cors_proxy", proxy);
  }
}

function wrapWithProxy(url: string, proxy?: string): string {
  const p = proxy || getCorsProxy();
  if (p.endsWith("?url=") || p.includes("?url=")) {
    return p + encodeURIComponent(url);
  }
  return p + url;
}

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface AccountInfo {
  id: string;
  email: string;
  user_id: string;
  team_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  client_id: string;
  issuer: string;
  scope: string;
}

export class OAuthClient {
  clientId: string;
  issuer: string;
  scopes: string;
  clientVersion: string;

  constructor(opts?: { clientId?: string; issuer?: string; scopes?: string; clientVersion?: string }) {
    this.clientId = opts?.clientId || DEFAULT_CLIENT_ID;
    this.issuer = (opts?.issuer || DEFAULT_ISSUER).replace(/\/$/, "");
    this.scopes = opts?.scopes || DEFAULT_SCOPES;
    this.clientVersion = opts?.clientVersion || DEFAULT_CLIENT_VERSION;
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": `grok-desktop/${this.clientVersion}`,
      "x-grok-client-version": this.clientVersion,
      "x-grok-client-surface": "grok-desktop",
    };
  }

  async startDevice(): Promise<DeviceStart> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      scope: this.scopes,
    });
    const data = await this.postFormViaProxy(`${this.issuer}/oauth2/device/code`, body);
    if (!data.device_code || !data.user_code) throw new Error(`invalid device/code response: ${JSON.stringify(data)}`);
    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      verification_uri_complete: data.verification_uri_complete || data.verification_uri,
      expires_in: data.expires_in ?? 1800,
      interval: data.interval ?? 5,
    };
  }

  async pollDevice(
    deviceCode: string,
    interval: number = 5,
    expiresIn: number = 1800,
    onTick?: (msg: string) => void
  ): Promise<TokenResponse> {
    const deadline = Date.now() + expiresIn * 1000;
    let currentInterval = Math.max(interval, 1);
    while (Date.now() < deadline) {
      try {
        const body = new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: this.clientId,
        });
        const resp: any = await this.postFormViaProxy(`${this.issuer}/oauth2/token`, body, true);
        const err = resp.error;
        if (err) {
          if (err === "authorization_pending") {
            onTick?.("waiting for user authorization…");
            await new Promise((r) => setTimeout(r, currentInterval * 1000));
            continue;
          }
          if (err === "slow_down") {
            currentInterval += 5;
            await new Promise((r) => setTimeout(r, currentInterval * 1000));
            continue;
          }
          throw new Error(`${err}: ${resp.error_description || ""}`);
        }
        if (!resp.access_token) {
          await new Promise((r) => setTimeout(r, currentInterval * 1000));
          continue;
        }
        return {
          access_token: resp.access_token,
          refresh_token: resp.refresh_token || "",
          expires_in: resp.expires_in ?? 21600,
          token_type: resp.token_type || "Bearer",
          scope: resp.scope || this.scopes,
        };
      } catch (e: any) {
        // network errors from proxy can happen — keep polling
        onTick?.(`network error: ${e.message}`);
        await new Promise((r) => setTimeout(r, currentInterval * 1000));
      }
    }
    throw new Error("device-code flow expired before user authorized");
  }

  async refresh(refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
    });
    const resp: any = await this.postFormViaProxy(`${this.issuer}/oauth2/token`, body);
    if (resp.error) throw new Error(`${resp.error}: ${resp.error_description || ""}`);
    return {
      access_token: resp.access_token,
      refresh_token: resp.refresh_token || refreshToken,
      expires_in: resp.expires_in ?? 21600,
      token_type: resp.token_type || "Bearer",
      scope: resp.scope || this.scopes,
    };
  }

  async userinfo(accessToken: string): Promise<{ email: string; sub: string }> {
    try {
      const r = await fetch(`${this.issuer}/oauth2/userinfo`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      if (!r.ok) return { email: "", sub: "" };
      const d = await r.json();
      return { email: d.email || "", sub: d.sub || "" };
    } catch {
      return { email: "", sub: "" };
    }
  }

  claimsFromAccess(accessToken: string): { teamId: string; sub: string } {
    const parts = accessToken.split(".");
    if (parts.length < 2) return { teamId: "", sub: "" };
    let payload = parts[1];
    payload += "=".repeat((4 - (payload.length % 4)) % 4);
    try {
      // Browser-compatible base64url decode
      const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      return { teamId: json.team_id || "", sub: json.sub || "" };
    } catch {
      return { teamId: "", sub: "" };
    }
  }

  async accountFromToken(tok: TokenResponse): Promise<AccountInfo> {
    const { teamId, sub } = this.claimsFromAccess(tok.access_token);
    const { email, sub: uiSub } = await this.userinfo(tok.access_token);
    const userId = sub || uiSub || `acc_${Date.now()}`;
    const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
    return {
      id: userId,
      email,
      user_id: userId,
      team_id: teamId,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: expiresAt,
      client_id: this.clientId,
      issuer: this.issuer,
      scope: tok.scope,
    };
  }

  private async postFormViaProxy(url: string, body: URLSearchParams, tolerateErrors = false): Promise<any> {
    // Try each known proxy until one works
    let lastErr: any;
    for (const proxy of CORS_PROXIES) {
      try {
        const proxiedUrl = wrapWithProxy(url, proxy);
        const r = await fetch(proxiedUrl, {
          method: "POST",
          headers: this.headers(),
          body,
        });
        const text = await r.text();
        if (!r.ok && !tolerateErrors) {
          lastErr = new Error(`HTTP ${r.status} via ${proxy}: ${text.slice(0, 200)}`);
          continue;
        }
        try {
          return JSON.parse(text);
        } catch {
          lastErr = new Error(`non-JSON via ${proxy}: ${text.slice(0, 200)}`);
          continue;
        }
      } catch (e: any) {
        lastErr = e;
        continue;
      }
    }
    throw lastErr || new Error("all CORS proxies failed");
  }
}
