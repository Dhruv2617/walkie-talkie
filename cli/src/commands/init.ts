import { encodeInviteCode } from "../inviteCode";
import { createChannel } from "../relayClient";

export async function runInit(): Promise<string> {
  const { channelId, secret } = await createChannel();
  return encodeInviteCode({ channelId, secret });
}
