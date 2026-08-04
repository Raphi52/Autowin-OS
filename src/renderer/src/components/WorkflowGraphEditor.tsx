import { useCallback, useEffect, useState } from 'react'
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
  inertReturns: { from: string; to: string }[]
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
    edges: nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1].id, when: 'always' as const }))
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

  const verifier = useCallback(async (candidat: CanvasGraph) => {
    try {
      const resultat = (await window.api.checkWorkflowGraph?.(candidat)) as Verdict | undefined
      if (resultat) setVerdict(resultat)
    } catch {
      // Une vérification injoignable ne doit pas bloquer la composition ; elle bloque l'enregistrement.
      setVerdict({ defects: [{ message: 'Vérification indisponible.' }], inertReturns: [], worstCaseNodeExecutions: null })
    }
  }, [])

  useEffect(() => {
    void verifier(graph)
  }, [graph, verifier])

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
        inertReturns={verdict?.inertReturns}
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
