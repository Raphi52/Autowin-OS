import { describe, expect, it } from 'vitest'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'

/**
 * LE PLAN QUI CHANGE, RACONTÉ EN MÉCANIQUE — mesuré le 2026-09-02, conv-128.
 *
 * L'utilisateur lance `/skill …`. L'agent découvre que la chose demandée existe déjà, abandonne la
 * commande et fait autre chose — c'était le bon choix. Mais il l'annonce ainsi : « J'ai arrêté
 * /skill à l'étape 1 (cadrage du banc) ». « Étape 1 » et « cadrage du banc » sont des noms de sa
 * propre mécanique : ils ne décrivent rien pour la personne devant l'écran.
 *
 * Réponse de l'utilisateur au tour suivant : « je comprend pas résume moi la situation et ce que tu
 * demandes en mode toi parler comme ca ». Un tour entier passé à re-raconter en français ce qui
 * aurait dû être dit du premier coup.
 *
 * La règle de langage simple existante liste des MOTS à bannir (gate, worktree, token) ; elle ne
 * couvre pas les noms d'ÉTAPES du pipeline, ni le moment le plus risqué — celui où l'agent ne fait
 * pas ce qui a été demandé. Entrée qui DOIT faire rougir : ce paragraphe retiré.
 */
describe('response-style — un plan qui change se raconte en situation', () => {
  it('déclenche au moment où l’agent n’exécute pas ce qui a été demandé', () => {
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/CHANGEMENT DE PLAN/u)
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/n'exécutes PAS ce que l'utilisateur a demandé/u)
  })

  it('impose les trois éléments de la première phrase', () => {
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/ce qu'il voulait/u)
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/ce que tu as trouvé/u)
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/ce que tu as fait à la place/u)
  })

  it('bannit explicitement les noms d’étapes internes, pas seulement le jargon technique', () => {
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/étape 1/u)
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/phase frame/u)
  })

  it('garde la règle de langage simple existante intacte', () => {
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/PARLE COMME À UN COLLÈGUE/u)
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/DIRE VRAI PRIME SUR SIMPLIFIER/u)
  })
})
