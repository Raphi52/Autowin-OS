import { describe, expect, it } from 'vitest'
import { AppCommandBus, type AppEvent } from './commands'

/**
 * CLASSER UNE CONVERSATION — la capacité absente poussait l'agent au pire chemin.
 *
 * Demande de l'utilisateur : « ranges moi mes conversations dans des sous catégories adéquates ».
 * Mesuré dans `conv-1244` le 2026-08-15, en rejouant le journal du tour : faute de commande pour
 * classer, l'agent a tenté de piloter le BUREAU WINDOWS à la souris — `desktop_act`, clics qui
 * ouvrent les réglages rapides de Windows par erreur, tentative de relancer l'application — puis a
 * échoué sur « Type d'action desktop inconnu: double_click ». Rien n'a été rangé.
 *
 * Le catalogue savait RENOMMER et SUPPRIMER une conversation, jamais la CLASSER, alors que
 * `conversations.setProjectPath` existait déjà côté magasin. C'est la même forme que `list_files` le
 * même jour : une capacité manquante ne rend pas l'agent prudent, elle le pousse vers un chemin
 * désespéré — et l'échec se présente ensuite comme un problème de l'utilisateur.
 *
 * Ce banc exerce le COMPORTEMENT via `AppCommandBus.exec`, pas l'orthographe du source de
 * `commands.ts` : un renommage interne inoffensif doit rester vert, la disparition d'un effet
 * observable (chemin posé/effacé, rafraîchissement diffusé) doit rougir.
 */

type ConversationDouble = {
  id: string
  title: string
  category: string
  provider: string
  projectPath?: string
}

type Espion = {
  os: unknown
  events: AppEvent[]
  chemin: (id: string) => string | undefined
}

function banc(): Espion {
  const conversations = new Map<string, ConversationDouble>()
  conversations.set('conv-1', {
    id: 'conv-1',
    title: 'A garder',
    category: 'claude',
    provider: 'claude',
    projectPath: undefined
  })
  const events: AppEvent[] = []
  return {
    events,
    chemin: (id) => conversations.get(id)?.projectPath,
    os: {
      conversations: {
        get: (id: string) => conversations.get(id),
        list: () => [...conversations.values()],
        setProjectPath: (id: string, projectPath: string | null) => {
          const conversation = conversations.get(id)
          if (!conversation) return undefined
          return Object.assign(conversation, { projectPath: projectPath ?? undefined })
        }
      }
    }
  }
}

function bus(espion: Espion): AppCommandBus {
  return new AppCommandBus(espion.os as ConstructorParameters<typeof AppCommandBus>[0], (e) => {
    espion.events.push(e)
  })
}

describe('commande de classement des conversations', () => {
  it('est OFFERTE dans le catalogue, sinon l’agent ne peut pas la choisir', () => {
    // Une capacité non cataloguée est invisible au modèle : elle n'existe pas de son point de vue.
    const noms = bus(banc())
      .catalog()
      .map((command) => command.name)

    expect(noms).toContain('classer_conversation')
  })

  it('s’appuie sur le magasin existant : le chemin est POSÉ sur la conversation', async () => {
    const espion = banc()

    const result = await bus(espion).exec('classer_conversation', {
      id: 'conv-1',
      dossier: 'C:/Clients/Amitel'
    })

    expect(result).toMatchObject({
      ok: true,
      data: { id: 'conv-1', dossier: 'C:/Clients/Amitel' }
    })
    expect(espion.chemin('conv-1')).toBe('C:/Clients/Amitel')
  })

  it('un dossier VIDE déclasse au lieu d’écrire une chaîne vide', async () => {
    // Sans cela, « déclasser » créerait un groupe au nom vide dans la barre latérale.
    const espion = banc()
    await bus(espion).exec('classer_conversation', { id: 'conv-1', dossier: 'C:/Clients/Amitel' })

    const result = await bus(espion).exec('classer_conversation', { id: 'conv-1', dossier: '   ' })

    expect(result).toMatchObject({ ok: true, data: { id: 'conv-1', dossier: null } })
    expect(espion.chemin('conv-1')).toBeUndefined()
  })

  it('RAFRAÎCHIT la vue : un classement invisible ne vaut rien', async () => {
    const espion = banc()

    await bus(espion).exec('classer_conversation', { id: 'conv-1', dossier: 'C:/Clients/Amitel' })

    expect(espion.events).toContainEqual({ type: 'refresh', scope: 'conversations' })
  })

  it('DIT quand la conversation est introuvable, au lieu de se taire', async () => {
    const espion = banc()

    const result = await bus(espion).exec('classer_conversation', {
      id: 'conv-absente',
      dossier: 'C:/Clients/Amitel'
    })

    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/introuvable/i) })
    // Rien de diffusé : pas de rafraîchissement pour un classement qui n'a pas eu lieu.
    expect(espion.events).toHaveLength(0)
  })
})
