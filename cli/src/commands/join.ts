import { decodeInviteCode } from "../inviteCode.js";
import { readLastSeenId, writeConfig, writeLastSeenId } from "../config.js";
import { Message, joinChannel, pullMessages } from "../relayClient.js";

export async function runJoin(
  code: string,
  role: "backend" | "frontend"
): Promise<{ messages: Message[] }> {
  let channelId: string;
  let secret: string;
  try {
    ({ channelId, secret } = decodeInviteCode(code));
  } catch {
    throw new Error("invalid invite code");
  }

  await joinChannel(channelId, secret, role);
  writeConfig({ channelId, secret, role });

  const since = readLastSeenId(channelId);
  const messages = await pullMessages(channelId, secret, since);
  if (messages.length > 0) {
    writeLastSeenId(channelId, messages[messages.length - 1].id);
  }

  return { messages };
}
