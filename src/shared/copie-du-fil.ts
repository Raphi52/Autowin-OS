/**
 * LA COPIE DE TRAVAIL D'UN FIL — reconnue de la même façon par le processus principal et l'interface.
 *
 * Chaque fil du dépôt d'Autowin travaille dans sa copie, rangée sous `copies-de-taches/<id du fil>` dans
 * les données de l'app (`ouvrirLaCopieDeTache`, `src/main/copies/copie-de-tache.ts`). Le nom est l'identifiant
 * du fil, rien d'autre : c'est ce que l'utilisateur lit dans l'en-tête et sur le disque. Les copies déjà là
 * sous `copies-de-fil/<id du fil>` y restent jusqu'à leur retrait.
 *
 * Les copies ouvertes avant ce rangement vivent sous `retours-de-tour/essai__<fil>-<instant>-<rang>` :
 * `ancienNomDeCopieDeFil` les reconnaît toujours, et elles restent utilisées jusqu'à ce que le ménage
 * les retire.
 */

/** Le dossier, dans les données de l'app, où s'ouvrent les copies de fil. */
export const DOSSIER_DES_COPIES_DE_FIL = 'copies-de-fil'

/** Le dossier des données de l'app, quel que soit l'endroit où elle est installée. */
const DOSSIER_DES_DONNEES_DE_L_APP = '.autowin-data'

/**
 * Le chemin est-il rangé dans les données de l'app ? Tout ce qui y vit est une copie qu'elle a
 * ouverte (fil, tâche, run d'agent), jamais un projet de l'utilisateur. Le segment `.autowin-data`
 * est le discriminant déjà retenu par `src/main/app/app-data.ts`.
 */
export function estDansLesDonneesDeLApp(chemin: string | null | undefined): boolean {
  return (chemin ?? '')
    .split(/[\\/]/u)
    .some((segment) => segment.toLowerCase() === DOSSIER_DES_DONNEES_DE_L_APP)
}

/** Un identifiant de fil utilisable comme nom de dossier (même règle que les références git du fil). */
const ID_DE_FIL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

/** Les deux derniers segments du chemin, séparateur `\` ou `/`, barre finale ignorée. */
function deuxDerniersSegments(chemin: string): [string, string] {
  const segments = chemin.replace(/[\\/]+$/u, '').split(/[\\/]/u)
  return [segments.at(-2) ?? '', segments.at(-1) ?? '']
}

/** Le fil dont `chemin` est la copie (`…/copies-de-fil/<fil>`), ou `null`. */
export function nomDeCopieDeFil(chemin: string | null | undefined): { fil: string } | null {
  if (!chemin) return null
  const [parent, nom] = deuxDerniersSegments(chemin)
  if (parent.toLowerCase() !== DOSSIER_DES_COPIES_DE_FIL) return null
  if (!ID_DE_FIL.test(nom) || nom.includes('..')) return null
  return { fil: nom }
}

/** L'ancien nom d'une copie de fil : le fil peut porter des tirets, seuls les deux derniers nombres comptent. */
const ANCIEN_NOM_DE_COPIE = /^essai__(.+)-(\d+)-(\d+)$/u

export interface AncienneCopieDeFil {
  fil: string
  quand: number
  rang: number
}

/** Le fil, l'instant et le rang d'une copie rangée sous l'ancien nom `essai__<fil>-<instant>-<rang>`, ou `null`. */
export function ancienNomDeCopieDeFil(
  chemin: string | null | undefined
): AncienneCopieDeFil | null {
  if (!chemin) return null
  const [, nom] = deuxDerniersSegments(chemin)
  const trouve = ANCIEN_NOM_DE_COPIE.exec(nom)
  if (!trouve) return null
  const [, fil = '', instant = '', rangBrut = ''] = trouve
  const quand = Number(instant)
  const rang = Number(rangBrut)
  if (!fil || !Number.isSafeInteger(quand) || !Number.isSafeInteger(rang) || rang < 1) return null
  return { fil, quand, rang }
}
