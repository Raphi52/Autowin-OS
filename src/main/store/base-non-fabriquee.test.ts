import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'
import { roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * LA CAUSE RACINE des « workspaces orphelins », établie le 2026-08-24 en pilotant l'app réelle.
 *
 * Un run dont la fiche persistée a disparu était reconstruit depuis les restes git, et on lui
 * FABRIQUAIT une base de départ : celle de l'état COURANT du dépôt. Mesuré sur
 * `command-edit-04789dcc-...` — travail préservé le 20 août, base tamponnée le 23. La garde
 * d'ascendance ne pouvait donc plus jamais passer, et chaque démarrage refabriquait la même fausse
 * base. Vingt-et-un travaux condamnés PAR CONSTRUCTION, 682 Mo de copies pour rien.
 *
 * La garde n'a jamais été le problème. La base était fausse.
 *
 * Ces tests verrouillent les deux moitiés du correctif : une base absente est refusée comme
 * DÉFINITIVE (donc la copie est rangée, le travail restant sur sa branche de secours), et une base
 * VALIDE continue d'être traitée normalement.
 */

afterEach(() => {
  for (const d of roots.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // Un verrou Windows sur un dossier de test ne doit pas faire échouer la suite.
    }
  }
})

const monter = (): { repo: string; wm: WorktreeManager; racine: string } => {
  const repo = tempRepo()
  const racine = mkdtempSync(join(tmpdir(), 'autowin-base-'))
  roots.push(racine)
  return { repo, wm: new WorktreeManager({ baseRepo: repo, worktreeRoot: racine }), racine }
}

/*
 * Le chemin de copie ATTENDU par le manager. Une garde ANTERIEURE compare `worktreePath` au chemin
 * canonique et refuse avant meme de regarder la base : avec un chemin bidon, ces tests passaient au
 * vert sans jamais atteindre le code teste. Vu deux fois dans cette session -- un decor qui n'atteint
 * pas sa cible ne prouve rien.
 */
const cheminAttendu = (racine: string, runId: string): string => join(racine, `agent__${runId}`)

describe('une base de départ absente', () => {
  it('est refusée comme DÉFINITIVE — aucun réessai ne la rendra valide', () => {
    const { wm, racine } = monter()

    const verdict = wm.validateRecoveryContext('run-sans-base', {
      worktreePath: cheminAttendu(racine, 'run-sans-base'),
      baseBranch: 'main',
      baseSha: '',
      publication: 'pending'
    } as never)

    expect(verdict).toMatchObject({ ok: false, definitif: true })
  })

  it('est aussi définitive quand la base est illisible plutôt que vide', () => {
    const { wm, racine } = monter()

    const verdict = wm.validateRecoveryContext('run-base-illisible', {
      worktreePath: cheminAttendu(racine, 'run-base-illisible'),
      baseBranch: 'main',
      baseSha: 'pas-un-sha',
      publication: 'pending'
    } as never)

    expect(verdict).toMatchObject({ ok: false, definitif: true })
  })

  it('ne condamne PAS un run dont la base est valide — le refus vient alors d’ailleurs', () => {
    // L'entrée qui doit faire échouer une garde devenue trop large : une base parfaitement lisible.
    // Le contexte est incohérent par ailleurs, donc le refus tombe pour une AUTRE raison, et celle-là
    // ne doit pas être définitive.
    const { repo, wm, racine } = monter()
    const sha = require('node:child_process')
      .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' })
      .trim()

    const verdict = wm.validateRecoveryContext('run-base-valide', {
      worktreePath: cheminAttendu(racine, 'run-base-valide'),
      baseBranch: 'main',
      baseSha: sha,
      publication: 'pending'
    } as never)

    expect(verdict).toMatchObject({ ok: false })
    expect((verdict as { definitif?: true }).definitif).toBeUndefined()
  })
})

/*
 * PAS DE TEST SUR LA RECONSTRUCTION ICI, et c'est un constat, pas un oubli.
 *
 * La correction evidente -- cesser de FABRIQUER une base pour un run sans fiche -- a ete tentee puis
 * ANNULEE le 2026-08-24 : le format persiste EXIGE un `baseSha` complet (`isRecord` le teste contre
 * `FULL_SHA` dans `worktree-run-state.ts`). Une base absente produit « Manifeste de bureau
 * invalide » et casse quatre tests existants qui ont raison.
 *
 * La cause racine reste donc OUVERTE, et sa correction demande de toucher au format persiste --
 * un chantier a cadrer, pas une retouche de fin de session.
 */
