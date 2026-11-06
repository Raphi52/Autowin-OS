import { describe, expect, it } from 'vitest'
import { CONSTITUTION } from './constitution'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'

/**
 * LE PLAN QUI CHANGE, RACONTÉ EN MÉCANIQUE — mesuré le 2026-09-02.
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
 * pas ce qui a été demandé.
 *
 * Le paragraphe « CHANGEMENT DE PLAN » du profil redisait Autonomie (5) de la CONSTITUTION (« la
 * tâche énoncée ne se remplace pas ; si elle est infaisable ou déjà faite, dis-le ») : sa part
 * propre — comment le dire — vit maintenant dans (5), injectée avec ce profil au chat et aux
 * étapes de run (les deux appels du juge reçoivent le profil sans elle, mais n'exécutent aucune
 * demande). Entrée qui DOIT faire rougir : cette phrase retirée de (5), ou recopiée au profil.
 */
describe('constitution — un plan qui change se raconte en situation', () => {
  const autonomie5 = CONSTITUTION.slice(
    CONSTITUTION.indexOf('(5) La tâche énoncée ne se remplace pas'),
    CONSTITUTION.indexOf('Cela ne relâche aucune preuve')
  )

  it('déclenche au moment où l’agent n’exécute pas ce qui a été demandé', () => {
    expect(autonomie5).toMatch(/infaisable, déjà faite ou mal posée/u)
    expect(autonomie5).toMatch(/Tout écart se dit dès ta première phrase/u)
  })

  it('impose les trois éléments de la première phrase', () => {
    expect(autonomie5).toMatch(
      /ce qui était demandé, ce que tu as trouvé, ce que tu as fait à la place/u
    )
  })

  it('bannit explicitement les noms d’étapes internes, pas seulement le jargon technique', () => {
    expect(autonomie5).toMatch(/sans nom d'étape interne/u)
  })

  it('garde la règle de langage simple intacte, sans y recopier la règle', () => {
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/PARLE COMME À UN COLLÈGUE/u)
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).not.toMatch(/CHANGEMENT DE PLAN/u)
  })
})
