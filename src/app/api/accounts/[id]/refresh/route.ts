import { NextRequest, NextResponse } from "next/server";
import { refreshAccount } from "@/lib/account-factory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const dataDir = req.nextUrl.searchParams.get("data_dir") || undefined;
    const acc = await refreshAccount(id, dataDir);
    return NextResponse.json({ account: acc });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
