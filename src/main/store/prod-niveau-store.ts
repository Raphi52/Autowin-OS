/**
 * OÙ VIT LE NIVEAU DE PROTECTION DE PRODUCTION (aucun / confirmation / phrase).
 *
 * Ce module ne fait QUE lire et écrire. Il ne décide rien : le point de passage (`prod-gate.ts`)
 * applique le niveau, la fenêtre l'affiche.
 *
 * FICHIER ABSENT OU ABÎMÉ = `confirmation`, jamais `aucun`. C'est la règle de toute la famille de
 * gardes de ce dossier : une donnée manquante ne doit jamais OUVRIR un droit. Effacer le fichier ne
 * désactive donc pas la protection — il la ramène au défaut, qui protège.
 *
 * ÉCRITURE ATOMIQUE, comme pour l'empreinte : fichier temporaire puis renommage. Un fichier tronqué
 * par une coupure retomberait sur le défaut, mais autant ne jamais en produire.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  estNiveauProtection,
  NIVEAU_PROTECTION_PAR_DEFAUT,
  type NiveauProtectionProd
} from '../../shared/prod-protection'

export function cheminNiveauProd(racine: string): string {
  return join(racine, 'prod-niveau.json')
}

/** Le niveau en vigueur. Toute anomalie de lecture rend le défaut, qui PROTÈGE. */
export function lireNiveauProd(racine: string): NiveauProtectionProd {
  try {
    const brut: unknown = JSON.parse(readFileSync(cheminNiveauProd(racine), 'utf8'))
    const niveau = (brut as { niveau?: unknown } | null)?.niveau
    return estNiveauProtection(niveau) ? niveau : NIVEAU_PROTECTION_PAR_DEFAUT
  } catch {
    return NIVEAU_PROTECTION_PAR_DEFAUT
  }
}

export function ecrireNiveauProd(racine: string, niveau: NiveauProtectionProd): void {
  const chemin = cheminNiveauProd(racine)
  mkdirSync(racine, { recursive: true })
  const temporaire = `${chemin}.tmp`
  writeFileSync(temporaire, JSON.stringify({ niveau, changeLe: Date.now() }, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  })
  try {
    renameSync(temporaire, chemin)
  } catch (erreur) {
    try {
      unlinkSync(temporaire)
    } catch {
      // Le temporaire disparaîtra avec le dossier de données ; l'erreur utile est celle du renommage.
    }
    throw erreur
  }
}
