/**
 * /draft : LE CHOIX SE FAIT PAR LES BOUTONS DU BLOC, JAMAIS PAR `ask`.
 *
 * Demande de l'utilisateur, saisie ts 1792224829875 (conv-302, 2026-10-17) : « faut un bouton pour
 * prompter au lieu du bloc ask ». Le carrousel (scripts/draft-carrousel.mjs) porte depuis ses boutons
 * « Affiner la N · nom », « Implémenter la N · nom » et « Aucune : propose N autres directions », et
 * skills/draft/SKILL.md interdit le bloc `ask`. Le même jour, quatre tours /draft ont pourtant fini
 * par un `ask` sans AUCUN bloc de choix — conv-310 (tours c7d72274-db73-49bd-93fe-435f6647863a et
 * 40cbea6c-99bf-405f-8ad6-1e709913766a), conv-311 (4c898868-7bfa-4535-8300-c2802e61cf10), conv-312
 * (938a67c1-78bc-4bc5-addf-865167663f44), suivi de « je vois pas le block draft pour faire mon
 * choix » (saisie ts 1792247730596). Les trois appels modèle portaient la procédure ; la règle
 * générale « un choix → `ask` » (chat-pilotage-prompt.ts) l'a emporté. Une règle écrite de plus ne
 * suffit donc pas : le pilote refuse ce `ask` et rend la main au modèle pour qu'il pose le bloc.
 *
 * Ce qui est refusé est ÉTROIT : un `ask` qui fait choisir ENTRE LES PROPOSITIONS. Une question de
 * cadrage (étape 1 de la procédure : la technique cible) reste permise.
 */

import { skillNommeeEnTete } from '../shared/skill-nommee'
import { invokedSkillId } from './skill-pipeline'

interface MessageDuFil {
  role: string
  content: unknown
}

/** Libellés envoyés par les boutons du carrousel (BOUTONS_PAR_DEFAUT et boutonsFixes du script). */
const LIBELLE_DU_CARROUSEL = /^\s*(?:affiner la \d+\s*·|aucune?\s*:\s*propose \d+ autres)/i
/**
 * « Implémenter la N · nom », « implémente la 2 », « go implémente » : la sortie de la boucle /draft.
 * « go implémente en fonction du theme » est relevé dans conv-1002 : sans le mot de tête, la
 * remontée ci-dessous traversait cet ordre et gardait le mode pour tout le reste du fil.
 */
const ORDRE_D_IMPLEMENTATION = /^\s*(?:(?:go|ok|okay|oui|vas[- ]y|allez)[\s,:!.]+)*impl[ée]ment/i
/**
 * `/draft` en pleine phrase : « ok balec /draft comment… » (conv-1284), « Reprends le /draft… »
 * (conv-1113). Un MOT à part, précédé d'un espace : « n'importe où » attraperait
 * `skills/draft/SKILL.md` (conv-1317) ou `scripts/draft-carrousel.mjs`, et une citation de code
 * (`` `/draft` ``, scout conv-1332) ne vaut pas invocation.
 */
const DRAFT_EN_PLEINE_PHRASE = /\s\/draft(?![\w/-]|\.\w)/i
/**
 * Une invocation en pleine phrase est dans le début du message. Relevé sur le poste le 2026-10-30 :
 * les invocations tombent à 68 caractères au plus (conv-815) ; au-delà de 126, c'est une consigne
 * qui PARLE de /draft (« passe le carrousel /draft 3D en page interactive », conv-1304).
 */
const ZONE_D_INVOCATION = 100
/**
 * Réponses libres traversées, au plus, depuis le dernier repère. Un fil peut quitter la boucle sans
 * ordre reconnaissable (« la D », conv-802) : le mode ne doit pas durer jusqu'à la fin du fil. La
 * plus longue boucle relevée en compte 8 (conv-904) ; le rejeu en a laissé 25 sans cette borne.
 */
const MESSAGES_LIBRES_MAX = 10

/**
 * Vrai quand ce tour présente (ou re-présente) des propositions /draft : `skillInvoquee` (calculée
 * par le pilote) vaut `draft`, ou, en remontant les messages du plus récent au plus ancien, le
 * premier repère trouvé OUVRE la boucle (/draft, clic sur un bouton du carrousel) plutôt qu'il ne la
 * FERME (ordre d'implémentation, autre commande). Les messages libres entre les deux (« 1 et 3 »,
 * « la D », « plus sobre ») ne disent rien : on les traverse.
 *
 * La lecture se bornait aux deux derniers messages : le mode tombait à la deuxième réponse libre.
 * Rejoué le 2026-10-30 sur les fils du poste, ce défaut a laissé passer 16 `ask` qui faisaient choisir
 * entre des propositions, dans conv-1002 (« je vois pas de preview au tour precedent pour faire mon
 * choix »), conv-701, conv-903 et conv-904. Prix connu de la remontée : un `ask` de cadrage à six
 * options (conv-677) tombe aussi sous le refus ; le tour continue, le modèle reformule.
 *
 * Ne lit QUE les messages de l'utilisateur : le texte d'une réponse précédente n'est pas fiable dans
 * l'historique (il vit dans ses `parts`).
 */
export function boucleDraftEnCours(
  historique: ReadonlyArray<MessageDuFil>,
  skillInvoquee: string | undefined
): boolean {
  if (skillInvoquee === 'draft') return true
  const textes = historique
    .filter((message) => message.role === 'user' && typeof message.content === 'string')
    .map((message) => message.content as string)
  for (const texte of textes.slice(-(MESSAGES_LIBRES_MAX + 1)).reverse()) {
    if (skillNommeeEnTete(texte, ['draft'])) return true
    if (invokedSkillId(texte)) return false
    // Avant l'ordre d'implémentation : « Affiner la 2 · Implémentation légère » reste un clic.
    if (LIBELLE_DU_CARROUSEL.test(texte)) return true
    if (ORDRE_D_IMPLEMENTATION.test(texte)) return false
    if (DRAFT_EN_PLEINE_PHRASE.test(texte.slice(0, ZONE_D_INVOCATION))) return true
  }
  return false
}

/** Une option qui DÉSIGNE une proposition : « 3 · Koïs », « Affiner la 1 », « Mélanger la 5 »… */
const DESIGNE_UNE_PROPOSITION =
  /^\s*(?:\d+\s*[·.:)\-–]|(?:affiner|impl[ée]menter|m[ée]langer|garder|combiner)\b|aucune?\s*:)/i

function libelleDe(option: unknown): string {
  if (typeof option === 'string') return option
  if (option && typeof option === 'object') {
    const { libelle, envoi } = option as { libelle?: unknown; envoi?: unknown }
    if (typeof libelle === 'string') return libelle
    if (typeof envoi === 'string') return envoi
  }
  return ''
}

/**
 * Vrai quand les réponses d'un `ask` font choisir entre des propositions : au moins deux options
 * désignent une proposition, ou cinq options et plus (une fournée /draft en compte six).
 * Vérifié sur les quatre `ask` relevés le 2026-10-17 ; un cadrage « Web / WinForms / WPF » reste faux.
 */
export function askFaitChoisirUneProposition(args: unknown): boolean {
  const options = (args as { options?: unknown } | undefined)?.options
  if (!Array.isArray(options)) return false
  const libelles = options.map(libelleDe)
  const designent = libelles.filter((libelle) => DESIGNE_UNE_PROPOSITION.test(libelle)).length
  return designent >= 2 || libelles.length >= 5
}

/** Ce que le modèle reçoit à la place de sa question : quoi poser, et avec quel outil. */
export const REFUS_ASK_DRAFT =
  'ask → REFUSÉ : dans une boucle /draft, le choix entre les propositions ne passe JAMAIS par ' +
  '`ask` (demande de l’utilisateur : des boutons dans le bloc, pas de question). La question n’a ' +
  'pas été affichée et ton tour continue. Pose le BLOC DE CHOIX dans ta réponse : écris les ' +
  'propositions en JSON, lance `node scripts/draft-carrousel.mjs <propositions.json> --out ' +
  '<tour.md>` et pose ce fichier dans le fil avec `montrer_bloc` (ne le recopie pas : un ' +
  'carrousel de 52 ko n’y tenait plus, conv-1306) — ses boutons « Affiner la N · nom », ' +
  '« Implémenter la N · nom » et « Aucune : propose 6 autres directions » font le choix. Sujet 3D : ' +
  'UNE scène three.js dans le champ `scene3d` du JSON, qui suit `autowin.surChoix`, et pour `html` ' +
  'une fiche (nom + ce qui change) ; le carrousel devient alors une page ```html-interactif qui ' +
  'porte la scène (conv-1304). Puis termine ta réponse SANS question.'

/** Ligne visible dans le fil : l'utilisateur voit pourquoi aucune question ne s'affiche. */
export const STATUT_REFUS_ASK_DRAFT =
  'ask refusé : en /draft, le choix se fait par les boutons du bloc'
