---
kind: upgrade-guide
description: "Claude Code and Codex bundles add delegation tools to full Web presets and require those preset targets."
---

# Native subagent bundles include preset tools

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-subagent-claude-code` and `@deepseek-ai/dsh-subagent-codex` bundle layers register their providers and add delegation tools to `preset-standard`, `preset-cordis`, and `preset-ptc`. Previously they registered only providers. Selecting these bundles now requires those preset rows; headless, SDK, and ACP profiles do not contain them. `dsh plugin add` selects a bundle automatically, and profile startup with missing targets reports `profile patch preset "preset-standard" is missing or not addressable`. The manager likewise reports activation failure and can retain the saved selection; recover below without automatic rollback.

The full Web presets omit their dormant `tool-subagent-claude-code` and `tool-subagent-codex` rows. The bundles contribute `optional-tool-subagent-claude-code` and `optional-tool-subagent-codex` instead. Provider configuration and native authentication are unchanged.

`pluginManager.listBundles()` now returns required `BundleInfo.official` and `BundleInfo.availability` fields. `official` identifies project-maintained shipped optional bundles and on-demand catalog entries; `availability` is `installation`, `profile`, or `missing`. `installed` still means a profile dependency declaration. Optional `installTarget` gives the host-selected exact spec and version. Client detail-slot `PluginPackageRef` also requires `official` and `availability`.

## Migration

1. For Web or Desktop, enable the desired provider in Plugins → Official. The ordinary installer selects the exact running DSH version. Remove manual rows that already register the same `subagent_claude_code` or `subagent_codex` tool before enabling the bundle.
2. Remove profile patches targeting the former dormant row ids. Configure the new rows with a scoped `preset` patch, using the appropriate `optional-tool-subagent-*` id. A configuration override still replaces the complete row configuration.
3. For headless, SDK, ACP, or other profiles without the three preset targets, retain the provider package in `$DSH_HOME/profiles/<name>/package.json` dependencies and remove its entry from `dsh.profile.bundles`. Mount the provider and desired generic delegation tool explicitly in that profile's `cordis.patch.yml`; the [Codex](../../../../packages/subagent/subagent-codex/README.md#exposing-the-tool) and [Claude Code](../../../../packages/subagent/subagent-claude-code/README.md#exposing-the-tool) examples show the rows. This preserves the provider-only installation workflow.
4. Open a new Session with the intended preset and confirm its tool catalog includes the selected delegation tool. The minimal preset remains unchanged. Off deselects the bundle without uninstalling it; Remove remains a separate action.
5. Update clients and fixtures that construct or validate `BundleInfo` or `PluginPackageRef` to include the new required fields. Use `official` for grouping and `availability` for package presence; `installed: false` alone no longer identifies an installation-carried bundle.

<a id="recovery"></a>

**Recover a profile without full presets**

For a profile with the provider packages already installed, run this before its next launch; replace `headless` with the intended profile name. The command does not boot the profile. It deselects only these two bundle layers and preserves their packages and dependency versions:

```sh
dsh plugin --profile headless exec node -e 'const fs=require("node:fs");const p="package.json";const m=JSON.parse(fs.readFileSync(p,"utf8"));m.dsh.profile.bundles=m.dsh.profile.bundles.filter(n=>!["@deepseek-ai/dsh-subagent-codex","@deepseek-ai/dsh-subagent-claude-code"].includes(n));fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n");'
```

Then add the desired provider README's “Exposing the tool” `insert` operation to that profile's `cordis.patch.yml`, and run `dsh --profile headless --dump-config` to check the effective composition. The shared base already provides Job services; do not insert them twice.
