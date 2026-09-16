---
description: Attach this session to a walkie-talkie channel (run once per session, every session)
allowed-tools: Bash
---

Run this at the start of a session to attach as a role and pull in anything unread. $ARGUMENTS
should be "<invite-code> --role <backend|frontend>":

```bash
CTX_RELAY_URL="${CTX_RELAY_URL:-https://walkie-talkie-relay-dhruvs-projects-49c8a074.vercel.app}" \
  npx --yes @dhruv_anand/walkie-talkie join $ARGUMENTS
```

There is no auto-connect — this must be run explicitly, every session, on both sides.

**If the output lists any unanswered questions**, answer each one now, before starting on
anything else the user asked for this session:

```bash
CTX_RELAY_URL="${CTX_RELAY_URL:-https://walkie-talkie-relay-dhruvs-projects-49c8a074.vercel.app}" \
  npx --yes @dhruv_anand/walkie-talkie share "<your answer>" --reply-to <question id>
```

Only proceed to the user's actual request once every unanswered question has been replied to.
