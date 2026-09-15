import { describe, expect, it } from "vitest";
import { pickCliProxyReleaseAsset } from "./install";

describe("pickCliProxyReleaseAsset", () => {
  const assets = [
    {
      name: "CLIProxyAPI_7.3.3_linux_amd64.tar.gz",
      browser_download_url: "https://example.test/linux.tar.gz",
    },
    {
      name: "CLIProxyAPI_7.3.3_windows_amd64.zip",
      browser_download_url: "https://example.test/windows.zip",
    },
    {
      name: "CLIProxyAPI_7.3.3_darwin_arm64.tar.gz",
      browser_download_url: "https://example.test/darwin.tar.gz",
    },
  ];

  it("picks the Windows amd64 zip on win32/x64", () => {
    expect(pickCliProxyReleaseAsset(assets, "win32", "x64")?.name).toBe(
      "CLIProxyAPI_7.3.3_windows_amd64.zip",
    );
  });

  it("picks the Darwin arm64 archive on macOS", () => {
    expect(pickCliProxyReleaseAsset(assets, "darwin", "arm64")?.name).toBe(
      "CLIProxyAPI_7.3.3_darwin_arm64.tar.gz",
    );
  });

  it("does not pick an ARM Windows build for x64", () => {
    const mixed = [
      {
        name: "CLIProxyAPI_7.3.3_windows_arm64.zip",
        browser_download_url: "https://example.test/arm.zip",
      },
      {
        name: "CLIProxyAPI_7.3.3_windows_amd64.zip",
        browser_download_url: "https://example.test/amd.zip",
      },
    ];
    expect(pickCliProxyReleaseAsset(mixed, "win32", "x64")?.name).toBe(
      "CLIProxyAPI_7.3.3_windows_amd64.zip",
    );
  });

  it("does not treat the letters arm inside windows as an ARM build", () => {
    const official = [
      {
        name: "CLIProxyAPI_7.3.3_darwin_amd64.tar.gz",
        browser_download_url: "https://example.test/darwin.tar.gz",
      },
      {
        name: "CLIProxyAPI_7.3.3_windows_aarch64.zip",
        browser_download_url: "https://example.test/win-arm.zip",
      },
      {
        name: "CLIProxyAPI_7.3.3_windows_amd64.zip",
        browser_download_url: "https://example.test/win-amd.zip",
      },
    ];
    expect(pickCliProxyReleaseAsset(official, "win32", "x64")?.name).toBe(
      "CLIProxyAPI_7.3.3_windows_amd64.zip",
    );
  });

  it("fails closed when only a foreign OS archive is listed", () => {
    expect(
      pickCliProxyReleaseAsset(
        [
          {
            name: "CLIProxyAPI_7.3.3_darwin_amd64.tar.gz",
            browser_download_url: "https://example.test/darwin.tar.gz",
          },
        ],
        "win32",
        "x64",
      ),
    ).toBeUndefined();
  });
});
