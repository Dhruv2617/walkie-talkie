---
description: Create a walkie-talkie channel and print an invite code (run once, ever)
allowed-tools: Bash
---

Run this exactly once, ever, to create the shared channel:

```bash
CTX_RELAY_URL="${CTX_RELAY_URL:-https://walkie-talkie-relay-dhruvs-projects-49c8a074.vercel.app}" \
  npx --yes @dhruv_anand/walkie-talkie init
```

Print the resulting invite code clearly and tell the user to send it to the other person
(Slack, text, etc — outside this system). They'll need it for `/walkie-talkie:join`.

Do not run this again for the same pairing — running it a second time creates a brand new,
unrelated channel.
