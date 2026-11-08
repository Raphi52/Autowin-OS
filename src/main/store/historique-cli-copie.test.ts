import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  encoderCheminCli,
  planHistoriqueCliASupprimer,
  racinesHistoriqueCliPour,
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
