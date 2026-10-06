---
description: "通过无需登录的 Bing 或 Google 端点翻译文本，可选将结果持久保存到 Session。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-translator

[English](README.md) | 中文

## 概述

`ctx.translator` 通过 Bing 或 Google 翻译一次有大小限制的文本请求。它无需 API 密钥或登录，默认使用 Bing。此实验包需要显式启用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将本包挂载为 Cordis 服务。先调用 `resolve({ text, targetLanguage, sourceLanguage?, provider?, sessionId? })`，再调用 `translate(spec, signal?)`，结果为翻译后的纯文本。省略源语言时使用 `auto`；省略提供者时使用配置中的 `provider`，初始为 `bing`。消费者可以读取 `maxTextChars`，在提交前拆分较长文本。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `provider` | `bing` | `google` 或 `bing` |
| `googleEndpoint` | `https://translate.googleapis.com/translate_a/single` | 兼容 Google 的匿名端点 |
| `bingEndpoint` | `https://edge.microsoft.com/translate/translatetext` | Microsoft Edge 浏览器翻译端点 |
| `timeoutMs` | `10000` | 请求及完整响应正文的截止时间 |
| `maxTextChars` | `4000` | 每次请求提交文本的 UTF-16 代码单元上限 |
| `maxResponseBytes` | `1048576` | JSON 解析前响应正文的字节上限 |

端点接受不含凭据或片段的 HTTP(S) URL。原生 `fetch` 使用 Host 的全局分发器及 `dsh` 启动器安装的 HTTP 代理策略。无需新增翻译库。

传入现有的 `sessionId`，即可将翻译请求和成功结果保存在该 Session 日志中。`translate()` 返回成功结果之前会完成持久化刷新；在精确原文、源语言、目标语言、提供方和翻译配方匹配时，重新挂载或进程重启后会复用已有结果。已保存结果只需持久 Session 存储即可读取。缓存未命中时要求 Session 已激活；消费者负责激活。不传 `sessionId` 的调用仍不保存状态。

服务将 `zh`、`zh-CN`、`zh-SG` 和 `zh-Hans` 映射为简体中文，将 `zh-TW`、`zh-HK`、`zh-MO` 和 `zh-Hant` 映射为繁体中文。其他标签原样传给所选提供者。空文本直接返回空字符串，不发送网络请求。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节 — 点击展开</summary>

Google 接收使用 `gtx` 客户端的表单 POST 请求；Bing 通过 Microsoft Edge 端点接收 JSON 文本数组。两者都通过请求正文接收提交的文本。Cookie、HTTP 重定向和自动切换提供者均已禁用。

绑定 Session 的调用通过规范的插件记录写入器追加与提供方无关的 `plugin:translator/request` 和 `plugin:translator/result` 记录。结果通过 Session 序号引用请求。请求保留精确原文、语言、提供方、翻译配方以及可选的提供方请求元数据；结果保留译文。匿名提供方的配方标识有效配置端点及协议修订。原始对话事件和主模型输入保持不变。

存储读取会校验翻译字段及请求与结果的引用。只有已持久保存的成功结果可复用；失败或中断的提供方输出不作为结果保存。缓存查找使用只读访问，不激活 Agent，也不发布迁移后的 generation。缓存未命中时，通过已激活 Session 的现有写入器调用 `appendPluginRecord` 追加记录，刷新该 Session，并从存储中确认持久化。translator 从不打开写句柄，也不激活 Session。相同翻译的并发请求会等待首次尝试及其已接纳的写入完成，即使其调用方已取消或超时，随后复用其持久结果；不同片段和 Session 可以并行发送请求。插件记录在未来 Session 格式迁移中仅提供尽力保留。

`TranslationError.code` 区分输入限制、HTTP 失败、响应限制、无效提供方响应、传输失败、缺少持久 Session、存储失败以及服务自身的 `TRANSLATION_TIMEOUT` 超时。未激活 Session 缓存未命中时，在调用任何提供方之前以 `TRANSLATION_SESSION_INACTIVE` 拒绝。诊断不包含提交的文本或提供者错误正文。`translate()` 始终返回 Promise，准入或提供者失败都会使其拒绝。调用者取消和服务卸载保留原始中止原因，包括调用者自身的超时原因。排队期间取消会立即返回拒绝；卸载会取消已接纳的请求，并等待底层存储和网络工作结束。`resolve()` 和 `translate()` 都执行输入限制。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[实验包](../README.zh.md) · [HTTP 代理行为](../../util/http-proxy/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为匿名端点翻译不发送模型请求，其保存记录也不改变模型历史。

#### KV 缓存影响

无直接影响；翻译不会改变模型历史。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

- 这些非官方浏览器端点不保证支持第三方 API 调用。它们可能限流、不可用或更改响应格式。在中国大陆的可用性取决于用户网络；服务不保证覆盖整个地区的连接能力。
- 不支持的语言标签由所选提供者报错。消费者负责 Session 激活、段落调度、输入拆分和显示回退。服务复用匹配的持久成功结果；通过准入检查的缓存未命中请求执行单次调用，从不重试或切换提供方。
- 每个片段的查找都会扫描完整 Session 日志并重建翻译索引。较长日志中的大量片段可能延迟展示。不保留增量索引。
- 失败或中断的尝试仍作为仅追加的请求记录保留；重试在派发前追加新的请求序号，不复用未完成尝试。
- 格式错误的翻译记录或引用不存在请求的结果会使该 Session 的所有绑定翻译查找均以 `TRANSLATION_STORAGE_ERROR` 拒绝；服务不跳过或修复这些记录。不传 `sessionId` 的调用不读取这些记录。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节 — 点击展开</summary>

真实提供者测试无需凭据，使用实际默认端点。测试默认跳过，需显式运行 `DSH_TRANSLATION_LIVE=1 pnpm run test:e2e packages/experimental/translator/tests/upstream.e2e.ts` 才启用。它们覆盖 Bing 自动及显式源语言选择、两种提供者的中文区域标签，以及达到默认 4000 字符上限的 Google 请求。

</details>
