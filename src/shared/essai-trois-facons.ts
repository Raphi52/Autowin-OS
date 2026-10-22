/**
 * « ESSAIE 3 FAÇONS » — ce que l'interface et le processus principal lisent de la même façon
 * (conv-1038, 2026-10-21 — idée 6 : la carte de comparaison et « Garder celle-ci »).
 *
 * LE NOM DE LA COPIE relie les branches d'un même essai : `ouvrirCopiesDEssai`
 * (`src/main/photo-du-code.ts`) les ouvre sous `essai__<fil>-<instant>-<rang>`. Le fil peut porter
 * des tirets (`conv-1038`) : seuls les deux derniers nombres sont l'instant et le rang.
 *
 * LA MARQUE DE LA DEMANDE est la phrase que `demandePourLaFacon` (`trois-facons.ts`) ajoute au texte
 * envoyé à chaque façon. Une branche porte aussi les messages copiés du fil d'origine : seul ce qui
 * suit cette demande est le travail de la façon (ses vérifications, son état).
 */

export const MARQUE_DEMANDE_DESSAI = /\(Essai \d+\/\d+ — façon imposée :/u

const NOM_DE_COPIE = /^essai__(.+)-(\d+)-(\d+)$/u

export interface CopieDEssai {
  fil: string
  quand: number
  rang: number
}

/** Le dernier segment du chemin, que le séparateur soit `\` ou `/`, barre finale ignorée. */
function dernierSegment(chemin: string): string {
  return (
    chemin
      .replace(/[\\/]+$/u, '')
      .split(/[\\/]/u)
      .at(-1) ?? ''
  )
}

export function nomDeCopieDEssai(chemin: string | undefined): CopieDEssai | null {
  if (!chemin) return null
  const trouve = NOM_DE_COPIE.exec(dernierSegment(chemin))
  if (!trouve) return null
  const [, fil = '', instant = '', rangBrut = ''] = trouve
  const quand = Number(instant)
  const rang = Number(rangBrut)
  if (!fil || !Number.isSafeInteger(quand) || !Number.isSafeInteger(rang) || rang < 1) return null
  return { fil, quand, rang }
}

/**
 * LA RESSEMBLANCE d'une façon avec la plus proche des autres (conv-1057, 2026-10-22 — calculée par
 * `src/main/ressemblance-des-facons.ts`). `identique` : même état du code que cette autre façon.
 * `part` : lignes changées en commun sur l'ensemble des lignes changées par les deux (0 à 1).
 * `avec` : le rang de cette autre façon (1 à 3).
 */
export type RessemblanceDUneFacon =
  | { etat: 'mesuree'; avec: number; part: number; identique: boolean }
  | { etat: 'sans-objet'; raison: string }

/** Une ligne de la carte de comparaison, telle que la rend `os:conversations:comparerLesFacons`. */
export type ComparaisonDUneFacon =
  | {
      id: string
      ok: true
      bilan: {
        etat: 'pas-parti' | 'en-cours' | 'fini' | 'echec' | 'arrete'
        vertes: number
        rouges: number
      }
      /** Absente quand le processus principal date d'avant ce contrôle (pas encore redémarré). */
      ressemblance?: RessemblanceDUneFacon
      ecart:
        | {
            ok: true
            fichiers: Array<{ chemin: string; ajouts: number | null; retraits: number | null }>
            ajouts: number
            retraits: number
          }
        | { ok: false; raison: string }
    }
  | { id: string; ok: false; raison: string }

/** Ce que rend « Garder celle-ci » (`os:conversations:garderEssai`). */
export type ResultatGarderUneFacon =
  | { ok: true; etat: 'publie'; sha?: string; fichiers: string[] }
  | { ok: true; etat: 'en-attente'; fichiers: string[]; detail: string }
  | { ok: true; etat: 'differe'; fichiers: string[]; detail: string }
  | { ok: false; raison: string }
