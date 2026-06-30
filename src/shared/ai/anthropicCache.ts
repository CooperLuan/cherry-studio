import type { Provider } from '@shared/data/types/provider'

export const ANTHROPIC_CACHE_DEFAULT_TOKEN_THRESHOLD = 1024
export const ANTHROPIC_CACHE_DEFAULT_LAST_N_MESSAGES = 2

export interface EffectiveAnthropicCacheSettings {
  enabled: boolean
  tokenThreshold: number
  cacheSystemMessage: boolean
  cacheLastNMessages: number
  cacheToolDefinitions: boolean
}

export function resolveAnthropicCacheSettings(provider: Pick<Provider, 'settings'>): EffectiveAnthropicCacheSettings {
  const settings = provider.settings?.cacheControl
  if (settings?.enabled === false) {
    return {
      enabled: false,
      tokenThreshold: settings.tokenThreshold ?? ANTHROPIC_CACHE_DEFAULT_TOKEN_THRESHOLD,
      cacheSystemMessage: settings.cacheSystemMessage ?? true,
      cacheLastNMessages: settings.cacheLastNMessages ?? ANTHROPIC_CACHE_DEFAULT_LAST_N_MESSAGES,
      cacheToolDefinitions: true
    }
  }

  return {
    enabled: true,
    tokenThreshold: settings?.tokenThreshold ?? ANTHROPIC_CACHE_DEFAULT_TOKEN_THRESHOLD,
    cacheSystemMessage: settings?.cacheSystemMessage ?? true,
    cacheLastNMessages: settings?.cacheLastNMessages ?? ANTHROPIC_CACHE_DEFAULT_LAST_N_MESSAGES,
    cacheToolDefinitions: true
  }
}
