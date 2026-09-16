#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runInit } from "./commands/init.js";
import { runJoin } from "./commands/join.js";
import { runShare } from "./commands/share.js";
import { runAsk } from "./commands/ask.js";
import { runInstall } from "./commands/install.js";

export async function dispatch(argv: string[]): Promise<string> {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case "init": {
      const code = await runInit();
      return `invite code: ${code}`;
    }
    case "join": {
      const [code, roleFlag, role] = rest;
      if (roleFlag !== "--role" || (role !== "backend" && role !== "frontend")) {
        throw new Error("usage: ctx-relay join <code> --role <backend|frontend>");
      }
      const { messages } = await runJoin(code, role);
      return `attached as ${role}\n${messages.length} unread message(s) pulled in`;
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
      const id = await runShare(text, replyTo !== undefined ? { replyTo } : undefined);
      return `pushed message ${id}`;
    }
    case "ask": {
      const question = rest.join(" ");
      return runAsk(question);
    }
    case "install": {
      const written = runInstall();
      return `installed ${written.length} Claude Code command(s):\n${written.join("\n")}`;
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dispatch(process.argv.slice(2))
    .then((out) => console.log(out))
    .catch((err) => {
      const message =
        err.message === "role_taken"
          ? "that role is already taken in this channel"
          : err.message;
      console.error(message);
      process.exitCode = 1;
    });
}
