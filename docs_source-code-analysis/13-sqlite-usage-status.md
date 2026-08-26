# 13 · SQLite 使用现状：内置机制齐全，默认组合下不承担任何存储

## 总览（一句话结论）

**dsh 内置了完整的 SQLite 机制（三个能力包），但在源码运行的默认组合下，SQLite 实际不承担任何数据存储——所有持久化数据都是平面文件**：会话日志在 `session.jsonl.zstd`（12 篇）、应用级 KV 在 `~/.dsh/storages/*.json`。磁盘上不存在任何数据库文件。

## 一、驱动与依赖形态

- 用的是 **Node.js 内置 `node:sqlite` 模块**（`DatabaseSync` / `StatementSync`），全仓库无 better-sqlite3 等外部原生 SQLite 依赖。
- 运行时真正 `import 'node:sqlite'` 的只有三个包（全仓库扫描确认）：

| 包 | 用途 | 默认组合下的状态 |
|---|---|---|
| `packages/session/session-persistence-sqlite` | 会话日志的 **SQLite 替代持久化后端** | **未挂载** |
| `packages/session-query/session-query-sqlite` | 会话**全文搜索索引**（FTS5） | 已挂载但**形同关闭** |
| `packages/storage/storage-sqlite` | 通用存储 seam 的 SQLite 后端（注册名 `sqlite`） | **无任何消费者挂载** |

## 二、逐包现状

### 1. `session-persistence-sqlite` — 可选的会话持久化后端

- 与 jsonl 后端并列、注册在同一个 `ctx.sessionPersistence` seam 上的具体后端；README 自述 "Opt-in SQLite backend with packed physical chunk rows"（打包物理 chunk 行）。
- 采用单调递增 `SCHEMA_VERSION`，预发布阶段无兼容承诺（根 AGENTS.md）。
- base bundle 未挂载它；它只出现在 `llm-retry`、`session-title` 的 **devDependencies** 里（供测试用），不是运行时依赖。

### 2. `session-query-sqlite` — FTS5 全文搜索，默认显式禁用

base bundle 装配（`packages/bundle/base/cordis.patch.yml` L117-122）：

```yaml
- id: session-query-sqlite
  name: '@deepseek-ai/dsh-session-query-sqlite'
  config:
    path: ':memory:'
    openAt: never
```

按其 README 契约，`openAt: never` 的语义是：

- **`node:sqlite` 根本不会被 import，句柄不会打开**，也不做任何源日志观察/对账；
- `searchSessions` / `searchEvents` 在请求规范化之前直接失败，错误码 `SESSION_QUERY_SEARCH_DISABLED`；
- 继承自 Service Definition 的精确读取、过滤器、lineage 追踪照常可用——它们不需要数据库；
- `tool-session-query` 对该包也只是 devDependency（测试用）。

三种开启档位的差别（配置项 `openAt`）：

| 值 | 行为 |
|---|---|
| `startup`（该包自身默认） | 服务激活即 import 模块并打开句柄；索引无效则在发布前失败 |
| `first-search` | 服务照常 ACTIVE 发布但不开库；首次搜索时才延迟打开（为了规避 Node 22 上 `node:sqlite` 的实验性警告污染启动输出） |
| `never`（base bundle 所选） | 全文搜索关闭，如上 |

索引性质要点：持久化 FTS 行存放在一个**专用派生数据库**里，连接内 TEMP 表承载活会话行的覆盖层；数据库整体是 disposable（可丢弃）的派生索引——权威数据始终是会话日志本身，删掉索引只会触发下次搜索重建。文档同时明确警告：不要把 `path` 指向 session-persistence 的数据库。

### 3. `storage-sqlite` — 有能力、无默认消费者

- `storage/` 家族（非会话数据的应用级存储）提供 `json` 和 `sqlite` 两个可注册后端，消费方通过数据形态（data form）而非后端直接访问。
- 当前唯一落地的组合是 web-app profile 选了 **json 后端**（`packages/bundle/web-app/cordis.patch.yml` L54-57：`storage-json` + `root: !!js dshHomePath('storages')`），对应磁盘上的 `workspace.json`、`message_feedback.json`、`session_projcache.json`。
- `storage-sqlite` 无任何部署组合挂载；仓库内引用只有它自己的源码。

## 三、为什么本机看不到 .db 文件（默认组合验证清单）

| 数据类别 | 实际去向 | SQLite 参与？ |
|---|---|---|
| 会话日志（对话内容） | `~/.dsh/sessions/<projectKey>/<id>/session.jsonl.zstd` | 否——jsonl 后端 |
| 应用级 KV（投影缓存等） | `~/.dsh/storages/*.json` | 否——json 后端 |
| 会话全文搜索 | 关闭（`SESSION_QUERY_SEARCH_DISABLED`） | 否——连模块都不加载 |
| 设置 / 凭据 / 身份 / 附件 | `settings.yaml` / `.credentials.yaml` / `.anonymous-user-id` / `attachments/v1/` | 否——平面文件 |

headless profile 补丁层也没有任何 sqlite/storage 相关条目。

## 四、何时会出现 SQLite 文件

两条主动开启路径：

1. **开启会话全文搜索**：补丁层覆盖 `session-query-sqlite` 配置为真实文件路径 + `openAt: 'startup'` 或 `'first-search'`。将产生派生索引 `<path>` 及 WAL sidecar（`journalMode` 默认 `wal`，即 `*.db-wal`/`*.db-shm`）；POSIX 上新建目录/文件为 owner-only（0700/0600）。它是派生缓存，删除安全。
2. **切换会话持久化后端**：把组合里的 `session-persistence-jsonl` 换成 `session-persistence-sqlite` 并给文件路径，对话才进 SQLite（预发布阶段无格式迁移承诺）。

## 五、设计定位小结

SQLite 在 dsh 中一律扮演「**可选后端或派生索引**」角色，从不是权威数据层：

- 权威层 = append-only 会话日志 + 平面 JSON 文件；
- SQLite 出现的地方要么是同一 seam 的另一个可选实现（persistence、storage），要么是从权威数据可再生成的查询加速结构（FTS5 索引）；
- 因此「换掉/删掉 SQLite」永远不影响数据正确性，只影响能力开关或查询性能。

---

## 证据文件索引

- `grep -rln "from 'node:sqlite'" packages/*/src` → 仅 `session-persistence-sqlite`、`session-query-sqlite`、`storage-sqlite` 三包
- `packages/bundle/base/cordis.patch.yml` L117-122：session-query-sqlite `:memory:` + `openAt: never`
- `packages/bundle/web-app/cordis.patch.yml` L51-62：storage + storage-json（json 后端选型）
- `packages/session/session-persistence-sqlite/`（src/schema.ts 等）：SCHEMA_VERSION、packed chunk rows
- `packages/session-query/session-query-sqlite/README.md`：openAt 三档语义、SESSION_QUERY_SEARCH_DISABLED、派生索引/disposable 性质、WAL、owner-only 权限
- `packages/storage/README.md`：storage 家族 json/sqlite 双后端定位
- 各 package.json：`llm-retry`、`session-title`、`tool-session-query` 对 sqlite 包均为 devDependencies
