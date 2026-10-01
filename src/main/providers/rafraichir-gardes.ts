import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGE_ORPHELIN_MS } from './temporaires-orphelins'

/** Nom du script de garde dans chaque dossier de réglages d'agent (voir `providers/claude.ts`). */
export const NOM_SCRIPT_GARDE = 'garde-git-destructeur.mjs'
const PREFIXE_REGLAGES = 'autowin-os-settings-'

export interface ResultatRafraichissement {
  /** Dossiers dont le script a été remplacé par la version courante. */
  rafraichis: string[]
  /** Dossiers déjà à jour. */
  aJour: string[]
  /** Dossiers dont le script n'a pas pu être remplacé (fichier verrouillé…). */
  echecs: string[]
}

/**
 * LES AGENTS DÉJÀ LANCÉS CHARGENT LA GARDE COURANTE.
 *
 * Le hook PreToolUse d'un agent pointe vers un script écrit UNE FOIS, à son lancement
 * (`providers/claude.ts`). Mesuré le 2026-10-01 : un agent lancé à 12:45 (conv-890), qui a survécu
 * au redémarrage de 12:54, gardait l'ancienne garde Python — le correctif ne valait que pour les
 * agents lancés après. Le script est relu par `node` à CHAQUE appel d'outil : le remplacer suffit.
 *
 * Au démarrage, chaque dossier de réglages encore récent (moins de 24 h, même limite que le balayage
 * des orphelins) reçoit le script courant. Remplacement par fichier temporaire puis renommage : un
 * hook qui lit pendant l'écriture voit l'ancien script ou le nouveau, jamais un morceau. Un fichier
 * verrouillé est laissé tel quel et compté en échec — l'agent garde alors l'ancienne garde.
 */
export function rafraichirGardesDesAgents(options: {
  racine: string
  script: string
  maintenant?: number
  ageMaxMs?: number
}): ResultatRafraichissement {
  const { racine, script } = options
  const maintenant = options.maintenant ?? Date.now()
  const ageMaxMs = options.ageMaxMs ?? AGE_ORPHELIN_MS
  const resultat: ResultatRafraichissement = { rafraichis: [], aJour: [], echecs: [] }
  let entrees: string[]
  try {
    entrees = readdirSync(racine)
  } catch {
    return resultat
  }
  for (const nom of entrees) {
    if (!nom.startsWith(PREFIXE_REGLAGES)) continue
    const dossier = join(racine, nom)
    const fichier = join(dossier, NOM_SCRIPT_GARDE)
    try {
      if (!statSync(dossier).isDirectory() || !existsSync(fichier)) continue
      if (maintenant - statSync(dossier).mtimeMs >= ageMaxMs) continue
      if (readFileSync(fichier, 'utf8') === script) {
        resultat.aJour.push(nom)
        continue
      }
      const provisoire = `${fichier}.${process.pid}.nouveau`
      writeFileSync(provisoire, script, 'utf8')
      renameSync(provisoire, fichier)
      resultat.rafraichis.push(nom)
    } catch {
      resultat.echecs.push(nom)
    }
  }
  return resultat
}
