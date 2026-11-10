/**
 * ULTRATHINK — le mot-clé qui demande plus de réflexion sur UN message, comme dans Claude Code.
 *
 * Écrit n'importe où dans le message, il fait partir ce tour seul à un niveau de réflexion plus
 * haut ; le réglage du fil ne bouge pas et le message suivant repart au niveau habituel.
 * Même règle de reconnaissance que Claude Code (https://code.claude.com/docs/en/model-config) :
 * le mot seul, pas collé à des guillemets, des crochets, un chemin ou une commande — sinon c'est
 * du texte qui PARLE du mot (« ouvre `ultrathink` »), pas une demande.
 *
 * Partagé parce que le champ de saisie le signale avec la règle exacte qui décidera du tour.
 */
const COLLE_AVANT = '[\\p{L}\\p{N}_\\-/\\\\.\'"`’«(\\[{]'
const COLLE_APRES = '[\\p{L}\\p{N}_\\-/\\\\\'"`’»)\\]}]'
const MOT_CLE = new RegExp(
  `(?<!${COLLE_AVANT})ultrathink(?!${COLLE_APRES}|\\.[\\p{L}\\p{N}])`,
  'iu'
)

export function demandeUltrathink(texte: string | undefined): boolean {
  return MOT_CLE.test(texte ?? '')
}

/** Du moins au plus poussé. `none` = le modèle n'a pas de réglage de réflexion. */
const ORDRE_DES_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/** Le niveau visé par le mot-clé : celui de Claude Code. */
const EFFORT_ULTRATHINK = 'xhigh'

/**
 * Le niveau de réflexion d'un tour dont le message porte le mot-clé : `xhigh` si le modèle le
 * propose, sinon son niveau le plus haut en dessous. Ne baisse jamais un réglage déjà plus haut,
 * et ne déduit rien sans la liste des niveaux du modèle (`undefined`) ni pour un modèle sans
 * réglage (`none` seul).
 */
export function effortAvecUltrathink<E extends string>(
  actuel: E | undefined,
  proposes: readonly E[] | undefined
): E | undefined {
  if (!proposes) return actuel
  const rang = (effort: string): number => ORDRE_DES_EFFORTS.indexOf(effort)
  const plafond = rang(EFFORT_ULTRATHINK)
  const cible = proposes
    .filter((effort) => rang(effort) > 0 && rang(effort) <= plafond)
    .sort((a, b) => rang(b) - rang(a))[0]
  if (cible === undefined) return actuel
  return actuel !== undefined && rang(actuel) >= rang(cible) ? actuel : cible
}
