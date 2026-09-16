import { decodeInviteCode } from "../inviteCode.js";
import { readLastSeenId, writeConfig, writeLastSeenId } from "../config.js";
import { Message, Slot, getPresence, joinChannel, pullMessages } from "../relayClient.js";

const OTHER_SLOT: Record<Slot, Slot> = { buddy1: "buddy2", buddy2: "buddy1" };

export async function runJoin(
  code: string
): Promise<{ slot: Slot; otherOnline: boolean; messages: Message[] }> {
  let channelId: string;
  let secret: string;
  try {
    ({ channelId, secret } = decodeInviteCode(code));
  } catch {
    throw new Error("invalid invite code");
  }

  const slot = await joinChannel(channelId, secret);
  writeConfig({ channelId, secret, slot });

  const otherOnline = await getPresence(channelId, secret, OTHER_SLOT[slot]);

  const since = readLastSeenId(channelId);
  const messages = await pullMessages(channelId, secret, since);
  if (messages.length > 0) {
    writeLastSeenId(channelId, messages[messages.length - 1].id);
  }

  return { slot, otherOnline, messages };
}
