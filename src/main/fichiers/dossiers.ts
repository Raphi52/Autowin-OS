import { readdirSync, type Dirent } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Les fichiers sous `racine`, en chemins relatifs séparés par `/` ; un dossier illisible ne rend rien. */
export function listerRecursif(racine: string, prefixe = ''): string[] {
  let entrees: Dirent[]
  try {
    entrees = readdirSync(racine, { withFileTypes: true }) as Dirent[]
  } catch {
    return []
  }
  const trouves: string[] = []
  for (const entree of entrees) {
    const relatif = prefixe === '' ? entree.name : `${prefixe}/${entree.name}`
    if (entree.isDirectory()) trouves.push(...listerRecursif(join(racine, entree.name), relatif))
    else trouves.push(relatif)
  }
  return trouves
}

/** Vrai si `chemin` existe et est un dossier ; faux pour un fichier ou un chemin absent. */
export async function estUnDossier(chemin: string): Promise<boolean> {
  try {
    return (await stat(chemin)).isDirectory()
  } catch {
    return false
  }
}
