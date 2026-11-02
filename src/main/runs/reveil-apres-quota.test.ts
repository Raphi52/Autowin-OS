import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MARGE_APRES_RETOUR_MS,
  PLAFOND_ATTENTE_MS,
  creerReveilApresQuota,
  type RunSuspenduParQuota
} from './reveil-apres-quota'

/**
 * UN RUN SUSPENDU PAR LE QUOTA REPART TOUT SEUL, APP OUVERTE (conv-1069, candidat 4 du scout).
 *
 * `resumeAfter` n'était relu qu'au démarrage (`index.ts`, filtre `repriseAutoRetenueParQuota`) et
 * par le bouton « Reprendre tout » : app ouverte, un run coupé à 11:01 par « resets 11:30am »
 * attendait le prochain redémarrage — à l'encontre du choix « reprise automatique, pas de bouton ».
 *
 * L'entrée qui ferait échouer ces tests si la correction était fausse : l'horloge avancée JUSTE
 * AVANT l'heure annoncée plus la marge (aucune reprise attendue), puis juste après (une seule).
 */
const DEMARRAGE = Date.parse('2026-10-22T08:00:00Z')
const HEURE_DE_RETOUR = Date.parse('2026-10-22T09:30:00Z')

type Etat = RunSuspenduParQuota & { publie?: boolean; action?: 'relancer' | 'rattacher' }

function monter(
  etats: Etat[],
  surveillerEncore?: () => boolean
): {
  relances: string[]
  etats: Etat[]
  reveil: ReturnType<typeof creerReveilApresQuota<Etat>>
} {
  const relances: string[] = []
  const reveil = creerReveilApresQuota<Etat>({
    demarrageMs: DEMARRAGE,
    listerRunsReprenables: () => etats,
    publicationDejaProuvee: (etat) => etat.publie === true,
    actionDeReprise: (etat) => etat.action ?? 'relancer',
    mettreEnFile: (tache) => tache(),
    relancer: async (etat) => {
      relances.push(etat.runId)
    },
    ...(surveillerEncore ? { surveillerEncore } : {})
  })
  return { relances, etats, reveil }
}

const suspendu = (
  runId: string,
  resumeAfter: number | undefined,
  decidedAt = DEMARRAGE + 1
): Etat => ({
  runId,
  quotaWall: { ...(resumeAfter !== undefined ? { resumeAfter } : {}), decidedAt }
})

describe('réveil après le mur de quota', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(DEMARRAGE + 60_000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('relance le run UNE fois, juste après l’heure annoncée (marge comprise), jamais avant', async () => {
    const { relances, reveil } = monter([suspendu('run-a', HEURE_DE_RETOUR)])
    reveil.replanifier()
    reveil.replanifier() // deux replanifications ne font pas deux relances

    await vi.advanceTimersByTimeAsync(HEURE_DE_RETOUR + MARGE_APRES_RETOUR_MS - Date.now() - 1)
    expect(relances).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(relances).toEqual(['run-a'])

    await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS * 4)
    expect(relances).toEqual(['run-a'])
    reveil.arreter()
  })

  it('une longue attente est découpée : l’horloge murale est relue (veille du poste)', async () => {
    const lointain = Date.now() + PLAFOND_ATTENTE_MS * 3
    const { relances, reveil } = monter([suspendu('run-a', lointain)])
    reveil.replanifier()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS)
    expect(relances).toEqual([])
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS * 2 + MARGE_APRES_RETOUR_MS)
    expect(relances).toEqual(['run-a'])
    reveil.arreter()
  })

  it('un mur posé PENDANT la session dont l’heure est déjà passée repart aussitôt', async () => {
    // Coupé à 9:00 (une heure après le démarrage), retour annoncé 9:55, replanifié seulement à 10:00.
    vi.setSystemTime(DEMARRAGE + 2 * 3_600_000)
    const { relances, reveil } = monter([
      suspendu('run-a', Date.now() - 5 * 60_000, DEMARRAGE + 3_600_000)
    ])
    reveil.replanifier()
    await vi.advanceTimersByTimeAsync(0)
    expect(relances).toEqual(['run-a'])
    reveil.arreter()
  })

  it('JUMEAU : un mur d’AVANT le démarrage, déjà échu, est laissé à la reprise de démarrage', async () => {
    const { relances, reveil } = monter([
      suspendu('run-a', DEMARRAGE - 60_000, DEMARRAGE - 3_600_000)
    ])
    reveil.replanifier()
    await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS * 2)
    expect(relances).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('JUMEAU : un mur sans heure annoncée attend le redémarrage, comme avant', async () => {
    const { relances, reveil } = monter([suspendu('run-a', undefined)])
    reveil.replanifier()
    await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS * 2)
    expect(relances).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('JUMEAU : rien ne repart si le mur a changé, a disparu, si le run est publié ou encore vivant', async () => {
    const etats = [
      suspendu('change', HEURE_DE_RETOUR),
      suspendu('disparu', HEURE_DE_RETOUR),
      { ...suspendu('publie', HEURE_DE_RETOUR), publie: true },
      { ...suspendu('vivant', HEURE_DE_RETOUR), action: 'rattacher' as const }
    ]
    const { relances, reveil } = monter(etats)
    reveil.replanifier()
    // Entre-temps : « Reprendre tout » a relancé `change`, qui a buté sur un NOUVEAU mur, et
    // `disparu` est allé au bout (son état reprenable est effacé).
    etats[0] = suspendu('change', HEURE_DE_RETOUR + 86_400_000, DEMARRAGE + 999)
    etats.splice(1, 1)
    await vi.advanceTimersByTimeAsync(HEURE_DE_RETOUR + MARGE_APRES_RETOUR_MS - Date.now())
    expect(relances).toEqual([])
    reveil.arreter()
  })

  it('plusieurs runs : chacun à son heure, dans l’ordre', async () => {
    const plusTard = HEURE_DE_RETOUR + 3_600_000
    const { relances, reveil } = monter([
      suspendu('tard', plusTard),
      suspendu('tot', HEURE_DE_RETOUR)
    ])
    reveil.replanifier()
    await vi.advanceTimersByTimeAsync(HEURE_DE_RETOUR + MARGE_APRES_RETOUR_MS - Date.now())
    expect(relances).toEqual(['tot'])
    await vi.advanceTimersByTimeAsync(plusTard - HEURE_DE_RETOUR)
    expect(relances).toEqual(['tot', 'tard'])
    reveil.arreter()
  })

  /*
   * Objection du contrôle final (conv-1423) : un fil annoncé « repart seule » pouvait n'avoir aucun
   * réveil prévu. Le réveil ne s'armait qu'aux échéances lues au dernier passage, et un départ écarté
   * à l'heure gardait sa clé dans `reveilles`, même une fois le fil redevenu éligible.
   *
   * fix-ok: mesuré sur le vrai `creerRepriseDesFils` : fil réactivé, 0 minuterie et 0 départ.
   */
  describe('surveillerEncore — un fil reste suivi, un run garde son contrat', () => {
    it('un départ écarté à l’heure repart au passage suivant', async () => {
      const etat: Etat = { ...suspendu('fil', HEURE_DE_RETOUR), action: 'rattacher' }
      const { relances, reveil } = monter([etat], () => true)
      reveil.replanifier()
      await vi.advanceTimersByTimeAsync(HEURE_DE_RETOUR - Date.now() + MARGE_APRES_RETOUR_MS)
      expect(relances).toEqual([])
      delete etat.action
      await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS)
      expect(relances).toEqual(['fil'])
      reveil.arreter()
    })

    it('JUMEAU : sans l’option, un run écarté à l’heure n’est pas retenté', async () => {
      const etat: Etat = { ...suspendu('run-a', HEURE_DE_RETOUR), action: 'rattacher' }
      const { relances, reveil } = monter([etat])
      reveil.replanifier()
      await vi.advanceTimersByTimeAsync(HEURE_DE_RETOUR - Date.now() + MARGE_APRES_RETOUR_MS)
      delete etat.action
      reveil.replanifier()
      await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS)
      expect(relances).toEqual([])
    })

    it('un départ réellement tenté ne se retente pas, même s’il échoue', async () => {
      const etats = [suspendu('fil', HEURE_DE_RETOUR)]
      let essais = 0
      const reveil = creerReveilApresQuota<Etat>({
        demarrageMs: DEMARRAGE,
        listerRunsReprenables: () => etats,
        publicationDejaProuvee: () => false,
        actionDeReprise: () => 'relancer',
        mettreEnFile: (tache) => tache(),
        relancer: async () => {
          essais += 1
          throw new Error('refus du modèle')
        },
        surveillerEncore: () => true
      })
      reveil.replanifier()
      await vi.advanceTimersByTimeAsync(HEURE_DE_RETOUR - Date.now() + 3 * PLAFOND_ATTENTE_MS)
      expect(essais).toBe(1)
      reveil.arreter()
    })

    it('rien à venir, mais encore à surveiller : le passage suivant reste prévu', async () => {
      const etats: Etat[] = []
      const { relances, reveil } = monter(etats, () => true)
      reveil.replanifier()
      expect(vi.getTimerCount()).toBe(1)
      // Après le démarrage, sinon ce mur serait celui de la reprise de démarrage (JUMEAU plus haut).
      etats.push(suspendu('fil', Date.now() + 1000))
      await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS)
      expect(relances).toEqual(['fil'])
      reveil.arreter()
    })

    it('JUMEAU : plus rien à surveiller, plus aucun minuteur', async () => {
      let encore = true
      const { reveil } = monter([], () => encore)
      reveil.replanifier()
      encore = false
      await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS)
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  it('arreter() annule l’attente en cours', async () => {
    const { relances, reveil } = monter([suspendu('run-a', HEURE_DE_RETOUR)])
    reveil.replanifier()
    reveil.arreter()
    await vi.advanceTimersByTimeAsync(HEURE_DE_RETOUR - Date.now() + PLAFOND_ATTENTE_MS)
    expect(relances).toEqual([])
  })
})
