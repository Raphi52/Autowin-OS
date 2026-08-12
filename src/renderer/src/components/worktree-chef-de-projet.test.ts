import { describe, expect, it } from 'vitest'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'
import {
  formatAttente,
  regrouperParChantier,
  resumerFlux,
  VERDICTS_CHANTIER
} from './worktree-chef-de-projet'

/**
 * Le résumé chef de projet, et surtout les deux mensonges qu'il ne doit pas raconter :
 * gonfler le nombre de décisions à prendre, et peindre en terminé ce dont le verdict est inconnu.
 */

const MAINTENANT = 1_800_000_000_000

const run = (partiel: Partial<WorktreeAgentActivity>): WorktreeAgentActivity => ({
  agentId: partiel.agentId ?? 'run-1',
  agentName: partiel.agentName ?? 'Agent',
  state: partiel.state ?? 'working',
  files: partiel.files ?? [],
  startedAtMs: partiel.startedAtMs ?? MAINTENANT - 60_000,
  ...partiel
})

describe('regroupement par chantier', () => {
  it('regroupe les runs par branche de départ, une ligne par chantier', () => {
    const chantiers = regrouperParChantier(
      [
        run({ agentId: 'a', baseBranch: 'feature/x' }),
        run({ agentId: 'b', baseBranch: 'feature/x' }),
        run({ agentId: 'c', baseBranch: 'main' })
      ],
      MAINTENANT
    )
    expect(chantiers.map((c) => c.branche)).toEqual(['feature/x', 'main'])
    expect(chantiers[0].runs).toBe(2)
  })

  it('un chantier prend le verdict le PLUS urgent de ses runs', () => {
    // Un chantier dont un seul run attend une décision attend une décision : le noyer dans neuf runs
    // « en cours » le rendrait invisible, ce qui est exactement l'inverse du but.
    const [chantier] = regrouperParChantier(
      [
        run({ agentId: 'a', baseBranch: 'feature/x', state: 'working' }),
        run({ agentId: 'b', baseBranch: 'feature/x', state: 'conflict' }),
        run({ agentId: 'c', baseBranch: 'feature/x', state: 'merged' })
      ],
      MAINTENANT
    )
    expect(chantier.verdict).toBe('a-toi')
    expect(chantier.aToi).toBe(1)
  })

  it('ne compte PAS un run interrompu comme une décision à prendre', () => {
    // MESURÉ le 2026-08-12 dans ce dépôt : 146 bureaux annoncés bloqués pour SEPT réels, parce que 118
    // runs coupés par un arrêt de l'application portaient `blocked` + `merge-failed` par défaut. Ce
    // test est la garde contre le retour de cette inflation d'un facteur 20.
    const interrompus = Array.from({ length: 20 }, (_, index) =>
      run({
        agentId: `coupe-${index}`,
        baseBranch: 'codex/lot',
        state: 'interrupted',
        attentionReason: 'merge-failed'
      })
    )
    const flux = resumerFlux(interrompus, MAINTENANT)
    expect(flux.aToi).toBe(0)
    expect(flux.interrompus).toBe(1)
    expect(flux.plusVieilleAttenteMs).toBeUndefined()
  })

  it('un verdict absent ou inconnu donne « à vérifier », JAMAIS « terminé »', () => {
    for (const verdict of [undefined, 'unknown'] as const) {
      const [chantier] = regrouperParChantier(
        [run({ baseBranch: 'feature/y', state: 'ready', verdict, publication: 'not-requested' })],
        MAINTENANT
      )
      // `ready` sans publication demandée reste actionnable : prêt à fusionner, pas terminé.
      expect(chantier.verdict).toBe('pret')
    }
    const [inconnu] = regrouperParChantier(
      [run({ baseBranch: 'feature/z', state: 'blocked', attentionReason: 'base-in-progress' })],
      MAINTENANT
    )
    // `base-in-progress` n'attend PAS un humain (le modèle l'exclut) et n'est pas non plus terminé.
    expect(inconnu.verdict).toBe('a-verifier')
  })

  it('trie les décisions d’abord, puis la plus vieille attente', () => {
    const chantiers = regrouperParChantier(
      [
        run({ agentId: 'a', baseBranch: 'calme', state: 'working' }),
        run({
          agentId: 'b',
          baseBranch: 'recent',
          state: 'conflict',
          startedAtMs: MAINTENANT - 3_600_000
        }),
        run({
          agentId: 'c',
          baseBranch: 'ancien',
          state: 'conflict',
          startedAtMs: MAINTENANT - 86_400_000
        })
      ],
      MAINTENANT
    )
    expect(chantiers.map((c) => c.branche)).toEqual(['ancien', 'recent', 'calme'])
  })

  it('compte les fichiers DISTINCTS d’un chantier', () => {
    // Deux runs touchant le même fichier ne font pas deux fichiers : un chef de projet lirait une
    // surface de changement deux fois trop grande.
    const [chantier] = regrouperParChantier(
      [
        run({ agentId: 'a', baseBranch: 'x', files: [{ path: 'src/a.ts', kind: 'mod' }] }),
        run({
          agentId: 'b',
          baseBranch: 'x',
          files: [
            { path: 'src/a.ts', kind: 'mod' },
            { path: 'src/b.ts', kind: 'add' }
          ]
        })
      ],
      MAINTENANT
    )
    expect(chantier.fichiers).toBe(2)
  })

  it('garde un chantier sans branche au lieu de le fondre dans les autres', () => {
    const chantiers = regrouperParChantier(
      [run({ agentId: 'a', baseBranch: '  ' }), run({ agentId: 'b', baseBranch: 'main' })],
      MAINTENANT
    )
    expect(chantiers.map((c) => c.branche).sort()).toEqual(['branche inconnue', 'main'])
  })
})

describe('bandeau de flux', () => {
  it('compte des CHANTIERS, pas des runs', () => {
    // Dix runs sur une branche en conflit = UNE décision à prendre, pas dix.
    const flux = resumerFlux(
      Array.from({ length: 10 }, (_, i) =>
        run({ agentId: `r${i}`, baseBranch: 'feature/x', state: 'conflict' })
      ),
      MAINTENANT
    )
    expect(flux.chantiers).toBe(1)
    expect(flux.aToi).toBe(1)
  })

  it('rend la plus vieille attente toutes branches confondues', () => {
    const flux = resumerFlux(
      [
        run({
          agentId: 'a',
          baseBranch: 'x',
          state: 'conflict',
          startedAtMs: MAINTENANT - 7_200_000
        }),
        run({ agentId: 'b', baseBranch: 'y', state: 'conflict', startedAtMs: MAINTENANT - 600_000 })
      ],
      MAINTENANT
    )
    expect(flux.plusVieilleAttenteMs).toBe(7_200_000)
  })

  it('sur zéro run, tout est à zéro et rien n’est inventé', () => {
    expect(resumerFlux([], MAINTENANT)).toEqual({
      chantiers: 0,
      aToi: 0,
      pret: 0,
      enCours: 0,
      aVerifier: 0,
      interrompus: 0
    })
  })

  it('l’ordre des verdicts place l’actionnable avant l’inerte', () => {
    // L'ordre de cette liste EST la priorité d'affichage : le réordonner change la vue en silence.
    expect(VERDICTS_CHANTIER.indexOf('a-toi')).toBeLessThan(VERDICTS_CHANTIER.indexOf('pret'))
    expect(VERDICTS_CHANTIER.indexOf('pret')).toBeLessThan(VERDICTS_CHANTIER.indexOf('en-cours'))
    expect(VERDICTS_CHANTIER.indexOf('a-verifier')).toBeLessThan(
      VERDICTS_CHANTIER.indexOf('termine')
    )
  })
})

describe('durée d’attente', () => {
  it('arrondit vers le bas et n’exagère jamais', () => {
    expect(formatAttente(59_000)).toBe('1 min')
    expect(formatAttente(3_540_000)).toBe('59 min')
    expect(formatAttente(7_200_000)).toBe('2 h')
    expect(formatAttente(3 * 86_400_000)).toBe('3 j')
  })

  it('rend `undefined` plutôt qu’une durée inventée', () => {
    expect(formatAttente(undefined)).toBeUndefined()
    expect(formatAttente(-5)).toBeUndefined()
    expect(formatAttente(Number.NaN)).toBeUndefined()
  })
})
