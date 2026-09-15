import { readConfig } from "../config";
import { pushMessage } from "../relayClient";

export async function runShare(text: string): Promise<number> {
  const cfg = readConfig();
  if (!cfg) throw new Error("not joined to a channel — run `ctx-relay join <code>` first");
  return pushMessage(cfg.channelId, cfg.secret, { from: cfg.role, type: "fyi", text });
}
