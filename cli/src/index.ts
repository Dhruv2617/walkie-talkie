#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runInit } from "./commands/init.js";
import { runJoin } from "./commands/join.js";
import { runShare } from "./commands/share.js";
import { runAsk } from "./commands/ask.js";
import { runInstall } from "./commands/install.js";
import { runStatus } from "./commands/status.js";
import { Slot } from "./relayClient.js";

const OTHER_SLOT_NAME: Record<Slot, Slot> = { buddy1: "buddy2", buddy2: "buddy1" };

function connectionStatusLine(slot: Slot, otherOnline: boolean): string {
  const other = OTHER_SLOT_NAME[slot];
  return otherOnline
    ? `connected as ${slot} — ${other} is here too, you're both connected`
    : `connected as ${slot} — waiting for ${other} to join`;
}

export async function dispatch(argv: string[]): Promise<string> {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case "init": {
      const { code, slot } = await runInit();
      const other = OTHER_SLOT_NAME[slot];
      return `invite code: ${code}\nconnected as ${slot} — send the code above to the other person, then wait for ${other} to join`;
    }
    case "join": {
      const [code] = rest;
      if (!code) {
        throw new Error("usage: ctx-relay join <code>");
      }
      const { slot, otherOnline, messages } = await runJoin(code);
      const statusLine = connectionStatusLine(slot, otherOnline);

      if (messages.length === 0) {
        return `${statusLine}\nno unread messages`;
      }

      const answeredIds = new Set(
        messages.filter((m) => m.type === "answer" && m.reply_to !== null).map((m) => m.reply_to)
      );
      const unansweredQuestions = messages.filter(
        (m) => m.type === "question" && !answeredIds.has(m.id)
      );

      const lines = [statusLine, `${messages.length} unread message(s):`];
      for (const m of messages) {
        const tag = m.reply_to !== null ? ` (reply to ${m.reply_to})` : "";
        lines.push(`  [${m.id}] ${m.from} ${m.type}${tag}: ${m.text}`);
      }

      if (unansweredQuestions.length > 0) {
        lines.push("");
        lines.push(
          `${unansweredQuestions.length} question(s) still need a reply — answer with ` +
            `"share <text> --reply-to <id>" before doing anything else:`
        );
        for (const q of unansweredQuestions) {
          lines.push(`  [${q.id}] ${q.text}`);
        }
      }

      return lines.join("\n");
    }
    case "share": {
      let replyTo: number | undefined;
      const words = [...rest];
      const flagIdx = words.indexOf("--reply-to");
      if (flagIdx !== -1) {
        const value = words[flagIdx + 1];
        replyTo = Number(value);
        if (!value || Number.isNaN(replyTo)) {
          throw new Error("usage: ctx-relay share <text> [--reply-to <id>]");
        }
        words.splice(flagIdx, 2);
      }
      const text = words.join(" ");
      const { id, otherSlot, otherOnline } = await runShare(
        text,
        replyTo !== undefined ? { replyTo } : undefined
      );
      const status = otherOnline
        ? `${otherSlot} is online`
        : `${otherSlot} is offline — connection closed`;
      return `pushed message ${id}\n${status}`;
    }
    case "ask": {
      const question = rest.join(" ");
      return runAsk(question);
    }
    case "install": {
      const written = runInstall();
      return `installed ${written.length} Claude Code command(s):\n${written.join("\n")}`;
    }
    case "status": {
      const result = await runStatus();
      if (!result) {
        return "not joined to any channel yet — run `init` (once, ever) or `join <code>`";
      }
      const { code, slot, otherOnline } = result;
      return `invite code: ${code}\n${connectionStatusLine(slot, otherOnline)}`;
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  let resolved: string;
  try {
    // import.meta.url resolves through symlinks (e.g. macOS /tmp -> /private/tmp);
    // argv[1] does not, so compare canonical paths on both sides rather than raw ones.
    resolved = realpathSync(argv1);
  } catch {
    resolved = argv1;
  }
  return moduleUrl === pathToFileURL(resolved).href;
}

if (isMainModule(process.argv[1], import.meta.url)) {
  dispatch(process.argv.slice(2))
    .then((out) => console.log(out))
    .catch((err) => {
      const message =
        err.message === "channel_full"
          ? "this channel already has two people joined"
          : err.message;
      console.error(message);
      process.exitCode = 1;
    });
}
