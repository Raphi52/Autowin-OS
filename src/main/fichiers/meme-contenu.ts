/** Egalite d'OCTETS : comparer en texte re-encoderait, donc mentirait sur un fichier non-UTF-8. */
export function memeContenu(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}
