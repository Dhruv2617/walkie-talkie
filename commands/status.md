---
description: Reprint the current invite code and connection status without creating a new channel
allowed-tools: Bash
---

Run this whenever you need the invite code again (already ran `init` earlier, or resuming a
session) instead of running `init` a second time — running `init` again creates a brand new,
unrelated channel:

```bash
CTX_RELAY_URL="${CTX_RELAY_URL:-https://walkie-talkie-relay-dhruvs-projects-49c8a074.vercel.app}" \
  npx --yes @dhruv_anand/walkie-talkie status
```

If this reports "not joined to any channel yet", there's nothing to reprint — run
`/walkie-talkie:init` (if no channel has ever been created) or `/walkie-talkie:join <code>`
(if you have an invite code from the other person) instead.
