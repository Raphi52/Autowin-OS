import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'
import { encoderCheminCli } from './historique-cli-copie'

/**
 * Preuve de BOUT EN BOUT du branchement : le module d'historique est testé à part, mais rien ne
 * prouvait que la suppression d'une copie l'appelle vraiment. C'est ce chaînage-là qui manquait
 * jusqu'au 2026-09-12, et c'est lui qui a laissé 87 Mo d'historique orphelin sur le poste de dev.
 */
describe('remove() efface aussi l’historique CLI de la copie', () => {
  afterEach(() => nettoyerRacines())

  it('supprime le dossier du CLI et ses descendants, sans toucher à un projet étranger', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const copie = wm.acquire('agent-histo')

    // La racine des comptes se déduit du chemin de la copie : <userData>/worktrees/<agent>.
    const projects = join(copie, '..', '..', 'claude-accounts', 'compte-1', 'projects')
    const encode = encoderCheminCli(copie)
    const sien = join(projects, encode)
    const descendant = join(projects, `${encode}-agent--run-abc-1`)
    const etranger = join(projects, 'D--UnAutreDepot')
    for (const d of [sien, descendant, etranger]) {
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'session.jsonl'), '{}')
    }

    wm.remove('agent-histo')

    expect(existsSync(copie)).toBe(false)
    expect(existsSync(sien)).toBe(false)
    expect(existsSync(descendant)).toBe(false)
    expect(existsSync(etranger)).toBe(true)
  })
})
