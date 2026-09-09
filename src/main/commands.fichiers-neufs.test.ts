import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { ConversationStore } from './store/conversations'

/**
 * LE BUS SAIT-IL CREER, DEPLACER, SUPPRIMER UN FICHIER ?
 *
 * Avant le 2026-09-09 : non. `edit_file` refuse un fichier absent (« cette commande ne cree pas de
 * fichier ») et rien d'autre n'ecrivait — un agent devait passer par `run node -e "..."`, donc hors
 * de toute borne. Ce test juge le CATALOGUE et le VRAI aiguillage, pas la decision pure : c'est le
 * site d'appel qui manquait.
 *
 * ENTREE QUI DOIT LE FAIRE ECHOUER : retirer une des trois entrees du catalogue, ou laisser une
 * ecriture ecraser un fichier existant.
 */
function bus(workspace: string): AppCommandBus {
  let horloge = 1000
  return new AppCommandBus(
    {
      conversations: new ConversationStore(() => horloge++),
      executionWorkspace: workspace,
      getWorktreeRuntimeStatus: () => ({ available: false, workspacePath: workspace }),
      getWorktreeConflictDiff: async () => ({ available: false, reason: 'not-conflict' })
    } as never,
    () => undefined
  )
}

const espace = (): string => mkdtempSync(join(tmpdir(), 'autowin-fichiers-'))

describe('commandes de fichier au bus', () => {
  it('crée un fichier neuf, dossiers compris', async () => {
    const ws = espace()
    const r = await bus(ws).exec('create_file', {
      path: 'src/neuf/module.ts',
      content: 'export const x = 1\n'
    })
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ allowed: true, path: 'src/neuf/module.ts' })
    expect(readFileSync(join(ws, 'src/neuf/module.ts'), 'utf8')).toBe('export const x = 1\n')
  })

  it('refuse d’écraser un fichier existant', async () => {
    const ws = espace()
    writeFileSync(join(ws, 'deja.ts'), 'PRECIEUX')
    const r = await bus(ws).exec('create_file', { path: 'deja.ts', content: 'ECRASE' })
    expect(r.data).toMatchObject({ allowed: false })
    expect(readFileSync(join(ws, 'deja.ts'), 'utf8')).toBe('PRECIEUX')
  })

  it('refuse un chemin qui sort du workspace', async () => {
    const ws = espace()
    const r = await bus(ws).exec('create_file', { path: '../evade.ts', content: 'x' })
    expect(r.data).toMatchObject({ allowed: false, reason: 'chemin hors du workspace' })
  })

  it('déplace un fichier', async () => {
    const ws = espace()
    writeFileSync(join(ws, 'ancien.ts'), 'CONTENU')
    const r = await bus(ws).exec('move_file', { from: 'ancien.ts', to: 'sous/nouveau.ts' })
    expect(r.data).toMatchObject({ allowed: true, to: 'sous/nouveau.ts' })
    expect(existsSync(join(ws, 'ancien.ts'))).toBe(false)
    expect(readFileSync(join(ws, 'sous/nouveau.ts'), 'utf8')).toBe('CONTENU')
  })

  it('supprime un fichier, et refuse un dossier protégé', async () => {
    const ws = espace()
    writeFileSync(join(ws, 'jetable.ts'), 'x')
    expect((await bus(ws).exec('delete_file', { path: 'jetable.ts' })).data).toMatchObject({
      allowed: true
    })
    expect(existsSync(join(ws, 'jetable.ts'))).toBe(false)
    expect((await bus(ws).exec('delete_file', { path: '.git/config' })).data).toMatchObject({
      allowed: false
    })
  })

  it('rend l’état des copies de travail, et refuse un identifiant fabriqué', async () => {
    const ws = espace()
    expect((await bus(ws).exec('run_status', {})).data).toMatchObject({ allowed: true })
    const r = await bus(ws).exec('run_status', { agentId: '../evasion' })
    expect(r.data).toMatchObject({ allowed: false, reason: 'Identifiant de bureau invalide' })
  })

  it('déclare run_status en lecture seule et les trois écritures en destructif', () => {
    const catalogue = bus(espace()).catalog()
    const par = (nom: string) => catalogue.find((c) => c.name === nom)
    expect(par('run_status')?.annotations?.readOnlyHint).toBe(true)
    for (const nom of ['create_file', 'move_file', 'delete_file']) {
      expect(par(nom)?.annotations?.destructiveHint, nom).toBe(true)
      expect(par(nom)?.annotations?.readOnlyHint, nom).toBe(false)
    }
  })
})
