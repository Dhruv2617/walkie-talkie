import { describe, expect, it } from "vitest";
import { decodeInviteCode, encodeInviteCode } from "../src/inviteCode";

describe("inviteCode", () => {
  it("round-trips channelId and secret", () => {
    const code = encodeInviteCode({ channelId: "abc123", secret: "shh" });
    expect(code.startsWith("WT-")).toBe(true);
    expect(decodeInviteCode(code)).toEqual({ channelId: "abc123", secret: "shh" });
  });
});
