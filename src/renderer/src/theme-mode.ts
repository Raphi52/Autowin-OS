/**
 * MODE D'AFFICHAGE — sombre (par défaut) ou clair.
 *
 * Un SEUL point de vérité : la valeur est écrite sur `document.documentElement` en
 * `data-theme`, et c'est ce que les feuilles de style regardent (`:root[data-theme='clair']`
 * dans `assets/theme-modes.css`). Aucun composant ne repeint quoi que ce soit lui-même.
 *
 * Par défaut SOMBRE : personne qui n'y touche pas ne doit voir son application changer.
 */
export type ThemeMode = 'sombre' | 'clair'

export const THEME_MODE_STORAGE_KEY = 'autowin-theme-mode.v1'
const THEME_MODE_PAR_DEFAUT: ThemeMode = 'sombre'

function estThemeMode(valeur: unknown): valeur is ThemeMode {
  return valeur === 'sombre' || valeur === 'clair'
}

/** Lit le mode mémorisé. Toute valeur absente ou abîmée retombe sur le sombre. */
export function lireThemeMode(): ThemeMode {
  try {
    const brut = globalThis.localStorage?.getItem(THEME_MODE_STORAGE_KEY)
    return estThemeMode(brut) ? brut : THEME_MODE_PAR_DEFAUT
  } catch {
    // localStorage indisponible (contexte de test, mode privé) : le sombre reste le repli.
    return THEME_MODE_PAR_DEFAUT
  }
}

/**
 * Applique le mode au document. Le sombre RETIRE l'attribut au lieu d'écrire `sombre` :
 * l'état par défaut du document reste exactement celui d'avant ce réglage.
 */
export function appliquerThemeMode(mode: ThemeMode): void {
  const racine = globalThis.document?.documentElement
  if (!racine) return
  if (mode === 'clair') racine.setAttribute('data-theme', 'clair')
  else racine.removeAttribute('data-theme')
}

/** Mémorise ET applique. C'est ce qu'appelle l'interrupteur de Settings · Interface. */
export function ecrireThemeMode(mode: ThemeMode): void {
  try {
    globalThis.localStorage?.setItem(THEME_MODE_STORAGE_KEY, mode)
  } catch {
    // Écriture impossible : le mode s'applique quand même pour la session en cours.
  }
  appliquerThemeMode(mode)
}
