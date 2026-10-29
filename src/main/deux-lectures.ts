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
 * SEULEMENT À QUASI-ÉGALITÉ (conv-1123, 2026-10-23). La première version posait la question dès que
 * le petit modèle voyait DEUX lectures, même quand l'une dominait : « choix de période » sur la
 * rivière de la Carte du projet (zoom ou filtre) a bloqué le tour alors que le zoom allait de soi.
 * L'utilisateur : « que en cas d'extrême ambiguïté (score de proba quasi égal) ». Chaque lecture
 * porte donc sa probabilité, et la question n'est posée que si les deux sont à
 * `ECART_MAX_POUR_DEMANDER` points ou moins ; sinon le travail part sur la lecture dominante,
 * ANNONCÉE en une ligne dans le fil (laquelle part, laquelle est écartée) et transmise au run ou au
 * modèle, pour que l'utilisateur corrige après coup sans être bloqué avant.
 *
 * À CHAQUE MESSAGE (conv-1240, 2026-10-28). L'utilisateur, en voyant la ligne de temps en temps :
 * « met le tout le temps ». Le petit modèle rend donc TOUJOURS sa lecture, même sans ambiguïté
 * (`{ kind: 'retenue' }` sans lecture écartée), et la ligne s'affiche à chaque message écrit par un
 * humain. La QUESTION, elle, ne change pas : seulement à quasi-égalité, et seulement aux trois points
 * de passage d'avant (`agent-pilot.ts`).
 *
 * Ce module ne parle à AUCUN modèle : il fabrique la consigne d'un petit modèle, VALIDE sa réponse
 * et construit la question. L'appel lui-même est injecté (`index.ts`), comme le rangement du premier
 * message. Toute réponse inexploitable rend `undefined` : le travail part comme avant. Une question
 * inutile coûte un tour à l'utilisateur ; un contrôle en panne ne doit jamais bloquer un run.
 */
import type { ReponseAsk } from './ask-options'
import { DEBUT_LECTURE_RETENUE } from '../shared/lecture-retenue'

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
  "Tu relis UNE demande adressée à un agent de développement, juste AVANT qu'il ne la traite. Ton",
  "rôle : montrer à l'utilisateur, en une phrase, ce que l'agent va comprendre, pour éviter qu'il",
  'réponde « t’as mal compris » après coup.',
  'Le dernier message de l’agent, s’il t’est donné, est le contexte : une demande courte ou une',
  'relance (« go », « ok », « met le ») porte sur ce dont il parlait, souvent sa dernière proposition.',
  'Question : deux personnes compétentes, qui connaissent les commandes citées, pourraient-elles',
  'comprendre cette demande de deux façons qui mènent à des travaux ou des réponses DIFFÉRENTS, au',
  "point que l'un des deux résultats serait jeté ?",
  'Regarde en priorité :',
  "- l'ÉCART entre ce que fait la commande citée (sa description t'est donnée) et l'objet que la",
  '  demande veut obtenir : la commande, faite comme d’habitude, livrerait-elle autre chose ?',
  '- un mot qui, dans ce contexte, peut désigner deux objets différents ;',
  '- un CONSTAT sans consigne, qui peut se régler de deux façons opposées (retirer l’élément qui',
  '  gêne, ou l’ajuster en le gardant).',
  'Ne compte PAS : un détail d’exécution que l’agent tranche seul (comment coder, quel fichier), ni',
  'une règle établie (un test rouge se corrige dans le code, jamais en desserrant le test).',
  'Réponds UNIQUEMENT par une ligne JSON, sans texte autour :',
  '{"lectures":[{"texte":"<ce que la demande veut obtenir>","proba":100}]} si une seule lecture est',
  'plausible ;',
  'sinon {"lectures":[{"texte":"<la lecture la plus probable>","proba":<entier>},',
  '{"texte":"<l\'autre lecture>","proba":<entier>}]}.',
  '« proba » : la probabilité, en pourcentage, que l’utilisateur veuille dire CETTE lecture ; les',
  'deux font 100. Estime-la honnêtement d’après les mots de la demande et le contexte, sans la',
  'ramener vers 50 par prudence.',
  'Chaque texte : UNE phrase de 160 caractères au plus, qui REPREND LES MOTS de la demande et dit',
  'concrètement ce qu’elle veut obtenir, en précisant le sens du passage ambigu s’il y en a un.',
  'Aucun jargon, aucun nom de fichier que la demande ne cite pas.'
].join('\n')

/**
 * Écart maximal, en points de probabilité, entre les deux lectures pour poser la question
 * (55/45 au plus). Au-delà, une lecture domine : la question couperait le tour de l'utilisateur pour
 * un choix que l'agent tranche seul (conv-1123).
 */
export const ECART_MAX_POUR_DEMANDER = 10

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
 * L'extrait du dernier message de l'agent : son DÉBUT et sa FIN. Depuis que chaque message est lu
 * (conv-1240), une relance (« go », « met le ») porte le plus souvent sur la FIN de ce message — sa
 * proposition, sa recommandation — que le seul début coupait.
 */
export function extraitDuContexte(contexte: string): string {
  if (contexte.length <= PLAFOND_CONTEXTE) return contexte
  const moitie = PLAFOND_CONTEXTE / 2
  return `${contexte.slice(0, moitie).trimEnd()} […] ${contexte.slice(-moitie).trimStart()}`
}

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
      ? `Dernier message de l'agent (extrait, pour le contexte) :\n${extraitDuContexte(contexte)}\n`
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

/** Une lecture lue dans la réponse : son texte et sa probabilité brute (normalisée ensuite). */
function lireUneLecture(brut: unknown): { texte: string; proba: number } | undefined {
  if (!brut || typeof brut !== 'object') return undefined
  const { texte, proba } = brut as { texte?: unknown; proba?: unknown }
  if (typeof texte !== 'string' || !texte.trim()) return undefined
  if (typeof proba !== 'number' || !Number.isFinite(proba) || proba < 0) return undefined
  return { texte: texte.trim(), proba }
}

/**
 * Ce que le contrôle décide : POSER la question (quasi-égalité), ou partir sur la lecture RETENUE
 * en l'annonçant (conv-1123 : « que je puisse corriger après coup sans être bloqué avant »).
 * `ecartee` absente : la demande n'avait qu'une lecture, annoncée quand même (conv-1240).
 */
export type IssueDesLectures =
  | { kind: 'question'; lectures: [string, string] }
  | { kind: 'retenue'; retenue: string; ecartee?: string }

/**
 * La lecture à ANNONCER, quelle que soit l'issue : là où la question n'est pas posée (un tour sans
 * travail payant ni changement d'affichage), la plus probable des deux est annoncée, l'autre nommée.
 */
export function lectureAAnnoncer(
  issue: IssueDesLectures
): Extract<IssueDesLectures, { kind: 'retenue' }> {
  return issue.kind === 'retenue'
    ? issue
    : { kind: 'retenue', retenue: issue.lectures[0], ecartee: issue.lectures[1] }
}

/**
 * La décision tirée de la réponse du petit modèle, ou `undefined`.
 *
 * `undefined` dans TOUS les cas douteux — JSON illisible, aucune lecture, une lecture SANS
 * probabilité, deux lectures identiques, une lecture trop longue. Le travail part alors comme avant,
 * sans annonce : ce contrôle ne doit jamais devenir un mur.
 * UNE lecture valide : `retenue` sans lecture écartée (conv-1240). Deux lectures valides : `question`
 * si leur écart est de `ECART_MAX_POUR_DEMANDER` points ou moins ET qu'elles reprennent ses mots,
 * sinon `retenue` — la plus probable part, l'autre est nommée pour pouvoir corriger (conv-1123).
 */
export function lireLesLectures(reponse: unknown, demande: string): IssueDesLectures | undefined {
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
  if (Array.isArray(lectures) && lectures.length === 1) {
    const seule = lireUneLecture(lectures[0])
    if (!seule || seule.texte.length > PLAFOND_LECTURE) return undefined
    return { kind: 'retenue', retenue: seule.texte }
  }
  if (!Array.isArray(lectures) || lectures.length !== 2) return undefined
  const lues = lectures.map(lireUneLecture)
  if (!lues[0] || !lues[1]) return undefined
  // Normalisée : un modèle qui répond 0,55/0,45 ou 60/30 reste comparable à 55/45.
  const total = lues[0].proba + lues[1].proba
  if (total <= 0) return undefined
  const [premiere, seconde] = [lues[0], lues[1]].sort((x, y) => y.proba - x.proba)
  const [a, b] = [premiere.texte, seconde.texte]
  if (a.length > PLAFOND_LECTURE || b.length > PLAFOND_LECTURE) return undefined
  const cle = (texte: string): string =>
    sansAccent(texte).toLowerCase().replace(/\W+/gu, ' ').trim()
  if (cle(a) === cle(b)) return undefined
  const ecart = ((premiere.proba - seconde.proba) / total) * 100
  // Les BOUTONS doivent être dans ses mots (conv-1123) ; la ligne, non (conv-1240) : sur le vrai
  // modèle, « met le tout le temps » lu « à chaque demande » perdait sa ligne faute du mot « temps ».
  const dansSesMots = reprendSesMots(a, demande) && reprendSesMots(b, demande)
  return ecart <= ECART_MAX_POUR_DEMANDER && dansSesMots
    ? { kind: 'question', lectures: [a, b] }
    : { kind: 'retenue', retenue: a, ecartee: b }
}

/**
 * Les deux lectures à soumettre à l'utilisateur, la plus probable d'abord — seulement à
 * quasi-égalité ; `undefined` sinon (lecture dominante ou réponse douteuse).
 */
export function lireDeuxLectures(reponse: unknown, demande: string): [string, string] | undefined {
  const issue = lireLesLectures(reponse, demande)
  return issue?.kind === 'question' ? issue.lectures : undefined
}

/**
 * La ligne affichée dans le fil quand une lecture domine : laquelle part, et laquelle est écartée,
 * pour que l'utilisateur corrige d'un mot au lieu d'être arrêté avant (conv-1123).
 */
export function annonceDeLaLectureRetenue(retenue: string, ecartee?: string): string {
  return ecartee
    ? `${DEBUT_LECTURE_RETENUE}« ${retenue} » — si tu voulais plutôt « ${ecartee} », dis-le.`
    : `${DEBUT_LECTURE_RETENUE}« ${retenue} »`
}

/**
 * La même lecture, ajoutée à la tâche d'un run : sans elle, le run relirait la demande à sa façon
 * et pourrait faire autre chose que ce que la ligne affichée vient d'annoncer.
 */
export function tacheAvecLectureRetenue(tache: string, retenue: string, ecartee?: string): string {
  const precision = ecartee
    ? `Lecture retenue de la demande, annoncée à l'utilisateur : « ${retenue} » (l'autre lecture, « ${ecartee} », est écartée).`
    : `Lecture retenue de la demande, annoncée à l'utilisateur : « ${retenue} ».`
  return tache.includes(precision) ? tache : `${tache.trimEnd()}\n\n${precision}`
}

/**
 * La même lecture, remise au modèle du chat quand il fait le travail lui-même (changement
 * d'affichage). « SYSTÈME: » la fait encadrer comme une relance d'Autowin, jamais comme des mots de
 * l'utilisateur (`baliserRelanceAutomatique`).
 */
export function consigneDeLectureRetenue(retenue: string, ecartee?: string): string {
  if (!ecartee)
    return [
      'SYSTÈME: la demande ci-dessus a été relue avant toi, et une seule lecture en est plausible.',
      `L'utilisateur a déjà vu la ligne : ${annonceDeLaLectureRetenue(retenue)}`,
      'Ne la réannonce pas. Si tu comprends sa demande autrement, dis-le en une phrase en tête de ta réponse.'
    ].join('\n')
  return [
    'SYSTÈME: la demande ci-dessus pouvait se lire de deux façons ; la plus probable a été retenue.',
    `L'utilisateur a déjà vu la ligne : ${annonceDeLaLectureRetenue(retenue, ecartee)}`,
    `Fais le travail selon cette lecture : « ${retenue} ». Ne la réannonce pas et ne pose pas la question.`
  ].join('\n')
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
 * La demande mérite-t-elle une QUESTION en cas de doute ? Filtre déterministe : écarte un message
 * vide, d'un à trois mots, ou une relance (« ok », « go »). Depuis conv-1240, ces messages sont
 * quand même LUS pour la ligne affichée ; seule la question leur reste épargnée.
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
