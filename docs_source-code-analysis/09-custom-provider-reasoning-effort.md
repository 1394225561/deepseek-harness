# 09 · 第三方提供方（自定义 provider）的推理强度设置

## 背景

2026-08-26 在 Web UI 用「添加自定义提供方」录入了第三方 provider（Provider ID 为 `b-ai`）后，发现界面上没有任何设置推理强度的地方。本文记录源码层面的原因、正确的配置入口，以及 `llm-pi-ai` 推理档位声明的完整语义；同日按本文方案声明推理档位后出现了新的 400 报错，完整原因链与修复见第七节；界面把模型上下文窗口显示为 262k 的来源与改成 1M 的方法见第八节。同日稍晚，一个跑在该路由上的长会话又在思考模式 + 工具调用下出现 `reasoning_content` 回传 400，完整取证、原因链，以及 `requiresReasoningContentOnAssistantMessages` 与 `maxTokensField` 两个开关的准确语义和一次巧合性恢复的甄别，见第九、十节。

## 一、为什么界面上没有推理强度控件（设计使然）

- 自定义提供方表单只覆盖基本字段：Provider ID、显示名称、API 地址、API 协议、凭据、模型列表（[docs/user/guide/providers.zh.md](../docs/user/guide/providers.zh.md)）。推理强度不在其中。
- 更根本的原因：通过表单手工录入的模型**不带任何推理元数据**。harness 对没有元数据的模型完全不公开 `reasoning` 能力——模型选择器因此不渲染推理强度控件，而不是渲染了一个不可用的控件（`packages/llm/llm-pi-ai/README.zh.md` 「没有这份元数据的模型……」段）。
- 会话侧的对应关系：模型选择携带的 `reasoningEffort` 是可选项，「Adapter-owned reasoning effort, or provider/default behavior when absent」（`packages/core/agent/src/model-selection.ts`）。
- 所以让控件出现的唯一途径是：在配置里给该模型显式声明 `reasoningEfforts`。

## 二、配置入口：$DSH_HOME/settings.yaml

表单保存的数据本身就落在 settings 文档里；高级字段（推理、compat、图片模态等）直接编辑同一份文件即可：

```yaml
# $DSH_HOME/settings.yaml（DSH_HOME 默认 ~/.dsh）
llm-pi-ai:
  providers:
    b-ai:
      models:
        - id: your-model-id        # 表单里已录入的模型 id
          reasoningEfforts:
            off:                   # 提供 Off 档：选中时不发送任何思考参数
            minimal: minimal
            low: low
            medium: medium
            high: high
```

模型变更在下一次请求时生效，不需要重启服务。

## 三、`reasoningEfforts` 的完整语义

| 维度 | 规则 |
|---|---|
| 键 | 选择器提供的档位名，只能取 pi-ai 的封闭集合：`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`（catalog.ts 的 `THINKING_LEVEL_GATE` 是漂移门禁：上游增删档位会让构建失败，而不是静默收窄可选集） |
| 值 | 分派时实际发送的 wire 拼写，可以改名适配网关自有词汇（如 `max: ultra`）；只有 `off` 允许留空 |
| 未声明的档位 | 一律不提供——声明转换为显式的逐档位决定，不走 pi-ai 自己的非对称默认规则 |
| 省略整个字段 | 手工声明的模型＝完全无推理能力；catalog 模型＝保留已安装条目的能力 |
| `false` | 显式声明不具备推理能力（用于从网关无法服务的 catalog 模型上剥除推理） |
| 空声明 `{}` | 被拒绝，不在「省略」与「false」两种含义之间猜 |

`off` 是唯一的三态键：

| 写法 | 效果 |
|---|---|
| 不写 `off` | 选择器不提供 Off；显式请求 Off 被拒绝。不点名任何档位的请求仍不带参数发出 |
| `off:`（声明而不给值） | 提供 Off；选中时什么也不发送（`deepseek` 方言则发显式 `thinking: {type: "disabled"}`），同时覆盖「未点名任何档位」的请求 |
| `off: none`（声明并给值） | `none` 作为档位参数在协议中发送 |

注意：没有任何写法能把声明过的档位恢复为「未设置」——这份声明就是对外提供的全部。若在 catalog 路由上做局部声明，要把想保留的 catalog 档位一并重述出来。

## 四、路由级默认与请求级行为

- **部署默认档位**：路由级 `reasoning: <level>`（如 `reasoning: high`）。省略则保留提供方自己的默认行为；每次请求的显式选择优先于它。
- **token 预算式强度**：路由级 `thinkingBudgets: {minimal, low, medium, high}`，供按预算控制思考量的 provider 使用。pi-ai 内部默认为 minimal 1024 / low 2048 / medium 8192 / high 16384。
- **不自动降档**：请求点名了模型能力之外的档位时，请求在网络 I/O 前**直接失败**（`UNSUPPORTED_REASONING_EFFORT`），不会被悄悄调整到相邻档位。「描述」模型的界面路径则相反——对该模型拿不下的 profile 默认档位报告为「没有默认值」而不抛错，避免一个配错字段把整个提供方从目录里藏掉。
- **选择器展示**：携带推理元数据的模型公开 pi-ai 有序的 `getSupportedThinkingLevels(model)` 结果（含 `off` 及对 `xhigh`/`max` 的特定支持）；harness 将每个规范级别公开为不透明 ID，wire 拼写留在 pi-ai 的 `thinkingLevelMap` 里。

## 五、思考级别的 wire 格式（compat）

对 pi-ai 无法识别的 baseURL（一切自定义提供方），检测把它当 OpenAI 本身对待：思考级别只发一个裸的 `reasoning_effort` 字段。网关若要求别的格式，用该模型的 `compat.thinkingFormat` 更正：

- 可命名的全部格式（catalog.ts `THINKING_FORMAT_GATE`）：`openai` / `deepseek` / `openrouter` / `together` / `zai` / `qwen` / `chat-template` / `qwen-chat-template` / `string-thinking` / `ant-ling`。
- 归属协议：`thinkingFormat` 只能设在 `api: openai-completions` 的路由/模型上；设在不接受的协议上会被拒绝并点名该协议实际提供哪些开关。
- 解析顺序：模型级 → 路由级 → 已安装 catalog 条目 → pi-ai 自身检测；写下的开关必须给值，冒号留空的键（如 `supportsDeveloperRole:`）会被拒绝而不是沿用 catalog。
- 同属 compat 且常与推理模型一起需要更正的：`supportsDeveloperRole: false`（推理模型的系统提示词默认以 `role: "developer"` 发出，多数网关直接拒收）、`maxTokensField: max_tokens`。

## 六、已知坑

- **分层合并对字典键没有删除语义**：settings seam 把组合 base 与用户层按键递归合并。只有当 cordis.yml entry config 为用户层正在编辑的同一模型声明了按模型推理字段时才会触发；受支持的姿态是把 `reasoningEfforts` 这类字段留给 settings 文档（shipped 组合以休眠方式挂载该适配器），且 `models` 数组整体替换是带内的解决办法。
- **`models` 列表是替换不是扩充**：一旦声明，该路由要继续服务的每个模型都必须出现在列表中（每项哪怕只写 `id` 也够）；只想改单个 catalog 模型时用 `modelOverrides`。
- **排错速查**：只有推理模型失败 → 先试 `compat.supportsDeveloperRole: false`；密钥地址都对但全被拒 → 先试 `supportsDeveloperRole: false` + `maxTokensField: max_tokens`（见 providers 指南排错节；实例见第七节）。

## 七、实战案例：声明推理强度后请求 400（`role: "developer"` 被拒）

### 现象

按第二、三节给 b-ai 的模型声明 `reasoningEfforts` 后，从 dsh 发起对话报错：

```text
400: {"message":"Failed to deserialize the JSON body into the target type:
messages[0].role: unknown variant `developer`, expected one of
`system`, `user`, `assistant`, `tool`, `latest_reminder`
at line 1 column 60","type":"invalid_request_error",...}
```

而 b.ai 官方调用示例里系统提示词走的是普通 `system` 角色。（顺带的旁证：合法角色集里有非 OpenAI 标准的 `latest_reminder`——该端点本就不是原生 OpenAI 服务，请求形状断言更不能依赖 pi-ai 对 URL 的猜测。）

### 原因链

声明推理强度这个动作本身触发了请求形状升级，三个条件缺一不可：

1. `reasoningEfforts` 声明使模型带上推理能力（`model.reasoning` 非空）；
2. baseURL 不在 pi-ai 已安装目录内 → pi-ai 的检测把端点当作 OpenAI 本身对待 → `supportsDeveloperRole` 默认为 `true`；
3. pi-ai 分派源码 `openai-completions.js:787`：

   ```js
   const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
   ```

   于是系统提示词从官方示例的 `role: "system"` 升级为 OpenAI 推理模型专用的 `role: "developer"`，而 b.ai 的反序列化只认 `system` / `user` / `assistant` / `tool`，直接拒收。

即：为开启推理控件所做的声明，连带把整个请求换成了「OpenAI o 系模型」的说话方式。

### 修复

路由级 compat 关闭 developer 角色并顺手对齐输出上限字段：

```yaml
llm-pi-ai:
  providers:
    b-ai:
      compat:
        supportsDeveloperRole: false   # 系统提示词回退 role: "system"
        maxTokensField: max_tokens     # 见下
      models:
        - id: your-model-id
          reasoningEfforts:
            …                          # 推理档位声明保持不变
```

第二个开关的依据：官方示例输出上限写 `max_tokens: 1000`，而 pi-ai 对未知端点默认发 `max_completion_tokens`——修好角色问题后大概率轮到它报 400，一次配齐。

两点一般性结论：compat 开关是对端点的断言而非检查，多设一个网关其实不需要的开关只是改变请求形状、无副作用；生效时机同全文——下一次请求即生效，无需重启。

## 八、模型上下文窗口：界面显示 262k 的来源与改成 1M

### 为什么是 262k

262k 不是从端点查到的，而是 dsh 对「目录与配置都没说大小的手工声明模型」的兜底默认值：`DEFAULT_CONTEXT_WINDOW = 262_144`（config.ts L61），输出上限同理由 `DEFAULT_MAX_TOKENS = 32_768` 兜底（L64）。表单不采集容量字段，手工录入的模型因此全部落到这个默认；界面上显示的就是这个配置值。

harness 没有任何环节去询问端点的真实窗口（与图片模态同一逻辑：不存在可询问的标准端点）。「实际是 200k 还是 1M」只能由提供方文档给答案，再由配置显式声明——与 compat 一样，这是对端点的断言，不是探测结果。

### 设置为 1M

```yaml
llm-pi-ai:
  providers:
    b-ai:
      models:
        - id: your-model-id
          contextWindow: 1000000     # 按 b.ai 官方文档的确切数值填；若 1M 指 2^20 则填 1048576
          maxTokens: 32768           # 可选：输出上限，缺省同为 32768
          reasoningEfforts:
            …                        # 已有的推理档位声明保持不变
```

路由级回退写法：该路由下手工声明的模型全是 1M 时，可只写一次 `defaultContextWindow: 1000000`（与 `apiKeyEnv` 平级）。注意它是**回退值**——只对条目自己没写 `contextWindow` 的模型生效，条目显式写的逐字段优先。

### 为什么值得配准

`contextWindow` 参与请求尺寸计算：输出上限会被 clamp 进上下文余量内（pi-ai `clampMaxTokensToContext`），token 计量与界面的占用比例也以它为分母。声明小了浪费可用窗口、过早触发压缩；声明大了则会在会话变长后被提供方中途拒单，而消息已经落盘，会话会不断重复发出无法成功的请求。生效时机同全文：下一次请求即生效、无需重启，界面显示随之更新。

## 九、实战案例：思考模式 + 工具会话中途 400（`reasoning_content` 未回传）

### 现象

2026-08-26 一个小说修订长会话（session-36300dca…，b-ai/`deepseek-v4-flash`，推理强度 max）在 turn 3 step 5 突然失败：

```text
400: {"message":"The `reasoning_content` in the thinking mode must be passed back to the API.","type":"invalid_request_error","param":"","code":"invalid_request_error"}
```

请求体被直接拒收（无任何流式输出，usage 为 0/0）；错误归类为 `INVALID_REQUEST`，不在重试策略白名单内，整轮立即终止。该会话走的是 `llm-pi-ai`（pi-ai@0.82.1 的 openai-completions 协议），不是自带 CoT 回传逻辑的 `llm-deepseek` 适配器。

### 官方规则：tools 在场时 reasoning_content 必须全程往返

DeepSeek 思考模式指南（api-docs.deepseek.com/guides/thinking_mode）的规则按「两条 user 消息之间」划界：

| 请求是否带 `tools` | 中间 assistant 消息的 `reasoning_content` |
|---|---|
| 不带 | 无需传回；传了也会被忽略，不报错 |
| 带 | **必须在其后的所有请求中原样传回——即使该轮没有发起工具调用**；否则 400 |

校验范围不是只查最后一条消息，而是该窗口内的全部中间 assistant 消息。

### 取证方法

- 会话日志位于 `$DSH_HOME/sessions/<工作目录串化名>/session-<id>/session.jsonl.zstd`（zstd 压缩 JSONL；增量压缩的分片事件以 `seq0`/`time0` 字段标识）。
- `request/header` 事件在每个 turn 开始落一条，携带当次完整 `config`（provider/model/reasoningEffort/maxTokens）与系统提示词全文——是检测「会话中途换模型」的权威证据。
- wire 请求可离线重放：pi-ai 导出了 `convertMessages`（dist/api/openai-completions.js），把日志重建的消息喂进去即得等价的请求体，再对成功步与失败步逐条差分。

### 原因链：三个缺口叠加

**缺口 1：会话中途换模型，跨模型重放把思考内容降级为正文（主因）。** turn 1 用的是 `deepseek-v4-flash-vision-exp`，turn 2 起换成 `deepseek-v4-flash`（user 消息原文「我切换了下模型」，两份 `request/header` 证实）。pi-ai 重建历史时按 provider+api+model 三元组判断同源（transform-messages.js L68-70），不同源时把 thinking 块转成普通文本并入 content（L87-90，为跨厂商可移植性设计）。于是 turn 1 全部 27 条 assistant 消息的 `reasoning_content` 在 wire 上不可逆丢失——例如 turn1-step16 那条 8441 字符的思考内容，在 wire 上成为同长度的正文文本。

**缺口 2：零思考输出轮次天然无 CoT 可回传。** 该会话有 6 条 assistant 消息流式阶段就没收到任何 `reasoning_content`（纯工具调用轮：t1s5、t1s22、t1s27、t2s4、t2s28、t3s3），即使同源也没有字段可发；失败前一步正是其中之一（t3s3 的一次 edit 调用）。

**缺口 3：兜底开关未开启。** pi-ai 只对 provider 为 `deepseek` 或 baseURL 含 `deepseek.com` 的路由自动补空串（见第十节）；b-ai 不在检测范围，而 profile compat 当时只设了 `supportsDeveloperRole: false`。

正常路径本身是通的：流式端把 DeepSeek 返回的 `reasoning_content` delta 以 `thinkingSignature: "reasoning_content"` 记进 replay 元数据并随消息持久化，回放时原样恢复、序列化时以签名为字段名发出——同源且当轮有思考内容的消息都能正确往返。

三项缺口的合计后果：失败请求的 59 条 assistant 消息中 30 条带 tool_calls 却无 `reasoning_content`（27 条来自 turn 1 跨模型降级，其中 3 条本就零思考；另 3 条为后续同源的零思考轮次）。

### 校验器行为的不一致性（诚实的保留项）

离线差分显示一个悖论：step 4（成功）与 step 5（失败）的请求体几乎相同——前者缺字段的消息一样多，后者反而是往已通过的 body 末尾追加了一条格式完好、带 `reasoning_content` 的新消息后失败。纯函数式校验无法解释这个方向，说明网关（或其上游）的校验是不完全或滞后的（只查尾部窗口、按增量缓存边界延迟一轮、或负载均衡下异质节点各查各的）。确切的服务端判定粒度从外部无法证明；但不影响结论——两次请求都客观违反官方契约，违规点在失败前早已持续存在。

### 后果与修复方向

违规消息随历史持久化，此后每轮请求都带着它们，命中严格校验路径时整段会话反复「变砖」。可选方向：

1. 给 b-ai 加 compat `requiresReasoningContentOnAssistantMessages: true`（推荐的保险，机制见第十节）；
2. 思考模式 + tools 的会话不要中途换模型——旧轮 CoT 一旦降级不可恢复；
3. 向 pi-ai 上游反馈跨模型降级与 DeepSeek 往返契约的冲突；
4. 已变砖的会话放弃续用，新开会话。

## 十、`requiresReasoningContentOnAssistantMessages` 与 `maxTokensField` 的准确语义

### requiresReasoningContentOnAssistantMessages：补空串的兜底开关

pi-ai 序列化每条历史 assistant 消息的收尾处（openai-completions.js L924-928）：当请求处于推理模式（`model.reasoning` 为真）且这条消息最终不会带 `reasoning_content` 字段时，补一个空字符串。DeepSeek 校验器检查的是字段存在性，空串即可通过；官方语义上应传回真实 CoT，空串只是满足校验层的最小实现。自动开启条件只有 provider 为 `deepseek` 或 baseURL 含 `deepseek.com`（L1143），其余路由一律手动声明。它修补的是每次请求的 wire 形状，不改动会话日志中的任何持久化数据。

### maxTokensField：只决定上限字段的拼写

唯一作用点在 buildParams（openai-completions.js L531-538）：仅当请求真的携带输出上限（`options.maxTokens` 非空）时，决定写旧版通用的 `max_tokens` 还是 OpenAI 较新的 `max_completion_tokens`。默认值由端点检测给出（L1141、L1151）：chutes/moonshot/cloudflare-gateway/together/nvidia/ant-ling 等强制 `max_tokens`，其余未识别提供商（含 b-ai）默认 `max_completion_tokens`。它与 `reasoning_content` 校验没有任何交互。

### 「加了 maxTokensField 后发『继续』就恢复」的证据链

会话日志的两份 `request/header` 显示 `config` 只有 provider/model/reasoningEffort 三个键、`adapterDefaults` 为 null——本次运行从未配置任何 token 上限。逐层核实：agent 循环只在显式配置时填 `maxTokens`（agent-loop/src/agent.ts L446）；服务层的 `defaultMaxTokens` 兜底要求 profile 配置过 `maxTokens`（llm/src/index.ts L784-785 与 llm-pi-ai/src/adapter.ts L298-306），同样不存在。于是 pi-ai 的 `if (options?.maxTokens)` 分支整个跳过，wire 上从未出现过任何一个上限字段——`maxTokensField` 在此配置下是惰性开关，一个字节都没改变请求体，不可能是恢复的原因。

真正同时发生的是两件事：(1) 新的 user 消息开启了新轮次——失败的请求以 assistant + tool-result 对结尾，而新 user 消息追加后，对话末段变成「user 收尾、中间零条 assistant」，DeepSeek 规则按「两条 user 消息之间」划界，尾部窗口式校验此时无东西可查；(2) 网关校验本身不一致（第九节悖论已证），同一 body 此时被拒、彼时被收。结论：时间相关的巧合性恢复，不是因果修复。

### 结论与建议姿态

历史中 30 条缺 `reasoning_content` 的消息仍然永久存在，目前网关容忍，再次命中严格路径就会复发。建议：仍给 b-ai 加 `requiresReasoningContentOnAssistantMessages: true` 作为保险；`maxTokensField: max_tokens` 可以留着——无害，且将来真配了 `maxTokens` 输出上限时，DeepSeek 系上游用 `max_tokens` 才是对的名字。

---

## 证据文件

- `packages/llm/llm-pi-ai/src/config.ts` —— `PiAiProviderProfile`（L88 起，含 `reasoning` L150、`thinkingBudgets` L152、容量字段 `defaultContextWindow`/`defaultMaxTokens` L128-134）；第八节的兜底默认 `DEFAULT_CONTEXT_WINDOW = 262_144`（L61）与 `DEFAULT_MAX_TOKENS = 32_768`（L64），schema 默认值挂接在 L315-316；模型条目字段 `modelFields.reasoningEfforts` 为 `union([const(false), dict])` 并注明 absent 必须可与 `false` 区分（L284-297）；`reasoningEfforts` schema 注释解释 `off:` 留空为何能通过 schemastery（L268-281）；`assertServiceable` 把校验挂在 settings 写入点（L349）。
- `packages/llm/llm-pi-ai/src/catalog.ts` —— `THINKING_LEVEL_GATE` 七个档位（L74-85）；`PiAiReasoningEfforts = Partial<Record<ModelThinkingLevel, string | null>>`（L198）；`THINKING_FORMAT_GATE` 十种 thinkingFormat（L98-112）。
- `packages/llm/llm-pi-ai/README.zh.md` —— 「按模型的推理（reasoning）档位」「协议兼容开关」两节（L88-99）；无元数据模型不公开 reasoning、`UNSUPPORTED_REASONING_EFFORT`、「描述不失败」语义（L123-127）；分层合并无删除语义的 Known Limitation（L207）。
- `docs/user/guide/providers.zh.md` —— 自定义提供方表单字段（L23-27）；表单没有的字段走 `$DSH_HOME/settings.yaml` 的总原则与排错清单（L82-133）。
- `packages/core/agent/src/model-selection.ts` —— 会话选择的 `reasoningEffort?` 可选字段（L15-16）。
- `node_modules/.pnpm/@earendil-works+pi-ai@0.82.1_*/…/dist/api/simple-options.js` —— `adjustMaxTokensForThinking` 的默认四档预算 1024/2048/8192/16384；第八节的 `clampMaxTokensToContext` 以 `model.contextWindow − 已估算上下文 − 4096 安全余量` 收缩输出上限。
- `node_modules/.pnpm/@earendil-works+pi-ai@0.82.1_*/…/dist/api/openai-completions.js` —— 第七节原因链的落点：L787 `const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole`；L1148 未知端点的检测默认（非 OpenRouter 即支持 developer 角色）；L1194 模型 compat 覆盖检测值的合并点。第九、十节的落点：L353-377 流式端把 `reasoning_content` delta 以其字段名记为 thinkingSignature；L531-538 上限字段拼写分支（`if (options?.maxTokens)` 整体跳过时两字段都不发）；L848-877 序列化端按首个思考块的 thinkingSignature 发出 `reasoning_content`；L924-928 `requiresReasoningContentOnAssistantMessages` 兜底空串；L1141/L1151 `useMaxTokens` 名单与 `maxTokensField` 检测默认；L1143 `isDeepSeek` 自动判定。
- `node_modules/.pnpm/@earendil-works+pi-ai@0.82.1_*/…/dist/api/transform-messages.js` —— 第九节缺口 1 的落点：L68-70 同源判定三元组（provider+api+model）；L72-91 思考块的同源保留与跨模型降级为正文。
- `packages/llm/llm-pi-ai/src/replay.ts` —— replay 信封的校验与重建（`replayedAssistant` L179-222 按索引对齐恢复 thinkingSignature）、不可用时的降级路径（`foreignAssistant` L144-176）。
- `packages/core/agent-loop/src/agent.ts` —— L446 `maxTokens = this.options.maxTokens`：上限只在显式配置时进入请求。
- `packages/core/agent-loop/src/invariant.ts` —— L47 断言实际调用选项与会话日志 `request/header.config` 一致，是「header 即权威证据」的依据。
- `packages/llm/llm/src/index.ts` —— L784-785 服务层 `defaultMaxTokens` 兜底（profile 未配则无兜底）。
- `docs/config-catalog.md` —— L1187 `requiresReasoningContentOnAssistantMessages` 的目录文档（「replayed assistant messages need an empty reasoning_content while reasoning is on」）。
- DeepSeek 官方思考模式指南：<https://api-docs.deepseek.com/guides/thinking_mode>（tools 在场时 `reasoning_content` 全程往返规则与 400 行为的原文出处）。
