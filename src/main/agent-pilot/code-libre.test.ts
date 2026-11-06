import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as pilote from './agent-pilot'
import * as aides from './aides-du-tour'
import * as collage from './collage-des-deltas'
import * as issue from './issue-des-commandes'
import * as jetons from './jetons-de-commande'

/**
 * Le code libre de `agent-pilot.ts` vit dans `agent-pilot/*.ts` (lot 1) ;
 * `agent-pilot.ts` le ré-exporte pour ses importeurs, qui ne changent pas.
 *
 * Deux défauts possibles d'un déplacement, que le typage ne voit pas :
 * - une COPIE laissée dans `agent-pilot.ts` au lieu d'un ré-export : deux fonctions de même nom,
 *   la suivante corrigée d'un seul côté. Entrée qui fait échouer le premier test : un
 *   `export function parseOrderedPilotTokens` encore écrit dans `agent-pilot.ts`.
 * - un module du dossier qui importe une VALEUR par `'../agent-pilot'` : cycle d'import réel, dont
 *   l'ordre d'évaluation décide si la valeur existe déjà. Entrée qui fait échouer le second test :
 *   `import { AgentPilot } from './agent-pilot'` dans l'un des modules.
 */
const DEPLACES: Array<[string, Record<string, unknown>, string[]]> = [
  [
    'aides-du-tour.ts',
    aides,
    ['CAP_ITERATIONS_TOUR', 'resolveLatestUserMessage', 'snapshotDuTour']
  ],
  [
    'collage-des-deltas.ts',
    collage,
    [
      'consumeStreamedPrefix',
      'separationDeltaCollee',
      'detacherFenceCollee',
      'soudureDePhrases',
      'DeltaCollageTracker'
    ]
  ],
  ['issue-des-commandes.ts', issue, ['commandResultSucceeded']],
  [
    'jetons-de-commande.ts',
    jetons,
    [
      'normaliserFermeturesCmd',
      'reparerAccoladeFinaleManquante',
      'texteCmdIlisible',
      'parseOrderedPilotTokens'
    ]
  ]
]

describe('code libre du pilote déplacé dans agent-pilot/ (conv-1580)', () => {
  it.each(DEPLACES)('agent-pilot.ts ré-exporte %s, sans copie', (_module, source, noms) => {
    const exportsDuPilote = pilote as unknown as Record<string, unknown>
    for (const nom of noms) {
      expect(source[nom], `${nom} absent de son module`).toBeDefined()
      expect(exportsDuPilote[nom], `${nom} : agent-pilot.ts doit ré-exporter l'original`).toBe(
        source[nom]
      )
    }
  })

  it("aucun module du dossier n'importe une VALEUR par '../agent-pilot'", () => {
    const fautifs: string[] = []
    for (const nom of readdirSync(__dirname).filter(
      (n) => n.endsWith('.ts') && !n.includes('.test')
    )) {
      const texte = readFileSync(join(__dirname, nom), 'utf8')
      for (const m of texte.matchAll(
        /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'\.\.\/agent-pilot'/gu
      )) {
        if (m[1]) continue
        const valeurs = m[2]
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith('type '))
        if (valeurs.length > 0) fautifs.push(`${nom} : ${valeurs.join(', ')}`)
      }
    }
    expect(fautifs).toEqual([])
  })
})
