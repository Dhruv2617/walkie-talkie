import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const COMMANDS: Record<string, string> = {
  "share-context.md": `---
description: Push an async update (FYI or answer) to the paired walkie-talkie channel
---

Run this to push a message. If $ARGUMENTS contains "--reply-to <id>", pass it through as-is:

\`\`\`bash
npx @dhruv_anand/walkie-talkie share "$ARGUMENTS"
\`\`\`

Use this for FYIs the other side should see next session — API contract changes, decisions,
status updates. This never blocks; nothing waits for it to be read.
`,
  "ask-relay.md": `---
description: Ask the paired walkie-talkie session a question that blocks until answered
---

Run this when you need an answer from the other side before you can proceed:

\`\`\`bash
npx @dhruv_anand/walkie-talkie ask "$ARGUMENTS"
\`\`\`

This blocks (with a timeout) only if the other role is currently online. If they're offline,
it pushes the question anyway and returns immediately with a fallback so you aren't stuck.
`,
  "join-relay.md": `---
description: Attach this session to a walkie-talkie channel (run once per session, every session)
---

Run this at the start of a session to attach as a role and pull in anything unread. $ARGUMENTS
should be "<invite-code> --role <backend|frontend>":

\`\`\`bash
npx @dhruv_anand/walkie-talkie join $ARGUMENTS
\`\`\`

There is no auto-connect — this must be run explicitly, every session, on both sides.
`,
};

export function runInstall(targetDir: string = process.cwd()): string[] {
  const dir = join(targetDir, ".claude", "commands");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const written: string[] = [];
  for (const [filename, content] of Object.entries(COMMANDS)) {
    const path = join(dir, filename);
    writeFileSync(path, content);
    written.push(path);
  }
  return written;
}
