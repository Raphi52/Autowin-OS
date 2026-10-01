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
  mesurerTrous,
  racineDeDonnees,
  runsDuMessage,
  runsExclus,
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

/*
 * Objection du juge (run-85d8e7f57af2-1, réparation 2) : la mesure ne disait rien des « Trous », et
 * comptait le run qui l'a écrite. Deux signaux sans modèle, nommés pour ce qu'ils sont : un trou
 * qui portait sur un fichier modifié ensuite, et un trou repris par une étape suivante du même run.
 * fix-ok: run-85d8e7f57af2-1 réparation 2 — imports puis cas écrits AVANT le script (rouge mesuré :
 * 4 échecs, « mesurerTrous / runsExclus is not a function »), 13/13 ensuite ; puis Prettier --write.
 */
describe('« Trous » du briefing, sans modèle', () => {
  const avecTrous = [
    '## Localisation',
    '- `src/main/orchestrator.ts:3643`',
    '## Trous',
    '- je n’ai pas lu `src/main/commands.ts` ni vérifié `pickResumeForTask`',
    '- Brain indisponible'
  ].join('\n')

  it('compte les trous portant sur un fichier modifié ensuite', () => {
    const m = mesurerTrous({
      briefing: avecTrous,
      modifies: ['src/main/commands.ts', 'src/main/orchestrator.ts'],
      suite: ''
    })
    expect(m.fichiersTrouModifies).toEqual(['src/main/commands.ts'])
  })

  it('compte les repères d’un trou repris par une étape suivante', () => {
    const m = mesurerTrous({
      briefing: avecTrous,
      modifies: [],
      suite: '## Confiance\n- NON VÉRIFIÉ : pourquoi `pickResumeForTask` a rendu null'
    })
    expect(m.reperes).toBe(2)
    expect(m.reprisPlusTard).toEqual(['pickResumeForTask'])
  })

  it('un briefing sans section Trous ne compte rien', () => {
    const m = mesurerTrous({
      briefing: '## Localisation\n- a.ts',
      modifies: ['a.ts'],
      suite: 'a.ts'
    })
    expect(m).toEqual({ reperes: 0, reprisPlusTard: [], fichiersTrouModifies: [] })
  })
})

describe('runs exclus de l’échantillon', () => {
  it('lit chaque --exclure, et rien d’autre', () => {
    const exclus = runsExclus(['--exclure', 'run-a', '--data', 'x', '--exclure', 'run-b', '--json'])
    expect([...exclus].sort()).toEqual(['run-a', 'run-b'])
    expect(runsExclus(['--data', 'x']).size).toBe(0)
  })
})

/*
 * fix-ok: objection du juge, reparation 4 de run-85d8e7f57af2-1 — lance sans `--data` depuis une
 * copie de travail, le script rendait 2 (« Racine de donnees introuvable ») : il cherchait
 * `.autowin-data` a cote de la copie, alors que les donnees vivent a cote du depot principal.
 */
describe('racine de données par défaut', () => {
  const sep = (p) => p.replace(/\\/g, '/')
  const existe =
    (...presents) =>
    (p) =>
      presents.map(sep).includes(sep(p))

  it('depuis une copie de travail, prend les données du dépôt principal', () => {
    const racine = racineDeDonnees({
      argv: [],
      env: {},
      depot: 'D:/AutoWinOS/.autowin-data/autowin-os/worktrees/x/agent__run-1',
      depotPrincipal: 'D:/AutoWinOS',
      existe: existe('D:/AutoWinOS/.autowin-data/autowin-os/run-state')
    })
    expect(sep(racine)).toBe('D:/AutoWinOS/.autowin-data/autowin-os')
  })

  it('garde l’ordre : --data, puis AUTOWIN_DATA_ROOT, puis le dépôt lui-même', () => {
    const base = { depot: 'D:/a', depotPrincipal: 'D:/b', existe: () => true }
    expect(sep(racineDeDonnees({ ...base, argv: ['--data', 'D:/x'], env: {} }))).toBe('D:/x')
    expect(racineDeDonnees({ ...base, argv: [], env: { AUTOWIN_DATA_ROOT: 'D:/y' } })).toBe('D:/y')
    expect(sep(racineDeDonnees({ ...base, argv: [], env: {} }))).toBe(
      'D:/a/.autowin-data/autowin-os'
    )
  })

  it('sans données nulle part, nomme le dossier du dépôt (message d’erreur)', () => {
    const racine = racineDeDonnees({
      argv: [],
      env: {},
      depot: 'D:/a',
      depotPrincipal: undefined,
      existe: () => false
    })
    expect(sep(racine)).toBe('D:/a/.autowin-data/autowin-os')
  })
})
