import { createZodValidator } from '../../agents/validators/zodValidator'
import {
  KnowledgeBaseIdParamSchema,
  KnowledgeDirectoryFileRefreshSchema,
  KnowledgeDirectoryItemParamSchema,
  KnowledgeDirectoryPathSchema,
  KnowledgeDirectoryRefreshSchema,
  KnowledgeJobParamSchema,
  KnowledgeSearchSchema,
  PaginationQuerySchema
} from './zodSchemas'

/**
 * Validation middleware for knowledge base search
 */
export const validateKnowledgeSearch = createZodValidator({
  body: KnowledgeSearchSchema
})

/**
 * Validation middleware for knowledge base ID parameter
 */
export const validateKnowledgeBaseId = createZodValidator({
  params: KnowledgeBaseIdParamSchema
})

export const validateKnowledgeDirectoryPath = createZodValidator({
  params: KnowledgeBaseIdParamSchema,
  body: KnowledgeDirectoryPathSchema
})

export const validateKnowledgeDirectoryRefresh = createZodValidator({
  params: KnowledgeDirectoryItemParamSchema,
  body: KnowledgeDirectoryRefreshSchema
})

export const validateKnowledgeDirectoryFileRefresh = createZodValidator({
  params: KnowledgeDirectoryItemParamSchema,
  body: KnowledgeDirectoryFileRefreshSchema
})

export const validateKnowledgeJob = createZodValidator({
  params: KnowledgeJobParamSchema
})

/**
 * Validation middleware for pagination query parameters
 */
export const validatePagination = createZodValidator({
  query: PaginationQuerySchema
})
