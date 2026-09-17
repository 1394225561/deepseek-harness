---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-17-external-subagent-activations

[English](2026-09-17-external-subagent-activations.md) | 中文

## 概述

在父 Session 中记录外部子代理身份和完整执行结果。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-17-external-subagent-activations
baseline: false
changes:
  - root: "event:subagent/external-end"
    previous: null
    after: "186d78392e03b505c93e7be6fe6a9eb7025aa1e6401b600f6502d8e7860bf215"
    decision: same-version
  - root: "event:subagent/external-start"
    previous: null
    after: "e144bc89d55c5f25971eaac9aecddd1549c48912f709af1f7167ae3895dfdf20"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增版本为 0 的 subagent/external-start 和 subagent/external-end 事件，不修改已有事件或 Session 头。已有日志仍可读取。不认识这些必读事件类型的构建会拒绝包含它们的日志。外部子代理没有本地子 Session；父投影保留 JSON 输出、结构化值、诊断和最终停止原因。

<a id="verification"></a>
## 验证

外部记录的 8 个聚焦测试通过，覆盖 JSONL 冷读重建、继承前缀排除、错误配对和 JSON 校验。外部 activation 的 7 个测试通过，覆盖启动取消、结果先于清理、幂等释放、自动回传，以及清理失败后保留已返回输出。

<a id="dev-note"></a>
## 开发备注

无。
