/**
 * Qui est « moi » sur ce poste.
 *
 * fix-ok: cause mesuree — la tuile Performance etait appelee dans HomeView.tsx sans `utilisateur`,
 * donc son mode « mes chiffres » n'avait aucun sujet et restait vide quelles que soient les donnees.
 * Il n'existait AUCUNE source d'identite dans l'app (grep `userInfo|USERNAME` sur src/main et
 * src/preload : zero occurrence hors tests). Ce module la fournit, et une seule fois.
 *
 * On lit le compte Windows, pas un nom saisi : c'est deja le compte utilise pour se connecter aux
 * bases des greffes (cf. sql-read-command.ts), donc le seul identifiant qui pourra ensuite etre
 * rapproche des lignes de production.
 */
import os from 'node:os'

export interface IdentiteDeps {
  /** Injectable pour les tests. Par defaut : le compte Windows du poste. */
  userInfo?: () => { username?: string | null }
  env?: Record<string, string | undefined>
}

/**
 * Rend le nom de compte courant, ou une chaine VIDE si le poste ne le donne pas — jamais un nom
 * invente : un faux « moi » attribuerait la production de quelqu'un d'autre.
 */
export function nomUtilisateurCourant(deps: IdentiteDeps = {}): string {
  const lire = deps.userInfo ?? ((): { username?: string | null } => os.userInfo())
  try {
    const brut = lire().username
    if (typeof brut === 'string' && brut.trim() !== '') return brut.trim()
  } catch {
    // Poste sans profil lisible : on retombe sur l'environnement plutot que d'echouer.
  }
  const env = deps.env ?? process.env
  const secours = env.USERNAME ?? env.USER
  return typeof secours === 'string' ? secours.trim() : ''
}
