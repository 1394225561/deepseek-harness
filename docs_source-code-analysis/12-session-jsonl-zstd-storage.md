# 12 · 会话数据落盘机制：sessions 目录结构与 JSONL.zstd 格式详解

> 06 篇给出了磁盘数据清单式的速览；本篇是对「会话日志」这一项的源码级深挖：目录名怎么来的、文件里到底是什么、怎么写怎么读。

## 总览（一句话结论）

**每个会话的完整对话内容存放在该会话文件夹下唯一的文件 `session.jsonl.zstd` 中——一个 Zstandard 压缩的追加式 JSONL 日志，每行一条 JSON 记录（会话头或会话事件），完整记录用户消息、助手消息、工具调用等全部模型可见交互。** 文件夹名不是哈希，而是 session id（UUID 或 `session-<UUID>`）。默认组合下没有任何数据库参与（见 13 篇）。

```
~/.dsh/sessions/                                          ← 存储根目录 root
└── --Users-root-mac-workspace_github-AIGC-Novels--/      ← 项目目录（按 cwd 编码）
    └── <session-id>/                                     ← 单个会话的专属文件夹
        └── session.jsonl.zstd                            ← 会话日志本体
```

---

## 一、目录的逐层来源

### 1. 根目录 `~/.dsh/sessions`

base bundle 显式装配（`packages/bundle/base/cordis.patch.yml` L98-101）：

```yaml
- id: session-persistence-jsonl
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js dshHomePath('sessions')
```

- `dshHomePath` 按 `$DSH_HOME` 环境变量 → 默认 `~/.dsh` 解析主目录（`packages/util/home-paths/src/index.ts` L87-100）。
- `root` 配置**必填且无代码默认值**（jsonl 后端 `index.ts` L62-68/L127）：刻意避免以 `process.cwd()` 为默认导致日志散落到进程工作目录。
- 改路径：设 `$DSH_HOME`，或在补丁层覆盖 `session-persistence-jsonl.config.root`。

### 2. 项目目录名 `--<slug>--` 的编码规则

由 `projectKey()` 生成（`packages/session/session-persistence-jsonl/src/format.ts` L147-167）：

- cwd 中的 `/`、`\`、`:` 统一替换为 `-`（连续分隔符合并为一个 `-`）；
- 安全字符集 `[A-Za-z0-9._-]` 保持字面，其余码元转义为 `~XXXX`（十六进制大写）；
- 开头的连续 `-` 剥掉（所以 `/Users/...` 的首个 `/` 不留痕），全剥空则回落 `root`；
- 结果截断到 251 字符后用 `--…--` 包裹。

因此 `/Users/root-mac/workspace_github/AIGC/Novels` → `--Users-root-mac-workspace_github-AIGC-Novels--`。**编码是有意有损的**（人类可读导航优先）：归一化后相同的 cwd 共享同一项目目录，靠 session id 区分会话。无 cwd 的会话落在 `_no-cwd/` 下（`projectDir`，L176-179）。

身份校验兜底：大小写不敏感文件系统上，只有当文件系统规范化把两种拼写解析到同一份 transcript 时才接受替代拼写。

### 3. 会话文件夹名 = session id（两类形态）

id 是未校验的品牌字符串，写入路径前必须经 `encodeSegment()` 注入式转义（防 `../`、绝对路径、NUL 等；安全码元字面保留、其余 `~XXXX`；`.`/`..` 整段特判），见 `format.ts` L121-136。

实际观察到 id 有两种生成来源：

| 形态 | 生成位置 | 含义 |
|---|---|---|
| `session-<uuid>` | `packages/core/agent-loop/src/index.ts` L358：`SessionId(\`${id}-session-${randomUUID()}\`)` | 顶层 CLI 会话 |
| 裸 UUID | 各子代理 provider 直接取 `SessionId(randomUUID())`（如 `packages/subagent/subagent-acp/src/run.ts` L204、`subagent-codex/src/run.ts` L432） | 子代理委派会话 |

另有一个内存态兜底：`ctx.sessions.prepare()` 不传 id 时用计数器生成 `session-1`、`session-2`…（`packages/core/session/src/index.ts` L866）。

实测某项目目录下 185 个文件夹 = 3 个 `session-*`（顶层）+ 182 个裸 UUID（子代理）。跑多代理任务时每次委派都会产生独立的子代理会话日志。

---

## 二、`session.jsonl.zstd` 的逻辑形式

### 1. 第 1 行：不可变会话头（`HeaderLine`）

结构定义在 `format.ts` L33-44：

```json
{"type":"session","version":0,"id":"001d1cdb-e6d7-40d5-b427-d9c1fb5fd5d3",
 "createdAt":1787715304989,"cwd":"/Users/root-mac/workspace_github/AIGC/Novels",
 "parentSession":"session-36300dca-...","origin":"subagent","delegationDepth":1,
 "agentPreset":"standard"}
```

- `type: 'session'` 标签把它与后续事件行区分开；
- `version` 即 `SESSION_FORMAT_VERSION`（当前 v0，预发布阶段无迁移承诺）；读取端遇到未知版本在**做任何结构校验之前**就报「升级 harness」而非「日志损坏」（`refuseForeignFormatVersion`，L240-247）；
- `delegationDepth` 落盘必填（顶层为 `0`），缺失或非法直接拒绝加载；
- `agentPreset` 必须持久化：它决定恢复会话后的工具与提示词组成，换组合重放会让模型面对无法执行的历史；
- 头里出现已退役字段（`sandboxMode`/`approvalPolicy` 基线）会显式报错。

### 2. 之后每行：一条 `SessionEvent`

统一 `{type, seq, time, data}` 结构。真实文件（124 行逻辑记录）的事件类型分布：

| 数量 | 类型 | 内容 |
|---|---|---|
| 49 | `assistant/chunk` | 助手输出流式增量 |
| 11 / 10 / 3 | `tool-call-chunks` / `reasoning-chunks` / `text-chunks` | 打包行（见下） |
| 10 | `llm/retry` + `llm/retry-started` | LLM 重试记录 |
| 4 | `user/message` | 用户输入原文 |
| 4 + 4 | `tool/call` + `tool/result` | 工具调用与结果 |
| 2 | `assistant/message` | 助手最终消息 |
| 2 | `agent/inbox/spliced` | 注入的代理收件箱内容 |
| 各 1 | `turn/start`、`turn/end`、`step/start`、`step/end`、`request/header`、`request/context`、`sandbox/mode`、`approval/policy`、`subagent/descriptor`、`session/title`、`session`（头行） | 生命周期与元数据 |

### 3. 打包行（packChunks，默认开启）

≥3 个连续同类 delta 事件压成一行存储行，标签为**无斜杠的裸 tag**：`text-chunks` / `reasoning-chunks` / `tool-call-chunks`（避免与事件类型混淆）；行内 `seq0`/`time0` 加每个成员的 `dt` 差值可精确还原每个成员的 `seq`/`time` —— 无损。

- 编解码器 `packChunkRuns` / `decodeStorageRecord` 在 `@deepseek-ai/dsh-session`；白名单精确形状，识别不了的记录原样按事件存储；
- 读侧布局无关：`load` 总是解码打包行，打包/不打包/混合文件加载结果一致；
- 写侧开关只影响新写入字节；实测约省 60% 逻辑体积。

### 4. seq 连续性不变量

解码后整个日志严格满足 `events[i].seq === i`（`format.ts` L364-376 的扫描器逐行校验）。这是加载时的完整性依据；提交区出现 seq 断档即判损坏。`assistant/chunk` 事件永不丢弃。

---

## 三、物理编码：Zstandard 多帧拼接

默认产物（`compression: 'zstd'`）是**标准 Zstandard 帧的顺序拼接**，不是单一压缩流：

- 第 1 帧：仅含头行的校验帧；之后每次持久化追加批次一个独立校验帧；
- 用 Node 内置 Zstandard API 的默认压缩级别，无级别旋钮；
- 因此它是合法 `.zst` 文件，系统 `zstd -d` 可直接解开查看；
- `compression: 'none'` 保留同样的逻辑行为纯 UTF-8 文本（文件名 `session.jsonl`）；
- **一个 root 只属于一种编码**：启动发现/定向查找遇到相反后缀即报错并提示选匹配模式或换 root；旧的平铺 `<project>/<id>.jsonl*` 布局同样被拒绝而非忽略。无迁移、无混合 root 回退、无双写。

---

## 四、写入路径与崩溃语义

实现主体在 `packages/session/session-persistence-jsonl/src/index.ts`（协调器在 `packages/session/session-persistence/`）：

- **懒物化**：`create(meta)` 不写任何东西；第一次 `append` 才落盘。POSIX 流程：临时文件内写头帧+首批并 `fsync` → `link()` 不覆盖发布 → `fsync` 父目录；Windows 走 `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)`。建了但从没追加过的会话磁盘上不留痕迹、也不出现在 `list` 里。
- **批量窗口**：每会话一个写控制器；第一个待写事件启动固定 200ms 合并窗口（`writeBatchMaxDelayMs`，后续事件加入不重置），到期触发一次持久追加；写期间进来的事件形成下一批。`session/flush` 取消等待并排空。批量只是让一帧/一次 fsync 携带更多记录，逻辑事件一条不少。
- **append-only**：已 flush 的字节永不重写；写或 sync 失败会把文件回滚到之前的字节长度。
- **崩溃恢复（保住有效尾部）**：`load` 校验每个完整帧并扫描其解压 JSONL。最后一帧结构性不完整时，保留其中完整记录、从该帧起点截断、并用共享持久化契约要求的合成闭合事件重新编码（raw 模式从第一条不完整行截断）。若无完整头帧、完整帧校验失败、或缺陷位于最后已提交 `turn/end` 之前，判为损坏并拒绝。
- **单写者约束**：追加与修复只在持有该会话的后端实例内协调；其他实例/进程须等其静默销毁后才能写同一会话。初始同 id 发布通过 POSIX 不覆盖硬链接（或 Windows 直写改名）保证碰撞安全。

## 五、读取路径

- **列表只读头帧**：`parseHeaderMeta`（`format.ts` L404-413）只解析第一行，会话选择器的开销随会话数而非全部日志总量增长。
- **恢复/重建**：resume 从日志还原表面历史并保留先前请求头供重构；新循环组自己的信封。崩溃修复对「请求了但没持久调用」的助手请求合成 `TOOL_NOT_STARTED`；「持久调用缺结果」合成 `TOOL_OUTCOME_UNKNOWN`（提示模型只重试只读/幂等操作并核实副作用）。恢复后的 KV 缓存复用要求历史、信封、模型路由都匹配。
- **非变更检查**：`inspect()` 返回不可变的平衡逻辑视图，可在内存中合成恢复闭合事件，不截断撕裂尾巴。

## 六、权威数据 vs 派生数据

- **权威**：`session.jsonl.zstd` 本身。「模型可见 ⟺ 已记日志」——一切能到达模型请求的内容都可从这份日志重构。
- **派生**：`~/.dsh/storages/session_projcache.json` 是投影缓存（`session-projection-cache`，web-app profile 下按 200 事件/5 秒节流落盘），存的是从日志算出的统计检查点（如 `sessionStats`）；删了可重建，不是对话内容本身。

## 七、运维含义

- 查看某个会话聊了什么：`zstd -dc <session-dir>/session.jsonl.zstd | less`，无需任何 dsh 工具。
- 该 seam **没有删除 API**（README 明示 "Nothing deletes session files"），日志累积直到手动清理。
- 删除某个 UUID 文件夹 = 删除那个（多为子代理的）会话历史；顶层会话是 `session-<uuid>` 开头的文件夹。
- 想要外部行读取器可直接 grep 的日志：换新 root 并配 `compression: 'none'`。

---

## 证据文件索引

- `packages/bundle/base/cordis.patch.yml` L98-101：jsonl 后端装配 + `root: !!js dshHomePath('sessions')`；L117-122：session-query-sqlite 关闭态
- `packages/util/home-paths/src/index.ts`：`resolveDshHome` L87-91 / `dshHomePath` L98-100
- `packages/session/session-persistence-jsonl/src/format.ts`：
  - `HeaderLine` L33-44 / `refuseForeignFormatVersion` L240-247
  - `encodeSegment` L121-136 / `projectKey` L147-167 / `projectDir` L176 / `sessionDir` L189 / `logPath` L201
  - `eventLines`（打包开关）L221-224 / seq 连续性校验 L364-376 / `parseHeaderMeta` L404-413
- `packages/session/session-persistence-jsonl/src/index.ts`：root 必填 L62-68 / `materializePosix` L529-569 / `appendLines` L651-679
- `packages/session/session-persistence-jsonl/src/zstd*.ts`：Node 内置 Zstandard 多帧编解码
- `packages/core/agent-loop/src/index.ts` L358：顶层会话 id 生成
- `packages/core/session/src/index.ts` L855-880：`prepare` 计数器兜底 id
- `packages/subagent/subagent-acp/src/run.ts` L204、`packages/subagent/subagent-codex/src/run.ts` L432：子代理裸 UUID id
- `@deepseek-ai/dsh-session`：`packChunkRuns` / `decodeStorageRecord` / `SESSION_FORMAT_VERSION`
- 包 README：`packages/session/session-persistence-jsonl/README.md`（布局、物理编码、崩溃语义、限制清单）
