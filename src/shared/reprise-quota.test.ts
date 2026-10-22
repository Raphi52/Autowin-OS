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

  it('reconnaît la limite HEBDOMADAIRE (conv-1055)', () => {
    // Recopiés de run-stdout/ et causal-trace/ (2026-10-22) : 355 occurrences, toutes ignorées.
    expect(
      estMurDeQuota(
        "Claude a interrompu l'appel : You've hit your weekly limit · resets 5am (Europe/Paris)"
      )
    ).toBe(true)
    expect(estMurDeQuota("You've hit your weekly limit · resets Sep 29, 2am (Europe/Paris)")).toBe(
      true
    )
  })

  it('NE ferme PAS le compte entier sur la limite d’UN modèle (Opus)', () => {
    // Le mur est indexé par compte (`quotaWallKey`, registry.ts) : le fermer sur « Opus limit »
    // refuserait aussi Sonnet et Haiku. Forme relevée par les guides publics (revue de conv-1055).
    expect(estMurDeQuota("You've hit your Opus limit · resets 3:45pm")).toBe(false)
  })

  it('ne prend pas un simple NOM de limite pour le mur lui-même', () => {
    expect(estMurDeQuota('FAIL reprise-quota.test.ts > reconnaît la weekly limit')).toBe(false)
    expect(estMurDeQuota('Opus limit documentation')).toBe(false)
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
