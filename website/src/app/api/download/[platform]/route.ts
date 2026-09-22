import { NextResponse, type NextRequest } from "next/server";
import {
  PLATFORM_PATTERNS,
  downloadUrlFor,
  getLatestRelease,
  prefersGiteeDownload,
  toGiteeDownloadUrl,
} from "@/lib/releases";

export async function GET(
  request: NextRequest,
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
  const githubUrl = downloadUrlFor(release, platform);
  const target = prefersGiteeDownload((name) => request.headers.get(name))
    ? toGiteeDownloadUrl(githubUrl)
    : githubUrl;
  return NextResponse.redirect(target, 302);
}
