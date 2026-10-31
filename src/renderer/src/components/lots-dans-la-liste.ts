/**
 * CE QUE LA LISTE DE GAUCHE FAIT DES FILS DE LOT (conv-1381, 2026-10-31).
 *
 * « Les conv de lot ne les affiche pas dans cette liste, on y accède que par les onglets » : un plan
 * de 8 lots ajoutait 8 lignes sous son chef, alors que les onglets de la super conv y mènent déjà.
 * Retirer ces lignes retire aussi deux informations qu'elles portaient, que ce module préserve : le
 * moyen d'atteindre un lot sans onglet, et le spinner d'un lot qui tourne.
 */

/**
 * Pur : les fils de lot que la liste n'affiche pas. Seulement ceux qu'un onglet atteint vraiment :
 * un lot d'un ancien plan du même chef, ou dont le chef n'existe plus, garde sa ligne, sinon plus
 * rien ne mènerait à lui.
 */
export function lotsSousOnglets(
  liens: ReadonlyMap<string, { chef: string; onglet: boolean }>,
  fils: ReadonlyMap<string, unknown>
): ReadonlySet<string> {
  const masques = new Set<string>()
  for (const [fil, lien] of liens) if (lien.onglet && fils.has(lien.chef)) masques.add(fil)
  return masques
}

/**
 * Pur : les chefs dont au moins un lot tourne (« le spinner de la conv chef doit pas s'arrêter
 * quand y a des sous-agents qui tournent sous ses ordres »). Le chef n'a pas de tour à lui pendant
 * que ses lots travaillent : sans ce report, la liste montrerait un chantier en cours comme à
 * l'arrêt. Mêmes signaux que le spinner d'une ligne (`LigneConversation`) : le tour suivi par cet
 * écran, ou le tour que l'app signale ailleurs (`hasStreamingTurn`).
 */
export function chefsAvecUnLotActif(
  convs: ReadonlyArray<{ id: string; hasStreamingTurn?: boolean }>,
  liens: ReadonlyMap<string, { chef: string }>,
  occupes: ReadonlySet<string>
): ReadonlySet<string> {
  const chefs = new Set<string>()
  for (const c of convs) {
    const chef = liens.get(c.id)?.chef
    if (chef && (occupes.has(c.id) || c.hasStreamingTurn === true)) chefs.add(chef)
  }
  return chefs
}
