---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-27-team-relay-source

[English](2026-09-27-team-relay-source.md) | 中文

## 概述

为持久化的 user 和 developer 消息位置添加 Team 所属的 team-relay 归属来源，不改变 Session 格式版本。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有 agent-message 和历史 team-message 记录保持不变。新 kind 仅记录 senderSessionId、senderName 和 relay form，不增加回放、校验或权限要求。当前 V4 读取方在没有 Team 生产者时仍保留未知归属类型及其 JSON 元数据。旧客户端可以使用通用来源展示已记录的正文。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/agent-team packages/experimental/tool-agent-team packages/client/ui-chat/tests/turn-trigger.client.spec.tsx：129 个测试通过。pnpm exec vitest run packages/experimental/agent-team/tests/persistence.spec.ts packages/session/session-format-v3-to-v4/tests/attribution.spec.ts packages/session/session-format-v3-to-v4/tests/message-sources.spec.ts：16 个测试通过，包含卸载 Team 后的目标 inbox 恢复。pnpm run test:snapshot -t 'team-direct-inbox|team-targets'：2 个场景通过。

<a id="dev-note"></a>
## 开发备注

无。
