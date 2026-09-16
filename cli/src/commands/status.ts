import { encodeInviteCode } from "../inviteCode.js";
import { readConfig } from "../config.js";
import { Slot, getPresence } from "../relayClient.js";

const OTHER_SLOT: Record<Slot, Slot> = { buddy1: "buddy2", buddy2: "buddy1" };

export async function runStatus(): Promise<{
  code: string;
  slot: Slot;
  otherOnline: boolean;
} | null> {
  const cfg = readConfig();
  if (!cfg) return null;

  const code = encodeInviteCode({ channelId: cfg.channelId, secret: cfg.secret });
  const otherOnline = await getPresence(cfg.channelId, cfg.secret, OTHER_SLOT[cfg.slot]);

  return { code, slot: cfg.slot, otherOnline };
}
