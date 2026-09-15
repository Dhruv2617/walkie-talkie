export interface InviteCodePayload {
  channelId: string;
  secret: string;
}

export function encodeInviteCode(payload: InviteCodePayload): string {
  const json = JSON.stringify(payload);
  return `CTXR-${Buffer.from(json, "utf8").toString("base64url")}`;
}

export function decodeInviteCode(code: string): InviteCodePayload {
  const b64 = code.replace(/^CTXR-/, "");
  const json = Buffer.from(b64, "base64url").toString("utf8");
  return JSON.parse(json) as InviteCodePayload;
}
