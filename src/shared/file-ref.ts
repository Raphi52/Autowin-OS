/**
 * Références de fichier citées dans le markdown des agents (`[a.ts:80](src/main/a.ts:80)`).
 *
 * Le rendu les affichait en `code` mort : « il n'existe pas de navigation fichier ici ». Le canal
 * existe (`shell.openPath` côté main), il manquait un contrat pour décider si une cible est un
 * fichier et vers QUEL chemin réel elle pointe. Module pur et partagé : le renderer décide de
 * rendre un `<a>`, le main RE-valide avant d'ouvrir (jamais de confiance au renderer).
 */
export type FileRef = { path: string; line: number | undefined }

const WINDOWS_ABS = /^[a-zA-Z]:[\\/]/
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** `null` si la cible n'est pas une référence de fichier exploitable. */
export function parseFileRef(target: string): FileRef | null {
  const raw = (target ?? '').trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('//')) return null
  if (!WINDOWS_ABS.test(raw) && SCHEME.test(raw) && !/^[^\s:]+:\d+(?::\d+)?$/.test(raw)) return null

  let path = raw
  let line: number | undefined
  const withLine = /^(.+?):(\d{1,7})(?::\d{1,7})?$/.exec(raw)
  if (withLine) {
    path = withLine[1]
    // Les lignes commencent à 1 : « a.ts:0 » désigne le fichier, pas une ligne.
    line = Number(withLine[2]) || undefined
  }
  if (!path || /[\\/]$/.test(path)) return null
  const name = path.split(/[\\/]/).pop() ?? ''
  // Un fichier a un nom AVEC extension, sans espace : « une phrase sans extension » ne doit
  // jamais devenir un lien cliquable.
  if (!/^[^\s]+\.[A-Za-z0-9_-]{1,12}$/.test(name)) return null
  return { path, line }
}

// Sentinelle IMPOSSIBLE a produire par un vrai chemin : aucun systeme de fichiers n'accepte un
// octet NUL. Ecrite en ECHAPPEMENT et non en octet brut — un NUL litteral dans une source texte
// est refuse par la garde `branding`, et rendait ce fichier binaire aux yeux de grep et des diffs.
const ESCAPE = '\u0000escape'

function normalise(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      if (out.length === 0) return ESCAPE
      out.pop()
      continue
    }
    out.push(part)
  }
  return (p.startsWith('/') ? '/' : '') + out.join('/')
}

/** Chemin absolu réel, ou `null` si la cible sort de `root`. */
export function resolveFileRef(root: string, path: string): string | null {
  const base = normalise(root).replace(/\/+$/, '')
  const isAbs = WINDOWS_ABS.test(path) || path.startsWith('/')
  const joined = isAbs ? normalise(path) : normalise(`${base}/${path}`)
  if (joined === ESCAPE || base === ESCAPE || !base) return null
  const lowerBase = base.toLowerCase()
  const lowerJoined = joined.toLowerCase()
  if (lowerJoined !== lowerBase && !lowerJoined.startsWith(`${lowerBase}/`)) return null
  return joined
}
