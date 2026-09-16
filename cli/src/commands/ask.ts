import { readConfig } from "../config.js";
import { Slot, getPresence, pullMessages, pushMessage } from "../relayClient.js";

const OTHER_SLOT: Record<Slot, Slot> = { buddy1: "buddy2", buddy2: "buddy1" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAsk(
  question: string,
  opts: { pollIntervalMs?: number; timeoutMs?: number } = {}
): Promise<string> {
  const pollIntervalMs = opts.pollIntervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  const cfg = readConfig();
  if (!cfg) throw new Error("not joined to a channel — run `ctx-relay join <code>` first");

  const otherSlot = OTHER_SLOT[cfg.slot];
  const online = await getPresence(cfg.channelId, cfg.secret, otherSlot);

  const questionId = await pushMessage(cfg.channelId, cfg.secret, {
    from: cfg.slot,
    type: "question",
    text: question,
  });

  if (!online) {
    return "no one online — proceeding with an assumption, flagged for follow-up";
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await pullMessages(cfg.channelId, cfg.secret, questionId - 1);
    const reply = messages.find((m) => m.type === "answer" && m.reply_to === questionId);
    if (reply) return reply.text;
    await sleep(pollIntervalMs);
  }

  return "no answer yet — proceeding with an assumption, flagged for follow-up";
}
