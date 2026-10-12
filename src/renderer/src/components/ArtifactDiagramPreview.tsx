import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { creerZoneDeDessinHorsPage } from './zone-dessin-diagramme'

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
  /** La place réelle du diagramme dans le fil : sa largeur devient celle de la zone de dessin. */
  const placeRef = useRef<HTMLDivElement | null>(null)
  const [rendered, setRendered] = useState<{
    source: string
    svg?: string
    error?: string
  }>()

  useEffect(() => {
    let active = true
    // Créée ICI, une par dessin, et retirée quand CE dessin est fini — même s'il a été abandonné
    // entre-temps (fil quitté, double montage du mode strict) : mermaid termine toujours ses dessins
    // dans l'ordre, et un dessin privé de sa zone mesurerait un texte de largeur nulle.
    const zone = creerZoneDeDessinHorsPage(placeRef.current?.clientWidth ?? 0)
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'dark',
          suppressErrorRendering: true,
          maxTextSize: 80_000
        })
        const result = await mermaid.render(id, adaptDiagramSource(source), zone)
        if (active) setRendered({ source, svg: result.svg })
      })
      .catch(() => {
        if (active)
          setRendered({
            source,
            error: 'Diagramme invalide ou syntaxe non prise en charge'
          })
      })
      .finally(() => zone.remove())
    return () => {
      active = false
    }
  }, [id, source])

  const current = rendered?.source === source ? rendered : undefined
  const error = current?.error
  const svg = current?.svg
  if (error)
    return (
      <div ref={placeRef}>
        <div className="artifact-preview__blocked">{error}</div>
        <pre className="artifact-preview__source is-diagram">{source}</pre>
      </div>
    )
  if (!svg)
    return (
      <div ref={placeRef} className="artifact-preview__placeholder" role="status">
        Rendu du diagramme…
      </div>
    )
  return (
    <div
      ref={placeRef}
      className="artifact-diagram"
      data-diagram-security="strict"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
