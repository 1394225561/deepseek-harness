---
kind: upgrade-guide
description: "Claude Code and Codex bundles add delegation tools to full Web presets and require those preset targets."
---

# Native subagent bundles include preset tools

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-subagent-claude-code` and `@deepseek-ai/dsh-subagent-codex` bundle layers register their providers and add delegation tools to `preset-standard`, `preset-cordis`, and `preset-ptc`. Previously they registered only providers. Selecting these bundles now requires those preset rows; headless, SDK, and ACP profiles do not contain them.

The full Web presets omit their dormant `tool-subagent-claude-code` and `tool-subagent-codex` rows. The bundles contribute `optional-tool-subagent-claude-code` and `optional-tool-subagent-codex` instead. Provider configuration and native authentication are unchanged.

## Migration

1. For Web or Desktop, enable the desired provider in Plugins → Official. The ordinary installer selects the exact running DSH version. Remove manual rows that already register the same `subagent_claude_code` or `subagent_codex` tool before enabling the bundle.
2. Remove profile patches targeting the former dormant row ids. Configure the new rows with a scoped `preset` patch, using the appropriate `optional-tool-subagent-*` id. A configuration override still replaces the complete row configuration.
3. For headless, SDK, ACP, or other profiles without the three preset targets, retain the provider package in `$DSH_HOME/profiles/<name>/package.json` dependencies and remove its entry from `dsh.profile.bundles`. Mount the provider and desired generic delegation tool explicitly in that profile's `cordis.patch.yml`; the [Codex](../../../../packages/subagent/subagent-codex/README.md#exposing-the-tool) and [Claude Code](../../../../packages/subagent/subagent-claude-code/README.md#exposing-the-tool) examples show the rows. This preserves the provider-only installation workflow.
4. Open a new Session with the intended preset and confirm its tool catalog includes the selected delegation tool. The minimal preset remains unchanged. Off deselects the bundle without uninstalling it; Remove remains a separate action.
