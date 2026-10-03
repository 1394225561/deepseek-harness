import { describe, expect, it, vi } from 'vitest'

// The installed catalog is fixed, so the three provider postures the
// configurable-provider directory distinguishes are replaced at the pi-ai
// boundary: one ships a chat model, one ships only a classifier model, and one
// lists no model of any type (the posture of a deployment whose pi-ai stub has
// no catalog data, such as the browser-worker preview).
vi.mock('@earendil-works/pi-ai/providers/all', async importOriginal => ({
  ...await importOriginal<typeof import('@earendil-works/pi-ai/providers/all')>(),
  getBuiltinProviders: () => ['chat-provider', 'classifier-provider', 'uncataloged-provider'],
  getBuiltinModels: (provider: string) => provider === 'chat-provider' ? [{ id: 'chat-model' }] : [],
  getAllBuiltinModels: (provider: string) => {
    if (provider === 'chat-provider') return [{ id: 'chat-model' }]
    if (provider === 'classifier-provider') return [{ id: 'classifier-model', type: 'classifier' }]
    return []
  },
}))

import { catalogProviderIds } from '../src/catalog.ts'

describe('catalog provider ids', () => {
  it('drops a provider that lists only non-chat models and keeps one that lists none', () => {
    expect(catalogProviderIds()).toEqual(['chat-provider', 'uncataloged-provider'])
  })
})
