import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as bus from '../commands'
import * as argumentsDuBus from './arguments'
import * as orchestrationEntrees from './orchestration-entrees'
import * as publication from './publication'
import * as refus from './refus'
import * as rejeu from './rejeu'
import * as skills from './skills'

/**
 * Le code libre de `commands.ts` vit dans `commands/*.ts` (conv-1580, lot 5) ; `commands.ts` le
 * ré-exporte pour ses ~150 importeurs, qui ne changent pas.
 *
 * Deux défauts possibles d'un déplacement, que le typage ne voit pas :
 * - une COPIE laissée dans `commands.ts` au lieu d'un ré-export : deux fonctions de même nom, la
 *   suivante corrigée d'un seul côté. Entrée qui fait échouer le premier test : un
 *   `export function listeEnvoyee` encore écrit dans `commands.ts` (référence différente).
 * - un module du dossier qui importe une VALEUR par `'../commands'` : cycle d'import réel, dont
 *   l'ordre d'évaluation décide si la valeur existe déjà. Entrée qui fait échouer le second test :
 *   `import { type AppCommandBus, argumentAbsent } from '../commands'` (application.ts avant ce lot).
 */
const DEPLACES: Array<[string, Record<string, unknown>, string[]]> = [
  ['skills.ts', skills, ['ligneDeSkill', 'skillsInvocables']],
  [
    'arguments.ts',
    argumentsDuBus,
    ['parseDisplayArg', 'listeEnvoyee', 'argumentAbsent', 'entierEnvoye', 'booleenEnvoye']
  ],
  ['refus.ts', refus, ['demandeEcranReel']],
  ['rejeu.ts', rejeu, ['actionFingerprint']],
  [
    'orchestration-entrees.ts',
    orchestrationEntrees,
    ['isolateWatchdogPromptPaths', 'watchdogEvidenceIdentity', 'ORCHESTRATE_PHASES']
  ],
  ['publication.ts', publication, ['circonstanceDePublication', 'restaurer']]
]

describe('code libre du bus déplacé dans commands/ (conv-1580)', () => {
  it.each(DEPLACES)('commands.ts ré-exporte %s, sans copie', (_module, source, noms) => {
    const exportsDuBus = bus as unknown as Record<string, unknown>
    for (const nom of noms) {
      expect(source[nom], `${nom} absent de son module`).toBeDefined()
      expect(exportsDuBus[nom], `${nom} : commands.ts doit ré-exporter l'original`).toBe(
        source[nom]
      )
    }
  })

  it("aucun module du dossier n'importe une VALEUR par '../commands'", () => {
    const dossier = __dirname
    const fautifs: string[] = []
    for (const nom of readdirSync(dossier).filter(
      (n) => n.endsWith('.ts') && !n.includes('.test')
    )) {
      const texte = readFileSync(join(dossier, nom), 'utf8')
      for (const m of texte.matchAll(
        /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'\.\.\/commands'/gu
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
