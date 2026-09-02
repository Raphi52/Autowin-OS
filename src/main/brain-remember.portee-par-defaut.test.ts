import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectScopeFromWorkspace, rememberFact } from './brain-remember'

/**
 * LA PORTÉE D'UN FAIT NE SE DEVINE PAS.
 *
 * Mesuré le 2026-09-02 (conv-142) : `remember` refusé « portée manquante », rien d'écrit, et le
 * modèle avait déjà annoncé le dépôt à l'utilisateur. La valeur qui a fait passer le second essai,
 * `autowin-os`, est le `name` du `package.json` du dépôt : Autowin la tenait de source sûre.
 *
 * Sans jeton du Brain, aucun appel réseau n'a lieu — mais `rememberFact` rend tout de même le fait
 * VALIDÉ, ce qui suffit à prouver la portée retenue.
 */
const FAIT = {
  title: 'un fait durable',
  fact: 'un fait autoporté, relisible dans trois mois sans cette conversation.',
  type: 'lesson',
  source: 'session:conv-142'
}

const workspaceAvecNom = (name: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'portee-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name }), 'utf8')
  return root
}

describe('une portée absente est remplie depuis le projet', () => {
  it('prend le `name` du package.json du workspace', () => {
    expect(projectScopeFromWorkspace(workspaceAvecNom('autowin-os'))).toBe('autowin-os')
  })

  it('retombe sur le nom du dossier quand il n’y a pas de manifeste lisible', () => {
    const root = mkdtempSync(join(tmpdir(), 'Portee-Sans-Manifeste-'))
    expect(projectScopeFromWorkspace(root)).toMatch(/^portee-sans-manifeste-/)
  })

  it('sans workspace connu, rien n’est inventé', () => {
    expect(projectScopeFromWorkspace(undefined)).toBe('')
    expect(projectScopeFromWorkspace('   ')).toBe('')
  })

  it('`remember` sans portée n’est plus refusé : le fait porte celle du projet', async () => {
    const outcome = await rememberFact(FAIT, {
      token: '',
      workspace: workspaceAvecNom('autowin-os')
    })

    expect(outcome.allowed).toBe(true)
    expect(outcome.fact?.scope).toBe('autowin-os')
  })

  it('une portée EXPLICITE reste intacte — `global` ne peut venir que du modèle', async () => {
    const outcome = await rememberFact(
      { ...FAIT, scope: 'global' },
      { token: '', workspace: workspaceAvecNom('autowin-os') }
    )

    expect(outcome.fact?.scope).toBe('global')
  })

  it('sans workspace, le refus « portée manquante » est conservé', async () => {
    const outcome = await rememberFact(FAIT, { token: '' })

    expect(outcome.allowed).toBe(false)
    expect(outcome.reason).toContain('portée manquante')
  })
})

/**
 * UN REFUS DOIT DIRE QU'IL N'A RIEN ÉCRIT.
 *
 * conv-142 : le compte-rendu ne portait que le motif de forme, et l'agent avait déjà annoncé
 * « je dépose la leçon ». Lire un motif ne lui disait pas que l'effet annoncé n'avait pas eu lieu.
 */
describe('un refus de validation dit qu’il n’a rien écrit', () => {
  it('le compte-rendu lu par l’agent porte l’absence d’effet, pas seulement le motif', async () => {
    const outcome = await rememberFact({ ...FAIT, type: 'cause-racine' }, { token: '' })

    expect(outcome.stored).toBe(false)
    expect(outcome.detail).toMatch(/rien n[’']a été retenu/u)
    expect(outcome.detail).toContain('type invalide')
  })
})
