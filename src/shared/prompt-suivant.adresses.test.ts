import { describe, expect, it } from 'vitest'
import { estPromptDePublication, extrairePropositionsSuite, PROMPT_SALVAGE } from './prompt-suivant'

/*
 * VÉCU LE 2026-10-22 (conv-1091 → conv-1093). Le tour finit sur deux suites notées : [75] la
 * correction recommandée, [55] un /salvage différé. Le champ de saisie ne montre QUE la [55].
 * L'utilisateur : « j'ai même pas le truc recommandé comme choix alors que c'est mieux ».
 *
 * Cause : la [75] portait le mot « publication » dans le NOM DE FICHIER `chat-turn-publication.ts`
 * et « publié » dans un APARTÉ entre parenthèses. Le détecteur cherchait un mot de publication
 * n'importe où : la suite passait pour une publication, et la demande du tour (« supprime les 15
 * branches ») n'en parlant pas, elle était SUPPRIMÉE comme publication jamais demandée.
 *
 * Mesuré sur les 3 664 suites réelles des fils : 18 suites étaient classées publication à tort de la
 * même façon (nom de branche, nom de hook `pre-push`, « (commit 6a690851) »), aucune vraie
 * publication ne l'était par ce seul biais.
 */
const RECOMMANDEE =
  "Corrige src/main/chat-turn-publication.ts pour que verifierAvantPublication rejoue les tests dans la même copie propre que typerAvantPublication, avec un test qui reproduit d'abord le cas 973b70e2 (test de style publié sans le CSS qu'il lit) ; vérifie avant que conv-1086 ne travaille pas déjà dessus."
const DIFFEREE =
  'Lance /salvage all origin main quand conv-1070, conv-1075 et conv-1090 auront fini leur tour, pour publier leurs 3 commits restés sur main local.'

describe('une adresse ou un aparté ne fait pas passer une suite pour une publication', () => {
  it('la suite recommandée de conv-1091 reste proposée, en tête', () => {
    const cloture = `bilan\n\nAUTOWIN_PROMPT_V1: [75] ${RECOMMANDEE}\nAUTOWIN_PROMPT_V1: [55] ${DIFFEREE}`
    const demande = 'Oui, supprime les 15 branches et les 12 copies (SHA notés)'
    expect(extrairePropositionsSuite(cloture, demande)[0]).toEqual({
      texte: RECOMMANDEE,
      score: 75
    })
  })

  it.each([
    'Corrige le message du hook pre-push et garde les tickets.',
    'Vérifie src/main/chat-turn-publication.ts ligne 476.',
    'Supprime la branche public/version-github.',
    'Lance un banc /arena à 2 bras — A avec la skill allégée (commit 6a690851).',
    'Rends le champ reason obligatoire sur toute issue non-merged.'
  ])('« %s » n’est pas une publication', (prompt) => {
    expect(estPromptDePublication(prompt)).toBe(false)
  })

  it('un vrai acte de publication reste attrapé, y compris à côté d’une adresse', () => {
    for (const prompt of [
      'Publie-le sur main.',
      'Commit et push src/main/chat-turn-publication.ts sur main.',
      'Ouvre la PR de salvage/reprise-conv-629 vers main.',
      'Dans conv-987, commite et pousse ta cascade (app-shell.css restés non commités).',
      'Fais le push.'
    ]) {
      expect(estPromptDePublication(prompt), prompt).toBe(true)
    }
    expect(
      extrairePropositionsSuite('AUTOWIN_PROMPT_V1: [80] Commit et push le correctif.', 'publie')
    ).toEqual([{ texte: PROMPT_SALVAGE, score: 80 }])
  })
})

/*
 * VÉCU LE 2026-10-22, tour suivant de conv-1093 : la correction ci-dessus livrée, la suite [62] du
 * même tour disparaît à son tour. Elle finissait par « aucune vraie publication ne doit être
 * perdue » — une INTERDICTION, lue comme une demande de publier. Même famille, mesurée sur les
 * 3 671 suites réelles : « le commit bf2aa822 », « modifications non commitées », « sans commit »
 * NOMMENT une chose ou l'excluent, ils ne demandent pas de publier (86 suites classées à tort).
 *
 * Le nom ne cesse de compter que derrière un contexte qui le DÉSIGNE (préposition, subordonnée,
 * verbe de lecture ou de correction) : derrière un verbe inconnu — « Repousse ce commit »,
 * « Complète la PR 916 » —, il reste un acte. Prudence voulue : le garde-fou empêche de publier
 * sans tri, un nom mal lu en sa faveur coûte moins qu'une publication manquée.
 */
describe('une interdiction ou un objet désigné ne fait pas passer une suite pour une publication', () => {
  const SUITE_62 =
    "Dans src/shared/prompt-suivant.ts, fais que estPromptDePublication juge l'ACTE de la suite et non un nom qui désigne un objet existant (« le commit bf2aa822 », « modifications non commitées », « Corrige la publication automatique… ») : mesure avant/après sur les suites réelles des fils, aucune vraie publication ne doit être perdue."

  it('la suite [62] de conv-1093 reste proposée', () => {
    const demande = 'j’ai même pas le truc recommandé comme choix alors que c’est mieux'
    expect(
      extrairePropositionsSuite(`bilan\n\nAUTOWIN_PROMPT_V1: [62] ${SUITE_62}`, demande)
    ).toEqual([{ texte: SUITE_62, score: 62 }])
  })

  it.each([
    'Corrige les 2 erreurs de typage laissées par le commit bf2aa822 dans run-pilot-chat.ts.',
    'Montre-moi ce que fait le commit 73519bd6 dans agent-pilot.ts, ligne par ligne.',
    'Dis-moi ce que contiennent les modifications non commitées de src/main/index.ts.',
    'Relance la correction avec des tests et un typecheck, sans commit.',
    'Lance le judge sur le commit d4415f35 de la branche de nettoyage.',
    "Corrige la publication automatique de fin de tour pour qu'elle refuse de commiter un fichier incomplet.",
    'Supprime les 7 copies de travail dont le contenu est déjà publié.',
    'Ne publie rien et relis le diff.'
  ])('« %s » n’est pas une publication', (prompt) => {
    expect(estPromptDePublication(prompt)).toBe(false)
  })

  it.each([
    'Repousse ce commit directement sur main.',
    'Complète la PR 916 dans main.',
    'Envoie aussi le commit 1d396d42 sur le dépôt distant.',
    'Valide le changement de police dans son propre commit.',
    'Enregistre ces 4 fichiers dans un commit dédié.',
    'Réaligne le miroir GitHub sur main par un push forcé.',
    'Fais le commit.',
    'Procède au merge de la branche.',
    'Ce travail est publié, enchaîne dessus.'
  ])('« %s » reste une publication', (prompt) => {
    expect(estPromptDePublication(prompt)).toBe(true)
  })
})

/*
 * VÉCU LE 2026-10-22, conv-1093, troisième tour : trois suites réelles des fils envoyaient du
 * travail vers la branche principale SANS aucun mot de publication — « intègre-la dans main »,
 * « envoie-la sur Azure », « Fais rejoindre au dépôt principal la copie… ». Elles passaient sans
 * proposer de tri, alors que /salvage existe justement pour ces copies et ces branches.
 *
 * Le verbe ne compte qu'en TÊTE de proposition (début, ponctuation, « et », « puis »), à
 * l'impératif, et devant une cible qui EST la branche principale ou un dépôt distant. Ni « à la
 * main », ni `src/main`, ni « Supprime sur Azure », ni « doit rejoindre la liste ».
 */
describe('envoyer vers la branche principale est une publication, même sans le mot', () => {
  it.each([
    'Vérifie la branche salvage/2026-09-07/publications-serialisees (tests et typecheck) et intègre-la dans main si elle est verte.',
    'Bascule ce travail sur une branche dédiée et envoie-la sur Azure, puis donne-moi le lien.',
    "Fais rejoindre au dépôt principal la copie agent__run-5813eb561b7b-1 sans écraser les modifications non commitées de project-files.ts et preload, puis redémarre l'app",
    "Si les tests passent, intègre l'extension dans la branche principale.",
    'Fais-la rejoindre main.',
    'Envoie la branche de nettoyage vers GitHub.',
    'Intégrez-les dans origin/main.',
    'Envoie le correctif sur le dépôt distant.'
  ])('« %s » est une publication', (prompt) => {
    expect(estPromptDePublication(prompt)).toBe(true)
  })

  it.each([
    'Intègre ces libellés à la main, sans script.',
    'Intègre le composant dans src/main/index.ts.',
    'Intègre le bouton dans main.tsx et vérifie le rendu.',
    'Dis-moi si la branche s’intègre sans conflit dans main.',
    "Ne l'intègre pas dans main, relis-la d'abord.",
    'Supprime sur Azure la branche fix/balayage, son contenu est déjà en base.',
    "Rédige-moi le message à envoyer à l'admin Azure DevOps.",
    'Relance la construction : le dossier ouvert doit rejoindre la liste des affaires.',
    'Corrige le script qui envoie la branche sur GitHub.',
    'Fais refuser les git stash lancés par un agent sur le dépôt principal.'
  ])('« %s » n’est pas une publication', (prompt) => {
    expect(estPromptDePublication(prompt)).toBe(false)
  })

  it('demandée par l’utilisateur, elle devient le tri ; jamais demandée, elle ne se propose pas', () => {
    const cloture =
      'bilan\n\nAUTOWIN_PROMPT_V1: [80] Intègre-la dans main maintenant que les tests sont verts.'
    expect(
      extrairePropositionsSuite(cloture, 'Vérifie la branche de nettoyage et intègre-la dans main')
    ).toEqual([{ texte: PROMPT_SALVAGE, score: 80 }])
    expect(extrairePropositionsSuite(cloture, 'Corrige le test rouge de ChatView')).toEqual([])
  })
})

/*
 * VÉCU LE 2026-10-22, conv-1093, quatrième tour : « Reporte dans le dépôt principal le travail
 * mermaid de run-d48026c47798-1… » rapatrie une copie de travail vers la branche principale, sans
 * aucun mot de publication. Même famille que « intègre-la dans main ».
 *
 * « Reporter » veut aussi dire remettre à plus tard, ou signaler un bug : il ne compte donc que
 * devant la branche principale ou le dépôt principal, jamais devant GitHub ou Azure.
 */
describe('reporter un travail dans le dépôt principal est une publication', () => {
  it.each([
    'Reporte dans le dépôt principal le travail mermaid de run-d48026c47798-1 (plafond 300 px, sonde corrigée, plafond-mermaid.mjs et son test) sans écraser le min-height ajouté depuis, puis rejoue le test.',
    'Reporte le compactage des fils sur main, ou dis-moi ce qui le rend trop coûteux à reprendre.',
    'Si les tests passent, reporte-le dans la branche principale.',
    'Reportez le correctif de run-5813eb561b7b-1 sur origin/main.'
  ])('« %s » est une publication', (prompt) => {
    expect(estPromptDePublication(prompt)).toBe(true)
  })

  it.each([
    'Reporte le correctif du protocole dans le dépôt Hermes-Brain et aligne son tooling sur la version installée.',
    'Reporte le délai doux de 15 s pour la fermeture d’un bureau sans fiche dans fermerBureauGere, avec son test.',
    'Garde la vue Antenne / Piloter et reporte-y depuis 45780edd « Parcourir… », « Récents / Relancer » et le fil cliquable par son titre (ça rend le typage vert), vérifie, puis pousse la correction sur origin/main.',
    'Reporte le bug sur GitHub avec la capture.',
    'Reporte la revue à demain matin.',
    'Dis-moi si on reporte ce travail dans main.',
    'Reporte le correctif dans src/main/index.ts.'
  ])('« %s » n’est pas une publication', (prompt) => {
    expect(estPromptDePublication(prompt)).toBe(false)
  })
})
