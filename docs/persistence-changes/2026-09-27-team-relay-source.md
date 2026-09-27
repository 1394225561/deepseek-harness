---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-27-team-relay-source

English | [中文](2026-09-27-team-relay-source.zh.md)

## Summary

Adds the Team-owned team-relay attribution source to persisted user and developer message slots without changing the Session format version.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-27-team-relay-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "069fe0ac1098edd8c2582179e19aa1168db48efcbc41052d0b8a8d4a29d09dd4"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "3891652446c8d1e35ba97bf0205f5f8d60a08b9e4bc3213665a4921ae9c6484e"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "d36d44ef7e257e6fb64aa4fcda3b106b5e3d4afdca5227e5b6a8b721f1f2bbb7"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "0ba8d5b72bf31a4148e9d1fabf661869806ec32fe0d86d92c49cdef691b22d58"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing agent-message and historical team-message records remain unchanged. The new kind records senderSessionId, senderName, and relay form only; it imposes no replay, validation, or authority requirement. Current V4 readers preserve unknown attribution and its JSON metadata without the Team producer. Older clients can display the recorded content with generic source presentation.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/agent-team packages/experimental/tool-agent-team packages/client/ui-chat/tests/turn-trigger.client.spec.tsx: 129 tests passed. pnpm exec vitest run packages/experimental/agent-team/tests/persistence.spec.ts packages/session/session-format-v3-to-v4/tests/attribution.spec.ts packages/session/session-format-v3-to-v4/tests/message-sources.spec.ts: 16 tests passed, including target inbox recovery with Team disposed. pnpm run test:snapshot -t 'team-direct-inbox|team-targets': 2 scenarios passed.

<a id="dev-note"></a>
## Dev Note

None.
