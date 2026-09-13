---
description: "按照调用 Session 的文件策略创建并进入保留的 Git 工作树。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-worktree

[English](README.md) | 中文

## 概述

从本地提交创建隔离的检出目录，并在其中继续同一个 Session。每次操作创建新的具名分支，源检出目录保持不变。所有写入均受现有沙箱约束。离开检出目录会保留文件与分支。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将服务与 `workingDirectory`、`fs`、`subprocess`、`sandbox` 和 `sandboxPolicy` 提供方一起挂载。模型需要此操作时，再添加工具包。

```yaml
- name: '@deepseek-ai/dsh-experimental-worktree'
- name: '@deepseek-ai/dsh-experimental-tool-worktree'
```

`ctx.worktrees.create(agent, { name?, from? }, signal?)` 创建新分支与检出目录，再通过 `ctx.workingDirectory.set` 进入规范化的检出目录。`from` 在创建前解析为本地提交，默认是 `HEAD`；暂存、未暂存、未跟踪以及被忽略的源文件均不复制。分支或检出路径已存在时会报错。返回记录包含 `path`、`branch`、`baseCommit` 和 `repositoryRoot`。

默认检出目录是 `<repository root>/.agents/worktrees/<name>`。省略名称时，使用 `worktree-` 加 UUID。新创建的工作树父目录会得到内容为 `*` 加换行符的 `.gitignore`；已有目录与忽略文件保持原有内容。相对路径 `directory`、生成名称使用的 `namePrefix`、可执行程序与进程限制可在[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-worktree)中查阅。

### 从源码检出目录尝试

[源码叠加配置](../../../apps/cli/config/examples/worktree/cordis.yml)将两个实验插件加入 headless profile，不改变其权限策略。在已安装依赖的仓库根目录中查看最终组合：

```sh
pnpm dsh --profile headless --patch apps/cli/config/examples/worktree/cordis.yml --dump-config
```

输出包含 `experimental-worktree` 与 `experimental-tool-worktree` 配置项。运行模型任务时，用任务文本替换 `--dump-config`；profile 需要正常的提供方凭据。可要求模型从本地版本创建新工作树。现有写权限必须覆盖目标目录与共享 Git 管理目录。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

Git 与目录分配通过挂载的子进程及沙箱提供方执行，沿用调用 Session 的文件策略。创建操作不会扩大目标目录或共享 Git 管理目录的写权限。目录创建独占申请目标路径；取消或初始化失败可能留下已有产物，错误会包含其路径。服务销毁会中止待完成操作，并等待它们结束。

| 源码 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 解析源提交、创建检出目录并发布新的工作目录 |
| [`src/process.ts`](src/process.ts) | 约束字面参数、限制输出并等待进程终止 |
| [`src/directory.ts`](src/directory.ts) | 申请目标目录并初始化新建工作树父目录的忽略文件 |

本包不发布运行时不变量伴随入口：Git 拥有工作树注册信息，工作目录服务拥有 Session 目录；本包不保留二者的独立投影。

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [工作树子系统](../../../docs/subsystems/worktrees.zh.md)——请求、结果与服务参考。
- [工作目录](../../session/working-directory/README.zh.md) — 记录的 Session 目录与目录切换。
- [工作树工具](../tool-worktree/README.zh.md) — 面向模型的创建操作。
- [子进程](../../subprocess/subprocess/README.zh.md) — 进程所有权与执行环境。
- [创建决策](../../../.agents/notes/implemented/feature/2026-09-13-explicit-worktree-creation.zh.md) — 保留检出目录与既有写权限。

-----

<a id="model-experience"></a>
## 模型体验

通过工作树工具的创建结果与工作目录服务记录的 Session 上下文间接影响模型。

#### KV Cache 影响

本包不贡献提示文本。其消费方负责追加工具结果与记录的目录上下文。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- **保留产物**——离开工作树会保留其分支和文件。初始化失败也可能留下部分产物；移除、清理注册信息与删除分支由用户或其他消费方负责。
- **仅限本地提交**——创建操作不会获取远端提交或部分克隆中缺失的对象、初始化子模块、安装依赖或复制未提交文件。本地对象缺失时，创建失败。
- **执行要求**——子进程提供方必须在与文件系统提供方相同的执行环境中提供 Git 2.45 或更新版本以及 Node。Git 必须支持 `--no-lazy-fetch`；不支持的可执行程序会在分配目录前报错。现有沙箱必须允许写入检出目录与共享 Git 元数据。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
