# 11 · 子代理并发数不可配的现状与 tool-subagent 插件详解

## 背景

2026-08-26 使用第三方提供方 b-ai（模型 `deepseek-v4-flash-vision-exp`）时，子代理报「失败原因：429 status code (no body)」（b.ai 限流），追问 dsh 是否支持配置子代理并发数。本文记录结论与证据、针对 429 可落地的替代手段，并系统整理 `tool-subagent` 插件的知识点。

## 一、结论：不支持并发数配置，且设计上放行并发

三个层面的证据：

| 层面 | 事实 |
|---|---|
| 委派工具配置面 | `tool-subagent` 的 Config 全集为：`provider` / `toolName` / `enableRunInBackground` / `backgroundMode` / `agentOptions`（子代理的 provider、model、maxTokens）/ `persona` / `toolFilter` / `maxDepth`——没有任何 maxConcurrent 类字段 |
| 内置 provider | `subagent-spawn-in-process` 与 `subagent-fork-in-process` 的 Config 都只有 `providerName`；`dsh-subagent` 服务本体无 Config |
| 工具执行层 | 工具声明 `isConcurrencySafe: () => true`（tool-subagent/src/index.ts:377）——同一回合并行发出的多个 `subagent` 调用**允许被并发执行**，这是显式标注的放行而非疏漏 |

两个容易混淆的「限」都不是并发限制：

- **`maxDepth`（默认 3）**：限制*递归嵌套深度*（子代理能否再派孙代理），不是同时运行的数量；
- **`enableRunInBackground`**：只控制后台运行形态的有无，不控制并行度。

更要紧的一点：**shipped 系统提示词主动鼓励并行委派**。工具的系统提示词节写道「Start independent delegations together in one assistant message and continue useful work while they run.」（index.ts:473）。所以撞限流时不能归因于模型行为异常——并行是产品默认姿态，只是当前没有与之配套的限流闸门。

## 二、可落地的替代手段（针对 429）

### 手段一：提示词约束串行委派（零改动、立即生效）

原理：只有模型把多个 `subagent` 调用写进**同一个回合**时才会触发并发；串行化后对 b-ai 路由的瞬时压力就是单路。在主会话中明确要求：

> 一次只委派一个子代理；必须拿到上一个子代理的结果后再派下一个。不要在同一回合发出多个 subagent 调用。

注意这与 shipped 提示词的鼓励方向相反，措辞要明确到「不要在同一回合」，否则容易被默认姿态盖过。

### 手段二：组合层给子代理换模型

`agentOptions.model` 会应用到该工具实例派出的每个子代理。它挂在 `tool-subagent` 插件条目上，属于 cordis.yml 组合面（不在 Web UI 设置里）：在 profile 或 `--patch` overlay 层为 base 组合里的条目补 config，例如：

```yaml
# patch 层（profile cordis.patch.yml 或 --patch 文件）
- id: tool-subagent
  config:
    agentOptions:
      model: deepseek-v4        # 换成 b.ai 配额更宽的非 -exp 型号
```

主代理保持原模型不受影响。overlay 的合并规则以 [cordis-primer](../docs/cordis-primer.md) 为准。

### 手段三：重试侧兜底

路由级 `retryPolicy` 加大耐心（默认 normal 模式 5 次、退避 500ms→10s 封顶；可加大 `maxRetries`/`backoff.maxDelayMs`，或改 `mode: always` 无限重试）。字段定义见 `packages/llm/llm/src/retry-policy.ts`。重试治瞬时超限；持续压满限额仍要靠手段一/二降流量。

---

## 三、tool-subagent 插件知识点

### 1. 能力缝中的位置（Service Definition / Provider / Consumer 三角色齐全）

| 角色 | 包 | 职责 |
|---|---|---|
| Service Definition | `@deepseek-ai/dsh-subagent` | `ctx.subagents` 注册表：按名挂 SubagentProvider，暴露 start/listChildren/followup 等 |
| Provider | `subagent-spawn-in-process`（注册名 `spawn`）、`subagent-fork-in-process`（注册名 `fork`） | 实际创建子 Agent；各自声明能力位 |
| Consumer | `tool-subagent` | 把能力做成模型可见的委派工具 + 系统提示词节（顺序 116.5） |

### 2. shipped 组合装配了两条工具实例（bundle/base/cordis.patch.yml L292-339）

| 条目 id | provider | toolName | backgroundMode | 子代理语义 |
|---|---|---|---|---|
| `tool-subagent` | `spawn` | `subagent` | **continuable** | 全新子会话：看不到父对话；后台为默认形态 |
| `tool-subagent-fork` | `fork` | `subagent_fork` | one-shot | 以父会话**已完成回合**做种子（看不到进行中的当前回合）；前台一次性 |

工具描述文字随 provider 的 `inheritsParentContext` 自动切换（`providerWording()`）：fork 版告诉模型「子代理已继承本对话」，spawn 版要求「给完整独立 prompt」——避免提示词说谎。

### 3. Config 字段速查

| 字段 | 默认 | 说明 |
|---|---|---|
| `provider` | 必填 | `ctx.subagents` 上注册的 provider 名 |
| `toolName` | `subagent` | 模型可见的工具名；每个实例须唯一（base 组合即用双实例双名） |
| `enableRunInBackground` | `true` | `false` 时省略 `run_in_background` 参数并拒绝强制后台调用 |
| `backgroundMode` | schema 默认 `one-shot`；base 组合的 spawn 实例覆盖为 `continuable` | `one-shot`＝后台调用返回 job id，用 `job_output`/`job_kill` 收割；`continuable`＝默认后台、返回持久 child id，结束时运行时通知父会话，后续用 `send_message` 续聊同一子对话（需要 provider 的 `prepareContinuable` 能力） |
| `agentOptions` | 缺省用子循环默认 | 应用到每个子代理的 `{provider?, model?, maxTokens?}`——换模型的入口 |
| `persona` | 无 | 覆写子代理 persona 节；需 provider 的 `persona` 能力 |
| `toolFilter` | 无 | `allow`/`deny` 全局工具名清单；被滤工具从子代理 prompt 消失且执行被拒；未知名字启动即失败；需 `toolFilter` 能力 |
| `maxDepth` | `3` | 非负整数或 `'provider-managed'`；`0` 禁止委派；数字档位需 provider 的 `depthLimit` 能力，否则 mount fail loud。由 provider 在每次 start 时检查调用方当前深度——工具保持模型可见，拒绝发生在运行期策略点 |

两个内置 provider 的能力位完全一致：`{ outputSchema, depthLimit, toolFilter, persona }` 全开。

### 4. 运行形态与失败语义

- **前台**：等待子代理终结后把输出块作为工具结果返回。非 `completed` 的 stopReason 一律按失败抛出（`aborted`→已取消；`error`→失败；`max-tokens`→token 耗尽；`refusal`→子代理拒答；未知值→异常终结）——部分输出不算成功，但子代理已产出的文本以 "Partial output before the run ended" 附在错误后返回父会话，诊断文本（`Diagnostic: …`）单独一行，不与子代理的回答混写。
- **后台 one-shot**：立即返回 job id；`job_output` 收割、`job_kill` 终止。
- **后台 continuable**：立即返回持久 child id；子代理终结时运行时向父会话投递含结果与最终回答的通知；`send_message` 在同一子对话上开启后续回合。
- **取消语义**：启动阶段的取消不会把失败的清理伪装成干净的 killed Job（AggregateError 保真上抛）。

### 5. 与 429 报错的关联链

子代理运行失败 → provider 结果带 stopReason `error` + diagnostic（底层错误文本，如 OpenAI SDK 的 "429 status code with no body"）→ `withDiagnosticAndPartialText()` 把 headline、diagnostic、partial output 拼成错误 → 工具结果标记 isError 回到父会话 → UI 以「失败原因：<原文>」渲染。所以在界面上看到的是**子代理视角透传的提供方原始错误**，不是 harness 自身故障。

## 四、边界与坑

- 并发无闸门 + 提示词鼓励并行：共享 key / 低配额型号（尤其 `-exp`）场景必须靠第一节手段约束。
- fork 实例固定 one-shot 是刻意的：continuable 子代理的 `report` 工具与提示词节要先于被继承的历史安装，one-shot fork 不装这两样，保持父请求前缀不被污染（见 `.agents/notes/implemented/architecture/2026-08-10-fork-children-stay-one-shot.md`）。
- `persona`/`toolFilter`/数字 `maxDepth` 都依赖 provider 能力位，选了不具备能力的 provider 会在 mount 时 fail loud，而不是静默失效。

---

## 证据文件

- `packages/subagent/tool-subagent/src/index.ts` —— Config 全字段与默认值（L29-99）；`isConcurrencySafe: () => true`（L377）；系统提示词节鼓励并行委派（L473，节顺序 L26）；`run_in_background` 处理与两种后台模式文案（L248-330）；stopReason→错误映射与 partial/diagnostic 保留（L124-164）；`providerWording()` 按 provider 是否继承上下文切换描述（L220-248）。
- `packages/subagent/subagent-spawn-in-process/src/index.ts` —— Config 仅 `providerName`（L25-30）；能力位全开（L42 附近）。
- `packages/subagent/subagent-fork-in-process/src/index.ts` —— Config 仅 `providerName`（L31-37）；能力位全开（L62）。
- `packages/bundle/base/cordis.patch.yml` —— 服务与两 provider 注册（L292-303）、两条 tool-subagent 实例及 backgroundMode 覆盖（L313-329）、`tool-subagent-report` 直连回报通道（L332-333）。
- `packages/llm/llm/src/retry-policy.ts` —— 默认 normal 5 次 / 500ms→10s / `RATE_LIMIT` 可重试；`mode: always`（L14-57）。
