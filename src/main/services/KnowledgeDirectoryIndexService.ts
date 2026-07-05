import * as fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { writeWithLock } from '@main/utils/file'

const logger = loggerService.withContext('KnowledgeDirectoryIndexService')

export interface KnowledgeDirectoryFileRecord {
  uniqueId: string
  size: number
  mtimeMs: number
  ext: string
  contentHash?: string
  lastIndexedAt: number
}

export interface KnowledgeDirectoryRecord {
  root: string
  files: Record<string, KnowledgeDirectoryFileRecord>
}

export type KnowledgeDirectoryIndexData = Record<string, Record<string, KnowledgeDirectoryRecord>>

export class KnowledgeDirectoryIndexService {
  private readonly indexFile: string

  constructor(indexFile = path.join(getDataPath('KnowledgeBase'), 'knowledge_directory_index.json')) {
    this.indexFile = indexFile
  }

  public getIndexFile(): string {
    return this.indexFile
  }

  public async load(): Promise<KnowledgeDirectoryIndexData> {
    try {
      if (!fs.existsSync(this.indexFile)) {
        return {}
      }

      const raw = await fs.promises.readFile(this.indexFile, 'utf-8')
      if (!raw.trim()) {
        return {}
      }

      return JSON.parse(raw) as KnowledgeDirectoryIndexData
    } catch (error) {
      logger.warn('Failed to load knowledge directory index, using empty index', error as Error)
      return {}
    }
  }

  public async save(data: KnowledgeDirectoryIndexData): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.indexFile), { recursive: true })
    await writeWithLock(this.indexFile, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf-8',
      atomic: true
    })
  }

  public async getDirectory(baseId: string, itemId: string): Promise<KnowledgeDirectoryRecord | null> {
    const data = await this.load()
    return data[baseId]?.[itemId] || null
  }

  public async getFile(baseId: string, itemId: string, filePath: string): Promise<KnowledgeDirectoryFileRecord | null> {
    const directory = await this.getDirectory(baseId, itemId)
    if (!directory) {
      return null
    }

    return directory.files[this.normalizePathKey(filePath)] || directory.files[filePath] || null
  }

  public async upsertFile(
    baseId: string,
    itemId: string,
    root: string,
    filePath: string,
    record: KnowledgeDirectoryFileRecord
  ): Promise<void> {
    const data = await this.load()
    data[baseId] ??= {}
    data[baseId][itemId] ??= {
      root: this.normalizePathKey(root),
      files: {}
    }

    data[baseId][itemId].root = this.normalizePathKey(root)
    data[baseId][itemId].files[this.normalizePathKey(filePath)] = record
    await this.save(data)
  }

  public async upsertFiles(
    baseId: string,
    itemId: string,
    root: string,
    records: Array<{ filePath: string; record: KnowledgeDirectoryFileRecord }>,
    removeFilePaths: string[] = []
  ): Promise<void> {
    if (records.length === 0 && removeFilePaths.length === 0) {
      return
    }

    const data = await this.load()
    data[baseId] ??= {}
    data[baseId][itemId] ??= {
      root: this.normalizePathKey(root),
      files: {}
    }

    data[baseId][itemId].root = this.normalizePathKey(root)
    for (const filePath of removeFilePaths) {
      delete data[baseId][itemId].files[filePath]
      delete data[baseId][itemId].files[this.normalizePathKey(filePath)]
    }

    for (const { filePath, record } of records) {
      data[baseId][itemId].files[this.normalizePathKey(filePath)] = record
    }

    await this.save(data)
  }

  public async removeFile(baseId: string, itemId: string, filePath: string): Promise<void> {
    const data = await this.load()
    const directory = data[baseId]?.[itemId]
    if (!directory) {
      return
    }

    delete directory.files[filePath]
    delete directory.files[this.normalizePathKey(filePath)]
    await this.save(data)
  }

  public async replaceDirectory(
    baseId: string,
    itemId: string,
    root: string,
    records: Record<string, KnowledgeDirectoryFileRecord>
  ): Promise<void> {
    const data = await this.load()
    data[baseId] ??= {}
    data[baseId][itemId] = {
      root: this.normalizePathKey(root),
      files: Object.fromEntries(
        Object.entries(records).map(([filePath, record]) => [this.normalizePathKey(filePath), record])
      )
    }

    await this.save(data)
  }

  public async removeDirectory(baseId: string, itemId: string): Promise<void> {
    const data = await this.load()
    if (!data[baseId]?.[itemId]) {
      return
    }

    delete data[baseId][itemId]
    if (Object.keys(data[baseId]).length === 0) {
      delete data[baseId]
    }

    await this.save(data)
  }

  private normalizePathKey(filePath: string): string {
    const normalized = path.normalize(path.resolve(filePath))
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
}

export default new KnowledgeDirectoryIndexService()
