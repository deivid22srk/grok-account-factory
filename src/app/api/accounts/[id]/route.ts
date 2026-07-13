import { NextRequest, NextResponse } from "next/server";
import { removeAccount } from "@/lib/account-factory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const dataDir = req.nextUrl.searchParams.get("data_dir") || undefined;
    const ok = removeAccount(id, dataDir);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
