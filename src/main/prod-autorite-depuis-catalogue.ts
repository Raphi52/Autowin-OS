/**
 * BÂTIR LA LISTE DE DÉCLARATION À PARTIR DU CATALOGUE SQL.
 *
 * POURQUOI PAS UN MOTIF DE NOM. La tentation est d'écrire « tout ce qui contient MAQUETTE ou RECETTE
 * est hors production ». `sql-read-catalog.ts` explique pourquoi c'est faux, et le dit d'expérience :
 * `RIG_LE_PUY_MARTIN` ressemble à un greffe et n'en est pas un. Une base nommée `RIG_MAQUETTE_2024`
 * pourrait très bien être exploitée ; à l'inverse, un nom anodin peut désigner de la production.
 * Classer sur le nom, c'est reprendre exactement le défaut que ce catalogue a corrigé.
 *
 * LA RÈGLE RETENUE, STRUCTURELLE :
 *   - une base EXPLOITÉE selon `COMMUN_RIG.dbo.GREFFE` (`GRF_IS_EXPLOIT = 1`) → **production** ;
 *   - une cible de DÉVELOPPEMENT déclarée en clair dans le code (`DEV_TARGETS` : `RIG_DEV`,
 *     `RIG_RECETTE`) → **hors production** ;
 *   - tout le reste n'est PAS écrit dans le fichier, et reste donc « inconnu », donc traité comme de
 *     la production. C'est voulu : une base absente de l'autorité est une base dont personne ne peut
 *     dire qu'elle est sûre.
 *
 * LE FICHIER PRODUIT EST RELISIBLE ET MODIFIABLE À LA MAIN : chaque ligne porte son motif, pour que
 * le jour où quelqu'un le rouvre, il sache d'où vient la classification.
 */
import type { SqlTarget } from './sql-read-catalog'

export interface EntreeDeclaration {
  nature: 'base'
  nom: string
  classe: 'prod' | 'non-prod'
  motif: string
}

export interface OptionsDeclaration {
  /** Les bases exploitées, lues dans l'autorité. Elles deviennent la production. */
  exploitees: readonly SqlTarget[]
  /** Les cibles de développement connues du code. Elles deviennent le hors-production. */
  developpement: readonly SqlTarget[]
}

/**
 * Construit les déclarations. Fonction PURE : aucune lecture de disque, aucune connexion — c'est ce
 * qui la rend testable et vérifiable ligne à ligne.
 *
 * En cas de nom présent des deux côtés, la PRODUCTION l'emporte : la déclaration la plus prudente
 * gagne, comme dans le chargeur de la liste (`prod-autorite-store.ts`).
 */
export function declarationsDepuisCatalogue(options: OptionsDeclaration): EntreeDeclaration[] {
  const parNom = new Map<string, EntreeDeclaration>()

  for (const cible of options.developpement) {
    const nom = cible.database?.trim()
    if (!nom) continue
    parNom.set(nom.toLowerCase(), {
      nature: 'base',
      nom,
      classe: 'non-prod',
      motif: `Cible de développement déclarée dans le code (${cible.server})`
    })
  }

  for (const cible of options.exploitees) {
    const nom = cible.database?.trim()
    if (!nom) continue
    parNom.set(nom.toLowerCase(), {
      nature: 'base',
      nom,
      classe: 'prod',
      motif: `Base exploitée selon COMMUN_RIG.dbo.GREFFE (${cible.server})`
    })
  }

  return [...parNom.values()].sort((a, b) => a.nom.localeCompare(b.nom))
}

/** Le contenu exact du fichier `prod-autorite.json`, prêt à écrire. */
export function contenuAutoriteProd(options: OptionsDeclaration): string {
  return `${JSON.stringify(declarationsDepuisCatalogue(options), null, 2)}\n`
}
