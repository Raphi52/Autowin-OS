import { useInsertionEffect } from 'react'

/**
 * Miroir « dernière valeur » d'une donnée du rendu, pour les écouteurs posés une fois et les appels
 * asynchrones. Écrire `ref.current` PENDANT le rendu (forme d'avant) est refusé par le compilateur
 * React : un rendu abandonné y laissait une valeur jamais affichée. L'effet d'insertion la pose
 * au commit, avant tout effet de mise en page des enfants.
 */
export function useTenirRefAJour<T>(ref: React.RefObject<T>, valeur: T): void {
  useInsertionEffect(() => {
    ref.current = valeur
  })
}
