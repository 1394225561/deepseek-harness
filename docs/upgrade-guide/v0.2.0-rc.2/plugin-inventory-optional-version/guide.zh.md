---
kind: upgrade-guide
description: "插件清单消费者必须接受不含版本的包配置项。"
---

# 插件清单版本改为可选

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-plugin-package-inventory-deepseek/types` 导出的 `DeepSeekPluginPackageIdentity` 将 `version: string` 改为 `version?: string`。包 manifest（元数据清单）具有有效名称，但版本不是非空白字符串时，`dsh_plugin_packages` 请求字段可以包含 `{ name }`。读取此导出类型或上报字段的消费者必须处理版本缺失的情况。外层清单协议仍为 `version: 1`。

## 迁移

1. 更新 `dsh_plugin_packages.packages` 的读取逻辑与校验器，接受只有 `name` 的配置项。执行版本相关操作前检查 `entry.version !== undefined`；版本缺失时只显示包名。
2. 去重与序列化时保留只有名称的配置项。不要虚构包版本，也不要从父包复制版本。
3. 对消费者运行类型检查，并使用 `{ "name": "local-plugin", "private": true }` 这样的 manifest 验证。确认请求包含 `{ "name": "local-plugin" }`，且消费者能够接受不含 `version` 字段的配置项。
