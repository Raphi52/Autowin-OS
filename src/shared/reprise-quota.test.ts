import { describe, expect, it } from 'vitest'
import { conversationsCoupeesParQuota, estMurDeQuota } from './reprise-quota'

describe('estMurDeQuota', () => {
  it('reconnaît le vocabulaire du quota épuisé', () => {
    expect(estMurDeQuota('Claude usage limit reached')).toBe(true)
    expect(estMurDeQuota('You have hit your usage limit for this month')).toBe(true)
    expect(estMurDeQuota('insufficient_quota')).toBe(true)
    expect(estMurDeQuota('Please purchase more credits')).toBe(true)
  })

  it('reconnaît le texte RÉEL des conversations coupées (session limit)', () => {
    expect(
      estMurDeQuota(
        "Claude a interrompu l'appel : You've hit your session limit · resets 2am (Europe/Paris)"
      )
    ).toBe(true)
  })

  it('REFUSE un rate-limit passager, qui annonce une attente', () => {
    expect(estMurDeQuota('429 rate limit exceeded, retry after 20s')).toBe(false)
    expect(estMurDeQuota('usage limit — try again in 20 seconds')).toBe(false)
  })

  it('REFUSE une erreur ordinaire ou vide', () => {
    expect(estMurDeQuota('TypeError: undefined is not a function')).toBe(false)
    expect(estMurDeQuota('')).toBe(false)
    expect(estMurDeQuota(undefined)).toBe(false)
  })
})

describe('conversationsCoupeesParQuota', () => {
  const convs = [
    { id: 'a', lastAssistantStatus: 'failed' as const, lastAssistantError: 'usage limit reached' },
    { id: 'b', lastAssistantStatus: 'failed' as const, lastAssistantError: 'ENOENT script.ts' },
    { id: 'c', lastAssistantStatus: 'completed' as const, lastAssistantError: 'usage limit' },
    { id: 'd', lastAssistantStatus: 'failed' as const },
    { id: 'e', lastAssistantStatus: 'failed' as const, lastAssistantError: 'insufficient_quota' }
  ]

  it('ne garde que la pastille rouge dont le motif est le quota', () => {
    expect(conversationsCoupeesParQuota(convs).map((c) => c.id)).toEqual(['a', 'e'])
  })

  it('écarte une conversation dont un tour tourne déjà', () => {
    expect(conversationsCoupeesParQuota(convs, new Set(['a'])).map((c) => c.id)).toEqual(['e'])
  })
})
