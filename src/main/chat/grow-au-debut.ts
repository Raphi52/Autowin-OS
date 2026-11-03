/**
 * GROW CHARGÉE PAR LE CODE AU DÉBUT DE CHAQUE DEMANDE D'ACTION (conv-1445, 2026-11-03).
 *
 * Demande de l'utilisateur : « quand je fais une demande, ça améliore Autowin, ses tools et ses
 * skills PENDANT que ça traite la demande ». La skill `grow` (skills/grow/SKILL.md) agit pendant le
 * traitement, mais son corps n'entrait dans un tour que si le modèle choisissait `skill_charger`, ou
 * si l'utilisateur tapait `/grow` (ou cliquait le bouton de `proposition-grow.ts`, après coup). Rien
 * ne garantissait qu'elle parte. Une phrase de plus dans la consigne du chat n'aurait été qu'un vœu :
 * le déclencheur vit donc ici, en code, lu par `agent-pilot.ts` quand il assemble le message du tour.
 *
 * DÉCISION SUR LES MOTS DE L'UTILISATEUR : au début du tour, rien d'autre n'existe. Le classement est
 * large du côté de l'action (« go » ordonne d'exécuter la suite recommandée, un symptôme nu est un
 * rapport de bug à corriger) et étroit du côté de la question : une question, un avis, un merci ou
 * une analyse invoquée (`/scout`, `/look`) ne reçoivent pas la procédure. Portée MESURÉE par les
 * tests de `grow-au-debut.test.ts`, pas une généricité prouvée.
 *
 * COÛT : la procédure pèse quelques Ko, côté message (hors cache). Elle part UNE fois par session
 * du modèle ; une session reprise n'en reçoit qu'un rappel d'une ligne (`agent-pilot.ts`).
 */
import { messageSansSujetPropre } from '../brain-titres-du-tour'
import { normalizeIntent } from '../intent-phase-routing'

/**
 * Skills invoquées qui MODIFIENT par nature : leur nom est le verbe (« /draft une page d'accueil »).
 * Les autres skills (analyse, routines, publication) ne comptent comme action que si la suite du
 * message porte un verbe d'action. `forge` et `graft` n'y sont pas : elles créent déjà l'outil ou la
 * skill, et l'utilisateur ne veut pas les rejouer par grow (conv-1445).
 */
const SKILLS_D_ACTION = new Set(['build', 'heal', 'remake', 'draft', 'clean', 'terrain'])

/** Un accord nu : l'ordre d'exécuter le « 👉 Recommandé » du tour précédent (consigne du chat). */
const RELANCE =
  /^(?:go|vas[- ]?y|vazy|ok|okay|oui|yes|continue|continues|fonce|lance|on y va|d'accord|daccord|c'est parti|je valide|valide|let'?s go)\b[\s!.]*$/

/** Politesses et demandes indirectes à retirer avant de lire le verbe (« peux-tu corriger … »). */
const PREAMBULE =
  /^(?:(?:est-ce que |est ce que )?(?:tu )?(?:peux|pourrais)(?:-tu| tu)?|(?:vous )?(?:pouvez|pourriez)(?:-vous| vous)?|merci de|merci d'|s'?il te plait|s'?il vous plait|stp|svp|pls|please|can you|could you|would you|bon|alors|du coup|donc|hey|salut|ok|okay|super|parfait|top|maintenant|ensuite|puis|et)\b[\s,:!.-]*/

/** « je veux / il faut » + verbe : le verbe porte la décision (« je veux savoir » reste une question). */
const VOULOIR =
  /^(?:je veux|je voudrais|j'aimerais|il faut|il faudrait|il faudra|faut|on doit|tu dois|on va|tu vas|i want to|i'd like to|we need to|i need to|please)\b\s*/

/**
 * Un changement DÉSIRÉ, où qu'il soit dans la phrase : « dans les settings je veux que … »,
 * « je veux pouvoir cocher … », « il faut une map par dépôt », « l'idéal serait … ». Mesuré sur
 * les messages réels (conv-1445) : ancrée en tête, cette tournure manquait une partie de ses cas.
 */
const VOULOIR_QUE =
  /\b(?:(?:je veux|je voudrais|j'aimerais|il faut|il faudrait|faut|i want)\s+(?:que\b|qu'|pouvoir\b|une?\b|des\b)|l'ideal serait\b|ce serait (?:bien|mieux|top)\b|il manque\b)/

/** Une ouverture de question ou de discussion : pas une demande d'action, sauf action qui suit. */
const INTERROGATIF =
  /^(?:pourquoi|pk|pq|comment|quel|quels|quelle|quelles|qu'est-ce|qu'est ce|qu'en|que pense|que penses|est-ce que|est ce que|c'est quoi|c quoi|combien|ou est|ou sont|ou se|ou en|quand|qui|a quoi|parle[- ]moi|parle[- ]nous|explique|raconte|dis[- ]moi|tu penses|tu crois|tu sais|why|how|what|which|where|when|who|is it|is there|are there|do you|does it)(?![a-z])/

/**
 * Verbes d'action, en tête (après préambule). Racines suivies de `\w*` quand elles sont sans
 * ambiguïté ; formes exactes quand la racine attraperait un autre mot (« met » / « météo »,
 * « rend » / « rendement », « code » nom). Les verbes de LECTURE (cherche, trouve, analyse, liste,
 * montre) n'y sont pas : une lecture n'a rien à faire grandir.
 */
const VERBES = [
  'fai[st]?',
  'faire',
  'faites',
  'ajout\\w*',
  'rajout\\w*',
  'garde',
  'garder',
  'affine\\w*',
  'rejoue\\w*',
  'cree\\w*',
  'creer',
  'corrig\\w*',
  'repar\\w*',
  'modifi\\w*',
  'chang\\w*',
  'remplac\\w*',
  'renomm\\w*',
  'supprim\\w*',
  'retir\\w*',
  'enlev\\w*',
  'efface\\w*',
  'implement\\w*',
  'coder',
  'code-(?:moi|le|la|les)',
  'ecri\\w*',
  'reecri\\w*',
  'redig\\w*',
  'gener\\w*',
  'constru\\w*',
  'mets',
  'met',
  'mettre',
  'remets',
  'remettre',
  'branch\\w*',
  'debranch\\w*',
  'deplac\\w*',
  'refai\\w*',
  'refond\\w*',
  'amelior\\w*',
  'optimis\\w*',
  'lanc\\w*',
  'relanc\\w*',
  'migr\\w*',
  'install\\w*',
  'configur\\w*',
  'integr\\w*',
  'rends',
  'rendre',
  'transform\\w*',
  'convert\\w*',
  'export\\w*',
  'import\\w*',
  'prepar\\w*',
  'dessin\\w*',
  'produi\\w*',
  'publi\\w*',
  'pousse\\w*',
  'tradui\\w*',
  'nettoi\\w*',
  'nettoy\\w*',
  'range',
  'ranger',
  'adapt\\w*',
  'simplifi\\w*',
  'acceler\\w*',
  'debloqu\\w*',
  'resou\\w*',
  'resoudre',
  'regle',
  'regler',
  'ajuste\\w*',
  'align\\w*',
  'verifi\\w*',
  'assure\\w*',
  'teste',
  'tester',
  'testes',
  'reprend\\w*',
  'termine\\w*',
  'finis\\w*',
  'finir',
  'continue\\w*',
  'appliqu\\w*',
  'automatis\\w*',
  'active\\w*',
  'desactiv\\w*',
  'coupe\\w*',
  'add',
  'create\\w*',
  'make',
  'build',
  'fix\\w*',
  'write',
  'change',
  'update\\w*',
  'remove\\w*',
  'delete\\w*',
  'refactor\\w*',
  'rename\\w*',
  'move',
  'run',
  'launch\\w*',
  'deploy\\w*',
  'clean\\w*',
  'generate\\w*',
  'draw',
  'render',
  'translate\\w*',
  'optimi\\w*',
  'improve\\w*',
  'do'
].join('|')

const VERBE_EN_TETE = new RegExp(`^(?:${VERBES})(?![a-z0-9])`)

/** Une action qui suit une question (« pourquoi ça plante ? corrige-le »). */
const ACTION_QUI_SUIT = new RegExp(
  `(?:[,;:.!?]|\\bet\\b|\\bpuis\\b|\\bensuite\\b|\\band\\b|\\bthen\\b)\\s*(?:tu\\s+)?(?:${VERBES})(?![a-z0-9])`
)

/**
 * Un SYMPTÔME nu : la constitution le lit comme un rapport de bug complet, donc une correction à
 * mener (« je vois plus le bouton », « c'est tout flou au loin »).
 */
const SYMPTOME =
  /(?:marche(?:nt)? (?:pas|plus)|fonctionne(?:nt)? (?:pas|plus)|\bne (?:marche|fonctionne|s'affiche|s'ouvre|charge|repond|demarre)\b|s'affiche (?:pas|plus|mal)|n'apparai\w*|apparai\w* (?:pas|plus)|\bplante\w*|\bcrash\w*|\bbug\w*|\bcasse\w*|\bfige\w*|\bgele\b|\bfreeze\w*|\b(?:je|on) (?:ne )?(?:vois|voit) (?:pas|plus|rien)\b|\bdisparu\w*|\bintrouvable\b|\bflou\w*|\bdeborde\w*|\beclate\w*|\bbroken\b|doesn'?t work|not working)/

function sansPreambule(texte: string): string {
  let sortie = texte
  for (let tour = 0; tour < 3; tour += 1) {
    const retire = sortie.replace(PREAMBULE, '').trim()
    if (retire === sortie) break
    sortie = retire
  }
  return sortie
}

/** Retire la skill invoquée en tête (`/build …` ou `build …`) : la suite porte la demande. */
function sansSkillEnTete(texte: string, skill: string | undefined): string {
  if (!skill) return texte.replace(/^\/\S+\s*/, '')
  const nom = normalizeIntent(skill)
  const motif = new RegExp(`^/?${nom.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![a-z0-9])\\s*`)
  return texte.replace(motif, '')
}

/**
 * La demande de l'utilisateur est-elle une demande d'ACTION ? `skillInvoquee` = la skill reconnue
 * en tête du message par `agent-pilot.ts` (`invokedSkillId` / `skillNommeeSansBarre`).
 */
export function estUneDemandeDAction(demande: string | undefined, skillInvoquee?: string): boolean {
  // Réveil de plan de lots, reprise automatique, fin de chaîne : un message de l'APP, sans tâche
  // propre (mesuré conv-1445 : 3 réveils sur 9 faux positifs). Même liste que le Brain du tour.
  if (messageSansSujetPropre(demande ?? '')) return false
  const brut = normalizeIntent(demande ?? '')
  if (!brut) return false
  const skill = skillInvoquee?.trim().toLowerCase()
  if (skill && SKILLS_D_ACTION.has(skill)) return true
  const texte = sansSkillEnTete(brut, skill)
  if (!texte) return false
  if (RELANCE.test(texte)) return true
  const coeur = sansPreambule(texte)
  if (!coeur) return false
  if (INTERROGATIF.test(coeur)) return ACTION_QUI_SUIT.test(coeur)
  if (VOULOIR_QUE.test(coeur)) return true
  const apresVouloir = coeur.replace(VOULOIR, '')
  if (VERBE_EN_TETE.test(apresVouloir)) return true
  // « /scout le module puis corrige ce que tu trouves » : l'action arrive en seconde proposition.
  return ACTION_QUI_SUIT.test(coeur) || SYMPTOME.test(coeur)
}

/** En-tête du bloc complet : dit au modèle d'où vient la procédure et ce qu'elle ne remplace pas. */
export const ENTETE_GROW_AU_DEBUT =
  'GROW — procédure chargée par l’app au début de cette demande d’action (ce n’est pas une demande de l’utilisateur). ' +
  'Applique-la PENDANT le traitement, sans remplacer la demande ; rien d’ancré dans cette demande → « Grow : aucun manque observé ».'

/** Rappel d'une ligne quand la session reprise porte déjà la procédure entière. */
export const RAPPEL_GROW_AU_DEBUT =
  'GROW — la procédure grow (bloc « === SKILL GROW (kit) === » remis plus haut dans cette session) s’applique aussi à cette demande d’action.'

export interface BlocGrow {
  /** Le texte à injecter, vide si grow ne s'applique pas à ce tour. */
  texte: string
  /** Vrai quand la procédure ENTIÈRE part : la session la porte désormais. */
  complet: boolean
}

export function blocGrowDuTour(p: {
  demande: string | undefined
  skillInvoquee: string | undefined
  /** La session reprise du modèle a-t-elle déjà reçu la procédure entière ? */
  dejaDansLaSession: boolean
  /** Corps de la skill (`skillInstruction('grow')`), lu seulement si grow s'applique. */
  procedure: () => string
  /** Grow active dans les réglages (`enablement.v1.json`) : désactivée = ni injectée ni invocable. */
  active: () => boolean
}): BlocGrow {
  const rien: BlocGrow = { texte: '', complet: false }
  // `/grow …` porte déjà son corps par `skillBody` : le doubler ne ferait que le payer deux fois.
  if (p.skillInvoquee?.trim().toLowerCase() === 'grow') return rien
  if (!estUneDemandeDAction(p.demande, p.skillInvoquee)) return rien
  if (!p.active()) return rien
  if (p.dejaDansLaSession) return { texte: RAPPEL_GROW_AU_DEBUT, complet: false }
  const corps = p.procedure().trim()
  return corps ? { texte: `${ENTETE_GROW_AU_DEBUT}\n${corps}`, complet: true } : rien
}
