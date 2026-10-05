---
kind: upgrade-guide
description: "Nine optional packages use experimental names, and hook, webhook, Ralph, and badge configurations require explicit installation or insertion."
---

# Experimental package names and explicit composition

English | [中文](guide.zh.md)

## Change

The next release replaces these v0.2.1-alpha.1 package names:

| Old name suffix after `@deepseek-ai/dsh-` | New suffix |
|---|---|
| `hook-protocol` | `experimental-hook-protocol` |
| `hooks-claude-code` | `experimental-hooks-claude-code` |
| `hooks-codex` | `experimental-hooks-codex` |
| `webhook` | `experimental-webhook` |
| `webhook-github` | `experimental-webhook-github` |
| `session-title-all-prompts-llm` | `experimental-session-title-all-prompts-llm` |
| `tool-terminal` | `experimental-tool-terminal` |
| `tool-ralph` | `experimental-tool-ralph` |
| `skill-badge` | `experimental-skill-badge` |

The CLI and Python runtime do not install the relocated hook bridges or Ralph. The CLI does not install the webhook pair. Base and the full Web presets omit dormant Ralph rows, and base omits its dormant badge row. Patches that only enable those removed IDs no longer insert a plugin. Default active behavior, plugin registration names, tool names, and recorded Session event names remain unchanged.

## Migration

1. Replace old npm names in dependencies, imports, profile patches, and overlays using the table. Do not rewrite recorded Session events.
2. Install the packages and missing peers into each affected profile. Profiles disable automatic peer installation. For example, run `dsh plugin --profile web add @deepseek-ai/dsh-experimental-hooks-claude-code @deepseek-ai/dsh-experimental-hook-protocol`. The Codex bridge needs the same protocol peer. The GitHub adapter needs `@deepseek-ai/dsh-experimental-webhook` alongside `@deepseek-ai/dsh-experimental-webhook-github`.
3. Replace an override of a removed row with a complete insertion. Add preset-local tools inside that preset's `config.plugins`, including the services they require. A host badge insertion is:

   ```yaml
   - insert:
       - id: skill-badge
         name: '@deepseek-ai/dsh-experimental-skill-badge'
   ```

4. For GitHub review, use the example distributed with the adapter instead of the removed CLI example. Follow the [installed-profile instructions](../../../user/guide/github-review.md); keep customized rule modules inside the profile so their imports resolve its installed packages.
5. Start the profile and confirm that its configured plugins activate without missing-package, missing-peer, or missing-row errors. Confirm the expected tool or skill is available in the intended Agent preset.
