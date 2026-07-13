/**
 * OAuth 2.0 device-code flow for xAI — TypeScript port of account_factory/oauth_flow.py
 *
 * Talks directly to auth.x.ai (pure JSON API), so it works from any IP.
 */

export const DEFAULT_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const DEFAULT_ISSUER = "https://auth.x.ai";
export const DEFAULT_SCOPES =
  "openid profile email offline_access api:access grok-cli:access conversations:read conversations:write";
export const DEFAULT_CLIENT_VERSION = "0.2.93";

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
  expires_at: string; // ISO
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
    const r = await fetch(`${this.issuer}/oauth2/device/code`, {
      method: "POST",
      headers: this.headers(),
      body,
    });
    if (!r.ok) throw new Error(`device/code HTTP ${r.status}: ${await r.text()}`);
    const d = await r.json();
    if (!d.device_code || !d.user_code) throw new Error(`invalid device/code response: ${JSON.stringify(d)}`);
    return {
      device_code: d.device_code,
      user_code: d.user_code,
      verification_uri: d.verification_uri,
      verification_uri_complete: d.verification_uri_complete || d.verification_uri,
      expires_in: d.expires_in ?? 1800,
      interval: d.interval ?? 5,
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
        const r = await fetch(`${this.issuer}/oauth2/token`, {
          method: "POST",
          headers: this.headers(),
          body,
        });
        const resp: any = await r.json().catch(() => ({}));
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
        if (r.status >= 400) {
          if ((await r.text()).includes("authorization_pending")) {
            await new Promise((r) => setTimeout(r, currentInterval * 1000));
            continue;
          }
          throw new Error(`HTTP ${r.status}: ${await r.text()}`);
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
    const r = await fetch(`${this.issuer}/oauth2/token`, {
      method: "POST",
      headers: this.headers(),
      body,
    });
    if (!r.ok) throw new Error(`refresh HTTP ${r.status}: ${await r.text()}`);
    const resp: any = await r.json();
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
      const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
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
}
