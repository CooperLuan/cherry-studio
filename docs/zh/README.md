# Cherry Studio 知识库自动化 Fork

这个仓库是 Cherry Studio 的一个 fork，重点是让大型本地知识库可以长期、低成本地维护。

当前分支的主要改进：

- 为 Cherry Studio 知识库增加目录级增量刷新
- 新增知识库维护 API：添加目录、刷新目录、刷新单个文件、查询任务状态
- 增加文件级 sidecar 索引与内容哈希，避免重复 embedding 未变化文件
- 提供 CLI 工具，用于把本地文件夹批量同步到 Cherry Studio 知识库
- 为长时间运行的目录索引任务提供更清晰的进度信息
- 为新增维护接口补充 OpenAPI 文档

本项目仍然基于上游 [Cherry Studio](https://github.com/CherryHQ/cherry-studio)：一个跨平台桌面 AI 客户端，支持多模型服务商、智能助手、文档处理、MCP 集成和知识库搜索。

## 知识库相关改动

### 目录增量索引

Cherry Studio 现在可以为目录型知识库条目维护文件级 sidecar 索引。目录具备 sidecar 索引后，刷新任务会根据路径、大小、扩展名、mtime 和内容哈希判断文件是否变化。

因此一次刷新只会处理：

- 新增文件
- 修改过的文件
- 已删除、需要移除 loader 的文件

未变化文件会保留原有 loader ID，不会再次 embedding。

### 知识库维护 API

本地 API Server 新增了写操作维护接口：

```http
POST /v1/knowledge-bases/{id}/directories
POST /v1/knowledge-bases/{id}/directories/{itemId}/refresh
POST /v1/knowledge-bases/{id}/directories/{itemId}/files/refresh
GET  /v1/knowledge-bases/jobs/{jobId}
```

这些接口主要面向本地自动化脚本、定时任务和个人知识摄取流水线。

### CLI 同步流程

`scripts/cherry-knowledge.ts` CLI helper 支持：

- 列出知识库
- 给知识库添加目录
- 刷新整个目录
- 刷新目录中的单个文件
- 从 YAML/JSON 配置批量同步多个目录
- 等待任务完成并打印进度

## 前置条件

1. 打开 Cherry Studio。
2. 在 Cherry Studio 设置中启用本地 API Server。
3. 如果 API Server 开启了鉴权，请准备好 API key。
4. 安装仓库依赖：

```bash
corepack pnpm install
```

默认本地 API 地址：

```text
http://127.0.0.1:23333
```

可以用环境变量覆盖：

```bash
CHERRY_KB_API_BASE=http://127.0.0.1:23333
```

或：

```bash
CHERRY_API_BASE=http://127.0.0.1:23333
```

## 鉴权

直接传 API key：

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts list \
  --api-key cs-sk-your-key
```

或把 key 存到文件里：

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts list \
  --api-key-file ~/.cherry-api-key
```

Windows 上也可以使用：

```powershell
corepack pnpm exec tsx scripts/cherry-knowledge.ts list `
  --api-key-file "$env:USERPROFILE\.cherry-api-key"
```

key 文件支持这些简单格式：

```text
cs-sk-your-key
```

```text
Bearer cs-sk-your-key
```

```text
CHERRY_API_KEY=cs-sk-your-key
```

## CLI 用法

### 列出知识库

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts list \
  --api http://127.0.0.1:23333 \
  --api-key-file ~/.cherry-api-key
```

### 给知识库添加目录

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts add-directory \
  --api http://127.0.0.1:23333 \
  --api-key-file ~/.cherry-api-key \
  --base <knowledge-base-id> \
  --path "C:\path\to\docs" \
  --wait
```

添加新目录时会执行索引，并创建后续增量刷新所需的 sidecar 文件索引。

### 刷新已有目录

全量刷新：

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts refresh-directory \
  --api-key-file ~/.cherry-api-key \
  --base <knowledge-base-id> \
  --item <directory-item-id> \
  --mode full \
  --wait
```

增量刷新：

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts refresh-directory \
  --api-key-file ~/.cherry-api-key \
  --base <knowledge-base-id> \
  --item <directory-item-id> \
  --mode incremental \
  --wait
```

如果旧目录还没有 sidecar 索引，增量刷新会返回明确错误。先对该目录执行一次全量刷新建立基线，之后就可以使用增量刷新。

### 刷新目录中的单个文件

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts refresh-file \
  --api-key-file ~/.cherry-api-key \
  --base <knowledge-base-id> \
  --directory-item <directory-item-id> \
  --file "C:\path\to\docs\one-file.md" \
  --wait
```

如果该文件已存在于 sidecar 索引中，会先移除旧 loader，再重新 embedding 该文件。如果它是新文件，则会作为新文件加入目录条目。

### 查询任务状态

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts job \
  --api-key-file ~/.cherry-api-key \
  --job <job-id>
```

## 从配置批量同步目录

创建一个 YAML 文件，把知识库名称映射到本地目录：

```yaml
Research:
  - 'C:\Knowledge\papers'
  - 'C:\Knowledge\notes'
Podcasts:
  - 'D:\Transcripts\tech'
  - 'D:\Transcripts\health'
```

然后运行：

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts sync-directories \
  --api-key-file ~/.cherry-api-key \
  --config kb-dirs.yaml \
  --wait
```

默认情况下，已有目录会跳过，只会添加尚未绑定的目录。

如果也要刷新配置里的已有目录：

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts sync-directories \
  --api-key-file ~/.cherry-api-key \
  --config kb-dirs.yaml \
  --refresh-existing \
  --wait
```

如果要对已有目录执行严格增量同步：

```bash
corepack pnpm exec tsx scripts/cherry-knowledge.ts sync-directories \
  --api-key-file ~/.cherry-api-key \
  --config kb-dirs.yaml \
  --refresh-existing \
  --mode incremental \
  --wait
```

这个模式适合自动化任务：当旧目录缺少 sidecar 索引时，它不会静默 fallback 到全量重嵌入，而是直接失败并提示你先建立基线。

## 推荐自动化流程

对于大型个人知识库，推荐这样跑：

1. 先运行 `sync-directories --config kb-dirs.yaml --wait`，添加还没绑定过的目录。
2. 再运行 `sync-directories --config kb-dirs.yaml --refresh-existing --mode incremental --wait`，处理已有目录中的新增、修改和删除文件。
3. 如果某个旧目录因为没有 sidecar 索引而失败，对该目录执行一次全量刷新，之后继续使用增量模式。

## API 示例

### 添加目录

```bash
curl -X POST "http://127.0.0.1:23333/v1/knowledge-bases/<base-id>/directories" \
  -H "Authorization: Bearer cs-sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"path":"C:\\path\\to\\docs","mode":"enqueue","refresh_if_exists":false}'
```

### 增量刷新目录

```bash
curl -X POST "http://127.0.0.1:23333/v1/knowledge-bases/<base-id>/directories/<item-id>/refresh" \
  -H "Authorization: Bearer cs-sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"mode":"incremental"}'
```

### 刷新单个文件

```bash
curl -X POST "http://127.0.0.1:23333/v1/knowledge-bases/<base-id>/directories/<item-id>/files/refresh" \
  -H "Authorization: Bearer cs-sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"path":"C:\\path\\to\\docs\\one-file.md"}'
```

### 查询任务状态

```bash
curl "http://127.0.0.1:23333/v1/knowledge-bases/jobs/<job-id>" \
  -H "Authorization: Bearer cs-sk-your-key"
```

目录任务的响应里会包含 `progress`、`current_file`、`total_files`、`processed_files` 等进度字段。

## 开发

运行本功能相关的定向测试：

```bash
corepack pnpm exec vitest run \
  src/main/services/__tests__/KnowledgeDirectoryIndexService.test.ts \
  src/main/services/__tests__/KnowledgeMaintenanceService.test.ts
```

其他 Cherry Studio 常用开发命令仍然适用：

```bash
corepack pnpm dev
corepack pnpm lint
corepack pnpm test
corepack pnpm format
```

## 注意事项和限制

- 增量刷新需要 sidecar 索引；旧目录可能需要先全量刷新一次。
- 执行 CLI 的机器必须能访问正在运行的 API Server。
- 写操作 API 使用 Cherry Studio API Server 设置里的同一个 API key。
- 使用 `--config` 时，目录同步会按知识库名称匹配。
- 包含私有路径或 API key 的本地配置文件不要提交到仓库。

## 上游与许可证

本 fork 基于 [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio)。

Cherry Studio Community Edition 使用 AGPL-3.0 许可证。详见 [LICENSE](../../LICENSE)。
