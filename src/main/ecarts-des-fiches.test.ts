import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DemandeDeLaCarte, StatutDemande } from '../shared/carte-des-besoins'
import {
  DETAIL_MAX,
  FICHIER_DES_ECARTS,
  creerMesureDesEcarts,
  mesurerLesEcarts
} from './ecarts-des-fiches'
import { DOSSIER_DES_FICHES, type LigneDeFiche } from './fiches-de-demande'

const dossiers: string[] = []
afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true })
})

function demande(
  messageId: string | undefined,
  statut: StatutDemande,
  debut: number | null = 100,
  extra: Partial<DemandeDeLaCarte> = {}
): DemandeDeLaCarte {
  return {
    conversationId: 'conv-1',
    conversationTitre: 'fil',
    rang: 0,
    titre: `Demande ${messageId ?? '?'}`,
    statut,
    constat: `constat ${statut}`,
    ...(messageId ? { messageId } : {}),
    ...(debut === null ? {} : { debut }),
    ...extra
  }
}

function ligne(messageId: string, etat: StatutDemande, extra: Partial<LigneDeFiche> = {}) {
  return {
    v: 1,
    ts: 200,
    fiche: 'conv-1/a/RUN.md',
    conversationId: 'conv-1',
    messageId,
    demandeLe: 100,
    role: 'besoin',
    classement: 'declare',
    etat,
    constat: `constat ${etat}`,
    ...extra
  } satisfies LigneDeFiche
}

const mesurer = (demandes: DemandeDeLaCarte[], lignes: LigneDeFiche[]) =>
  mesurerLesEcarts({ demandes, lignes, calculeA: 999 })

describe('mesurerLesEcarts', () => {
  it('compte l’accord quand fiche et Board disent la même chose', () => {
    expect(mesurer([demande('m1', 'prouve')], [ligne('m1', 'prouve')])).toMatchObject({
      depuis: 100,
      calculeA: 999,
      demandesComparees: 1,
      enAccord: 1,
      ecartsDEtat: { total: 0, detail: [] },
      sansFiche: { total: 0, detail: [] },
      lignesSansDemande: 0
    })
  })

  it('nomme un écart d’état, avec les deux versions', () => {
    const bilan = mesurer([demande('m1', 'refuse')], [ligne('m1', 'prouve')])

    expect(bilan.enAccord).toBe(0)
    expect(bilan.ecartsDEtat).toEqual({
      total: 1,
      detail: [
        {
          conversationId: 'conv-1',
          messageId: 'm1',
          titre: 'Demande m1',
          fiche: 'conv-1/a/RUN.md',
          etatDeLaFiche: 'prouve',
          constatDeLaFiche: 'constat prouve',
          etatDuBoard: 'refuse',
          constatDuBoard: 'constat refuse'
        }
      ]
    })
  })

  it('nomme une demande sans fiche, avec ce que l’agent en avait dit', () => {
    const bilan = mesurer(
      [
        demande('m1', 'prouve'),
        demande('m2', 'sans-preuve', 150),
        demande('m3', 'refuse', 150, { besoin: { nature: 'nouveau' } })
      ],
      [ligne('m1', 'prouve')]
    )

    expect(bilan.sansFiche.total).toBe(2)
    expect(bilan.sansFiche.detail.map((d) => [d.messageId, d.nature])).toEqual([
      ['m2', 'sans-ligne'],
      ['m3', 'nouveau']
    ])
  })

  it('une question déclarée n’est pas un écart', () => {
    const bilan = mesurer(
      [demande('m1', 'prouve'), demande('m2', 'sans-preuve', 150, { besoin: { nature: 'aucun' } })],
      [ligne('m1', 'prouve')]
    )

    expect(bilan.questions).toBe(1)
    expect(bilan.sansFiche.total).toBe(0)
  })

  it('un tour en cours n’est ni un accord ni un écart, avec ou sans fiche', () => {
    const bilan = mesurer(
      [demande('m1', 'en-cours'), demande('m2', 'en-cours', 150)],
      [ligne('m1', 'prouve')]
    )

    expect(bilan).toMatchObject({
      demandesComparees: 2,
      enCours: 2,
      enAccord: 0,
      ecartsDEtat: { total: 0 },
      sansFiche: { total: 0 }
    })
  })

  it('ignore ce qui précède la première fiche : ces demandes n’ont jamais pu en avoir', () => {
    const bilan = mesurer(
      [demande('vieille', 'sans-preuve', 50), demande(undefined, 'sans-preuve', null)],
      [ligne('m1', 'prouve')]
    )

    expect(bilan.demandesComparees).toBe(0)
    expect(bilan.sansFiche.total).toBe(0)
  })

  it('une fiche dont la demande a une date inconnue reste comparée', () => {
    expect(mesurer([demande('m1', 'prouve', null)], [ligne('m1', 'prouve')]).enAccord).toBe(1)
  })

  it('compte une fiche dont le message a quitté le Board', () => {
    expect(mesurer([], [ligne('m1', 'prouve')]).lignesSansDemande).toBe(1)
  })

  it('compte ce qui sépare le rangement par fil du rangement par tâche', () => {
    const bilan = mesurer(
      [],
      [
        ligne('m1', 'prouve'),
        ligne('m2', 'prouve', { fiche: 'conv-1/b/RUN.md' }),
        ligne('m3', 'prouve', { conversationId: 'conv-2', role: 'suite', classement: 'deduit' })
      ]
    )

    expect(bilan).toMatchObject({
      fiches: 2,
      suites: 1,
      classementsDeduits: 1,
      filsAPlusieursFiches: 1,
      fichesAPlusieursFils: 1
    })
  })

  it('coupe le détail, jamais les totaux', () => {
    const nombre = DETAIL_MAX + 7
    const bilan = mesurer(
      Array.from({ length: nombre }, (_, i) => demande(`m${i}`, 'refuse')),
      Array.from({ length: nombre }, (_, i) => ligne(`m${i}`, 'prouve'))
    )

    expect(bilan.ecartsDEtat.total).toBe(nombre)
    expect(bilan.ecartsDEtat.detail).toHaveLength(DETAIL_MAX)
  })

  it('sans aucune fiche, rien n’est comparé', () => {
    expect(mesurer([demande('m1', 'prouve')], [])).toMatchObject({
      depuis: null,
      demandesComparees: 0
    })
  })
})

describe('creerMesureDesEcarts', () => {
  function banc(lireLaCarte?: () => Promise<{ projets: never[] }>) {
    const racine = mkdtempSync(join(tmpdir(), 'aos-ecarts-'))
    dossiers.push(racine)
    const attentes: (() => void)[] = []
    const lire = vi.fn(lireLaCarte ?? (async () => ({ projets: [] })))
    const mesure = creerMesureDesEcarts({
      racine,
      lireLaCarte: lire,
      lireLignes: async () => [ligne('m1', 'prouve')],
      maintenant: () => 7,
      attendre: (fn) => attentes.push(fn)
    })
    return { racine, attentes, lire, mesure }
  }

  it('écrit le bilan complet dans demandes/ecarts.json', async () => {
    const { racine, mesure } = banc()

    await mesure.mesurer()

    const bilan = JSON.parse(
      readFileSync(join(racine, DOSSIER_DES_FICHES, FICHIER_DES_ECARTS), 'utf8')
    ) as { calculeA: number; lignesSansDemande: number }
    expect(bilan).toMatchObject({ calculeA: 7, lignesSansDemande: 1 })
  })

  it('une rafale de fins de tour ne coûte qu’une mesure, et la suivante repart', async () => {
    const { attentes, lire, mesure } = banc()

    mesure.planifier()
    mesure.planifier()
    mesure.planifier()
    expect(attentes).toHaveLength(1)
    expect(lire).not.toHaveBeenCalled()

    attentes[0]()
    await vi.waitFor(() => expect(lire).toHaveBeenCalledTimes(1))
    mesure.planifier()
    expect(attentes).toHaveLength(2)
  })

  it('une mesure en échec ne remonte jamais vers le tour', async () => {
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { attentes, mesure } = banc(async () => {
      throw new Error('carte illisible')
    })

    mesure.planifier()
    attentes[0]()

    await vi.waitFor(() =>
      expect(avertir).toHaveBeenCalledWith(
        '[fiches] mesure des écarts impossible :',
        'carte illisible'
      )
    )
    avertir.mockRestore()
  })
})
