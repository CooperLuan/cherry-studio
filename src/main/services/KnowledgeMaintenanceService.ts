import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import {
  getKnowledgeBaseFromRedux,
  getKnowledgeBaseParams,
  isReduxUnavailableError
} from '@main/services/KnowledgeBaseParamsResolver'
import KnowledgeDirectoryIndexService, {
  type KnowledgeDirectoryFileRecord
} from '@main/services/KnowledgeDirectoryIndexService'
import KnowledgeService from '@main/services/KnowledgeService'
import { reduxService } from '@main/services/ReduxService'
import { getAllFiles, getFileType, isPathInside } from '@main/utils/file'
import type { LoaderReturn } from '@shared/config/types'
import { FILE_TYPE, type FileMetadata, type KnowledgeBase, type KnowledgeItem } from '@types'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('KnowledgeMaintenanceService')

type KnowledgeJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
type KnowledgeJobOperation = 'add_directory' | 'refresh_directory' | 'refresh_directory_file'

type AddDirectoryMode = 'enqueue' | 'sync'
type RefreshDirectoryMode = 'full' | 'incremental'
type RefreshFileFallback = 'error' | 'full-directory'

export interface AddDirectoryOptions {
  mode?: AddDirectoryMode
  refresh_if_exists?: boolean
}

export interface RefreshDirectoryOptions {
  mode?: RefreshDirectoryMode
}

export interface RefreshDirectoryFileOptions {
  fallback?: RefreshFileFallback
}

export interface KnowledgeJob {
  id: string
  operation: KnowledgeJobOperation
  knowledge_base_id: string
  item_id?: string
  directory_item_id?: string
  file_path?: string
  current_file?: string | null
  total_files?: number
  processed_files?: number
  status: KnowledgeJobStatus
  progress: number
  created_at: number
  updated_at: number
  error: string | null
}

interface DirectoryLoaderReturn extends LoaderReturn {
  fileUniqueIds?: Record<string, string>
}

interface FileIndexSidecarUpdate {
  filePath: string
  oldKey?: string
  record: KnowledgeDirectoryFileRecord
}

export class KnowledgeMaintenanceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly type = 'invalid_request_error'
  ) {
    super(message)
    this.name = 'KnowledgeMaintenanceError'
  }
}

class KnowledgeMaintenanceService {
  private readonly jobs = new Map<string, KnowledgeJob>()
  private readonly jobPromises = new Map<string, Promise<KnowledgeJob>>()
  private readonly activeJobsByTarget = new Map<string, string>()

  public async addDirectory(
    baseId: string,
    directoryPath: string,
    options: AddDirectoryOptions = {}
  ): Promise<KnowledgeJob> {
    const base = await this.getBaseOrThrow(baseId)
    const resolvedDirectoryPath = await this.assertDirectoryPath(directoryPath)
    const existingItem = await this.findDirectoryItemByPath(base, resolvedDirectoryPath)

    if (existingItem) {
      if (options.refresh_if_exists) {
        return this.refreshDirectory(baseId, existingItem.id, { mode: 'full' })
      }

      throw new KnowledgeMaintenanceError(
        409,
        'DIRECTORY_ALREADY_EXISTS',
        `Directory already exists in knowledge base: ${resolvedDirectoryPath}`
      )
    }

    const item: KnowledgeItem = {
      id: uuidv4(),
      type: 'directory',
      content: resolvedDirectoryPath,
      created_at: Date.now(),
      updated_at: Date.now(),
      processingStatus: 'pending',
      processingProgress: 0,
      processingError: '',
      retryCount: 0
    }

    await this.dispatchOrServiceUnavailable({
      type: 'knowledge/addItem',
      payload: { baseId, item }
    })

    return this.enqueueJob(
      {
        operation: 'add_directory',
        knowledge_base_id: baseId,
        item_id: item.id,
        directory_item_id: item.id
      },
      this.getDirectoryTargetKey(baseId, item.id),
      async (job) => this.runDirectoryAddJob(job, base, item, false)
    )
  }

  public async refreshDirectory(
    baseId: string,
    itemId: string,
    options: RefreshDirectoryOptions = {}
  ): Promise<KnowledgeJob> {
    const { base, item } = await this.getDirectoryItemOrThrow(baseId, itemId)
    await this.assertDirectoryPath(item.content as string)
    await this.dispatchProcessingStatus(baseId, itemId, 'pending', 0)
    const mode = options.mode ?? 'full'

    return this.enqueueJob(
      {
        operation: 'refresh_directory',
        knowledge_base_id: baseId,
        item_id: itemId,
        directory_item_id: itemId
      },
      this.getDirectoryTargetKey(baseId, itemId),
      async (job) =>
        mode === 'incremental'
          ? this.runDirectoryIncrementalRefreshJob(job, base, item)
          : this.runDirectoryRefreshJob(job, base, item)
    )
  }

  public async refreshDirectoryFile(
    baseId: string,
    itemId: string,
    filePath: string,
    _options: RefreshDirectoryFileOptions = {}
  ): Promise<KnowledgeJob> {
    void _options

    const { base, item } = await this.getDirectoryItemOrThrow(baseId, itemId)
    const directoryPath = await this.assertDirectoryPath(item.content as string)
    const resolvedFilePath = await this.assertFilePath(filePath)

    if (!(await this.isPathInsideDirectory(resolvedFilePath, directoryPath))) {
      throw new KnowledgeMaintenanceError(
        400,
        'FILE_OUTSIDE_DIRECTORY',
        'File must be inside the directory knowledge item'
      )
    }

    const existingRecord = await KnowledgeDirectoryIndexService.getFile(baseId, itemId, resolvedFilePath)

    return this.enqueueJob(
      {
        operation: 'refresh_directory_file',
        knowledge_base_id: baseId,
        item_id: itemId,
        directory_item_id: itemId,
        file_path: resolvedFilePath
      },
      this.getDirectoryTargetKey(baseId, itemId),
      async (job) => this.runDirectoryFileRefreshJob(job, base, item, resolvedFilePath, existingRecord)
    )
  }

  public getJob(jobId: string): KnowledgeJob | null {
    const job = this.jobs.get(jobId)
    return job ? { ...job } : null
  }

  public async waitForJob(jobId: string): Promise<KnowledgeJob | null> {
    const promise = this.jobPromises.get(jobId)
    if (!promise) {
      return this.getJob(jobId)
    }

    return promise
  }

  private enqueueJob(
    jobInput: Pick<KnowledgeJob, 'operation' | 'knowledge_base_id'> &
      Partial<Pick<KnowledgeJob, 'item_id' | 'directory_item_id' | 'file_path'>>,
    targetKey: string,
    runner: (job: KnowledgeJob) => Promise<void>
  ): KnowledgeJob {
    const activeJobId = this.activeJobsByTarget.get(targetKey)
    const activeJob = activeJobId ? this.jobs.get(activeJobId) : null
    if (activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')) {
      throw new KnowledgeMaintenanceError(
        409,
        'KNOWLEDGE_JOB_ALREADY_RUNNING',
        `A knowledge maintenance job is already running for this directory item: ${activeJob.id}`
      )
    }

    const now = Date.now()
    const job: KnowledgeJob = {
      id: `kbjob_${uuidv4()}`,
      operation: jobInput.operation,
      knowledge_base_id: jobInput.knowledge_base_id,
      item_id: jobInput.item_id,
      directory_item_id: jobInput.directory_item_id,
      file_path: jobInput.file_path,
      status: 'queued',
      progress: 0,
      created_at: now,
      updated_at: now,
      error: null
    }

    this.jobs.set(job.id, job)
    this.activeJobsByTarget.set(targetKey, job.id)

    const promise = Promise.resolve().then(() => this.executeJob(job, targetKey, runner))
    this.jobPromises.set(job.id, promise)

    return { ...job }
  }

  private async executeJob(
    job: KnowledgeJob,
    targetKey: string,
    runner: (job: KnowledgeJob) => Promise<void>
  ): Promise<KnowledgeJob> {
    try {
      this.updateJob(job, { status: 'running', progress: 5 })
      await runner(job)
      this.updateJob(job, { status: 'completed', progress: 100, current_file: null, error: null })
    } catch (error) {
      logger.error(`Knowledge job failed: ${job.id}`, error as Error)
      this.updateJob(job, {
        status: 'failed',
        error: (error as Error).message || 'Knowledge job failed'
      })
      await this.markItemFailed(job, error as Error)
    } finally {
      this.activeJobsByTarget.delete(targetKey)
    }

    return { ...job }
  }

  private async runDirectoryAddJob(
    job: KnowledgeJob,
    base: KnowledgeBase,
    item: KnowledgeItem,
    forceReload: boolean
  ): Promise<void> {
    await this.dispatchProcessingStatus(base.id, item.id, 'processing', 5)
    const result = await this.addDirectoryItem(base, item, forceReload, job)
    await this.persistDirectoryResult(base.id, item, result)
    await this.dispatchProcessingStatus(base.id, item.id, 'completed', 100)
    this.updateJob(job, { progress: 100 })
  }

  private async runDirectoryRefreshJob(job: KnowledgeJob, base: KnowledgeBase, item: KnowledgeItem): Promise<void> {
    await this.dispatchProcessingStatus(base.id, item.id, 'processing', 5)
    await this.removeItemLoaders(base, item)
    await KnowledgeDirectoryIndexService.removeDirectory(base.id, item.id)
    this.updateJob(job, { progress: 25 })

    const result = await this.addDirectoryItem(base, item, true, job, 25)
    await this.persistDirectoryResult(base.id, item, result)
    await this.dispatchProcessingStatus(base.id, item.id, 'completed', 100)
    this.updateJob(job, { progress: 100 })
  }

  private async runDirectoryIncrementalRefreshJob(
    job: KnowledgeJob,
    base: KnowledgeBase,
    item: KnowledgeItem
  ): Promise<void> {
    await this.dispatchProcessingStatus(base.id, item.id, 'processing', 5)

    const directoryRecord = await KnowledgeDirectoryIndexService.getDirectory(base.id, item.id)
    if (!directoryRecord) {
      throw new KnowledgeMaintenanceError(
        409,
        'DIRECTORY_INDEX_NOT_FOUND',
        'Directory incremental refresh requires a file index. Run a full directory refresh once first.'
      )
    }

    const directoryPath = item.content as string
    const files = getAllFiles(directoryPath)
    const fileEntries = await Promise.all(
      files.map(async (file) => ({
        file,
        comparablePath: this.normalizeComparablePath(file.path),
        realComparablePath: await this.resolveRealComparablePath(file.path)
      }))
    )
    const indexedFiles = directoryRecord.files || {}
    const staleEntries: Array<[string, KnowledgeDirectoryFileRecord]> = []
    const changedFiles: FileMetadata[] = []
    const sidecarUpdates: FileIndexSidecarUpdate[] = []

    for (const [indexedFilePath, record] of Object.entries(indexedFiles)) {
      const indexedComparablePath = this.normalizeComparablePath(indexedFilePath)
      const indexedRealComparablePath = await this.resolveRealComparablePath(indexedFilePath)
      const existsOnDisk = fileEntries.some((entry) =>
        this.areComparablePathVariantsSame(
          entry.comparablePath,
          entry.realComparablePath,
          indexedComparablePath,
          indexedRealComparablePath
        )
      )

      if (!existsOnDisk) {
        staleEntries.push([indexedFilePath, record])
      }
    }

    for (const { file, comparablePath, realComparablePath } of fileEntries) {
      const indexedEntry = await this.findIndexedFileEntry(indexedFiles, comparablePath, realComparablePath)
      const record = indexedEntry?.record
      if (!record) {
        changedFiles.push(file)
        continue
      }

      const stats = await fs.promises.stat(file.path)
      const comparison = await this.compareFileWithIndexRecord(file.path, record, stats)
      if (comparison.changed) {
        changedFiles.push(file)
      } else if (comparison.updatedRecord) {
        sidecarUpdates.push({
          filePath: file.path,
          oldKey: indexedEntry.key === comparablePath ? undefined : indexedEntry.key,
          record: comparison.updatedRecord
        })
      }
    }

    const totalFiles = changedFiles.length + staleEntries.length
    let processedFiles = 0
    this.updateJob(job, { total_files: totalFiles, processed_files: 0, current_file: null, progress: 10 })

    if (totalFiles === 0) {
      await this.persistFileIndexSidecarUpdates(base.id, item.id, directoryPath, sidecarUpdates)
      await this.dispatchProcessingStatus(base.id, item.id, 'completed', 100)
      return
    }

    const params = await getKnowledgeBaseParams(base)
    const latestItem = await this.getDirectoryItem(base.id, item.id)
    const uniqueIds = new Set(latestItem?.uniqueIds || item.uniqueIds || [])

    for (const [filePath, record] of staleEntries) {
      this.updateJob(job, {
        current_file: filePath,
        total_files: totalFiles,
        processed_files: processedFiles,
        progress: this.calculateFileProgress(processedFiles, totalFiles, 10, 95)
      })

      await KnowledgeService.remove({} as Electron.IpcMainInvokeEvent, {
        uniqueId: record.uniqueId,
        uniqueIds: [record.uniqueId],
        base: params
      })
      await KnowledgeDirectoryIndexService.removeFile(base.id, item.id, filePath)
      uniqueIds.delete(record.uniqueId)

      processedFiles += 1
      this.updateJob(job, {
        current_file: filePath,
        total_files: totalFiles,
        processed_files: processedFiles,
        progress: this.calculateFileProgress(processedFiles, totalFiles, 10, 95)
      })
    }

    for (const file of changedFiles) {
      const filePath = file.path
      const fileKey = this.normalizeComparablePath(filePath)
      const realFileKey = await this.resolveRealComparablePath(filePath)
      const oldEntry = await this.findIndexedFileEntry(indexedFiles, fileKey, realFileKey)
      const oldRecord = oldEntry?.record || null
      this.updateJob(job, {
        current_file: filePath,
        total_files: totalFiles,
        processed_files: processedFiles,
        progress: this.calculateFileProgress(processedFiles, totalFiles, 10, 95)
      })

      if (oldRecord) {
        await KnowledgeService.remove({} as Electron.IpcMainInvokeEvent, {
          uniqueId: oldRecord.uniqueId,
          uniqueIds: [oldRecord.uniqueId],
          base: params
        })
        uniqueIds.delete(oldRecord.uniqueId)
      }

      const fileItem = await this.createFileItem(item.id, filePath)
      const result = await KnowledgeService.add({} as Electron.IpcMainInvokeEvent, {
        base: params,
        item: fileItem,
        forceReload: true
      })

      this.assertLoaderSucceeded(result, `Failed to refresh file: ${filePath}`)

      const newUniqueIds = result.uniqueIds?.length ? result.uniqueIds : result.uniqueId ? [result.uniqueId] : []
      const nextUniqueId = newUniqueIds[0]
      if (!nextUniqueId) {
        throw new Error(`File refresh did not return a loader uniqueId: ${filePath}`)
      }

      await KnowledgeDirectoryIndexService.upsertFile(
        base.id,
        item.id,
        directoryPath,
        filePath,
        await this.createFileIndexRecord(filePath, nextUniqueId)
      )
      if (oldEntry && oldEntry.key !== fileKey) {
        await KnowledgeDirectoryIndexService.removeFile(base.id, item.id, oldEntry.key)
      }

      for (const uniqueId of newUniqueIds) {
        uniqueIds.add(uniqueId)
      }

      processedFiles += 1
      this.updateJob(job, {
        current_file: filePath,
        total_files: totalFiles,
        processed_files: processedFiles,
        progress: this.calculateFileProgress(processedFiles, totalFiles, 10, 95)
      })
    }

    await this.persistFileIndexSidecarUpdates(base.id, item.id, directoryPath, sidecarUpdates)
    await this.dispatchUniqueIds(base.id, item.id, latestItem?.uniqueId || item.uniqueId || '', [...uniqueIds])
    await this.dispatchProcessingStatus(base.id, item.id, 'completed', 100)
    this.updateJob(job, { current_file: null, processed_files: processedFiles, progress: 100 })
  }

  private async runDirectoryFileRefreshJob(
    job: KnowledgeJob,
    base: KnowledgeBase,
    directoryItem: KnowledgeItem,
    filePath: string,
    oldRecord: KnowledgeDirectoryFileRecord | null
  ): Promise<void> {
    await this.dispatchProcessingStatus(base.id, directoryItem.id, 'processing', 10)
    this.updateJob(job, { current_file: filePath, total_files: 1, processed_files: 0, progress: 10 })

    const params = await getKnowledgeBaseParams(base)
    if (oldRecord) {
      await KnowledgeService.remove({} as Electron.IpcMainInvokeEvent, {
        uniqueId: oldRecord.uniqueId,
        uniqueIds: [oldRecord.uniqueId],
        base: params
      })
    }
    this.updateJob(job, { progress: oldRecord ? 35 : 20 })

    const fileItem = await this.createFileItem(directoryItem.id, filePath)
    const result = await KnowledgeService.add({} as Electron.IpcMainInvokeEvent, {
      base: params,
      item: fileItem,
      forceReload: true
    })

    this.assertLoaderSucceeded(result, `Failed to refresh file: ${filePath}`)

    const newUniqueIds = result.uniqueIds?.length ? result.uniqueIds : result.uniqueId ? [result.uniqueId] : []
    const nextUniqueId = newUniqueIds[0]
    if (!nextUniqueId) {
      throw new Error(`File refresh did not return a loader uniqueId: ${filePath}`)
    }

    await KnowledgeDirectoryIndexService.upsertFile(
      base.id,
      directoryItem.id,
      directoryItem.content as string,
      filePath,
      await this.createFileIndexRecord(filePath, nextUniqueId)
    )

    const latestItem = await this.getDirectoryItem(base.id, directoryItem.id)
    const uniqueIds = new Set(latestItem?.uniqueIds || directoryItem.uniqueIds || [])
    if (oldRecord) {
      uniqueIds.delete(oldRecord.uniqueId)
    }
    for (const uniqueId of newUniqueIds) {
      uniqueIds.add(uniqueId)
    }

    await this.dispatchUniqueIds(base.id, directoryItem.id, latestItem?.uniqueId || directoryItem.uniqueId || '', [
      ...uniqueIds
    ])
    await this.dispatchProcessingStatus(base.id, directoryItem.id, 'completed', 100)
    this.updateJob(job, { current_file: null, processed_files: 1, progress: 100 })
  }

  private async addDirectoryItem(
    base: KnowledgeBase,
    item: KnowledgeItem,
    forceReload: boolean,
    job?: KnowledgeJob,
    progressStart = 10
  ): Promise<LoaderReturn> {
    const params = await getKnowledgeBaseParams(base)
    const result = await KnowledgeService.add({} as Electron.IpcMainInvokeEvent, {
      base: params,
      item,
      forceReload,
      onDirectoryFileStart: (progress) => {
        if (!job) {
          return
        }

        this.updateJob(job, {
          current_file: progress.filePath,
          total_files: progress.totalFiles,
          processed_files: progress.processedFiles,
          progress: this.calculateFileProgress(progress.processedFiles, progress.totalFiles, progressStart, 95)
        })
      },
      onDirectoryFileComplete: (progress) => {
        if (!job) {
          return
        }

        this.updateJob(job, {
          current_file: progress.filePath,
          total_files: progress.totalFiles,
          processed_files: progress.processedFiles,
          progress: this.calculateFileProgress(progress.processedFiles, progress.totalFiles, progressStart, 95)
        })
      }
    })

    this.assertLoaderSucceeded(result, `Failed to index directory: ${item.content}`)
    return result
  }

  private async removeItemLoaders(base: KnowledgeBase, item: KnowledgeItem): Promise<void> {
    const uniqueIds = item.uniqueIds || []
    if (uniqueIds.length === 0 && !item.uniqueId) {
      return
    }

    const params = await getKnowledgeBaseParams(base)
    await KnowledgeService.remove({} as Electron.IpcMainInvokeEvent, {
      uniqueId: item.uniqueId || '',
      uniqueIds,
      base: params
    })
  }

  private async persistDirectoryResult(baseId: string, item: KnowledgeItem, result: LoaderReturn): Promise<void> {
    const uniqueIds = result.uniqueIds?.length ? result.uniqueIds : result.uniqueId ? [result.uniqueId] : []
    await this.dispatchUniqueIds(baseId, item.id, result.uniqueId, uniqueIds)

    const directoryResult = result as DirectoryLoaderReturn
    const records: Record<string, KnowledgeDirectoryFileRecord> = {}
    for (const [filePath, uniqueId] of Object.entries(directoryResult.fileUniqueIds || {})) {
      records[filePath] = await this.createFileIndexRecord(filePath, uniqueId)
    }

    await KnowledgeDirectoryIndexService.replaceDirectory(baseId, item.id, item.content as string, records)
  }

  private async createFileItem(directoryItemId: string, filePath: string): Promise<KnowledgeItem> {
    const stats = await fs.promises.stat(filePath)
    const ext = path.extname(filePath)
    const fileType = getFileType(ext)
    if (
      fileType === FILE_TYPE.OTHER ||
      fileType === FILE_TYPE.IMAGE ||
      fileType === FILE_TYPE.VIDEO ||
      fileType === FILE_TYPE.AUDIO
    ) {
      throw new KnowledgeMaintenanceError(400, 'UNSUPPORTED_FILE_TYPE', `Unsupported file type: ${ext || filePath}`)
    }

    const name = path.basename(filePath)
    const file: FileMetadata = {
      id: uuidv4(),
      name,
      origin_name: name,
      path: filePath,
      size: stats.size,
      ext,
      type: fileType,
      created_at: new Date().toISOString(),
      count: 1
    }

    return {
      id: `dir-file:${directoryItemId}:${createHash('sha256').update(filePath).digest('hex').slice(0, 16)}`,
      type: 'file',
      content: file,
      created_at: Date.now(),
      updated_at: Date.now()
    }
  }

  private async compareFileWithIndexRecord(
    filePath: string,
    record: KnowledgeDirectoryFileRecord,
    stats: fs.Stats
  ): Promise<{ changed: boolean; updatedRecord?: KnowledgeDirectoryFileRecord }> {
    const ext = path.extname(filePath)
    if (record.size !== stats.size || record.ext !== ext) {
      return { changed: true }
    }

    if (Math.abs(record.mtimeMs - stats.mtimeMs) <= 1) {
      return { changed: false }
    }

    const contentHash = await this.createFileContentHash(filePath)
    if (record.contentHash && record.contentHash !== contentHash) {
      return { changed: true }
    }

    // Older sidecar records did not include a content hash. For metadata-only mtime
    // drift with identical size/ext, preserve the existing loader and backfill the
    // current hash so future incremental refreshes can compare content exactly.
    return {
      changed: false,
      updatedRecord: {
        ...record,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ext,
        contentHash
      }
    }
  }

  private async persistFileIndexSidecarUpdates(
    baseId: string,
    itemId: string,
    directoryPath: string,
    updates: FileIndexSidecarUpdate[]
  ): Promise<void> {
    if (updates.length === 0) {
      return
    }

    await KnowledgeDirectoryIndexService.upsertFiles(
      baseId,
      itemId,
      directoryPath,
      updates.map(({ filePath, record }) => ({ filePath, record })),
      updates.flatMap(({ oldKey }) => (oldKey ? [oldKey] : []))
    )
  }

  private async createFileIndexRecord(filePath: string, uniqueId: string): Promise<KnowledgeDirectoryFileRecord> {
    const stats = await fs.promises.stat(filePath)
    return {
      uniqueId,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      ext: path.extname(filePath),
      contentHash: await this.createFileContentHash(filePath),
      lastIndexedAt: Date.now()
    }
  }

  private async createFileContentHash(filePath: string): Promise<string> {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)

    for await (const chunk of stream) {
      hash.update(chunk)
    }

    return hash.digest('hex')
  }

  private assertLoaderSucceeded(result: LoaderReturn, fallbackMessage: string): void {
    if (result.status === 'failed' || !result.uniqueId) {
      throw new Error(result.message || fallbackMessage)
    }
  }

  private async getBaseOrThrow(baseId: string): Promise<KnowledgeBase> {
    try {
      const base = await getKnowledgeBaseFromRedux(baseId)
      if (!base) {
        throw new KnowledgeMaintenanceError(404, 'KB_NOT_FOUND', `Knowledge base not found: ${baseId}`)
      }

      return base
    } catch (error) {
      if (error instanceof KnowledgeMaintenanceError) {
        throw error
      }

      if (isReduxUnavailableError(error)) {
        throw new KnowledgeMaintenanceError(
          503,
          'REDUX_UNAVAILABLE',
          'Knowledge bases are only available when Cherry Studio window is open',
          'service_unavailable'
        )
      }

      throw error
    }
  }

  private async getDirectoryItemOrThrow(
    baseId: string,
    itemId: string
  ): Promise<{ base: KnowledgeBase; item: KnowledgeItem }> {
    const base = await this.getBaseOrThrow(baseId)
    const item = base.items.find((baseItem) => baseItem.id === itemId)
    if (!item) {
      throw new KnowledgeMaintenanceError(404, 'ITEM_NOT_FOUND', `Knowledge item not found: ${itemId}`)
    }

    if (item.type !== 'directory') {
      throw new KnowledgeMaintenanceError(400, 'ITEM_NOT_DIRECTORY', `Knowledge item is not a directory: ${itemId}`)
    }

    if (item.processingStatus === 'pending' || item.processingStatus === 'processing') {
      throw new KnowledgeMaintenanceError(
        409,
        'ITEM_ALREADY_PROCESSING',
        `Knowledge item is already processing: ${itemId}`
      )
    }

    return { base, item }
  }

  private async getDirectoryItem(baseId: string, itemId: string): Promise<KnowledgeItem | null> {
    const base = await this.getBaseOrThrow(baseId)
    return base.items.find((item) => item.id === itemId && item.type === 'directory') || null
  }

  private async assertDirectoryPath(directoryPath: string): Promise<string> {
    const resolvedPath = await this.resolveExistingPath(directoryPath)
    let stats: fs.Stats
    try {
      stats = await fs.promises.stat(resolvedPath)
    } catch {
      throw new KnowledgeMaintenanceError(400, 'DIRECTORY_NOT_FOUND', `Directory does not exist: ${directoryPath}`)
    }

    if (!stats.isDirectory()) {
      throw new KnowledgeMaintenanceError(400, 'PATH_NOT_DIRECTORY', `Path is not a directory: ${directoryPath}`)
    }

    return resolvedPath
  }

  private async assertFilePath(filePath: string): Promise<string> {
    const resolvedPath = await this.resolveExistingPath(filePath)
    let stats: fs.Stats
    try {
      stats = await fs.promises.stat(resolvedPath)
    } catch {
      throw new KnowledgeMaintenanceError(400, 'FILE_NOT_FOUND', `File does not exist: ${filePath}`)
    }

    if (!stats.isFile()) {
      throw new KnowledgeMaintenanceError(400, 'PATH_NOT_FILE', `Path is not a file: ${filePath}`)
    }

    return resolvedPath
  }

  private async resolveExistingPath(targetPath: string): Promise<string> {
    return path.resolve(targetPath)
  }

  private async findDirectoryItemByPath(
    base: KnowledgeBase,
    directoryPath: string
  ): Promise<KnowledgeItem | undefined> {
    const directMatch = base.items.find(
      (item) =>
        item.type === 'directory' &&
        this.normalizeComparablePath(item.content as string) === this.normalizeComparablePath(directoryPath)
    )
    if (directMatch) {
      return directMatch
    }

    for (const item of base.items) {
      if (item.type === 'directory' && (await this.areSamePath(item.content as string, directoryPath))) {
        return item
      }
    }

    return undefined
  }

  private async findIndexedFileEntry(
    indexedFiles: Record<string, KnowledgeDirectoryFileRecord>,
    comparablePath: string,
    realComparablePath: string
  ): Promise<{ key: string; record: KnowledgeDirectoryFileRecord } | null> {
    const directRecord = indexedFiles[comparablePath]
    if (directRecord) {
      return { key: comparablePath, record: directRecord }
    }

    for (const [indexedFilePath, record] of Object.entries(indexedFiles)) {
      const indexedComparablePath = this.normalizeComparablePath(indexedFilePath)
      const indexedRealComparablePath = await this.resolveRealComparablePath(indexedFilePath)
      if (
        this.areComparablePathVariantsSame(
          comparablePath,
          realComparablePath,
          indexedComparablePath,
          indexedRealComparablePath
        )
      ) {
        return { key: indexedFilePath, record }
      }
    }

    return null
  }

  private areComparablePathVariantsSame(
    leftComparablePath: string,
    leftRealComparablePath: string,
    rightComparablePath: string,
    rightRealComparablePath: string
  ): boolean {
    return (
      leftComparablePath === rightComparablePath ||
      leftComparablePath === rightRealComparablePath ||
      leftRealComparablePath === rightComparablePath ||
      leftRealComparablePath === rightRealComparablePath
    )
  }

  private async isPathInsideDirectory(filePath: string, directoryPath: string): Promise<boolean> {
    if (isPathInside(filePath, directoryPath)) {
      return true
    }

    const [realFilePath, realDirectoryPath] = await Promise.all([
      this.resolveRealComparablePath(filePath),
      this.resolveRealComparablePath(directoryPath)
    ])
    return isPathInside(realFilePath, realDirectoryPath)
  }

  private async areSamePath(left: string, right: string): Promise<boolean> {
    if (this.normalizeComparablePath(left) === this.normalizeComparablePath(right)) {
      return true
    }

    const [leftRealPath, rightRealPath] = await Promise.all([
      this.resolveRealComparablePath(left),
      this.resolveRealComparablePath(right)
    ])
    return leftRealPath === rightRealPath
  }

  private async resolveRealComparablePath(targetPath: string): Promise<string> {
    const resolvedPath = path.resolve(targetPath)
    try {
      return this.normalizeComparablePath(await fs.promises.realpath(resolvedPath))
    } catch {
      return this.normalizeComparablePath(resolvedPath)
    }
  }

  private normalizeComparablePath(targetPath: string): string {
    const normalized = path.normalize(path.resolve(targetPath))
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }

  private getDirectoryTargetKey(baseId: string, itemId: string): string {
    return `${baseId}:${itemId}`
  }

  private calculateFileProgress(processedFiles: number, totalFiles: number, start: number, end: number): number {
    if (totalFiles <= 0) {
      return end
    }

    return Math.min(end, Math.max(start, Math.round(start + (processedFiles / totalFiles) * (end - start))))
  }

  private updateJob(
    job: KnowledgeJob,
    patch: Partial<
      Pick<KnowledgeJob, 'current_file' | 'error' | 'processed_files' | 'progress' | 'status' | 'total_files'>
    >
  ): void {
    Object.assign(job, patch, { updated_at: Date.now() })
  }

  private async markItemFailed(job: KnowledgeJob, error: Error): Promise<void> {
    if (!job.item_id) {
      return
    }

    await this.dispatchProcessingStatus(job.knowledge_base_id, job.item_id, 'failed', undefined, error.message).catch(
      (dispatchError) => logger.warn('Failed to mark knowledge item as failed', dispatchError as Error)
    )
  }

  private async dispatchProcessingStatus(
    baseId: string,
    itemId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    progress?: number,
    error?: string
  ): Promise<void> {
    await this.dispatchOrServiceUnavailable({
      type: 'knowledge/updateItemProcessingStatus',
      payload: {
        baseId,
        itemId,
        status,
        progress,
        error,
        retryCount: 0
      }
    })
  }

  private async dispatchUniqueIds(
    baseId: string,
    itemId: string,
    uniqueId: string,
    uniqueIds: string[]
  ): Promise<void> {
    await this.dispatchOrServiceUnavailable({
      type: 'knowledge/updateBaseItemUniqueId',
      payload: {
        baseId,
        itemId,
        uniqueId,
        uniqueIds
      }
    })
  }

  private async dispatchOrServiceUnavailable(action: unknown): Promise<void> {
    try {
      await reduxService.dispatch(action)
    } catch (error) {
      if (isReduxUnavailableError(error)) {
        throw new KnowledgeMaintenanceError(
          503,
          'REDUX_UNAVAILABLE',
          'Knowledge bases are only available when Cherry Studio window is open',
          'service_unavailable'
        )
      }

      throw error
    }
  }
}

export default new KnowledgeMaintenanceService()
