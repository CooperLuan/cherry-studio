# Cherry Studio Knowledge Automation Fork

Languages: English | [简体中文](docs/zh/README.md)

This repository is a Cherry Studio fork focused on making large local knowledge bases practical to maintain over time.

The main improvements in this branch are:

- Incremental directory refresh for Cherry Studio knowledge bases
- New Knowledge Base maintenance APIs for adding directories, refreshing directories, refreshing individual files, and polling jobs
- File-level sidecar indexing with content hashes to avoid re-embedding unchanged files
- CLI tooling for syncing configured local folders into Cherry Studio knowledge bases
- Better progress reporting for long-running directory indexing jobs
- OpenAPI documentation for the new maintenance endpoints

Upstream Cherry Studio is still the foundation of this project: a cross-platform desktop AI client with multi-provider LLM support, assistants, document processing, MCP integration, and knowledge-base search.

## What changed for Knowledge Bases

### Incremental directory indexing

Cherry Studio can now keep a file-level sidecar index for directory knowledge items. After a directory has a sidecar index, refresh jobs compare files by path, size, extension, mtime, and content hash.

That means a refresh only processes:

- newly added files
- modified files
- deleted files that need their loaders removed

Unchanged files keep their existing loader IDs and are not embedded again.

### Knowledge Base maintenance API

The local API server now includes write-side maintenance endpoints:

```http
POST /v1/knowledge-bases/{id}/directories
POST /v1/knowledge-bases/{id}/directories/{itemId}/refresh
POST /v1/knowledge-bases/{id}/directories/{itemId}/files/refresh
GET  /v1/knowledge-bases/jobs/{jobId}
```

The APIs are designed for local automation scripts, scheduled jobs, and personal knowledge-ingestion pipelines.

### CLI sync workflow

The CLI helper at `scripts/cherry-knowledge.ts` can:

- list knowledge bases
- add a directory to a knowledge base
- refresh a full directory
- refresh one file inside a directory
- sync many directories from a YAML/JSON config file
- wait for jobs and print progress

## Prerequisites

1. Open Cherry Studio.
2. Enable the local API Server in Cherry Studio settings.
3. Make sure you have the API key if the API Server has authentication enabled.
4. Install dependencies for this repository:

```bash
corepack pnpm install
```

The default local API base is:

```text
http://127.0.0.1:23333
```

You can override it with either:

```bash
CHERRY_KB_API_BASE=http://127.0.0.1:23333
```

or:

```bash
CHERRY_API_BASE=http://127.0.0.1:23333
```

## Authentication

Pass the API key directly:

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts list \
  --api-key cs-sk-your-key
```

Or store it in a file and pass the file path:

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts list \
  --api-key-file ~/.cherry-api-key
```

The helper also understands simple key-file formats such as:

```text
cs-sk-your-key
```

```text
Bearer cs-sk-your-key
```

```text
CHERRY_API_KEY=cs-sk-your-key
```

## CLI Usage

### List knowledge bases

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts list \
  --api http://127.0.0.1:23333 \
  --api-key-file ~/.cherry-api-key
```

### Add a directory to a knowledge base

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts add-directory \
  --api http://127.0.0.1:23333 \
  --api-key-file ~/.cherry-api-key \
  --base <knowledge-base-id> \
  --path "C:\path\to\docs" \
  --wait
```

Adding a new directory indexes it and creates the sidecar file index used by future incremental refreshes.

### Refresh an existing directory

Full refresh:

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts refresh-directory \
  --api-key-file ~/.cherry-api-key \
  --base <knowledge-base-id> \
  --item <directory-item-id> \
  --mode full \
  --wait
```

Incremental refresh:

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts refresh-directory \
  --api-key-file ~/.cherry-api-key \
  --base <knowledge-base-id> \
  --item <directory-item-id> \
  --mode incremental \
  --wait
```

If a directory does not yet have a sidecar index, incremental refresh returns a clear error. Run one full refresh once to build the baseline, then use incremental refresh after that.

### Refresh one file inside a directory

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts refresh-file \
  --api-key-file ~/.cherry-api-key \
  --base <knowledge-base-id> \
  --directory-item <directory-item-id> \
  --file "C:\path\to\docs\one-file.md" \
  --wait
```

If the file already exists in the sidecar index, the old loader is removed and the file is embedded again. If the file is new, it is indexed as a new file and added to the directory item.

### Check a job

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts job \
  --api-key-file ~/.cherry-api-key \
  --job <job-id>
```

## Sync many directories from a config file

Create a YAML file that maps knowledge-base names to local directories:

```yaml
Research:
  - 'C:\Knowledge\papers'
  - 'C:\Knowledge\notes'
Podcasts:
  - 'D:\Transcripts\tech'
  - 'D:\Transcripts\health'
```

Then run:

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts sync-directories \
  --api-key-file ~/.cherry-api-key \
  --config kb-dirs.yaml \
  --wait
```

By default, existing directories are skipped and only missing directory bindings are added.

To refresh existing configured directories too:

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts sync-directories \
  --api-key-file ~/.cherry-api-key \
  --config kb-dirs.yaml \
  --refresh-existing \
  --wait
```

For strict incremental sync of existing directories:

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts sync-directories \
  --api-key-file ~/.cherry-api-key \
  --config kb-dirs.yaml \
  --refresh-existing \
  --mode incremental \
  --wait
```

This is useful for automation because it does not silently fall back to a full re-embedding pass when an old directory lacks a sidecar index.

## Recommended automation pattern

For a large personal knowledge collection:

1. Run `sync-directories --config kb-dirs.yaml --wait` to add any directories that are not bound yet.
2. Run `sync-directories --config kb-dirs.yaml --refresh-existing --mode incremental --wait` to process new, changed, and deleted files for existing directories.
3. If a legacy directory fails because it has no sidecar index, run a one-time full refresh for that directory, then return to incremental mode.

## API Examples

### Add directory

```bash
curl -X POST "http://127.0.0.1:23333/v1/knowledge-bases/<base-id>/directories" \
  -H "Authorization: Bearer cs-sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"path":"C:\\path\\to\\docs","mode":"enqueue","refresh_if_exists":false}'
```

### Incrementally refresh directory

```bash
curl -X POST "http://127.0.0.1:23333/v1/knowledge-bases/<base-id>/directories/<item-id>/refresh" \
  -H "Authorization: Bearer cs-sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"mode":"incremental"}'
```

### Refresh one file

```bash
curl -X POST "http://127.0.0.1:23333/v1/knowledge-bases/<base-id>/directories/<item-id>/files/refresh" \
  -H "Authorization: Bearer cs-sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"path":"C:\\path\\to\\docs\\one-file.md"}'
```

### Poll job status

```bash
curl "http://127.0.0.1:23333/v1/knowledge-bases/jobs/<job-id>" \
  -H "Authorization: Bearer cs-sk-your-key"
```

Job responses include progress fields such as `progress`, `current_file`, `total_files`, and `processed_files` for directory jobs.

## Development

Run the focused tests for this feature:

```bash
corepack pnpm exec vitest run \
  src/main/services/__tests__/KnowledgeDirectoryIndexService.test.ts \
  src/main/services/__tests__/KnowledgeMaintenanceService.test.ts
```

The broader Cherry Studio development commands still apply:

```bash
corepack pnpm dev
corepack pnpm lint
corepack pnpm test
corepack pnpm format
```

## Notes and limitations

- Incremental refresh needs a sidecar index. Legacy directories may require one full refresh first.
- The API Server must be running and reachable from the machine executing the CLI.
- Write APIs require the same API key configured in Cherry Studio API Server settings.
- Directory sync matches knowledge bases by name when using `--config`.
- Local config files that contain private paths or API keys should not be committed.

## Upstream and license

This fork is based on [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio).

Cherry Studio Community Edition is licensed under AGPL-3.0. See [LICENSE](LICENSE) for details.
