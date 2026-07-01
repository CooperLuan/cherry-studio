import { loggerService } from '@logger'
import { reduxService } from '@main/services/ReduxService'
import type { KnowledgeBase, KnowledgeBaseParams, Provider } from '@types'

const logger = loggerService.withContext('KnowledgeBaseParamsResolver')

export function isReduxUnavailableError(error: unknown): boolean {
  const message = (error as Error)?.message || ''
  return message.includes('Main window is not available') || message.includes('Timeout waiting for Redux store')
}

export async function getKnowledgeBasesFromRedux(): Promise<KnowledgeBase[]> {
  return (await reduxService.select<KnowledgeBase[]>('state.knowledge.bases')) || []
}

export async function getKnowledgeBaseFromRedux(baseId: string): Promise<KnowledgeBase | null> {
  const bases = await getKnowledgeBasesFromRedux()
  return bases.find((base) => base.id === baseId) || null
}

async function getProviderConfig(providerId: string): Promise<{ apiKey: string; baseURL: string } | null> {
  const providers = await reduxService.select<Provider[]>('state.llm.providers')
  const provider = providers?.find((p) => p.id === providerId)
  if (!provider) {
    logger.warn(`Provider not found: ${providerId}`)
    return null
  }

  let baseURL = provider.apiHost || ''
  baseURL = baseURL.replace(/\/+$/, '')
  baseURL = baseURL.replace(/#$/, '')

  const apiKey = provider.apiKey ? provider.apiKey.split(',')[0].trim() : ''

  return {
    apiKey,
    baseURL
  }
}

export async function getKnowledgeBaseParams(base: KnowledgeBase): Promise<KnowledgeBaseParams> {
  const embedProviderId = base.model?.provider
  if (!embedProviderId) {
    throw new Error(`Knowledge base "${base.name}" is missing embedding model provider configuration`)
  }

  const embedConfig = await getProviderConfig(embedProviderId)
  if (!embedConfig) {
    throw new Error(`Provider "${embedProviderId}" not found for knowledge base "${base.name}"`)
  }

  const params: KnowledgeBaseParams = {
    id: base.id,
    dimensions: base.dimensions,
    embedApiClient: {
      model: base.model?.id || '',
      provider: embedProviderId,
      apiKey: embedConfig.apiKey,
      baseURL: embedConfig.baseURL
    },
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap,
    documentCount: base.documentCount
  }

  if (base.rerankModel?.provider) {
    const rerankConfig = await getProviderConfig(base.rerankModel.provider)
    if (!rerankConfig) {
      logger.warn(`Rerank provider not found for knowledge base "${base.name}": ${base.rerankModel.provider}`)
    } else {
      params.rerankApiClient = {
        model: base.rerankModel.id || '',
        provider: base.rerankModel.provider,
        apiKey: rerankConfig.apiKey,
        baseURL: rerankConfig.baseURL
      }
    }
  }

  if (base.preprocessProvider) {
    params.preprocessProvider = base.preprocessProvider
  }

  return params
}
