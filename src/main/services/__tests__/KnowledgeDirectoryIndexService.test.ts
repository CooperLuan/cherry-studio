import * as fs from 'node:fs'

import { writeWithLock } from '@main/utils/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/mock/userData/Data/KnowledgeBase')
}))

vi.mock('@main/utils/file', () => ({
  writeWithLock: vi.fn()
}))

import { KnowledgeDirectoryIndexService } from '../KnowledgeDirectoryIndexService'

describe('KnowledgeDirectoryIndexService', () => {
  let service: KnowledgeDirectoryIndexService

  beforeEach(() => {
    service = new KnowledgeDirectoryIndexService('/mock/index.json')
    vi.clearAllMocks()
  })

  it('should return an empty index when the sidecar file is missing', async () => {
    ;(fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false)

    await expect(service.load()).resolves.toEqual({})
  })

  it('should load existing sidecar data', async () => {
    ;(fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(fs.promises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        'kb-1': {
          'item-1': {
            root: '/docs',
            files: {
              '/docs/a.md': {
                uniqueId: 'loader-1',
                size: 10,
                mtimeMs: 100,
                ext: '.md',
                contentHash: 'hash-a',
                lastIndexedAt: 200
              }
            }
          }
        }
      })
    )

    await expect(service.getFile('kb-1', 'item-1', '/docs/a.md')).resolves.toEqual({
      uniqueId: 'loader-1',
      size: 10,
      mtimeMs: 100,
      ext: '.md',
      contentHash: 'hash-a',
      lastIndexedAt: 200
    })
  })

  it('should replace a directory atomically', async () => {
    ;(fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(fs.promises.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(writeWithLock as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    await service.replaceDirectory('kb-1', 'item-1', '/docs', {
      '/docs/a.md': {
        uniqueId: 'loader-1',
        size: 10,
        mtimeMs: 100,
        ext: '.md',
        contentHash: 'hash-a',
        lastIndexedAt: 200
      }
    })

    expect(writeWithLock).toHaveBeenCalledWith(
      '/mock/index.json',
      expect.stringContaining('"loader-1"'),
      expect.objectContaining({ atomic: true, encoding: 'utf-8' })
    )
  })

  it('should upsert multiple files and remove stale path variants in one write', async () => {
    ;(fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(fs.promises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        'kb-1': {
          'item-1': {
            root: '/docs',
            files: {
              '/docs/old-case.md': {
                uniqueId: 'loader-old',
                size: 10,
                mtimeMs: 100,
                ext: '.md',
                lastIndexedAt: 200
              }
            }
          }
        }
      })
    )
    ;(fs.promises.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(writeWithLock as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    await service.upsertFiles(
      'kb-1',
      'item-1',
      '/docs',
      [
        {
          filePath: '/docs/new-case.md',
          record: {
            uniqueId: 'loader-old',
            size: 10,
            mtimeMs: 300,
            ext: '.md',
            contentHash: 'hash-new',
            lastIndexedAt: 200
          }
        }
      ],
      ['/docs/old-case.md']
    )

    expect(writeWithLock).toHaveBeenCalledTimes(1)
    const writtenPayload = (writeWithLock as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
    expect(writtenPayload).toContain('new-case.md')
    expect(writtenPayload).toContain('"hash-new"')
    expect(writtenPayload).not.toContain('"old-case.md"')
  })

  it('should remove a directory entry', async () => {
    ;(fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(fs.promises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        'kb-1': {
          'item-1': {
            root: '/docs',
            files: {}
          }
        }
      })
    )
    ;(fs.promises.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(writeWithLock as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    await service.removeDirectory('kb-1', 'item-1')

    expect(writeWithLock).toHaveBeenCalledWith('/mock/index.json', '{}\n', expect.any(Object))
  })
})
