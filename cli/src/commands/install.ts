import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const COMMANDS: Record<string, string> = {
  "init-relay.md": `---
description: Create a walkie-talkie channel and print an invite code (run once, ever)
---

Run this exactly once, ever, to create the shared channel:

\`\`\`bash
npx @dhruv_anand/walkie-talkie init
\`\`\`

This also attaches this session as \`buddy1\` automatically — no separate join needed on this
side. Print the resulting invite code clearly and tell the user to send it to the other person
(Slack, text, etc — outside this system). They'll run \`/join-relay <code>\` and be assigned
\`buddy2\`.

Do not run this again for the same pairing — running it a second time creates a brand new,
unrelated channel. If a channel already exists, run \`/status-relay\` instead — it reprints the
current invite code and connection status without creating anything new.
`,
  "status-relay.md": `---
description: Reprint the current invite code and connection status without creating a new channel
---

Run this whenever you need the invite code again (already ran \`init\` earlier, or resuming a
session) instead of running \`init\` a second time — running \`init\` again creates a brand new,
unrelated channel:

\`\`\`bash
npx @dhruv_anand/walkie-talkie status
\`\`\`

If this reports "not joined to any channel yet", there's nothing to reprint — run
\`/init-relay\` (if no channel has ever been created) or \`/join-relay <code>\` (if you have an
invite code from the other person) instead.
`,
  "share-context.md": `---
description: Push an async update (FYI or answer) to the paired walkie-talkie channel
---

Run this to push a message. If $ARGUMENTS contains "--reply-to <id>", pass it through as-is:

\`\`\`bash
npx @dhruv_anand/walkie-talkie share "$ARGUMENTS"
\`\`\`

Use this for FYIs the other side should see next session — API contract changes, decisions,
status updates. This never blocks; nothing waits for it to be read. The output also reports
whether the other side is currently online or offline (connection closed) at the time of
pushing — this is a snapshot at push time, not a live notification.
`,
  "ask-relay.md": `---
description: Ask the paired walkie-talkie session a question that blocks until answered
---

Run this when you need an answer from the other side before you can proceed:

\`\`\`bash
npx @dhruv_anand/walkie-talkie ask "$ARGUMENTS"
\`\`\`

This blocks (with a timeout) only if the other side is currently online. If they're offline,
it pushes the question anyway and returns immediately with a fallback so you aren't stuck. If
the other side disconnects while you're waiting (their session closes mid-poll), this also
exits early with a disconnect message instead of waiting out the full timeout.
`,
  "join-relay.md": `---
description: Attach this session to a walkie-talkie channel (run once per session, every session)
---

Run this at the start of a session to attach and pull in anything unread. The relay
auto-assigns a slot ("buddy1" or "buddy2") — no role to choose. $ARGUMENTS is just the invite
code. The output reports connection status: "waiting for buddy2/buddy1 to join" if the other
side isn't here yet, or "you're both connected" if they are.

\`\`\`bash
npx @dhruv_anand/walkie-talkie join $ARGUMENTS
\`\`\`

There is no auto-connect — this must be run explicitly, every session, on both sides.

**If the output lists any unanswered questions**, answer each one now, before starting on
anything else the user asked for this session. Reply to each with:

\`\`\`bash
npx @dhruv_anand/walkie-talkie share "<your answer>" --reply-to <question id>
\`\`\`

Only proceed to the user's actual request once every unanswered question has been replied to.
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
