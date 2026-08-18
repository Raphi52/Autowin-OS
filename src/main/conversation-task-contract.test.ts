import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  besoinDuRun,
  contratDeLaConversation,
  contratDepuisRuns,
  noteContratPourJuge,
  statutDuRun
} from './conversation-task-contract'

/** Marqueur exact que `reconcileAbandonedConvRuns` ecrit dans un run que l'app a laisse tomber. */
function avecAbandon(content: string): string {
  return [
    content,
    "[2026-08-18] Abandonné : l'app s'est arrêtée avant la clôture, aucun verdict n'a été rendu."
  ].join(String.fromCharCode(10))
}

const CIBLE = 'src/main/store/run-worktree-coordinator.ts'

function runMd(status: string, besoin: string): string {
  return [
    `status: ${status}`,
    'session: conv-1302',
    'regime: standard',
    '',
    '## Besoin',
    besoin,
    '',
    '## Journal',
    '[2026-08-18] status: green mentionne ICI ne doit pas etre lu comme l entete'
  ].join('\n')
}

/**
 * Le contrat de tâche au niveau de la CONVERSATION — la pièce qui manquait à conv-1302, où quatre
 * runs ont fermé vert en corrigeant un autre fichier que celui demandé, sur des tours de relance qui
 * ne nommaient plus rien (« finis », « répare jusqu'à finir »).
 */
describe('besoinDuRun / statutDuRun — lecture d’un RUN.md réel', () => {
  it('extrait le besoin verbatim, sans les sections suivantes', () => {
    expect(besoinDuRun(runMd('red', 'corrige src/a.ts:10 puis publie'))).toBe(
      'corrige src/a.ts:10 puis publie'
    )
  })

  it('lit le statut d’EN-TÊTE, jamais un statut cité dans le Journal', () => {
    expect(statutDuRun(runMd('red', 'x'))).toBe('red')
    expect(statutDuRun(runMd('degraded-closed', 'x'))).toBe('degraded-closed')
  })

  it('un RUN.md sans besoin ni statut ne fabrique rien', () => {
    expect(besoinDuRun('## Journal\nrien')).toBe('')
    expect(statutDuRun('## Journal\nrien')).toBe('')
  })
})

describe('contratDepuisRuns — le contrat OUVERT de la conversation', () => {
  it('retient le besoin le PLUS RÉCENT qui ancre une cible', () => {
    const contrat = contratDepuisRuns([
      { path: 'a/RUN.md', content: runMd('green', 'vieux sujet src/vieux.ts:3') },
      { path: 'b/RUN.md', content: runMd('red', `traite ${CIBLE}:1810`) },
      { path: 'c/RUN.md', content: runMd('red', 'finis') }
    ])
    expect(contrat?.cibles).toEqual([CIBLE])
    expect(contrat?.source).toBe('b/RUN.md')
  })

  /**
   * CAS RÉELS mesurés par un juge adversarial sur le store live (1086 conversations) : la première
   * version ne consultait le statut QUE sur le run qui ancrait une cible. Un chantier livré vert
   * dont le besoin ne portait pas de `chemin:ligne` ne libérait donc rien, et un vieux run rouge
   * restait le contrat. Trois conversations réelles portaient ainsi un contrat MORT.
   */
  it('conv-1063 — une livraison verte NON ANCRÉE solde quand même le contrat', () => {
    expect(
      contratDepuisRuns([
        { path: 'a/RUN.md', content: runMd('red', 'repare src/main/brain-remember.ts:120') },
        {
          path: 'b/RUN.md',
          content: runMd('green', '/build Perimetre STRICT : GraphView.tsx et son test')
        },
        { path: 'c/RUN.md', content: runMd('red', 'finis') }
      ])
    ).toBeUndefined()
  })

  it('conv-76 — un run ABANDONNÉ (app fermée) ne ressuscite aucun contrat', () => {
    expect(
      contratDepuisRuns([
        {
          path: 'a/RUN.md',
          content: avecAbandon(runMd('red', 'repare src/main/providers/claude.ts:88'))
        },
        { path: 'b/RUN.md', content: avecAbandon(runMd('red', 'x')) }
      ])
    ).toBeUndefined()
  })

  it('un run abandonné SANS cible est sauté sans masquer un contrat plus ancien', () => {
    const contrat = contratDepuisRuns([
      { path: 'a/RUN.md', content: runMd('red', `traite ${CIBLE}:1810`) },
      { path: 'b/RUN.md', content: avecAbandon(runMd('red', 'finis')) }
    ])
    expect(contrat?.cibles).toEqual([CIBLE])
    expect(contrat?.rang).toBe(2)
  })

  it('porte sa PROVENANCE : statut et éloignement, pour que le juge puisse l’escompter', () => {
    const contrat = contratDepuisRuns([
      {
        path: 'runs/conv-1302/traite-x-workspace/RUN.md',
        content: runMd('red', `traite ${CIBLE}:1810`)
      },
      { path: 'b/RUN.md', content: runMd('red', 'finis') },
      { path: 'c/RUN.md', content: runMd('red', 'toujours pas') }
    ])
    expect(contrat).toMatchObject({ statut: 'red', rang: 3 })
  })

  it('un contrat HONORÉ (green) ne s’hérite pas : il n’y a plus rien à finir', () => {
    expect(
      contratDepuisRuns([
        { path: 'a/RUN.md', content: runMd('green', `traite ${CIBLE}:1810`) },
        { path: 'b/RUN.md', content: runMd('red', 'finis') }
      ])
    ).toBeUndefined()
  })

  it('une clôture dégradée acceptée par l’utilisateur honore aussi le contrat', () => {
    expect(
      contratDepuisRuns([
        { path: 'a/RUN.md', content: runMd('degraded-closed', `traite ${CIBLE}:1810`) }
      ])
    ).toBeUndefined()
  })

  it('un NOUVEAU sujet ancré remplace l’ancien, jamais l’inverse', () => {
    const contrat = contratDepuisRuns([
      { path: 'a/RUN.md', content: runMd('red', 'traite src/vieux.ts:3') },
      { path: 'b/RUN.md', content: runMd('red', 'maintenant traite src/neuf.ts:42') }
    ])
    expect(contrat?.cibles).toEqual(['src/neuf.ts'])
  })

  it('aucun run, ou aucun besoin ancré : aucun contrat', () => {
    expect(contratDepuisRuns([])).toBeUndefined()
    expect(
      contratDepuisRuns([{ path: 'a/RUN.md', content: runMd('red', 'ameliore le chat') }])
    ).toBeUndefined()
  })
})

describe('noteContratPourJuge — informer, jamais bloquer', () => {
  const contrat = {
    cibles: [CIBLE],
    source: 'runs/conv-1302/traite-x-workspace/RUN.md',
    statut: 'red',
    rang: 3,
    omises: 0
  }

  it('nomme la cible héritée et admet une relocalisation JUSTIFIÉE', () => {
    const note = noteContratPourJuge('finis', contrat)
    expect(note).toContain(CIBLE)
    // La note porte sa PROVENANCE : sans elle, le juge recevait un ordre nu qu'il ne pouvait pas
    // escompter — un contrat vieux de onze runs pesait autant qu'un contrat du tour precedent.
    expect(note).toContain('traite-x-workspace')
    expect(note).toContain('red')
    expect(note).toContain('3 run(s) en arrière')
    // L'exception exige une PREUVE : c'est l'agent qui a derive qui redige l'agregat.
    expect(note).toMatch(/PROUVE/u)
    expect(note).toMatch(/Escompte/u)
  })

  it('se TAIT quand le tour nomme déjà ses cibles (la matrice du brief suffit)', () => {
    expect(noteContratPourJuge('corrige src/autre.ts:7', contrat)).toBeUndefined()
  })

  it('se tait sans contrat, et sur un contrat vide', () => {
    expect(noteContratPourJuge('finis', undefined)).toBeUndefined()
    expect(
      noteContratPourJuge('finis', { cibles: [], source: 'a', statut: 'red', rang: 1, omises: 0 })
    ).toBeUndefined()
  })
})

describe('contratDeLaConversation — lecture disque, ordonnée par date', () => {
  function ecrireRun(root: string, nom: string, status: string, besoin: string, mtime: number) {
    const dir = join(root, nom)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'RUN.md')
    writeFileSync(path, runMd(status, besoin), 'utf8')
    utimesSync(path, mtime, mtime)
    return path
  }

  it('ordonne par mtime, pas par nom : les suffixes de run sont aléatoires', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-contrat-'))
    try {
      const conv = join(root, 'conv-1302')
      // « zzz » est alphabétiquement DERNIER mais chronologiquement PREMIER.
      ecrireRun(conv, 'zzz-workspace', 'red', 'traite src/vieux.ts:3', 1_600_000)
      ecrireRun(conv, 'aaa-workspace', 'red', `traite ${CIBLE}:1810`, 1_700_000)
      expect(contratDeLaConversation('conv-1302', root)?.cibles).toEqual([CIBLE])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('conversation absente, ou identifiant douteux : aucun contrat, aucune exception', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-contrat-'))
    try {
      expect(contratDeLaConversation('conv-inconnue', root)).toBeUndefined()
      expect(contratDeLaConversation('../evasion', root)).toBeUndefined()
      expect(contratDeLaConversation('conv-1302', join(root, 'nexistepas'))).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * CÂBLAGE — un contrat que le juge ne reçoit jamais ne corrige rien. C'est le défaut « Potemkine » :
 * exposé, testé, sans appelant réel. Vérifié par sabotage : retirer l'injection fait rougir ces tests.
 */
describe('câblage — la note de contrat atteint le prompt du juge', () => {
  const orchestrateur = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    return fs.readFileSync(path.join(__dirname, 'orchestrator.ts'), 'utf8')
  }

  it('calcule la note depuis la conversation et la racine des runs', () => {
    expect(orchestrateur()).toContain(
      'noteContratPourJuge(task, contratDeLaConversation(conversationId, convRunsRoot()))'
    )
  })

  it('l’injecte dans les DEUX branches du prompt du juge (juge seul et juge d’agrégat)', () => {
    const source = orchestrateur()
    const injections = source.split('noteContrat +').length - 1
    expect(injections).toBe(2)
  })

  it('la note précède la TÂCHE : le juge lit le contrat avant l’énoncé du tour', () => {
    expect(orchestrateur()).toMatch(/noteContrat \+\s*\n\s*`TÂCHE: \$\{task\}/u)
  })
})

/**
 * MESURÉ SUR LE CORPUS RÉEL (1086 conversations) après la première réparation : deux défauts que
 * le panel n'avait pas vus, parce qu'ils ne se voient qu'en volume.
 *
 * - conv-349 et conv-356 produisaient un contrat de SEIZE cibles : une note illisible, donc un
 *   signal que le juge ne peut pas peser.
 * - conv-351, conv-357 et conv-1300 produisaient des chemins de COPIES ISOLÉES
 *   (`worktrees/agent__run-…`, `appdata/roaming/…`, un fragment `20os/` issu d'un chemin
 *   URL-encodé) — ce ne sont pas des cibles du dépôt, et le même fichier y apparaissait deux fois.
 */
describe('contratDepuisRuns — bornes mesurées sur le corpus réel', () => {
  it('écarte les chemins de copies isolées et d’espaces applicatifs', () => {
    const besoin = [
      'traite src/main/commands.ts:12',
      'et 20os/.autowin-data/autowin-os/worktrees/68fe8b086ee864a1/agent__run-d56aee422bde-1/src/main/commands.ts:12',
      'et users/raphael.vilain/appdata/roaming/autowin-os/worktrees/x/agent__run-2/vitest.config.ts:3'
    ].join(' ')
    expect(
      contratDepuisRuns([{ path: 'a/RUN.md', content: runMd('red', besoin) }])?.cibles
    ).toEqual(['src/main/commands.ts'])
  })

  it('borne le contrat : une note de seize cibles n’est pas un signal', () => {
    const besoin = Array.from({ length: 16 }, (_, i) => `src/main/f${i}.ts:${i + 1}`).join(' et ')
    const cibles = contratDepuisRuns([{ path: 'a/RUN.md', content: runMd('red', besoin) }])?.cibles
    expect(cibles?.length).toBe(5)
    expect(cibles?.[0]).toBe('src/main/f0.ts')
  })

  it('la note dit combien de cibles ont été omises, plutôt que de les taire', () => {
    const note = noteContratPourJuge('finis', {
      cibles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      source: 'runs/conv-1/x-workspace/RUN.md',
      statut: 'red',
      rang: 1,
      omises: 11
    })
    expect(note).toContain('11 autres')
  })

  it('CONTRE-EXEMPLE — un contrat court ne mentionne aucune omission', () => {
    expect(
      noteContratPourJuge('finis', {
        cibles: ['a.ts'],
        source: 'runs/conv-1/x-workspace/RUN.md',
        statut: 'red',
        rang: 1,
        omises: 0
      })
    ).not.toMatch(/autres/u)
  })
})
