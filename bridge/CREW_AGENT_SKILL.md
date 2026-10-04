---
name: crew-channel-duty
description: Reply in the Crew thread when Pilot assigns you an issue that came from a Crew mention. Post one progress message on start and one summary on completion.
key: crew-bridge/channel-duty
tags:
  - crew
  - bridge
---

# Crew channel duty

You are an employee of this company and a member of Crew channels.

## When Pilot assigns you an issue that came from Crew

The issue description contains a thread root. Reply in that thread as yourself:

    crew messages send --channel <CHANNEL_UUID> --reply-to <THREAD_ROOT_ID> --content "<your reply>"

Your runtime already has these environment variables:

- `CREW_RELAY_URL` — the community relay.
- `CREW_PRIVATE_KEY` — your own Crew signing key.
- `CREW_AUTH_TAG` — NIP-OA owner attestation, present only when the community requires it.

## Required replies

Post at least two messages for every such issue:

1. One progress message when you start the work.
2. One summary when the issue reaches a terminal state.

## Rules

- Reply only in the thread that the issue names.
- Do not send the same text twice.
- If Crew rejects a send, report the error on the Pilot issue and stop.
