import { resolve } from 'node:path'

/**
 * Forme comparable d'un chemin de disque : absolu, sans séparateur final, et en minuscules sous
 * Windows, où `D:\AutoWinOS\` et `d:/autowinos` désignent le même dossier. Une seule définition :
 * chaque copie locale de cette règle finissait par traiter la casse ou le `\` final à sa façon.
 */
export function formeDuChemin(chemin: string): string {
  const nu = resolve(chemin).replace(/[\\/]+$/u, '')
  return process.platform === 'win32' ? nu.toLowerCase() : nu
}

/** Deux écritures désignent-elles le même fichier ou dossier sur le disque ? */
export function memeCheminSurDisque(a: string, b: string): boolean {
  return formeDuChemin(a) === formeDuChemin(b)
}
