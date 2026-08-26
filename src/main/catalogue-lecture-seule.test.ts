import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { ConversationStore } from './store/conversations'

/**
 * SAVOIR doit rester possible sur un tour qui ne fait que PARLER.
 *
 * Un tour declare lecture-seule ne laisse passer que les commandes portant `readOnlyHint`
 * (`agent-pilot.ts` : « seule une commande de LECTURE atteint le bus »). C'est exactement le tour ou
 * l'orchestrateur doit COMPRENDRE avant d'agir -- et c'etait un tour conversationnel qui ouvrait
 * conv-1407 (« explique-moi le code couleur de la pastille »).
 *
 * Ce depot a deja paye ce piege dans l'autre sens : avant `read_file` / `find_in_files`, une analyse
 * ne pouvait RIEN lire (mesure sur 4 runs du scout de veille, conv-1154 -> 1157). Une capacite de
 * lecture qui n'est pas declaree en lecture seule est une capacite absente la ou elle sert le plus.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LE CADRAGE EST FAUX : une commande MUTANTE qui se
 * retrouverait dans ce filtre. Le dernier cas garde ce bord -- `edit_file` doit en rester dehors,
 * sinon « lecture seule » ne veut plus rien dire.
 */

function bus(): AppCommandBus {
  let horloge = 1000
  return new AppCommandBus(
    { conversations: new ConversationStore(() => horloge++) } as never,
    () => undefined
  )
}

const lectureSeule = (): string[] =>
  bus()
    .catalog()
    .filter((commande) => commande.annotations?.readOnlyHint === true)
    .map((commande) => commande.name)

describe('un tour conversationnel peut s informer', () => {
  it('peut CHERCHER dans les conversations sans rien modifier', () => {
    expect(lectureSeule()).toContain('conversation_search')
  })

  it('peut LIRE une conversation trouvee', () => {
    expect(lectureSeule()).toContain('conversation_read')
  })

  it('peut REGARDER ce qui s est passe, runs et traces compris', () => {
    expect(lectureSeule()).toContain('retrospective')
  })

  it('ne laisse pas passer une commande qui ECRIT', () => {
    expect(lectureSeule()).not.toContain('edit_file')
  })
})
