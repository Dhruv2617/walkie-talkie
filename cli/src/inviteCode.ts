export interface InviteCodePayload {
  channelId: string;
  secret: string;
}

export function encodeInviteCode(payload: InviteCodePayload): string {
  const json = JSON.stringify(payload);
  return `WT-${Buffer.from(json, "utf8").toString("base64url")}`;
}

export function decodeInviteCode(code: string): InviteCodePayload {
  // Codes get copy-pasted through terminals and chat apps, which sometimes
  // reflow a long line and inject whitespace/newlines — strip all whitespace
  // rather than fail on a cosmetic artifact of how it was transmitted.
  const cleaned = code.replace(/\s+/g, "");
  const b64 = cleaned.replace(/^WT-/, "");
  const json = Buffer.from(b64, "base64url").toString("utf8");
  return JSON.parse(json) as InviteCodePayload;
}
