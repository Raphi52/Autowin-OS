/**
 * Le nom donne a l'assistant vocal de l'accueil, en fonctions PURES.
 *
 * Ce nom n'est pas qu'une etiquette : c'est ainsi que l'utilisateur appelle l'assistant a voix haute.
 * Il doit donc etre choisi par lui, survivre au redemarrage, et etre la SEULE source du titre affiche
 * sur la tuile -- un titre en dur et un nom regle ailleurs finiraient par se contredire.
 *
 * Hors React pour que la normalisation et la relecture soient testables sans monter d'interface.
 */
import { autowinStorageKey } from '../storage-keys'

/** Le nom d'origine, celui de l'assistant tant que personne n'en a choisi un autre. */
export const NOM_JARVIS_DEFAUT = 'Jarvis'

/**
 * Longueur maximale retenue.
 *
 * Le titre vit sur une etiquette d'une seule ligne au-dessus de la tuile : au-dela, il deborde sur la
 * tuile voisine. On COUPE plutot que de refuser -- refuser une frappe en cours d'ecriture est plus
 * penible qu'un nom trop long qu'on raccourcit.
 */
export const NOM_JARVIS_LONGUEUR_MAX = 24

export const CLE_NOM_JARVIS = autowinStorageKey('home.jarvis-nom.v1')

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Ramene une saisie quelconque a un nom affichable.
 *
 * Les espaces de bord sont retires, les caracteres de controle et les sauts de ligne aussi : colles
 * depuis un autre logiciel, ils casseraient l'etiquette sans que rien ne le signale. Une saisie vide
 * rend le nom d'origine : la tuile ne doit JAMAIS se retrouver sans titre.
 */
export function normaliserNomJarvis(brut: unknown): string {
  if (typeof brut !== 'string') return NOM_JARVIS_DEFAUT
  // eslint-disable-next-line no-control-regex
  const propre = brut.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (propre.length === 0) return NOM_JARVIS_DEFAUT
  return propre.slice(0, NOM_JARVIS_LONGUEUR_MAX).trim()
}

/** Le nom enregistre, ou celui d'origine si rien n'a jamais ete choisi (ou si la relecture echoue). */
export function lireNomJarvis(storage: StorageLike): string {
  try {
    return normaliserNomJarvis(storage.getItem(CLE_NOM_JARVIS))
  } catch {
    // Stockage indisponible : l'assistant garde son nom d'origine plutot que de casser la vue.
    return NOM_JARVIS_DEFAUT
  }
}

/**
 * Enregistre le nom et rend celui qui a REELLEMENT ete retenu.
 *
 * Rendre la valeur normalisee, et non la saisie, evite que l'affichage et le stockage divergent d'un
 * espace ou d'une troncature.
 */
export function ecrireNomJarvis(storage: StorageLike, brut: unknown): string {
  const nom = normaliserNomJarvis(brut)
  try {
    storage.setItem(CLE_NOM_JARVIS, nom)
  } catch {
    // Sans ecriture, le nom vaut pour la session : moins surprenant qu'un echec visible.
  }
  return nom
}
