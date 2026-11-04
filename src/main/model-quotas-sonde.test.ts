import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetQuotasServicesHttpForTests, sonderQuotasServicesHttp } from './model-quotas'

// Sonde de quota d’un service direct au relevé (conv-1499) : la barre se remplit sans attendre une tâche.
describe('sonderQuotasServicesHttp', () => {
  beforeEach(() => resetQuotasServicesHttpForTests())

  it('ne sonde aucun service sans clé', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    await sonderQuotasServicesHttp(fetchFn, 1_000, {})
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
