// fix-ok: valeurs propres à entreprise (serveur, base, table, colonnes du catalogue) écrites en dur — mesuré par grep; remplacées par la config sql-catalog.json, fermée par défaut (tests sql-read-catalog/guard rouge si on rouvre)
/**
 * BÂTIR LA LISTE DE DÉCLARATION À PARTIR DU CATALOGUE SQL.
 *
 * POURQUOI PAS UN MOTIF DE NOM. La tentation est d'écrire « tout ce qui contient MAQUETTE ou RECETTE
 * est hors production ». `sql-read-catalog.ts` explique pourquoi c'est faux, et le dit d'expérience :
 * une base peut ressembler à de la production sans en être. Une base nommée `X_MAQUETTE_2024`
 * pourrait très bien être exploitée ; à l'inverse, un nom anodin peut désigner de la production.
 * Classer sur le nom, c'est reprendre exactement le défaut que ce catalogue a corrigé.
 *
 * LA RÈGLE RETENUE, STRUCTURELLE :
 *   - une base EXPLOITÉE selon la table catalogue configurée (`sql-catalog.json`) → **production** ;
 *   - une cible de DÉVELOPPEMENT déclarée dans cette configuration (`devTargets`) → **hors
 *     production** ;
 *   - tout le reste n'est PAS écrit dans le fichier, et reste donc « inconnu », donc traité comme de
 *     la production. C'est voulu : une base absente de l'autorité est une base dont personne ne peut
 *     dire qu'elle est sûre.
 *
 * LE CONTENU PRODUIT EST RELISIBLE ET MODIFIABLE À LA MAIN : chaque ligne porte son motif, pour que
 * le jour où quelqu'un le rouvre, il sache d'où vient la classification.
 *
 * UNE PROPOSITION, JAMAIS UNE ÉCRITURE. Le fichier de déclaration n'est écrit que par un humain
 * (`store/prod-autorite-store.ts`). L'écran de réglages (`ProdProtectionSettings.tsx`) montre ce
 * contenu et l'utilisateur le colle lui-même. La proposition REPREND sa déclaration actuelle telle
 * qu'écrite, n'y AJOUTE que les bases absentes, et ne BAISSE jamais une protection : une base qu'il
 * a protégée reste protégée, même si le catalogue la dit de développement.
 */
import type { EntreeAutorite } from './prod-guard'
import type { LectureBasesExploitees, SqlTarget } from './sql-read-catalog'
import type { PropositionAutoriteProd } from '../shared/prod-protection'

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
      motif: `Cible de développement déclarée dans la configuration (${cible.server})`
    })
  }

  for (const cible of options.exploitees) {
    const nom = cible.database?.trim()
    if (!nom) continue
    parNom.set(nom.toLowerCase(), {
      nature: 'base',
      nom,
      classe: 'prod',
      motif: `Base exploitée selon le catalogue configuré (${cible.server})`
    })
  }

  return [...parNom.values()].sort((a, b) => a.nom.localeCompare(b.nom))
}

export interface PropositionCatalogue {
  /** La déclaration complète proposée : l'actuelle telle qu'écrite, puis les ajouts. */
  entrees: EntreeAutorite[]
  /** Les bases du catalogue absentes de la déclaration actuelle. */
  ajoutees: EntreeDeclaration[]
  /** Les bases déclarées hors production que le catalogue dit exploitées : passées en production. */
  passeesEnProd: string[]
  /** Combien d'entrées de la déclaration actuelle sont reprises. */
  conservees: number
  /** Le contenu exact du fichier de déclaration, prêt à coller. */
  contenu: string
}

/** Même clé que le classifieur pour une base : la casse et les espaces autour ne comptent pas. */
const cleDe = (entree: { nature: string; nom: string }): string =>
  `${entree.nature}\u0000${entree.nom.trim().toLowerCase()}`

/**
 * Fusionne la déclaration ACTUELLE et le catalogue. Fonction PURE.
 *
 *  - une base absente est AJOUTÉE avec la classe du catalogue ;
 *  - une base déclarée `non-prod` que le catalogue dit exploitée passe en `prod` — la plus prudente
 *    gagne, comme dans `construireAutoriteProd` ;
 *  - une base déclarée `prod` le reste, même si le catalogue la dit de développement : la
 *    proposition n'ouvre jamais ce que l'utilisateur a fermé.
 */
export function propositionDepuisCatalogue(
  actuelles: readonly EntreeAutorite[],
  options: OptionsDeclaration
): PropositionCatalogue {
  const entrees: EntreeAutorite[] = actuelles.map((entree) => ({ ...entree }))
  const index = new Map<string, number>()
  entrees.forEach((entree, position) => {
    const deja = index.get(cleDe(entree))
    // Un doublon dans le fichier actuel : c'est l'entrée la plus prudente qui compte.
    if (deja === undefined || (entrees[deja].classe !== 'prod' && entree.classe === 'prod')) {
      index.set(cleDe(entree), position)
    }
  })

  const ajoutees: EntreeDeclaration[] = []
  const passeesEnProd: string[] = []
  for (const declaration of declarationsDepuisCatalogue(options)) {
    const position = index.get(cleDe(declaration))
    if (position === undefined) {
      index.set(cleDe(declaration), entrees.push({ ...declaration }) - 1)
      ajoutees.push(declaration)
      continue
    }
    const existante = entrees[position]
    if (existante.classe === 'non-prod' && declaration.classe === 'prod') {
      entrees[position] = { ...existante, classe: 'prod', motif: declaration.motif }
      passeesEnProd.push(existante.nom)
    }
  }

  return {
    entrees,
    ajoutees,
    passeesEnProd,
    conservees: actuelles.length,
    contenu: `${JSON.stringify(entrees, null, 2)}\n`
  }
}

/**
 * Ce que l'écran de réglages affiche. L'échec du catalogue est DIT, jamais converti en liste vide :
 * une proposition vide aurait l'air de dire « ta déclaration est complète ».
 */
export function propositionPourEcran(
  declaration: { declarations: readonly EntreeAutorite[]; anomalies: readonly string[] },
  lecture: LectureBasesExploitees,
  developpement: readonly SqlTarget[]
): PropositionAutoriteProd {
  if (!lecture.ok) return { ok: false, erreur: `Catalogue SQL illisible : ${lecture.erreur}` }
  const proposition = propositionDepuisCatalogue(declaration.declarations, {
    exploitees: lecture.exploitees,
    developpement
  })
  return {
    ok: true,
    exploitees: lecture.exploitees.length,
    ajoutees: proposition.ajoutees.map(({ nom, classe }) => ({ nom, classe })),
    passeesEnProd: proposition.passeesEnProd,
    conservees: proposition.conservees,
    anomalies: [...declaration.anomalies],
    contenu: proposition.contenu
  }
}
