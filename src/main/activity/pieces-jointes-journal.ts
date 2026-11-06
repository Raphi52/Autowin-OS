/**
 * Les journaux d'observation (`prompt-observability/`, `causal-trace/`) ne recopient JAMAIS le
 * contenu d'une piece jointe binaire (image, PDF...) : seuls son nom, son type et sa taille restent.
 *
 * Mesure 2026-11-02, : 5 captures PNG rejointes « depuis un message precedent » a CHAQUE
 * appel modele, ~20 Mo de base64 par ligne → 336 Mo de `prompt-observability/conv-331.jsonl` et
 * 341 Mo de `causal-trace/conv-331.jsonl` pour 43 appels. Ouvrir le fil relisait et parsait ces
 * fichiers d'un bloc (`loadPromptCalls`, indicateur de cout) : l'app plantait a l'ouverture.
 *
 * S'emploie comme `replacer` de `JSON.stringify` : `this` est l'objet porteur de la cle.
 */
export const CONTENU_JOINT_MAX = 2048

export function remplacerContenuJoint(this: unknown, cle: string, valeur: unknown): unknown {
  if (cle !== 'content' || typeof valeur !== 'string' || valeur.length <= CONTENU_JOINT_MAX)
    return valeur
  const porteur = this as Record<string, unknown> | null
  const type = porteur && typeof porteur.mimeType === 'string' ? porteur.mimeType : undefined
  if (!type || type.startsWith('text/')) return valeur
  return `[piece jointe non journalisee : ${valeur.length} caracteres, ${type}]`
}
