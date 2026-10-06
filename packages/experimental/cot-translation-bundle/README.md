---
description: "Enable machine translation of displayed reasoning from the Plugins page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-cot-translation-bundle

English | [中文](README.zh.md)

## Summary

Translate expanded reasoning into the interface language or another chosen language. Enable Reasoning translation on the Web or Desktop Plugins page; shipped profiles leave it disabled. Bing is the default provider, and Google is available in the bundle settings. Original reasoning remains available and stays unchanged in the Session and model input.

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

Open Plugins and enable Reasoning translation in the Official group. Open its details to select Google or Bing and a target language. `auto` follows the interface language; an explicit language code such as `zh`, `en`, or `ja` overrides it. Save applies the preferences.

Expand a Think row to start translation. The row translates completed paragraphs and request-sized prefixes of long streaming paragraphs while retaining the unfinished tail. Original switches the expanded body back to the source. A failed translation leaves the original visible and offers Retry. Disabling the bundle removes its controls and cancels pending calls. Successful translations remain saved in the Session and are reused when the same request is reopened, the page reloads, or the Host restarts.

The selected service receives the expanded reasoning, which can contain private code and conversation details. Google and Bing send source text in POST request bodies. Translation requires no additional login or API key, but neither anonymous endpoint guarantees availability or free quotas. Provider failure never sends the text to another service automatically.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The bundle patch inserts `translator` and `cot-translation`, selecting Bing and the interface language. The translator owns provider protocols, network limits, and shared persisted requests and results; the GUI consumer owns settings, paragraph scheduling, and a local cache for the current display. The GUI reuses saved results directly and joins normal Session activation when a new translation needs its existing writer. Its generated Remote contribution is mounted only while the bundle is enabled. Native Chat renders the original Markdown when no expanded-body contribution is present.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Text translation subsystem](../../../docs/subsystems/translation.md) · [Translator service](../translator/README.md) · [GUI consumer](../client-ui-cot-translation/README.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the GUI consumer's normal Session activation; the Session's preset owns startup hooks and any context they add.

#### KV Cache effect

Translation records leave original reasoning intact; normal Session activation has the cache effects described by the [GUI consumer](../client-ui-cot-translation/README.md#model-experience).

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Collapsed summaries remain in the original language. Translation starts when the reader expands the reasoning body; it may change Markdown or code formatting. Original always remains accessible.
- Anonymous Google and Bing browser endpoints may fail, rate-limit requests, or change their response formats. Mainland China connectivity depends on the deployment's network and proxy configuration. Successful translations remain in the Session after collapse, bundle removal, or restart. Experimental records have best-effort retention across future Session-format migrations.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
