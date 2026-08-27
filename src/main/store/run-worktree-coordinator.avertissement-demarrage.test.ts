import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

afterEach(nettoyerRacines)
/*
 * Suite git REELLE : `vi.setConfig` comme les autres suites `worktree-manager.*` (convention maison).
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

/**
 * L'AVERTISSEMENT EST-IL REELLEMENT EMIS AU DEMARRAGE ?
 *
 * La fonction sait rediger (`avertissement-collision-probable.test.ts`), mais une fonction qu'on
 * n'appelle pas ne previent personne : c'est le defaut « expose mais jamais alimente », deja paye
 * plusieurs fois dans ce depot. Ici on verifie le CABLAGE avec le VRAI manager sur un depot git
 * temporaire — un faux manager aurait surtout prouve que mon faux est bien ecrit.
 *
 * Et on couvre les DEUX routes de demarrage (`begin` et `beginAsync`) : n'en cabler qu'une donnerait
 * un avertissement qui apparait selon la route prise, ce qui est pire qu'une absence — on croirait
 * l'arbre propre alors que c'est la route qui se taisait.
 */
describe('demarrage — l avertissement de collision probable atteint le run', () => {
  const scene = (
    sale: boolean
  ): { c: RunWorktreeCoordinator; persistes: Array<{ detail?: string }> } => {
    const repo = tempRepo()
    const wm = manager(repo)
    if (sale) {
      // Deux changements non committes : c'est ce que la copie ECARTE, donc les candidats exacts
      // a la collision de publication.
      writeFileSync(join(repo, 'a.txt'), 'travail en cours de l utilisateur\n')
      writeFileSync(join(repo, 'brouillon.md'), 'note perso\n')
    }
    const persistes: Array<{ detail?: string }> = []
    const stateStore = {
      list: () => [],
      get: () => undefined,
      save: (enregistrement: { detail?: string }) => persistes.push(enregistrement),
      remove: () => {}
    }
    const c = new RunWorktreeCoordinator({
      manager: wm as never,
      stateStore: stateStore as never
    } as never)
    return { c, persistes }
  }

  it('arbre sale : les fichiers ecartes sont NOMMES au demarrage, et en conditionnel', () => {
    const { c, persistes } = scene(true)

    const copie = c.begin('run-sale', 'Agent', true)

    // Le run PART : ce n'est pas un refus, c'est une phrase.
    expect(copie).toBeTruthy()
    const detail = persistes.map((p) => p.detail ?? '').join(' ')
    expect(detail).toContain('a.txt')
    expect(detail).toContain('brouillon.md')
    expect(detail).toContain('SI')
    expect(detail).toContain('part quand même')
    expect(detail).not.toMatch(/va bloquer|échec/i)
  })

  it('arbre PROPRE : aucun avertissement — pas de bandeau permanent', () => {
    const { c, persistes } = scene(false)

    expect(c.begin('run-propre', 'Agent', true)).toBeTruthy()
    expect(persistes.map((p) => p.detail ?? '').join('')).toBe('')
  })

  it('la route ASYNCHRONE previent aussi', async () => {
    const { c, persistes } = scene(true)

    const copie = await c.beginAsync('run-async', 'Agent', true)

    expect(copie).toBeTruthy()
    const detail = persistes.map((p) => p.detail ?? '').join(' ')
    expect(detail).toContain('a.txt')
    expect(detail).toContain('SI')
  })
})
