/**
 * OÙ EST LE CLI ? — résolution partagée des trois providers installés par `npm -g`.
 *
 * Les trois adaptateurs (claude, codex, kimi) connaissaient chacun UN seul chemin en dur sous
 * `%APPDATA%\npm`. Hors de ce cas exact — npm prefix configuré, pnpm, volta, install machine — ils
 * échouaient : `spawn claude ENOENT` (repli mort, prouvé le 2026-07-29) ou « Codex CLI introuvable »,
 * qui est précisément l'échec du fan-out scout observé le même jour.
 *
 * On ne peut PAS régler ça avec `shell: true` : les trois spawnent en `shell: false`, et c'est ce qui
 * garantit l'absence d'injection d'arguments et un prompt système à espaces/accents intact. Un shim
 * `.cmd` n'est donc jamais exécutable ici — il faut le VRAI fichier (exe, .js, .mjs).
 *
 * Ce module cherche donc un fichier RELATIF À UN PRÉFIXE npm, dans l'ordre : le préfixe par défaut
 * (`%APPDATA%\npm`, comportement historique préservé), puis chaque dossier du PATH.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface NpmGlobalLookupDeps {
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
}

/** Dossiers candidats comme préfixe npm global, du plus attendu au moins. Sans doublon. */
export function npmPrefixCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = []
  const push = (dir: string): void => {
    const clean = dir.trim().replace(/^"|"$/g, '')
    if (clean && !candidates.includes(clean)) candidates.push(clean)
  }
  // Le prefixe par defaut d'abord : ordre stable, aucune surprise sur un poste deja fonctionnel.
  if (env.APPDATA) push(join(env.APPDATA, 'npm'))
  for (const entry of (env.PATH ?? env.Path ?? '').split(';')) push(entry)
  return candidates
}

/**
 * Cherche `relativePath` (ex. `node_modules/@openai/codex/bin/codex.js`) sous un préfixe npm.
 * `directNames` permet de préférer un exécutable posé À PLAT dans le dossier (ex. `claude.exe`).
 * Rend `undefined` si rien n'existe — l'appelant décide alors quoi dire, honnêtement.
 */
export function findNpmGlobalFile(
  relativePath: string,
  deps: NpmGlobalLookupDeps & { directNames?: readonly string[] } = {}
): string | undefined {
  const env = deps.env ?? process.env
  const exists = deps.exists ?? existsSync
  for (const prefix of npmPrefixCandidates(env)) {
    for (const name of deps.directNames ?? []) {
      const direct = join(prefix, name)
      try {
        if (exists(direct)) return direct
      } catch {
        // Un dossier du PATH illisible ne doit pas interrompre la recherche.
      }
    }
    const packaged = join(prefix, relativePath)
    try {
      if (exists(packaged)) return packaged
    } catch {
      /* idem */
    }
  }
  return undefined
}
