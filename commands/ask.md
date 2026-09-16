---
description: Ask the paired walkie-talkie session a question that blocks until answered
allowed-tools: Bash
---

Run this when you need an answer from the other side before you can proceed:

```bash
CTX_RELAY_URL="${CTX_RELAY_URL:-https://walkie-talkie-relay-dhruvs-projects-49c8a074.vercel.app}" \
  npx --yes @dhruv_anand/walkie-talkie ask "$ARGUMENTS"
```

This blocks (with a timeout) only if the other side is currently online. If they're offline,
it pushes the question anyway and returns immediately with a fallback so you aren't stuck.
