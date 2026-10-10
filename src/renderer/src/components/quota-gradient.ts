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
 *
 * Les COULEURS ne sont plus ecrites ici (conv-197, 2026-10-10) : la pastille recopiait la palette
 * de base (vert #35d07f) alors que les themes Nebuleuse repeignent la barre (vert #4fd1a5) — deux
 * verts cote a cote. La barre et la pastille lisent desormais les MEMES variables CSS
 * (`--quota-rouge`, `--quota-orange`, `--quota-jaune`, `--quota-vert`, posees sur
 * `.model-quota-trigger` et changees par le theme) ; on ne rend que le melange `color-mix`, que le
 * navigateur resout comme le degrade (interpolation sRGB).
 */
const QUOTA_STOPS: readonly (readonly [number, string])[] = [
  [0, '--quota-rouge'],
  [12, '--quota-rouge'],
  [30, '--quota-orange'],
  [42, '--quota-orange'],
  [56, '--quota-jaune'],
  [68, '--quota-jaune'],
  [86, '--quota-vert'],
  [100, '--quota-vert']
]

export function quotaGradientColor(percent: number): string {
  const p = Math.min(100, Math.max(0, percent))
  for (let i = 1; i < QUOTA_STOPS.length; i += 1) {
    const [x0, c0] = QUOTA_STOPS[i - 1]
    const [x1, c1] = QUOTA_STOPS[i]
    if (p <= x1) {
      const t = x1 === x0 ? 0 : (p - x0) / (x1 - x0)
      if (c0 === c1 || t === 0) return `var(${c0})`
      if (t === 1) return `var(${c1})`
      return `color-mix(in srgb, var(${c1}) ${Math.round(t * 1000) / 10}%, var(${c0}))`
    }
  }
  return 'var(--quota-vert)'
}
