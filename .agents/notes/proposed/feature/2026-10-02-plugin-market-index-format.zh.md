# Agent Note: 插件市场索引格式

Status: proposed

[English](2026-10-02-plugin-market-index-format.md) | 中文

## 问题

DSH 只能从用户已知的 spec 安装第三方组合包（bundle）：npm 包名、Git URL、tarball 或本地路径。用户无法浏览可安装的组合包。目前没有官方市场，以后可能会增加官方市场，因此市场机制必须支持第三方发布的索引。

最小的索引是一份 npm 包名或 Git 仓库 URL 列表，每行一项。它能标识每个插件，但客户端渲染列表前必须为每个包获取 manifest（元数据清单）、语言文件和图标。列表页面每行发出一个或多个请求时，加载慢、可能部分失败，并且每个客户端都要实现元数据解析。

因此，索引必须包含列表页面显示的全部内容：本地化标题和描述、图标、作者、可用版本、兼容性和发布时间。市场还需要发布自己的数据，例如分类、标签、下载量和评分，而 DSH 不需要理解这些值的含义。

## 提案

将**索引**与**索引生成器**分开。DSH 定义并读取一种 JSON 索引格式。索引如何生成、基于哪份源列表生成，由生成器负责。DSH 的读取器、Discover 页面和参考生成器是使用此格式的独立变更。索引列出[profile 插件组合包](../../implemented/architecture/2026-08-05-profile-plugin-bundles.zh.md)，并通过[引导式插件安装](../../implemented/architecture/2026-09-15-guided-plugin-installation.zh.md)安装它们。

包作者使用 [npm 声明](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)。索引缓存选取的包元数据，并增加本地化显示数据、固定的来源和市场元数据。读取方和生成器使用持续维护的 npm 解析器和归一化工具。它们不引入另一份由作者独立维护的包身份、兼容性声明或作者字段。

### 示例

```json
{
  "format": 1,
  "title": { "en": "Example Market", "zh": "示例市场" },
  "description": { "en": "Community DSH bundles", "zh": "社区 DSH bundle" },
  "metadata": {
    "categories": {
      "productivity": { "title": { "en": "Productivity", "zh": "效率" } }
    },
    "labels": {
      "official": { "title": { "en": "Official", "zh": "官方" } }
    },
    "sortKeys": {
      "downloads": { "title": { "en": "Downloads", "zh": "下载量" }, "order": "desc" },
      "rating": { "title": { "en": "Rating", "zh": "评分" }, "order": "desc" }
    }
  },
  "plugins": [
    {
      "name": "@example/dsh-auto-review",
      "title": { "en": "Auto Review", "zh": "自动审查" },
      "description": { "en": "Per-tool LLM authorization review", "zh": "逐工具 LLM 授权审查" },
      "icon": "icons/auto-review.svg",
      "author": "Example Labs",
      "homepage": "https://example.com/dsh-auto-review",
      "metadata": {
        "category": "productivity",
        "labels": ["official"],
        "sortKeys": { "downloads": 12034, "rating": 4.6 }
      },
      "dist-tags": { "latest": "0.2.0-rc.1", "next": "0.2.0-rc.2" },
      "versions": [
        {
          "version": "0.2.0-rc.2",
          "publishTimestamp": 1790476800,
          "source": { "type": "npm" },
          "engines": { "dsh": "0.2.0-rc.2" },
          "peerDependencies": { "@deepseek-ai/dsh-tools": "0.2.0-rc.2" }
        },
        {
          "version": "0.2.0-rc.1",
          "publishTimestamp": 1789872000,
          "source": { "type": "npm" },
          "engines": { "dsh": "0.2.0-rc.1" },
          "peerDependencies": { "@deepseek-ai/dsh-tools": "0.2.0-rc.1" }
        }
      ]
    },
    {
      "name": "dsh-plugin-foo",
      "title": "Foo",
      "icon": "https://example.com/foo.png",
      "dist-tags": { "latest": "1.0.0" },
      "versions": [
        {
          "version": "1.0.0",
          "publishTimestamp": 1788000000,
          "source": {
            "type": "git",
            "url": "https://github.com/author/dsh-plugins",
            "commit": "3f9c2e1d8a4b6c0e7f1a2b3c4d5e6f708192a3b4",
            "path": "packages/foo"
          }
        }
      ]
    }
  ]
}
```

下文中的 `LocalizedText` 即 [`dsh-package-manifest`](../../../../packages/util/package-manifest/src/types.ts) 中的 `LocalizedText` 类型，即字符串或包含 `en` 的字符串对象，并附加两条规则：对象的键是匹配 `^[a-z]{2,8}(-[a-z0-9]{1,8})*$` 的小写语言 id，每个字符串至少包含一个非空白字符。

### 根字段

| 字段 | 必填 | 规则 |
|---|---|---|
| `format` | 是 | 整数 `1`。 |
| `title` | 是 | 市场名称，类型为 `LocalizedText`。 |
| `description` | 否 | `LocalizedText`。 |
| `metadata` | 否 | 包含下列三个声明映射的对象。 |
| `metadata.categories` | 否 | 对象，将分类 id 映射为 `{ title: LocalizedText }`。 |
| `metadata.labels` | 否 | 对象，将标签 id 映射为 `{ title: LocalizedText }`。 |
| `metadata.sortKeys` | 否 | 对象，将排序键 id 映射为 `{ title: LocalizedText, order: "asc" \| "desc" }`；`order` 是初始排序方向。 |
| `plugins` | 是 | 插件数组，可以为空；数组顺序即索引的默认排序。 |

分类、标签和排序键的 id 均为非空字符串。读取器按自有属性查找 id，因此 `constructor` 等 id 没有特殊含义。

### 插件字段

| 字段 | 必填 | 规则 |
|---|---|---|
| `name` | 是 | npm 持续维护的包名校验器接受的新包名称；在索引内唯一。 |
| `title` | 否 | `LocalizedText`；缺省时读取器显示 `name`。 |
| `description` | 否 | 用于市场列表显示的 `LocalizedText`，由语言元数据和 npm 描述派生。 |
| `icon` | 否 | 以下两种形式之一：`data:<type>;base64,<payload>`，其中 `<type>` 为 `image/svg+xml`、`image/png`、`image/jpeg` 或 `image/webp`，`<payload>` 是按规范填充的 base64，解码后的载荷不超过 256 KiB；或者 URL 引用，它相对于索引 URL 解析的结果是 `https:` URL，或与索引 URL 同源。 |
| `author` | 否 | 从 npm 作者声明投影得到的显示名称，至少包含一个非空白字符；见生成器义务。 |
| `homepage` | 否 | 介绍该插件的页面的绝对 `https:` 或 `http:` URL。 |
| `metadata` | 否 | 包含下列三个值的对象。 |
| `metadata.category` | 否 | 一个已声明的分类 id。 |
| `metadata.labels` | 否 | 由互不相同的已声明标签 id 组成的数组。 |
| `metadata.sortKeys` | 否 | 对象，将已声明的排序键 id 映射为有限数值。 |
| `dist-tags` | 否 | 对象，将 npm 分发标签名映射为 `versions` 中列出的精确版本字符串。缺省表示没有记录的渠道。 |
| `versions` | 是 | 非空的版本数组；见下文。数组顺序不决定默认版本。 |

### 版本字段

| 字段 | 必填 | 规则 |
|---|---|---|
| `version` | 是 | 由 npm 的 `node-semver` 解析的精确包版本；保留完整字符串，包括版本编译信息。精确字符串在插件内唯一。 |
| `publishTimestamp` | 是 | 以秒为单位的整数 Unix 时间戳，取值范围为 `[0, 10^11)`。 |
| `source` | 是 | `version` 的安装来源；见下文。 |
| `engines` | 否 | npm manifest 对象，将引擎名称映射为要求字符串，复制时不改写范围。 |
| `engines.dsh` | 否 | 对当前运行的 DSH 进程的要求字符串。空范围或无效范围不兼容；缺省不增加宿主要求。 |
| `peerDependencies` | 否 | npm manifest 对象，将包名映射为要求字符串，复制时不改写范围。DSH 对等依赖（peer dependency）约束兼容性；其他对等依赖仍由包管理器处理。 |

相对的 `icon` 引用相对于索引 URL 解析，与 HTML 图片引用相对于所在页面解析的方式相同。对于位于 `https://market.example/dsh/index.json` 的索引，`"icon": "icons/foo.svg"` 指向 `https://market.example/dsh/icons/foo.svg`。因此，生成器可以把索引和图标文件作为一个目录发布到任意静态主机，无需知道最终 URL。指向其他源的绝对图标 URL 必须使用 `https:`；同源规则允许位于 loopback 或内网主机上的 `http:` 索引提供自己的图标。读取器在读取索引时解析该引用，因此客户端收到的是绝对 URL。

`source` 采用以下两种形式之一，读取器拒绝其他任何 `type`：

- `{ "type": "npm", "registry"?: string }`。`registry` 是不含凭据、查询或片段的 `http:` 或 `https:` URL；允许 `http:` 是为了支持内网镜像，与 DSH 的[安装 registry](../../implemented/architecture/2026-09-18-plugin-install-registries.zh.md) 一致。
- `{ "type": "git", "url": string, "commit": string, "path"?: string }`。`url` 是规范的 `https:` URL（等于其 WHATWG URL 序列化结果），至少包含两个非空路径段且不以斜杠结尾，不含凭据、查询或片段，且不以 `.tgz` 或 `.tar.gz` 结尾。`commit` 是 40 位小写十六进制 SHA。`path` 是以 `/` 分隔的相对目录，各段只包含 ASCII 字母、数字和 `._@+-`，且不是 `.` 或 `..`；缺省表示仓库根目录。

### 安装参数

客户端安装某个版本时恰好使用以下 pnpm 参数：

- npm：spec 为 `<name>@<version>`。没有 `registry` 时，客户端像任何安装一样询问它配置的 registry。存在 `registry` 时，客户端遵循 DSH 的 [registry 计划](../../implemented/architecture/2026-09-18-plugin-install-registries.zh.md)：先询问 `registry`，仅当它属于客户端配置的 registry 之一时才回退到其他已配置 registry；其他 `registry` 单独询问，因此私有 registry 不会回退到可能以相同名称和版本发布不同包的公共 registry。
- git：spec 为 `git+<url>.git#<commit>`，`url` 已以 `.git` 结尾时不重复添加；存在 `path` 时在其后追加 `&path:/<path>`。`git+` 前缀使 pnpm 将路径段多于两个的 URL（例如 GitLab 子组）视为 Git 仓库。

### DSH 兼容性

索引将 manifest 的 `peerDependencies` 和 `engines` 作为两份独立声明保留。DSH 用当前运行的 DSH 版本检验每个 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 对等依赖。声明的 `engines.dsh` 增加一条宿主要求，不替代这些对等依赖。只有满足每条适用要求时，该版本才兼容。缺少声明不增加要求。

索引读取器和安装检查使用同一个 DSH 兼容性求值器，采用 npm 的 `node-semver` 解析器和 `includePrerelease: true`。空的或无效的 DSH 范围不兼容。既有对等依赖规则将 `workspace:*`、`workspace:^` 和 `workspace:~` 映射为当前运行的 DSH 版本；其他 `workspace:` 对等依赖范围不兼容。引擎范围不采用这种对等依赖映射。精确的本地 `name@version` 豁免适用于两种 DSH 要求，但不发布到索引中。

生成器保留每条要求字符串。读取器分别求值，不拼接或展开范围。npm 负责包的对等依赖解析及其 Node/npm 引擎检查。DSH 负责强制检查自定义 `engines.dsh` 键，规则记录在[公共 manifest 决策](../../implemented/architecture/2026-09-10-public-package-manifest.zh.md)中。

### 生成器义务

读取器无法验证以下规则；违反这些规则的生成器会发布误导性的索引。

- `name` 和每个 `version` 与所安装来源中的包 manifest 一致。
- 对于 npm 来源，`publishTimestamp` 是 `version` 在 registry 中的发布时间；对于 Git 来源，它是 `commit` 的提交者时间。
- `engines` 和 `peerDependencies` 复制来源 manifest 的声明。npm 来源使用已发布元数据，包括 npm 发布时的改写。Git 来源使用固定提交中的 manifest。无效的 DSH 范围作为不兼容要求保留，不省略，也不转换成其他声明。
- `dist-tags` 保存 registry [分发标签](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)的快照。生成器包含每个保留标签的目标版本；目标不在列出的组合包版本中时，省略该标签。对于 Git 来源，发布者或市场提供同样的精确标签到版本的映射。
- 列出的每个版本都声明了 `dsh.bundle`。安装时也会独立拒绝没有组合包 patch 的包。
- 来自包的显示字段取自 `dist-tags.latest` 指向的精确版本。没有该标签时，生成器省略这些显示字段，读取器回退到包名。`title`、`description` 和 `icon` 遵循已安装插件的显示元数据规则，同时满足本格式的 `LocalizedText` 要求。本地化文本是市场列表显示数据，不是另一份 npm manifest 声明。`homepage` 复制所选 manifest 的 `homepage`，manifest 没有该字段时省略。
- npm 的 `author` 可以是人员对象或简写字符串。对于对象，生成器复制其包含非空白字符的 `name`。对于简写字符串，生成器使用持续维护的 npm 人员归一化工具，在相同条件下取结果中的 `name`。名称不存在或只有空白时省略，不将 email 或 URL 复制到该显示字段。生成器只归一化作者投影，保留版本字符串与豁免身份。

### 读取器规则

文档违反根字段、插件字段、版本字段或 `source` 形式中的任何规则时，读取器拒绝整个索引，包括引用了未声明的分类、标签或排序键，分发标签指向未列出的版本，`name` 或精确 `version` 字符串重复，以及 `format` 不是 `1`。每个此类缺陷都是生成器 bug，静默丢弃条目会掩盖它。读取器可以限制文档大小。

读取器在每一层都忽略本 Agent Note 未定义的成员；未知的 `source.type` 值会被拒绝。这样格式 1 可以增加可选成员而不破坏现有读取器；现有读取器会误解的变更使用新的 `format` 值。

`engines`、`peerDependencies` 和 `dist-tags` 中的条目是声明的数据，不是应当丢弃的未知成员。其值必须为字符串；非字符串值使索引无效。DSH 要求字符串可以为空或语法无效，但仍作为不兼容要求保留。分发标签名使用 npm 的标签校验规则，目标与所列版本字符串精确匹配。

分类、标签和排序键对读取器不透明：读取器按它们筛选和排序，显示其 `title`，从不解释 id 的含义。读取器按本地化 `title` 对声明排序后显示。对插件排序时，无论排序方向如何，没有所选排序键值的插件都排在所有有值的插件之后，值相同的插件保持索引顺序。按发布时间排序时使用插件最大的 `publishTimestamp`。

读取器按 DSH 兼容性一节的规则评估每个版本的声明要求。它按 npm SemVer 优先级对版本排序；优先级相同的版本保留索引顺序，该顺序只用于显示。完整版本字符串标识条目，包括仅版本编译信息不同的版本。

初始渠道为 `latest`。标签的精确目标是发布者或市场选定的版本，即使另一个版本具有更高的 SemVer 优先级。客户端安装索引中列出的精确版本或提交，不使用 `name@latest`。没有 `latest` 时，需要选择版本。目标不兼容时，客户端显示该要求，并提供其他版本供显式选择。它不自动切换渠道，也不自动选择其他正式版本或先行版本。

用户选择精确版本或渠道时，以及安装确认中，客户端标识先行版本。发布者可以有意将先行版本标记为 `latest`；标签的存在不授权跳过该显式确认而安装。客户端将显示字段、标签、分类和评分归属于索引 URL。市场提供的 `official` 等标签不表示 DSH 验证，不同市场的评分也不隐含相同尺度。

## 考虑过的替代方案

**纯 npm 包名或仓库 URL 列表。** 它能标识每个插件，但列表渲染前每行需要一个或多个请求，而此格式正是为消除这一开销而设计。

**每个版本使用一个不透明的安装 spec 字符串。** 读取器无法验证自由格式的 spec 是否固定了版本。结构化的 `source` 配合精确的 `version` 或 `commit`，读取器可以验证版本固定，客户端可以构建要安装的 spec。

**安装最新版本而不是固定版本。** 这样安装的构建可能与列表显示的元数据不一致，并且包发布新版本会改变未修改的索引所安装的内容。

**每个版本一个条目。** 每个版本都会重复标题、描述、图标、作者和市场元数据，读取器还要按 `name` 分组才能显示一个插件。

**每个插件一个 `source`，每个版本只记录固定点。** 在两次发布之间换了仓库、目录或 registry 的插件将无法列出旧版本。

**每个版本各有显示字段。** 列表每个插件只显示一行，旧的显示文本、图标、作者和主页会增加索引大小，却没有读取器显示它们。

**只允许内联图标。** 不发额外请求的列表需要内联图标，但 256 KiB 原始字节编码为 base64 后约为 341 KiB，因此 100 个插件的索引可能达到约 35 MB。URL 图标以额外请求和向图片主机暴露用户 IP 地址为代价，换取较小的索引。

**将对等依赖范围合成为一个 `engines.dsh`。** 这会创建另一份兼容性声明，并需要范围求交逻辑。保留 npm 映射后，读取器与安装检查可以求值相同要求，包括连字符范围和 `||` 分支。

**让 `engines.dsh` 覆盖对等依赖。** 宿主要求与包要求表达不同义务。用宽泛的宿主范围替代包要求，可能掩盖不兼容的 DSH 对等依赖。

**将完整 npm 人员对象复制到显示字段。** 市场列表需要名称。记录规则的投影支持 npm 的原始对象与简写声明，同时省略未使用的联系字段。

**用不透明排序值表示时间，包括 ISO 日期字符串。** 发布时间具有固定语义，客户端会对其格式化和排序，因此它是一个有类型的字段。排除时间后，排序值可以只用数值，无需为每个键规定值类型。

**根级 `labels` 和 `sortKeys`，以及名为 `sort` 的插件字段。** 在两个层级都把市场定义的声明和值归入 `metadata`，并使用对应的成员名（单值的 `category` 除外），可以将它们与客户端解释的字段区分开。

**以声明顺序作为显示顺序。** JavaScript 会重排类整数的对象键，因此要保留声明顺序，就需要限定 id 格式或改用数组声明。客户端改为按本地化标题对声明排序。

**丢弃 workspace 或无效的对等依赖范围。** 生成器会隐藏安装检查要读取的要求。保留原始字符串后，共享检查器可以应用既有 workspace 规则并报告不兼容。

**选择最高兼容版本。** npm 的 `latest` 标签由发布者控制，可以指向较旧的发布版本。用版本排序替代它，会丢失这个选择，也会使优先级相同的构建没有唯一目标。

**自动回退到先行版本。** 渠道目标缺失或不兼容，不表示用户选择了先行版本。客户端要求显式选择版本或渠道。

**拒绝未知成员。** 这样每次增加可选成员都需要新的 `format` 值，并会破坏所有已部署的读取器。

## 验收标准

- 校验器接受上面的示例，并对根字段、插件字段、版本字段和 `source` 形式中的每条结构规则各拒绝一个违例，诊断信息给出对应的 JSON 路径。无效的 DSH 范围字符串通过结构校验，但求值结果为不兼容。
- 根据每个示例版本构建的安装参数可被 DSH 的安装 spec 解析器和 pnpm 接受。
- 校验器在每一层都忽略未知成员。
- 对相同的 manifest、运行时版本和本地豁免，索引与安装检查的兼容性结果一致。用例覆盖连字符范围、`||` 分支、workspace 简写、无效范围，以及宽泛的引擎范围与不兼容的 DSH 对等依赖同时存在的情况。
- 调整优先级相同的版本编译信息条目的顺序后，精确的 `dist-tags` 目标仍选择同一来源。读取器拒绝未列出的标签目标；`latest` 缺失或不兼容时，不隐式切换版本或渠道。
- 作者对象与简写字符串产生声明的显示名称，不携带联系字段，也不归一化版本。
- 解析器校验 `1.0.0+one`，并保留完整字符串供标签查找、安装身份和本地豁免键使用。
- 安装确认标识所选版本、所选渠道（如有）、先行版本状态、索引 URL 和来源。市场标签与评分继续标明归属。

## 风险

- 索引没有签名。市场可能使用误导性的 `title`，例如声称自己是官方市场；客户端必须显示索引 URL 以及每个版本的 `source`。
- Git 版本的身份与要求是关于仓库的声明。仓库可以声明任意名称，包括 `@deepseek-ai/dsh-` 名称，实际安装的内容由已安装的 manifest 决定。
- npm 版本的 `source.registry` 同样是一种声明：它把任意 `name`（包括 `@deepseek-ai/dsh-` 名称）的安装引向市场选择的 registry，由该 registry 决定实际安装的内容。
- URL 图标会向图片主机暴露用户的 IP 地址。
- 固定版本与分发标签在索引重新生成之前一直保持陈旧。
- 版本固定不验证市场身份，也不保证任意 registry 返回的字节。已安装包的检查与市场列表保持独立。
- 读取器和生成器必须在部署前一同采用这份修订提案；混用原始与修订后的格式 1 规则，可能改变兼容性结果和版本选择。
- 市场文本未经 DSH 审核即到达用户，并通过任何列出插件的客户端工具到达模型。
