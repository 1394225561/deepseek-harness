---
description: "Translate text through anonymous Bing or Google endpoints, with optional durable Session results."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-translator

English | [中文](README.zh.md)

## Summary

`ctx.translator` translates one bounded text request through Bing or Google. It requires no API key or login and defaults to Bing. This experimental package is opt-in.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package as a Cordis service. Call `resolve({ text, targetLanguage, sourceLanguage?, provider?, sessionId? })`, then `translate(spec, signal?)`. The result is plain translated text. An omitted source uses `auto`; an omitted provider uses configured `provider`, initially `bing`. Consumers can read `maxTextChars` to split longer text before submission.

| Config | Default | Meaning |
|---|---|---|
| `provider` | `bing` | `google` or `bing` |
| `googleEndpoint` | `https://translate.googleapis.com/translate_a/single` | Google-compatible anonymous endpoint |
| `bingEndpoint` | `https://edge.microsoft.com/translate/translatetext` | Microsoft Edge browser translation endpoint |
| `timeoutMs` | `10000` | Deadline for the request and complete response body |
| `maxTextChars` | `4000` | Maximum submitted UTF-16 code units per request |
| `maxResponseBytes` | `1048576` | Maximum response body bytes before JSON parsing |

Endpoints accept HTTP(S) URLs without credentials or fragments. Native `fetch` uses the Host's global dispatcher and the HTTP proxy policy installed by the `dsh` launcher. No new translation library is required.

Supply an existing `sessionId` to retain translation requests and successful results in its Session log. A successful result is durably flushed before `translate()` returns and is reused after remounts or process restarts when the exact source text, source and target languages, provider, and translation recipe match. Saved results need only durable Session storage. A cache miss requires an active Session; consumers own its activation. Calls without `sessionId` remain stateless.

The service maps `zh`, `zh-CN`, `zh-SG` and `zh-Hans` to Simplified Chinese, and `zh-TW`, `zh-HK`, `zh-MO` and `zh-Hant` to Traditional Chinese. Other tags pass through to the selected provider. Empty text returns an empty string without a network request.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

Google receives a form POST using the `gtx` client; Bing receives a JSON text array through Microsoft's Edge endpoint. Both receive submitted text in the request body. Cookies, HTTP redirects and automatic provider fallback are disabled.

Session-bound calls append provider-independent `plugin:translator/request` and `plugin:translator/result` records using the canonical plugin-record writers. A result references its request by Session sequence. Requests retain the exact source, languages, provider, recipe, and optional provider-owned metadata; results retain translated text. Anonymous recipes identify the effective configured endpoint and protocol revision. Original conversation events and main model input remain unchanged.

Storage reads validate translation payloads and request/result references. Only persisted successful results are reusable; failed or interrupted provider output is not retained as a result. A cache lookup uses read access and does not activate an Agent or publish a migrated generation. A cache miss appends through the active Session's existing writer with `appendPluginRecord`, flushes that Session, and confirms durability through storage. The translator never opens a write handle or activates a Session. Identical concurrent translations wait for the first attempt and its accepted writes, even if its consumer has already canceled or timed out, then reuse its durable result; different fragments and Sessions can make requests in parallel. Plugin records have best-effort retention across future Session-format migrations.

`TranslationError.code` distinguishes input limits, HTTP failures, response limits, invalid provider responses, transport failures, missing durable Sessions, storage failures, and the service's `TRANSLATION_TIMEOUT` deadline. `TRANSLATION_SESSION_INACTIVE` rejects an uncached inactive Session before any provider call. Diagnostics include no submitted text or provider error body. `translate()` always returns a Promise and rejects admission or provider failures. Caller cancellation and service disposal preserve their original abort reasons, including caller-owned timeout reasons. Queued cancellation rejects promptly; unloading aborts accepted requests and waits for their underlying storage and network work to settle. Input limits apply in both `resolve()` and `translate()`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Experimental packages](../README.md) · [HTTP proxy behavior](../../util/http-proxy/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as anonymous endpoint translation sends no model requests and its saved records do not change model history.

#### KV Cache effect

No direct effect; translation does not change model history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- These unofficial browser endpoints have no supported third-party API guarantee. They may rate-limit requests, become unavailable or change response formats. Availability from mainland China depends on the user's network; the service guarantees no region-wide connectivity.
- Unsupported language tags fail through the selected provider. Consumers own Session activation, paragraph scheduling, input splitting and display fallback. The service reuses matching durable successful results; an admitted cache miss performs one request and never retries or switches providers.
- Each fragment lookup scans the full Session log and rebuilds its translation index. Long logs with many fragments can delay display. No incremental index is retained.
- Failed or interrupted attempts remain as append-only request records; a retry appends a new request sequence before dispatch rather than reusing an unfinished attempt.
- A malformed translation record or a result referencing a missing request rejects all Session-bound translation lookups with `TRANSLATION_STORAGE_ERROR`; the service does not skip or repair those records. Calls without `sessionId` do not read them.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

Live provider tests use the actual default endpoints without credentials. They are skipped unless explicitly enabled with `DSH_TRANSLATION_LIVE=1 pnpm run test:e2e packages/experimental/translator/tests/upstream.e2e.ts`. They cover Bing automatic and explicit source selection, both providers' Chinese locale tags, and a Google request at the default 4000-character limit.

</details>
