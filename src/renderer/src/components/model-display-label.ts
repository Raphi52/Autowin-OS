/**
 * Libellé de modèle DÉBARRASSÉ de ce que le contexte affiche déjà.
 *
 * Symptôme signalé le 2026-08-30 (captures à l'appui) : partout où les modèles sont groupés ou
 * marqués PAR PROVIDER — en-tête « CLAUDE » de la matrice effort, pastille du menu orchestrateur,
 * carte de la bibliothèque qui porte déjà `claude` en sous-titre —, le mot « Claude » était répété
 * devant CHAQUE ligne (« Claude Opus 5 · CLI » sous un titre « claude »). Le label canonique de
 * `models.ts` reste inchangé : il est juste, il sert hors contexte groupé. C'est l'AFFICHAGE qui
 * retire le préfixe redondant, et seulement quand le provider est visible à côté.
 */
export function shortModelLabel(label: string, provider?: string): string {
  if (!label || !provider) return label
  const prefix = new RegExp(`^${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i')
  const stripped = label.replace(prefix, '')
  // Un label qui n'est QUE le nom du provider ne doit pas devenir vide.
  return stripped.trim().length > 0 ? stripped : label
}
