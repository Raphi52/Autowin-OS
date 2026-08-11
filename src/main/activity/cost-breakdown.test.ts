import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  costSamplesFrom,
  summarizeCostSamples,
  type PromptCallRecord
} from './prompt-observability'

/**
 * « Ou est passe l'argent ? » — la mesure qui rend le cout PILOTABLE.
 *
 * Contexte (2026-07-28) : il a fallu parser 114 fichiers .jsonl a la main pour decouvrir que la
 * session coutait 26,65 $/h, qu'un juge payait 1,5 $ pour 89 tokens de verdict, et que le
 * cache_read valait 0 partout (cause racine). Ces cas rejouent ces situations reelles.
 */
/** Fixture d'appel trace finement (prompt-observability). */
const callFixture = (actor: string, costUsd: number, outputTokens: number): PromptCallRecord =>
  ({
    id: `${actor}-${costUsd}-${outputTokens}`,
    ts: '2026-07-28T13:00:00.000Z',
    conversationId: 'conv-75',
    turnId: 't1',
    iteration: 0,
    actor,
    provider: 'claude',
    model: 'claude-opus-5',
    transport: 'cli',
    boundary: 'b',
    limitation: 'l',
    messages: [],
    options: {},
    response: '',
    usage: { inputTokens: 0, outputTokens, costUsd }
  }) as PromptCallRecord

/**
 * Contrat IPC : la mesure doit etre ATTEIGNABLE depuis le renderer, sinon elle reste un module
 * jamais appele (facade). On verifie la chaine complete main -> preload -> types.
 */
describe('os:costBreakdown — chaine IPC complete', () => {
  const read = (p: string): string => readFileSync(join(__dirname, '..', '..', p), 'utf8')

  it('le main enregistre le handler et borne la dimension recue', () => {
    const main = read('main/index.ts')
    expect(main).toMatch(/ipcMain\.handle\(\s*'os:costBreakdown'/)
    expect(main).toContain('summarizeCostSamples')
    // Exigence RENFORCEE : le handler doit reconcilier les DEUX journaux, sinon il sous-estime
    // le cout d'un facteur ~7 (mesure conv-75 : 2,83 $ annonces contre ~20,70 $ reels).
    expect(main).toContain('costSamplesFrom(')
    expect(main).toContain('loadConvActivity(')
    // Une dimension arbitraire venue du renderer ne doit pas etre passee telle quelle.
    expect(main).toContain('allowed.includes(')
  })

  it('le preload l’expose et les types le declarent', () => {
    expect(read('preload/index.ts')).toContain("ipcRenderer.invoke('os:costBreakdown'")
    expect(read('preload/index.d.ts')).toContain('costBreakdown:')
    expect(read('preload/index.d.ts')).toContain('cacheHitRatio')
  })
})

describe('comptabilite canonique des appels', () => {
  it('attribue le cout au modele reel tout en conservant l alias demande dans la trace', () => {
    const call = {
      ...callFixture('orchestrator', 0.42, 80),
      model: 'haiku',
      resolvedModel: 'claude-opus-5'
    }

    const rows = summarizeCostSamples(costSamplesFrom([call]), 'model')

    expect(rows).toEqual([expect.objectContaining({ key: 'claude-opus-5', costUsd: 0.42 })])
  })

  it('dedoublonne par usageCallId sans comparer des montants arrondis', () => {
    const call = callFixture('subagent', 0.3684004, 2834)
    const rows = summarizeCostSamples(
      costSamplesFrom(
        [call],
        [
          {
            kind: 'exec',
            label: 'subagent',
            provider: 'claude',
            usageCallId: call.id,
            costUsd: 0.3683996,
            outputTokens: 2840
          }
        ]
      )
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].calls).toBe(1)
  })

  it('ne recompte pas le total agrege chat quand les appels canoniques existent', () => {
    const call = callFixture('orchestrator', 0.5, 100)
    const rows = summarizeCostSamples(
      costSamplesFrom(
        [call],
        [{ kind: 'chat', provider: 'claude', costUsd: 0.5, outputTokens: 100 }]
      )
    )
    expect(rows.reduce((sum, row) => sum + row.calls, 0)).toBe(1)
  })

  it('rend visible un appel non chiffre au lieu de le transformer en zero certain', () => {
    const call = { ...callFixture('subagent', 0, 0), usage: undefined }
    const rows = summarizeCostSamples(costSamplesFrom([call]))
    expect(rows[0]).toMatchObject({ calls: 1, unpricedCalls: 1, costUsd: 0 })
  })

  it("enrichit l'appel echoue avec son usage tardif au lieu de jeter ses tokens", () => {
    const failed = {
      ...callFixture('orchestrator', 0, 0),
      usage: undefined,
      status: 'failed' as const
    }
    const rows = summarizeCostSamples(
      costSamplesFrom(
        [failed],
        [
          {
            kind: 'chat-usage',
            label: 'tour en timeout',
            provider: 'claude',
            inputTokens: 120,
            outputTokens: 8,
            cacheReadTokens: 20
          }
        ]
      )
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      calls: 1,
      inputTokens: 120,
      outputTokens: 8,
      cacheReadTokens: 20,
      unpricedCalls: 1
    })
  })

  it('calcule le cache comme une part des tokens entree', () => {
    const call = {
      ...callFixture('subagent', 1, 10),
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 80, costUsd: 1 }
    }
    expect(summarizeCostSamples(costSamplesFrom([call]))[0].cacheHitRatio).toBe(0.8)
  })
})

/**
 * RECONCILIATION DES DEUX JOURNAUX — le defaut trouve le 2026-07-28 sur conv-75.
 *
 * Le breakdown base sur les seuls prompt-calls annonçait 2,83 $ pour une conversation qui avait
 * coute ~20,70 $ : les deux appels dominants (10,90 $ et 5,72 $) ne vivaient que dans le journal
 * d'activite. Ces cas figent la correction ET son risque principal (le double comptage).
 */
describe('costSamplesFrom — les deux journaux, sans double comptage', () => {
  const activity = (label: string, costUsd: number, outputTokens = 0, model = 'claude-opus-5') => ({
    kind: 'exec',
    label,
    provider: 'claude',
    model,
    costUsd,
    outputTokens
  })

  it('capte un cout present UNIQUEMENT dans l’activite (le cas des 10,90 $)', () => {
    const rows = summarizeCostSamples(
      costSamplesFrom([], [activity('subagent', 10.9, 5000)]),
      'actor'
    )
    expect(rows[0]).toMatchObject({ key: 'subagent' })
    expect(rows[0].costUsd).toBeCloseTo(10.9)
  })

  it('NE COMPTE PAS DEUX FOIS un appel present dans les deux journaux', () => {
    // Meme modele, meme cout, meme sortie => meme appel, vu par deux journaux.
    const call = { ...callFixture('subagent', 0.3684, 2834) }
    const samples = costSamplesFrom([call], [activity('subagent', 0.3684, 2834)])
    expect(samples).toHaveLength(1)
    expect(summarizeCostSamples(samples)[0].costUsd).toBeCloseTo(0.3684)
  })

  it('reconstitue le total REEL de conv-75 (~20,70 $) au lieu des 2,83 $ partiels', () => {
    // Les 4 sous-agents traces DES DEUX COTES + les 2 gros presents seulement en activite.
    const calls = [
      callFixture('subagent', 0.3684, 2834),
      callFixture('subagent', 0.6686, 4138),
      callFixture('subagent', 0.8766, 7109),
      callFixture('subagent', 0.9276, 7722),
      callFixture('orchestrator', 0.1752, 443),
      callFixture('orchestrator', 0.0345, 557)
    ]
    const acts = [
      activity('subagent', 10.9005, 9001),
      activity('subagent', 5.7217, 9002),
      activity('subagent', 1.1095, 9003),
      activity('subagent', 0.3684, 2834), // doublon des prompt-calls
      activity('subagent', 0.6686, 4138), // doublon
      {
        kind: 'conversation-route',
        label: 'Contexte courant conservé',
        costUsd: 0.099,
        outputTokens: 31
      }
    ]
    const rows = summarizeCostSamples(costSamplesFrom(calls, acts), 'actor')
    const total = rows.reduce((sum, row) => sum + row.costUsd, 0)
    expect(total).toBeGreaterThan(20) // avant la correction : 2,83 $
    expect(total).toBeLessThan(21)
    expect(rows[0].key).toBe('subagent') // le poste dominant est bien identifie
    expect(rows.find((r) => r.key === 'router')?.costUsd).toBeCloseTo(0.099)
  })

  it('ecarte les entrees sans cout NI tokens (bruit du journal)', () => {
    const samples = costSamplesFrom(
      [],
      [
        { kind: 'exec', label: 'subagent' },
        { kind: 'gate', label: 'gate', costUsd: 0, outputTokens: 0 }
      ]
    )
    expect(samples).toEqual([])
  })

  it('attribue le routage a un acteur « router » distinct', () => {
    const rows = summarizeCostSamples(
      costSamplesFrom(
        [],
        [{ kind: 'conversation-route', label: 'route', costUsd: 0.099, outputTokens: 31 }]
      )
    )
    expect(rows[0].key).toBe('router')
  })

  it('sans activite fournie, le resultat egale l’ancien comportement', () => {
    const calls = [callFixture('judge', 1.5, 89)]
    expect(summarizeCostSamples(costSamplesFrom(calls))[0].costUsd).toBeCloseTo(1.5)
  })
})

describe('acteur d’une entree d’activite — le kind decide, jamais le label seul', () => {
  it('une entree `chat` ne transforme PAS le texte du message en acteur', () => {
    // Cas reel (conv-75) : le label valait « reprend pardon » et apparaissait comme un acteur.
    const rows = summarizeCostSamples(
      costSamplesFrom(
        [],
        [{ kind: 'chat', label: 'reprend pardon', costUsd: 0.34, outputTokens: 120 }]
      )
    )
    expect(rows.map((r) => r.key)).not.toContain('reprend pardon')
    expect(rows[0].key).toBe('orchestrator')
  })

  it('mappe chaque kind vers son role', () => {
    const rows = summarizeCostSamples(
      costSamplesFrom(
        [],
        [
          { kind: 'exec', label: 'subagent', costUsd: 5, outputTokens: 10 },
          { kind: 'judge', label: 'peu importe', costUsd: 3, outputTokens: 11 },
          { kind: 'conversation-route', label: 'Contexte conservé', costUsd: 1, outputTokens: 12 },
          { kind: 'chat', label: 'un message quelconque', costUsd: 0.5, outputTokens: 13 }
        ]
      )
    )
    expect(rows.map((r) => r.key)).toEqual(['subagent', 'judge', 'router', 'orchestrator'])
  })

  it('une entree `exec` sans label reste un subagent (defaut sur), pas « (inconnu) »', () => {
    const rows = summarizeCostSamples(
      costSamplesFrom([], [{ kind: 'exec', costUsd: 2, outputTokens: 5 }])
    )
    expect(rows[0].key).toBe('subagent')
  })
})

/**
 * DOUBLE COMPTAGE — constate a l'ecran le 2026-07-29 sur un orchestrate reel : le journal portait
 * 16 appels / 11,00 $ et l'indicateur affichait 32 appels / 21,99 $, soit tout compte DEUX FOIS.
 *
 * L'ancienne empreinte `modele|cout|tokensSortie` echouait sur deux de ses trois composants : les
 * entrees d'activite n'ecrivent AUCUN modele, et les deux journaux ne comptent pas les tokens de
 * sortie pareil (1444 contre 1436 sur le meme appel). Seul le cout concorde exactement.
 */
describe('reconciliation des deux journaux — ni double comptage, ni perte', () => {
  // Valeurs EXACTES relevees dans les deux journaux de l'instance orch3 (meme appel).
  const cout1 = 0.5715929999999999
  const cout2 = 0.810577

  it('LE CAS REEL : modele absent et tokens differents → l’appel est compte UNE fois', () => {
    const calls = [callFixture('subagent', cout1, 1436), callFixture('subagent', cout2, 4454)]
    const activity = [
      { kind: 'exec', label: 'subagent', provider: 'claude', costUsd: cout1, outputTokens: 1444 },
      { kind: 'exec', label: 'subagent', provider: 'claude', costUsd: cout2, outputTokens: 4464 }
    ]
    const samples = costSamplesFrom(calls, activity)
    expect(samples).toHaveLength(2)
    const rows = summarizeCostSamples(samples, 'actor')
    expect(rows[0].calls).toBe(2)
    expect(rows[0].costUsd).toBeCloseTo(cout1 + cout2, 6)
  })

  it('DEUX appels DISTINCTS au meme cout restent DEUX (l’appariement est un-pour-un)', () => {
    // Un dedoublonnage par ensemble ecrasait ce cas et SOUS-comptait la facture.
    const calls = [callFixture('subagent', 0.25, 100), callFixture('subagent', 0.25, 100)]
    const samples = costSamplesFrom(calls, [])
    expect(samples).toHaveLength(2)
    expect(summarizeCostSamples(samples, 'actor')[0].costUsd).toBeCloseTo(0.5, 6)
  })

  it('une entree d’activite SANS equivalent est CONSERVEE (le sous-agent invisible)', () => {
    // Mesure conv-75 : 2,83 $ vus cote prompt-calls contre ~20,70 $ reels — l'activite porte le reste.
    const samples = costSamplesFrom(
      [callFixture('orchestrator', 0.1, 50)],
      [{ kind: 'exec', label: 'subagent', provider: 'claude', costUsd: 9.9, outputTokens: 3000 }]
    )
    expect(samples).toHaveLength(2)
    const total = summarizeCostSamples(samples, 'actor').reduce((sum, r) => sum + r.costUsd, 0)
    expect(total).toBeCloseTo(10, 6)
  })

  it('un appariement ne consomme qu’UNE fois : 1 prompt-call + 2 activites au meme cout → 2', () => {
    const samples = costSamplesFrom(
      [callFixture('subagent', 0.4, 200)],
      [
        { kind: 'exec', label: 'subagent', provider: 'claude', costUsd: 0.4, outputTokens: 210 },
        { kind: 'exec', label: 'subagent', provider: 'claude', costUsd: 0.4, outputTokens: 210 }
      ]
    )
    expect(samples).toHaveLength(2)
  })

  it('deduplique un reglement detache rejoue apres un second crash', () => {
    const recovered = {
      kind: 'exec',
      label: 'build',
      provider: 'claude',
      costUsd: 1.1564625,
      inputTokens: 100,
      outputTokens: 20,
      usageCallId: 'detached:run-recovered:agent-build'
    }

    const samples = costSamplesFrom([], [recovered, recovered])

    expect(samples).toHaveLength(1)
    expect(samples[0].costUsd).toBe(1.1564625)
  })

  it('des providers DIFFERENTS au meme cout ne s’apparient pas', () => {
    const samples = costSamplesFrom(
      [callFixture('subagent', 0.3, 100)],
      [{ kind: 'exec', label: 'subagent', provider: 'codex', costUsd: 0.3, outputTokens: 100 }]
    )
    expect(samples).toHaveLength(2)
  })

  it('une entree sans cout ni tokens de sortie est ecartee', () => {
    const samples = costSamplesFrom(
      [],
      [{ kind: 'exec', label: 'subagent', provider: 'claude', costUsd: 0, outputTokens: 0 }]
    )
    expect(samples).toHaveLength(0)
  })
})
