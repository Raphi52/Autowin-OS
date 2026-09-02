import { describe, expect, it } from 'vitest'
import {
  buildAutowinKaizenTask,
  selectionnerAppelsModele,
  type AutowinKaizenEvidence
} from './autowin-kaizen-context'

/*
  Mesuré sur les appels modèle réels de conv-105 (`prompt-observability/conv-105.jsonl`,
  2026-09-02) : 30 appels, dont DEUX échoués en position 6 et 7 — `subagent/build` coupé sur
  « You've hit your session limit », puis l'orchestrateur sur `error_during_execution`. La fenêtre
  chronologique que kaizen recevait (les 12 derniers, index 18 à 29) n'en contenait AUCUN.
*/
function appelsConv105(): Array<{ index: number; status: string }> {
  return Array.from({ length: 30 }, (_, index) => ({
    index,
    status: index === 6 || index === 7 ? 'failed' : 'completed'
  }))
}

describe('sélection des appels modèle du dossier kaizen', () => {
  it('garde les appels échoués de conv-105 que la fenêtre chronologique jetait', () => {
    const retenus = selectionnerAppelsModele(appelsConv105(), 12)
    expect(retenus).toHaveLength(12)
    expect(
      retenus.filter((appel) => appel.status === 'failed').map((appel) => appel.index)
    ).toEqual([6, 7])
  })

  it('rend les appels en ordre chronologique', () => {
    const index = selectionnerAppelsModele(appelsConv105(), 12).map((appel) => appel.index)
    expect(index).toEqual([...index].sort((a, b) => a - b))
  })

  it('complète avec les appels les plus récents', () => {
    const retenus = selectionnerAppelsModele(appelsConv105(), 12).map((appel) => appel.index)
    expect(retenus).toContain(29)
    expect(retenus.filter((valeur) => valeur >= 20)).toHaveLength(10)
  })

  it('reconnaît un échec porté par le seul champ error', () => {
    const calls = [
      ...Array.from({ length: 5 }, (_, i) => ({ index: i, error: i === 0 ? 'boom' : undefined })),
      ...Array.from({ length: 5 }, (_, i) => ({ index: 5 + i, error: undefined }))
    ]
    expect(selectionnerAppelsModele(calls, 3).map((appel) => appel.index)).toEqual([0, 8, 9])
  })

  it('garde les échecs les plus récents quand ils dépassent la limite', () => {
    const calls = Array.from({ length: 6 }, (_, i) => ({ index: i, status: 'failed' }))
    expect(selectionnerAppelsModele(calls, 2).map((appel) => appel.index)).toEqual([4, 5])
  })

  it('ne change rien quand tout tient sous la limite', () => {
    const calls = [
      { index: 0, status: 'completed' },
      { index: 1, status: 'failed' }
    ]
    expect(selectionnerAppelsModele(calls, 12)).toEqual(calls)
  })
})

/*
  Deuxieme endroit ou la MEME preuve disparaissait, mesure sur le dossier reel de conv-105 :
  meme retenus par la selection, les appels echoues etaient les PLUS ANCIENS des 12, et
  l'ajustement au budget retire les appels par la tete — 9 des 12 retires, dont les deux echecs.
  Un appel non abouti ne se sacrifie donc qu'en dernier, apres tous les appels reussis.
*/
function dossierGros(): AutowinKaizenEvidence {
  const appel = (index: number, status: string) => ({
    ts: `2026-09-02T0${index}:00:00.000Z`,
    turnId: `turn-appel-${index}`,
    iteration: 1,
    actor: 'subagent',
    phase: 'build',
    provider: 'claude',
    status,
    boundary: 'complet',
    limitation: 'aucune',
    response: 'r'.repeat(400)
  })
  return {
    conversation: {
      id: 'conv-105',
      title: 'dossier trop gros',
      messages: Array.from({ length: 24 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'm'.repeat(700),
        ts: 1_756_720_000_000 + i
      }))
    },
    activity: Array.from({ length: 50 }, (_, i) => ({
      ts: `2026-09-02T00:00:0${i % 10}.000Z`,
      kind: 'model',
      label: 'l'.repeat(300),
      provider: 'claude'
    })) as never,
    brainTraces: [],
    causalEvents: [],
    runs: [],
    promptCalls: [
      appel(1, 'failed'),
      ...Array.from({ length: 11 }, (_, i) => appel(i + 2, 'completed'))
    ],
    turnEvents: [],
    saisies: []
  }
}

describe('budget du dossier kaizen', () => {
  it('sacrifie les appels reussis avant l appel echoue', () => {
    const tache = buildAutowinKaizenTask('/kaizen conv-105', dossierGros())
    const dossier = JSON.parse(
      tache
        .slice(
          tache.indexOf('=== DOSSIER DE PREUVE AUTOWIN OS ===') + 36,
          tache.lastIndexOf('=== FIN DU DOSSIER ===')
        )
        .trim()
    ) as {
      promptCalls: Array<{ turnId: string; status?: string }>
      troncature?: Record<string, number>
    }
    expect(dossier.troncature?.promptCalls ?? 0).toBeGreaterThan(0)
    expect(dossier.promptCalls.map((appel) => appel.turnId)).toContain('turn-appel-1')
    expect(tache.length).toBeLessThanOrEqual(28_000)
  })
})
