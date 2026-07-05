import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

import { FILE_TYPE, type KnowledgeBase, type KnowledgeItem } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getKnowledgeBaseFromRedux: vi.fn(),
  getKnowledgeBaseParams: vi.fn(),
  getDirectory: vi.fn(),
  getFile: vi.fn(),
  getAllFiles: vi.fn(),
  removeFile: vi.fn(),
  upsertFile: vi.fn(),
  upsertFiles: vi.fn(),
  replaceDirectory: vi.fn(),
  removeDirectory: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  dispatch: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }))
  }
}))

vi.mock('@main/services/KnowledgeBaseParamsResolver', () => ({
  getKnowledgeBaseFromRedux: mocks.getKnowledgeBaseFromRedux,
  getKnowledgeBaseParams: mocks.getKnowledgeBaseParams,
  isReduxUnavailableError: vi.fn(() => false)
}))

vi.mock('@main/services/KnowledgeDirectoryIndexService', () => ({
  default: {
    getDirectory: mocks.getDirectory,
    getFile: mocks.getFile,
    removeFile: mocks.removeFile,
    upsertFile: mocks.upsertFile,
    upsertFiles: mocks.upsertFiles,
    replaceDirectory: mocks.replaceDirectory,
    removeDirectory: mocks.removeDirectory
  }
}))

vi.mock('@main/services/KnowledgeService', () => ({
  default: {
    add: mocks.add,
    remove: mocks.remove
  }
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: {
    dispatch: mocks.dispatch
  }
}))

vi.mock('@main/utils/file', () => ({
  getAllFiles: mocks.getAllFiles,
  getFileType: vi.fn((ext: string) => (ext.toLowerCase() === '.md' ? FILE_TYPE.TEXT : FILE_TYPE.OTHER)),
  isPathInside: vi.fn((childPath: string, parentPath: string) => {
    const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath))
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  })
}))

describe('KnowledgeMaintenanceService', () => {
  let tempDir: string
  let filePath: string

  const normalizeComparablePath = (targetPath: string): string => {
    const normalized = path.normalize(path.resolve(targetPath))
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }

  const contentHashFor = (targetPath: string): string =>
    createHash('sha256')
      .update(`content:${path.basename(targetPath)}`)
      .digest('hex')

  const createDirectoryItem = (overrides: Partial<KnowledgeItem> = {}): KnowledgeItem =>
    ({
      id: 'dir-item-1',
      type: 'directory',
      content: tempDir,
      created_at: 1,
      updated_at: 1,
      processingStatus: 'completed',
      processingProgress: 100,
      uniqueId: 'DirectoryLoader_root',
      uniqueIds: ['existing-loader'],
      ...overrides
    }) as KnowledgeItem

  const createBase = (item: KnowledgeItem): KnowledgeBase =>
    ({
      id: 'kb-1',
      name: 'Test KB',
      model: { id: 'embedding-model', provider: 'openai' },
      dimensions: 1536,
      chunkSize: 500,
      chunkOverlap: 50,
      documentCount: 1,
      items: [item],
      created_at: 1,
      updated_at: 1
    }) as KnowledgeBase

  beforeEach(async () => {
    tempDir = '/mock/docs'
    filePath = path.join(tempDir, 'new-file.md')

    vi.clearAllMocks()
    ;(fs.promises.stat as ReturnType<typeof vi.fn>).mockImplementation(async (targetPath: string) => {
      const isMarkdownFile = path.extname(targetPath) === '.md'
      return {
        isDirectory: () => !isMarkdownFile,
        isFile: () => isMarkdownFile,
        size: path.basename(targetPath) === 'changed.md' ? 22 : 11,
        mtimeMs: 1234
      }
    })
    ;(fs.createReadStream as ReturnType<typeof vi.fn>).mockImplementation((targetPath: string) =>
      Readable.from([`content:${path.basename(targetPath)}`])
    )
    mocks.getKnowledgeBaseParams.mockResolvedValue({ id: 'kb-1' })
    mocks.dispatch.mockResolvedValue(undefined)
    mocks.getAllFiles.mockReturnValue([])
    mocks.removeFile.mockResolvedValue(undefined)
    mocks.upsertFile.mockResolvedValue(undefined)
    mocks.upsertFiles.mockResolvedValue(undefined)
    mocks.add.mockResolvedValue({
      entriesAdded: 1,
      uniqueId: 'new-loader',
      uniqueIds: ['new-loader'],
      loaderType: 'file',
      status: 'completed'
    })
    mocks.remove.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('adds a new directory file when no sidecar record exists', async () => {
    const directoryItem = createDirectoryItem()
    mocks.getKnowledgeBaseFromRedux.mockResolvedValue(createBase(directoryItem))
    mocks.getFile.mockResolvedValue(null)

    const service = (await import('../KnowledgeMaintenanceService')).default
    const job = await service.refreshDirectoryFile('kb-1', 'dir-item-1', filePath)
    const completedJob = await service.waitForJob(job.id)

    expect(completedJob?.status).toBe('completed')
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.add).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        base: { id: 'kb-1' },
        forceReload: true,
        item: expect.objectContaining({
          id: expect.stringMatching(/^dir-file:dir-item-1:/),
          type: 'file',
          content: expect.objectContaining({
            path: expect.stringMatching(/new-file\.md$/),
            name: 'new-file.md'
          })
        })
      })
    )
    expect(mocks.upsertFile).toHaveBeenCalledWith(
      'kb-1',
      'dir-item-1',
      expect.stringMatching(/docs$/),
      expect.stringMatching(/new-file\.md$/),
      expect.objectContaining({ uniqueId: 'new-loader', ext: '.md' })
    )
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'knowledge/updateBaseItemUniqueId',
      payload: {
        baseId: 'kb-1',
        itemId: 'dir-item-1',
        uniqueId: 'DirectoryLoader_root',
        uniqueIds: ['existing-loader', 'new-loader']
      }
    })
  })

  it('refreshes an existing directory file by replacing the old loader', async () => {
    const directoryItem = createDirectoryItem({ uniqueIds: ['old-loader', 'existing-loader'] })
    mocks.getKnowledgeBaseFromRedux.mockResolvedValue(createBase(directoryItem))
    mocks.getFile.mockResolvedValue({
      uniqueId: 'old-loader',
      size: 10,
      mtimeMs: 100,
      ext: '.md',
      lastIndexedAt: 200
    })

    const service = (await import('../KnowledgeMaintenanceService')).default
    const job = await service.refreshDirectoryFile('kb-1', 'dir-item-1', filePath)
    const completedJob = await service.waitForJob(job.id)

    expect(completedJob?.status).toBe('completed')
    expect(mocks.remove).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        uniqueId: 'old-loader',
        uniqueIds: ['old-loader'],
        base: { id: 'kb-1' }
      })
    )
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'knowledge/updateBaseItemUniqueId',
      payload: {
        baseId: 'kb-1',
        itemId: 'dir-item-1',
        uniqueId: 'DirectoryLoader_root',
        uniqueIds: ['existing-loader', 'new-loader']
      }
    })
  })

  it('incrementally refreshes only added, changed, and deleted directory files', async () => {
    const changedPath = path.join(tempDir, 'changed.md')
    const newPath = path.join(tempDir, 'new-file.md')
    const unchangedPath = path.join(tempDir, 'unchanged.md')
    const deletedPath = path.join(tempDir, 'deleted.md')
    const directoryItem = createDirectoryItem({
      uniqueIds: ['old-changed-loader', 'old-deleted-loader', 'keep-loader']
    })

    mocks.getKnowledgeBaseFromRedux.mockResolvedValue(createBase(directoryItem))
    mocks.getAllFiles.mockReturnValue([
      {
        id: 'changed-file',
        name: 'changed.md',
        origin_name: 'changed.md',
        path: changedPath,
        size: 22,
        ext: '.md',
        type: FILE_TYPE.TEXT,
        created_at: new Date().toISOString(),
        count: 1
      },
      {
        id: 'new-file',
        name: 'new-file.md',
        origin_name: 'new-file.md',
        path: newPath,
        size: 11,
        ext: '.md',
        type: FILE_TYPE.TEXT,
        created_at: new Date().toISOString(),
        count: 1
      },
      {
        id: 'unchanged-file',
        name: 'unchanged.md',
        origin_name: 'unchanged.md',
        path: unchangedPath,
        size: 10,
        ext: '.md',
        type: FILE_TYPE.TEXT,
        created_at: new Date().toISOString(),
        count: 1
      }
    ])
    mocks.getDirectory.mockResolvedValue({
      root: tempDir,
      files: {
        [normalizeComparablePath(changedPath)]: {
          uniqueId: 'old-changed-loader',
          size: 10,
          mtimeMs: 100,
          ext: '.md',
          lastIndexedAt: 100
        },
        [normalizeComparablePath(unchangedPath)]: {
          uniqueId: 'keep-loader',
          size: 11,
          mtimeMs: 1234,
          ext: '.md',
          lastIndexedAt: 100
        },
        [normalizeComparablePath(deletedPath)]: {
          uniqueId: 'old-deleted-loader',
          size: 10,
          mtimeMs: 100,
          ext: '.md',
          lastIndexedAt: 100
        }
      }
    })
    mocks.add
      .mockResolvedValueOnce({
        entriesAdded: 1,
        uniqueId: 'new-changed-loader',
        uniqueIds: ['new-changed-loader'],
        loaderType: 'file',
        status: 'completed'
      })
      .mockResolvedValueOnce({
        entriesAdded: 1,
        uniqueId: 'new-file-loader',
        uniqueIds: ['new-file-loader'],
        loaderType: 'file',
        status: 'completed'
      })

    const service = (await import('../KnowledgeMaintenanceService')).default
    const job = await service.refreshDirectory('kb-1', 'dir-item-1', { mode: 'incremental' })
    const completedJob = await service.waitForJob(job.id)

    expect(completedJob).toMatchObject({
      status: 'completed',
      total_files: 3,
      processed_files: 3,
      current_file: null
    })
    expect(mocks.removeDirectory).not.toHaveBeenCalled()
    expect(mocks.replaceDirectory).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ uniqueId: 'old-deleted-loader', uniqueIds: ['old-deleted-loader'] })
    )
    expect(mocks.remove).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ uniqueId: 'old-changed-loader', uniqueIds: ['old-changed-loader'] })
    )
    expect(mocks.add).toHaveBeenCalledTimes(2)
    expect(mocks.removeFile).toHaveBeenCalledWith('kb-1', 'dir-item-1', normalizeComparablePath(deletedPath))
    expect(mocks.upsertFile).toHaveBeenCalledTimes(2)
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'knowledge/updateBaseItemUniqueId',
      payload: {
        baseId: 'kb-1',
        itemId: 'dir-item-1',
        uniqueId: 'DirectoryLoader_root',
        uniqueIds: ['keep-loader', 'new-changed-loader', 'new-file-loader']
      }
    })
  })

  it('backfills content hashes without rebinding legacy mtime-only directory files', async () => {
    const unchangedPath = path.join(tempDir, 'mtime-only.md')
    const directoryItem = createDirectoryItem({
      uniqueIds: ['keep-loader']
    })

    mocks.getKnowledgeBaseFromRedux.mockResolvedValue(createBase(directoryItem))
    mocks.getAllFiles.mockReturnValue([
      {
        id: 'mtime-only-file',
        name: 'mtime-only.md',
        origin_name: 'mtime-only.md',
        path: unchangedPath,
        size: 11,
        ext: '.md',
        type: FILE_TYPE.TEXT,
        created_at: new Date().toISOString(),
        count: 1
      }
    ])
    mocks.getDirectory.mockResolvedValue({
      root: tempDir,
      files: {
        [normalizeComparablePath(unchangedPath)]: {
          uniqueId: 'keep-loader',
          size: 11,
          mtimeMs: 100,
          ext: '.md',
          lastIndexedAt: 200
        }
      }
    })

    const service = (await import('../KnowledgeMaintenanceService')).default
    const job = await service.refreshDirectory('kb-1', 'dir-item-1', { mode: 'incremental' })
    const completedJob = await service.waitForJob(job.id)

    expect(completedJob).toMatchObject({
      status: 'completed',
      total_files: 0,
      processed_files: 0,
      current_file: null
    })
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.upsertFiles).toHaveBeenCalledWith(
      'kb-1',
      'dir-item-1',
      expect.stringMatching(/docs$/),
      [
        {
          filePath: expect.stringMatching(/mtime-only\.md$/),
          record: expect.objectContaining({
            uniqueId: 'keep-loader',
            size: 11,
            mtimeMs: 1234,
            ext: '.md',
            contentHash: contentHashFor(unchangedPath),
            lastIndexedAt: 200
          })
        }
      ],
      []
    )
  })

  it('skips rebinding mtime-only directory files when the content hash matches', async () => {
    const unchangedPath = path.join(tempDir, 'hashed.md')
    const directoryItem = createDirectoryItem({
      uniqueIds: ['keep-loader']
    })

    mocks.getKnowledgeBaseFromRedux.mockResolvedValue(createBase(directoryItem))
    mocks.getAllFiles.mockReturnValue([
      {
        id: 'hashed-file',
        name: 'hashed.md',
        origin_name: 'hashed.md',
        path: unchangedPath,
        size: 11,
        ext: '.md',
        type: FILE_TYPE.TEXT,
        created_at: new Date().toISOString(),
        count: 1
      }
    ])
    mocks.getDirectory.mockResolvedValue({
      root: tempDir,
      files: {
        [normalizeComparablePath(unchangedPath)]: {
          uniqueId: 'keep-loader',
          size: 11,
          mtimeMs: 100,
          ext: '.md',
          contentHash: contentHashFor(unchangedPath),
          lastIndexedAt: 200
        }
      }
    })

    const service = (await import('../KnowledgeMaintenanceService')).default
    const job = await service.refreshDirectory('kb-1', 'dir-item-1', { mode: 'incremental' })
    const completedJob = await service.waitForJob(job.id)

    expect(completedJob?.status).toBe('completed')
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.upsertFiles).toHaveBeenCalledWith(
      'kb-1',
      'dir-item-1',
      expect.stringMatching(/docs$/),
      [
        {
          filePath: expect.stringMatching(/hashed\.md$/),
          record: expect.objectContaining({
            uniqueId: 'keep-loader',
            mtimeMs: 1234,
            contentHash: contentHashFor(unchangedPath)
          })
        }
      ],
      []
    )
  })
})
