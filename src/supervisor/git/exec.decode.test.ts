import { describe, expect, it } from "vitest";
import { decodeGitOutput } from "./exec";

describe("decodeGitOutput", () => {
  it("passes UTF-8 git output through untouched", () => {
    const text = "# branch.head 功能分支\n# branch.ab +3 -1\n";
    expect(decodeGitOutput(Buffer.from(text, "utf8"))).toBe(text);
  });

  it("keeps ASCII output byte-identical", () => {
    const text = "main\norigin/main\n";
    expect(decodeGitOutput(Buffer.from(text, "utf8"))).toBe(text);
  });

  it("falls back to GBK for zh-CN Windows console output", () => {
    // "分支" encoded in GBK (B7 D6 D6 A7) is invalid UTF-8 on purpose.
    const gbk = Buffer.from([0xb7, 0xd6, 0xd6, 0xa7, 0x0a]);
    expect(decodeGitOutput(gbk)).toBe("分支\n");
  });

  it("decodes GBK commit subjects without mojibake", () => {
    // "修复登录问题" in GBK.
    const gbk = Buffer.from("修复登录问题", "utf8");
    // Sanity: the UTF-8 form round-trips first.
    expect(decodeGitOutput(gbk)).toBe("修复登录问题");
    const gbkBytes = Buffer.from([
      0xd0, 0xde, 0xb8, 0xb4, 0xb5, 0xc7, 0xc2, 0xbc, 0xce, 0xca, 0xcc, 0xe2, 0x0a,
    ]);
    expect(decodeGitOutput(gbkBytes)).toBe("修复登录问题\n");
  });

  it("never throws on arbitrary bytes", () => {
    expect(() => decodeGitOutput(Buffer.from([0xff, 0xfe, 0x00, 0x41]))).not.toThrow();
  });
});
