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

interface MessageDuFil {
  role: string
  content: unknown
}

/** Libellés envoyés par les boutons du carrousel (BOUTONS_PAR_DEFAUT et boutonsFixes du script). */
const LIBELLE_DU_CARROUSEL = /^\s*(?:affiner la \d+\s*·|aucune?\s*:\s*propose \d+ autres)/i
/** « Implémenter la N · nom », « implémente la 2 » : la sortie de la boucle /draft. */
const ORDRE_D_IMPLEMENTATION = /^\s*impl[ée]ment/i
const INVOCATION_DRAFT = /^\s*\/draft\b/i

/**
 * Vrai quand ce tour présente (ou re-présente) des propositions /draft :
 *  - le message invoque /draft (`skillInvoquee`, calculée par le pilote) ;
 *  - ou c'est le libellé d'un bouton du carrousel (« Affiner la 2 · … », « Aucune : propose … ») ;
 *  - ou c'est la réponse DIRECTE à un tour /draft (« 1 et 3 », « 1+3+4 »).
 * Faux dès que l'utilisateur ordonne l'implémentation. Ne lit QUE les messages de l'utilisateur :
 * le texte d'une réponse précédente n'est pas fiable dans l'historique (il vit dans ses `parts`).
 */
export function boucleDraftEnCours(
  historique: ReadonlyArray<MessageDuFil>,
  skillInvoquee: string | undefined
): boolean {
  if (skillInvoquee === 'draft') return true
  const textes = historique
    .filter((message) => message.role === 'user' && typeof message.content === 'string')
    .map((message) => message.content as string)
  const dernier = textes.at(-1) ?? ''
  if (ORDRE_D_IMPLEMENTATION.test(dernier)) return false
  if (LIBELLE_DU_CARROUSEL.test(dernier)) return true
  const precedent = textes.at(-2) ?? ''
  return INVOCATION_DRAFT.test(precedent) || LIBELLE_DU_CARROUSEL.test(precedent)
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
  '<tour.md>` et recopie son bloc ```html-render TEL QUEL — ses boutons « Affiner la N · nom », ' +
  '« Implémenter la N · nom » et « Aucune : propose 6 autres directions » font le choix. Sujet 3D ' +
  '(scènes ```threejs) : le même carrousel, avec pour `html` une fiche (nom + ce qui change) ; ' +
  'les scènes restent au-dessus. Puis termine ta réponse SANS question.'

/** Ligne visible dans le fil : l'utilisateur voit pourquoi aucune question ne s'affiche. */
export const STATUT_REFUS_ASK_DRAFT =
  'ask refusé : en /draft, le choix se fait par les boutons du bloc'
