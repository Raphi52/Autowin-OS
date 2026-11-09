import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { WorktreeManager } from './worktree-manager'

/**
 * Le balayage des coquilles (`balayerLesCoquilles`, appelé au démarrage) retire les dossiers vides de
 * la racine des copies. Une coquille qui porte le point de reprise d'un run reste une copie de ce run :
 * la même garde que le passage commun doit la tenir, sinon la reprise la retrouve absente.
 */

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) supprimerArbre(root)
})

function depotVide(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-coquille-depot-'))
  roots.push(dir)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'ligne1\n')
  return dir
}

function gestionnaireVide(): WorktreeManager {
  const repo = depotVide()
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-coquille-racine-'))
  roots.push(worktreeRoot)
  return new WorktreeManager({ baseRepo: repo, worktreeRoot })
}

describe('balayage des coquilles : la garde du point de reprise tient aussi ici', () => {
  it('balayerLesCoquilles ne retire pas la coquille vide d’un run dont le point de reprise vit encore', () => {
    const wm = gestionnaireVide()
    const coquille = join(wm.worktreeRoot, 'agent__run-reprenable')
    mkdirSync(coquille)
    wm.copiesProtegees = new Set(['run-reprenable'])

    wm.balayerLesCoquilles()

    expect(existsSync(coquille)).toBe(true)
  })

  it('JUMEAU : balayerLesCoquilles retire la coquille vide d’un run dont aucun point de reprise ne vit', () => {
    const wm = gestionnaireVide()
    const coquille = join(wm.worktreeRoot, 'agent__run-sans-reprise')
    mkdirSync(coquille)
    wm.copiesProtegees = new Set(['un-autre-run'])

    expect(wm.balayerLesCoquilles()).toEqual(['agent__run-sans-reprise'])
    expect(existsSync(coquille)).toBe(false)
  })

  it('une coquille vide retirée par le balayage laisse sa trace : run et raison dans le journal des retraits', () => {
    const wm = gestionnaireVide()
    mkdirSync(join(wm.worktreeRoot, 'agent__run-sans-reprise'))

    wm.balayerLesCoquilles()

    const lignes = readFileSync(join(wm.worktreeRoot, '.retraits.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((ligne) => JSON.parse(ligne) as { run: string; raison: string })
    expect(lignes.map((l) => [l.run, l.raison])).toEqual([
      ['run-sans-reprise', 'coquille vide retirée']
    ])
  })

  it('une coquille vide retirée dont la trace ne s’écrit pas reste un blocage nommé : la coquille est partie, le journal manque', () => {
    const wm = gestionnaireVide()
    const coquille = join(wm.worktreeRoot, 'agent__run-trace-cassee')
    mkdirSync(coquille)
    // Un dossier à la place du journal : l'écriture échoue alors que la coquille est déjà retirée.
    // Il doit contenir un fichier : un dossier vide à la racine serait pris pour une coquille et retiré
    // avant la trace, ce qui laisserait la trace réussir et le test ne prouverait rien.
    mkdirSync(join(wm.worktreeRoot, '.retraits.jsonl'))
    writeFileSync(join(wm.worktreeRoot, '.retraits.jsonl', 'garde.txt'), 'x')

    expect(wm.balayerLesCoquilles()).toEqual(['agent__run-trace-cassee'])
    expect(existsSync(coquille)).toBe(false)
    expect(wm.blocagesDeBalayage().map((b) => b.detail)).toEqual([
      expect.stringContaining('trace du retrait non écrite')
    ])
  })
})
