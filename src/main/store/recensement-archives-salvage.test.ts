import { rmSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { git, roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * LE DÉFAUT, mesuré le 2026-08-29 (conv-1521).
 *
 * `salvage` ARCHIVE tout travail qu'il jette sur une branche `autowin/recovery/salvage-<date>-<id>`
 * avant de nettoyer le bureau : c'est ce qui rend le « jeté » réversible. Mais le recensement
 * énumère `refs/heads/autowin/recovery/*` SANS distinguer l'origine de la branche — il recomptait
 * donc les archives que salvage venait lui-même de créer comme du travail à trier.
 *
 * Effet observé : trier 2 travaux faisait passer le compteur de 2 à 5. Le tri en produisait plus
 * qu'il n'en résolvait, et la liste ne pouvait jamais se vider.
 *
 * Une archive de salvage n'est PAS du travail en attente : c'est la trace d'un travail DÉJÀ jugé.
 * Elle reste dans git (rien n'est détruit), mais elle sort du recensement.
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

const monter = (): { repo: string; racine: string; wm: WorktreeManager } => {
  const repo = tempRepo()
  const racine = mkdtempSync(join(tmpdir(), 'autowin-archives-'))
  roots.push(racine)
  return { repo, racine, wm: new WorktreeManager({ baseRepo: repo, worktreeRoot: racine }) }
}

/** Une branche de secours portant un commit absent de la base, comme en pose le coordinateur. */
const brancheDeSecours = (repo: string, racine: string, nom: string): void => {
  const chemin = join(racine, `tmp__${nom.replace(/[^a-zA-Z0-9-]/g, '_')}`)
  git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')
  writeFileSync(join(chemin, `${nom.replace(/[^a-zA-Z0-9-]/g, '_')}.txt`), `travail ${nom}\n`)
  git(chemin, 'add', '-A')
  git(chemin, 'commit', '-q', '-m', `travail ${nom}`)
  git(repo, 'branch', `autowin/recovery/${nom}`, git(chemin, 'rev-parse', 'HEAD').trim())
  git(repo, 'worktree', 'remove', '--force', chemin)
}

describe('recensement : les archives de salvage ne sont pas du travail en attente', () => {
  it('ne compte PAS une branche autowin/recovery/salvage-*', () => {
    const { repo, racine, wm } = monter()
    brancheDeSecours(repo, racine, 'salvage-20260829-agent__run-2c8dbdf9d036-1')

    expect(wm.travauxNonPublies('main')).toEqual([])
  })

  it('compte TOUJOURS une branche de secours ordinaire — la garde ne vide pas le recensement', () => {
    const { repo, racine, wm } = monter()
    brancheDeSecours(repo, racine, 'run-eef2669db7a1-1')

    expect(wm.travauxNonPublies('main')).toEqual(['run-eef2669db7a1-1'])
  })

  it('trie un lot mixte : garde le travail réel, écarte la seule archive', () => {
    const { repo, racine, wm } = monter()
    brancheDeSecours(repo, racine, 'run-0be31590f330-1')
    brancheDeSecours(repo, racine, 'salvage-20260829-agent__run-e2aad43e639d-1')

    expect(wm.travauxNonPublies('main')).toEqual(['run-0be31590f330-1'])
  })

  it('ne se laisse pas duper par un id qui CONTIENT salvage sans en être une archive', () => {
    const { repo, racine, wm } = monter()
    brancheDeSecours(repo, racine, 'run-salvage-du-panier-1')

    expect(wm.travauxNonPublies('main')).toEqual(['run-salvage-du-panier-1'])
  })
})
