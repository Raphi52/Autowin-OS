import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTextesArtefactsEtBandeaux } from '../textes-ecrans/artefacts-et-bandeaux'
import { creerZoneDeDessinHorsPage } from './zone-dessin-diagramme'
import { configMermaidDuDocument, teindreSankey } from './theme-mermaid'

/**
 * Le thème appliqué au document (`data-theme` + `data-base` sur la racine, posés par
 * `appliquerThemeMode`). Change quand l'utilisateur change de thème : les schémas déjà affichés
 * sont alors redessinés dans les nouvelles couleurs au lieu de garder l'ancienne palette.
 */
function lireCleDuTheme(): string {
  const racine = globalThis.document?.documentElement
  return `${racine?.getAttribute('data-theme') ?? ''}|${racine?.getAttribute('data-base') ?? ''}`
}

function useCleDuTheme(): string {
  const [cle, setCle] = useState(lireCleDuTheme)
  useEffect(() => {
    const racine = globalThis.document?.documentElement
    if (!racine || typeof MutationObserver === 'undefined') return
    const observateur = new MutationObserver(() => setCle(lireCleDuTheme()))
    observateur.observe(racine, { attributes: true, attributeFilter: ['data-theme', 'data-base'] })
    return () => observateur.disconnect()
  }, [])
  return cle
}

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
  const { t } = useTextesArtefactsEtBandeaux()
  const reactId = useId()
  const id = useMemo(() => `artifact-diagram-${reactId.replaceAll(':', '')}`, [reactId])
  /** La place réelle du diagramme dans le fil : sa largeur devient celle de la zone de dessin. */
  const placeRef = useRef<HTMLDivElement | null>(null)
  const [rendered, setRendered] = useState<{
    source: string
    svg?: string
    /** Dessin refusé par mermaid : le message est traduit au rendu (conv-1170). */
    error?: true
  }>()

  const cleDuTheme = useCleDuTheme()
  /** Numéro du dessin : chaque dessin a SON identifiant (voir plus bas). */
  const dessinsRef = useRef(0)

  useEffect(() => {
    let active = true
    // Créée ICI, une par dessin, et retirée quand CE dessin est fini — même s'il a été abandonné
    // entre-temps (fil quitté, double montage du mode strict) : mermaid termine toujours ses dessins
    // dans l'ordre, et un dessin privé de sa zone mesurerait un texte de largeur nulle.
    const zone = creerZoneDeDessinHorsPage(placeRef.current?.clientWidth ?? 0)
    // Un identifiant NEUF par dessin : `mermaid.render` commence par retirer du document tout
    // élément qui porte déjà son identifiant — donc le schéma affiché. Avec le même identifiant, un
    // redessin au changement de thème effaçait le schéma le temps du rendu (conv-1235).
    dessinsRef.current += 1
    const idDuDessin = `${id}-${dessinsRef.current}`
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        const theme = configMermaidDuDocument()
        mermaid.initialize({
          startOnLoad: false,
          // Couleurs, police et traits du thème de l'app ; hors page stylée, le sombre de mermaid.
          ...(theme ?? { theme: 'dark' }),
          securityLevel: 'strict',
          suppressErrorRendering: true,
          maxTextSize: 80_000
        })
        const result = await mermaid.render(idDuDessin, adaptDiagramSource(source), zone)
        // Le sankey a une palette figée que le thème n'atteint pas : elle est repeinte ici.
        if (active) setRendered({ source, svg: teindreSankey(result.svg, theme) })
      })
      .catch(() => {
        if (active) setRendered({ source, error: true })
      })
      .finally(() => zone.remove())
    return () => {
      active = false
    }
  }, [id, source, cleDuTheme])

  const current = rendered?.source === source ? rendered : undefined
  const error = current?.error
  const svg = current?.svg
  if (error)
    return (
      <div ref={placeRef}>
        <div className="artifact-preview__blocked">{t('diagramme.invalide')}</div>
        <pre className="artifact-preview__source is-diagram">{source}</pre>
      </div>
    )
  if (!svg)
    return (
      <div ref={placeRef} className="artifact-preview__placeholder" role="status">
        {t('diagramme.rendu')}
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
