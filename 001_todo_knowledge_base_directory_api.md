# 001 TODO: 知识库目录脚本/API 增删与刷新方案

- [001 TODO: 知识库目录脚本/API 增删与刷新方案](#001-todo-知识库目录脚本api-增删与刷新方案)
  - [实现状态](#实现状态)
  - [使用方法](#使用方法)
  - [结论](#结论)
  - [当前实现梳理](#当前实现梳理)
    - [1. 已有公开 HTTP API](#1-已有公开-http-api)
    - [2. UI 添加目录的现有路径](#2-ui-添加目录的现有路径)
    - [3. UI 刷新目录的现有路径](#3-ui-刷新目录的现有路径)
    - [4. 目录内单个文件为什么现在不能优雅刷新](#4-目录内单个文件为什么现在不能优雅刷新)
  - [推荐总体方案](#推荐总体方案)
    - [为什么走 HTTP API，而不是脚本直接调 Electron IPC](#为什么走-http-api而不是脚本直接调-electron-ipc)
  - [API 设计](#api-设计)
    - [1. 新增目录](#1-新增目录)
    - [2. 刷新目录 item](#2-刷新目录-item)
    - [3. 刷新目录中的单个文件](#3-刷新目录中的单个文件)
    - [4. 查询 job 状态](#4-查询-job-状态)
  - [目录文件索引设计](#目录文件索引设计)
  - [Main 侧服务设计](#main-侧服务设计)
  - [Handler/Validator 改动清单](#handlervalidator-改动清单)
    - [文件](#文件)
    - [Zod schema 草案](#zod-schema-草案)
  - [CLI 脚本设计](#cli-脚本设计)
  - [目录自动更新脚本](#目录自动更新脚本)
  - [安全与边界](#安全与边界)
  - [兼容性策略](#兼容性策略)
    - [现有目录 item](#现有目录-item)
    - [v2 数据层](#v2-数据层)
  - [测试计划](#测试计划)
    - [Unit tests](#unit-tests)
    - [Service tests](#service-tests)
    - [Manual verification](#manual-verification)
  - [实施顺序](#实施顺序)
  - [最小可交付版本](#最小可交付版本)


## 实现状态

已在分支 `codex/knowledge-directory-api-v1.9.11` 基于 `v1.9.11` 实现 MVP + 单文件刷新增强：

- 新增 `POST /v1/knowledge-bases/{id}/directories`
- 新增 `POST /v1/knowledge-bases/{id}/directories/{itemId}/refresh`
- 新增 `POST /v1/knowledge-bases/{id}/directories/{itemId}/files/refresh`
- 新增 `GET /v1/knowledge-bases/jobs/{jobId}`
- 新增 main 侧 `KnowledgeMaintenanceService`
- 新增 sidecar 目录文件索引 `knowledge_directory_index.json`
- `KnowledgeService.directoryTask()` 现在会额外返回目录内 `file path -> loader uniqueId` 映射
- 新增 CLI：`scripts/cherry-knowledge.ts`
- 已更新 OpenAPI spec
- 已增加 handler 与 sidecar index service 单测

验证记录：

- `corepack pnpm lint`：通过
- `corepack pnpm openapi:check`：通过
- 定向测试：`corepack pnpm exec vitest run --project main src/main/apiServer/routes/knowledge/__tests__/handlers.test.ts src/main/services/__tests__/KnowledgeDirectoryIndexService.test.ts`，18 tests 通过
- `corepack pnpm build`：通过
- Windows x64 portable：`dist/Cherry-Studio-1.9.11-x64-portable.exe`

备注：当前 Windows 环境下全量 `corepack pnpm test` 仍有既有测试失败，集中在 Windows 路径分隔符、symlink 权限、CherryClaw prompt mock 路径适配；本次新增知识库相关测试已通过。

## 使用方法

前提：

- Cherry Studio 主窗口需要打开；
- 设置里需要开启 API Server；
- 如果设置了 API Key，请在脚本里传 `--api-key`，或设置环境变量 `CHERRY_API_KEY`。

列出知识库：

```bash
pnpm tsx scripts/cherry-knowledge.ts list \
  --api http://127.0.0.1:23333 \
  --api-key <your-api-key>
```

给知识库新增目录并等待完成：

```bash
pnpm tsx scripts/cherry-knowledge.ts add-directory \
  --api http://127.0.0.1:23333 \
  --api-key <your-api-key> \
  --base <knowledge-base-id> \
  --path "C:\path\to\docs" \
  --wait
```

刷新整个目录 item：

```bash
pnpm tsx scripts/cherry-knowledge.ts refresh-directory \
  --api http://127.0.0.1:23333 \
  --api-key <your-api-key> \
  --base <knowledge-base-id> \
  --item <directory-item-id> \
  --wait
```

刷新目录中的单个文件：

```bash
pnpm tsx scripts/cherry-knowledge.ts refresh-file \
  --api http://127.0.0.1:23333 \
  --api-key <your-api-key> \
  --base <knowledge-base-id> \
  --directory-item <directory-item-id> \
  --file "C:\path\to\docs\one-file.md" \
  --wait
```

如果已有目录还没有文件级 sidecar 索引，第一次单文件刷新会返回 `FILE_INDEX_NOT_FOUND`。这时先执行一次整目录刷新，或使用：

```bash
pnpm tsx scripts/cherry-knowledge.ts refresh-file \
  --api http://127.0.0.1:23333 \
  --api-key <your-api-key> \
  --base <knowledge-base-id> \
  --directory-item <directory-item-id> \
  --file "C:\path\to\docs\one-file.md" \
  --fallback full-directory \
  --wait
```

直接调用 HTTP API 时，接口是：

```http
POST /v1/knowledge-bases/{id}/directories
POST /v1/knowledge-bases/{id}/directories/{itemId}/refresh
POST /v1/knowledge-bases/{id}/directories/{itemId}/files/refresh
GET  /v1/knowledge-bases/jobs/{jobId}
```

## 结论

可以做，但当前仓库里“稳定公开 API”只覆盖了知识库读取和搜索，还没有覆盖“新增目录、触发目录刷新、刷新目录中的单个文件”。

当前可复用的能力已经存在于内部链路：

- HTTP API 已有：
  - `GET /v1/knowledge-bases`
  - `GET /v1/knowledge-bases/:id`
  - `POST /v1/knowledge-bases/search`
- IPC 已有：
  - `knowledge-base:create`
  - `knowledge-base:add`
  - `knowledge-base:remove`
  - `knowledge-base:search`
  - `knowledge-base:rerank`
- UI 已有：
  - 添加目录：`useKnowledge().addDirectory()`
  - 刷新 item：`useKnowledge().refreshItem()`
  - 处理队列：`KnowledgeQueue.checkAllBases()`
- Main 已有：
  - `KnowledgeService.add()` 支持 `item.type === 'directory'`
  - `KnowledgeService.directoryTask()` 会递归目录并逐文件调用 `addFileLoader()`

所以建议新增一层正式的本地 HTTP API + CLI 脚本，复用现有 `KnowledgeService`，不要让脚本直接改 Redux/IndexedDB/向量库文件。直接改本地持久化数据虽然能“黑进去”，但容易破坏 `uniqueIds`、处理状态、向量库一致性，后面维护会很疼。

## 当前实现梳理

### 1. 已有公开 HTTP API

位置：

- `src/main/apiServer/routes/knowledge/index.ts`
- `src/main/apiServer/routes/knowledge/handlers.ts`
- `src/main/apiServer/routes/knowledge/validators/zodSchemas.ts`

现有能力：

```http
GET /v1/knowledge-bases
GET /v1/knowledge-bases/{id}
POST /v1/knowledge-bases/search
```

限制：

- 没有 `POST /v1/knowledge-bases/:id/directories`
- 没有 `POST /v1/knowledge-bases/:id/items/:itemId/refresh`
- 没有目录内单文件刷新接口
- 现有 handlers 读取 `state.knowledge.bases` 依赖 renderer Redux，Cherry Studio 主窗口不可用时会返回 503

### 2. UI 添加目录的现有路径

相关位置：

- `src/renderer/src/pages/knowledge/items/KnowledgeDirectories.tsx`
- `src/renderer/src/hooks/useKnowledge.ts`
- `src/renderer/src/store/thunk/knowledgeThunk.ts`
- `src/renderer/src/queue/KnowledgeQueue.ts`
- `src/main/services/KnowledgeService.ts`

调用链：

```text
KnowledgeDirectories.handleAddDirectory()
  -> window.api.file.selectFolder()
  -> useKnowledge.addDirectory(path)
  -> dispatch(addItemThunk(baseId, 'directory', path))
  -> KnowledgeQueue.checkAllBases()
  -> KnowledgeQueue.processItem()
  -> window.api.knowledgeBase.add({ base, item })
  -> KnowledgeService.add()
  -> KnowledgeService.directoryTask()
  -> getAllFiles(directory)
  -> addFileLoader(ragApplication, file, base, forceReload)
```

### 3. UI 刷新目录的现有路径

`useKnowledge().refreshItem(item)` 会：

1. 用 `item.uniqueIds` 调 `window.api.knowledgeBase.remove()` 删除旧 loader；
2. 把 item 状态改回 `pending`；
3. 再触发 `KnowledgeQueue.checkAllBases()`；
4. 队列重新执行 `KnowledgeService.add()`。

注意：当前 `refreshItem()` 里有两段非常相似的 remove + update + check 逻辑，后续实现 API 时不要照抄重复调用，建议整理成一个可复用 helper。

### 4. 目录内单个文件为什么现在不能优雅刷新

现在目录作为一个 `KnowledgeItem` 存在：

```ts
{
  id: string,
  type: 'directory',
  content: string,
  uniqueId?: string,
  uniqueIds?: string[]
}
```

`KnowledgeService.directoryTask()` 对目录下每个文件分别 `addFileLoader()`，最后只把所有 loader 的 `uniqueId` 汇总到 `uniqueIds`。但是它没有保存：

```text
目录内文件路径 -> loader uniqueId
```

因此：

- 刷新整个目录：可行，删除 `uniqueIds` 全部重建。
- 刷新目录内某一个文件：缺少稳定映射，不能只删旧文件对应 loader。

要支持“单文件更新”，需要补一个文件级索引映射。推荐用 sidecar 索引文件或后续 v2 数据表，不建议塞进当前 Redux state shape，因为 `src/renderer/src/store/knowledge.ts` 明确处于 v2 refactor blocking 状态。

## 推荐总体方案

分两期做：

1. MVP：新增正式 HTTP API 和脚本，支持新增目录、刷新整个目录。
2. 增强：补目录文件索引，支持目录内单文件增量刷新/删除/新增。

### 为什么走 HTTP API，而不是脚本直接调 Electron IPC

脚本直接调 IPC 需要跑在 renderer/preload 环境里，外部 PowerShell/Node 脚本无法稳定访问 `window.api.knowledgeBase.*`。

脚本直接改 Redux persist/LevelDB/向量 SQLite 也不稳，因为要同时维护：

- Redux `state.knowledge.bases`
- `KnowledgeItem.processingStatus`
- `KnowledgeItem.uniqueId`
- `KnowledgeItem.uniqueIds`
- embedjs/libsql 向量库
- renderer 队列状态

HTTP API 已经是项目里给脚本/外部工具用的边界，应该把目录维护能力补到这里。

## API 设计

### 1. 新增目录

```http
POST /v1/knowledge-bases/{baseId}/directories
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "path": "Z:\\007 Podcasts\\_cherry_knowledge_inputs\\preferred\\general\\津津有味",
  "mode": "enqueue",
  "refresh_if_exists": false
}
```

建议响应：

```json
{
  "job_id": "kbjob_...",
  "knowledge_base_id": "YeQe0FgTB4IdThYFGtDO7",
  "item_id": "5d7a...",
  "status": "queued"
}
```

行为：

- 校验 `baseId` 存在；
- 校验 `path` 存在且是目录；
- 如果目录已存在：
  - `refresh_if_exists=false`：返回 409；
  - `refresh_if_exists=true`：转成刷新目录任务；
- 创建 `KnowledgeItem`：

```ts
{
  id: uuidv4(),
  type: 'directory',
  content: path,
  created_at: Date.now(),
  updated_at: Date.now(),
  processingStatus: 'pending',
  processingProgress: 0,
  processingError: '',
  retryCount: 0
}
```

- 通过 `reduxService.dispatch({ type: 'knowledge/addItem', payload: { baseId, item } })` 让 UI/持久化状态可见；
- 后台 job 调 `KnowledgeService.add({ base: params, item })`；
- 完成后 dispatch：
  - `knowledge/updateItemProcessingStatus`
  - `knowledge/updateBaseItemUniqueId`

### 2. 刷新目录 item

```http
POST /v1/knowledge-bases/{baseId}/directories/{itemId}/refresh
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "mode": "full"
}
```

`mode` 建议支持：

- `full`：删除该目录 item 的全部 `uniqueIds`，重新索引整个目录。
- `incremental`：后续增强模式，基于 sidecar 文件索引只处理新增/修改/删除的文件。

MVP 先实现 `full`。

行为：

1. 查找 base 和 item；
2. 确认 `item.type === 'directory'`；
3. 如果 item 正在 `pending/processing`，返回 409 或返回已有 job；
4. 若 `item.uniqueIds` 存在：
   - 调 `KnowledgeService.remove({ uniqueId: item.uniqueId, uniqueIds: item.uniqueIds, base })`
5. dispatch item 状态为 `pending`；
6. 后台 job 调 `KnowledgeService.add({ base, item: updatedItem, forceReload: true })`；
7. 更新 `uniqueId/uniqueIds` 和状态。

建议响应：

```json
{
  "job_id": "kbjob_...",
  "knowledge_base_id": "YeQe0FgTB4IdThYFGtDO7",
  "item_id": "5d7a...",
  "status": "queued"
}
```

### 3. 刷新目录中的单个文件

```http
POST /v1/knowledge-bases/{baseId}/directories/{itemId}/files/refresh
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "path": "Z:\\007 Podcasts\\_cherry_knowledge_inputs\\preferred\\general\\津津有味\\episode-001.md",
  "fallback": "error"
}
```

`fallback` 建议支持：

- `error`：如果没有文件级 uniqueId 映射，返回 409。
- `full-directory`：如果没有映射，自动退化为刷新整个目录。

行为：

1. 查找 base 和 directory item；
2. 校验文件存在；
3. 校验文件路径在目录 item 的 root 下，防止拿目录接口读任意路径：

```ts
const relative = path.relative(directoryRoot, filePath)
if (relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('File is outside of the directory item')
}
```

4. 从目录文件索引查找旧 loader uniqueId；
5. 如果找到了旧 uniqueId：
   - `KnowledgeService.remove({ uniqueIds: [oldUniqueId], ... })`
6. 构造临时 `KnowledgeItem`：

```ts
{
  id: `dir-file:${directoryItemId}:${hash(filePath)}`,
  type: 'file',
  content: fileMetadata,
  created_at: Date.now(),
  updated_at: Date.now()
}
```

7. 调 `KnowledgeService.add({ base, item: fileItem, forceReload: true })`；
8. 更新 sidecar 文件索引：
   - file path
   - uniqueId
   - size
   - mtimeMs
   - optional hash
9. 更新目录 item 的 `uniqueIds`：
   - 删除旧 uniqueId；
   - 加入新 uniqueId；
   - dispatch `knowledge/updateBaseItemUniqueId`

建议响应：

```json
{
  "job_id": "kbjob_...",
  "knowledge_base_id": "YeQe0FgTB4IdThYFGtDO7",
  "directory_item_id": "5d7a...",
  "file_path": "Z:\\...\\episode-001.md",
  "status": "queued"
}
```

### 4. 查询 job 状态

```http
GET /v1/knowledge-bases/jobs/{jobId}
Authorization: Bearer <api-key>
```

响应：

```json
{
  "id": "kbjob_...",
  "operation": "refresh_directory",
  "knowledge_base_id": "YeQe0FgTB4IdThYFGtDO7",
  "item_id": "5d7a...",
  "status": "running",
  "progress": 42,
  "created_at": 1782820000000,
  "updated_at": 1782820012345,
  "error": null
}
```

状态枚举：

```ts
type KnowledgeJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
```

MVP 可以先做内存 job registry；后续如果要跨重启恢复，再持久化到 `Data/KnowledgeBase/knowledge_jobs.json` 或 v2 SQLite 表。

## 目录文件索引设计

为了不改当前 Redux state shape，推荐加 sidecar 文件：

```text
{userData}/Data/KnowledgeBase/knowledge_directory_index.json
```

结构：

```json
{
  "YeQe0FgTB4IdThYFGtDO7": {
    "directoryItemId": {
      "root": "Z:\\007 Podcasts\\_cherry_knowledge_inputs\\preferred\\general\\津津有味",
      "files": {
        "Z:\\...\\episode-001.md": {
          "uniqueId": "LocalPathLoader_xxx",
          "size": 123456,
          "mtimeMs": 1782820000000,
          "ext": ".md",
          "lastIndexedAt": 1782820012345
        }
      }
    }
  }
}
```

实现位置建议：

- `src/main/services/KnowledgeDirectoryIndexService.ts`

职责：

- `load()`
- `save()`
- `getFile(baseId, itemId, filePath)`
- `upsertFile(baseId, itemId, filePath, record)`
- `removeFile(baseId, itemId, filePath)`
- `replaceDirectory(baseId, itemId, root, records)`
- `removeDirectory(baseId, itemId)`

写文件时应使用原子写或现有 write lock 工具，避免多个 job 并发时覆盖。

## Main 侧服务设计

新增服务：

```text
src/main/services/KnowledgeMaintenanceService.ts
```

职责：

1. 从 Redux 读取 base；
2. 复用或抽出 `getKnowledgeBaseParams()`；
3. 生成 `KnowledgeItem`；
4. dispatch Redux action；
5. 调 `KnowledgeService.add/remove()`；
6. 管理 job 状态；
7. 维护目录文件索引；
8. 提供 handler 可直接调用的方法。

建议方法：

```ts
class KnowledgeMaintenanceService {
  addDirectory(baseId: string, directoryPath: string, options: AddDirectoryOptions): Promise<KnowledgeJob>
  refreshDirectory(baseId: string, itemId: string, options: RefreshDirectoryOptions): Promise<KnowledgeJob>
  refreshDirectoryFile(baseId: string, itemId: string, filePath: string, options: RefreshFileOptions): Promise<KnowledgeJob>
  getJob(jobId: string): KnowledgeJob | null
}
```

`src/main/apiServer/routes/knowledge/handlers.ts` 里当前有一个 private `getKnowledgeBaseParams(base)`。为了新增接口复用，建议移动到：

```text
src/main/services/KnowledgeBaseParamsResolver.ts
```

或者至少导出 helper，避免 copy/paste。

## Handler/Validator 改动清单

### 文件

- `src/main/apiServer/routes/knowledge/index.ts`
  - 增加 Swagger/OpenAPI docs；
  - 增加新 route。
- `src/main/apiServer/routes/knowledge/handlers.ts`
  - 增加 `addDirectory`
  - 增加 `refreshDirectory`
  - 增加 `refreshDirectoryFile`
  - 增加 `getKnowledgeJob`
- `src/main/apiServer/routes/knowledge/validators/zodSchemas.ts`
  - 增加 schema。
- `src/main/apiServer/routes/knowledge/validators/index.ts`
  - 导出 validator。
- `src/main/apiServer/generated/openapi-spec.json`
  - 跑生成脚本更新。

### Zod schema 草案

```ts
export const KnowledgeDirectoryPathSchema = z.object({
  path: z.string().min(1),
  mode: z.enum(['enqueue', 'sync']).default('enqueue').optional(),
  refresh_if_exists: z.boolean().default(false).optional()
})

export const KnowledgeDirectoryRefreshSchema = z.object({
  mode: z.enum(['full', 'incremental']).default('full').optional()
})

export const KnowledgeDirectoryFileRefreshSchema = z.object({
  path: z.string().min(1),
  fallback: z.enum(['error', 'full-directory']).default('error').optional()
})

export const KnowledgeDirectoryItemParamSchema = z.object({
  id: KnowledgeBaseIdSchema,
  itemId: z.string().min(1)
})

export const KnowledgeJobParamSchema = z.object({
  jobId: z.string().min(1)
})
```

## CLI 脚本设计

新增脚本：

```text
scripts/cherry-knowledge.ts
```

或 Windows 优先：

```text
scripts/cherry-knowledge.ps1
```

推荐 TypeScript 脚本，因为项目已有 `tsx` 脚本模式，跨平台更好。

命令：

```bash
pnpm tsx scripts/cherry-knowledge.ts list

pnpm tsx scripts/cherry-knowledge.ts add-directory \
  --api http://127.0.0.1:23333 \
  --base YeQe0FgTB4IdThYFGtDO7 \
  --path "Z:\007 Podcasts\_cherry_knowledge_inputs\preferred\general\津津有味" \
  --wait

pnpm tsx scripts/cherry-knowledge.ts refresh-directory \
  --base YeQe0FgTB4IdThYFGtDO7 \
  --item 5d7a... \
  --mode full \
  --wait

pnpm tsx scripts/cherry-knowledge.ts refresh-file \
  --base YeQe0FgTB4IdThYFGtDO7 \
  --directory-item 5d7a... \
  --file "Z:\...\episode-001.md" \
  --wait
```

认证：

- 优先读 `CHERRY_API_KEY`
- 支持 `--api-key`
- 可选复用 `scripts/check-cherry-knowledge-index.ps1` 中的本地配置解析逻辑，但写操作脚本必须要求显式确认或显式 API key，避免误操作。

## 目录自动更新脚本

如果目标是“目录中某个文件变了就自动更新知识库”，建议不把 watcher 放进 Cherry Studio 主进程第一版，而是先用脚本监听文件变化再调 API。

后续可新增：

```bash
pnpm tsx scripts/watch-knowledge-directory.ts \
  --base YeQe0FgTB4IdThYFGtDO7 \
  --directory-item 5d7a... \
  --path "Z:\007 Podcasts\_cherry_knowledge_inputs\preferred\general\津津有味"
```

行为：

- `add/change`：调用 refresh-file；
- `unlink`：调用 delete-file endpoint（可作为后续补充）；
- debounce 1-3 秒；
- 多个变化合并成批处理。

如果要补删除接口：

```http
DELETE /v1/knowledge-bases/{baseId}/directories/{itemId}/files
Content-Type: application/json

{
  "path": "Z:\\...\\episode-001.md"
}
```

## 安全与边界

这些接口本质上允许通过 API 读取本机目录并发送给 embedding provider，所以安全上要偏保守：

- 必须走现有 `authMiddleware`；
- 不在日志里打印 API key、embedding base params；
- 目录和文件路径必须存在；
- 单文件必须在目录 item root 下面；
- 对 UNC/network path 给出清晰错误或显式允许；
- 同一个 base/item 同时只允许一个 refresh job；
- 大目录默认异步执行，避免 HTTP timeout；
- 返回结果不要包含文件正文；
- CORS 当前是 `origin: '*'`，写接口要特别依赖 API key，不要加免鉴权快捷路径。

## 兼容性策略

### 现有目录 item

已有目录 item 没有 sidecar 文件索引，因此单文件刷新第一次可能无法精准删除旧 loader。

建议策略：

1. `refresh-file fallback=error`：返回 409，提示先跑一次 full refresh 以生成索引；
2. `refresh-file fallback=full-directory`：自动退化为 full refresh；
3. 新增 `POST /v1/knowledge-bases/{baseId}/directories/{itemId}/rebuild-index` 可作为后续优化：
   - 优先从向量库 `vectors.source` / `metadata.source` / `metadata.originalPath` 尝试重建；
   - 无法可靠映射 uniqueId 时仍提示 full refresh。

### v2 数据层

代码里多处 TODO 提到知识库仍依赖 Redux，未来会迁到 v2 SQLite/Drizzle。为了减少冲突：

- MVP 不改 `KnowledgeState`；
- 文件级映射先放 sidecar；
- 所有新增服务都放 main process；
- handler 通过服务层隔离 Redux 依赖；
- v2 到来后只替换 `KnowledgeMaintenanceService` 的 storage adapter。

## 测试计划

### Unit tests

更新：

- `src/main/apiServer/routes/knowledge/__tests__/handlers.test.ts`

新增覆盖：

- 添加目录成功返回 202；
- base 不存在返回 404；
- path 不存在返回 400；
- path 不是目录返回 400；
- 重复目录且 `refresh_if_exists=false` 返回 409；
- refresh directory item 成功排队；
- item 不存在返回 404；
- item 不是 directory 返回 400；
- refresh-file 文件不在目录 root 下返回 400；
- refresh-file 没有 sidecar 映射且 fallback=error 返回 409；
- Redux 不可用返回 503。

### Service tests

新增：

- `src/main/services/__tests__/KnowledgeMaintenanceService.test.ts`
- `src/main/services/__tests__/KnowledgeDirectoryIndexService.test.ts`

覆盖：

- sidecar load/save/upsert/remove；
- full refresh 删除旧 uniqueIds 后写入新 uniqueIds；
- refresh-file 替换单个 uniqueId；
- job 状态从 queued -> running -> completed/failed；
- 并发同 base/item refresh 被拒绝或复用 existing job。

### Manual verification

1. 启动 Cherry Studio；
2. 开启 API Server；
3. `GET /v1/knowledge-bases` 找到 base；
4. 用 CLI 添加一个小测试目录；
5. 等 job 完成；
6. 用 `POST /v1/knowledge-bases/search` 搜索测试内容；
7. 修改目录内单个文件；
8. 调 `refresh-file --wait`；
9. 再搜索，确认旧内容消失、新内容出现。

## 实施顺序

- [ ] 抽出 main 侧 `KnowledgeBaseParamsResolver`，复用现有 search helper。
- [ ] 新增 `KnowledgeMaintenanceService`，先支持 add-directory 和 full refresh-directory。
- [ ] 新增 knowledge route validators/handlers/OpenAPI。
- [ ] 新增 handler/service 单测。
- [ ] 新增 `scripts/cherry-knowledge.ts`，支持 list/add-directory/refresh-directory/job status。
- [ ] 手动验证小目录。
- [ ] 新增 `KnowledgeDirectoryIndexService` sidecar。
- [ ] 修改 `KnowledgeService.directoryTask()` 或新增 main 侧目录索引流程，让目录处理结果带出 file path -> uniqueId 映射。
- [ ] 新增 refresh-file API。
- [ ] 新增 watcher 脚本或批量 refresh-file 脚本。
- [ ] 跑 `pnpm lint`、`pnpm test`、`pnpm format`。

## 最小可交付版本

如果只想尽快让脚本能用，最小版本可以先做这三个接口：

```http
POST /v1/knowledge-bases/{baseId}/directories
POST /v1/knowledge-bases/{baseId}/directories/{itemId}/refresh
GET  /v1/knowledge-bases/jobs/{jobId}
```

这能解决：

- 脚本给知识库新增目录；
- 脚本触发整个目录更新；
- 脚本等待更新完成。

单文件更新放第二步，因为它需要文件级 uniqueId 映射，否则只能退化成整目录重建。
