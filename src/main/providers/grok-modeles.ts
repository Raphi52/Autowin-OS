/**
 * Modèles Grok proposés par le CLI d'xAI (2026-11-04) : l'onglet Grok du choix de
 * modèle n'offrait que l'entrée « défaut » (`modelesGrok` dans grok.ts), alors que
 * `grok models` annonce les modèles du compte SuperGrok. Même forme que agy-modeles.ts.
 */
import { execFile } from 'node:child_process'
import { GROK_PROVIDER_ID, modelesGrok, resolveGrokBin } from './grok'

export type ModeleGrok = ReturnType<typeof modelesGrok>[number]

/**
 * Lit la sortie de `grok models` (mesuré, Grok Build 1.0.70, 2026-11-04) :
 * « Available models: » puis une ligne `  * grok-4.7 (default)` par modèle.
 */
export function lireModelesGrok(sortie: string): ModeleGrok[] {
  const vus = new Set<string>()
  return sortie.split(/\r?\n/).flatMap((ligne) => {
    const m = /^\s*\*\s+(grok-[a-z0-9][a-z0-9.-]*)/i.exec(ligne)
    if (!m || vus.has(m[1])) return []
    vus.add(m[1])
    return [
      {
        id: `${GROK_PROVIDER_ID}/${m[1]}`,
        provider: GROK_PROVIDER_ID,
        model: m[1],
        label: m[1].replace(/^grok-/i, 'Grok '),
        reasoningEfforts: ['none' as const],
        defaultReasoningEffort: 'none' as const,
        dynamicallyLoaded: true
      }
    ]
  })
}

/** `grok models` — abandonné au-delà de 15 s. */
function listerGrok(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['models'], { timeout: 15_000, windowsHide: true }, (erreur, stdout) =>
      erreur ? reject(erreur) : resolve(String(stdout))
    )
  })
}

/** Programme absent → rien ; listage en panne → l'entrée « défaut » seule. */
export async function catalogueGrok(
  resoudre: () => string | undefined = resolveGrokBin,
  lister: (bin: string) => Promise<string> = listerGrok
): Promise<ModeleGrok[]> {
  const bin = resoudre()
  if (!bin) return []
  const defaut = modelesGrok(() => bin)
  try {
    return [...defaut, ...lireModelesGrok(await lister(bin))]
  } catch {
    return defaut
  }
}
