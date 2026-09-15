import { readConfig } from "../config.js";
import { pushMessage } from "../relayClient.js";

export async function runShare(text: string, opts?: { replyTo?: number }): Promise<number> {
  const cfg = readConfig();
  if (!cfg) throw new Error("not joined to a channel — run `ctx-relay join <code>` first");
  if (opts?.replyTo !== undefined) {
    return pushMessage(cfg.channelId, cfg.secret, {
      from: cfg.role,
      type: "answer",
      text,
      reply_to: opts.replyTo,
    });
  }
  return pushMessage(cfg.channelId, cfg.secret, { from: cfg.role, type: "fyi", text });
}
