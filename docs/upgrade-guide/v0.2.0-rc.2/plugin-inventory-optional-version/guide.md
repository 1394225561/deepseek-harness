---
kind: upgrade-guide
description: "Plugin inventory consumers must accept package entries without a version."
---

# Optional plugin inventory versions

English | [中文](guide.zh.md)

## Change

`DeepSeekPluginPackageIdentity` from `@deepseek-ai/dsh-plugin-package-inventory-deepseek/types` now declares `version?: string` instead of `version: string`. The `dsh_plugin_packages` request field can contain `{ name }` when a package manifest has a valid name but no non-blank string version. Readers of this exported type or wire field must handle absent versions. The enclosing inventory protocol remains `version: 1`.

## Migration

1. Update readers and validators of `dsh_plugin_packages.packages` to accept entries with only `name`. Check `entry.version !== undefined` before using version-specific operations; display the package name alone when its version is absent.
2. Preserve name-only entries during deduplication and serialization. Do not invent a package version or copy one from a parent package.
3. Typecheck consumers and exercise a manifest such as `{ "name": "local-plugin", "private": true }`. Confirm the request contains `{ "name": "local-plugin" }` and consumers accept it without a `version` field.
