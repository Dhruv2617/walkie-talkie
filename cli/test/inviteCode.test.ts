import { describe, expect, it } from "vitest";
import { decodeInviteCode, encodeInviteCode } from "../src/inviteCode";

describe("inviteCode", () => {
  it("round-trips channelId and secret", () => {
    const code = encodeInviteCode({ channelId: "abc123", secret: "shh" });
    expect(code.startsWith("WT-")).toBe(true);
    expect(decodeInviteCode(code)).toEqual({ channelId: "abc123", secret: "shh" });
  });

  it("tolerates whitespace and line breaks introduced by copy-paste", () => {
    const code = encodeInviteCode({ channelId: "abc123", secret: "shh" });
    const mangled = `  ${code.slice(0, 10)}\n${code.slice(10)}  \n`;
    expect(decodeInviteCode(mangled)).toEqual({ channelId: "abc123", secret: "shh" });
  });
});
