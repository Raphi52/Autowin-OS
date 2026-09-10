import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { deriveConversationState } from './chat-view-model'
import { estNonVue, marquerVue } from './conversation-seen'

/**
 * DEMANDE (conv-1486) : la pastille doit etre JAUNE dans DEUX cas — le tour pose une question,
 * ET le tour est fini mais la conversation n'a pas encore ete visitee. Elle passe verte quand
 * l'utilisateur ouvre la conversation.
 *
 * ENTREES QUI DOIVENT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE :
 *  - `{busy:false, lastAssistantStatus:'completed', unseen:true}` rendant `completed` (vert) :
 *    c'est exactement le defaut vecu — un run vert deja affiche comme lu sans visite.
 *  - `{... asksUser:true}` rendant autre chose que `asking` (la question n'est pas signalee).
 *  - `marquerVue` qui ne rend pas `estNonVue` faux : la visite ne verdirait jamais la pastille.
 *  - une CSS ou `.conversation-state.is-unread` n'existe pas, ou n'est pas un jaune distinct
 *    du vert `is-completed`.
 */
describe('pastille jaune : question posee, ou travail fini non visite', () => {
  it('un tour termine mais NON VISITE est `unread`, pas `completed`', () => {
    expect(
      deriveConversationState({
        busy: false,
        messageCount: 2,
        lastMessageRole: 'assistant',
        lastAssistantStatus: 'completed',
        unseen: true
      }).key
    ).toBe('unread')
  })

  it('la meme conversation VISITEE redevient `completed` (verte)', () => {
    expect(
      deriveConversationState({
        busy: false,
        messageCount: 2,
        lastMessageRole: 'assistant',
        lastAssistantStatus: 'completed',
        unseen: false
      }).key
    ).toBe('completed')
  })

  it('une question ouverte reste `asking` meme si la conversation a ete visitee', () => {
    expect(
      deriveConversationState({
        busy: false,
        messageCount: 2,
        lastMessageRole: 'assistant',
        lastAssistantStatus: 'completed',
        asksUser: true,
        unseen: false
      }).key
    ).toBe('asking')
  })

  it('un travail EN COURS reste `running` : non-visite ne prime pas sur le direct', () => {
    expect(deriveConversationState({ busy: true, messageCount: 2, unseen: true }).key).toBe(
      'running'
    )
  })

  it('un echec non visite reste `failed` : la couleur d’erreur prime sur le non-lu', () => {
    expect(
      deriveConversationState({
        busy: false,
        messageCount: 2,
        lastMessageRole: 'assistant',
        lastAssistantStatus: 'failed',
        unseen: true
      }).key
    ).toBe('failed')
  })

  it('la visite marque la conversation comme vue, jusqu’a la prochaine mise a jour', () => {
    const conv = { id: 'c1', updatedAt: 100 }
    expect(estNonVue(conv, {})).toBe(true)
    const apres = marquerVue({}, conv.id, conv.updatedAt)
    expect(estNonVue(conv, apres)).toBe(false)
    expect(estNonVue({ id: 'c1', updatedAt: 200 }, apres)).toBe(true)
  })

  it('`is-unread` porte un jaune propre, distinct du vert de `is-completed`', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    const theme = readFileSync(new URL('../assets/theme.css', import.meta.url), 'utf8')
    /*
     * LA TEINTE VIENT D'UN JETON MAINTENANT. ChatView.css appelle `var(--chat-etat-non-lu)` et la
     * valeur vit dans theme.css : c'est ce qui permet aux themes clairs de reteinter la pastille.
     * On resout l'appel jusqu'a sa valeur finale, donc l'exigence tient toujours sur la COULEUR
     * REELLE -- un jaune propre, distinct du vert de `completed` -- et pas sur un nom de variable.
     */
    const resoudre = (valeur: string): string => {
      const brut = valeur.trim()
      const appel = /^var\((--[a-z0-9-]+)\)$/.exec(brut)
      if (!appel) return brut.toLowerCase()
      const def = new RegExp(`^\\s*${appel[1]}:\\s*([^;]+);`, 'm').exec(theme)
      return def ? resoudre(def[1]) : brut.toLowerCase()
    }
    const couleur = (k: string): string | undefined => {
      const motif = new RegExp(
        '\\.conversation-state\\.is-' +
          k +
          '\\s*\\{[^}]*?color:\\s*(#[0-9a-fA-F]{3,8}|var\\(--[a-z0-9-]+\\))',
        's'
      )
      const brut = css.match(motif)?.[1]
      return brut === undefined ? undefined : resoudre(brut)
    }
    expect(couleur('unread')).toMatch(/^#[0-9a-f]{3,8}$/)
    expect(couleur('unread')).not.toBe(couleur('completed'))
  })
})
