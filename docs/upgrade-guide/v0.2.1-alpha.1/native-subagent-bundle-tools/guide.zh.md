---
kind: upgrade-guide
description: "Claude Code 和 Codex bundle 为完整 Web 预设添加委派工具，并要求这些预设目标存在。"
---

# 原生子智能体 bundle 包含预设工具

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-subagent-claude-code` 和 `@deepseek-ai/dsh-subagent-codex` 的 bundle 层会注册提供方，并为 `preset-standard`、`preset-cordis` 和 `preset-ptc` 添加委派工具。此前它们只注册提供方。现在选择这些 bundle 时要求上述预设行存在；headless、SDK 和 ACP 配置不包含这些行。

完整 Web 预设不再包含休眠的 `tool-subagent-claude-code` 和 `tool-subagent-codex` 行。Bundle 改为添加 `optional-tool-subagent-claude-code` 和 `optional-tool-subagent-codex`。提供方配置和原生认证保持不变。

## 迁移

1. 对于 Web 或 Desktop，在插件 → 官方中启用所需提供方。普通安装器会选择当前运行的 DSH 精确版本。启用 bundle 前，移除已注册同名 `subagent_claude_code` 或 `subagent_codex` 工具的手动配置行。
2. 移除针对原有休眠行 id 的配置补丁。使用作用于预设的 `preset` 补丁和相应 `optional-tool-subagent-*` id 配置新行。配置覆盖仍会替换整行的配置。
3. 对于 headless、SDK、ACP 或其他不包含这三个预设目标的配置，保留 `$DSH_HOME/profiles/<name>/package.json` 依赖中的提供方包，并从 `dsh.profile.bundles` 移除该条目。在该配置的 `cordis.patch.yml` 中显式挂载提供方和所需的通用委派工具；[Codex](../../../../packages/subagent/subagent-codex/README.zh.md#exposing-the-tool) 和 [Claude Code](../../../../packages/subagent/subagent-claude-code/README.zh.md#exposing-the-tool) 示例展示了相关行。这样可以保留仅安装提供方的工作流。
4. 使用目标预设打开新会话，确认工具目录包含所选委派工具。minimal 预设保持不变。关闭只取消选择 bundle 而不卸载；移除仍为独立操作。
