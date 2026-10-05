---
kind: upgrade-guide
description: "九个可选包使用实验性名称，钩子、webhook、终端、Ralph 和徽章配置需要显式安装或插入。"
---

# 实验性包名称与显式组合

[English](guide.md) | 中文

## 变更

下一个版本替换以下 v0.2.1-alpha.1 包名称：

| `@deepseek-ai/dsh-` 后的旧名称后缀 | 新后缀 |
|---|---|
| `hook-protocol` | `experimental-hook-protocol` |
| `hooks-claude-code` | `experimental-hooks-claude-code` |
| `hooks-codex` | `experimental-hooks-codex` |
| `webhook` | `experimental-webhook` |
| `webhook-github` | `experimental-webhook-github` |
| `session-title-all-prompts-llm` | `experimental-session-title-all-prompts-llm` |
| `tool-terminal` | `experimental-tool-terminal` |
| `tool-ralph` | `experimental-tool-ralph` |
| `skill-badge` | `experimental-skill-badge` |

CLI 与 Python 运行时不再安装迁移后的钩子桥接或 Ralph。CLI 不再安装两个 webhook 包。Base 与完整 Web 预设省略休眠的 Ralph 行，base 也省略休眠的徽章行。只启用这些已删除 ID 的 patch 不会插入插件。默认活动行为、插件注册名称、工具名称与已记录的 Session 事件名称保持不变。

## 迁移

1. 按表替换依赖、导入、profile patch 和 overlay 中的旧 npm 名称。不要改写已记录的 Session 事件。
2. 将包与缺失的 peer 安装到每个受影响的 profile。Profile 禁用自动 peer 安装。例如，运行 `dsh plugin --profile web add @deepseek-ai/dsh-experimental-hooks-claude-code @deepseek-ai/dsh-experimental-hook-protocol`。Codex 桥接需要相同的协议 peer。GitHub 适配器需要同时安装 `@deepseek-ai/dsh-experimental-webhook` 与 `@deepseek-ai/dsh-experimental-webhook-github`。使用终端工具的 profile 还需显式安装 `@deepseek-ai/dsh-experimental-tool-terminal`；CLI 随附终端服务与后端，但其生产依赖不包含该工具。
3. 将覆盖已删除行的 patch 替换为完整插入。在预设的 `config.plugins` 中添加预设内工具及其需要的服务。宿主徽章插入示例：

   ```yaml
   - insert:
       - id: skill-badge
         name: '@deepseek-ai/dsh-experimental-skill-badge'
   ```

4. GitHub review 使用适配器随附的示例，替代已删除的 CLI 示例。遵循[安装版 profile 说明](../../../user/guide/github-review.zh.md)；将定制规则模块保留在 profile 内，使其导入能解析该 profile 安装的包。
5. 启动 profile，确认配置的插件激活时没有缺包、缺 peer 或缺行错误。确认预期工具或技能在目标 Agent 预设中可用。
