import { decodeInviteCode } from "../inviteCode";
import { readLastSeenId, writeConfig, writeLastSeenId } from "../config";
import { Message, joinChannel, pullMessages } from "../relayClient";

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
  const messages = await pullMessages(channelId, since);
  if (messages.length > 0) {
    writeLastSeenId(channelId, messages[messages.length - 1].id);
  }

  return { messages };
}
