/**
 * Un poids brut ne se lit pas : 3 435 973 836 ne dit rien, « 3.2 Go » repond a la question posee.
 *
 * Module a part et non export du panneau : une fonction exportee depuis un fichier de composant
 * casse le rechargement a chaud (regle `react-refresh/only-export-components`).
 */
export function formaterOctets(octets: number): string {
  if (!Number.isFinite(octets) || octets <= 0) return '0 o'
  if (octets >= 1024 ** 3) return `${(octets / 1024 ** 3).toFixed(1)} Go`
  if (octets >= 1024 ** 2) return `${Math.round(octets / 1024 ** 2)} Mo`
  if (octets >= 1024) return `${Math.round(octets / 1024)} Ko`
  return `${octets} o`
}
