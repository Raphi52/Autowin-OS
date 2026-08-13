import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  callsLabel,
  formatDuration,
  formatUsd,
  sharePercent,
  spendingRows,
  summarizeConversationCost,
  timeSharePercent,
  type CostRow
} from './conversation-cost'

/**
 * COMBIEN COÛTE CETTE CONVERSATION.
 *
 * Le canal `os:costBreakdown` existait — main, preload, test de contrat — et AUCUN appelant renderer
 * ne l'utilisait. Il a fallu parser 114 fichiers .jsonl à la main pour découvrir 26,65 $/h. Un module
 * atteignable mais jamais appelé est du théâtre : ces tests verrouillent l'affichage ET son câblage.
 */
const row = (over: Partial<CostRow> & { key: string }): CostRow => ({
  calls: 1,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheHitRatio: 0,
  unpricedCalls: 0,
  ...over
})

describe('formatUsd — une dépense réelle ne doit pas s’arrondir à zéro', () => {
  it('montant courant au centime, virgule française', () => {
    expect(formatUsd(10.94)).toBe('10,94 $')
    expect(formatUsd(1)).toBe('1,00 $')
  })

  it('un micro-coût garde 3 décimales (0,00 $ effacerait une dépense)', () => {
    expect(formatUsd(0.003)).toBe('0,003 $')
  })

  it('zéro exact reste lisible ; une valeur non numérique ne prétend rien', () => {
    expect(formatUsd(0)).toBe('0 $')
    expect(formatUsd(Number.NaN)).toBe('—')
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('summarizeConversationCost — le total, et le poste qui l’explique', () => {
  it('somme, appels et poste le plus cher', () => {
    const summary = summarizeConversationCost([
      row({ key: 'subagent', costUsd: 10.05, calls: 18 }),
      row({ key: 'orchestrator', costUsd: 0.86, calls: 12 }),
      row({ key: 'judge', costUsd: 0.03, calls: 1 })
    ])
    expect(summary.totalUsd).toBeCloseTo(10.94, 5)
    expect(summary.calls).toBe(31)
    expect(summary.topKey).toBe('subagent')
    expect(summary.label).toBe('10,94 $')
  })

  it('cache pondéré par les TOKENS, pas une moyenne des ratios', () => {
    // Une ligne minuscule à 100 % de cache ne doit pas masquer une grosse ligne à 0 %.
    const summary = summarizeConversationCost([
      row({ key: 'gros', costUsd: 9, inputTokens: 900_000, cacheReadTokens: 0, calls: 10 }),
      row({ key: 'petit', costUsd: 0.01, inputTokens: 100, cacheReadTokens: 100, calls: 1 })
    ])
    expect(summary.cacheHitRatio).toBeLessThan(0.01)
    expect(summary.rewritingContext).toBe(true)
  })

  it('un bon ratio de cache ne déclenche AUCUNE alerte', () => {
    const summary = summarizeConversationCost([
      row({
        key: 'orchestrator',
        costUsd: 2,
        inputTokens: 100_000,
        cacheReadTokens: 90_000,
        calls: 20
      })
    ])
    expect(summary.cacheHitRatio).toBeCloseTo(0.9, 2)
    expect(summary.rewritingContext).toBe(false)
  })

  it('PEU d’appels mais un GROS contexte réécrit DÉCLENCHE l’alerte', () => {
    // Defaut constate a l'ecran le 2026-07-29 : 3 appels, 900 k tokens reecrits, cache 5 %, et AUCUNE
    // alerte — le garde exigeait 5 appels. Le volume est le signal, pas le nombre d'appels.
    const summary = summarizeConversationCost([
      row({ key: 'subagent', costUsd: 10.05, inputTokens: 900_000, cacheReadTokens: 0, calls: 1 }),
      row({
        key: 'orchestrator',
        costUsd: 0.86,
        inputTokens: 2100,
        cacheReadTokens: 41_000,
        calls: 1
      }),
      row({ key: 'judge', costUsd: 0.03, inputTokens: 800, cacheReadTokens: 9000, calls: 1 })
    ])
    expect(summary.calls).toBe(3)
    expect(Math.round(summary.cacheHitRatio * 100)).toBe(6)
    expect(summary.rewritingContext).toBe(true)
  })

  it('un contexte TROP PETIT ne produit pas de verdict de cache', () => {
    // 2 appels sans cache, c'est un démarrage normal — pas un diagnostic.
    const summary = summarizeConversationCost([
      row({ key: 'orchestrator', costUsd: 0.5, inputTokens: 5000, cacheReadTokens: 0, calls: 2 })
    ])
    expect(summary.rewritingContext).toBe(false)
  })

  it('un journal VIDE ne prétend rien (et l’indicateur ne s’affiche pas)', () => {
    const summary = summarizeConversationCost([])
    expect(summary.totalUsd).toBe(0)
    expect(summary.topKey).toBeUndefined()
    expect(summary.rewritingContext).toBe(false)
  })

  it('une ligne CORROMPUE est ignorée, pas sommée en un total faux mais crédible', () => {
    const summary = summarizeConversationCost([
      row({ key: 'ok', costUsd: 2 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      row({ key: 'texte', costUsd: 'cher' as any }),
      row({ key: 'négatif', costUsd: -5 }),
      row({ key: 'nan', costUsd: Number.NaN })
    ])
    expect(summary.totalUsd).toBe(2)
    expect(summary.topKey).toBe('ok')
  })
})

describe('callsLabel — vu a l’ecran en « 1 appels »', () => {
  it('singulier a 1, pluriel au-dela, et zero au pluriel (« 0 appels »)', () => {
    expect(callsLabel(1)).toBe('1 appel')
    expect(callsLabel(3)).toBe('3 appels')
    expect(callsLabel(0)).toBe('0 appel')
  })
})

describe('spendingRows / sharePercent — la part se lit sans comparer des nombres', () => {
  it('trie par coût et écarte les postes à 0 $ (ils n’expliquent aucune dépense)', () => {
    const detail = spendingRows([
      row({ key: 'petit', costUsd: 1 }),
      row({ key: 'rien', costUsd: 0 }),
      row({ key: 'gros', costUsd: 9 })
    ])
    expect(detail.map((r) => r.key)).toEqual(['gros', 'petit'])
  })

  it('part en pourcentage entier ; total nul → 0 (jamais une division par zéro)', () => {
    expect(sharePercent(row({ key: 'a', costUsd: 9 }), 10)).toBe(90)
    expect(sharePercent(row({ key: 'a', costUsd: 1 }), 0)).toBe(0)
  })
})

/**
 * CÂBLAGE — le défaut d'origine n'était pas l'absence de calcul, c'était l'absence d'APPELANT.
 * Ces tests échouent si l'indicateur redevient un module mort.
 */
describe('câblage — l’indicateur est réellement monté dans le composeur', () => {
  const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8')

  it('ChatView monte le composant avec la conversation active', () => {
    const chat = read('ChatView.tsx')
    expect(chat).toContain(
      "import { ConversationCostIndicator } from './ConversationCostIndicator'"
    )
    expect(chat).toContain('<ConversationCostIndicator')
    expect(chat).toMatch(/conversationId=\{activeId \?\? undefined\}/)
    // La dépense d'un tour n'est lisible qu'à la FIN du tour → busy doit être transmis.
    expect(chat).toMatch(/busy=\{busy\}/)
  })

  it('le composant appelle bien le canal existant (aucun second calcul de coût)', () => {
    const source = read('ConversationCostIndicator.tsx')
    expect(source).toContain("window.api.costBreakdown('actor', conversationId)")
    // Le renderer ne doit RIEN recalculer : un deuxième calcul serait une deuxième vérité.
    expect(source).not.toMatch(/costUsd\s*[+*]/)
  })

  it('rien dépensé → rien affiché (pas de « 0 $ » qui ferait croire à une mesure)', () => {
    expect(read('ConversationCostIndicator.tsx')).toContain('summary.calls <= 0')
  })
})

/**
 * LE TEMPS, pas seulement l'argent.
 *
 * Demande du 2026-07-29 : « je trouve que les operations dans autowin OS sont lentes, j'aimerais
 * maximiser la vitesse, mais d'abord faut pouvoir mesurer. » Le poste le plus LENT n'est pas forcement
 * le plus cher — un seul des deux etait mesure.
 */
describe('formatDuration — lisible, et honnete sur l’absence de mesure', () => {
  it('sous la seconde en ms, puis en secondes a une decimale', () => {
    expect(formatDuration(430)).toBe('430 ms')
    expect(formatDuration(4200)).toBe('4,2 s')
  })

  it('au-dela d’une minute, en minutes et secondes', () => {
    expect(formatDuration(192_000)).toBe('3 min 12 s')
    expect(formatDuration(180_000)).toBe('3 min')
  })

  it('au-dela d’une heure, en heures et minutes', () => {
    expect(formatDuration(3_900_000)).toBe('1 h 05')
  })

  it('RIEN de mesure -> undefined, jamais « 0 s » (qui ferait croire a l’instantane)', () => {
    expect(formatDuration(0)).toBeUndefined()
    expect(formatDuration(-5)).toBeUndefined()
    expect(formatDuration(Number.NaN)).toBeUndefined()
  })
})

describe('durée agrégée — le poste le plus lent peut ne pas être le plus cher', () => {
  it('somme les durées des lignes', () => {
    const summary = summarizeConversationCost([
      row({ key: 'subagent', costUsd: 9, durationMs: 120_000 }),
      row({ key: 'judge', costUsd: 1, durationMs: 5_000 })
    ])
    expect(summary.durationMs).toBe(125_000)
  })

  it('une durée absente ou aberrante ne fausse pas le total', () => {
    const summary = summarizeConversationCost([
      row({ key: 'a', costUsd: 1, durationMs: 1000 }),
      row({ key: 'b', costUsd: 1 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      row({ key: 'c', costUsd: 1, durationMs: 'lent' as any }),
      row({ key: 'd', costUsd: 1, durationMs: -50 })
    ])
    expect(summary.durationMs).toBe(1000)
  })

  it('part du TEMPS distincte de la part du COÛT — le cas qui motive la mesure', () => {
    // Le juge coute 10 % de la facture mais prend 60 % du temps : invisible jusqu'ici.
    const cheapButSlow = row({ key: 'judge', costUsd: 1, durationMs: 60_000 })
    const dearButFast = row({ key: 'subagent', costUsd: 9, durationMs: 40_000 })
    const summary = summarizeConversationCost([cheapButSlow, dearButFast])
    expect(sharePercent(cheapButSlow, summary.totalUsd)).toBe(10)
    expect(timeSharePercent(cheapButSlow, summary.durationMs)).toBe(60)
  })

  it('sans aucune durée mesurée, le total est 0 et rien ne sera affiché', () => {
    const summary = summarizeConversationCost([row({ key: 'a', costUsd: 1 })])
    expect(summary.durationMs).toBe(0)
    expect(formatDuration(summary.durationMs)).toBeUndefined()
  })

  it('part du temps : division par zéro impossible', () => {
    expect(timeSharePercent(row({ key: 'a', durationMs: 10 }), 0)).toBe(0)
    expect(timeSharePercent(row({ key: 'a' }), 100)).toBe(0)
  })
})

describe('câblage — la durée est écrite ET affichée', () => {
  const read2 = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8')

  it('le journal d’activité porte la durée de l’étape d’orchestration', () => {
    expect(read2('../../../main/commands.ts')).toContain('durationMs: step.durationMs')
  })

  it('le tour de chat est mesuré de bout en bout', () => {
    const main = read2('../../../main/index.ts')
    expect(main).toContain('const turnStartedAtMs = performance.now()')
    expect(main).toContain('durationMs: turnDurationMs')
  })

  it('l’agrégation additionne la durée des deux journaux', () => {
    expect(read2('../../../main/activity/prompt-observability.ts')).toContain(
      'row.durationMs += sample.durationMs'
    )
  })

  it('le panneau affiche le temps par poste', () => {
    const panel = read2('ConversationCostIndicator.tsx')
    expect(panel).toContain('data-testid={`conversation-time-${row.key}`}')
    expect(panel).toContain('timeSharePercent(row, summary.durationMs)')
  })
})

describe('unknown pricing', () => {
  it('keeps an unpriced provider call visible and explicit', () => {
    const summary = summarizeConversationCost([
      row({ key: 'codex', calls: 1, outputTokens: 50, unpricedCalls: 1 })
    ])
    expect(summary.calls).toBe(1)
    expect(summary.unpricedCalls).toBe(1)
    expect(summary.label).toMatch(/non expos/i)
  })
})
