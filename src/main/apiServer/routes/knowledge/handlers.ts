// TODO(v2): All Redux store reads in this file (state.knowledge.bases, state.llm.providers)
//           should migrate to the V2 SQLite/Drizzle data layer (src/main/services/agents/).
//           Redux is blocked for new data-model features until v2.0.0.
//           See: src/main/services/agents/database/schema/index.ts

import { loggerService } from '@logger'
import {
  getKnowledgeBaseParams,
  getKnowledgeBasesFromRedux,
  isReduxUnavailableError
} from '@main/services/KnowledgeBaseParamsResolver'
import KnowledgeMaintenanceService, { KnowledgeMaintenanceError } from '@main/services/KnowledgeMaintenanceService'
import KnowledgeService from '@main/services/KnowledgeService'
import type { KnowledgeBase } from '@types'
import type { Response } from 'express'
import type * as z from 'zod'

import type { ValidationRequest } from '../agents/validators/zodValidator'
import type {
  KnowledgeDirectoryFileRefreshSchema,
  KnowledgeDirectoryPathSchema,
  KnowledgeDirectoryRefreshSchema,
  KnowledgeSearchSchema
} from './validators/zodSchemas'

const logger = loggerService.withContext('KnowledgeHandlers')

// Infer types from Zod schemas to avoid duplication
type ValidatedSearchBody = z.infer<typeof KnowledgeSearchSchema>
type ValidatedDirectoryPathBody = z.infer<typeof KnowledgeDirectoryPathSchema>
type ValidatedDirectoryRefreshBody = z.infer<typeof KnowledgeDirectoryRefreshSchema>
type ValidatedDirectoryFileRefreshBody = z.infer<typeof KnowledgeDirectoryFileRefreshSchema>

function handleKnowledgeMaintenanceError(error: unknown, res: Response, fallbackCode: string): Response {
  if (error instanceof KnowledgeMaintenanceError) {
    return res.status(error.statusCode).json({
      error: {
        message: error.message,
        type: error.type,
        code: error.code
      }
    })
  }

  if (isReduxUnavailableError(error)) {
    return res.status(503).json({
      error: {
        message: 'Knowledge bases are only available when Cherry Studio window is open',
        type: 'service_unavailable',
        code: 'REDUX_UNAVAILABLE'
      }
    })
  }

  logger.error('Knowledge maintenance request failed', error as Error)
  return res.status(500).json({
    error: {
      message: 'Knowledge maintenance request failed',
      type: 'internal_error',
      code: fallbackCode
    }
  })
}

/**
 * Get all knowledge bases
 */
export const listKnowledgeBases = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    // Use Zod-validated values (defaults already applied by validator)
    const { limit = 20, offset = 0 } = req.validatedQuery ?? {}

    logger.debug('Listing knowledge bases', { limit, offset })

    // Get knowledge bases from Redux store
    // TODO(v2): Migrate to V2 knowledge base storage (SQLite/Drizzle).
    //           Redux access requires Cherry Studio window to be open.
    let bases: KnowledgeBase[]
    try {
      bases = await getKnowledgeBasesFromRedux()
    } catch (error) {
      if (isReduxUnavailableError(error)) {
        logger.warn('Redux store not available, returning 503')
        return res.status(503).json({
          error: {
            message: 'Knowledge bases are only available when Cherry Studio window is open',
            type: 'service_unavailable',
            code: 'REDUX_UNAVAILABLE'
          }
        })
      }
      throw error // Re-throw non-Redux errors to outer catch
    }

    const total = bases?.length || 0
    const paginatedBases = (bases || []).slice(offset, offset + limit)
    return res.json({
      knowledge_bases: paginatedBases,
      total
    })
  } catch (error) {
    logger.error('Failed to list knowledge bases', error as Error)
    return res.status(500).json({
      error: {
        message: 'Failed to list knowledge bases',
        type: 'internal_error',
        code: 'LIST_KB_ERROR'
      }
    })
  }
}

/**
 * Get a single knowledge base by ID
 */
export const getKnowledgeBase = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    // Zod already validated id exists and is non-empty
    const { id } = req.validatedParams ?? {}

    logger.debug(`Getting knowledge base: ${id}`)

    // TODO(v2): Migrate to V2 knowledge base storage (SQLite/Drizzle).
    const bases = await getKnowledgeBasesFromRedux()
    const base = bases?.find((b) => b.id === id)

    if (!base) {
      return res.status(404).json({
        error: {
          message: `Knowledge base not found: ${id}`,
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    }

    return res.json(base)
  } catch (error) {
    if (isReduxUnavailableError(error)) {
      return res.status(503).json({
        error: {
          message: 'Knowledge bases are only available when Cherry Studio window is open',
          type: 'service_unavailable',
          code: 'REDUX_UNAVAILABLE'
        }
      })
    }
    logger.error('Failed to get knowledge base', error as Error)
    return res.status(500).json({
      error: {
        message: 'Failed to get knowledge base',
        type: 'internal_error',
        code: 'GET_KB_ERROR'
      }
    })
  }
}

/**
 * Search across knowledge bases
 *
 * This endpoint allows you to search through one or more knowledge bases
 * and retrieve relevant document chunks with similarity scores.
 */
export const searchKnowledge = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    // Use Zod-validated body (defaults already applied by validator)
    const { query, knowledge_base_ids, document_count = 5 } = (req.validatedBody ?? {}) as ValidatedSearchBody

    logger.debug(`Searching knowledge bases: "${query}"`, { knowledge_base_ids, document_count })

    // Get knowledge bases from Redux
    // TODO(v2): Migrate to V2 knowledge base storage (SQLite/Drizzle).
    const bases = await getKnowledgeBasesFromRedux()

    if (!bases || bases.length === 0) {
      return res.json({
        query,
        results: [],
        total: 0,
        searched_bases: [],
        warnings: ['No knowledge bases configured. Please add knowledge bases in Cherry Studio.']
      })
    }

    // Filter by specified knowledge base IDs if provided
    const targetBases = knowledge_base_ids?.length ? bases.filter((b) => knowledge_base_ids.includes(b.id)) : bases

    if (knowledge_base_ids?.length && targetBases.length === 0) {
      return res.status(404).json({
        error: {
          message: 'None of the specified knowledge bases were found',
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    }

    // Search each knowledge base
    const searchPromises = targetBases.map(async (base) => {
      try {
        const params = await getKnowledgeBaseParams(base)

        // WORKAROUND: KnowledgeService.search() expects Electron.IpcMainInvokeEvent for IPC signature.
        // The @TraceMethod decorator doesn't currently access event properties, so passing {} is safe.
        // TODO(v2): Add searchInternal() method to KnowledgeService for non-IPC calls.
        const searchResults = await KnowledgeService.search({} as Electron.IpcMainInvokeEvent, {
          search: query,
          base: params
        })

        return {
          baseId: base.id,
          baseName: base.name,
          results: searchResults.map((result) => ({
            ...result,
            knowledge_base_id: base.id,
            knowledge_base_name: base.name
          })),
          error: undefined
        }
      } catch (error) {
        logger.error(`Error searching knowledge base ${base.id}`, error as Error)
        return {
          baseId: base.id,
          baseName: base.name,
          results: [],
          error: (error as Error).message
        }
      }
    })

    const resultsPerBase = await Promise.all(searchPromises)

    // Check if all searches failed
    const allFailed = resultsPerBase.every((r) => r.results.length === 0 && r.error)
    if (allFailed && resultsPerBase.length > 0) {
      return res.status(502).json({
        error: {
          message: 'All knowledge base searches failed. Check embedding provider configuration.',
          type: 'upstream_error',
          code: 'SEARCH_ALL_FAILED',
          failed_bases: resultsPerBase.map((r) => ({ id: r.baseId, name: r.baseName, error: r.error }))
        }
      })
    }

    // Collect partial failures
    const warnings = resultsPerBase
      .filter((r) => r.error && r.results.length === 0)
      .map((r) => `Knowledge base "${r.baseName}" search failed: ${r.error}`)

    const allResults = resultsPerBase.flatMap((r) => r.results)
    const sortedResults = allResults.sort((a, b) => b.score - a.score).slice(0, document_count)

    logger.debug(`Found ${sortedResults.length} results for query: "${query}"`)

    return res.json({
      query,
      results: sortedResults,
      total: sortedResults.length,
      searched_bases: resultsPerBase.map((r) => ({ id: r.baseId, name: r.baseName })),
      ...(warnings.length > 0 && { warnings })
    })
  } catch (error) {
    if (isReduxUnavailableError(error)) {
      return res.status(503).json({
        error: {
          message: 'Knowledge bases are only available when Cherry Studio window is open',
          type: 'service_unavailable',
          code: 'REDUX_UNAVAILABLE'
        }
      })
    }
    logger.error('Failed to search knowledge bases', error as Error)
    return res.status(500).json({
      error: {
        message: 'Failed to search knowledge bases',
        type: 'internal_error',
        code: 'SEARCH_ERROR'
      }
    })
  }
}

export const addKnowledgeDirectory = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    const { id } = req.validatedParams ?? {}
    const {
      path,
      mode = 'enqueue',
      refresh_if_exists = false
    } = (req.validatedBody ?? {}) as ValidatedDirectoryPathBody

    const job = await KnowledgeMaintenanceService.addDirectory(id, path, { mode, refresh_if_exists })
    const responseJob = mode === 'sync' ? await KnowledgeMaintenanceService.waitForJob(job.id) : job

    return res.status(mode === 'sync' ? 200 : 202).json(responseJob)
  } catch (error) {
    return handleKnowledgeMaintenanceError(error, res, 'ADD_KB_DIRECTORY_ERROR')
  }
}

export const refreshKnowledgeDirectory = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    const { id, itemId } = req.validatedParams ?? {}
    const { mode = 'full' } = (req.validatedBody ?? {}) as ValidatedDirectoryRefreshBody

    const job = await KnowledgeMaintenanceService.refreshDirectory(id, itemId, { mode })
    return res.status(202).json(job)
  } catch (error) {
    return handleKnowledgeMaintenanceError(error, res, 'REFRESH_KB_DIRECTORY_ERROR')
  }
}

export const refreshKnowledgeDirectoryFile = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    const { id, itemId } = req.validatedParams ?? {}
    const { path, fallback = 'error' } = (req.validatedBody ?? {}) as ValidatedDirectoryFileRefreshBody

    const job = await KnowledgeMaintenanceService.refreshDirectoryFile(id, itemId, path, { fallback })
    return res.status(202).json(job)
  } catch (error) {
    return handleKnowledgeMaintenanceError(error, res, 'REFRESH_KB_DIRECTORY_FILE_ERROR')
  }
}

export const getKnowledgeJob = async (req: ValidationRequest, res: Response): Promise<Response> => {
  const { jobId } = req.validatedParams ?? {}
  const job = KnowledgeMaintenanceService.getJob(jobId)
  if (!job) {
    return res.status(404).json({
      error: {
        message: `Knowledge job not found: ${jobId}`,
        type: 'invalid_request_error',
        code: 'KNOWLEDGE_JOB_NOT_FOUND'
      }
    })
  }

  return res.json(job)
}
