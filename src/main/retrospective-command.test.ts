import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { ConversationStore } from './store/conversations'

/**
 * DEFAUT VECU conv-1407 (2026-08-26), second volet.
 *
 * Apres avoir donne a l orchestrateur de quoi CHERCHER dans les conversations, il restait aveugle a
 * son PROPRE travail : ses runs, ses traces causales, l activite de ses tours. Autowin les collecte
 * pourtant deja, en un seul appel — `collectAutowinKaizenEvidence` rassemble conversation, activite,
 * traces Brain, evenements causaux et RUN.md natifs.
 *
 * Mais ce dossier n etait atteignable QUE par une tache commencant par `/kaizen`, donc en LANCANT un
 * run complet : coûteux, delegue, asynchrone. L orchestrateur ne pouvait pas simplement REGARDER ce
 * qui s etait passe avant de decider. C est la meme forme que `conversation_read` avant le 18/08 --
 * branche pour l oeil et pour un pipeline, jamais pour le modele qui decide.
 *
 * Un agent cense decider s il delegue doit pouvoir s informer SANS deleguer. Sinon la seule facon de
 * savoir coute un run.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA COMMANDE EST FAUSSE : une conversation inconnue doit
 * ECHOUER franchement. Rendre un dossier vide laisserait conclure « il ne s est rien passe » alors
 * que l identifiant etait faux -- la conclusion inverse de celle qu une retrospective doit produire.
 */

function busAvecConversation(): AppCommandBus {
  let horloge = 1000
  const conversations = new ConversationStore(() => horloge++)
  const c = conversations.create({ title: 'Pastilles', provider: 'claude' })
  conversations.append(c.id, { role: 'user', content: 'remake les pastilles de couleurs' })
  conversations.append(c.id, { role: 'assistant', content: 'je differencie les trois etats' })
  return new AppCommandBus({ conversations } as never, () => undefined)
}

describe('retrospective : l orchestrateur peut regarder son propre travail', () => {
  it('figure dans le catalogue REELLEMENT rendu au modele', () => {
    const fiche = busAvecConversation()
      .catalog()
      .find((c) => c.name === 'retrospective')
    expect(fiche).toBeDefined()
    expect(fiche?.annotations?.readOnlyHint).toBe(true)
  })

  it('rend le dossier sans lancer le moindre run', async () => {
    const resultat = await busAvecConversation().exec('retrospective', { id: 'conv-1' })
    expect(resultat.ok).toBe(true)
    const data = resultat.data as {
      conversation: { messages: unknown[] }
      causalEvents: unknown[]
      runs: unknown[]
    }
    expect(data.conversation.messages.length).toBe(2)
    expect(Array.isArray(data.causalEvents)).toBe(true)
    expect(Array.isArray(data.runs)).toBe(true)
  })

  it('echoue franchement sur une conversation inconnue, au lieu de rendre un dossier vide', async () => {
    const resultat = await busAvecConversation().exec('retrospective', { id: 'conv-inexistante' })
    expect(resultat.ok).toBe(false)
  })
})
