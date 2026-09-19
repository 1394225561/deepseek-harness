---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-19-external-subagent-catalog

[English](2026-09-19-external-subagent-catalog.md) | 中文

## 概述

为父级目录条目增加可选的外部执行结果状态。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-19-external-subagent-catalog
baseline: false
changes:
  - root: "event:subagent/catalog"
    previous: "2026-09-11-initial"
    after: "e6c1b140467c8a4a41ca50676e4213d238f082c3b11b9f998fc9fd4ac21e929a"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有 one-shot 与 continuable 目录事实无需可选 external 字段仍然有效。该字段标识没有本地 Session 的子任务，并记录 pending 或终态。pending 表示尚无终态记录，不表示进程存活。结束时追加具有相同身份与创建时间的完整目录事实，投影为每个子任务保留一个条目。不新增 Session 事件类型、完整结果载荷或 Session 格式版本。

<a id="verification"></a>
## 验证

聚焦的目录与外部激活测试覆盖恢复、直接与后代发现、发布更新、取消、资源释放，以及与输出大小无关的目录载荷。

<a id="dev-note"></a>
## 开发备注

无。
