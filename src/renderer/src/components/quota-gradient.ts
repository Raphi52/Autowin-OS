/*
 * TEINTE DU DEGRADE DE LA BARRE DE QUOTAS — helper PUR, volontairement hors du composant.
 *
 * Il vivait dans `ModelQuotaIndicator.tsx`, ou un fichier qui exporte a la fois un composant et
 * autre chose casse le rechargement a chaud de React (`react-refresh/only-export-components`) :
 * une edition du fichier rechargeait alors la page entiere au lieu du seul composant. Le sortir
 * ici est la correction a la source, pas une regle de lint desactivee.
 */
/**
 * COULEUR EXACTE DU POINT DE LA BARRE ou se pose la pastille.
 *
 * La pastille prenait la couleur du PALIER (vert/orange/rouge). A 74 % le degrade de la barre est
 * encore JAUNE-OR a cet endroit : la pastille verte ne correspondait pas a ce qu'on voit juste a
 * cote. On interpole ici les MEMES arrets que `.model-quota-bar-fill`.
 */
const QUOTA_STOPS: readonly (readonly [number, readonly [number, number, number]])[] = [
  [0, [184, 32, 26]],
  [12, [184, 32, 26]],
  [30, [224, 100, 30]],
  [42, [224, 100, 30]],
  [56, [239, 192, 35]],
  [68, [239, 192, 35]],
  [86, [53, 208, 127]],
  [100, [53, 208, 127]]
]

export function quotaGradientColor(percent: number): string {
  const p = Math.min(100, Math.max(0, percent))
  for (let i = 1; i < QUOTA_STOPS.length; i += 1) {
    const [x0, c0] = QUOTA_STOPS[i - 1]
    const [x1, c1] = QUOTA_STOPS[i]
    if (p <= x1) {
      const t = x1 === x0 ? 0 : (p - x0) / (x1 - x0)
      const mix = c0.map((v, k) => Math.round(v + (c1[k] - v) * t))
      return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
    }
  }
  return 'rgb(53, 208, 127)'
}
