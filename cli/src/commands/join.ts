import { decodeInviteCode } from "../inviteCode.js";
import { readLastSeenId, writeConfig, writeLastSeenId } from "../config.js";
import { Message, Slot, joinChannel, pullMessages } from "../relayClient.js";

export async function runJoin(code: string): Promise<{ slot: Slot; messages: Message[] }> {
  let channelId: string;
  let secret: string;
  try {
    ({ channelId, secret } = decodeInviteCode(code));
  } catch {
    throw new Error("invalid invite code");
  }

  const slot = await joinChannel(channelId, secret);
  writeConfig({ channelId, secret, slot });

  const since = readLastSeenId(channelId);
  const messages = await pullMessages(channelId, secret, since);
  if (messages.length > 0) {
    writeLastSeenId(channelId, messages[messages.length - 1].id);
  }

  return { slot, messages };
}
