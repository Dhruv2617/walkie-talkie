---
description: Create a walkie-talkie channel and print an invite code (run once, ever)
allowed-tools: Bash
---

Run this exactly once, ever, to create the shared channel:

```bash
CTX_RELAY_URL="${CTX_RELAY_URL:-https://walkie-talkie-relay-dhruvs-projects-49c8a074.vercel.app}" \
  npx --yes @dhruv_anand/walkie-talkie init
```

This also attaches this session as `buddy1` automatically — no separate `/walkie-talkie:join`
needed on this side. Print the resulting invite code clearly and tell the user to send it to
the other person (Slack, text, etc — outside this system). They'll run `/walkie-talkie:join
<code>` and be assigned `buddy2`.

Do not run this again for the same pairing — running it a second time creates a brand new,
unrelated channel. If a channel already exists (check whether `~/.ctx-relay/config.json`
exists, or just try running `init` and see if this note applies), run `/walkie-talkie:status`
instead — it reprints the current invite code and connection status without creating anything
new.
