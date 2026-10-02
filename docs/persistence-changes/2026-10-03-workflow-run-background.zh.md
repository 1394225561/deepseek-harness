---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-03-workflow-run-background

[English](2026-10-03-workflow-run-background.md) | 中文

## 概述

为 tool-workflow/run-start 增加可选的后台标记。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-03-workflow-run-background
baseline: false
changes:
  - root: "event:tool-workflow/run-start"
    previous: "2026-09-11-initial"
    after: "0dea366b90e202fdbb1a8d79aef14ffc6716b31000e5116309af6ae65d67cecc"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效。缺失表示前台运行，与后台运行出现之前写入的记录以及所有前台运行一致。Web 工作流节点使用该标记，不再根据已关闭的工具 Step 推断后台作业所属运行已中断。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/workflow/tool-workflow/tests packages/client/ui-workflow-run/tests：70 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
