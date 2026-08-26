# 09 · 第三方提供方（自定义 provider）的推理强度设置

## 背景

2026-08-26 在 Web UI 用「添加自定义提供方」录入了第三方 provider（Provider ID 为 `b-ai`）后，发现界面上没有任何设置推理强度的地方。本文记录源码层面的原因、正确的配置入口，以及 `llm-pi-ai` 推理档位声明的完整语义；同日按本文方案声明推理档位后出现了新的 400 报错，完整原因链与修复见第七节。

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

---

## 证据文件

- `packages/llm/llm-pi-ai/src/config.ts` —— `PiAiProviderProfile`（L88 起，含 `reasoning` L150、`thinkingBudgets` L152）；模型条目字段 `modelFields.reasoningEfforts` 为 `union([const(false), dict])` 并注明 absent 必须可与 `false` 区分（L284-297）；`reasoningEfforts` schema 注释解释 `off:` 留空为何能通过 schemastery（L268-281）；`assertServiceable` 把校验挂在 settings 写入点（L349）。
- `packages/llm/llm-pi-ai/src/catalog.ts` —— `THINKING_LEVEL_GATE` 七个档位（L74-85）；`PiAiReasoningEfforts = Partial<Record<ModelThinkingLevel, string | null>>`（L198）；`THINKING_FORMAT_GATE` 十种 thinkingFormat（L98-112）。
- `packages/llm/llm-pi-ai/README.zh.md` —— 「按模型的推理（reasoning）档位」「协议兼容开关」两节（L88-99）；无元数据模型不公开 reasoning、`UNSUPPORTED_REASONING_EFFORT`、「描述不失败」语义（L123-127）；分层合并无删除语义的 Known Limitation（L207）。
- `docs/user/guide/providers.zh.md` —— 自定义提供方表单字段（L23-27）；表单没有的字段走 `$DSH_HOME/settings.yaml` 的总原则与排错清单（L82-133）。
- `packages/core/agent/src/model-selection.ts` —— 会话选择的 `reasoningEffort?` 可选字段（L15-16）。
- `node_modules/.pnpm/@earendil-works+pi-ai@0.82.1_*/…/dist/api/simple-options.js` —— `adjustMaxTokensForThinking` 的默认四档预算 1024/2048/8192/16384。
- `node_modules/.pnpm/@earendil-works+pi-ai@0.82.1_*/…/dist/api/openai-completions.js` —— 第七节原因链的落点：L787 `const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole`；L1148 未知端点的检测默认（非 OpenRouter 即支持 developer 角色）；L1194 模型 compat 覆盖检测值的合并点。
