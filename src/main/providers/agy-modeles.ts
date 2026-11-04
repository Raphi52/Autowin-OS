/**
 * Modèles Gemini proposés par agy (2026-11-04, conv-1530). Avant, le catalogue n'offrait que
 * l'entrée « défaut » d'agy (`modelesAgy` dans agy.ts) : l'onglet Gemini du choix de modèle
 * n'avait aucun modèle à choisir, alors que `agy models` en annonce plusieurs pour le compte.
 *
 * Fichier à part plutôt qu'ajouté dans agy.ts : agy.ts portait le travail non commité de conv-1499
 * au moment de ce correctif.
 */
import { execFile } from 'node:child_process'
import { modelesAgy, resolveAgyBin } from './agy'

export type ModeleAgy = ReturnType<typeof modelesAgy>[number]

/**
 * Lit la sortie de `agy models` : une ligne `<id>\t<libellé>` par modèle, après une ligne
 * « Fetching available models... » (mesuré, agy 1.5.0, 2026-11-04). Seuls les modèles Gemini sont
 * gardés : l'onglet « Gemini » les regroupe, et Claude passe par Claude Code, jamais par agy.
 * L'effort est dans l'id (`gemini-3.8-flash-high|medium|low`) : chaque variante est une entrée.
 */
export function lireModelesAgy(sortie: string): ModeleAgy[] {
  const vus = new Set<string>()
  return sortie.split(/\r?\n/).flatMap((ligne) => {
    const [id = '', ...reste] = ligne.trim().split('\t')
    if (!/^gemini-[a-z0-9][a-z0-9.-]*$/.test(id) || vus.has(id)) return []
    vus.add(id)
    return [
      {
        id: `agy/${id}`,
        provider: 'agy',
        model: id,
        label: reste.join(' ').trim() || id,
        reasoningEfforts: ['none'],
        defaultReasoningEffort: 'none',
        dynamicallyLoaded: true
      }
    ]
  })
}

/** `agy models` — environ 1,3 s mesuré ; abandonné au-delà de 15 s. */
function listerAgy(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['models'], { timeout: 15_000, windowsHide: true }, (erreur, stdout) =>
      erreur ? reject(erreur) : resolve(String(stdout))
    )
  })
}

/**
 * Catalogue agy : l'entrée « défaut » (le modèle que choisit agy), puis chaque modèle Gemini que
 * `agy models` annonce. Programme absent → rien ; listage en panne → l'entrée « défaut » seule,
 * comme avant ce correctif.
 */
export async function catalogueAgy(
  resoudre: () => string | undefined = resolveAgyBin,
  lister: (bin: string) => Promise<string> = listerAgy
): Promise<ModeleAgy[]> {
  const bin = resoudre()
  if (!bin) return []
  const defaut = modelesAgy(() => bin)
  try {
    return [...defaut, ...lireModelesAgy(await lister(bin))]
  } catch {
    return defaut
  }
}
