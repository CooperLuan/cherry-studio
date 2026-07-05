import express from 'express'

import {
  addKnowledgeDirectory,
  getKnowledgeBase,
  getKnowledgeJob,
  listKnowledgeBases,
  refreshKnowledgeDirectory,
  refreshKnowledgeDirectoryFile,
  searchKnowledge
} from './handlers'
import {
  validateKnowledgeBaseId,
  validateKnowledgeDirectoryFileRefresh,
  validateKnowledgeDirectoryPath,
  validateKnowledgeDirectoryRefresh,
  validateKnowledgeJob,
  validateKnowledgeSearch,
  validatePagination
} from './validators'

// Create main knowledge router
const knowledgeRouter = express.Router()

/**
 * @swagger
 * components:
 *   schemas:
 *     KnowledgeBaseEntity:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique knowledge base identifier
 *         name:
 *           type: string
 *           description: Knowledge base name
 *         description:
 *           type: string
 *           description: Knowledge base description
 *         model:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             provider:
 *               type: string
 *           description: Embedding model configuration
 *         dimensions:
 *           type: integer
 *           description: Embedding dimensions
 *         chunkSize:
 *           type: integer
 *           description: Chunk size for document splitting
 *         chunkOverlap:
 *           type: integer
 *           description: Overlap between chunks
 *         documentCount:
 *           type: integer
 *           description: Number of documents
 *         version:
 *           type: integer
 *           description: Schema version
 *         threshold:
 *           type: number
 *           description: Similarity threshold
 *         rerankModel:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             provider:
 *               type: string
 *           description: Rerank model configuration
 *         preprocessProvider:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *             provider:
 *               type: string
 *           description: Preprocess provider configuration
 *         items:
 *           type: array
 *           items:
 *             type: object
 *           description: Knowledge items
 *         created_at:
 *           type: number
 *           description: Creation timestamp
 *         updated_at:
 *           type: number
 *           description: Last update timestamp
 *
 *     KnowledgeSearchResult:
 *       type: object
 *       properties:
 *         pageContent:
 *           type: string
 *           description: Document chunk content
 *         score:
 *           type: number
 *           description: Similarity score
 *         metadata:
 *           type: object
 *           description: Document metadata
 *         knowledge_base_id:
 *           type: string
 *           description: Source knowledge base ID
 *         knowledge_base_name:
 *           type: string
 *           description: Source knowledge base name
 *
 *     ListKnowledgeBasesResponse:
 *       type: object
 *       properties:
 *         knowledge_bases:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/KnowledgeBaseEntity'
 *         total:
 *           type: integer
 *           description: Total number of knowledge bases
 *
 *     SearchKnowledgeRequest:
 *       type: object
 *       properties:
 *         query:
 *           type: string
 *           description: Search query text
 *           minLength: 1
 *           maxLength: 1000
 *         knowledge_base_ids:
 *           type: array
 *           items:
 *             type: string
 *           description: Optional list of knowledge base IDs to search. If not provided, searches all knowledge bases.
 *         document_count:
 *           type: integer
 *           minimum: 1
 *           maximum: 20
 *           default: 5
 *           description: Maximum number of results to return
 *       required:
 *         - query
 *
 *     SearchKnowledgeResponse:
 *       type: object
 *       properties:
 *         query:
 *           type: string
 *           description: The original search query
 *         results:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/KnowledgeSearchResult'
 *         total:
 *           type: integer
 *           description: Total number of results
 *         searched_bases:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               name:
 *                 type: string
 *           description: Knowledge bases that were searched
 *         warnings:
 *           type: array
 *           items:
 *             type: string
 *           description: Warning messages for partial search failures
 *
 *     KnowledgeJob:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique job identifier
 *         operation:
 *           type: string
 *           enum: [add_directory, refresh_directory, refresh_directory_file]
 *         knowledge_base_id:
 *           type: string
 *         item_id:
 *           type: string
 *         directory_item_id:
 *           type: string
 *         file_path:
 *           type: string
 *         current_file:
 *           type: string
 *           nullable: true
 *           description: File currently being embedded or removed by this job
 *         total_files:
 *           type: number
 *           description: Total file operations planned for directory/file jobs
 *         processed_files:
 *           type: number
 *           description: Completed file operations for directory/file jobs
 *         status:
 *           type: string
 *           enum: [queued, running, completed, failed, cancelled]
 *         progress:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *         created_at:
 *           type: number
 *         updated_at:
 *           type: number
 *         error:
 *           type: string
 *           nullable: true
 *
 *     AddKnowledgeDirectoryRequest:
 *       type: object
 *       required:
 *         - path
 *       properties:
 *         path:
 *           type: string
 *           description: Absolute directory path to add
 *         mode:
 *           type: string
 *           enum: [enqueue, sync]
 *           default: enqueue
 *         refresh_if_exists:
 *           type: boolean
 *           default: false
 *
 *     RefreshKnowledgeDirectoryRequest:
 *       type: object
 *       properties:
 *         mode:
 *           type: string
 *           enum: [full, incremental]
 *           default: full
 *
 *     RefreshKnowledgeDirectoryFileRequest:
 *       type: object
 *       required:
 *         - path
 *       properties:
 *         path:
 *           type: string
 *           description: Absolute file path inside the directory item
 *         fallback:
 *           type: string
 *           enum: [error, full-directory]
 *           default: error
 *           description: Legacy compatibility option. Missing sidecar records are now indexed as new files.
 */

/**
 * @swagger
 * /v1/knowledge-bases:
 *   get:
 *     summary: List all knowledge bases
 *     description: Returns a list of all configured knowledge bases
 *     tags: [Knowledge]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of knowledge bases to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of knowledge bases to skip
 *     responses:
 *       200:
 *         description: List of knowledge bases
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListKnowledgeBasesResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       503:
 *         description: Service unavailable (Redux store not accessible)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
knowledgeRouter.get('/', validatePagination, listKnowledgeBases)

/**
 * @swagger
 * /v1/knowledge-bases/jobs/{jobId}:
 *   get:
 *     summary: Get knowledge maintenance job status
 *     tags: [Knowledge]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Knowledge maintenance job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KnowledgeJob'
 *       404:
 *         description: Job not found
 */
knowledgeRouter.get('/jobs/:jobId', validateKnowledgeJob, getKnowledgeJob)

/**
 * @swagger
 * /v1/knowledge-bases/{id}/directories:
 *   post:
 *     summary: Add a directory to a knowledge base
 *     description: Adds a directory item and starts indexing it as a background job.
 *     tags: [Knowledge]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Knowledge base ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddKnowledgeDirectoryRequest'
 *     responses:
 *       202:
 *         description: Directory indexing job queued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KnowledgeJob'
 *       400:
 *         description: Invalid path or request
 *       404:
 *         description: Knowledge base not found
 *       409:
 *         description: Directory already exists or is already processing
 *       503:
 *         description: Service unavailable
 */
knowledgeRouter.post('/:id/directories', validateKnowledgeDirectoryPath, addKnowledgeDirectory)

/**
 * @swagger
 * /v1/knowledge-bases/{id}/directories/{itemId}/refresh:
 *   post:
 *     summary: Refresh a directory knowledge item
 *     description: Refreshes a directory item. Use mode=incremental to process only added, modified, or deleted files based on the directory sidecar index; use mode=full to rebuild the whole directory.
 *     tags: [Knowledge]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshKnowledgeDirectoryRequest'
 *     responses:
 *       202:
 *         description: Directory refresh job queued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KnowledgeJob'
 *       400:
 *         description: Invalid request or non-directory item
 *       404:
 *         description: Knowledge base or item not found
 *       409:
 *         description: Item is already processing
 *       503:
 *         description: Service unavailable
 */
knowledgeRouter.post('/:id/directories/:itemId/refresh', validateKnowledgeDirectoryRefresh, refreshKnowledgeDirectory)

/**
 * @swagger
 * /v1/knowledge-bases/{id}/directories/{itemId}/files/refresh:
 *   post:
 *     summary: Refresh one file inside a directory knowledge item
 *     description: Refreshes an indexed file using the directory sidecar index, or indexes it as a new file when no sidecar record exists.
 *     tags: [Knowledge]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshKnowledgeDirectoryFileRequest'
 *     responses:
 *       202:
 *         description: File refresh job queued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KnowledgeJob'
 *       400:
 *         description: Invalid file path or non-directory item
 *       404:
 *         description: Knowledge base or item not found
 *       409:
 *         description: Item is already processing
 *       503:
 *         description: Service unavailable
 */
knowledgeRouter.post(
  '/:id/directories/:itemId/files/refresh',
  validateKnowledgeDirectoryFileRefresh,
  refreshKnowledgeDirectoryFile
)

/**
 * @swagger
 * /v1/knowledge-bases/{id}:
 *   get:
 *     summary: Get a knowledge base by ID
 *     tags: [Knowledge]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Knowledge base ID
 *     responses:
 *       200:
 *         description: Knowledge base details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KnowledgeBaseEntity'
 *       404:
 *         description: Knowledge base not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       503:
 *         description: Service unavailable (Redux store not accessible)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
knowledgeRouter.get('/:id', validateKnowledgeBaseId, getKnowledgeBase)

/**
 * @swagger
 * /v1/knowledge-bases/search:
 *   post:
 *     summary: Search knowledge bases
 *     description: |
 *       Search across one or more knowledge bases and retrieve relevant document chunks.
 *
 *       Each result includes:
 *       - `pageContent`: The text content of the matching chunk
 *       - `score`: Similarity score (higher = more relevant)
 *       - `metadata`: Additional information about the source document
 *       - `knowledge_base_id` & `knowledge_base_name`: Source of the result
 *
 *       Results are sorted by relevance score in descending order.
 *     tags: [Knowledge]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SearchKnowledgeRequest'
 *           example:
 *             query: "How do I configure Ollama embedding?"
 *             knowledge_base_ids: ["kb-uuid-1", "kb-uuid-2"]
 *             document_count: 5
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SearchKnowledgeResponse'
 *             example:
 *               query: "Ollama embedding config"
 *               results:
 *                 - pageContent: "To use Ollama embeddings, set the base URL to http://localhost:11434"
 *                   score: 0.89
 *                   metadata:
 *                     source: "/path/to/doc.md"
 *                     type: "file"
 *                   knowledge_base_id: "kb-uuid-1"
 *                   knowledge_base_name: "My Docs"
 *               total: 1
 *               searched_bases:
 *                 - id: "kb-uuid-1"
 *                   name: "My Docs"
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       502:
 *         description: All knowledge base searches failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       503:
 *         description: Service unavailable (Redux store not accessible)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
knowledgeRouter.post('/search', validateKnowledgeSearch, searchKnowledge)

export { knowledgeRouter as knowledgeRoutes }
