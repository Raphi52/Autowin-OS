/**
 * DEUX LECTURES PLAUSIBLES → UNE QUESTION, AVANT DE PAYER (conv-1092, 2026-10-22).
 *
 * Mesure sur 911 conversations : l'agent pose 382 questions, presque toutes APRES le travail
 * (maquette à garder, suite, publication). Il ne demande presque jamais ce que l'utilisateur VEUT
 * DIRE. Une quinzaine de recadrages « t'as mal compris » viennent d'une lecture fausse qu'une seule
 * question aurait évitée, et les plus chers partent d'un run payé : conv-767 puis conv-768, deux
 * `/scout` (2,47 $ et 1,36 $) sur la même mauvaise lecture de « une task pratique pour /arena ».
 *
 * La cause n'est pas un oubli du modèle. Pour conv-767, aucun modèle n'a lu la demande :
 * `/scout …` est routé par le code DIRECTEMENT vers l'orchestration (`agent-pilot.ts`, route
 * `explicit-skill`). Et quand le modèle orchestre lui-même, toute sa consigne lui dit de déduire
 * (constitution, Autonomie 3 ; `phase-briefs.ts`, « Ne termine JAMAIS un tour sur une question
 * dérivable »). Une phrase de plus n'y changerait rien : le contrôle doit vivre dans le code, au
 * point de passage.
 *
 * Ce module ne parle à AUCUN modèle : il fabrique la consigne d'un petit modèle, VALIDE sa réponse
 * et construit la question. L'appel lui-même est injecté (`index.ts`), comme le rangement du premier
 * message. Toute réponse inexploitable rend `undefined` : le travail part comme avant. Une question
 * inutile coûte un tour à l'utilisateur ; un contrôle en panne ne doit jamais bloquer un run.
 */
import type { ReponseAsk } from './ask-options'

/**
 * La consigne du petit modèle. Stable d'un appel à l'autre (cache).
 *
 * Première version rejouée sur le VRAI modèle le 2026-10-22 : « une seule lecture » pour conv-767,
 * conv-768 et conv-542 — les trois cas visés —, et une fausse alerte sur une demande nette. Elle
 * demandait « la demande est-elle ambiguë ? » ; lue seule, une phrase paraît toujours claire. Ce qui
 * manquait : ce que fait la COMMANDE citée (`/scout` cherche des améliorations dans du code, pas un
 * exercice pour `/arena`), et la question qui compte — le résultat livré risque-t-il d'être jeté.
 */
export const CONSIGNE_DEUX_LECTURES = [
  "Tu relis UNE demande adressée à un agent de développement, juste AVANT qu'il ne lance un travail",
  "payant ou ne modifie ce qui s'affiche. Ton rôle : éviter que l'utilisateur réponde « t'as mal",
  'compris » après coup.',
  'Question : deux personnes compétentes, qui connaissent les commandes citées, pourraient-elles',
  "comprendre cette demande de deux façons qui mènent à des travaux DIFFÉRENTS, au point que l'un",
  'des deux résultats serait jeté ?',
  'Regarde en priorité :',
  "- l'ÉCART entre ce que fait la commande citée (sa description t'est donnée) et l'objet que la",
  '  demande veut obtenir : la commande, faite comme d’habitude, livrerait-elle autre chose ?',
  '- un mot qui, dans ce contexte, peut désigner deux objets différents ;',
  '- un CONSTAT sans consigne, qui peut se régler de deux façons opposées (retirer l’élément qui',
  '  gêne, ou l’ajuster en le gardant).',
  'Ne compte PAS : un détail d’exécution que l’agent tranche seul (comment coder, quel fichier), ni',
  'une règle établie (un test rouge se corrige dans le code, jamais en desserrant le test).',
  'Réponds UNIQUEMENT par une ligne JSON, sans texte autour :',
  '{"lectures":[]} si une lecture domine nettement ;',
  'sinon {"lectures":["<la lecture la plus probable>","<l\'autre lecture>"]}.',
  'Chaque lecture : UNE phrase de 160 caractères au plus, qui REPREND LES MOTS de la demande et',
  'précise seulement le sens du passage ambigu. Aucun jargon, aucun nom de fichier que la demande',
  'ne cite pas.'
].join('\n')

/** Les commandes `/nom` citées dans la demande, dans l'ordre, sans doublon. */
export function commandesCitees(demande: string): string[] {
  const noms: string[] = []
  for (const trouve of demande.matchAll(/(?:^|\s)\/([a-z][\w-]{1,63})(?=[\s.,;:!?)]|$)/giu)) {
    const nom = trouve[1].toLowerCase()
    if (!noms.includes(nom)) noms.push(nom)
  }
  return noms
}

/** Plafond d'une description de commande remise au petit modèle. */
const PLAFOND_DESCRIPTION = 400

/** Plafond d'une lecture : c'est le libellé du bouton (`ask-options.ts`, PLAFOND_LIBELLE). */
const PLAFOND_LECTURE = 200
/** Extrait du dernier message de l'agent remis comme contexte : assez pour « nan, pas ça ». */
const PLAFOND_CONTEXTE = 800

/**
 * La charge envoyée au petit modèle : ce que font les commandes citées, l'extrait de contexte s'il
 * existe, puis la demande.
 */
export function chargeDeuxLectures(
  demande: string,
  dernierMessageAgent?: string,
  descriptionsDesCommandes: Readonly<Record<string, string>> = {}
): string {
  const contexte = (dernierMessageAgent ?? '').replace(/\s+/gu, ' ').trim()
  const commandes = commandesCitees(demande)
    .filter((nom) => descriptionsDesCommandes[nom])
    .map(
      (nom) =>
        `- /${nom} : ${descriptionsDesCommandes[nom].replace(/\s+/gu, ' ').trim().slice(0, PLAFOND_DESCRIPTION)}`
    )
  return [
    commandes.length ? `Ce que font les commandes citées :\n${commandes.join('\n')}\n` : '',
    contexte
      ? `Dernier message de l'agent (extrait, pour le contexte) :\n${contexte.slice(0, PLAFOND_CONTEXTE)}\n`
      : '',
    `Demande de l'utilisateur :\n${demande.trim()}`
  ]
    .filter(Boolean)
    .join('\n')
}

function sansAccent(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/gu, '')
}

/** Mots-outils écartés : ils ne disent rien de ce que l'utilisateur a voulu nommer. */
const MOTS_OUTILS = new Set(
  (
    'avec dans pour mais plus tout tous toute toutes cette celui celle ceux etre avoir fait faire ' +
    'sont nous vous elle elles leur leurs quand comme alors donc aussi bien tres quel quelle quels ' +
    'quelles juste encore moins sans sous entre vers chez depuis pendant avant apres parce faut ' +
    'veux voudrais peux peut dois doit stp merci ceci cela voila oui non'
  ).split(' ')
)

/** Les mots qui PORTENT la demande : 4 lettres ou plus, sans accent, hors mots-outils. */
export function motsPorteurs(texte: string): Set<string> {
  const mots = sansAccent(texte)
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((mot) => mot.length >= 4 && !MOTS_OUTILS.has(mot))
  return new Set(mots)
}

/**
 * La lecture reprend-elle les MOTS de l'utilisateur ? Exigence de l'utilisateur : « les deux
 * lectures dans mes mots ». Une reformulation savante l'oblige à décoder ce qu'on lui propose ; on
 * exige donc au moins trois mots porteurs de sa demande (tous, si elle en compte moins).
 */
export function reprendSesMots(lecture: string, demande: string): boolean {
  const siens = motsPorteurs(demande)
  if (!siens.size) return false
  const requis = Math.min(3, siens.size)
  let repris = 0
  for (const mot of motsPorteurs(lecture)) if (siens.has(mot)) repris += 1
  return repris >= requis
}

/**
 * Les deux lectures rendues par le petit modèle, ou `undefined`.
 *
 * `undefined` dans TOUS les cas douteux — JSON illisible, une seule lecture, deux lectures
 * identiques, une lecture trop longue ou qui ne reprend pas ses mots. Le travail part alors comme
 * avant : ce contrôle ne doit jamais devenir un mur.
 */
export function lireDeuxLectures(reponse: unknown, demande: string): [string, string] | undefined {
  if (typeof reponse !== 'string') return undefined
  const json = reponse.match(/\{[\s\S]*\}/u)?.[0]
  if (!json) return undefined
  let brut: unknown
  try {
    brut = JSON.parse(json)
  } catch {
    return undefined
  }
  const lectures = (brut as { lectures?: unknown })?.lectures
  if (!Array.isArray(lectures) || lectures.length !== 2) return undefined
  const [a, b] = lectures.map((lecture) => (typeof lecture === 'string' ? lecture.trim() : ''))
  if (!a || !b || a.length > PLAFOND_LECTURE || b.length > PLAFOND_LECTURE) return undefined
  const cle = (texte: string): string =>
    sansAccent(texte).toLowerCase().replace(/\W+/gu, ' ').trim()
  if (cle(a) === cle(b)) return undefined
  if (!reprendSesMots(a, demande) || !reprendSesMots(b, demande)) return undefined
  return [a, b]
}

/**
 * Le préfixe à garder devant chaque lecture envoyée : la commande de phase (`/scout`).
 *
 * Le texte cliqué DEVIENT le message de l'utilisateur. Sans le préfixe, « /scout <lecture> » perdait
 * sa phase et repartait au modèle au lieu du run demandé.
 */
export function prefixeDeCommande(demande: string): string {
  return /^\/[\w-]+(?=\s|$)/u.exec(demande.trim())?.[0] ?? ''
}

/**
 * Le texte du tour qui pose la question. Il sert AUSSI de marque : le tour suivant le retrouve dans
 * l'historique et ne repose pas la question (`suitUneQuestionDesLectures`), même après un
 * redémarrage de l'app, et même si l'utilisateur a tapé sa propre réponse au lieu de cliquer.
 */
export const AVIS_DEUX_LECTURES =
  'Ta demande peut se lire de deux façons, qui ne mènent pas au même travail : je n’ai rien lancé ni modifié tant que tu n’as pas choisi.'

/** La question à poser : deux réponses, la plus probable recommandée, chacune renvoyant SA lecture. */
export function questionDesDeuxLectures(
  lectures: [string, string],
  demande: string
): { question: string; options: ReponseAsk[] } {
  const prefixe = prefixeDeCommande(demande)
  const envoi = (lecture: string): string => (prefixe ? `${prefixe} ${lecture}` : lecture)
  return {
    question: 'Laquelle des deux lectures veux-tu ?',
    options: [
      { libelle: lectures[0], recommande: true, envoi: envoi(lectures[0]) },
      { libelle: lectures[1], envoi: envoi(lectures[1]) }
    ]
  }
}

/**
 * Le message de l'utilisateur répond-il à une question des deux lectures ? UNE question par
 * demande : la réponse — cliquée ou tapée — n'est jamais réinterrogée.
 */
export function suitUneQuestionDesLectures(
  historique: ReadonlyArray<{ role: string; content?: unknown }>
): boolean {
  for (let i = historique.length - 1; i >= 0; i--) {
    const message = historique[i]
    if (message.role === 'user') continue
    if (message.role !== 'assistant') return false
    return typeof message.content === 'string' && message.content.includes(AVIS_DEUX_LECTURES)
  }
  return false
}

/** Le dernier message de l'agent avant la demande : le contexte d'un « nan, pas ça ». */
export function dernierMessageAgent(
  historique: ReadonlyArray<{ role: string; content?: unknown }>
): string | undefined {
  for (let i = historique.length - 1; i >= 0; i--) {
    const message = historique[i]
    if (message.role === 'assistant' && typeof message.content === 'string') return message.content
  }
  return undefined
}

/** Les messages qui ne portent pas de demande neuve : une relance reprend la précédente. */
const RELANCE =
  /^\s*(ok|okay|go|vas-?y|continue|oui|yes|valide|parfait|d'accord|dac|top|merci)\b[\s.!]*$/iu

/**
 * La demande mérite-t-elle d'être lue deux fois ? Filtre déterministe AVANT tout appel de modèle :
 * écarte un message vide, d'un à trois mots, ou une relance (« ok », « go »).
 */
export function meriteUneLecture(demande: string | undefined): boolean {
  const texte = (demande ?? '').trim()
  if (!texte || RELANCE.test(texte)) return false
  return texte.split(/\s+/u).length >= 4
}

/**
 * La demande vise-t-elle à CHANGER ce qui s'affiche ? Filtre du chemin SANS orchestration.
 *
 * On ne voit pas, depuis le code, les éditions que le modèle fera avec ses outils natifs : on lit
 * donc la demande AVANT de lui passer la main. Le filtre est volontairement large — un faux positif
 * coûte un petit appel qui répond « une seule lecture », un faux négatif garde le comportement
 * d'avant. Une QUESTION (« comment… », « pourquoi… », « … ? ») n'est pas une demande de changement.
 */
const CIBLE_DE_RENDU =
  /(?<![\p{L}\p{N}_])(?:bouton|boutons|barre|barres|menu|menus|onglet|onglets|tab|tabs|widget|widgets|panneau|panel|graph|graphe|th[eè]me|couleur|couleurs|ic[oô]ne|[eé]cran|vue|page|fen[eê]tre|popup|pop-up|modale?|carte|card|bloc|affichage|style|css|design|maquette|apparence|fond|police|texte|libell[eé]s?|termes|titre|scroll|ligne|colonne|tuile|accueil|layout|disposition)(?![\p{L}\p{N}_])/iu
const QUESTION =
  /^\s*(?:comment|pourquoi|pk|est-ce que|c'est quoi|quel(?:le)?s?|o[uù]|combien|qui|quoi)\b/iu

export function demandeDeChangementDeRendu(demande: string | undefined): boolean {
  const texte = (demande ?? '').trim()
  if (!texte || !CIBLE_DE_RENDU.test(texte)) return false
  if (QUESTION.test(texte) || /\?\s*$/u.test(texte)) return false
  return true
}
