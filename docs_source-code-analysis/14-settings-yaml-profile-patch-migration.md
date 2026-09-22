# 14 · 设置文件迁移：`settings.yaml` 一次性导入 profile patch

## 总览（一句话结论）

**home 级的 `$DSH_HOME/settings.yaml` 机制已被移除**：新版本首次启动会把它改名成 `settings.yaml.imported`，并把每个 section 以「id 定向的 config 覆盖」写进**当前 profile 的 `cordis.patch.yml`**。此后要改配置只有一个地方——profile patch；`.imported` 只是归档，永远不会再被读取。2026-09-22 在本机（web profile）核对的结果：5 个 section 全部导入成功，模型接入配置零丢失，所用字段逐个对照当前 schema 仍全部有效。

## 一、现象与迁移流程

**现象**：`C:\Users\Admin\.dsh\settings.yaml` 不见了，同级多出 `settings.yaml.imported`。

迁移逻辑在 `packages/settings/settings/src/index.ts:241` 的 `importLegacyDocument()`，分五步：

1. **时机**：构造函数中 `ctx.root.loader.await()` 成功之后执行一次（同文件 235 行）——即 Loader 所有 entry 稳定、各插件 Config schema 可查之后，而不是进程启动时。
2. **先改名、后写入**：`rename(path, imported)` 在任何写入之前完成。原注释的意思是「文档在第一次写入前改名，因此部分导入绝不会重复」——即使迁移中途崩溃，重跑也不会二次导入。
3. **逐 section 迁移**：把文档解析成顶层映射，每个 section 的目标 entry id 取 `LEGACY_SECTION_ENTRIES[section] ?? section`（同文件 200-206 行），再 `this.update(ns, values)` 把值合并进该 entry 的 config。
4. **失败不阻塞**：某个 section 被当前组合拒绝时只 `logger.warn` 两条（一节名 + 错误本身），该 section 仅保留在改名后的文件里，其余 section 照常落盘。
5. **收尾日志**：`settings: imported <path> into profile <name>`。

`existsSync(path)` 为假时直接 return（同文件 244 行），所以这是**一次性行为**；home 级 `settings.yaml` 此后不被任何代码读取。旁证：`packages/settings/` 目录下原先的 `settings-file` 包已不存在，当前只剩 `settings/`。

## 二、现在该改哪个文件

### 1. 唯一入口：当前 profile 的 `cordis.patch.yml`

取值链路：`SettingsForms.documentPath`（`packages/settings/settings/src/index.ts:292`）→ `configEditor.documentPath`（`packages/boot/config-editor/src/index.ts:34`）→ `profileContext.patchPath`（`packages/boot/app-boot/src/profile-context.ts:20`）。

也就是 `~/.dsh/profiles/<profile>/cordis.patch.yml`；本机 web profile 为 `C:\Users\Admin\.dsh\profiles\web\cordis.patch.yml`。设置页「打开配置文件」按钮打开的也是它（`prepareDocument()` 返回同一路径，`settings/src/index.ts:296`）。

### 2. 三种改法

| 方式 | 适用场景 | 说明 |
|---|---|---|
| 设置页表单（模型 / 通用设置） | 日常调整 | 走 `update()` → `configEditor.edit()`，落盘的就是 patch；带 volatile 字段校验与修订号冲突保护 |
| 手写 YAML | 表单没有暴露的字段 | 改完需重启或等 profile 重载；`patchReload: live` 的 profile 会热重载 |
| `--patch <file>` 叠加层 | 临时试验 | 不落盘，格式与 patch 相同（`loadOverlayPatches`） |

### 3. patch 文件结构

文件头注释即契约：顶层是 YAML 数组，每项是一条「id 定向的 loader patch entry」——`id`（entry id）、`name`（完整包名）、`config`（要覆盖的字段），三者都要写：

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      b-ai:
        displayName: b.ai
        apiKeyEnv: B_AI_API_KEY
        api: openai-completions
        baseURL: https://api.b.ai/v1
```

**手改写坏的代价**：`loadOptionalPatches`（`packages/boot/app-boot/src/index.ts:303`）对「存在但读不到、解析不了、或不是数组」的文件**直接抛错**，原注释写明「a present patch file that cannot apply is a misconfiguration and must fail loud at boot, never be silently skipped」。所以手改之后先确认 YAML 合法再启动。仓库另提供一个恢复helper `sanitizeProfile`（`packages/boot/app-boot/src/profile-sanitize.ts`，会把 patch 备份为 `cordis.patch.yml.bak-<毫秒时间戳>` 再只重写 bundles），但当前代码树里没有 CLI 入口调用它，不能当作常规回滚手段。

## 三、配置项变更清单

### 1. section 名改名（仅三条）

`LEGACY_SECTION_ENTRIES`（`packages/settings/settings/src/index.ts:200`）：

| 旧 section 名 | 新 entry id | 备注 |
|---|---|---|
| `ui-developer-tools` | `ui-settings` | |
| `ui-onboarding` | `ui-settings-general` | 影响本机：`welcomeNoticeVersion` 落在这里 |
| `shell` | `pwsh-sandbox`（win32）/ `bash-sandbox` | 按平台分流，代码里是同一行三元表达式 |

除这三条之外，section 名默认就等于 entry id，没有改名。

### 2. 字段级核对：本机用到的每一项仍然有效

| Section | 本机取值 | 当前 schema 位置 | 结论 |
|---|---|---|---|
| `llm-pi-ai.providers.*.api` | `openai-completions`、`openai-responses` | `packages/llm/llm-pi-ai/src/provider.ts:48-50` 的 `PROTOCOLS` | 有效 |
| `llm-pi-ai.providers.*.compat` | `supportsDeveloperRole: false`、`requiresReasoningContentOnAssistantMessages: true` | `packages/llm/llm-pi-ai/src/config.ts:258-285` `compatProfile` | 有效 |
| `retryPolicy` | `mode: normal`、`maxRetries: 5`、6 个 `retryableCodes`、`backoff: 2000/10000/0.1` | `packages/llm/llm/src/retry-policy.ts:100-140`（键集合 `mode/maxRetries/retryableCodes/backoff`，backoff 三键 `initialDelayMs/maxDelayMs/jitterRatio` 及取值范围均在此） | 有效 |
| `models[].input` | `[text, image]` | `packages/llm/llm-pi-ai/src/catalog.ts:47-50` `MODALITY_GATE` | 有效 |
| `models[].reasoningEfforts` | `medium/high/xhigh/max` 四档 | `packages/llm/llm-pi-ai/src/catalog.ts:74-82` `THINKING_LEVEL_GATE` | 有效 |
| `models[].contextWindow` | `262000` 等 | `packages/llm/llm-pi-ai/src/config.ts:305`（`z.number().step(1).min(1)`） | 有效 |
| `agent-default-model` | `provider: relaycore`、`model: gpt-5.6-luna`、`reasoningEffort: max` | `packages/core/agent-default-model/src/index.ts:24-31`，三个字段皆为 `Volatile` | 有效 |
| `ui-conversation.busyEnter` | `steer` | `packages/client/ui-conversation/src/submission-settings.ts:12`（`['queue','steer']`） | 有效 |
| `ui-theme.fontSize` | `16` | `packages/client/ui-theme/src/theme-settings.ts:24-30`（范围 12–17，默认 14） | 有效 |
| `ui-onboarding.welcomeNoticeVersion` | `2026-08-13.1` | `packages/client/ui-settings-general/src/index.ts:16`（`Volatile<string \| undefined>`） | 有效，已随 section 改名落到 `ui-settings-general` |

`llm-pi-ai` 的 Config 本体是 `providers: z.dict(profile).default({}).volatile()`（`config.ts:352-354`），即**字典**形态，与本机配置的形状一致。

### 3. 会被明确拒绝的旧字段

`rejectRemovedFields`（`packages/llm/llm-pi-ai/src/config.ts:371`）遇到即抛错并给出替代提示：

- `provider`：已移到 `providers` 字典的键上；
- `maxRetries` / `maxRetryDelayMs`：已移除，改用 `dsh-llm-retry` 组合 agent 恢复。

此外 `providers` 若写成数组会被拒（同文件 414-416 行：「providers is now a dict keyed by provider route, not an array of profiles」）。本机配置没有踩到这三条。

## 四、磁盘核对：配置没有失效

`settings.yaml.imported` 的 5 个 section 与 profile patch 的 5 个 entry 一一对应，内容完整：

| `.imported` 里的 section | patch 里的 entry id | patch 里的 `name` |
|---|---|---|
| `ui-onboarding` | `ui-settings-general` | `@deepseek-ai/dsh-client-ui-settings-general` |
| `ui-conversation` | `ui-conversation` | `@deepseek-ai/dsh-client-ui-conversation` |
| `llm-pi-ai` | `llm-pi-ai` | `@deepseek-ai/dsh-llm-pi-ai` |
| `agent-default-model` | `agent-default-model` | `@deepseek-ai/dsh-agent-default-model` |
| `ui-theme` | `ui-theme` | `@deepseek-ai/dsh-client-ui-theme` |

`llm-pi-ai` 下 `b-ai` 与 `relaycore` 两个 provider 键都在（`.imported` 第 7/48 行 ↔ patch 内层第 5/47 行），`agent-default-model` 的 `provider/model/reasoningEffort` 三值也都在。

**判定「有没有丢配置」的通用方法**：把 `.imported` 的顶层 section 名逐个按第一节的改名规则映射，再去 patch 里找同名 entry。某个 section 只在 `.imported` 里出现，说明它当初被当前组合拒绝（启动日志里有对应 warn），需要按新 entry 名手工补写。

## 五、后续影响与注意事项

1. **设置从此是 per-profile 的**。迁移写进的是「当前活跃 profile」的 patch；以后 `pnpm dsh --profile headless` 或新建 profile 时，那份 patch 是空的，模型接入要重新配，或把这段 YAML 复制过去。这一点与旧机制（home 级文档被所有 profile 共享）是实质差异。
2. **迁移只跑一次**。配置改坏了，回滚办法是手改 patch，不是把 `.imported` 改回去——home 级文件已不存在，`importLegacyDocument` 第 244 行直接 return。
3. **`settings.yaml.imported` 是归档**，不被读取，可以随时删除，删掉不影响运行；留着可以当作旧配置的备份。
4. **本目录其他篇目存在文档漂移**：06、09、13 篇仍把 `$DSH_HOME/settings.yaml` 当作配置入口，其中 06 篇引用的 `packages/settings/settings-file/src/index.ts` 包已经不存在。以本篇为准。

## 六、自查方法

- **看文件**：patch 里有没有对应 entry，字段是否齐全（第四节对照表）。
- **看日志**：成功时有 `settings: imported <path> into profile <name>`；若有 section 被拒，会有 `settings: section %s of %s was not imported into entry %s` 加一条错误详情。
- **看界面**：设置页「模型 / 通用设置」表单应当回显迁移后的值（表单读的就是 patch 覆盖后的 Config）。

---

## 证据文件索引

- `packages/settings/settings/src/index.ts` L200-206 `LEGACY_SECTION_ENTRIES`；L235 构造函数的 `loader.await()` 挂载；L241-258 `importLegacyDocument`（先改名、逐 section、warn 不阻塞、info 收尾）；L292/296 `documentPath`/`prepareDocument`；L347-350 `update` → `write` → `configEditor.edit`
- `packages/boot/config-editor/src/index.ts` L34：`documentPath` = `profileContext.patchPath`
- `packages/boot/app-boot/src/profile-context.ts` L20 与 `profile.ts` L73：`patchPath` 定义
- `packages/boot/app-boot/src/index.ts` L303-312 `loadOptionalPatches`：patch 存在但不可用时 fail loud 的契约
- `packages/boot/app-boot/src/profile-sanitize.ts`：`sanitizeProfile` 的 `.bak-<毫秒>` 备份与「只重写 bundles」语义（当前无 CLI 调用方）
- `packages/llm/llm-pi-ai/src/config.ts` L258-285 `compatProfile`、L326-354 `profile`/`Config`（`providers` 为 dict 且 volatile）、L371-386 `rejectRemovedFields`、L414-416 数组形态拒绝
- `packages/llm/llm/src/retry-policy.ts` L100-140：`RetryPolicySchema` 键集合与 backoff 三键的取值范围
- `packages/llm/llm-pi-ai/src/provider.ts` L48-50 `PROTOCOLS`；`src/catalog.ts` L47-50 `MODALITY_GATE`、L74-82 `THINKING_LEVEL_GATE`
- `packages/core/agent-default-model/src/index.ts` L24-31：`provider`/`model`/`reasoningEffort` 三个 Volatile 字段
- `packages/client/ui-conversation/src/index.ts` L19 与 `src/submission-settings.ts` L12：`busyEnter` 的 `['queue','steer']`
- `packages/client/ui-theme/src/index.ts` L26/32 与 `src/theme-settings.ts` L24-30：`fontSize` 的 Volatile 声明与 12–17 边界
- `packages/client/ui-settings-general/src/index.ts` L16：`welcomeNoticeVersion` 的 Volatile 声明
- `apps/web/tests/settings-import.e2e.ts`：把「导入一次、`settings.yaml` 消失、`.imported` 保留、值到达 profile patch 与页面」钉死的 e2e
- 本机磁盘：`C:\Users\Admin\.dsh\settings.yaml.imported` 与 `C:\Users\Admin\.dsh\profiles\web\cordis.patch.yml` 的逐 section 对照
