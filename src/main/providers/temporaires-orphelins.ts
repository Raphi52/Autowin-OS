import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * BALAYAGE DES TEMPORAIRES D'APPEL ORPHELINS.
 *
 * Le nettoyage de fin d'appel (`nettoyerTemporairesDeLAppel`) suffit tant que le process parent
 * VIT jusqu'au bout. Il ne couvre pas la fermeture de l'application ni un crash pendant qu'un CLI
 * tourne : le dossier reste. MESURE du 2026-09-04 sur le temp de Windows — 1 906 dossiers
 * `autowin-os-*`, dont 14 nes le jour meme, en paires `settings`/`system`, une par appel.
 *
 * DEUX GARDES, parce qu'un balayage est plus dangereux que la fuite qu'il repare :
 * 1. Seuls les prefixes que CE fichier cree sont candidats (jamais un dossier tiers, jamais la
 *    racine de donnees des tests `autowin-tests-appdata`).
 * 2. Seuls les dossiers plus vieux que `ageMiniMs` partent. Aucun appel au CLI ne dure 24 h, donc
 *    un dossier de cet age n'appartient plus a personne — un appel EN COURS n'est jamais touche.
 */
export const PREFIXES_TEMPORAIRES_APPEL = [
  'autowin-os-settings-',
  'autowin-os-system-',
  'autowin-os-attachments-',
  'autowin-os-mcp-'
] as const

/** 24 h : trois ordres de grandeur au-dessus de l'appel le plus long. */
export const AGE_ORPHELIN_MS = 24 * 3_600_000

export interface ResultatBalayage {
  supprimes: string[]
  echecs: string[]
}

export function balayerTemporairesOrphelins(
  racine: string,
  ageMiniMs: number = AGE_ORPHELIN_MS,
  maintenant: number = Date.now()
): ResultatBalayage {
  const resultat: ResultatBalayage = { supprimes: [], echecs: [] }
  let entrees: string[]
  try {
    entrees = readdirSync(racine)
  } catch {
    // Racine illisible : l'hygiene n'a jamais le droit de casser un appel.
    return resultat
  }
  for (const nom of entrees) {
    if (!PREFIXES_TEMPORAIRES_APPEL.some((prefixe) => nom.startsWith(prefixe))) continue
    const chemin = join(racine, nom)
    try {
      const infos = statSync(chemin)
      if (!infos.isDirectory()) continue
      if (maintenant - infos.mtimeMs < ageMiniMs) continue
      rmSync(chemin, { recursive: true, force: true })
      resultat.supprimes.push(nom)
    } catch {
      resultat.echecs.push(nom)
    }
  }
  return resultat
}
