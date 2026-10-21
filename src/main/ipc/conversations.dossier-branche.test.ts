/**
 * Canaux `os:conversations:create` et `os:conversations:fork` : le DOSSIER DE TRAVAIL part avec le fil
 * (conv-1038, 2026-10-21). « Revenir à ce tour » et « Essaie 3 façons » créaient la branche, puis la
 * rangeaient dans sa copie séparée par un second appel dont l'échec n'était pas lu : la branche
 * travaillait alors dans le dossier PARTAGÉ.
 *
 * Entrées qui font échouer une version fausse : un libellé (« Factures ») à la place d'un chemin —
 * le fil ENTIER doit être refusé, aucune conversation créée (le store, lui, ignore un libellé en
 * silence et le fil naîtrait sans dossier) ; un dossier qui n'est pas une chaîne. Jumeaux acceptés :
 * un vrai chemin, et l'appel sans dossier, dont le contrat ne change pas.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ConversationStore } from '../store/conversations'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)
  }
}))
vi.mock('../ipc-senders', () => ({ assertTrustedRendererSender: () => undefined }))

import { registerConversationsIpc } from './conversations'

const store = new ConversationStore(() => 1)

beforeAll(() => {
  registerConversationsIpc({
    os: { conversations: store } as never,
    broadcast: () => undefined,
    dossierDuFil: () => 'D:\\AutoWinOS',
    dossierDesRetours: () => 'D:\\donnees\\retours-de-tour'
  } as never)
})

const appeler = (canal: string, ...args: unknown[]): unknown => {
  const handler = handlers.get(canal)
  if (!handler) throw new Error(`canal absent : ${canal}`)
  return handler({}, ...args)
}

describe('os:conversations:create — dossier dès la création', () => {
  it('un chemin : le fil naît rangé dans ce dossier (forme canonique)', () => {
    const fil = appeler('os:conversations:create', {
      title: 'Retour au premier tour',
      provider: 'claude',
      projectPath: 'D:/donnees/retours-de-tour/retour__A-1'
    }) as { projectPath?: string }
    expect(fil.projectPath).toBe('D:\\donnees\\retours-de-tour\\retour__A-1')
  })

  it('sans dossier : contrat inchangé, aucun dossier posé', () => {
    const fil = appeler('os:conversations:create', { title: 'T', provider: 'claude' }) as {
      projectPath?: string
    }
    expect(fil.projectPath).toBeUndefined()
  })

  it.each(['Factures', 'retours/relatif', 42])(
    'un dossier qui n’est pas un chemin (%j) refuse le fil ENTIER',
    (projectPath) => {
      const avant = store.list().length
      expect(() =>
        appeler('os:conversations:create', { title: 'T', provider: 'claude', projectPath })
      ).toThrow(/projectPath/)
      expect(store.list().length).toBe(avant)
    }
  )
})

describe('os:conversations:fork — branche née dans sa copie', () => {
  function source(): { id: string; ancre: string } {
    const fil = store.create({ title: 'S', provider: 'claude', projectPath: 'D:\\GIT\\Contoso' })
    store.append(fil.id, { role: 'user', content: 'u1' })
    return { id: fil.id, ancre: store.get(fil.id)!.messages[0].messageId! }
  }

  it('avec un dossier : la branche y travaille', () => {
    const { id, ancre } = source()
    const branche = appeler('os:conversations:fork', id, ancre, {
      dossier: 'D:/donnees/retours-de-tour/retour__S-2'
    }) as { projectPath?: string }
    expect(branche.projectPath).toBe('D:\\donnees\\retours-de-tour\\retour__S-2')
  })

  it('sans option (bouton « brancher ») : la branche garde le dossier de sa source', () => {
    const { id, ancre } = source()
    const branche = appeler('os:conversations:fork', id, ancre) as { projectPath?: string }
    expect(branche.projectPath).toBe('D:\\GIT\\Contoso')
  })

  it.each([{ dossier: 'Factures' }, { dossier: 42 }])(
    'un dossier invalide (%j) refuse la branche ENTIÈRE',
    (options) => {
      const { id, ancre } = source()
      const avant = store.list().length
      expect(() => appeler('os:conversations:fork', id, ancre, options)).toThrow(/dossier/i)
      expect(store.list().length).toBe(avant)
    }
  )
})
