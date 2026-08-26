# 10 · 让 dsh 出站请求走本地 HTTP 代理（NODE_USE_ENV_PROXY）

## 背景

2026-08-26 配置的第三方提供方 `b-ai` 的 baseURL 需要 VPN 才能访问，目标是让 dsh 的相关请求走本机代理软件的 `http://127.0.0.1:7897`（Clash 系混合端口）。本文记录源码层面的请求链路分析、正确的开启方式、`.env` 限制，以及本机对照实验。

## 一、结论：dsh 没有代理配置项，开关在 Node 运行时

- `llm-pi-ai` 的 provider profile 字段全集里没有任何 proxy / 自定义 fetch 入口（`apiKeyEnv`、`baseURL`、`compat`、`transport`、`timeoutMs`……见 `packages/llm/llm-pi-ai/src/config.ts`）。
- LLM 请求链路：pi-ai 的各协议实现用官方 SDK 客户端发请求，如 `openai-completions.js` 里 `new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser, defaultHeaders })`——**没有传自定义 fetch**，落到 Node 全局 `fetch`（undici）。「获取可用模型」的模型发现同样直接 `fetch(url, …)`（`packages/llm/llm-pi-ai/src/discovery.ts:244`）。
- Node 全局 `fetch` **默认忽略** `HTTP_PROXY` / `HTTPS_PROXY` 环境变量。必须显式打开 `NODE_USE_ENV_PROXY=1`，undici 才会把全局 dispatcher 换成按环境变量取代理的 `EnvHttpProxyAgent`。

版本要求（Node 官方文档）：

| 能力 | 首次可用版本 |
|---|---|
| `fetch()` 认代理环境变量 | v24.0.0；v22 系回移到 **v22.21.0** |
| `node:http`/`node:https` 认代理环境变量 | v24.5.0（同样回移到 v22.21.0） |

本仓库 engines 为 `^22.19.0 || >=24.0.0`：若 shell 默认 node 落在 22.19/22.20，需 `nvm use 24`（或升到 ≥22.21）；本机 nvm 已有 v24.19.0。

## 二、操作序列

```sh
# 在启动 dsh / Web UI 服务端的同一个 shell 里：
export NODE_USE_ENV_PROXY=1          # 关键开关：让全局 fetch 认代理变量
export HTTPS_PROXY=http://127.0.0.1:7897
export NO_PROXY=localhost,127.0.0.1  # 可选：本地回环不走代理
nvm use 24                           # 确保 node ≥24 或 ≥22.21

pnpm dsh --profile headless "..."    # 或启动 Web UI 服务端
```

要点：

- **生效位置是服务端进程**。Web UI 场景下发 LLM 请求的是 server 进程，浏览器端设置无效；用上面的方式启动服务端即可。
- 只想让 b-ai 走代理、DeepSeek 直连：把 `api.deepseek.com` 加进 `NO_PROXY`。
- 单次内联等价写法：`NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 pnpm dsh …`。

## 三、`.env` 文件不能携带代理变量（bootstrap-only 名单）

dsh 启动时通过 `loadLayeredEnv` 分层加载环境：继承的进程环境 → 项目层 `<cwd>/.env` → 用户层 `$DSH_HOME/.env`（后者不覆盖已存在的名字）。但两层 `.env` 都要先过 `isBootstrapOnly` 白名单审查，以下名字**只允许来自继承环境**，写在 `.env` 里会直接报错拒绝：

- 网络/信任类正是本次相关的：`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_SEARCH_BASE_URL`、`SSL_CERT_FILE`、`SSL_CERT_DIR`、`REQUESTS_CA_BUNDLE`、`CURL_CA_BUNDLE`、`NODE_TLS_REJECT_UNAUTHORIZED`
- 其余：进程启动与模块解析（`PATH`、`NODE_OPTIONS`…）、解释器钩子（`BASH_ENV`、`PYTHONPATH`…）、VCS 与编辑器选择器（`GIT_*`、`EDITOR`…），以及 `DSH_`、`XDG_`、`DYLD_`、`BASH_FUNC_` 前缀下的所有名字。

所以代理变量只能 export 进启动 dsh 的那个 shell（或系统的环境设置），写进任何一层 `.env` 都不行。

## 四、细节与坑

| 事项 | 说明 |
|---|---|
| 仅支持 HTTP/HTTPS 代理 | pi-ai 自带的代理解析对 SOCKS/PAC 直接抛 `Unsupported proxy protocol…use an HTTP or HTTPS proxy URL`；Clash/V2Ray 的混合端口（如 7897）接受 HTTP CONNECT，没有问题 |
| pi-ai 自己的 env 代理解析覆盖面有限 | pi-ai 内部有按目标 URL 解析 `<protocol>_proxy` / `all_proxy` 并尊重 `no_proxy` 的工具（`dist/utils/node-http-proxy.js`），但只有 bedrock-converse-stream 与 openai-codex-responses 两条协议链路调用它；openai-completions 等主链路完全依赖上层的 `NODE_USE_ENV_PROXY` |
| 不要给该路由设 `transport: websocket` | WebSocket 连接不在全局 fetch 的代理路径上；保持默认（SSE/auto）才吃这个开关 |
| `NO_PROXY` 匹配规则 | 按主机名（可带端口、支持 `*` 后缀通配），`*` 表示全不代理；逐项与目标比较 |
| 验证方法 | 启动后让模型回一句话，同时在代理软件的连接面板看是否出现 dsh 进程到 b-ai 域名的连接条目 |

## 五、本机实测记录（2026-08-26）

对照实验：本起一个仅记录请求的 HTTP 探针服务（监听 `127.0.0.1:7899`，处理 `connect` 事件），用 nvm 的 node v24.19.0 对 `https://example.com` 发 `fetch`：

- 不设 `NODE_USE_ENV_PROXY`、只设 `HTTPS_PROXY=http://127.0.0.1:7899` → `status 200`，探针无任何记录 ⇒ **默认直连，代理变量被无视**。
- 加 `NODE_USE_ENV_PROXY=1` → fetch 报错（探针返回 502 掐断隧道），探针日志出现 `PROXY-SAW-CONNECT example.com:443` ⇒ **请求确实经过代理端口**。

实验侧记：探针最初只注册了普通 `request` 处理器，导致「超时且探针无输出」——HTTPS over HTTP 代理走的是 `CONNECT` 方法，Node `http.Server` 对它发 `connect` 事件而不是 `request`。调试同类问题时注意。

---

## 证据文件

- `packages/boot/app-boot/src/index.ts` —— `BOOTSTRAP_NAMES` 含 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY` 等（L93-114）；`BOOTSTRAP_PREFIXES` 含 `DSH_`/`XDG_`/`DYLD_`（L117）；`readEnvLayer` 对 bootstrap-only 名字抛错（L139 起）；`loadLayeredEnv` 的项目层→用户层应用顺序与「不覆盖已存在值」（L177-198）。
- `packages/llm/llm-pi-ai/src/config.ts` —— provider profile 无任何代理/fetch 字段（L88-176）。
- `packages/llm/llm-pi-ai/src/discovery.ts:244` —— 模型发现直接全局 `fetch`。
- 仓库根 `package.json` L9 —— `"engines": { "node": "^22.19.0 || >=24.0.0" }`。
- `node_modules/.pnpm/@earendil-works+pi-ai@0.82.1_*/…/dist/`：
  - `api/openai-completions.js` L505 附近 —— `new OpenAI({...})` 无自定义 fetch；
  - `utils/node-http-proxy.js` —— env 代理解析与 SOCKS/PAC 拒绝消息；
  - `api/bedrock-converse-stream.js`、`api/openai-codex-responses.js` —— 仅有的两个调用方。
- Node.js 官方文档 [Enterprise network configuration](https://nodejs.org/learn/http/enterprise-network-configuration) 及 PR [nodejs/node#57165](https://github.com/nodejs/node/pull/57165)（fetch 支持，v24.0.0）、[nodejs/node#60230](https://github.com/nodejs/node/pull/60230)（v22.21.0 回移）。
