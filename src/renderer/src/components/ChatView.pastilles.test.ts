import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { deriveConversationState } from './chat-view-model'

/**
 * CONTRAT DES PASTILLES DE CONVERSATION (remake).
 *
 * Défaut vécu (conv-1407) : `waiting`, `interrupted` et `cancelled` partageaient la MÊME
 * couleur (#ffb020) et `completed` héritait du cyan de `running` — quatre états, deux couleurs.
 * Une pastille qui ne distingue pas ne renseigne pas.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE : une CSS où deux clés
 * quelconques retombent sur la même couleur (p. ex. laisser `is-cancelled` groupé avec
 * `is-interrupted`, ou omettre `.is-completed` pour qu'il hérite du cyan de la base) — le test
 * de distinction ci-dessous compare les 6 couleurs deux à deux, il ne se contente pas de
 * chercher des sélecteurs.
 */

const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')

/** Couleur RÉSOLUE d'un état : sa règle propre, sinon la couleur de `.conversation-state`. */
function couleurEtat(key: string): string | null {
  const propre = css.match(
    new RegExp(`\\.conversation-state\\.is-${key}\\s*\\{[^}]*?\\bcolor:\\s*(#[0-9a-fA-F]{3,8})`, 's')
  )
  if (propre) return propre[1].toLowerCase()
  const base = css.match(/\.conversation-state\s*\{[^}]*?\bcolor:\s*(#[0-9a-fA-F]{3,8})/s)
  return base ? base[1].toLowerCase() : null
}

const ETATS = ['running', 'completed', 'failed', 'interrupted', 'cancelled', 'waiting'] as const

describe('pastilles de conversation — chaque état a sa propre couleur', () => {
  it('les 6 états signifiants portent chacun une couleur explicite', () => {
    for (const key of ETATS) {
      expect(couleurEtat(key), `couleur manquante pour is-${key}`).toMatch(/^#[0-9a-f]{3,8}$/)
    }
  })

  it('aucune couleur n’est partagée par deux états (le défaut vécu)', () => {
    const paires: string[] = []
    for (let i = 0; i < ETATS.length; i += 1) {
      for (let j = i + 1; j < ETATS.length; j += 1) {
        if (couleurEtat(ETATS[i]) === couleurEtat(ETATS[j])) {
          paires.push(`${ETATS[i]} = ${ETATS[j]} (${couleurEtat(ETATS[i])})`)
        }
      }
    }
    expect(paires, `états indiscernables : ${paires.join(', ')}`).toEqual([])
  })

  it('`completed` ne réutilise pas le cyan de `running`', () => {
    expect(couleurEtat('completed')).not.toBe(couleurEtat('running'))
  })

  it('l’animation reste réservée au travail EN COURS, et se coupe en reduced-motion', () => {
    expect(css).toMatch(/\.conversation-state\.is-running\s*\{[^}]*animation:\s*conversation-state-pulse/s)
    for (const key of ['completed', 'failed', 'interrupted', 'cancelled', 'waiting']) {
      const bloc = css.match(new RegExp(`\\.conversation-state\\.is-${key}\\s*\\{[^}]*\\}`, 's'))
      expect(bloc?.[0] ?? '', `is-${key} ne doit pas s'animer`).not.toMatch(/animation:/)
    }
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.conversation-state\.is-running,[^}]*animation:\s*none/s
    )
  })

  it('chaque clé produite par le modèle a une couleur (aucun état orphelin)', () => {
    const cles = new Set(
      [
        deriveConversationState({ busy: true, messageCount: 1 }).key,
        deriveConversationState({ busy: false, messageCount: 1, lastMessageRole: 'user' }).key,
        deriveConversationState({
          busy: false,
          messageCount: 2,
          lastMessageRole: 'assistant',
          lastAssistantStatus: 'failed'
        }).key,
        deriveConversationState({
          busy: false,
          messageCount: 2,
          lastMessageRole: 'assistant',
          lastAssistantStatus: 'interrupted'
        }).key,
        deriveConversationState({
          busy: false,
          messageCount: 2,
          lastMessageRole: 'assistant',
          lastAssistantStatus: 'cancelled'
        }).key,
        deriveConversationState({
          busy: false,
          messageCount: 2,
          lastMessageRole: 'assistant',
          lastAssistantStatus: 'completed'
        }).key
      ].filter((k) => k !== 'empty')
    )
    for (const key of cles) {
      expect(css, `aucune règle CSS pour is-${key}`).toMatch(
        new RegExp(`\\.conversation-state\\.is-${key}\\b`)
      )
    }
  })
})
