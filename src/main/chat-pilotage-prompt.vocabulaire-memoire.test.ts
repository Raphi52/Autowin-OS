import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { REMEMBER_TYPES } from './brain-remember'

/**
 * LA PROSE DU BLOC MÉMOIRE NE DOIT PAS SOUFFLER UN VOCABULAIRE ILLÉGAL.
 *
 * Le bloc disait quoi retenir en français — « une cause racine vérifiée, une décision technique
 * tranchée, une CONTRAINTE d'un système, un chiffre mesuré » — quatre situations dont aucune n'est
 * une valeur de `REMEMBER_TYPES`. Le modèle y prenait le mot le plus proche de son fait et se
 * faisait refuser : `cause-racine` le 2026-08-20 (conv-1086), à nouveau le 2026-08-26, puis
 * `contrainte` le 2026-08-27 (conv-1426).
 *
 * `signatureDeCommande` porte désormais l'énumération dans la signature du catalogue, mais cela ne
 * suffit pas : elle DISPARAÎT quand `remember` est absent du catalogue courant (cas du catalogue en
 * lecture seule), et deux vocabulaires concurrents dans un même prompt laissent le choix au modèle.
 *
 * D'où le banc : on construit le prompt avec un catalogue VIDE, ce qui isole la prose — la signature
 * ne peut pas répondre à sa place. Sans cette précaution, le test se validerait lui-même.
 */
const proseSeule = (): string => buildChatPilotagePrompt([])

describe('la prose du bloc MÉMOIRE parle le vocabulaire de `remember`', () => {
  it('nomme les quatre valeurs légales, sans l’aide de la signature du catalogue', () => {
    const prompt = proseSeule()

    for (const type of REMEMBER_TYPES) {
      expect(prompt).toContain('`' + type + '`')
    }
  })

  it('ne souffle plus « contrainte » comme s’il s’agissait d’un type', () => {
    // Le mot reste légitime pour DÉCRIRE un fait (« une contrainte, un invariant, un chiffre
    // mesuré »), mais plus comme item d'une liste de catégories : il s'y lisait comme une valeur.
    expect(proseSeule()).not.toContain("une contrainte d'un système")
  })

  it('rattache chaque type à ce qu’il couvre, plutôt que de les lister à sec', () => {
    const prompt = proseSeule()

    expect(prompt).toContain('`lesson` — une leçon réutilisable')
    expect(prompt).toContain('`decision` — un choix technique tranché')
    expect(prompt).toContain("`preference` — un goût ou une règle de l'utilisateur")
    expect(prompt).toContain('`domain` — un fait du système')
  })
})

/**
 * LA PORTÉE ÉTAIT LE SEUL CHAMP OBLIGATOIRE QUE LA PROSE NE NOMMAIT PAS.
 *
 * Mesuré le 2026-09-02 (conv-142) : `remember` refusé « portée manquante », rien d'écrit, et le
 * modèle avait déjà annoncé le dépôt. `signatureDeCommande` n'expose que les ÉNUMÉRATIONS ; `scope`
 * n'a pas de liste fermée, donc il n'apparaissait que comme nom nu, sans dire ce qu'on en attend.
 */
describe('la prose du bloc MÉMOIRE nomme la portée', () => {
  it('dit que la portée est remplie par défaut, et à quoi sert `global`', () => {
    const prompt = proseSeule()

    expect(prompt).toContain('`scope`')
    expect(prompt).toContain('le projet courant')
    expect(prompt).toContain('`global`')
  })
})
