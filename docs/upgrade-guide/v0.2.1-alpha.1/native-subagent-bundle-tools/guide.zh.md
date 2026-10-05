---
kind: upgrade-guide
description: "Claude Code 和 Codex bundle 为完整 Web 预设添加委派工具，并要求这些预设目标存在。"
---

# 原生子智能体 bundle 包含预设工具

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-subagent-claude-code` 和 `@deepseek-ai/dsh-subagent-codex` 的 bundle 层会注册提供方，并为 `preset-standard`、`preset-cordis` 和 `preset-ptc` 添加委派工具。此前它们只注册提供方。现在选择这些 bundle 时要求上述预设行存在；headless、SDK 和 ACP 配置不包含这些行。`dsh plugin add` 会自动选择 bundle，缺少目标时 profile 启动会报 `profile patch preset "preset-standard" is missing or not addressable`。管理器同样报告激活失败，并可保留已保存的选择；按下方步骤恢复，不会自动回滚。

完整 Web 预设不再包含休眠的 `tool-subagent-claude-code` 和 `tool-subagent-codex` 行。Bundle 改为添加 `optional-tool-subagent-claude-code` 和 `optional-tool-subagent-codex`。提供方配置和原生认证保持不变。

`pluginManager.listBundles()` 现在返回必需的 `BundleInfo.official` 和 `BundleInfo.availability` 字段。`official` 标识项目维护的随附可选组合包和按需目录项；`availability` 为 `installation`、`profile` 或 `missing`。`installed` 仍表示 profile 的依赖声明。可选的 `installTarget` 给出 Host 选择的精确 spec 和版本。Client 详情插槽的 `PluginPackageRef` 也要求 `official` 和 `availability`。

## 迁移

1. 对于 Web 或 Desktop，在插件 → 官方中启用所需提供方。普通安装器会选择当前运行的 DSH 精确版本。启用 bundle 前，移除已注册同名 `subagent_claude_code` 或 `subagent_codex` 工具的手动配置行。
2. 移除针对原有休眠行 id 的配置补丁。使用作用于预设的 `preset` 补丁和相应 `optional-tool-subagent-*` id 配置新行。配置覆盖仍会替换整行的配置。
3. 对于 headless、SDK、ACP 或其他不包含这三个预设目标的配置，保留 `$DSH_HOME/profiles/<name>/package.json` 依赖中的提供方包，并从 `dsh.profile.bundles` 移除该条目。在该配置的 `cordis.patch.yml` 中显式挂载提供方和所需的通用委派工具；[Codex](../../../../packages/subagent/subagent-codex/README.zh.md#exposing-the-tool) 和 [Claude Code](../../../../packages/subagent/subagent-claude-code/README.zh.md#exposing-the-tool) 示例展示了相关行。这样可以保留仅安装提供方的工作流。
4. 使用目标预设打开新会话，确认工具目录包含所选委派工具。minimal 预设保持不变。关闭只取消选择 bundle 而不卸载；移除仍为独立操作。
5. 更新构造或校验 `BundleInfo` 或 `PluginPackageRef` 的客户端与测试数据，补充新的必需字段。使用 `official` 分组，使用 `availability` 判断包是否可用；仅凭 `installed: false` 不再能判断这是安装随附的组合包。

<a id="recovery"></a>

**恢复未包含完整预设的 profile**

对已安装提供方包的 profile，在下次启动前运行以下命令；把 `headless` 换成所需 profile 名。该操作不启动 profile，只取消这两个 bundle 层的选择，保留包及其依赖版本：

```sh
dsh plugin --profile headless exec node -e 'const fs=require("node:fs");const p="package.json";const m=JSON.parse(fs.readFileSync(p,"utf8"));m.dsh.profile.bundles=m.dsh.profile.bundles.filter(n=>!["@deepseek-ai/dsh-subagent-codex","@deepseek-ai/dsh-subagent-claude-code"].includes(n));fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n");'
```

随后将所需提供方 README「暴露工具」中的 `insert` 操作加入该 profile 的 `cordis.patch.yml`，再运行 `dsh --profile headless --dump-config` 检查有效组合。共享 base 已提供作业服务，无需重复插入。
