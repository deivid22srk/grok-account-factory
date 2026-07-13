import { NextRequest, NextResponse } from "next/server";
import { listAccounts, loadSettings } from "@/lib/account-factory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const dataDir = req.nextUrl.searchParams.get("data_dir") || undefined;
    const accounts = listAccounts(dataDir);
    const settings = loadSettings(dataDir);
    const activeId = settings.active_account_id || "";
    const now = Date.now();
    const out = accounts.map((a) => ({
      id: a.id,
      label: a.label,
      email: a.email,
      team_id: a.team_id || "",
      expires_at: a.expires_at,
      expired: a.expires_at ? new Date(a.expires_at).getTime() < now : false,
      active: a.id === activeId,
      has_refresh_token: !!a.refresh_token,
      created_at: a.created_at,
      updated_at: a.updated_at,
    }));
    return NextResponse.json({ accounts: out, active_id: activeId, data_dir: dataDir || process.env.GROK_DATA_DIR || "" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
