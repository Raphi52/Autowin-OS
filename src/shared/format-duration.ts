/**
 * Formate une durée en millisecondes en texte court français.
 *
 * - < 1 s : `500 ms`
 * - secondes : `1,5 s` (virgule décimale, au plus 1 décimale, sans décimale inutile : `2 s`)
 * - minutes : `2 min 30 s` (secondes omises si nulles : `2 min`)
 * - heures : `1 h 05 min` (minutes sur 2 chiffres, omises si nulles : `1 h`)
 *
 * Valeurs négatives, NaN ou non finies -> `0 ms`.
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0 ms'

  let total = Math.round(ms)
  if (total < 1000) return `${total} ms`

  if (total < 60_000) {
    const tenths = Math.round(total / 100)
    if (tenths < 600) {
      const whole = Math.floor(tenths / 10)
      const frac = tenths % 10
      return frac === 0 ? `${whole} s` : `${whole},${frac} s`
    }
    // l'arrondi à 1 décimale atteint 60,0 s -> bascule en minutes
    total = 60_000
  }

  if (total < 3_600_000) {
    const totalSeconds = Math.round(total / 1000)
    if (totalSeconds < 3600) {
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`
    }
    // l'arrondi à la seconde atteint 60 min -> bascule en heures
    total = 3_600_000
  }

  const totalMinutes = Math.round(total / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours} h` : `${hours} h ${String(minutes).padStart(2, '0')} min`
}
