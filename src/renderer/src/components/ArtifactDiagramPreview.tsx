import { useEffect, useId, useMemo, useState } from 'react'

function adaptDiagramSource(source: string): string {
  if (
    /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie)\b/m.test(
      source
    )
  )
    return source
  if (/^\s*(?:di)?graph\b/i.test(source)) {
    const edges = [...source.matchAll(/"?([\w.-]+)"?\s*(->|--)\s*"?([\w.-]+)"?/g)]
    if (edges.length)
      return `flowchart LR\n${edges.map((match) => `  ${match[1]} --> ${match[3]}`).join('\n')}`
  }
  if (/@startuml/i.test(source)) {
    const edges = [...source.matchAll(/^\s*([\w.-]+)\s*(?:->|-->)\s*([\w.-]+)\s*:?\s*(.*)$/gm)]
    if (edges.length)
      return `sequenceDiagram\n${edges
        .map((match) => `  ${match[1]}->>${match[2]}: ${match[3] || ' '}`)
        .join('\n')}`
  }
  return source
}

export function ArtifactDiagramPreview({ source }: { source: string }): React.JSX.Element {
  const reactId = useId()
  const id = useMemo(() => `artifact-diagram-${reactId.replaceAll(':', '')}`, [reactId])
  const [rendered, setRendered] = useState<{
    source: string
    svg?: string
    error?: string
  }>()

  useEffect(() => {
    let active = true
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'dark',
          suppressErrorRendering: true,
          maxTextSize: 80_000
        })
        const result = await mermaid.render(id, adaptDiagramSource(source))
        if (active) setRendered({ source, svg: result.svg })
      })
      .catch(() => {
        if (active)
          setRendered({
            source,
            error: 'Diagramme invalide ou syntaxe non prise en charge'
          })
      })
    return () => {
      active = false
      document.getElementById(`d${id}`)?.remove()
    }
  }, [id, source])

  const current = rendered?.source === source ? rendered : undefined
  const error = current?.error
  const svg = current?.svg
  if (error)
    return (
      <div>
        <div className="artifact-preview__blocked">{error}</div>
        <pre className="artifact-preview__source is-diagram">{source}</pre>
      </div>
    )
  if (!svg)
    return (
      <div className="artifact-preview__placeholder" role="status">
        Rendu du diagramme…
      </div>
    )
  return (
    <div
      className="artifact-diagram"
      data-diagram-security="strict"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
