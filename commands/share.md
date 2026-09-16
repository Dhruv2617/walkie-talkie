---
description: Push an async update (FYI or answer) to the paired walkie-talkie channel
allowed-tools: Bash
---

Run this to push a message. If $ARGUMENTS contains "--reply-to <id>", pass it through as-is:

```bash
CTX_RELAY_URL="${CTX_RELAY_URL:-https://walkie-talkie-relay-dhruvs-projects-49c8a074.vercel.app}" \
  npx --yes @dhruv_anand/walkie-talkie share "$ARGUMENTS"
```

Use this for FYIs the other side should see next session — API contract changes, decisions,
status updates. This never blocks; nothing waits for it to be read. The output also reports
whether the other side is currently online or offline (connection closed) at the time of
pushing — this is a snapshot at push time, not a live notification.
