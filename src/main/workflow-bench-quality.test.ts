import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  classer,
  etiquetteDe,
  lireVerdict,
  promptComparaison,
  type Livrable
} from './workflow-bench-quality'
import { nonMesurable } from './workflow-bench'

/**
 * Ce que ces tests protègent : que le banc juge enfin la VALEUR et non le prix, et qu'il le fasse
 * sans biais. Mesuré le 2026-08-06 — il avait recommandé un workflow parce qu'il coûtait 0,65 $ de
 * moins, sans que rien n'ait lu ce qu'il produisait.
 */

const livrables: Livrable[] = [
  { profileId: 'eclair', profileName: 'Éclair', texte: 'Trois lignes creuses.', costUsd: 4.47 },
  {
    profileId: 'panel-critique',
    profileName: 'Panel critique',
    texte: 'Cause prouvée à supervisor.ts:163, correctif et signal proposés.',
    costUsd: 3.82
  }
]

/**
 * Un juge de qualité que personne n'appelle ne juge rien. Trois façades de cette forme ont été
 * démasquées le 2026-08-05 — une préférence que nul ne lisait, un prompt commun à tout un fan-out,
 * un catalogue jamais semé —, aucune visible dans 3 600 tests. Ce contrat ferme la quatrième.
 */
describe('le juge est REELLEMENT branché', () => {
  const bench = readFileSync(new URL('./workflow-bench.ts', import.meta.url), 'utf8')
  const ipc = readFileSync(new URL('./workflow-bench-ipc.ts', import.meta.url), 'utf8')
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

  it('le banc appelle le juge et en tire un classement', () => {
    expect(bench).toMatch(/deps\.judgeQuality\(promptComparaison\(/)
    expect(bench).toMatch(/classer\(livrables, lireVerdict\(/)
  })

  it('les livrables sont collectés — sans eux il n’y a rien à juger', () => {
    expect(bench).toMatch(/texte: result\.result/)
  })

  it('le point d’entrée fournit un vrai juge, pas une promesse vide', () => {
    expect(ipc).toMatch(/judgeQuality: deps\.judgeQuality/)
    expect(index).toMatch(/judgeQuality: async \(prompt\)/)
    expect(index).toMatch(/os\.registry\.send\(/)
  })
})

/**
 * Mesuré le 2026-08-06 : le banc joue en SÉRIE. Le premier arm a épuisé le quota de session, et le
 * second — un panel de trois juges, donc plus gourmand — s'est arrêté en 57 s sur « Budget d'agents
 * atteint » puis « session limit ». Le classement l'a lu comme « non vert », donc moins bon. Il
 * n'était pas moins bon : il n'avait pas tourné. Ce biais frappe TOUJOURS le workflow le plus
 * ambitieux, quelle que soit sa qualité — l'exact contraire de ce qu'un banc doit mesurer.
 */
describe('non mesuré n’est pas perdu', () => {
  it('reconnaît une enveloppe épuisée, pas un échec de fond', () => {
    for (const raison of [
      "claude result error: You've hit your session limit · resets 2:10pm",
      "Budget d'agents atteint (10)",
      'quota dépassé',
      'rate-limit provider'
    ]) {
      expect(nonMesurable(raison), raison).toBe(true)
    }
  })

  it('un VRAI échec reste un échec — on ne blanchit pas tout', () => {
    for (const raison of [
      'TypeError: cannot read properties of undefined',
      'le graphe est invalide',
      'timeout du provider'
    ]) {
      expect(nonMesurable(raison), raison).toBe(false)
    }
  })
})

describe('la comparaison est aveugle', () => {
  it('le juge ne voit AUCUN nom de workflow — sinon un nom qui sonne sérieux gagnerait', () => {
    const p = promptComparaison('diagnostiquer le budget', livrables)
    expect(p).not.toContain('Panel critique')
    expect(p).not.toContain('Éclair')
    expect(p).not.toContain('eclair')
    expect(p).toContain('LIVRABLE A')
    expect(p).toContain('LIVRABLE B')
  })

  it('un livrable vide est montré comme vide, pas masqué', () => {
    const p = promptComparaison('o', [{ ...livrables[0], texte: '   ' }])
    expect(p).toContain('(vide)')
  })

  it('la consigne refuse explicitement « plus long = meilleur »', () => {
    const p = promptComparaison('o', livrables)
    expect(p).toMatch(/plus long n'est pas meilleur/i)
  })
})

describe('lire le verdict', () => {
  it('reconnaît la lettre gagnante', () => {
    expect(lireVerdict('MEILLEUR: B\nRAISON: la cause est prouvée', 2)).toMatchObject({
      etiquette: 'B',
      raison: 'la cause est prouvée'
    })
  })

  it('une lettre HORS PLAGE ne désigne personne', () => {
    expect(lireVerdict('MEILLEUR: D', 2)).toBeUndefined()
  })

  it('une réponse incomprise ne devine pas un gagnant', () => {
    expect(lireVerdict('les deux se valent, difficile de trancher', 2)).toBeUndefined()
  })

  it('la raison est facultative — la lettre suffit à classer', () => {
    expect(lireVerdict('MEILLEUR: A', 2)?.raison).toBe('')
  })
})

describe('classer', () => {
  it('la QUALITÉ décide, même quand le gagnant coûte plus cher', () => {
    const chers: Livrable[] = [
      { ...livrables[0], costUsd: 1 },
      { ...livrables[1], costUsd: 9 }
    ]
    const c = classer(chers, { etiquette: 'B', raison: 'preuves' })
    expect(c?.gagnantProfileId).toBe('panel-critique')
    // Le coût ne décide plus : il dit ce que la qualité a coûté EN PLUS.
    expect(c?.surcoutUsd).toBe(8)
  })

  it('un gagnant déjà le moins cher n’affiche aucun surcoût', () => {
    expect(classer(livrables, { etiquette: 'B', raison: 'x' })?.surcoutUsd).toBe(0)
  })

  it('sans verdict, AUCUN classement — le banc dit qu’il ne sait pas', () => {
    expect(classer(livrables, undefined)).toBeUndefined()
  })

  it('les étiquettes suivent l’alphabet', () => {
    expect([0, 1, 2].map(etiquetteDe)).toEqual(['A', 'B', 'C'])
  })
})
