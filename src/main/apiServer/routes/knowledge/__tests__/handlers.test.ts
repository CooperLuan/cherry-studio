import type { KnowledgeBase } from '@types'
import type { Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ValidationRequest } from '../../agents/validators/zodValidator'

// Mock dependencies BEFORE importing handlers - no top-level variables
vi.mock('@main/services/ReduxService', () => ({
  reduxService: {
    select: vi.fn()
  }
}))

vi.mock('@main/services/KnowledgeService', () => ({
  default: {
    search: vi.fn()
  }
}))

vi.mock('@main/services/KnowledgeMaintenanceService', () => {
  class KnowledgeMaintenanceError extends Error {
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

  return {
    KnowledgeMaintenanceError,
    default: {
      addDirectory: vi.fn(),
      refreshDirectory: vi.fn(),
      refreshDirectoryFile: vi.fn(),
      getJob: vi.fn(),
      waitForJob: vi.fn()
    }
  }
})

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

// Import handlers AFTER mocks
import {
  addKnowledgeDirectory,
  getKnowledgeBase,
  getKnowledgeJob,
  listKnowledgeBases,
  refreshKnowledgeDirectory,
  refreshKnowledgeDirectoryFile,
  searchKnowledge
} from '../handlers'

// Helper to create mock KnowledgeBase
function createMockKnowledgeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'kb-test-id',
    name: 'Test Knowledge Base',
    description: 'Test description',
    model: { id: 'text-embedding-3-small', provider: 'openai' },
    dimensions: 1536,
    chunkSize: 500,
    chunkOverlap: 50,
    documentCount: 10,
    version: 1,
    items: [],
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides
  } as KnowledgeBase
}

describe('Knowledge Handlers', () => {
  let req: Partial<ValidationRequest>
  let res: Partial<Response>
  let jsonMock: ReturnType<typeof vi.fn>
  let statusMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    jsonMock = vi.fn()
    statusMock = vi.fn(() => ({ json: jsonMock }))

    req = {}
    res = {
      status: statusMock,
      json: jsonMock
    }

    vi.clearAllMocks()
  })

  describe('listKnowledgeBases', () => {
    it('should return paginated knowledge bases', async () => {
      const mockBases = [
        createMockKnowledgeBase({ id: 'kb-1', name: 'KB 1' }),
        createMockKnowledgeBase({ id: 'kb-2', name: 'KB 2' }),
        createMockKnowledgeBase({ id: 'kb-3', name: 'KB 3' })
      ]

      const { reduxService } = await import('@main/services/ReduxService')
      ;(reduxService.select as ReturnType<typeof vi.fn>).mockResolvedValue(mockBases)

      req.validatedQuery = { limit: 2, offset: 0 }

      await listKnowledgeBases(req as ValidationRequest, res as Response)

      expect(jsonMock).toHaveBeenCalledWith({
        knowledge_bases: mockBases.slice(0, 2),
        total: 3
      })
    })

    it('should return 503 when Redux is unavailable', async () => {
      const { reduxService } = await import('@main/services/ReduxService')
      ;(reduxService.select as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Main window is not available'))

      req.validatedQuery = { limit: 20, offset: 0 }

      await listKnowledgeBases(req as ValidationRequest, res as Response)

      expect(statusMock).toHaveBeenCalledWith(503)
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          message: 'Knowledge bases are only available when Cherry Studio window is open',
          type: 'service_unavailable',
          code: 'REDUX_UNAVAILABLE'
        }
      })
    })
  })

  describe('getKnowledgeBase', () => {
    it('should return a single knowledge base', async () => {
      const mockBase = createMockKnowledgeBase({ id: 'kb-1' })
      const { reduxService } = await import('@main/services/ReduxService')
      ;(reduxService.select as ReturnType<typeof vi.fn>).mockResolvedValue([mockBase])

      req.validatedParams = { id: 'kb-1' }

      await getKnowledgeBase(req as ValidationRequest, res as Response)

      expect(jsonMock).toHaveBeenCalledWith(mockBase)
    })

    it('should return 404 when knowledge base not found', async () => {
      const { reduxService } = await import('@main/services/ReduxService')
      ;(reduxService.select as ReturnType<typeof vi.fn>).mockResolvedValue([])

      req.validatedParams = { id: 'non-existent' }

      await getKnowledgeBase(req as ValidationRequest, res as Response)

      expect(statusMock).toHaveBeenCalledWith(404)
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          message: 'Knowledge base not found: non-existent',
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    })

    it('should return 503 when Redux is unavailable', async () => {
      const { reduxService } = await import('@main/services/ReduxService')
      ;(reduxService.select as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Main window is not available'))

      req.validatedParams = { id: 'kb-1' }

      await getKnowledgeBase(req as ValidationRequest, res as Response)

      expect(statusMock).toHaveBeenCalledWith(503)
    })
  })

  describe('searchKnowledge', () => {
    it('should return warnings when no knowledge bases configured', async () => {
      const { reduxService } = await import('@main/services/ReduxService')
      ;(reduxService.select as ReturnType<typeof vi.fn>).mockResolvedValue([])

      req.validatedBody = { query: 'test query', document_count: 5 }

      await searchKnowledge(req as ValidationRequest, res as Response)

      expect(jsonMock).toHaveBeenCalledWith({
        query: 'test query',
        results: [],
        total: 0,
        searched_bases: [],
        warnings: ['No knowledge bases configured. Please add knowledge bases in Cherry Studio.']
      })
    })

    it('should return 404 when specified knowledge bases not found', async () => {
      const { reduxService } = await import('@main/services/ReduxService')
      ;(reduxService.select as ReturnType<typeof vi.fn>).mockResolvedValue([createMockKnowledgeBase({ id: 'kb-1' })])

      req.validatedBody = {
        query: 'test query',
        knowledge_base_ids: ['non-existent'],
        document_count: 5
      }

      await searchKnowledge(req as ValidationRequest, res as Response)

      expect(statusMock).toHaveBeenCalledWith(404)
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          message: 'None of the specified knowledge bases were found',
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    })

    it('should return 503 when Redux is unavailable', async () => {
      const { reduxService } = await import('@main/services/ReduxService')
      ;(reduxService.select as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Main window is not available'))

      req.validatedBody = { query: 'test query', document_count: 5 }

      await searchKnowledge(req as ValidationRequest, res as Response)

      expect(statusMock).toHaveBeenCalledWith(503)
    })
  })

  describe('addKnowledgeDirectory', () => {
    it('should enqueue a directory indexing job', async () => {
      const KnowledgeMaintenanceService = (await import('@main/services/KnowledgeMaintenanceService')).default
      const job = {
        id: 'kbjob-test',
        operation: 'add_directory',
        knowledge_base_id: 'kb-1',
        item_id: 'item-1',
        directory_item_id: 'item-1',
        status: 'queued',
        progress: 0,
        created_at: 1,
        updated_at: 1,
        error: null
      }
      ;(KnowledgeMaintenanceService.addDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(job)

      req.validatedParams = { id: 'kb-1' }
      req.validatedBody = { path: '/docs', mode: 'enqueue', refresh_if_exists: false }

      await addKnowledgeDirectory(req as ValidationRequest, res as Response)

      expect(KnowledgeMaintenanceService.addDirectory).toHaveBeenCalledWith('kb-1', '/docs', {
        mode: 'enqueue',
        refresh_if_exists: false
      })
      expect(statusMock).toHaveBeenCalledWith(202)
      expect(jsonMock).toHaveBeenCalledWith(job)
    })

    it('should return service errors from directory indexing', async () => {
      const maintenanceModule = await import('@main/services/KnowledgeMaintenanceService')
      const KnowledgeMaintenanceService = maintenanceModule.default
      ;(KnowledgeMaintenanceService.addDirectory as ReturnType<typeof vi.fn>).mockRejectedValue(
        new maintenanceModule.KnowledgeMaintenanceError(409, 'DIRECTORY_ALREADY_EXISTS', 'Directory already exists')
      )

      req.validatedParams = { id: 'kb-1' }
      req.validatedBody = { path: '/docs' }

      await addKnowledgeDirectory(req as ValidationRequest, res as Response)

      expect(statusMock).toHaveBeenCalledWith(409)
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          message: 'Directory already exists',
          type: 'invalid_request_error',
          code: 'DIRECTORY_ALREADY_EXISTS'
        }
      })
    })
  })

  describe('refreshKnowledgeDirectory', () => {
    it('should enqueue a directory refresh job', async () => {
      const KnowledgeMaintenanceService = (await import('@main/services/KnowledgeMaintenanceService')).default
      const job = {
        id: 'kbjob-refresh',
        operation: 'refresh_directory',
        knowledge_base_id: 'kb-1',
        item_id: 'item-1',
        directory_item_id: 'item-1',
        status: 'queued',
        progress: 0,
        created_at: 1,
        updated_at: 1,
        error: null
      }
      ;(KnowledgeMaintenanceService.refreshDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(job)

      req.validatedParams = { id: 'kb-1', itemId: 'item-1' }
      req.validatedBody = { mode: 'full' }

      await refreshKnowledgeDirectory(req as ValidationRequest, res as Response)

      expect(KnowledgeMaintenanceService.refreshDirectory).toHaveBeenCalledWith('kb-1', 'item-1', { mode: 'full' })
      expect(statusMock).toHaveBeenCalledWith(202)
      expect(jsonMock).toHaveBeenCalledWith(job)
    })
  })

  describe('refreshKnowledgeDirectoryFile', () => {
    it('should enqueue a single-file refresh job', async () => {
      const KnowledgeMaintenanceService = (await import('@main/services/KnowledgeMaintenanceService')).default
      const job = {
        id: 'kbjob-file',
        operation: 'refresh_directory_file',
        knowledge_base_id: 'kb-1',
        item_id: 'item-1',
        directory_item_id: 'item-1',
        file_path: '/docs/a.md',
        status: 'queued',
        progress: 0,
        created_at: 1,
        updated_at: 1,
        error: null
      }
      ;(KnowledgeMaintenanceService.refreshDirectoryFile as ReturnType<typeof vi.fn>).mockResolvedValue(job)

      req.validatedParams = { id: 'kb-1', itemId: 'item-1' }
      req.validatedBody = { path: '/docs/a.md', fallback: 'error' }

      await refreshKnowledgeDirectoryFile(req as ValidationRequest, res as Response)

      expect(KnowledgeMaintenanceService.refreshDirectoryFile).toHaveBeenCalledWith('kb-1', 'item-1', '/docs/a.md', {
        fallback: 'error'
      })
      expect(statusMock).toHaveBeenCalledWith(202)
      expect(jsonMock).toHaveBeenCalledWith(job)
    })
  })

  describe('getKnowledgeJob', () => {
    it('should return a knowledge job', async () => {
      const KnowledgeMaintenanceService = (await import('@main/services/KnowledgeMaintenanceService')).default
      const job = {
        id: 'kbjob-test',
        operation: 'add_directory',
        knowledge_base_id: 'kb-1',
        status: 'completed',
        progress: 100,
        created_at: 1,
        updated_at: 2,
        error: null
      }
      ;(KnowledgeMaintenanceService.getJob as ReturnType<typeof vi.fn>).mockReturnValue(job)

      req.validatedParams = { jobId: 'kbjob-test' }

      await getKnowledgeJob(req as ValidationRequest, res as Response)

      expect(jsonMock).toHaveBeenCalledWith(job)
    })

    it('should return 404 when job is not found', async () => {
      const KnowledgeMaintenanceService = (await import('@main/services/KnowledgeMaintenanceService')).default
      ;(KnowledgeMaintenanceService.getJob as ReturnType<typeof vi.fn>).mockReturnValue(null)

      req.validatedParams = { jobId: 'missing-job' }

      await getKnowledgeJob(req as ValidationRequest, res as Response)

      expect(statusMock).toHaveBeenCalledWith(404)
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          message: 'Knowledge job not found: missing-job',
          type: 'invalid_request_error',
          code: 'KNOWLEDGE_JOB_NOT_FOUND'
        }
      })
    })
  })
})
