# Agent Note: Plugin market index format

Status: proposed

English | [中文](2026-10-02-plugin-market-index-format.zh.md)

## Problem

DSH installs third-party bundles only from a spec the user already knows: an npm name, a Git URL, a tarball, or a local path. Nothing lets a user browse installable bundles. No official market exists, and one may be added later, so a market mechanism must work with indexes that third parties publish.

The smallest possible index is a list of npm names or Git repository URLs, one per line. It identifies every plugin, but a client rendering it must fetch each package's manifest, locale files, and icon before it can show a list. A list page that issues one or more requests per row is slow, fails partially, and puts metadata resolution in every client.

An index must therefore carry everything a list page displays: localized title and description, icon, version, compatibility, and publish time. Markets also want to publish their own data, such as categories, tags, downloads, and ratings, without DSH knowing what those values mean.

## Proposal

Separate the **index** from the **index generator**. DSH defines and reads one JSON index format. How an index is produced, and from which source list, belongs to the generator. DSH's reader, its Discover page, and a reference generator are separate changes that consume this format.

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
      "name": "@deepseek-ai/dsh-experimental-auto-review",
      "version": "0.2.0-rc.2",
      "publishTimestamp": 1790476800,
      "source": { "type": "npm" },
      "peerDependencies": { "@deepseek-ai/dsh-agent": "0.2.0-rc.2" },
      "title": { "en": "Auto Review", "zh": "自动审查" },
      "description": { "en": "Per-tool LLM authorization review", "zh": "逐工具 LLM 授权审查" },
      "icon": "icons/auto-review.svg",
      "metadata": {
        "category": "productivity",
        "labels": ["official"],
        "sortKeys": { "downloads": 12034, "rating": 4.6 }
      }
    },
    {
      "name": "dsh-plugin-foo",
      "version": "1.0.0",
      "publishTimestamp": 1788000000,
      "source": {
        "type": "git",
        "url": "https://github.com/author/dsh-plugins",
        "commit": "3f9c2e1d8a4b6c0e7f1a2b3c4d5e6f708192a3b4",
        "path": "packages/foo"
      },
      "title": "Foo",
      "icon": "https://example.com/foo.png"
    }
  ]
}
```

`LocalizedText` below is the `LocalizedText` type of [`dsh-package-manifest`](../../../../packages/util/package-manifest/src/types.ts): either a string, or an object whose keys are lowercase language ids matching `^[a-z]{2,8}(-[a-z0-9]{1,8})*$`, whose members are strings, and which contains `en`. Every string contains at least one non-whitespace character.

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
| `plugins` | yes | Array of entries, possibly empty; its order is the index's default ordering. |

Category, label, and sort-key ids are non-empty strings. Readers look ids up as own properties, so ids such as `constructor` have no special meaning.

### Entry fields

| Field | Required | Rule |
|---|---|---|
| `name` | yes | Package name matching `^(@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*$`, at most 214 characters, unique within the index. |
| `version` | yes | Exact version in the SemVer 2.0.0 grammar, with optional prerelease and build metadata and without a `v` prefix or whitespace. |
| `publishTimestamp` | yes | Integer Unix timestamp in seconds, in `[0, 10^11)`. |
| `source` | yes | Where `version` is installed from; see below. |
| `peerDependencies` | no | Object mapping a package name that is `@deepseek-ai/dsh` or starts with `@deepseek-ai/dsh-` to a non-empty range string that does not start with `workspace:`. |
| `title` | no | `LocalizedText`; a reader displays `name` when absent. |
| `description` | no | `LocalizedText`. |
| `icon` | no | Either `data:<type>;base64,<payload>`, where `<type>` is `image/svg+xml`, `image/png`, `image/jpeg`, or `image/webp`, `<payload>` is canonically padded base64, and the decoded payload is at most 256 KiB; or a URL reference whose resolution against the index URL is an `https:` URL or has the index URL's origin. |
| `metadata` | no | Object holding the three values below. |
| `metadata.category` | no | One declared category id. |
| `metadata.labels` | no | Array of distinct declared label ids. |
| `metadata.sortKeys` | no | Object mapping a declared sort-key id → finite number. |

`source` takes one of two forms, and readers reject any other `type`:

- `{ "type": "npm", "registry"?: string }`. `registry` is an `http:` or `https:` URL without credentials, query, or fragment.
- `{ "type": "git", "url": string, "commit": string, "path"?: string }`. `url` is a canonical `https:` URL (equal to its WHATWG URL serialization) with at least two non-empty path segments, without credentials, query, or fragment, and not ending in `.tgz` or `.tar.gz`. `commit` is a lowercase 40-hex-digit SHA. `path` is a `/`-separated relative directory whose segments contain only ASCII letters, digits, and `._@+-`, and are neither `.` nor `..`; absent means the repository root.

### Install arguments

A client installs an entry with exactly these pnpm arguments:

- npm: the spec `<name>@<version>`, asking `registry` first when present and the client's configured registry otherwise. A client may fall back to its other configured registries; any of them installs the same exact version.
- git: the spec `git+<url>.git#<commit>`, without doubling a trailing `.git`, followed by `&path:/<path>` when `path` is present. The `git+` prefix makes pnpm treat URLs with more than two path segments, such as GitLab subgroups, as Git repositories.

### Generator obligations

A reader cannot verify these rules; a generator that violates them publishes a misleading index.

- `name` and `version` equal the package manifest of the installed source.
- `publishTimestamp` is the registry publish time of `version` for npm sources and the committer time of `commit` for Git sources.
- `peerDependencies` copies the manifest's DSH peer ranges after publication rewriting. A Git source whose manifest keeps a `workspace:` range omits that member, because installation treats such a range as the running DSH version.
- The package declares `dsh.bundle`. Installation independently refuses a package without a bundle patch.
- `title`, `description`, and `icon` come from the package's locale `meta` fields, manifest fields, and icon, using the rules for installed plugin display metadata.

### Reader rules

A reader rejects the whole index when the document violates any rule in Root fields, Entry fields, or the `source` forms, including an undeclared category, label, or sort-key reference, a duplicate `name`, or a `format` other than `1`. Each such defect is a generator bug, and dropping entries silently would hide it. Readers may bound the document size.

A reader ignores members that this note does not define, at every level except `source.type`. Format 1 can then gain optional members without breaking existing readers; a change that existing readers would misinterpret uses a new `format` value.

Categories, labels, and sort keys are opaque: a reader filters and sorts by them, displays their `title`, and never interprets an id. Readers display declarations in the order of their localized `title`. When sorting entries, an entry without a value for the selected sort key follows all entries with a value in either direction, and equal values keep the index order.

A reader evaluates compatibility from `peerDependencies` with the same rule as DSH's installation check, so an invalid range makes the entry incompatible.

## Alternatives considered

**A plain list of npm names or repository URLs.** It identifies every plugin but forces one or more requests per row before a list renders, which is the cost this format removes.

**One opaque install spec string per entry.** A reader cannot verify that a free-form spec is pinned. A structured `source` with an exact `version`, or a `commit`, lets the reader verify pinning and lets the client build the spec it installs.

**Installing the latest version instead of a pinned one.** The installed build could then differ from the metadata the list displayed, and a package release would change what an unchanged index installs.

**Inline icons only.** A list without extra requests needs inline icons, but 256 KiB of raw bytes is about 341 KiB as base64, so a 100-entry index could reach about 35 MB. URL icons trade extra requests, and disclosure of the user's IP address to the image host, for a small index.

**`engines.dsh` as the compatibility field.** DSH's installation check reads DSH `peerDependencies`, not `engines.dsh`. A separate field could mark an entry compatible that installation refuses, or the reverse.

**Opaque sort values for time, including ISO date strings.** Publish time has fixed semantics that clients format and sort, so it is a typed field. Without time, sort values can be numbers only, which needs no per-key value-type rule.

**Root-level `labels` and `sortKeys`, and an entry field named `sort`.** Grouping market-defined declarations and values under `metadata` at both levels, with matching member names, separates them from fields that clients interpret.

**Declaration order as display order.** JavaScript reorders integer-like object keys, so declaration order would need either an id pattern or array declarations. Clients sort declarations by their localized title instead.

**Allowing `workspace:` peer ranges.** Installation maps them to the running DSH version, so every runtime would appear compatible; omitting them states the same result explicitly.

**Rejecting unknown members.** Every optional addition would then require a new `format` value and break every deployed reader.

## Acceptance criteria

- A validator accepts the example above and rejects one violation of each rule in Root fields, Entry fields, and the `source` forms, with a diagnostic naming the JSON path.
- Install arguments built from both example entries are accepted by DSH's install-spec parser and by pnpm.
- A validator ignores unknown members at every level.
- Compatibility computed from `peerDependencies` matches DSH's installation check for the same manifest.

## Risks

- An index is unsigned. A market can use a misleading `title`, such as one claiming to be official; clients must show the index URL and each entry's `source`.
- A Git entry's `name`, `version`, and `peerDependencies` are claims about the repository. A repository can claim any name, including an `@deepseek-ai/dsh-` name, and the installed manifest decides what is actually installed.
- URL icons disclose the user's IP address to image hosts.
- Pinned versions stay stale until the index is regenerated.
- Market text reaches users, and models through any client tool that lists entries, without review by DSH.
