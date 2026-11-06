/**
 * L'AFFICHAGE SELON LA CONNEXION (2026-11-02) : connecté par Windows App (le Bureau à
 * distance) sur un petit écran (le téléphone), Autowin passe en mise en page ÉTROITE à gros boutons.
 * Sur un écran de PC, la session distante ne change rien : la « version allégée » sans animations a
 * été retirée à la demande de l'utilisateur (2026-11-04).
 *
 * Windows ne dit pas DEPUIS QUEL APPAREIL on se connecte : c'est la taille de l'écran de la session
 * qui sépare le PC du téléphone (choix de l'utilisateur, « la taille d'écran c'est un bon
 * indicateur »). Mesuré le 2026-11-02 sur ce poste, connexion depuis le PC : écran de session
 * 1920 x 1080, `SystemInformation.TerminalServerSession` = True, session `rdp-tcp#0`.
 */
export type AffichageSession = {
  /** La session Windows est ouverte à distance (Windows App, Bureau à distance). */
  distante: boolean
  /** L'écran de la session est celui d'un téléphone (petit côté sous `PETIT_COTE_TELEPHONE`). */
  telephone: boolean
}

export const AFFICHAGE_LOCAL: AffichageSession = { distante: false, telephone: false }

/**
 * Petit côté de l'écran, en pixels Windows (mise à l'échelle comprise), sous lequel c'est un
 * téléphone. Un téléphone 2400 x 1080 affiché à 200 % donne 1200 x 540 ; le plus petit portable
 * courant (1366 x 768 à 100 %, ou 1920 x 1080 à 150 % = 1280 x 720) reste au-dessus.
 */
export const PETIT_COTE_TELEPHONE = 600

export function estEcranDeTelephone(largeur: number, hauteur: number): boolean {
  if (!(largeur > 0) || !(hauteur > 0)) return false
  return Math.min(largeur, hauteur) < PETIT_COTE_TELEPHONE
}

/**
 * Forçage pour les captures et les essais (`AUTOWIN_AFFICHAGE`) : `distante`, `telephone` (qui
 * implique `distante` : un téléphone n'atteint ce PC qu'à distance) ou `local`. Toute autre valeur
 * est ignorée : la détection réelle s'applique.
 */
export function affichageForce(valeur: string | undefined): AffichageSession | null {
  switch ((valeur ?? '').trim().toLowerCase()) {
    case 'local':
      return AFFICHAGE_LOCAL
    case 'distante':
      return { distante: true, telephone: false }
    case 'telephone':
      return { distante: true, telephone: true }
    default:
      return null
  }
}

/** Décide l'affichage à partir de ce que Windows rapporte. */
export function affichageDe(mesure: {
  distante: boolean
  largeurEcran: number
  hauteurEcran: number
  force?: string
}): AffichageSession {
  const force = affichageForce(mesure.force)
  if (force) return force
  return {
    distante: mesure.distante,
    telephone: estEcranDeTelephone(mesure.largeurEcran, mesure.hauteurEcran)
  }
}

export function memeAffichage(a: AffichageSession, b: AffichageSession): boolean {
  return a.distante === b.distante && a.telephone === b.telephone
}

/**
 * Les attributs posés sur <html>, que les feuilles de style lisent (`affichage-session.css`).
 * `null` = attribut retiré.
 */
export function attributsAffichage(a: AffichageSession): {
  'data-session': 'distante' | null
  'data-ecran': 'telephone' | null
} {
  return {
    'data-session': a.distante ? 'distante' : null,
    'data-ecran': a.telephone ? 'telephone' : null
  }
}

export const CANAL_AFFICHAGE_SESSION = 'os:affichage-session'
export const CANAL_AFFICHAGE_SESSION_MAJ = 'os:affichage-session:maj'
