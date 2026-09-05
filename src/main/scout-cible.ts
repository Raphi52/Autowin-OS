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

/**
 * La cible déclarée par un scout, ou `undefined` s'il n'en déclare aucune.
 *
 * Deux formes acceptées, parce que les deux disent la même chose et qu'en refuser une ne rendrait
 * le run ni plus sûr ni plus lisible : une section `## Cible` non vide, ou une ligne `CIBLE: …`.
 */
export function lireCibleScout(texte: string): string | undefined {
  const lignes = (texte ?? '').split('\n')
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i]!
    const enLigne = /^\s*CIBLE\s*:(.*)$/i.exec(ligne)
    if (enLigne) {
      const valeur = enLigne[1]!.trim()
      if (valeur) return valeur
      continue
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
    if (valeur) return valeur
  }
  return undefined
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
  if (lireCibleScout(texte)) return undefined
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
