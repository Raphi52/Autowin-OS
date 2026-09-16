/**
 * OÙ VIT L'EMPREINTE DE LA PHRASE DE PASSE DE PRODUCTION.
 *
 * Ce module ne fait QUE lire et écrire. Il ne vérifie aucune phrase, ne décide rien : la
 * vérification est dans `prod-passphrase.ts`, la classification des cibles dans `prod-guard.ts`.
 *
 * CE QUI EST ÉCRIT SUR DISQUE : un sel, une empreinte `scrypt`, une date. JAMAIS la phrase. Quelqu'un
 * qui lit le fichier ne peut pas s'authentifier avec — c'est tout l'intérêt d'une empreinte.
 *
 * FICHIER ABSENT OU ABÎMÉ = AUCUNE PHRASE, ET DONC AUCUN GESTE DE PRODUCTION POSSIBLE. C'est le même
 * choix que `autorisations-permanentes.ts` (« un fichier corrompu ne doit jamais OUVRIR un droit »),
 * mais l'effet ici est plus strict : sans empreinte, `CoffreAutorisationProd` refuse TOUT. Un fichier
 * effacé ne déverrouille donc pas la production, il la ferme.
 *
 * L'ÉCRITURE EST ATOMIQUE — fichier temporaire puis renommage. Une coupure de courant au milieu d'un
 * `writeFileSync` laisserait sinon une empreinte tronquée, c'est-à-dire une phrase que plus personne
 * ne peut saisir, y compris son propriétaire.
 *
 * DROITS DU FICHIER : `0o600` (lecture/écriture pour le seul propriétaire). Sans effet réel sur
 * Windows, où les ACL héritées du dossier de données priment — c'est écrit ici pour ne pas laisser
 * croire à une protection qui n'existe pas sur ce poste. Le fichier ne contient de toute façon aucun
 * secret réutilisable.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EmpreintePhrase } from '../prod-passphrase'

export function cheminEmpreinteProd(racine: string): string {
  return join(racine, 'prod-passphrase.json')
}

/** Une chaîne hexadécimale non vide — tout le reste est une empreinte abîmée. */
function estHex(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && valeur.length > 0 && /^[0-9a-f]+$/i.test(valeur)
}

/**
 * LIT L'EMPREINTE. Rend `undefined` dès que quelque chose cloche — fichier absent, JSON invalide,
 * champ manquant, algorithme inconnu. Aucune exception ne remonte : l'appelant n'a qu'un seul cas à
 * traiter, « pas de phrase », et ce cas est déjà le plus fermé.
 */
export function lireEmpreinteProd(racine: string): EmpreintePhrase | undefined {
  try {
    const brut = JSON.parse(readFileSync(cheminEmpreinteProd(racine), 'utf8')) as unknown
    if (!brut || typeof brut !== 'object') return undefined
    const objet = brut as Partial<EmpreintePhrase>
    if (objet.algorithme !== 'scrypt') return undefined
    if (!estHex(objet.sel) || !estHex(objet.empreinte)) return undefined
    const definieLe = typeof objet.definieLe === 'number' ? objet.definieLe : 0
    return { algorithme: 'scrypt', sel: objet.sel, empreinte: objet.empreinte, definieLe }
  } catch {
    return undefined
  }
}

/**
 * ÉCRIT L'EMPREINTE. N'accepte qu'une empreinte déjà formée par `definirPhrase` : ce module ne doit
 * jamais voir passer une phrase en clair, même le temps d'un appel.
 */
export function ecrireEmpreinteProd(racine: string, empreinte: EmpreintePhrase): void {
  if (
    empreinte?.algorithme !== 'scrypt' ||
    !estHex(empreinte.sel) ||
    !estHex(empreinte.empreinte)
  ) {
    throw new Error("Empreinte invalide : refus d'écrire un réglage inutilisable.")
  }
  const chemin = cheminEmpreinteProd(racine)
  mkdirSync(dirname(chemin), { recursive: true })
  const temporaire = `${chemin}.tmp`
  writeFileSync(temporaire, JSON.stringify(empreinte, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaire, chemin)
}

/**
 * EFFACE L'EMPREINTE — geste de dernier recours, quand la phrase est perdue. Il FERME la production
 * au lieu de l'ouvrir : sans empreinte, plus aucune autorisation ne peut être accordée tant qu'une
 * nouvelle phrase n'est pas définie. Rend `true` si un fichier a réellement été retiré.
 */
export function effacerEmpreinteProd(racine: string): boolean {
  try {
    unlinkSync(cheminEmpreinteProd(racine))
    return true
  } catch {
    return false
  }
}
