// Correspondance des touches de la TV du bureau caché. Hors de HdeskTv.tsx : un fichier de composant
// ne doit exporter que des composants (react-refresh/only-export-components). Sinon le rechargement
// à chaud invalide le parent et remonte tout l'arbre React (voir chat-parts-helpers.ts).

/**
 * Touche du champ de la TV -> touche nommée de hdesk-act. Entrée reste le « valider » du formulaire.
 * Ctrl+A/C/V/X/Z ne partent au bureau caché que si le champ de la TV est VIDE : sinon ils agissent sur
 * le champ lui-même (corriger sa frappe avant l'envoi).
 */
export function toucheTv(e: { key: string; ctrlKey?: boolean; currentTarget?: unknown; target?: unknown }, champVide = true): string | null {
  const directes: Record<string, string> = {
    Tab: 'Tab', Escape: 'Echap', Delete: 'Suppr', ArrowUp: 'Haut', ArrowDown: 'Bas', ArrowLeft: 'Gauche',
    ArrowRight: 'Droite', Home: 'Debut', End: 'Fin', PageUp: 'PageHaut', PageDown: 'PageBas'
  }
  if (e.ctrlKey) {
    const k = e.key.toLowerCase()
    return champVide && ['a', 'c', 'v', 'x', 'z'].includes(k) ? `Ctrl${k.toUpperCase()}` : null
  }
  if (e.key === 'Backspace') return champVide ? 'Retour' : null
  const d = directes[e.key]
  if (!d) return null
  // Flèches/Début/Fin dans un champ non vide : édition locale du champ de la TV.
  if (!champVide && ['Gauche', 'Droite', 'Debut', 'Fin', 'Suppr'].includes(d)) return null
  return d
}
