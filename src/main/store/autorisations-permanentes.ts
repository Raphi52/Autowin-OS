/**
 * LES AUTORISATIONS DE COMMANDE SURVIVENT À LA CONVERSATION.
 *
 * Demandé le 2026-08-28 : « dans toutes les conversations, forever ». Jusque-là, le droit se lisait
 * UNIQUEMENT dans les messages utilisateur de la conversation courante — donc il fallait le réécrire
 * dans chaque nouveau fil. La propriété de sûreté reste intacte : seul un message de rôle `user`
 * peut ALIMENTER ce registre ; le modèle ne peut toujours pas s'accorder un droit en l'écrivant.
 *
 * Le registre est un simple JSON dans la racine de données de l'app. Illisible/absent = registre
 * vide : un fichier corrompu ne doit jamais OUVRIR un droit, seulement en refermer.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface RegistreAutorisations {
  general: boolean
  binaires: readonly string[]
}

const REGISTRE_VIDE: RegistreAutorisations = { general: false, binaires: [] }

export function cheminRegistreAutorisations(racine: string): string {
  return join(racine, 'autorisations-commandes.json')
}

export function lireAutorisationsPermanentes(racine: string): RegistreAutorisations {
  try {
    const brut = JSON.parse(readFileSync(cheminRegistreAutorisations(racine), 'utf8')) as unknown
    if (!brut || typeof brut !== 'object') return REGISTRE_VIDE
    const objet = brut as { general?: unknown; binaires?: unknown }
    const binaires = Array.isArray(objet.binaires)
      ? objet.binaires.filter(
          (valeur): valeur is string => typeof valeur === 'string' && /^[a-z0-9._-]+$/.test(valeur)
        )
      : []
    return { general: objet.general === true, binaires }
  } catch {
    return REGISTRE_VIDE
  }
}

/** Ajoute (jamais ne retire) ce que l'utilisateur vient d'autoriser, et rend le registre à jour. */
export function memoriserAutorisations(
  racine: string,
  ajout: RegistreAutorisations
): RegistreAutorisations {
  const actuel = lireAutorisationsPermanentes(racine)
  const fusion: RegistreAutorisations = {
    general: actuel.general || ajout.general,
    binaires: [...new Set([...actuel.binaires, ...ajout.binaires])].sort()
  }
  if (fusion.general === actuel.general && fusion.binaires.join() === actuel.binaires.join()) {
    return actuel
  }
  const chemin = cheminRegistreAutorisations(racine)
  mkdirSync(dirname(chemin), { recursive: true })
  writeFileSync(chemin, JSON.stringify(fusion, null, 2), 'utf8')
  return fusion
}
