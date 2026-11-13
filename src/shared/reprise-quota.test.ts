import { describe, expect, it } from 'vitest'
import {
  conversationsCoupeesParQuota,
  coupuresParLimiteDeModele,
  estMurDeQuota,
  modeleDeLaLimite
} from './reprise-quota'

/** Recopié d'un journal de tour du 2026-11-12 (03:11) : le refus réellement stocké. */
const COUPURE_FABLE =
  "Claude a interrompu l'appel : You've reached your Fable limit. Switch to another model to continue."

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

  it('reconnaît la limite des 5 HEURES (conv-1236)', () => {
    // Recopié de turn-journals/conv-1236 (tour 98f5030c, 2026-10-28) : la nouvelle formulation de
    // la limite de session du compte. Ignorée, elle laissait un plan de lots continuer à brûler
    // ses tours sur le mur.
    expect(
      estMurDeQuota(
        "Claude a interrompu l'appel : You've hit your 5-hour limit · resets 11pm (Europe/Paris)"
      )
    ).toBe(true)
  })

  it('NE ferme PAS le compte entier sur la limite d’UN modèle (Opus)', () => {
    // Le mur est indexé par compte (`quotaWallKey`, registry.ts) : le fermer sur « Opus limit »
    // refuserait aussi Sonnet et Haiku. Forme relevée par les guides publics.
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

/**
 * LA LIMITE D'UN SEUL MODÈLE. Le compte répond encore, sur un autre modèle : ce n'est pas le mur de
 * quota (`estMurDeQuota` reste faux) et le fil ne repart pas seul. Ignorée, la coupure n'était ni
 * reprise ni listée : deux fils ont été relancés à la main le 2026-11-12.
 */
describe('modeleDeLaLimite', () => {
  it('nomme le modèle sur le texte RÉEL de la coupure', () => {
    expect(modeleDeLaLimite(COUPURE_FABLE)).toBe('Fable')
    // Jumeau : le compte reste ouvert, le mur de quota ne se ferme pas sur ce refus.
    expect(estMurDeQuota(COUPURE_FABLE)).toBe(false)
  })

  it('lit aussi la forme « hit your … limit · resets » des guides publics', () => {
    expect(modeleDeLaLimite("You've hit your Opus limit · resets 3:45pm")).toBe('Opus')
  })

  it('ne prend JAMAIS une limite du compte pour celle d’un modèle', () => {
    for (const texte of [
      "Claude a interrompu l'appel : You've hit your session limit · resets 2am (Europe/Paris)",
      "You've hit your weekly limit · resets Sep 29, 2am (Europe/Paris)",
      "You've hit your 5-hour limit · resets 11pm (Europe/Paris)",
      'You have hit your usage limit for this month'
    ])
      expect(modeleDeLaLimite(texte), texte).toBeUndefined()
  })

  it('ne prend pas un nom de limite, ni une erreur ordinaire, pour un refus', () => {
    expect(modeleDeLaLimite('Opus limit documentation')).toBeUndefined()
    expect(modeleDeLaLimite('TypeError: undefined is not a function')).toBeUndefined()
    expect(modeleDeLaLimite(undefined)).toBeUndefined()
  })
})

describe('coupuresParLimiteDeModele', () => {
  const convs = [
    { id: 'a', lastAssistantStatus: 'failed' as const, lastAssistantError: COUPURE_FABLE },
    { id: 'b', lastAssistantStatus: 'failed' as const, lastAssistantError: 'usage limit reached' },
    { id: 'c', lastAssistantStatus: 'completed' as const, lastAssistantError: COUPURE_FABLE },
    {
      id: 'd',
      lastAssistantStatus: 'failed' as const,
      lastAssistantError: "You've hit your Opus limit · resets 3:45pm"
    },
    { id: 'e', lastAssistantStatus: 'failed' as const, lastAssistantError: COUPURE_FABLE }
  ]

  it('une ligne par modèle, dans l’ordre de la liste, sans les autres pastilles rouges', () => {
    expect(coupuresParLimiteDeModele(convs)).toEqual([
      { modele: 'Fable', ids: ['a', 'e'] },
      { modele: 'Opus', ids: ['d'] }
    ])
  })

  it('écarte un fil dont un tour tourne déjà', () => {
    expect(coupuresParLimiteDeModele(convs, new Set(['a', 'd']))).toEqual([
      { modele: 'Fable', ids: ['e'] }
    ])
  })

  it('la reprise du quota, elle, ne reprend pas ces fils : même modèle, même refus', () => {
    expect(conversationsCoupeesParQuota(convs).map((c) => c.id)).toEqual(['b'])
  })
})
