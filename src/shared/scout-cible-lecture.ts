/**
 * LECTURE UNIQUE DE LA LIGNE `CIBLE:` — partagée par le mode auto du chat (renderer) et par la
 * garde de phase du pipeline (main).
 *
 * POURQUOI ICI : les deux côtés lisaient le MÊME mot-clé avec DEUX fonctions homonymes et des
 * conclusions incompatibles. Le chat arrêtait la chaîne sur `CIBLE: aucune` et exigeait un accord
 * pour une cible destructrice ; le pipeline prenait « aucune » pour une piste nommée et lançait la
 * phase suivante sur du vide — un appel payant pour rien. Une règle écrite deux fois n'est tenue
 * qu'une fois : elle vit désormais dans un seul module, importé par les deux.
 *
 * PUR : pas d'horloge, pas d'E/S, aucune dépendance Node ni DOM (donc importable côté renderer).
 */

export type DecisionScout =
  | { statut: 'cible'; cible: string }
  | { statut: 'aucune-cible' }
  | { statut: 'cible-destructrice'; cible: string }

/** Formulations dont le cout est IRREVERSIBLE : elles exigent l'accord de l'utilisateur. */
export const CIBLE_DESTRUCTRICE =
  /\b(supprim\w*|effac\w*|ecras\w*|purg\w*|detrui\w*|delete|drop\s+(table|database)|truncate|rm\s+-[a-z]*[rf]|reset\s+--hard|force[- ]push|push\s+--force|clean\s+-[a-z]*f)\b/u

const LIGNE_CIBLE = /^\s*[>*_`]*\s*cible\s*[:：]\s*(.*?)\s*[*_`]*\s*$/iu

/** Sans accents ni casse — la comparaison de forme ne doit pas dépendre de la frappe. */
export function normaliserPisteCible(valeur: string): string {
  return valeur.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase().trim()
}

/**
 * La piste NUE : la justification (`— parce que …`, `— POURQUOI: …`) n'appartient pas à la cible.
 * Sans ce retrait, `CIBLE: aucune — rien de rentable` se lit comme une vraie piste.
 */
export function pisteNue(valeur: string): string {
  return valeur
    .replace(/^[\s*_`]+/u, '')
    .split(/\s+[—–-]\s+|\s+parce\s+que\s+/iu)[0]!
    .trim()
}

/** La décision portée par une piste déjà isolée (ligne `CIBLE:` ou corps de section `## Cible`). */
export function decisionDepuisPiste(valeur: string): DecisionScout {
  const cible = pisteNue(valeur)
  if (!cible) return { statut: 'aucune-cible' }
  const nu = normaliserPisteCible(cible)
  if (nu === 'aucune' || nu === 'rien' || nu === 'aucune cible') return { statut: 'aucune-cible' }
  if (CIBLE_DESTRUCTRICE.test(nu)) return { statut: 'cible-destructrice', cible }
  return { statut: 'cible', cible }
}

/**
 * Lit la PREMIÈRE ligne `CIBLE:` d'une sortie de scout. Une seconde serait un choix de plus, pas
 * un choix : elle est ignorée.
 */
export function lireDecisionScout(texteScout: string): DecisionScout {
  for (const ligne of (texteScout ?? '').split('\n')) {
    const trouve = ligne.match(LIGNE_CIBLE)
    if (!trouve) continue
    return decisionDepuisPiste(trouve[1]!)
  }
  return { statut: 'aucune-cible' }
}
