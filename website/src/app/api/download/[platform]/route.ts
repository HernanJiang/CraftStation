import { NextResponse, type NextRequest } from "next/server";
import { PLATFORM_PATTERNS, downloadUrlFor, getLatestRelease } from "@/lib/releases";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;

  if (!(platform in PLATFORM_PATTERNS)) {
    return NextResponse.json(
      { error: "Unknown platform", valid: Object.keys(PLATFORM_PATTERNS) },
      { status: 400 },
    );
  }

  const release = await getLatestRelease();
  return NextResponse.redirect(downloadUrlFor(release, platform), 302);
}
