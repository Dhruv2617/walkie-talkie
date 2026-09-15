import { runInit } from "./commands/init";
import { runJoin } from "./commands/join";
import { runShare } from "./commands/share";
import { runAsk } from "./commands/ask";

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
      const [text] = rest;
      const id = await runShare(text);
      return `pushed message ${id}`;
    }
    case "ask": {
      const [question] = rest;
      return runAsk(question);
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  dispatch(process.argv.slice(2))
    .then((out) => console.log(out))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}
