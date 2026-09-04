import { describe, expect, it, vi } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * « JE PASSE MA VIE A /SALVAGE » (2026-09-04) — LE TRI SE FAIT A CHAUD.
 *
 * Mesure a l'origine du correctif : 30 branches de secours, 23 sauvetages et 134 marqueurs
 * `refs/autowin/trie/` sur l'installation — 134 tris deja faits A LA MAIN. Une file ne se vide
 * jamais par des tris manuels quand elle se remplit plus vite qu'on ne trie.
 *
 * Le seul instant ou le tri est gratuit est la CLOTURE du run : il y a un travail, et sa conclusion
 * est connue. Un run `red` / `not-requested` a vu son travail REFUSE par le contrat de cloture ; le
 * remonter a l'humain trois jours plus tard ne change pas ce verdict.
 *
 * Les deux bords comptent : un run RETENU par un tournoi (`retainGreen`) est vert et attend une
 * vraie decision — il ne doit surtout pas se taire.
 */
const managerDouble = (marquerTravailTrie: (id: string) => boolean, fichiers: string[]) =>
  ({
    acquire: (id: string) => `/tmp/agent__${id}`,
    listAgentIds: () => [],
    remove: () => undefined,
    changedFiles: () => fichiers,
    finalize: () => ({ ok: true, files: [] }),
    describe: (id: string) => ({
      workspacePath: '/repo',
      worktreePath: `/tmp/agent__${id}`,
      baseBranch: 'main',
      baseSha: '2'.repeat(40)
    }),
    marquerTravailTrie
  }) as unknown as ConstructorParameters<typeof RunWorktreeCoordinator>[0]['manager']

describe('un run qui finit ROUGE se trie lui-meme, a chaud', () => {
  it('marque le travail refuse — sans rien supprimer', () => {
    const marquer = vi.fn().mockReturnValue(true)
    const co = new RunWorktreeCoordinator({
      manager: managerDouble(marquer, ['src/main/os.ts']),
      nowFn: () => 1
    })

    co.begin('run-rouge-1', 'Une mutation refusee', true)
    co.end('run-rouge-1', { merge: false })

    expect(marquer).toHaveBeenCalledWith('run-rouge-1')
    // Le tri est une ANNOTATION : l'activite garde le travail, il reste ouvrable nommement.
    expect(co.activity()[0]).toMatchObject({ state: 'ready', verdict: 'red' })
  })

  it('un travail RETENU par un tournoi continue d’attendre une vraie decision', () => {
    const marquer = vi.fn().mockReturnValue(true)
    const co = new RunWorktreeCoordinator({
      manager: managerDouble(marquer, ['src/main/os.ts']),
      nowFn: () => 1
    })

    co.begin('run-vert-tournoi', 'Solution conservee', true)
    co.end('run-vert-tournoi', { merge: false, retainGreen: true })

    expect(marquer).not.toHaveBeenCalled()
  })
})
