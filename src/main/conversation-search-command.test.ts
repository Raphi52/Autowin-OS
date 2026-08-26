import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { ConversationStore } from './store/conversations'

/**
 * L'OUTIL DOIT ETRE ATTEIGNABLE, pas seulement exister.
 *
 * Lecon de `feedback_expose_is_not_integrate` : une capacite branchee mais jamais offerte au modele
 * est du theatre. `conversation_read` a vecu exactement cela jusqu'au 2026-08-18 -- 31 modules de
 * retrospective exposes a l'oeil par 9 canaux IPC, et a l'agent par AUCUN outil.
 *
 * Ce test tient les deux bouts : la commande est dans le catalogue REELLEMENT rendu au modele
 * (`bus.catalog()`, pas la constante interne), et elle CHERCHE vraiment quand on l'appelle.
 */

function busAvecCorpus(): AppCommandBus {
  let horloge = 1000
  const conversations = new ConversationStore(() => horloge++)
  const a = conversations.create({ title: 'Pastilles', provider: 'claude' })
  conversations.append(a.id, { role: 'user', content: 'explique le code couleur de la pastille' })
  const b = conversations.create({ title: 'Ailleurs', provider: 'claude' })
  conversations.append(b.id, { role: 'user', content: 'parle-moi des tickets RIG' })
  return new AppCommandBus({ conversations } as never, () => undefined)
}

describe('conversation_search est offert a l orchestrateur', () => {
  const fiche = (): Record<string, unknown> | undefined =>
    busAvecCorpus()
      .catalog()
      .find((c) => c.name === 'conversation_search') as never

  it('figure dans le catalogue REELLEMENT rendu au modele', () => {
    expect(fiche()).toBeDefined()
  })

  it('est declaree en lecture seule : chercher ne modifie rien', () => {
    expect((fiche() as { annotations: { readOnlyHint: boolean } }).annotations.readOnlyHint).toBe(
      true
    )
  })

  it('nomme le geste suivant, pour que trouver mene a lire', () => {
    expect(String((fiche() as { description: string }).description)).toContain('conversation_read')
  })

  it('cherche pour de vrai, et ne rend que ce qui porte le terme', async () => {
    const resultat = await busAvecCorpus().exec('conversation_search', { terme: 'pastille' })
    expect(resultat.ok).toBe(true)
    const data = resultat.data as { conversations: { title: string }[]; note: string }
    expect(data.conversations.map((c) => c.title)).toEqual(['Pastilles'])
  })

  it('dit le vide au lieu de rendre une liste vide muette', async () => {
    const resultat = await busAvecCorpus().exec('conversation_search', { terme: 'kubernetes' })
    const data = resultat.data as { conversations: unknown[]; note: string }
    expect(data.conversations).toEqual([])
    expect(data.note.toLowerCase()).toContain('aucune')
  })
})
