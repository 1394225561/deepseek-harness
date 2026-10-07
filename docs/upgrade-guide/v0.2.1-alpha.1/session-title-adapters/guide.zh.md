---
kind: upgrade-guide
description: "自定义标题路由要求注册适配器并提供最低推理强度元数据。"
---

# 准备自定义标题路由

[English](guide.md) | 中文

## 变更

模型生成的会话标题通过 `ctx.llm.prepareCall()` 准备请求。仅通过 `llm/stream` 中间件提供标题路由的组合还必须注册适配器。公开可选推理强度的自定义适配器必须声明 `reasoning.floorEffort`；否则最低强度准备会在分发前拒绝。现有具体 `prepareCall()` 输入仍然有效。

## 迁移

1. 通过 `ctx.llm.registerAdapter()` 注册标题路由。回放组合可配置现有 `llm-replay` 插件的 `providers` 列表。
2. 在适配器的模型元数据中，将 `reasoning.floorEffort` 设为 `reasoning.efforts` 中最低可选强度的 id。回放模型使用 `floorReasoningEffort` 和 `reasoningEfforts`。路由没有可选控制时省略推理元数据。
3. 生成标题，确认 `session/title-llm-request` 记录了所选强度，且提供方标题已保存。不含该可选字段的现有 Session 记录仍可读取。
