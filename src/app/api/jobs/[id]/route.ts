import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/account-factory/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
    return NextResponse.json({ job });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
