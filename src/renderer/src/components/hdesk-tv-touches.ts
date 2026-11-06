// Correspondance des touches du champ de frappe du panneau des Bureaux cachés. Hors de
// HdeskGestionView.tsx : un fichier de composant
// ne doit exporter que des composants (react-refresh/only-export-components). Sinon le rechargement
// à chaud invalide le parent et remonte tout l'arbre React (voir chat-parts-helpers.ts).

/**
 * Touche du champ de frappe -> touche nommée de hdesk-act. Entrée reste le « valider » du formulaire.
 * Ctrl+A/C/X/Z ne partent au bureau caché que si le champ est VIDE : sinon ils agissent sur
 * le champ lui-même (corriger sa frappe avant l'envoi).
 * Ctrl+V ne part JAMAIS (2026-11-04) : hdesk-act le poste en caractère 22 sans l'état de
 * Ctrl, et une console l'affichait « ^V » sans rien coller (mesure : « echo [^V »). Il colle donc dans
 * le champ, et Entrée tape le texte collé lettre par lettre, ce que la console reçoit bien.
 */
export function toucheTv(e: { key: string; ctrlKey?: boolean; currentTarget?: unknown; target?: unknown }, champVide = true): string | null {
  const directes: Record<string, string> = {
    Tab: 'Tab', Escape: 'Echap', Delete: 'Suppr', ArrowUp: 'Haut', ArrowDown: 'Bas', ArrowLeft: 'Gauche',
    ArrowRight: 'Droite', Home: 'Debut', End: 'Fin', PageUp: 'PageHaut', PageDown: 'PageBas'
  }
  if (e.ctrlKey) {
    const k = e.key.toLowerCase()
    return champVide && ['a', 'c', 'x', 'z'].includes(k) ? `Ctrl${k.toUpperCase()}` : null
  }
  if (e.key === 'Backspace') return champVide ? 'Retour' : null
  const d = directes[e.key]
  if (!d) return null
  // Flèches/Début/Fin dans un champ non vide : édition locale du champ.
  if (!champVide && ['Gauche', 'Droite', 'Debut', 'Fin', 'Suppr'].includes(d)) return null
  return d
}
