import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { ConversationStore } from './store/conversations'

/**
 * LES COMMANDES DU TOUR AGISSENT DANS LE DOSSIER DE LA CONVERSATION (2026-09-16).
 *
 * Le chat, lui, partait deja dans le bon dossier depuis le 2026-09-08 : `dossierDeTravailDuTour`
 * resout le dossier range sur la conversation et `agent-pilot` le PASSE au CLI (`workspaceCwd`).
 * Mais les COMMANDES que le modele declenche pendant ce meme tour (`create_file`, `move_file`,
 * `delete_file`, `edit_file`, `run`, `find_in_files`...) lisaient encore `os.executionWorkspace` —
 * la valeur GLOBALE figee au demarrage. Divergence silencieuse et grave : le modele parlait de
 * `D:\GIT\RigApplication` et ecrivait dans `E:\GIT\Autowin-OS`.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : une conversation rangee sur
 * le dossier B pendant que le dossier global vaut A, avec un chemin RELATIF (`neuf.ts`) — c'est
 * exactement le cas ou rien dans l'appel ne dit ou ecrire, donc le seul cas ou le dossier du tour
 * decide. Si le bus retombe sur le global, le fichier atterrit dans A et les assertions tombent.
 */
function espace(prefixe: string): string {
  return resolve(mkdtempSync(join(tmpdir(), `autowin-${prefixe}-`)))
}

function monter(global: string): { bus: AppCommandBus; conversations: ConversationStore } {
  let horloge = 1000
  const conversations = new ConversationStore(() => horloge++)
  const bus = new AppCommandBus(
    {
      conversations,
      executionWorkspace: global,
      getWorktreeRuntimeStatus: () => ({ available: false, workspacePath: global }),
      getWorktreeConflictDiff: async () => ({ available: false, reason: 'not-conflict' })
    } as never,
    () => undefined
  )
  return { bus, conversations }
}

function conversationRangeeSur(conversations: ConversationStore, dossier: string | null): string {
  const conversation = conversations.create({ title: 'fil', provider: 'claude' })
  conversations.rangerDansDossier(conversation.id, dossier)
  return conversation.id
}

describe('commandes — le dossier de travail est celui du TOUR, pas le global', () => {
  it('create_file ecrit dans le dossier range sur la conversation', async () => {
    const global = espace('global')
    const projet = espace('projet')
    const { bus, conversations } = monter(global)
    const conv = conversationRangeeSur(conversations, projet)

    const r = await bus.exec(
      'create_file',
      { path: 'neuf.ts', content: 'export const x = 1\n' },
      conv
    )

    expect(r.ok).toBe(true)
    expect(readFileSync(join(projet, 'neuf.ts'), 'utf8')).toBe('export const x = 1\n')
    expect(existsSync(join(global, 'neuf.ts'))).toBe(false)
  })

  it('read_file lit le fichier du dossier de la conversation, pas celui du global', async () => {
    const global = espace('global')
    const projet = espace('projet')
    writeFileSync(join(global, 'cible.ts'), 'CONTENU-GLOBAL')
    writeFileSync(join(projet, 'cible.ts'), 'CONTENU-PROJET')
    const { bus, conversations } = monter(global)
    const conv = conversationRangeeSur(conversations, projet)

    const r = await bus.exec('read_file', { path: 'cible.ts' }, conv)

    expect(r.ok).toBe(true)
    expect(JSON.stringify(r.data)).toContain('CONTENU-PROJET')
    expect(JSON.stringify(r.data)).not.toContain('CONTENU-GLOBAL')
  })

  it('delete_file supprime dans le dossier de la conversation, jamais dans le global', async () => {
    const global = espace('global')
    const projet = espace('projet')
    writeFileSync(join(global, 'jetable.ts'), 'GLOBAL')
    writeFileSync(join(projet, 'jetable.ts'), 'PROJET')
    const { bus, conversations } = monter(global)
    const conv = conversationRangeeSur(conversations, projet)

    await bus.exec('delete_file', { path: 'jetable.ts' }, conv)

    expect(existsSync(join(projet, 'jetable.ts'))).toBe(false)
    expect(existsSync(join(global, 'jetable.ts'))).toBe(true)
  })

  it('conversation rangee sur un LIBELLE (categorie) → repli sur le dossier global', async () => {
    const global = espace('global')
    const { bus, conversations } = monter(global)
    // « Fiches Team » n'est pas un chemin : le magasin le range en categorie, pas en dossier.
    const conv = conversationRangeeSur(conversations, 'Fiches Team')

    const r = await bus.exec('create_file', { path: 'neuf.ts', content: 'x\n' }, conv)

    expect(r.ok).toBe(true)
    expect(existsSync(join(global, 'neuf.ts'))).toBe(true)
  })

  it('conversation rangee sur un dossier DISPARU → repli sur le dossier global', async () => {
    const global = espace('global')
    const disparu = join(espace('parent'), 'sous-dossier-jamais-cree')
    const { bus, conversations } = monter(global)
    const conv = conversationRangeeSur(conversations, disparu)

    const r = await bus.exec('create_file', { path: 'neuf.ts', content: 'x\n' }, conv)

    expect(r.ok).toBe(true)
    expect(existsSync(join(global, 'neuf.ts'))).toBe(true)
    expect(existsSync(join(disparu, 'neuf.ts'))).toBe(false)
  })

  it('sans conversation (appel hors tour) → dossier global, comportement inchange', async () => {
    const global = espace('global')
    const { bus } = monter(global)

    const r = await bus.exec('create_file', { path: 'neuf.ts', content: 'x\n' })

    expect(r.ok).toBe(true)
    expect(existsSync(join(global, 'neuf.ts'))).toBe(true)
  })
})
