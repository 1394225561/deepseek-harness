---
kind: upgrade-guide
description: "The built-in cwd prompt variable and per-provider cwd configuration are replaced by the Session working-directory service and per-start cwd."
---

# Migrate working-directory templates and subagent configuration

English | [中文](guide.zh.md)

## Change

The next release removes the loop's built-in `{{cwd}}` prompt variable and the `cwd` configuration key from `@deepseek-ai/dsh-subagent-acp` and `@deepseek-ai/dsh-subagent-dsh-sdk`. Custom prompt templates that retain an unresolved `{{cwd}}` fail before a model request. A Session's current execution directory is supplied as required user context and is persisted separately from its original `Session.header.cwd`.

New subagents use their start request's `cwd` when provided, otherwise they capture the parent's current directory. Existing processes keep their own directories. Changing the execution directory does not change the original project or grant additional write permissions.

## Migration

1. In home, profile, or invocation `personaSuffix` configuration and preset `suffix` fields, remove the directory clause that references `{{cwd}}`, retaining unrelated text. Omit or clear a suffix that becomes empty. The [working-directory service](../../../../packages/session/working-directory/README.md) supplies the directory context.
2. Remove `config.cwd` from ACP and DSH-SDK subagent provider rows in your profile patches. To select a directory for one child, pass `cwd` in its [start request](../../../subsystems/subagent.md). To change the parent's execution directory, use `working_directory({ cd: "/absolute/project" })` before starting the child.
3. Run `working_directory({})` in the affected Session and confirm the reported directory. Start a child without an override and check its execution directory; use an explicit start `cwd` when the child must use another checkout. Read `Session.header.cwd` only for original project identity or permission roots, rather than current-directory operations.
