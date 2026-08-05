import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createConvRun, reconcileAbandonedConvRuns } from './conv-runs'

/**
 * UN RUN QUI MEURT EN COURS RESTE `open` POUR TOUJOURS.
 *
 * `closeConvRun` n'est appelé qu'à la fin d'une orchestration. Si l'app s'arrête avant — crash,
 * fermeture, coupure — le `RUN.md` garde `status: open` et rien ne l'en sort jamais.
 *
 * Mesuré le 2026-08-05 sur l'état réel (`%APPDATA%\autowin-os\runs`, 8888 workspaces) :
 * 151 runs `open`, dont **141 vieux de plus de 24 h** — donc abandonnés, pas en cours. Comme le taux
 * de réussite se lit dans ces fichiers, ces 141 le faussent silencieusement : ils ne comptent ni
 * comme succès ni comme échec, alors que ce sont des échecs.
 *
 * Même motif que l'incident auto-kaizen figé en `fix-running` : rien ne renonce jamais.
 */
describe('réconciliation des runs abandonnés', () => {
  const racines: string[] = []
  afterEach(() => {
    for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
  })

  const HEURE = 3_600_000

  function racine(): string {
    const r = mkdtempSync(join(tmpdir(), 'autowin-conv-runs-'))
    racines.push(r)
    return r
  }

  /** Vieillit le fichier : c'est le mtime qui distingue un abandon d'un run en vol. */
  function vieillirDe(path: string, heures: number): void {
    const quand = new Date(Date.now() - heures * HEURE)
    utimesSync(path, quand, quand)
  }

  function statutDe(path: string): string {
    return readFileSync(path, 'utf8').split(/\r?\n/)[0]
  }

  it('un run `open` plus vieux que le seuil est clos en `red`, avec sa raison au Journal', () => {
    const root = racine()
    const path = createConvRun('conv-7', 'une tache abandonnee', root)
    vieillirDe(path, 72)

    const bilan = reconcileAbandonedConvRuns({ root })

    expect(bilan.closed).toBe(1)
    expect(statutDe(path)).toBe('status: red')
    // La raison doit être inscrite : un `red` sans motif est indiscernable d'un rejet du juge.
    expect(readFileSync(path, 'utf8')).toMatch(/abandonn|arrêt|arret/i)
  })

  it('un run `open` RÉCENT est laissé intact — un run en vol ne doit pas être tué', () => {
    const root = racine()
    const path = createConvRun('conv-8', 'une tache en cours', root)
    // Pas de vieillissement : le fichier vient d'être écrit.

    const bilan = reconcileAbandonedConvRuns({ root })

    // Discriminant : si ce test casse, la réconciliation ferme des runs qui tournent encore.
    expect(bilan.closed).toBe(0)
    expect(statutDe(path)).toBe('status: open')
  })

  it('un run déjà clos n’est pas retouché', () => {
    const root = racine()
    const path = createConvRun('conv-9', 'une tache finie', root)
    const avant = readFileSync(path, 'utf8').replace(/^status: open/m, 'status: green')
    writeFileSync(path, avant, 'utf8')
    vieillirDe(path, 72)

    const bilan = reconcileAbandonedConvRuns({ root })

    expect(bilan.closed).toBe(0)
    expect(statutDe(path)).toBe('status: green')
  })

  it('le plafond est respecté ET le reste est RAPPORTÉ — pas de troncature muette', () => {
    const root = racine()
    for (let n = 0; n < 5; n++) {
      const path = createConvRun('conv-10', `tache ${n}`, root, () => Date.now() + n)
      vieillirDe(path, 72)
    }

    const bilan = reconcileAbandonedConvRuns({ root, max: 2 })

    expect(bilan.closed).toBe(2)
    // Une borne silencieuse se lirait « tout est traité » alors qu'il en reste 3.
    expect(bilan.remaining).toBe(3)
  })

  it('une arborescence absente ou illisible ne fait pas échouer le démarrage', () => {
    const bilan = reconcileAbandonedConvRuns({
      root: join(tmpdir(), 'racine-qui-nexiste-pas-4242')
    })
    expect(bilan).toEqual({ closed: 0, remaining: 0 })
  })

  it('ne lit pas les dossiers qui ne sont pas des workspaces', () => {
    const root = racine()
    const path = createConvRun('conv-11', 'tache valide', root)
    vieillirDe(path, 72)
    // Un worktree d'agent, ou tout autre dossier, ne porte pas de RUN.md à clore.
    const intrus = join(root, 'conv-11', 'agent__run-abcdef-1')
    mkdirSync(intrus, { recursive: true })
    writeFileSync(join(intrus, 'RUN.md'), 'status: open\n', 'utf8')
    vieillirDe(join(intrus, 'RUN.md'), 72)

    const bilan = reconcileAbandonedConvRuns({ root })

    expect(bilan.closed).toBe(1)
    expect(statutDe(join(intrus, 'RUN.md'))).toBe('status: open')
  })
})
