import { NextRequest, NextResponse } from "next/server";
import { startCreateJob } from "@/lib/account-factory/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const expiresInSec = Number(body.expires_in_sec) || 1800;
    const job = await startCreateJob({ expiresInSec });
    return NextResponse.json({ job });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
