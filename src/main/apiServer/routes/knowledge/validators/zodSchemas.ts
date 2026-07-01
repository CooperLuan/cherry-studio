import * as z from 'zod'

/**
 * Zod schema for knowledge base ID validation
 */
export const KnowledgeBaseIdSchema = z.string().min(1, 'Knowledge base ID is required')

/**
 * Zod schema for knowledge base search request
 */
export const KnowledgeSearchSchema = z.object({
  query: z.string().min(1, 'Query is required').max(1000, 'Query must be at most 1000 characters'),
  knowledge_base_ids: z.array(z.string().min(1, 'Knowledge base ID cannot be empty')).optional(),
  document_count: z.coerce.number().int().min(1).max(20).default(5)
})

export const KnowledgeDirectoryPathSchema = z.object({
  path: z.string().min(1, 'Directory path is required'),
  mode: z.enum(['enqueue', 'sync']).default('enqueue').optional(),
  refresh_if_exists: z.boolean().default(false).optional()
})

export const KnowledgeDirectoryRefreshSchema = z.object({
  mode: z.enum(['full', 'incremental']).default('full').optional()
})

export const KnowledgeDirectoryFileRefreshSchema = z.object({
  path: z.string().min(1, 'File path is required'),
  fallback: z.enum(['error', 'full-directory']).default('error').optional()
})

/**
 * Zod schema for pagination query parameters
 */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional()
})

/**
 * Zod schema for knowledge base ID parameter
 */
export const KnowledgeBaseIdParamSchema = z.object({
  id: KnowledgeBaseIdSchema
})

export const KnowledgeDirectoryItemParamSchema = z.object({
  id: KnowledgeBaseIdSchema,
  itemId: z.string().min(1, 'Knowledge item ID is required')
})

export const KnowledgeJobParamSchema = z.object({
  jobId: z.string().min(1, 'Knowledge job ID is required')
})
