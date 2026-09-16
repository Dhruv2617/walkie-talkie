import { encodeInviteCode } from "../inviteCode.js";
import { writeConfig } from "../config.js";
import { Slot, createChannel, joinChannel } from "../relayClient.js";

export async function runInit(): Promise<{ code: string; slot: Slot }> {
  const { channelId, secret } = await createChannel();
  const slot = await joinChannel(channelId, secret);
  writeConfig({ channelId, secret, slot });
  const code = encodeInviteCode({ channelId, secret });
  return { code, slot };
}
