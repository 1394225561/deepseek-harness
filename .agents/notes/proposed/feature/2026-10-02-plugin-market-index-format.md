# Agent Note: Plugin market index format

Status: proposed

English | [中文](2026-10-02-plugin-market-index-format.zh.md)

## Problem

DSH installs third-party bundles only from a spec the user already knows: an npm name, a Git URL, a tarball, or a local path. Nothing lets a user browse installable bundles. No official market exists, and one may be added later, so a market mechanism must work with indexes that third parties publish.

The smallest possible index is a list of npm names or Git repository URLs, one per line. It identifies every plugin, but a client rendering it must fetch each package's manifest, locale files, and icon before it can show a list. A list page that issues one or more requests per row is slow, fails partially, and puts metadata resolution in every client.

An index must therefore carry everything a list page displays: localized title and description, icon, author, available versions, compatibility, and publish time. Markets also want to publish their own data, such as categories, tags, downloads, and ratings, without DSH knowing what those values mean.

## Proposal

Separate the **index** from the **index generator**. DSH defines and reads one JSON index format. How an index is produced, and from which source list, belongs to the generator. DSH's reader, its Discover page, and a reference generator are separate changes that consume this format. Indexes list [profile plugin bundles](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md) and install them through [guided plugin installation](../../implemented/architecture/2026-09-15-guided-plugin-installation.md).

### Example

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
      "metadata": {
        "category": "productivity",
        "labels": ["official"],
        "sortKeys": { "downloads": 12034, "rating": 4.6 }
      },
      "versions": [
        {
          "version": "0.2.0-rc.2",
          "publishTimestamp": 1790476800,
          "source": { "type": "npm" },
          "engines": { "dsh": "0.2.0-rc.2" }
        },
        {
          "version": "0.2.0-rc.1",
          "publishTimestamp": 1789872000,
          "source": { "type": "npm" },
          "engines": { "dsh": "0.2.0-rc.1" }
        }
      ]
    },
    {
      "name": "dsh-plugin-foo",
      "title": "Foo",
      "icon": "https://example.com/foo.png",
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

`LocalizedText` below is the `LocalizedText` type of [`dsh-package-manifest`](../../../../packages/util/package-manifest/src/types.ts), a string or an object of strings that contains `en`, with two additional rules: object keys are lowercase language ids matching `^[a-z]{2,8}(-[a-z0-9]{1,8})*$`, and every string contains at least one non-whitespace character.

### Root fields

| Field | Required | Rule |
|---|---|---|
| `format` | yes | Integer `1`. |
| `title` | yes | `LocalizedText` naming the market. |
| `description` | no | `LocalizedText`. |
| `metadata` | no | Object holding the three declaration maps below. |
| `metadata.categories` | no | Object mapping category id → `{ title: LocalizedText }`. |
| `metadata.labels` | no | Object mapping label id → `{ title: LocalizedText }`. |
| `metadata.sortKeys` | no | Object mapping sort-key id → `{ title: LocalizedText, order: "asc" \| "desc" }`; `order` is the initial sort direction. |
| `plugins` | yes | Array of plugins, possibly empty; its order is the index's default ordering. |

Category, label, and sort-key ids are non-empty strings. Readers look ids up as own properties, so ids such as `constructor` have no special meaning.

### Plugin fields

| Field | Required | Rule |
|---|---|---|
| `name` | yes | Package name matching `^(@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*$`, at most 214 characters, unique within the index. |
| `title` | no | `LocalizedText`; a reader displays `name` when absent. |
| `description` | no | `LocalizedText`. |
| `icon` | no | Either `data:<type>;base64,<payload>`, where `<type>` is `image/svg+xml`, `image/png`, `image/jpeg`, or `image/webp`, `<payload>` is canonically padded base64, and the decoded payload is at most 256 KiB; or a URL reference whose resolution against the index URL is an `https:` URL or has the index URL's origin. |
| `author` | no | String with at least one non-whitespace character. |
| `metadata` | no | Object holding the three values below. |
| `metadata.category` | no | One declared category id. |
| `metadata.labels` | no | Array of distinct declared label ids. |
| `metadata.sortKeys` | no | Object mapping a declared sort-key id → finite number. |
| `versions` | yes | Non-empty array of versions; see below. Its order has no meaning. |

### Version fields

| Field | Required | Rule |
|---|---|---|
| `version` | yes | Exact version in the SemVer 2.0.0 grammar, with optional prerelease and build metadata and without a `v` prefix or whitespace; unique within the plugin. |
| `publishTimestamp` | yes | Integer Unix timestamp in seconds, in `[0, 10^11)`. |
| `source` | yes | Where `version` is installed from; see below. |
| `engines` | no | Object. |
| `engines.dsh` | no | Non-empty SemVer range string that does not start with `workspace:`; the DSH versions this version runs on. Absent means any DSH version. |

A relative `icon` reference resolves against the index URL, as an HTML image reference resolves against its page. For an index at `https://market.example/dsh/index.json`, `"icon": "icons/foo.svg"` names `https://market.example/dsh/icons/foo.svg`. A generator can therefore publish the index and its icon files as one directory on any static host without knowing the final URL. Absolute icon URLs on other origins must use `https:`; the same-origin allowance lets an `http:` index on a loopback or intranet host serve its own icons. Readers resolve the reference when they read the index, so clients receive absolute URLs.

`source` takes one of two forms, and readers reject any other `type`:

- `{ "type": "npm", "registry"?: string }`. `registry` is an `http:` or `https:` URL without credentials, query, or fragment; `http:` is admitted for intranet mirrors, as in DSH's [install registries](../../implemented/architecture/2026-09-18-plugin-install-registries.md).
- `{ "type": "git", "url": string, "commit": string, "path"?: string }`. `url` is a canonical `https:` URL (equal to its WHATWG URL serialization) with at least two non-empty path segments and no trailing slash, without credentials, query, or fragment, and not ending in `.tgz` or `.tar.gz`. `commit` is a lowercase 40-hex-digit SHA. `path` is a `/`-separated relative directory whose segments contain only ASCII letters, digits, and `._@+-`, and are neither `.` nor `..`; absent means the repository root.

### Install arguments

A client installs one version with exactly these pnpm arguments:

- npm: the spec `<name>@<version>`. Without `registry`, the client asks its configured registries as it does for any install. With `registry`, the client follows DSH's [registry plan](../../implemented/architecture/2026-09-18-plugin-install-registries.md): it asks `registry` first and falls back to its other configured registries only when `registry` is one of them; any other `registry` is asked alone, so a private registry never falls through to a public one that may publish a different package under the same name and version.
- git: the spec `git+<url>.git#<commit>`, without doubling a trailing `.git`, followed by `&path:/<path>` when `path` is present. The `git+` prefix makes pnpm treat URLs with more than two path segments, such as GitLab subgroups, as Git repositories.

### DSH compatibility

DSH's installation check reads `engines.dsh` from the package manifest. When it is present, the package is compatible exactly when the running DSH version satisfies that range, prereleases included; an invalid range is incompatible. Only a manifest without `engines.dsh` falls back to its `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` `peerDependencies`. Exact `name@version` exemptions apply to both rules.

The fallback tests every DSH peer range against the same running DSH version, so their conjunction is one SemVer range with the same result. SemVer ranges have no parentheses, so the conjunction joins one `||` alternative from each range with spaces, for every combination, and joins the combinations with `||`. An index therefore carries a single `engines.dsh`.

### Generator obligations

A reader cannot verify these rules; a generator that violates them publishes a misleading index.

- `name` and each `version` equal the package manifest of the installed source.
- `publishTimestamp` is the registry publish time of `version` for npm sources and the committer time of `commit` for Git sources.
- `engines.dsh` copies the manifest's `engines.dsh`. Without one, it is the conjunction, as defined in DSH compatibility, of the manifest's DSH peer ranges after publication rewriting, omitting `workspace:*`, `workspace:^`, and `workspace:~`, because installation treats them as the running DSH version; with no remaining range, `engines.dsh` is absent. Installation finds any other `workspace:` range incompatible with every DSH version, so generators do not list such a version.
- Each listed version declares `dsh.bundle`. Installation independently refuses a package without a bundle patch.
- `title`, `description`, `icon`, and `author` come from the highest listed version's locale `meta` fields, manifest fields, and icon, using the rules for installed plugin display metadata.

### Reader rules

A reader rejects the whole index when the document violates any rule in Root fields, Plugin fields, Version fields, or the `source` forms, including an undeclared category, label, or sort-key reference, a duplicate `name` or `version`, or a `format` other than `1`. Each such defect is a generator bug, and dropping entries silently would hide it. Readers may bound the document size.

A reader ignores members that this note does not define, at every level; an unknown `source.type` value is rejected. Format 1 can then gain optional members without breaking existing readers; a change that existing readers would misinterpret uses a new `format` value.

Categories, labels, and sort keys are opaque: a reader filters and sorts by them, displays their `title`, and never interprets an id. Readers display declarations in the order of their localized `title`. When sorting plugins, a plugin without a value for the selected sort key follows all plugins with a value in either direction, and equal values keep the index order. Sorting by publish time uses a plugin's greatest `publishTimestamp`.

A reader evaluates each version's compatibility from `engines.dsh` with the rule in DSH compatibility. A reader orders versions by SemVer precedence. A plugin's default version is its highest compatible version without a prerelease tag; a plugin with no such version at all uses its highest compatible prerelease. A plugin without a compatible default version displays as incompatible, and a client may still offer its other versions individually.

## Alternatives considered

**A plain list of npm names or repository URLs.** It identifies every plugin but forces one or more requests per row before a list renders, which is the cost this format removes.

**One opaque install spec string per version.** A reader cannot verify that a free-form spec is pinned. A structured `source` with an exact `version`, or a `commit`, lets the reader verify pinning and lets the client build the spec it installs.

**Installing the latest version instead of a pinned one.** The installed build could then differ from the metadata the list displayed, and a package release would change what an unchanged index installs.

**One entry per version.** Every version would repeat the title, description, icon, author, and market metadata, and readers would group entries by `name` to show one plugin.

**One `source` per plugin, with only the pin per version.** A plugin that moves to another repository, directory, or registry between releases could not list its older versions.

**Display fields per version.** A list shows one row per plugin, so older display text would cost index size without a reader that shows it.

**Inline icons only.** A list without extra requests needs inline icons, but 256 KiB of raw bytes is about 341 KiB as base64, so a 100-plugin index could reach about 35 MB. URL icons trade extra requests, and disclosure of the user's IP address to the image host, for a small index.

**Copying DSH `peerDependencies` into the index.** It maps several package names to ranges that all constrain one DSH version, and names the constraint after npm peer resolution. `engines.dsh` states the same constraint once, and installation reads it first.

**A structured `author` such as npm's `{ name, email, url }`.** Clients only display an author, and an email member would spread addresses into every index.

**Opaque sort values for time, including ISO date strings.** Publish time has fixed semantics that clients format and sort, so it is a typed field. Without time, sort values can be numbers only, which needs no per-key value-type rule.

**Root-level `labels` and `sortKeys`, and a plugin field named `sort`.** Grouping market-defined declarations and values under `metadata` at both levels, with matching member names except the single-valued `category`, separates them from fields that clients interpret.

**Declaration order as display order.** JavaScript reorders integer-like object keys, so declaration order would need either an id pattern or array declarations. Clients sort declarations by their localized title instead.

**Allowing `workspace:` ranges.** Installation maps `workspace:*`, `workspace:^`, and `workspace:~` to the running DSH version, so every runtime would appear compatible; omitting them states the same result explicitly.

**Prereleases as default versions.** Installation accepts prereleases, but offering a release candidate by default to users of a plugin with stable releases would install untested builds without a choice.

**Rejecting unknown members.** Every optional addition would then require a new `format` value and break every deployed reader.

## Acceptance criteria

- A validator accepts the example above and rejects one violation of each rule in Root fields, Plugin fields, Version fields, and the `source` forms, with a diagnostic naming the JSON path.
- Install arguments built from every example version are accepted by DSH's install-spec parser and by pnpm.
- A validator ignores unknown members at every level.
- DSH's installation check prefers `engines.dsh` over DSH `peerDependencies`, and compatibility computed from an index version matches it for the same manifest.

## Risks

- An index is unsigned. A market can use a misleading `title`, such as one claiming to be official; clients must show the index URL and each version's `source`.
- A Git version's `name`, `version`, and `engines.dsh` are claims about the repository. A repository can claim any name, including an `@deepseek-ai/dsh-` name, and the installed manifest decides what is actually installed.
- An npm version's `source.registry` is equally a claim: it directs the install of any `name`, including an `@deepseek-ai/dsh-` name, to a registry the market chooses, and that registry decides what is installed.
- URL icons disclose the user's IP address to image hosts.
- Pinned versions stay stale until the index is regenerated.
- Market text reaches users, and models through any client tool that lists plugins, without review by DSH.
