---
kind: upgrade-guide
description: "内置 cwd 提示词变量和 provider 的 cwd 配置由 Session 工作目录服务与每次启动的 cwd 替代。"
---

# 迁移工作目录模板与子代理配置

[English](guide.md) | 中文

## 变更

下一版本移除 loop 的内置 `{{cwd}}` 提示词变量，以及 `@deepseek-ai/dsh-subagent-acp` 和 `@deepseek-ai/dsh-subagent-dsh-sdk` 的 `cwd` 配置键。自定义提示词模板保留未解析的 `{{cwd}}` 时，会在模型请求发出前失败。Session 当前执行目录作为必需的 user context 提供，并与原始 `Session.header.cwd` 分开持久化。

新子代理使用启动请求中显式提供的 `cwd`，未提供时捕获父代理的当前目录。已有进程保留各自的目录。切换执行目录不会改变原始项目，也不会授予额外写权限。

## 迁移

1. 在 home、profile 或本次调用的 `personaSuffix` 配置，以及 preset 的 `suffix` 字段中，移除引用 `{{cwd}}` 的目录语句，保留其他文本。suffix 变为空时省略或清空该字段。[工作目录服务](../../../../packages/session/working-directory/README.zh.md)负责提供目录上下文。
2. 从 profile patch 中的 ACP 与 DSH-SDK 子代理 provider 行移除 `config.cwd`。为单个子代理选择目录时，在其[启动请求](../../../subsystems/subagent.zh.md)中传入 `cwd`。改变父代理执行目录时，先调用 `working_directory({ cd: "/absolute/project" })`，再启动子代理。
3. 在相关 Session 中调用 `working_directory({})` 并确认报告的目录。启动一个不带目录覆盖的子代理并检查其执行目录；子代理需要另一个 checkout 时，显式提供启动 `cwd`。仅用 `Session.header.cwd` 读取原始项目标识或权限根目录，当前目录操作使用工作目录服务。
