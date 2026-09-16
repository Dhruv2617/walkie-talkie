import { readConfig } from "../config.js";
import { Slot, getPresence, pushMessage } from "../relayClient.js";

const OTHER_SLOT: Record<Slot, Slot> = { buddy1: "buddy2", buddy2: "buddy1" };

export async function runShare(
  text: string,
  opts?: { replyTo?: number }
): Promise<{ id: number; otherSlot: Slot; otherOnline: boolean }> {
  const cfg = readConfig();
  if (!cfg) throw new Error("not joined to a channel — run `ctx-relay join <code>` first");

  const otherSlot = OTHER_SLOT[cfg.slot];
  const otherOnline = await getPresence(cfg.channelId, cfg.secret, otherSlot);

  const id =
    opts?.replyTo !== undefined
      ? await pushMessage(cfg.channelId, cfg.secret, {
          from: cfg.slot,
          type: "answer",
          text,
          reply_to: opts.replyTo,
        })
      : await pushMessage(cfg.channelId, cfg.secret, { from: cfg.slot, type: "fyi", text });

  return { id, otherSlot, otherOnline };
}
