import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Racine REELLE du depot, quelle que soit la machine.
 *
 * Les sondes `scripts/cdp-*.mjs` ecrivaient leurs captures et leurs rapports dans
 * `C:/Amitel/Autowin OS/...` : le chemin d'UNE installation, disparue depuis. Sur toute autre
 * machine, et depuis toute copie de travail d'agent, l'ecriture echouait ou deposait la preuve
 * hors du depot — un instrument de preuve qui ment sur l'endroit ou vit sa preuve.
 *
 * On REMONTE donc les parents du script jusqu'au dossier qui porte `package.json` (meme repere
 * que npm). Depuis une copie de travail (`<depot>/.autowin-data/autowin-os/worktrees/<x>/scripts`)
 * la remontee s'arrete sur la racine de CETTE copie, qui est bien la sienne.
 *
 * `AUTOWIN_RACINE` passe devant tout, pour un appelant qui sait mieux.
 */
export function racineDepot() {
  if (process.env.AUTOWIN_RACINE) return resolve(process.env.AUTOWIN_RACINE)
  let dossier = dirname(fileURLToPath(import.meta.url))
  const racineDisque = parse(dossier).root
  for (;;) {
    if (existsSync(resolve(dossier, 'package.json'))) return dossier
    const parent = dirname(dossier)
    if (dossier === racineDisque || parent === dossier) break
    dossier = parent
  }
  // Aucun `package.json` au-dessus : le script a ete copie hors d'un depot. Le dossier parent de
  // `scripts/` reste le moins mauvais point d'ancrage, et il est LOCAL — jamais une autre machine.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

/** Un chemin sous la racine du depot (`cheminDepot('artifacts', 'x.png')`). */
export function cheminDepot(...segments) {
  return resolve(racineDepot(), ...segments)
}

/** Le dossier `artifacts/` du depot courant. */
export function cheminArtefact(...segments) {
  return cheminDepot('artifacts', ...segments)
}

/** Le dossier `Audit/` du depot courant. */
export function cheminAudit(...segments) {
  return cheminDepot('Audit', ...segments)
}

/** Le `DevToolsActivePort` de l'instance lancee depuis ce depot. */
export function cheminDevToolsPort() {
  if (process.env.AUTOWIN_DATA_DIR) {
    return resolve(process.env.AUTOWIN_DATA_DIR, 'DevToolsActivePort')
  }
  return cheminDepot('.autowin-data', 'autowin-os', 'DevToolsActivePort')
}

/**
 * Ecrit un fichier SOUS le depot en creant son dossier au besoin.
 *
 * Les sondes ecrivaient dans une arborescence qui existait DEJA sur l'ancienne machine
 * (`Audit/headless-instances/`). Ancrees sur un depot frais, elles echouaient en `ENOENT` au
 * moment de deposer leur preuve — apres avoir fait tout le travail. Le dossier se cree donc ici.
 */
export function ecrireSousDepot(chemin, contenu, encodage) {
  mkdirSync(dirname(chemin), { recursive: true })
  if (encodage) writeFileSync(chemin, contenu, encodage)
  else writeFileSync(chemin, contenu)
  return chemin
}
