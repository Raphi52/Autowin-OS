import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * QUELS SHA SONT CONSIGNES — la condition qui autorise, un jour, une suppression.
 *
 * La regle de retention refuse de supprimer une sauvegarde dont le SHA n'est ecrit nulle part :
 * c'est le seul endroit ou ce travail existe encore. Cette garde vivait en PROSE dans
 * `travail-non-publie.ts` ; une phrase ne bloque personne. Elle est desormais une lecture de
 * fichiers REELS, verses au depot sous `docs/salvage/registre-*.md`.
 *
 * FAIL-CLOSED : dossier absent, illisible, ou aucun registre -> l'ensemble est VIDE, donc plus rien
 * n'est jamais declare consigne, donc plus rien n'est supprimable. Une panne de lecture protege le
 * travail au lieu de l'exposer.
 */
const PREFIXE = 'registre-'
const SHA_40 = /\b[0-9a-f]{40}\b/g

export function chargerShaConsignes(racineDepot: string): ReadonlySet<string> {
  const dossier = join(racineDepot, 'docs', 'salvage')
  const consignes = new Set<string>()
  if (!existsSync(dossier)) return consignes
  let fichiers: string[]
  try {
    fichiers = readdirSync(dossier)
  } catch {
    return consignes
  }
  for (const fichier of fichiers) {
    if (!fichier.startsWith(PREFIXE) || !fichier.endsWith('.md')) continue
    try {
      for (const sha of readFileSync(join(dossier, fichier), 'utf-8').matchAll(SHA_40)) {
        consignes.add(sha[0])
      }
    } catch {
      // Un registre illisible ne fait pas tomber les autres : il n'ajoute simplement rien.
    }
  }
  return consignes
}
