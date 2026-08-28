import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * DEFAUT VECU le 2026-08-28 (conv-1498). L'utilisateur avait choisi une variante nommee « 5A » dans
 * un echantillon front rendu par l'agent lui-meme, deux tours plus tot. A « non je veux le 5A
 * rapide », l'agent a appele `conversation_search('5A')`, recu ZERO resultat, et conclu : « 5A ne
 * correspond a rien dans l'historique des 961 conversations ». Le libelle etait pourtant dans SA
 * propre conversation.
 *
 * Cause racine : `motsCherchables` tokenise la demande avec `motsDe(terme)`, dont le minimum est de
 * trois lettres — regle saine pour « de / la / et », mais qui rend un terme de deux caracteres
 * INCHERCHABLE, et le fait silencieusement : zero mot cherchable -> `search` rend [] -> le message
 * affirme l'ABSENCE. Un faux negatif deguise en fait.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LE CORRECTIF EST FAUX : une conversation qui ne porte pas
 * le terme court doit rester absente. Rendre tout le corpus des qu'un terme est court serait un dump.
 */
describe('recherche par contenu — terme court (moins de 3 caracteres)', () => {
  const magasin = (): ConversationStore => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const a = store.create({ title: 'Echantillon spinner', provider: 'claude' })
    store.append(a.id, {
      role: 'assistant',
      content: 'variante 5A · Flashy — cyan / magenta / jaune'
    })
    const b = store.create({ title: 'Sans rapport', provider: 'claude' })
    store.append(b.id, { role: 'user', content: 'parle-moi des tickets RIG' })
    return store
  }

  it('retrouve la variante nommee 5A', () => {
    const trouve = magasin().search('5A')
    expect(trouve.map((t) => t.title)).toEqual(['Echantillon spinner'])
    expect(trouve[0].extraits.length).toBeGreaterThan(0)
    expect(trouve[0].extraits[0].extrait).toContain('5A')
  })

  it('ne rend rien quand le terme court est absent du corpus', () => {
    expect(magasin().search('9Z')).toEqual([])
  })

  it('ne rend pas tout le corpus sur un terme vide', () => {
    expect(magasin().search('   ')).toEqual([])
  })
})
