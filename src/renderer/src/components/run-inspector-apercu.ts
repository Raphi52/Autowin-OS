/**
 * APERÇU D'UN RUN — ce qu'on doit savoir AVANT de lire le RUN.md.
 *
 * Le détail d'un run ouvrait directement le markdown brut : pour savoir ce que le run avait fait
 * et où il en était, il fallait le lire en entier dans une colonne étroite. On extrait donc du
 * MÊME fichier les quatre réponses attendues au premier regard : le besoin, ce qui reste à cocher,
 * les défauts, les fichiers touchés. Aucune donnée inventée — tout vient du contenu.
 */
export type ApercuRun = {
  besoin: string
  dodRestants: string[]
  defauts: string[]
  fichiers: string[]
}

/** Corps d'une section `## Nom`, jusqu'au prochain titre de niveau 2. */
export function sectionBody(content: string, section: string): string {
  const debut = new RegExp(`^## ${section}(?:\s.*)?$`, 'm').exec(content)
  if (!debut) return ''
  const reste = content.slice(debut.index + debut[0].length)
  const fin = /^## /m.exec(reste)
  return (fin ? reste.slice(0, fin.index) : reste).trim()
}

const CASE_NON_COCHEE = /^\s*[-*]\s*\[ \]\s*(.+)$/
const PUCE = /^\s*[-*]\s+(.+)$/
/** Chemins de dépôt : au moins un `/` et une extension, ou un nom de fichier à extension connue. */
const CHEMIN = /(?:[\w.@-]+\/)+[\w.@-]+\.[a-z]{2,4}\b|\b[\w.-]+\.(?:tsx?|css|md|json|py|mts)\b/gi

function lignes(bloc: string): string[] {
  return bloc
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export function apercuDuRun(content: string): ApercuRun {
  const besoinBloc = sectionBody(content, 'Besoin')
  const besoin =
    lignes(besoinBloc)
      .map((l) => l.replace(CASE_NON_COCHEE, '$1').replace(PUCE, '$1'))
      .find((l) => !/^Critère de succ/i.test(l)) ?? ''

  const dodRestants = lignes(content)
    .map((l) => CASE_NON_COCHEE.exec(l)?.[1]?.trim())
    .filter((l): l is string => Boolean(l))

  const defauts = lignes(sectionBody(content, 'Défauts'))
    .map((l) => PUCE.exec(l)?.[1]?.trim() ?? l)
    .filter((l) => !/^(aucun|néant|rien)\b/i.test(l))

  const fichiers = [...new Set((content.match(CHEMIN) ?? []).map((f) => f.trim()))].filter(
    (f) => !/^RUN\.md$/i.test(f)
  )

  return { besoin, dodRestants, defauts, fichiers }
}
