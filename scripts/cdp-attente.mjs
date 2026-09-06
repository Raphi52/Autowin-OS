/**
 * Attendre un ETAT de la page, jamais une DUREE.
 *
 * Defaut de fond des sondes CDP, mesure le 2026-09-06 : elles dorment un delai fixe apres un
 * clic, puis asserte. `autowin-cdp-proof.mjs --verify-navigation` photographiait ainsi la vue
 * Worktrees sur son ecran « Chargement… » et rendait un ROUGE PERMANENT — un instrument qui crie
 * tout le temps ne signale plus rien. A l'inverse, un delai fixe TROP LONG paie a chaque
 * execution un temps qui n'est utile qu'au pire cas.
 *
 * Attendre ne desserre AUCUNE assertion : passe le plafond, la sonde reprend son cours et le
 * controle qui suit rate exactement comme avant.
 */

/**
 * @param evaluer fonction qui evalue une expression DANS la page et rend sa valeur
 * @param expression expression JavaScript vraie quand l'etat attendu est atteint
 * @param plafondMs au-dela, on rend `false` sans lever : c'est l'assertion suivante qui tranche
 * @param pasMs intervalle entre deux lectures
 */
export async function attendreDansLaPage(evaluer, expression, plafondMs = 8000, pasMs = 200) {
  const echeance = Date.now() + plafondMs
  for (;;) {
    if (await evaluer(expression)) return true
    if (Date.now() >= echeance) return false
    await new Promise((resolve) => setTimeout(resolve, pasMs))
  }
}

/**
 * Attend que le texte de la page ne bouge PLUS (deux lectures identiques).
 *
 * Le bon repere quand la sonde ne sait pas nommer ce qu'elle attend : une vue qui charge ses
 * donnees change de texte a chaque peinture, une vue posee n'en change plus.
 */
export async function attendreStabilite(evaluer, plafondMs = 8000, pasMs = 200) {
  let precedent = null
  const echeance = Date.now() + plafondMs
  for (;;) {
    const texte = await evaluer(`document.body?.innerText ?? ''`)
    if (precedent !== null && texte === precedent) return true
    precedent = texte
    if (Date.now() >= echeance) return false
    await new Promise((resolve) => setTimeout(resolve, pasMs))
  }
}

/**
 * Attend un ETAT en REJOUANT une action entre deux lectures.
 *
 * Meme regle que `attendreDansLaPage`, pour les cas ou l'etat n'arrive QUE si on agit : un
 * overlay qui ne disparait qu'apres un clic. La borne reste un PLAFOND DE TEMPS, jamais un
 * nombre d'essais : un compteur d'essais est un delai fixe deguise, il ne dit rien de l'etat.
 *
 * @param evaluer fonction qui evalue une expression DANS la page et rend sa valeur
 * @param expression expression JavaScript vraie quand l'etat attendu est atteint
 * @param agir action rejouee tant que l'etat n'est pas atteint
 * @param plafondMs au-dela, on rend `false` sans lever : c'est l'assertion suivante qui tranche
 * @param pasMs intervalle entre deux lectures
 */
export async function agirJusqua(evaluer, expression, agir, plafondMs = 8000, pasMs = 200) {
  const echeance = Date.now() + plafondMs
  for (;;) {
    if (await evaluer(expression)) return true
    await agir()
    if (Date.now() >= echeance) return false
    await new Promise((resolve) => setTimeout(resolve, pasMs))
  }
}
