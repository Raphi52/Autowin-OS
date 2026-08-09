import { useEffect, useState } from 'react'
import { WorkflowCanvas, type CanvasGraph, type Phase } from './WorkflowCanvas'

/**
 * Le canevas, relié au moteur.
 *
 * Ce composant existe pour une seule raison : la validité d'un graphe est décidée CÔTÉ MAIN, par le
 * même code que celui qui l'exécute. Faire juger le canevas par ses propres règles produirait deux
 * vérités qui divergeraient — et un graphe accepté à l'écran mais refusé au lancement.
 *
 * Conséquence assumée : on n'enregistre jamais un graphe défectueux. Le bouton reste inactif et dit
 * pourquoi, plutôt que de laisser croire que c'est enregistré.
 */

interface ProfileLike {
  id: string
  phases?: string[]
  graph?: CanvasGraph
}

interface Verdict {
  defects: { target?: string; message: string }[]
  worstCaseNodeExecutions: number | null
}

/** Le graphe de départ : celui du profil, sinon la chaîne équivalente à ses phases. */
function initialGraph(profile: ProfileLike): CanvasGraph {
  if (profile.graph?.nodes?.length) return profile.graph
  const phases = (profile.phases ?? []) as Phase[]
  // MÊME règle de nommage que `graphFromPhases` côté main : des ids différents feraient d'un profil
  // ouvert ici un autre graphe que celui qui s'exécute.
  const vus = new Map<string, number>()
  const nodes = phases.map((phase) => {
    const rang = (vus.get(phase) ?? 0) + 1
    vus.set(phase, rang)
    return { id: `${phase}-${rang}`, phase }
  })
  return {
    entry: nodes[0]?.id ?? '',
    nodes,
    edges: nodes
      .slice(0, -1)
      .map((n, i) => ({ from: n.id, to: nodes[i + 1].id, when: 'always' as const }))
  }
}

export function WorkflowGraphEditor({
  profile,
  onSave
}: {
  profile: ProfileLike
  onSave: (graph: CanvasGraph) => void
}): React.JSX.Element {
  const [graph, setGraph] = useState<CanvasGraph>(() => initialGraph(profile))
  const [verdict, setVerdict] = useState<Verdict>()
  const [enregistre, setEnregistre] = useState(true)
  // MÊME source que la liste d'Agent Studio : deux catalogues divergeraient, et on composerait ici
  // un modèle que le runtime ne connaît pas.
  const [models, setModels] = useState<{ provider: string; id: string }[]>([])

  useEffect(() => {
    void (async () => {
      try {
        const bruts = (await window.api.models?.()) as
          { provider?: string; id?: string }[] | undefined
        setModels(
          (bruts ?? [])
            .filter((m): m is { provider: string; id: string } => !!m?.id)
            .map((m) => ({ provider: m.provider ?? '', id: m.id }))
        )
      } catch {
        // Catalogue injoignable : on retombe sur « modèle par défaut », jamais sur une liste inventée.
        setModels([])
      }
    })()
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(() => window.api.checkWorkflowGraph?.(graph))
      .then((resultat) => {
        if (!cancelled && resultat) setVerdict(resultat as Verdict)
      })
      .catch(() => {
        if (cancelled) return
        // Une vérification injoignable bloque l'enregistrement sans écraser un graphe plus récent.
        setVerdict({
          defects: [{ message: 'Vérification indisponible.' }],
          worstCaseNodeExecutions: null
        })
      })
    return () => {
      cancelled = true
    }
  }, [graph])

  const modifier = (suivant: CanvasGraph): void => {
    setGraph(suivant)
    setEnregistre(false)
  }

  const bloquant = verdict?.defects.length ?? 0
  const vide = graph.nodes.length === 0

  return (
    <div className="workflow-graph-editor" data-testid="workflow-graph-editor">
      <WorkflowCanvas
        graph={graph}
        onChange={modifier}
        defects={verdict?.defects}
        models={models}
        worstCase={verdict?.worstCaseNodeExecutions ?? null}
      />
      <div className="workflow-graph-actions">
        <button
          type="button"
          data-testid="workflow-graph-save"
          disabled={bloquant > 0 || vide || enregistre}
          onClick={() => {
            onSave(graph)
            setEnregistre(true)
          }}
        >
          {enregistre ? 'Enregistré' : 'Enregistrer le workflow'}
        </button>
        {bloquant > 0 && (
          <span className="workflow-graph-hint" data-testid="workflow-graph-blocked">
            {bloquant} point(s) à corriger avant d’enregistrer.
          </span>
        )}
        {/* Le pire cas est la seule mesure qui dise ce que ce graphe peut COÛTER au maximum. */}
        {bloquant === 0 && verdict?.worstCaseNodeExecutions !== null && verdict && (
          <span className="workflow-graph-hint" data-testid="workflow-graph-worstcase">
            au plus {verdict.worstCaseNodeExecutions} exécution(s) de phase
          </span>
        )}
      </div>
    </div>
  )
}
