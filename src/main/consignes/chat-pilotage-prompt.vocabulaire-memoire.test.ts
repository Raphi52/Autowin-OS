import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { REMEMBER_TYPES } from '../brain/brain-remember'
import { outilsDuChat } from '../chat/chat-mcp'
import { CATALOG } from '../commands/commands'

/**
 * LA PROSE DU BLOC MÉMOIRE NE DOIT PAS SOUFFLER UN VOCABULAIRE ILLÉGAL.
 *
 * Le bloc disait quoi retenir en français — « une cause racine vérifiée, une décision technique
 * tranchée, une CONTRAINTE d'un système, un chiffre mesuré » — quatre situations dont aucune n'est
 * une valeur de `REMEMBER_TYPES`. Le modèle y prenait le mot le plus proche de son fait et se
 * faisait refuser : `cause-racine` le 2026-08-20, à nouveau le 2026-08-26, puis
 * `contrainte` le 2026-08-27.
 *
 * `signatureDeCommande` porte l'énumération dans la signature du catalogue, mais un mot nu ne dit pas
 * ce qu'il couvre, et deux vocabulaires concurrents laissent le choix au modèle. Les valeurs et leur
 * sens vivent donc à UN endroit : la description de `remember`, qui part dans les deux chemins — outil
 * direct, et liste texte quand les outils directs ne sont pas servis. La consigne ne les redit pas.
 *
 * D'où le banc : les phrases exigées ne figurent pas dans la signature (`type: lesson|decision|…`,
 * sans accents graves ni définition) — elle ne peut pas répondre à leur place.
 */
const remember = (): { description: string; args: Record<string, unknown> } =>
  CATALOG.find((c) => c.name === 'remember')!
/** Ce que le modèle reçoit sur `remember`, dans chacun des deux chemins. */
const recus = (): string[] => [
  buildChatPilotagePrompt(CATALOG),
  `${buildChatPilotagePrompt(CATALOG, { outilsDirects: outilsDuChat(CATALOG) })}\n${remember().description}`
]

describe('le vocabulaire de `remember` arrive avec son sens, outils directs servis ou non', () => {
  it('nomme les quatre valeurs légales, sans l’aide de la signature du catalogue', () => {
    for (const prompt of recus()) {
      for (const type of REMEMBER_TYPES) {
        expect(prompt).toContain('`' + type + '` — ')
      }
    }
  })

  it('ne souffle plus « contrainte » comme s’il s’agissait d’un type', () => {
    // Le mot reste légitime pour DÉCRIRE un fait (« une contrainte, un invariant, un chiffre
    // mesuré »), mais plus comme item d'une liste de catégories : il s'y lisait comme une valeur.
    for (const prompt of recus()) expect(prompt).not.toContain("une contrainte d'un système")
  })

  it('rattache chaque type à ce qu’il couvre, plutôt que de les lister à sec', () => {
    for (const prompt of recus()) {
      expect(prompt).toContain('`lesson` — une leçon réutilisable')
      expect(prompt).toContain('`decision` — un choix technique tranché')
      expect(prompt).toContain('`preference` — un goût ou une règle de l’utilisateur')
      expect(prompt).toContain('`domain` — un fait du système')
    }
  })
})

/**
 * LA PORTÉE ÉTAIT LE SEUL CHAMP OBLIGATOIRE QUE LA PROSE NE NOMMAIT PAS.
 *
 * Mesuré le 2026-09-02 : `remember` refusé « portée manquante », rien d'écrit, et le
 * modèle avait déjà annoncé le dépôt. `signatureDeCommande` n'expose que les ÉNUMÉRATIONS ; `scope`
 * n'a pas de liste fermée, donc il n'apparaissait que comme nom nu, sans dire ce qu'on en attend.
 */
describe('la prose du bloc MÉMOIRE nomme la portée', () => {
  it('dit que la portée est remplie par défaut, et à quoi sert `global`', () => {
    // Sans outils directs, la liste texte ne montre que le NOM de l'argument : la consigne le dit.
    const texte = buildChatPilotagePrompt(CATALOG)
    expect(texte).toContain('`scope`')
    expect(texte).toContain('le projet courant')
    expect(texte).toContain('`global`')
    // Avec outils directs, c'est l'argument lui-même qui le dit.
    expect(remember().args.scope).toMatch(/« global »[\s\S]*le projet courant/u)
  })
})
