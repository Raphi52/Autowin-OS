/**
 * MODE AUTO du chat — renvoyer tout seul la suite proposée en fin de tour, jusqu'à ce que l'agent
 * dise qu'il ne reste RIEN à faire.
 *
 * Cadrage utilisateur (2026-09-02) : l'interrupteur vit dans la barre de gauche et reste ACTIF
 * jusqu'à désactivation — pas de plafond de tours, pas de remise à zéro au changement de fil.
 *
 * Chaque tour coûte de l'argent réel. Toute la décision vit donc ICI, pure et testable, plutôt que
 * noyée dans la vue : ce qui décide d'envoyer un tour payant doit pouvoir être lu d'un coup.
 *
 * Les garde-fous qui restent :
 * 1. ARRÊT SUR « RIEN » — la condition demandée. Elle se teste sur la rubrique « 👉 Recommandé »,
 *    JAMAIS sur le texte qui part dans le champ. Les deux diffèrent : le champ reçoit en priorité
 *    la ligne `AUTOWIN_PROMPT_V1`, et un modèle qui écrit « Recommandé — rien » PUIS un prompt
 *    quand même ferait tourner la boucle pour toujours si on testait le mauvais texte.
 * 2. UN TOUR TRAITÉ UNE SEULE FOIS — la décision porte une signature du tour ; le même tour ne peut
 *    pas déclencher deux envois, même si la vue se redessine dix fois.
 * 3. ANTI-BOUCLE — la même suite proposée deux fois d'affilée arrête tout.
 */
import type { Msg, AsstMsg } from './chat-view-types'
import type { ChatPart } from './chat-view-model'
import {
  extrairePromptSuivant,
  estPromptDePublication,
  PROMPT_SALVAGE
} from '../../../shared/prompt-suivant'
import { extractRecommendation } from './markdown-recommandation'

/** Texte brut (avec la ligne technique du prompt) du DERNIER message de l'agent. */
export function texteDernierAssistant(fil: readonly Msg[]): string | null {
  const dernier = [...fil].reverse().find((m) => m.role === 'assistant') as AsstMsg | undefined
  if (!dernier) return null
  return (dernier.parts ?? [])
    .filter((p): p is Extract<ChatPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
}

/** La DERNIERE demande de l'utilisateur — ce a quoi le tour courant repond. */
export function texteDerniereDemande(fil: readonly Msg[]): string | null {
  const dernier = [...fil].reverse().find((m) => m.role === 'user') as
    | Extract<Msg, { role: 'user' }>
    | undefined
  return dernier?.content ?? null
}

/**
 * Signature du tour courant. Deux redessins du MÊME tour la partagent ; un tour de plus la change.
 * Volontairement bâtie sur la longueur du fil et du texte : aucun identifiant n'est garanti présent
 * sur un message encore en cours de réception.
 */
export function signatureTour(fil: readonly Msg[]): string | null {
  const texte = texteDernierAssistant(fil)
  if (texte === null) return null
  return `${fil.length}::${texte.length}`
}

/**
 * « rien » posé SEUL sur sa ligne — MÊME EXIGENCE que pour « Fait » et « Reste à faire ».
 *
 * DÉFAUT VÉCU (« le mode auto se désactive tout seul ») : cette porte était la SEULE des trois à
 * accepter le mot n'importe où dans la phrase. Une recommandation bien réelle — « rien ne bloque,
 * lance le judge », « plus rien à vérifier ici, passe à X » — était lue comme une fin et coupait
 * l'interrupteur alors qu'une suite était proposée. Une suite qui existe n'est pas une fin.
 */
export function recommandationDitRien(recommandation: string | null): boolean {
  if (!recommandation) return false
  return ligneNueDitRien(recommandation.split(SAUT_ANCRAGE))
}

/** Les quatre en-têtes du bloc de clôture : ils bornent la rubrique qu'on veut lire. */
const EN_TETES_CLOTURE =
  /^\s*(?:✅|⚠️?|📍|⏳|👉)\s*\**\s*(Fait|Maintenant|Reste à faire|Recommandé)\b/u

/**
 * Contenu de la rubrique « ✅ Fait » : le reste de sa ligne d'en-tête ET les lignes qui la suivent,
 * jusqu'à la rubrique d'après. Précision utilisateur du 2026-09-02 : « dans le prompt il n'écrit
 * jamais le mot rien, mais il l'écrit souvent dans le bloc Fait ».
 */
function lignesDuBlocFait(texte: string): string[] {
  return lignesDeRubrique(texte, 'Fait')
}

/**
 * Les lignes d'UNE rubrique de clôture. Deux rubriques portent le mot « rien » — « ✅ Fait » et
 * « ⏳ Reste à faire » —, et la seconde est celle qu'Autowin écrit lui-même en fin de chaîne.
 */
function lignesDeRubrique(texte: string, rubrique: 'Fait' | 'Reste à faire'): string[] {
  const lignes = texte.split('\n')
  const sortie: string[] = []
  let dedans = false
  for (const brute of lignes) {
    const entete = brute.match(EN_TETES_CLOTURE)
    if (entete) {
      dedans = entete[1] === rubrique
      if (dedans) {
        const reste = brute.replace(EN_TETES_CLOTURE, '').replace(/^\s*\**\s*[:：—–-]?\s*/u, '')
        if (reste.trim()) sortie.push(reste)
      }
      continue
    }
    if (dedans) sortie.push(brute)
  }
  return sortie
}

/**
 * « rien » posé SEUL sur une ligne (puce comprise) = la rubrique est vide. C'est le signal d'arrêt.
 *
 * On exige la ligne entière, pas le mot n'importe où : dans le bloc Fait, « rien de cassé » ou
 * « rien ne bloque » racontent un travail RÉUSSI — les prendre pour une fin couperait la boucle
 * alors qu'il reste tout à faire.
 */
export function blocFaitDitRien(texte: string): boolean {
  return ligneNueDitRien(lignesDuBlocFait(texte))
}

/**
 * FIN DE CHAÎNE D'AUTOWIN — « ⏳ Reste à faire : rien. »
 *
 * MESURE DU 2026-09-02 (journaux de la journée) : en rejouant la chaîne complète
 * scout → frame → terrain → build → clean → judge sur le texte que l'app produit VRAIMENT, le
 * dernier maillon rend « ⏳ Reste à faire : rien. » puis « 👉 Recommandé : passer à la prochaine
 * demande. ». Des quatre rubriques, c'était la SEULE que cette porte ne lisait pas : la boucle
 * envoyait donc « passer à la prochaine demande. » comme ordre — un tour PAYANT qui ne produit
 * rien, dans les 19,38 $/jour de rattrapage mesurés. Une chaîne finie éteint la boucle.
 *
 * Même exigence de précision que pour le bloc « Fait » : le mot doit être SEUL sur sa ligne.
 * « rien ne bloque le lancement de clean » raconte une suite POSSIBLE, pas une fin.
 */
function resteAFaireDitRien(texte: string): boolean {
  return ligneNueDitRien(lignesDeRubrique(texte, 'Reste à faire'))
}

function ligneNueDitRien(lignes: readonly string[]): boolean {
  return lignes.some((ligne) => {
    const nu = ligne
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/^[\s>*•\-–—]+/u, '')
      .replace(/[\s.;:!*`]+$/u, '')
      .trim()
    return nu === 'rien' || nu === 'rien a signaler' || nu === 'rien a faire'
  })
}

/** Meme parade que prompt-suivant.ts : un saut de ligne ECRIT casse la compilation. */
const SAUT_ANCRAGE = String.fromCharCode(10)

/** Au-dela, l'ancrage noie le prompt qu'il accompagne : on le borne. */
const TACHE_ANCRAGE_MAX = 240

/**
 * LA TACHE INITIALE DU FIL — le PREMIER message que l'utilisateur a ecrit.
 *
 * Un message d'ORIENTATION est ecarte : il est tape PENDANT un tour et ne fonde pas la demande.
 */
export function tacheInitiale(fil: readonly Msg[]): string | null {
  for (const m of fil) {
    if (m.role !== 'user') continue
    const user = m as Extract<Msg, { role: 'user' }>
    if (user.orientation) continue
    const nu = (user.content ?? '').trim()
    if (!nu) continue
    return nu.length > TACHE_ANCRAGE_MAX ? `${nu.slice(0, TACHE_ANCRAGE_MAX).trimEnd()}…` : nu
  }
  return null
}

/**
 * ANCRAGE ANTI-DERIVE — demande utilisateur du 2026-09-02 : « le mode auto doit pas trop trop
 * partir en couille par rapport a la tache initiale non plus ».
 *
 * La boucle renvoyait le prompt du DERNIER tour, et RIEN d'autre : chaque maillon etait redige a
 * partir du precedent, sans aucune trace de la demande de depart. Le seul garde-fou etait
 * `prompt-identique`, qui n'attrape qu'une repetition mot pour mot — une derive LENTE passait
 * librement (mesure sur conv-138 : partie de « juge la qualite de mon prompting », la chaine est
 * arrivee au shader du nuage d'accueil, six tours plus loin).
 *
 * Chaque envoi automatique porte donc la tache initiale AVEC lui, et l'ordre de s'arreter plutot
 * que de s'en eloigner. L'ancrage est ajoute au texte ENVOYE, jamais a la condition d'arret.
 */
export function ancrerSurLaTacheInitiale(texte: string, tache: string | null): string {
  if (!tache) return texte
  // La suite EST la tache initiale (premier maillon) : l'ancrage ferait un doublon inutile.
  if (texte.trim() === tache.trim()) return texte
  return [
    texte,
    '',
    `(Mode auto — tâche initiale de ce fil : « ${tache} ». Si cette suite s'en éloigne, dis-le et`,
    'arrête la chaîne au lieu de dériver.)'
  ].join(SAUT_ANCRAGE)
}

export type RaisonArret =
  | 'inactif'
  | 'tour-en-cours'
  | 'deja-traite'
  | 'aucune-reponse'
  | 'brouillon'
  | 'recommandation-rien'
  | 'fait-rien'
  | 'reste-rien'
  | 'aucun-prompt'
  | 'prompt-identique'
  | 'chaine-finie'
  /* APRES UN SCOUT (conv-308) — types poses par le harnais, la logique reste a ecrire. */
  | 'scout-sans-cible'
  | 'cible-destructrice'

export interface EntreeDecisionAuto {
  /** Le mode auto est-il armé ? */
  actif: boolean
  /** Un tour est en cours : on attend, on n'envoie pas. */
  occupe: boolean
  fil: readonly Msg[]
  /** Signature du dernier tour déjà traité par le mode auto (null = aucun). */
  dernierTourTraite: string | null
  /** Texte du dernier prompt envoyé automatiquement (anti-boucle). */
  dernierPromptEnvoye: string | null
  /** L'utilisateur a du texte dans le champ : on ne lui vole pas son tour, on PATIENTE. */
  brouillonPresent: boolean
  /**
   * FIN DE CHAINE : au lieu d'ETEINDRE l'interrupteur, demander a l'agent de PROPOSER une nouvelle
   * cible (demande utilisateur du 2026-09-05, conv-307 : « rien » ne doit plus couper le mode).
   *
   * Reserve au fil AFFICHE. Un fil d'arriere-plan garde l'ancien comportement : on cesse de le
   * suivre sans depenser un tour payant sur une conversation que personne ne regarde.
   */
  proposerNouvelleCible?: boolean
  /**
   * CE TOUR EST-IL UN SCOUT ? Un scout rend plusieurs pistes : sa suite ne part que si une ligne
   * `CIBLE:` nomme UNE piste (conv-308). Champ pose par le harnais de tests ; encore lu par
   * personne dans `deciderRelanceAuto` — c'est exactement ce que les tests rouges reclament.
   */
  tourEstUnScout?: boolean
}

export type DecisionAuto =
  | { action: 'envoyer'; texte: string; signature: string }
  | { action: 'attendre'; raison: RaisonArret }
  | { action: 'arreter'; raison: RaisonArret; message: string }

/**
 * SEUL « rien » ÉTEINT le mode. C'est la condition demandée, et la seule.
 *
 * DÉFAUT VÉCU le 2026-09-02 : « quand je change de conversation ça enlève le mode auto ». En
 * arrivant dans un autre fil, la boucle lisait sa DERNIÈRE réponse — souvent ancienne et sans
 * suite proposée — et s'éteignait comme si le travail était fini. Une absence de suite n'est pas
 * une fin : c'est juste « rien à envoyer sur CE tour ». On patiente, l'interrupteur reste allumé.
 */
const MESSAGES_ARRET: Record<string, string> = {
  'recommandation-rien': 'Mode auto terminé : plus rien de recommandé.',
  'fait-rien': 'Mode auto terminé : le bloc « Fait » ne rapporte plus rien.',
  'reste-rien': 'Mode auto terminé : il ne reste plus rien à faire.'
}

/**
 * LE TOUR DE RELEVE, envoye UNE SEULE FOIS quand la chaine est finie.
 *
 * Il ne fabrique aucune tache : il demande a l'agent de PROPOSER des cibles et d'attendre le choix
 * de l'utilisateur. La borne de cout est le garde-fou anti-boucle deja present : ce texte etant
 * fixe, un second passage tombe sur `prompt-identique` et la boucle patiente au lieu de repartir.
 */
export const PROMPT_NOUVELLE_CIBLE =
  'La chaîne de ce fil est terminée. Ne lance aucun chantier : propose-moi avec `ask` 2 à 4 ' +
  'nouvelles cibles concrètes issues de ce qui vient d’être fait, et attends mon choix.'

/**
 * PREMIER PASSAGE DANS UN FIL : faut-il figer le tour deja affiche, ou le laisser partir ?
 *
 * Figer est le defaut, et c'est voulu : rouvrir une conversation de la veille ne doit pas relancer
 * un tour payant que personne n'a demande. Deux situations disent le CONTRAIRE, et elles ne sont
 * pas des « ouvertures » :
 *  - l'utilisateur vient d'allumer l'interrupteur EN VOYANT la suite proposee — c'est sa demande ;
 *  - l'agent a redemarre l'app LUI-MEME au milieu de la chaine (`restart_app` a pose une consigne
 *    de reprise sur le disque). Defaut vecu le 2026-09-05 (conv-303) : le repere de passage vit en
 *    memoire, le redemarrage l'efface, la boucle croit arriver dans le fil et saute le maillon
 *    suivant. L'interrupteur reste allume mais la chaine meurt en silence.
 *
 * Hors de ces deux cas — fermeture subie, simple rafraichissement — on fige, comme avant.
 */
export function premierPassageLaisseSortirLeTour(entree: {
  allumageManuel: boolean
  repriseApresRedemarrage: boolean
}): boolean {
  return entree.allumageManuel || entree.repriseApresRedemarrage
}

/** La SEULE porte qui autorise un envoi automatique. Tout le reste de la vue s'y plie. */
export function deciderRelanceAuto(entree: EntreeDecisionAuto): DecisionAuto {
  if (!entree.actif) return { action: 'attendre', raison: 'inactif' }
  if (entree.occupe) return { action: 'attendre', raison: 'tour-en-cours' }
  const signature = signatureTour(entree.fil)
  if (signature === null) return { action: 'attendre', raison: 'aucune-reponse' }
  if (signature === entree.dernierTourTraite) return { action: 'attendre', raison: 'deja-traite' }
  // Le mode reste ARMÉ pendant que l'utilisateur écrit : on patiente, on ne se coupe pas.
  if (entree.brouillonPresent) return { action: 'attendre', raison: 'brouillon' }
  const texteReponse = texteDernierAssistant(entree.fil) ?? ''
  /*
   * LES TROIS PORTES « RIEN » — elles disent toutes la MEME chose : ce fil n'a plus de suite.
   * Garde-fou 1 : la recommandation se lit sur la rubrique, pas sur le prompt. Garde-fou 1 bis : le
   * bloc « Fait » vide (c'est la que le mot tombe le plus souvent). Garde-fou 1 ter : « ⏳ Reste à
   * faire : rien », le texte qu'Autowin ecrit lui-meme apres le dernier maillon.
   */
  const finDeChaine: RaisonArret | null = recommandationDitRien(extractRecommendation(texteReponse))
    ? 'recommandation-rien'
    : blocFaitDitRien(texteReponse)
      ? 'fait-rien'
      : resteAFaireDitRien(texteReponse)
        ? 'reste-rien'
        : null
  if (finDeChaine) {
    // Fil d'arriere-plan : on cesse de le suivre, sans depenser un tour sur ce qu'on ne regarde pas.
    if (!entree.proposerNouvelleCible)
      return { action: 'arreter', raison: finDeChaine, message: MESSAGES_ARRET[finDeChaine] }
    // Deja demande : la releve n'a rien donne. On PATIENTE, l'interrupteur reste allume.
    if (entree.dernierPromptEnvoye?.trim().startsWith(PROMPT_NOUVELLE_CIBLE))
      return { action: 'attendre', raison: 'chaine-finie' }
    return { action: 'envoyer', texte: PROMPT_NOUVELLE_CIBLE, signature }
  }
  // Même garde qu'en affichage : si la demande de CE tour était déjà l'ordre de tri, la publication
  // proposée passe telle quelle — sinon le mode auto renvoie `/salvage` en boucle, à ses frais.
  const demandeDuTour = texteDerniereDemande(entree.fil) ?? undefined
  const brut =
    extrairePromptSuivant(texteReponse, demandeDuTour) ?? extractRecommendation(texteReponse)
  const suite = brut && estPromptDePublication(brut, demandeDuTour) ? PROMPT_SALVAGE : brut
  // Pas de suite proposée : on ne fabrique rien et on ne s'éteint pas — on attend le tour suivant.
  if (!suite) return { action: 'attendre', raison: 'aucun-prompt' }
  /*
   * L'ANCRAGE EST POSÉ AVANT la comparaison anti-boucle, et c'est délibéré : c'est le texte
   * RÉELLEMENT envoyé qui est mémorisé dans `dernierPromptEnvoye`. Comparer la suite NUE à un
   * précédent ancré ne serait jamais égal, et le garde-fou « deux fois la même suite » mourrait.
   */
  const texte = ancrerSurLaTacheInitiale(suite, tacheInitiale(entree.fil))
  // La même suite deux fois d'affilée = boucle : on ne la renvoie pas, sans couper l'interrupteur.
  if (entree.dernierPromptEnvoye && texte.trim() === entree.dernierPromptEnvoye.trim())
    return { action: 'attendre', raison: 'prompt-identique' }
  return { action: 'envoyer', texte, signature }
}

/**
 * APRES UN SCOUT — ce que le mode auto a le droit d'enchainer.
 *
 * Un scout rend plusieurs pistes. Sans regle, le maillon suivant repart sur le tableau entier et la
 * boucle depense un tour PAYANT sur une cible que personne n'a choisie. Cadrage du 2026-09-05
 * (conv-308) : la sortie porte une ligne `CIBLE:` ; pas de cible = fin de chaine ; une cible
 * destructrice ne part jamais toute seule.
 *
 * La porte lit la FORME (une cible nommee existe), jamais la qualite du choix : producteur et juge
 * sont le meme modele.
 */
export type DecisionScout =
  | { statut: 'cible'; cible: string }
  | { statut: 'aucune-cible' }
  | { statut: 'cible-destructrice'; cible: string }

/** Formulations dont le cout est IRREVERSIBLE : elles exigent l'accord de l'utilisateur. */
const CIBLE_DESTRUCTRICE =
  /\b(supprim\w*|effac\w*|ecras\w*|purg\w*|detrui\w*|delete|drop\s+(table|database)|truncate|rm\s+-[a-z]*[rf]|reset\s+--hard|force[- ]push|push\s+--force|clean\s+-[a-z]*f)\b/u

const LIGNE_CIBLE = /^\s*[>*_`\s]*cible\s*[:：]\s*(.*?)\s*[*_`]*\s*$/iu

export function lireCibleScout(texteScout: string): DecisionScout {
  for (const ligne of (texteScout ?? '').split(SAUT_ANCRAGE)) {
    const trouve = ligne.match(LIGNE_CIBLE)
    if (!trouve) continue
    const cible = trouve[1].replace(/^[\s*_`]+/u, '').trim()
    // La PREMIERE ligne `CIBLE:` fait foi : une seconde serait un choix de plus, pas un choix.
    if (!cible) return { statut: 'aucune-cible' }
    const nu = cible
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
    if (nu === 'aucune' || nu === 'rien' || nu === 'aucune cible')
      return { statut: 'aucune-cible' }
    if (CIBLE_DESTRUCTRICE.test(nu)) return { statut: 'cible-destructrice', cible }
    return { statut: 'cible', cible }
  }
  return { statut: 'aucune-cible' }
}
