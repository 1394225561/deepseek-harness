# 07 · pnpm 缺失定位、corepack 安装机制与本机残留清理

## 背景

2026-08-25 在本仓库执行 `pnpm install` 报 `zsh: command not found: pnpm`，当时终端已用 nvm 切到 node v24.19.0。本文记录只读排查的结论与证据、corepack 方案的完整知识点、以及旧 pnpm 残留的清单与清理依据。排查环境：macOS（Darwin 25.6.0）+ zsh，nvm 已装 v12.22.12 / v20.19.4 / v24.19.0 三个版本。

## 一、排查结论：全机不存在任何可用 pnpm 安装

逐项检查结果：

| 检查项 | 结果 |
|---|---|
| 各 nvm 版本 `~/.nvm/versions/node/*/bin/pnpm` | 均无 → 从未通过 `npm i -g pnpm` 装进现存版本 |
| Homebrew `/opt/homebrew/bin`、`/usr/local/bin` | 无 |
| `~/.local/bin`（该目录在 PATH 中，`.zshrc` L46 加入） | 无 |
| corepack 启用痕迹（node bin 下的 pnpm 软链） | 无 —— v24.19.0 自带 corepack，但从未执行过 `corepack enable` |
| `.zshrc` / `.zprofile` / `.zshenv` | 无任何 `PNPM_HOME` 或 pnpm 相关 PATH 行（仅 `.zshrc` 有 nvm 三行加载配置） |
| `~/Library/pnpm/` | 仅剩 `store/` 子目录（2023-09-08 创建），无 pnpm 二进制 |

「记得装过」属实，但可执行本体已消失，现存痕迹只是当年工作时的缓存数据。最可能的来源：pnpm 曾装在后来被 `nvm uninstall` 掉的 Node 版本下（卸载版本会连带删除该版本 bin 内的全局包），或独立脚本安装后被清理。

关键判定：**与本次 nvm 切换版本无关** —— 不是「切换导致 pnpm 消失」，而是所有现存版本下本来就没有；切回 v20 也一样找不到。

## 二、nvm 与全局包的隔离机制

- 每个 node 版本拥有独立的 `bin/` 和全局 `lib/node_modules`；`npm i -g <pkg>` 安装到**当时激活版本**的 bin 下。
- nvm 切换的本质是把目标版本的 bin 前插到 PATH；因此装在 A 版本下的全局包在 B 版本下不可见。
- 这是 nvm 用户「换个 node 版本命令就没了」的一般原因；本机案例是其极端情形（所有版本都没有）。

## 三、corepack 方案的完整机制

### `corepack enable pnpm` 这条命令本身做什么

只在**当前激活 node 版本**的 `bin/` 下创建 `pnpm`、`pnpx` 两个软链，指向同目录的 corepack 入口（如 `../lib/node_modules/corepack/dist/`）。执行时刻**不下载任何东西**；真正的下载发生在之后第一次运行 `pnpm` 时。

### 运行时调用链

```text
pnpm（软链）
  → corepack
    → 从 cwd 逐级向上找最近的 package.json 的 "packageManager" 字段
      → 有字段：下载（仅首次）并运行钉住的确切版本
      → 无字段：使用 corepack 内置的默认版本
```

核心价值：每个项目自动使用其 `packageManager` 钉住的确切包管理器版本，团队/多仓库间版本一致。

### 两层存放位置（macOS）

| 层 | 位置 | 特点 |
|---|---|---|
| 入口软链 | `~/.nvm/versions/node/<当时激活版本>/bin/pnpm` | 跟随单个 node 版本，nvm 各版本 bin 相互独立 |
| pnpm 实体缓存 | `~/Library/Caches/node/corepack/v1/pnpm/<version>/` | 所有 node 版本共享同一份，按 pnpm 版本号分目录 |

### 切换 node 版本后的后果

- 切到 v20.19.4：该版本 bin 下没有软链 → 再次 `command not found`；需要在该版本下重新执行 `corepack enable pnpm`（v20 也自带 corepack）。对本仓库无实际影响，见第四节。
- 切到 v12.22.12：该版本太老，**不内置 corepack**（Node 16.9 才开始捆绑），此方案不可用。
- 重要澄清：只要软链存在，pnpm 的具体版本由项目的 `packageManager` 字段决定、**与 node 版本无关**——切换 node 版本不会造成 pnpm 版本漂移，只会出现「软链缺失」这一种问题形态。
- 前瞻：Node 官方已决定自 **Node 25 起**不再随发行版捆绑 corepack；届时升级到更新的 Node 需要 `npm i -g corepack` 单独安装，或改用其他 pnpm 安装方式。

## 四、本仓库的相关约束（package.json）

- L7 `"packageManager": "pnpm@11.7.0"` —— corepack 方案的版本来源，`corepack enable pnpm` 后在本仓库内运行即自动使用 11.7.0。
- L8-10 `"engines": { "node": "^22.19.0 || >=24.0.0" }` —— v24.19.0 满足要求；v20.19.4 / v12.22.12 不满足（v20 即使补装了 pnpm 也不达标）。

## 五、旧 pnpm 残留清单与清理依据

2026-08-25 盘点，共约 410 MB：

| 路径 | 大小 | 内容 |
|---|---|---|
| `~/Library/pnpm/` | 409 MB | `store/v3` —— 包内容的寻址存储（大头） |
| `~/Library/Caches/pnpm/` | 1.5 MB | 元数据/下载缓存 |
| `~/.pnpm-state` | 4 KB | 安装器的状态标记文件 |

已确认**不存在**的相关路径，无需处理：`~/.config/pnpm`、`~/.local/share/pnpm`、`~/Library/Preferences/pnpm`、`~/Library/Logs/pnpm`、`~/.pnpm-debug.log`。

删除安全性依据：

1. 全机无任何 pnpm 可执行文件，没有程序会再读写这些目录；
2. 三处均为纯缓存，删除的唯一损失是「若将来重装 pnpm，包需要重新下载」；
3. pnpm 对项目内文件采用**硬链接**：即使某个 2023 年的老项目还保留着当年 pnpm 安装的 `node_modules`，删除全局 store 一侧不影响另一侧继续持有的 inode，老项目的依赖不会被破坏；
4. shell 配置文件中没有任何指向这些路径的引用。

清理命令：`rm -rf ~/Library/pnpm ~/.pnpm-state ~/Library/Caches/pnpm`

易混淆项提醒：`~/Library/Caches/node/corepack/` 是第三节 corepack 方案的实体缓存目录（执行 enable 并首次运行 pnpm 后才会出现），属于**要保留的新体系**，不要顺手删除。

## 六、两种修复方案对比

| 方案 | 命令 | pnpm 版本 | 评价 |
|---|---|---|---|
| corepack（推荐） | `corepack enable pnpm` | 自动跟随各仓库 `packageManager` 字段（本仓库为 11.7.0） | 版本按项目钉死，与仓库声明一致；代价是软链按 node 版本各自维护 |
| npm 全局安装 | `npm i -g pnpm` | 安装时刻的最新版，可能与 `packageManager` 钉住的版本不一致 | 直接简单，但绕过版本钉，跨仓库易错版 |

---

## 证据记录（2026-08-25 只读排查）

- `ls -1 ~/.nvm/versions/node` → `v12.22.12`、`v20.19.4`、`v24.19.0`。
- `ls -l ~/.nvm/versions/node/*/bin/pnpm` → no matches found。
- `ls -l /opt/homebrew/bin/pnpm /usr/local/bin/pnpm` → 均不存在。
- v24.19.0 的 bin 内容中存在 `corepack -> ../lib/node_modules/corepack/dist/corepack.js`（2026-08-03 创建，随 Node 分发），旁边无 pnpm 软链。
- `ls -la ~/Library/pnpm/` → 仅 `store/` 子目录，目录时间戳 2023-09-08。
- `grep -nE 'PNPM_HOME|pnpm|corepack|nvm' ~/.zshrc ~/.zprofile ~/.zshenv` → 仅 `.zshrc` L9-11 的 nvm 加载三行；`.zshrc` 全文复核无 pnpm 相关行。
- `Read ~/.local/bin/pnpm`、`~/front_end_tools/vue_cli/MyVueCli.sh`（被 `.zshrc` source）→ 前者不存在，后者仅 vue alias。
- `du -sh` → `~/Library/pnpm` 409M、`~/Library/Caches/pnpm` 1.5M、`~/.pnpm-state` 4.0K；store 内为 `v3`。
- 本仓库 `package.json` → L7 `packageManager`、L8-10 `engines`。
