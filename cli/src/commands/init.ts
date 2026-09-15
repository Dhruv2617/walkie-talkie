import { encodeInviteCode } from "../inviteCode.js";
import { createChannel } from "../relayClient.js";

export async function runInit(): Promise<string> {
  const { channelId, secret } = await createChannel();
  return encodeInviteCode({ channelId, secret });
}
