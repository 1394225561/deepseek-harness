---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-19-external-subagent-catalog

[English](2026-09-19-external-subagent-catalog.md) | 中文

## 概述

为父级目录中的一次性条目添加可选的外部执行结果。

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
    previous: "2026-09-20-unknown-child-catalog"
    after: "289dc7167ce5942019b86cab1ccfacb72eaf7460ef3c45e3c23780bf8e030376"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有 version-0 和 version-1 的一次性及可继续目录事实在没有可选 external 字段时仍然有效。Version-1 的未知模式事实保持不变。该字段标识没有本地 Session 的子任务，并记录 pending 或终态。Pending 表示尚未记录终态，不代表进程存活。结束时追加具有相同身份与创建时间的完整目录事实；投影为每个子任务保留一行。不引入新的 Session 事件类型、完整结果载荷或 Session 格式版本。

<a id="verification"></a>
## 验证

目录投影、V3 到 V4 目录补全与校验、JSONL 目录迁移测试通过：124 项通过，1 项跳过。覆盖两种受支持载荷版本中混合的未知模式和外部条目、外部 pending 到终态的更新，以及拒绝未知模式或可继续条目上的 external 字段。

<a id="dev-note"></a>
## 开发备注

无。
