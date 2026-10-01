/**
 * La mesure de la valeur de `think` (`mesure-valeur-think.mjs`) : extraction des fichiers cites,
 * appariement aux fichiers modifies, et regle de decision fixee AVANT la mesure.
 */
import { describe, expect, it } from 'vitest'
import {
  decisionSaut,
  estCite,
  fichiersCites,
  mediane,
  mesurerRun,
  runsDuMessage,
  section
} from './mesure-valeur-think.mjs'

const BRIEFING = [
  '## Localisation',
  '| 3 | `src/main/orchestrator.ts:3643` | lecture |',
  '- `orchestration-state.ts:1116` et `skills/think/SKILL.md` §2',
  '## Cartographie',
  '- `src/main/autre-fichier.ts` cité hors Localisation',
  '## Trous',
  '- rien'
].join('\n')

describe('fichiers cités par un texte', () => {
  it('lit les chemins complets, les noms nus et retire le numéro de ligne', () => {
    const cites = fichiersCites(section(BRIEFING, 'Localisation'))
    expect([...cites.chemins].sort()).toEqual(['skills/think/SKILL.md', 'src/main/orchestrator.ts'])
    expect([...cites.noms].sort()).toEqual([
      'orchestration-state.ts',
      'orchestrator.ts',
      'skill.md'
    ])
  })

  it('ne prend que la section demandée', () => {
    expect(section(BRIEFING, 'localisation')).not.toContain('autre-fichier')
    expect(section('## Localisation\na.ts', 'Trous')).toBe('')
  })

  it('accepte les barres obliques inverses de Windows', () => {
    expect([...fichiersCites('voir src\\main\\x.ts').chemins]).toEqual(['src/main/x.ts'])
  })
})

describe('appariement aux fichiers modifiés', () => {
  const cites = fichiersCites(section(BRIEFING, 'Localisation'))

  it('par chemin complet, par nom nu, et rien d’autre', () => {
    expect(estCite('src/main/orchestrator.ts', cites)).toBe(true)
    expect(estCite('src/main/runs/orchestration-state.ts', cites)).toBe(true)
    expect(estCite('src/main/autre-fichier.ts', cites)).toBe(false)
  })

  it('sépare ce que la Localisation apporte de ce que la tâche nommait déjà', () => {
    const mesure = mesurerRun({
      tache: 'corrige orchestrator.ts',
      briefing: BRIEFING,
      modifies: [
        'src/main/orchestrator.ts',
        'src/main/runs/orchestration-state.ts',
        'src/main/autre-fichier.ts'
      ]
    })
    expect(mesure.tacheNommeUnFichier).toBe(true)
    expect(mesure.modifiesCites).toBe(2)
    expect(mesure.apportes).toEqual(['src/main/runs/orchestration-state.ts'])
    expect(mesure.rappel).toBeCloseTo(2 / 3)
  })
})

describe('rattachement des commits à un run', () => {
  it('reconnaît les quatre formes de message relevées', () => {
    expect(runsDuMessage('agent run-18847638a7f3-1')).toEqual(['run-18847638a7f3-1'])
    expect(runsDuMessage('agent run-3180eec71b06-1: garde des notes')).toEqual([
      'run-3180eec71b06-1'
    ])
    expect(runsDuMessage('salvage(run-28937ab3093b-1): HEAD lu')).toEqual(['run-28937ab3093b-1'])
    expect(runsDuMessage('autowin: travail préservé de la copie run-121f31145ea6-1')).toEqual([
      'run-121f31145ea6-1'
    ])
    expect(runsDuMessage('auto(conv-889): 2 3 4')).toEqual([])
  })
})

describe('règle de décision « sauter think »', () => {
  const sans = { apportes: [] }
  const avec = { apportes: ['a.ts'] }

  it('ne conclut pas sous 5 cas', () => {
    expect(decisionSaut([sans, sans, sans, sans]).construire).toBe(false)
  })

  it('construit à 80 % de cas sans apport, pas en dessous', () => {
    expect(decisionSaut([sans, sans, sans, sans, avec]).construire).toBe(true)
    expect(decisionSaut([sans, sans, sans, avec, avec]).construire).toBe(false)
  })

  it('médiane paire et impaire', () => {
    expect(mediane([3, 1, 2])).toBe(2)
    expect(mediane([1, 2, 3, 4])).toBe(2.5)
    expect(mediane([])).toBe(null)
  })
})
