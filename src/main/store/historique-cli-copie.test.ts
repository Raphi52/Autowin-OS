import { describe, expect, it } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  encoderCheminCli,
  planHistoriqueCliASupprimer,
  planifierRangementHistoriquesCli,
  racinesHistoriqueCliPour,
  rangerHistoriquesCliOrphelins,
  suivreSessionEntreDossiers,
  supprimerHistoriqueCli
} from './historique-cli-copie'

/* Antislash par son CODE : ce depot a deja fige un defaut sur un antislash ecrit a la main
   dans un patch (voir `ANTISLASH` dans worktree-manager.ts). */
const A = String.fromCharCode(92)
const COPIE = `D:${A}AutoWinOS${A}.autowin-data${A}autowin-os${A}worktrees${A}arena-a`
const ENCODE = 'D--AutoWinOS--autowin-data-autowin-os-worktrees-arena-a'

describe('encoderCheminCli', () => {
  it('reproduit le nom observé sur le disque réel', () => {
    expect(encoderCheminCli(COPIE)).toBe(ENCODE)
  })
})

describe('planHistoriqueCliASupprimer', () => {
  it('prend le dossier de la copie et ses descendants', () => {
    const plan = planHistoriqueCliASupprimer(COPIE, [
      ENCODE,
      `${ENCODE}-agent--run-8ce6524a505f-1`,
      'D--ContosoV3Desktop'
    ])
    expect(plan).toEqual([ENCODE, `${ENCODE}-agent--run-8ce6524a505f-1`])
  })

  it("ne touche pas l'historique d'une copie voisine dont le nom commence pareil", () => {
    const voisine = `${COPIE}-r1`
    const plan = planHistoriqueCliASupprimer(
      COPIE,
      [ENCODE, `${ENCODE}-r1`, `${ENCODE}-r1-agent--run-x-1`],
      [voisine]
    )
    expect(plan).toEqual([ENCODE])
  })

  it('ne se protège pas contre elle-même si la copie est listée comme vivante', () => {
    expect(planHistoriqueCliASupprimer(COPIE, [ENCODE], [COPIE])).toEqual([ENCODE])
  })

  it('rend une liste vide sur un chemin vide plutôt que de tout revendiquer', () => {
    expect(planHistoriqueCliASupprimer('', [ENCODE])).toEqual([])
  })
})

describe('racinesHistoriqueCliPour', () => {
  it('déduit les comptes dédiés de la racine de données portée par le chemin', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-hist-'))
    mkdirSync(join(base, 'claude-accounts', 'compte-3'), { recursive: true })
    const racines = racinesHistoriqueCliPour(join(base, 'worktrees', 'arena-a'))
    expect(racines).toContain(join(base, 'claude-accounts', 'compte-3', 'projects'))
  })

  it('trouve les comptes aussi quand la copie d’agent est sous un dossier de dépôt (worktrees/<dépôt>/<agent>)', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-hist-'))
    mkdirSync(join(base, 'claude-accounts', 'compte-3'), { recursive: true })
    const racines = racinesHistoriqueCliPour(join(base, 'worktrees', 'depot-1', 'agent__x'))
    expect(racines).toContain(join(base, 'claude-accounts', 'compte-3', 'projects'))
  })
})

// fix-ok: cause mesurée — rouge avant correctif (11 échecs sur 24) : 1 échec sur la profondeur, `racinesHistoriqueCliPour` (src/main/store/historique-cli-copie.ts) remonte d'un niveau fixe et ne trouve pas `claude-accounts` d'une copie d'agent sous `worktrees/<dépôt>/<agent>` ; 10 échecs « is not a function » : le rangement des restes n'existe pas encore.
describe('planifierRangementHistoriquesCli', () => {
  const PARENT = join('D:', 'AutoWinOS', '.autowin-data', 'autowin-os', 'worktrees', '5a94')
  const MORT = encoderCheminCli(join(PARENT, 'agent__mort'))
  const MORT_2 = encoderCheminCli(join(PARENT, 'agent__mort-2'))
  const VIVANTE = join(PARENT, 'agent__vivant')
  const AUTRE = 'D--AutoWinOS' // le dossier d'avant : un projet, pas une copie
  const RACINE = join('racine', 'projects')
  const dossier = (nom: string, sessions: Array<{ id: string; mtime: number }>) => ({
    racine: RACINE,
    nom,
    sessions
  })
  const decider = (
    dossiers: ReturnType<typeof dossier>[],
    copiesExistantes: string[] = []
  ): Array<[string, string]> =>
    planifierRangementHistoriquesCli({
      dossiers,
      copiesExistantes,
      dossiersDeCopies: [PARENT]
    }).map((d) => [d.nom, d.decision])

  it('un reste dont la session a une version plus récente ailleurs est à ranger', () => {
    expect(
      decider([
        dossier(MORT, [{ id: 'S1', mtime: 100 }]),
        dossier(AUTRE, [{ id: 'S1', mtime: 200 }])
      ])
    ).toEqual([[MORT, 'ranger']])
  })

  it('une version ailleurs plus ancienne ne suffit pas : le reste reste en place', () => {
    expect(
      decider([
        dossier(MORT, [{ id: 'S1', mtime: 100 }]),
        dossier(AUTRE, [{ id: 'S1', mtime: 50 }])
      ])
    ).toEqual([[MORT, 'garder']])
  })

  it('une session qu’aucun autre dossier ne porte : le reste reste en place', () => {
    expect(
      decider([
        dossier(MORT, [{ id: 'S2', mtime: 100 }]),
        dossier(AUTRE, [{ id: 'S1', mtime: 200 }])
      ])
    ).toEqual([[MORT, 'garder']])
  })

  it('une copie encore présente revendique son historique, et le sous-dossier de ses runs : rien à ranger', () => {
    expect(
      decider(
        [
          dossier(encoderCheminCli(VIVANTE), [{ id: 'S1', mtime: 100 }]),
          dossier(`${encoderCheminCli(VIVANTE)}-agent--run-x-1`, [{ id: 'S3', mtime: 100 }]),
          dossier(AUTRE, [{ id: 'S1', mtime: 200 }])
        ],
        [VIVANTE]
      )
    ).toEqual([])
  })

  it('deux restes qui ne portent que des sessions l’un de l’autre restent tous les deux en place', () => {
    expect(
      decider([
        dossier(MORT, [{ id: 'S4', mtime: 100 }]),
        dossier(MORT_2, [{ id: 'S4', mtime: 200 }])
      ])
    ).toEqual([
      [MORT, 'garder'],
      [MORT_2, 'garder']
    ])
  })

  it('un reste sans session n’est jamais rangé, et un projet hors dossiers de copies n’est jamais un reste', () => {
    const vide = encoderCheminCli(join(PARENT, 'agent__vide'))
    expect(decider([dossier(vide, []), dossier(AUTRE, [{ id: 'S5', mtime: 100 }])])).toEqual([
      [vide, 'garder']
    ])
  })
})

describe('rangerHistoriquesCliOrphelins', () => {
  const JOUR = '2026-11-08'
  const ANCIEN = new Date('2026-01-01T00:00:00Z')
  const RECENT = new Date('2026-06-01T00:00:00Z')
  const PARENT = (base: string): string => join(base, 'worktrees', 'hash')

  /** Un `projects` de test : chaque dossier reçoit sa session `<id>.jsonl` datée. */
  function poserSession(dossier: string, id: string, date: Date, contenu: string): void {
    mkdirSync(dossier, { recursive: true })
    const fichier = join(dossier, `${id}.jsonl`)
    writeFileSync(fichier, contenu, 'utf8')
    utimesSync(fichier, date, date)
  }

  /**
   * Le cas réel : un reste (la copie `agent__mort` a disparu, sa session est plus ancienne qu'une version
   * posée ailleurs) et un projet d'avant. Le nom du reste se déduit du dossier de test, comme sur le disque.
   */
  function monter(): {
    base: string
    projets: string
    parent: string
    nom: string
    reste: string
    autre: string
  } {
    const base = mkdtempSync(join(tmpdir(), 'autowin-rangement-'))
    const projets = join(base, '.claude', 'projects')
    const parent = PARENT(base)
    mkdirSync(parent, { recursive: true })
    const nom = encoderCheminCli(join(parent, 'agent__mort'))
    const reste = join(projets, nom)
    poserSession(reste, 'S1', ANCIEN, 'ancien')
    const autre = join(projets, 'D--AutoWinOS')
    poserSession(autre, 'S1', RECENT, 'recent')
    return { base, projets, parent, nom, reste, autre }
  }

  it('range le reste dans une corbeille datée, sans rien supprimer, et laisse le reste intact', () => {
    const { base, projets, parent, nom, reste, autre } = monter()

    const bilan = rangerHistoriquesCliOrphelins({
      racines: [projets],
      dossiersDeCopies: [parent],
      jour: JOUR
    })

    expect(bilan.avant).toBe(2)
    expect(bilan.ranges).toEqual([reste])
    expect(bilan.apres).toBe(1)
    expect(existsSync(reste)).toBe(false)
    expect(
      readFileSync(join(base, '.claude', 'corbeille-historique-cli', JOUR, nom, 'S1.jsonl'), 'utf8')
    ).toBe('ancien')
    expect(readFileSync(join(autre, 'S1.jsonl'), 'utf8')).toBe('recent')
  })

  it('mesurer compte sans rien déplacer', () => {
    const { projets, parent, reste } = monter()

    const bilan = rangerHistoriquesCliOrphelins({
      racines: [projets],
      dossiersDeCopies: [parent],
      jour: JOUR,
      mesurer: true
    })

    expect(bilan.avant).toBe(2)
    expect(bilan.aRanger).toEqual([reste])
    expect(bilan.ranges).toEqual([])
    expect(bilan.apres).toBe(2)
    expect(existsSync(reste)).toBe(true)
  })

  it('une copie encore présente n’est jamais rangée', () => {
    const { projets, parent, reste } = monter()
    const vivante = join(parent, 'agent__vivant')
    mkdirSync(vivante, { recursive: true })
    poserSession(join(projets, encoderCheminCli(vivante)), 'S9', ANCIEN, 'vivant')

    const bilan = rangerHistoriquesCliOrphelins({
      racines: [projets],
      dossiersDeCopies: [parent],
      jour: JOUR
    })

    expect(bilan.ranges).toEqual([reste])
    expect(existsSync(join(projets, encoderCheminCli(vivante), 'S9.jsonl'))).toBe(true)
  })

  it('n’écrase jamais une entrée déjà présente dans la corbeille du même jour', () => {
    const { base, projets, parent, nom, reste } = monter()
    poserSession(
      join(base, '.claude', 'corbeille-historique-cli', JOUR, nom),
      'S1',
      ANCIEN,
      'déjà là'
    )

    const bilan = rangerHistoriquesCliOrphelins({
      racines: [projets],
      dossiersDeCopies: [parent],
      jour: JOUR
    })

    expect(bilan.ranges).toEqual([])
    expect(bilan.gardes.map((g) => g.chemin)).toEqual([reste])
    expect(existsSync(reste)).toBe(true)
    expect(
      readFileSync(join(base, '.claude', 'corbeille-historique-cli', JOUR, nom, 'S1.jsonl'), 'utf8')
    ).toBe('déjà là')
  })
})

describe('supprimerHistoriqueCli', () => {
  it('efface les dossiers revendiqués et laisse les autres intacts', () => {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-proj-'))
    const cible = join(racine, ENCODE)
    const descendant = join(racine, `${ENCODE}-agent--run-x-1`)
    const etranger = join(racine, 'D--ContosoV3Desktop')
    for (const d of [cible, descendant, etranger]) {
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'session.jsonl'), '{}')
    }
    const supprimes = supprimerHistoriqueCli(COPIE, [], [racine])
    expect(supprimes.sort()).toEqual([cible, descendant].sort())
    expect(existsSync(etranger)).toBe(true)
    expect(existsSync(cible)).toBe(false)
  })

  it('ignore une racine absente sans lever', () => {
    expect(supprimerHistoriqueCli(COPIE, [], [join(tmpdir(), 'autowin-inexistant-xyz')])).toEqual(
      []
    )
  })
})

describe('suivreSessionEntreDossiers', () => {
  const SOURCE = join('D:', 'AutoWinOS')
  const VERS = join(SOURCE, '.autowin-data', 'autowin-os', 'retours-de-tour', 'essai__conv-S-1')
  const SID = '3cd742bb-8548-4ae9-8b2f-7038dd27af57'
  const projets = (config: string, cwd: string): string =>
    join(config, 'projects', encoderCheminCli(cwd))

  /** Pose la session du CLI sous le dossier de son cwd, comme le CLI la range. */
  const poser = (config: string, cwd: string, contenu: string): void => {
    mkdirSync(projets(config, cwd), { recursive: true })
    writeFileSync(join(projets(config, cwd), `${SID}.jsonl`), contenu, 'utf8')
  }

  it('copie le .jsonl et le dossier des sorties d’outils sous le dossier de la copie', () => {
    const config = mkdtempSync(join(tmpdir(), 'cfg-suivi-'))
    poser(config, SOURCE, 'tour 1')
    mkdirSync(join(projets(config, SOURCE), SID, 'tool-results'), { recursive: true })
    writeFileSync(join(projets(config, SOURCE), SID, 'tool-results', 'r.txt'), 'sortie', 'utf8')

    expect(
      suivreSessionEntreDossiers({ configDir: config, depuis: SOURCE, vers: VERS, sessionId: SID })
    ).toBe('suivie')
    expect(readFileSync(join(projets(config, VERS), `${SID}.jsonl`), 'utf8')).toBe('tour 1')
    expect(readFileSync(join(projets(config, VERS), SID, 'tool-results', 'r.txt'), 'utf8')).toBe(
      'sortie'
    )
  })

  it('la source fait foi : une copie déjà posée est remplacée, la source reste intacte', () => {
    const config = mkdtempSync(join(tmpdir(), 'cfg-suivi-'))
    poser(config, SOURCE, 'tour 1 et 2')
    poser(config, VERS, 'ancienne version')

    expect(
      suivreSessionEntreDossiers({ configDir: config, depuis: SOURCE, vers: VERS, sessionId: SID })
    ).toBe('suivie')
    expect(readFileSync(join(projets(config, VERS), `${SID}.jsonl`), 'utf8')).toBe('tour 1 et 2')
    expect(readFileSync(join(projets(config, SOURCE), `${SID}.jsonl`), 'utf8')).toBe('tour 1 et 2')
  })

  // fix-ok: cause mesurée — le défaut (session perdue au retour dans le dossier d'avant) est dans
  // session-du-tour.ts, rouge sur agent-pilot.session-resume.test.ts. Ici : la copie fonctionne déjà dans
  // le sens retour ; ce test le fige, il est vert dès la fonction générique.
  it('retour : la session posée sous la copie revient sous le dossier d’avant, la copie reste intacte', () => {
    const config = mkdtempSync(join(tmpdir(), 'cfg-suivi-'))
    poser(config, VERS, 'tour 1 et 2 faits dans la copie')
    poser(config, SOURCE, 'ancienne version')

    expect(
      suivreSessionEntreDossiers({ configDir: config, depuis: VERS, vers: SOURCE, sessionId: SID })
    ).toBe('suivie')
    expect(readFileSync(join(projets(config, SOURCE), `${SID}.jsonl`), 'utf8')).toBe(
      'tour 1 et 2 faits dans la copie'
    )
    expect(readFileSync(join(projets(config, VERS), `${SID}.jsonl`), 'utf8')).toBe(
      'tour 1 et 2 faits dans la copie'
    )
  })

  it('aucune session sous l’ancien dossier → absente, et rien n’est posé', () => {
    const config = mkdtempSync(join(tmpdir(), 'cfg-suivi-'))
    expect(
      suivreSessionEntreDossiers({ configDir: config, depuis: SOURCE, vers: VERS, sessionId: SID })
    ).toBe('absente')
    expect(existsSync(projets(config, VERS))).toBe(false)
  })

  it('identifiant qui n’est pas un UUID → absente, aucun chemin composé avec lui', () => {
    const config = mkdtempSync(join(tmpdir(), 'cfg-suivi-'))
    poser(config, SOURCE, 'tour 1')
    expect(
      suivreSessionEntreDossiers({
        configDir: config,
        depuis: SOURCE,
        vers: VERS,
        sessionId: `../${SID}`
      })
    ).toBe('absente')
    expect(existsSync(projets(config, VERS))).toBe(false)
  })
})
