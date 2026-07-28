export const RUN_SECTION_DEFINITIONS = [
  { id: 'besoin', title: 'Besoin' },
  { id: 'contraintes', title: 'Contraintes' },
  { id: 'options', title: 'Options' },
  { id: 'sop', title: 'SOP' },
  { id: 'journal', title: 'Journal' },
  { id: 'defauts', title: 'Défauts' },
  { id: 'reprise', title: 'Reprise' }
] as const

export type RunSection = {
  id: (typeof RUN_SECTION_DEFINITIONS)[number]['id']
  title: string
  content: string
  present: boolean
}

/** Extrait les sections métier connues sans rejeter les RUN externes incomplets. */
export function extractRunSections(source: string): RunSection[] {
  const headings = Array.from(source.matchAll(/^##\s+(.+?)\s*$/gm))

  return RUN_SECTION_DEFINITIONS.map(({ id, title }) => {
    const match = headings.find((heading) => {
      const headingTitle = heading[1].trim()
      return headingTitle === title || headingTitle.startsWith(`${title} `)
    })
    if (!match || match.index === undefined) return { id, title, content: '', present: false }

    const nextIndex = headings.find((heading) => heading.index! > match.index!)?.index ?? source.length
    return {
      id,
      title,
      content: source.slice(match.index + match[0].length, nextIndex).trim(),
      present: true
    }
  })
}
