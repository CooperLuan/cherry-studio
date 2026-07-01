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
import { getFileType, isPathInside } from '@main/utils/file'
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
  status: KnowledgeJobStatus
  progress: number
  created_at: number
  updated_at: number
  error: string | null
}

interface DirectoryLoaderReturn extends LoaderReturn {
  fileUniqueIds?: Record<string, string>
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
    const existingItem = base.items.find(
      (item) => item.type === 'directory' && this.areSamePath(item.content as string, resolvedDirectoryPath)
    )

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
    if ((options.mode ?? 'full') !== 'full') {
      throw new KnowledgeMaintenanceError(
        400,
        'UNSUPPORTED_REFRESH_MODE',
        'Only full directory refresh is currently supported'
      )
    }

    const { base, item } = await this.getDirectoryItemOrThrow(baseId, itemId)
    await this.assertDirectoryPath(item.content as string)
    await this.dispatchProcessingStatus(baseId, itemId, 'pending', 0)

    return this.enqueueJob(
      {
        operation: 'refresh_directory',
        knowledge_base_id: baseId,
        item_id: itemId,
        directory_item_id: itemId
      },
      this.getDirectoryTargetKey(baseId, itemId),
      async (job) => this.runDirectoryRefreshJob(job, base, item)
    )
  }

  public async refreshDirectoryFile(
    baseId: string,
    itemId: string,
    filePath: string,
    options: RefreshDirectoryFileOptions = {}
  ): Promise<KnowledgeJob> {
    const { base, item } = await this.getDirectoryItemOrThrow(baseId, itemId)
    const directoryPath = await this.assertDirectoryPath(item.content as string)
    const resolvedFilePath = await this.assertFilePath(filePath)

    if (!isPathInside(resolvedFilePath, directoryPath)) {
      throw new KnowledgeMaintenanceError(
        400,
        'FILE_OUTSIDE_DIRECTORY',
        'File must be inside the directory knowledge item'
      )
    }

    const existingRecord = await KnowledgeDirectoryIndexService.getFile(baseId, itemId, resolvedFilePath)
    if (!existingRecord) {
      if ((options.fallback ?? 'error') === 'full-directory') {
        return this.refreshDirectory(baseId, itemId, { mode: 'full' })
      }

      throw new KnowledgeMaintenanceError(
        409,
        'FILE_INDEX_NOT_FOUND',
        'No file-level index entry exists for this path. Run a full directory refresh first.'
      )
    }

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
      this.updateJob(job, { status: 'completed', progress: 100, error: null })
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
    const result = await this.addDirectoryItem(base, item, forceReload)
    await this.persistDirectoryResult(base.id, item, result)
    await this.dispatchProcessingStatus(base.id, item.id, 'completed', 100)
    this.updateJob(job, { progress: 100 })
  }

  private async runDirectoryRefreshJob(job: KnowledgeJob, base: KnowledgeBase, item: KnowledgeItem): Promise<void> {
    await this.dispatchProcessingStatus(base.id, item.id, 'processing', 5)
    await this.removeItemLoaders(base, item)
    await KnowledgeDirectoryIndexService.removeDirectory(base.id, item.id)
    this.updateJob(job, { progress: 25 })

    const result = await this.addDirectoryItem(base, item, true)
    await this.persistDirectoryResult(base.id, item, result)
    await this.dispatchProcessingStatus(base.id, item.id, 'completed', 100)
    this.updateJob(job, { progress: 100 })
  }

  private async runDirectoryFileRefreshJob(
    job: KnowledgeJob,
    base: KnowledgeBase,
    directoryItem: KnowledgeItem,
    filePath: string,
    oldRecord: KnowledgeDirectoryFileRecord
  ): Promise<void> {
    await this.dispatchProcessingStatus(base.id, directoryItem.id, 'processing', 10)

    const params = await getKnowledgeBaseParams(base)
    await KnowledgeService.remove({} as Electron.IpcMainInvokeEvent, {
      uniqueId: oldRecord.uniqueId,
      uniqueIds: [oldRecord.uniqueId],
      base: params
    })
    this.updateJob(job, { progress: 35 })

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
    uniqueIds.delete(oldRecord.uniqueId)
    for (const uniqueId of newUniqueIds) {
      uniqueIds.add(uniqueId)
    }

    await this.dispatchUniqueIds(base.id, directoryItem.id, latestItem?.uniqueId || directoryItem.uniqueId || '', [
      ...uniqueIds
    ])
    await this.dispatchProcessingStatus(base.id, directoryItem.id, 'completed', 100)
    this.updateJob(job, { progress: 100 })
  }

  private async addDirectoryItem(
    base: KnowledgeBase,
    item: KnowledgeItem,
    forceReload: boolean
  ): Promise<LoaderReturn> {
    const params = await getKnowledgeBaseParams(base)
    const result = await KnowledgeService.add({} as Electron.IpcMainInvokeEvent, {
      base: params,
      item,
      forceReload
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

  private async createFileIndexRecord(filePath: string, uniqueId: string): Promise<KnowledgeDirectoryFileRecord> {
    const stats = await fs.promises.stat(filePath)
    return {
      uniqueId,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      ext: path.extname(filePath),
      lastIndexedAt: Date.now()
    }
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
    const resolvedPath = path.resolve(targetPath)
    try {
      return await fs.promises.realpath(resolvedPath)
    } catch {
      return resolvedPath
    }
  }

  private areSamePath(left: string, right: string): boolean {
    return this.normalizeComparablePath(left) === this.normalizeComparablePath(right)
  }

  private normalizeComparablePath(targetPath: string): string {
    const normalized = path.normalize(path.resolve(targetPath))
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }

  private getDirectoryTargetKey(baseId: string, itemId: string): string {
    return `${baseId}:${itemId}`
  }

  private updateJob(job: KnowledgeJob, patch: Partial<Pick<KnowledgeJob, 'status' | 'progress' | 'error'>>): void {
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
