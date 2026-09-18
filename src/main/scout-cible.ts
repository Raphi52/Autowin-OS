/**
 * LA CIBLE QU'UN SCOUT ENGAGE — et ce qui se passe quand il n'en engage aucune.
 *
 * Un scout ne rend pas un travail : il rend une LISTE de pistes classées. En mode piloté par un
 * humain, c'est l'humain qui en choisit une. En mode auto il n'y a personne : la phase suivante
 * reçoit un tableau et travaille « sur tout », c'est-à-dire sur rien de précis. Le choix n'existe
 * alors nulle part dans le run — ni dans le texte, ni dans une trace.
 *
 * DEUX ÉTAGES, et le second est ce qui empêche le premier d'être un vœu :
 *  1. CONVENTION — le brief du scout demande une section `## Cible` en TÊTE (la piste retenue + le
 *     pourquoi). Écrite seule, cette règle n'engage rien : elle est suivie ou non.
 *  2. GARDE DÉTERMINISTE — ce module. Une sortie de scout sans cible déclarée est repérée par sa
 *     FORME, jamais par la qualité du choix : producteur et juge étant le même modèle, seule une
 *     vérification de forme est falsifiable.
 *
 * POURQUOI UNE SECTION ET PAS UNE LIGNE EN TÊTE : ce qui passe à la phase suivante est projeté par
 * `phase-carry.ts`, qui — dès qu'une sortie porte des titres `##` — ne transmet QUE des sections
 * porteuses et jette le texte hors section. Une ligne `CIBLE:` posée avant le premier titre
 * disparaîtrait donc exactement dans le cas qu'elle doit couvrir. `cible` est pour cela déclarée
 * porteuse là-bas.
 *
 * PUR : pas d'horloge, pas de provider, aucune E/S.
 */

import { decisionDepuisPiste, LIGNE_CIBLE, type DecisionScout } from '../shared/scout-cible-lecture'

/** Le titre de section attendu, sans accent ni casse. Aligné sur `normaliserTitre` de phase-carry. */
const TITRE_CIBLE = 'cible'

function normaliser(titre: string): string {
  return titre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** `#3`, `n°3`, `3` : un numéro de ligne, qui ne nomme rien une fois le tableau hors de vue. */
function estNumeroNu(piste: string): boolean {
  return /^(?:#|n[o°]\s*)?\d+$/iu.test(piste)
}

/**
 * La valeur d'une ligne `CIBLES:`, décorations Markdown retirées (`**CIBLES:** a`, `> CIBLES: a`) —
 * même motif que `LIGNE_CIBLES` de `chat-auto-mode.ts`. `undefined` si la ligne n'en est pas une.
 */
function valeurLigneCibles(ligne: string): string | undefined {
  const trouve = /^\s*[>*_`\s]*cibles\s*[:：]\s*(.*?)\s*[*_`]*\s*$/iu.exec(ligne)
  return trouve ? trouve[1]!.replace(/^[\s*_`]+/u, '').trim() : undefined
}

/** Découpe un lot en pistes, décorations Markdown retirées — même découpe que `lireCiblesScout`. */
function pistesDuLot(valeur: string): string[] {
  return valeur
    .split(/\s*[,;·|]\s*|\s+\/\s+/u)
    .map((piste) => piste.replace(/^[\s*_`]+|[\s*_`]+$/gu, '').trim())
    .filter(Boolean)
}

/** La première ligne `CIBLES:` non vide ne donne QUE des numéros nus (rejetés, skills/scout/SKILL.md l.59). */
function lotDeNumerosNus(texte: string): boolean {
  for (const ligne of (texte ?? '').split('\n')) {
    const valeur = valeurLigneCibles(ligne)
    if (valeur === undefined) continue
    const pistes = pistesDuLot(valeur)
    return pistes.length > 0 && pistes.every(estNumeroNu)
  }
  return false
}

/**
 * La DÉCISION portée par une sortie de scout, avec la MÊME grammaire que le mode auto du chat
 * (`shared/scout-cible-lecture.ts`) : la justification après un tiret ne fait pas partie de la
 * cible, `aucune`/`rien` ferme la chaîne, et une formulation destructrice demande un accord.
 *
 * Deux formes acceptées, parce que les deux disent la même chose : une section `## Cible` non
 * vide, ou une ligne `CIBLE: …`.
 */
export function lireDecisionScoutTexte(texte: string): DecisionScout {
  const lignes = (texte ?? '').split('\n')
  // `CIBLES:` (lot de pistes, skills/scout/SKILL.md) l'emporte sur `CIBLE:` — même règle que
  // `lireCiblesScout` côté chat : une piste destructrice arrête le lot, des numéros nus ne nomment rien.
  for (const ligne of lignes) {
    const valeur = valeurLigneCibles(ligne)
    if (valeur === undefined) continue
    // La PREMIÈRE ligne `CIBLES:` fait foi, comme côté chat : vide = aucune cible.
    const pistes = pistesDuLot(valeur)
    if (pistes.length === 0) return { statut: 'aucune-cible' }
    for (const piste of pistes) {
      const decision = decisionDepuisPiste(piste)
      if (decision.statut === 'cible-destructrice') return decision
    }
    if (pistes.every(estNumeroNu)) return { statut: 'aucune-cible' }
    return decisionDepuisPiste(valeur)
  }
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i]!
    // Même motif que le chat (`LIGNE_CIBLE`) : `**CIBLE:** a` et `> CIBLE: a` sont reconnus.
    const enLigne = LIGNE_CIBLE.exec(ligne)
    if (enLigne) {
      // La PREMIÈRE ligne `CIBLE:` fait foi, comme côté chat : vide = aucune cible.
      return decisionDepuisPiste(enLigne[1]!.trim())
    }
    const titre = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(ligne)
    if (!titre || normaliser(titre[1]!) !== TITRE_CIBLE) continue
    // Le corps de la section : jusqu'au titre suivant. Une section vide ne déclare rien.
    const corps: string[] = []
    for (let j = i + 1; j < lignes.length; j++) {
      if (/^\s{0,3}#{1,6}\s+/.test(lignes[j]!)) break
      corps.push(lignes[j]!)
    }
    const valeur = corps.join('\n').trim()
    if (!valeur) continue
    // La décision se lit sur la PREMIÈRE ligne du corps : le reste est la justification.
    const decision = decisionDepuisPiste(valeur.split('\n')[0]!)
    if (decision.statut === 'cible') return { statut: 'cible', cible: valeur }
    return decision
  }
  return { statut: 'aucune-cible' }
}

/**
 * La cible déclarée par un scout, ou `undefined` s'il n'en déclare AUCUNE — « aucune », « rien »
 * et une ligne vide comptent désormais comme aucune cible, exactement comme dans le chat.
 */
export function lireCibleScout(texte: string): string | undefined {
  const decision = lireDecisionScoutTexte(texte)
  return decision.statut === 'aucune-cible' ? undefined : decision.cible
}

/**
 * Ce que la phase suivante doit lire en tête quand le scout n'a engagé AUCUNE cible.
 *
 * Rend `undefined` quand une cible est déclarée : il n'y a alors rien à ajouter.
 *
 * CE QUE CE N'EST PAS : un rejeu du scout. Rejouer coûterait un appel fournisseur de plus sans
 * garantir davantage — le même modèle, relancé, peut omettre la cible une seconde fois. Ce qui est
 * garanti ici, c'est qu'un choix manquant devient VISIBLE et NOMMÉ dans le run, au lieu de se
 * dissoudre en silence dans le tableau porté à la phase suivante.
 */
export function enteteCibleManquante(texte: string): string | undefined {
  const decision = lireDecisionScoutTexte(texte)
  if (decision.statut === 'cible') return undefined
  if (decision.statut === 'cible-destructrice')
    return (
      '## Cible\n' +
      `⚠️ La cible engagée est IRRÉVERSIBLE (« ${decision.cible} »). Une suppression, un écrasement ` +
      "ou un push forcé ne s'exécute pas sans l'accord explicite de l'utilisateur : ne la joue PAS. " +
      'Choisis une autre piste du tableau et écris-la sous la forme `CIBLE: <la piste> — POURQUOI: ' +
      "<la raison>`, ou termine le run par `SUITE: fin` en demandant l'accord."
    )
  // fix-ok: des numéros nus sous `CIBLES:` tombaient dans l'avertissement générique « aucune piste » au lieu d'être refusés (SKILL.md l.59).
  if (lotDeNumerosNus(texte))
    return (
      '## Cible\n' +
      '⚠️ Lot `CIBLES:` REJETÉ : il ne donne que des numéros de ligne, qui ne nomment rien sans le tableau. ' +
      'Avant toute action : réécris-le avec les pistes en toutes lettres, sous la forme ' +
      '`CIBLES: <piste A>, <piste B>`, et ne travaille que sur celles-là. ' +
      'Aucune piste défendable ? Termine le run par `SUITE: fin` en le disant.'
    )
  return (
    '## Cible\n' +
    "⚠️ Le scout n'a engagé aucune piste (aucune section `## Cible`, aucune ligne `CIBLE:`). " +
    'Avant toute action : choisis UNE ligne du tableau ci-dessous, écris-la en tête de ton livrable ' +
    'sous la forme `CIBLE: <la piste> — POURQUOI: <la raison>`, et ne travaille que sur celle-là. ' +
    'Aucune piste défendable ? Termine le run par `SUITE: fin` en le disant.'
  )
}

/**
 * La sortie de scout telle qu'elle doit être ENREGISTRÉE et portée à la suite.
 *
 * Inchangée quand la cible est là. Sinon l'avertissement est mis en TÊTE : c'est le seul endroit
 * qui survit à la projection ET à la troncature.
 */
export function sortieScoutAvecCible(texte: string): string {
  const entete = enteteCibleManquante(texte)
  return entete ? `${entete}\n\n${texte ?? ''}` : texte
}
