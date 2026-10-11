import { describe, expect, it } from 'vitest'
import {
  buildAutowinKaizenTask,
  localiserMessageCite,
  type AutowinKaizenEvidence
} from './autowin-kaizen-context'

/*
  Cas reel (2026-10-11) : « /kaizen dans la conv 243 il a pas pris en compte le message "utiliser
  remotion ou hyperframes c'est utile?" ». Le dossier recu etait celui de conv-243 (un seul tour,
  cb786c88-9d33-413c-8faf-dc3a31b785f6, sur les refus « safeguards » ; `saisies: []`) : la phrase
  citee n'y figurait nulle part. Le journal des saisies la plaçait dans conv-253 (ts 1791720124446,
  voie « orientation »). Tout le kaizen partait sur la mauvaise conversation.
*/
const TACHE =
  '/kaizen dans la conv 243 il a pas pris en compte le message "utiliser remotion ou hyperframes c\'est utile?\n"'

const conv = (id: string, ...users: string[]) => ({
  id,
  messages: users.map((content) => ({ role: 'user', content }))
})

describe('localiserMessageCite', () => {
  it('reprend la conversation qui contient VRAIMENT la phrase citee, et le dit', () => {
    const cible = localiserMessageCite(TACHE, 'conv-243', [
      conv('conv-243', "Fais en sorte qu'un refus du modèle IA relance le tour"),
      conv('conv-253', 'fais la video', "utiliser remotion ou hyperframes c'est utile?"),
      // La demande /kaizen elle-meme recopie la phrase : elle ne compte pas.
      conv('conv-258', TACHE)
    ])
    expect(cible.conversationId).toBe('conv-253')
    expect(cible.avis).toContain('conv-243')
    expect(cible.avis).toContain('conv-253')
  })

  it('garde la conversation nommee quand la phrase y est', () => {
    const cible = localiserMessageCite(TACHE, 'conv-253', [
      conv('conv-253', 'utiliser  Remotion ou hyperframes c’est utile ?'),
      conv('conv-9', "utiliser remotion ou hyperframes c'est utile?")
    ])
    expect(cible).toEqual({ conversationId: 'conv-253' })
  })

  it('plusieurs candidates : ne choisit pas a la place de l’utilisateur, mais le signale', () => {
    const cible = localiserMessageCite(TACHE, 'conv-243', [
      conv('conv-243', 'autre chose'),
      conv('conv-1', "utiliser remotion ou hyperframes c'est utile?"),
      conv('conv-2', "utiliser remotion ou hyperframes c'est utile?")
    ])
    expect(cible.conversationId).toBe('conv-243')
    expect(cible.avis).toContain('conv-1')
    expect(cible.avis).toContain('conv-2')
  })

  it('introuvable partout : le dossier reste, mais il ne passe plus pour la scene citee', () => {
    const cible = localiserMessageCite(TACHE, 'conv-243', [conv('conv-243', 'autre chose')])
    expect(cible.conversationId).toBe('conv-243')
    expect(cible.avis).toMatch(/aucun/i)
  })

  it('sans citation, rien ne change', () => {
    expect(
      localiserMessageCite('/kaizen conv-243 le tour a ete lent', 'conv-243', [conv('conv-243')])
    ).toEqual({ conversationId: 'conv-243' })
  })
})

describe('buildAutowinKaizenTask — avis de cible', () => {
  it('place l’avis AVANT le dossier, hors de la partie rognee par le budget', () => {
    const evidence: AutowinKaizenEvidence = {
      conversation: { id: 'conv-253', title: 't', messages: [] },
      activity: [],
      brainTraces: [],
      causalEvents: [],
      runs: []
    }
    const task = buildAutowinKaizenTask(TACHE, evidence, 'phrase citee absente de conv-243')
    const avis = task.indexOf('phrase citee absente de conv-243')
    expect(avis).toBeGreaterThan(0)
    expect(avis).toBeLessThan(task.indexOf('=== DOSSIER DE PREUVE AUTOWIN OS ==='))
  })
})
