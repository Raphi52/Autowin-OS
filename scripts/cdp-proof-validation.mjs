export function assertModelCatalogProof({ labels }) {
  if (!Array.isArray(labels) || labels.length === 0) {
    throw new Error('Preuve CDP invalide : catalogue de modèles vide')
  }
}

export function assertFrameBlockProof({ frame }) {
  if (!frame) throw new Error('Preuve CDP invalide : bloc Frame absent')
  if (!Number.isInteger(frame.slots) || frame.slots <= 0) {
    throw new Error('Preuve CDP invalide : bloc Frame sans slot')
  }
}

export function assertTerrainPanelProof({ panels }) {
  const expectedOrder = ['scout', 'frame', 'terrain', 'judge']
  const composed = Array.isArray(panels)
    ? panels.filter((panel) => expectedOrder.includes(panel.target))
    : []
  const actualOrder = composed.map((panel) => panel.target)
  if (actualOrder.join(',') !== expectedOrder.join(',')) {
    throw new Error(
      `Preuve CDP invalide : ordre des panels ${actualOrder.join(' → ') || 'absent'} au lieu de ${expectedOrder.join(' → ')}`
    )
  }
  const terrain = composed.find((panel) => panel.target === 'terrain')
  if (!terrain || !Number.isInteger(terrain.slots) || terrain.slots <= 0) {
    throw new Error('Preuve CDP invalide : bloc Terrain sans slot')
  }
}

export function assertHooksProof({ selectedTab, selectedSource, hookCount }) {
  if (!selectedTab?.startsWith('Hooks') || selectedSource !== 'Codex') {
    throw new Error(
      `Preuve CDP invalide : état Hooks inattendu (${JSON.stringify({
        selectedTab,
        selectedSource
      })})`
    )
  }
  if (!Number.isInteger(hookCount) || hookCount <= 0) {
    throw new Error('Preuve CDP invalide : aucun hook Codex visible')
  }
}

export function assertWorkflowRequestGraphProof(state) {
  if (state.graphTurnId !== state.expectedTurnId) {
    throw new Error(
      `Preuve CDP invalide : mauvais tour (${state.graphTurnId ?? 'absent'} au lieu de ${state.expectedTurnId ?? 'absent'})`
    )
  }
  if (state.requestRootCount !== 1) {
    throw new Error('Preuve CDP invalide : racine Demande utilisateur absente ou dupliquée')
  }
  if (state.previousTurnLeaks !== 0) {
    throw new Error('Preuve CDP invalide : le tour précédent fuit dans le graphe')
  }
  if (!Number.isInteger(state.identityCount) || state.identityCount < 1) {
    throw new Error('Preuve CDP invalide : aucun agent avec provider et modèle visibles')
  }
  if (!Number.isInteger(state.edgeCount) || state.edgeCount < 1) {
    throw new Error('Preuve CDP invalide : aucune arête causale visible')
  }
  if (!state.detailVisible || !state.keyboardNodeId || !state.keyboardSelected) {
    throw new Error('Preuve CDP invalide : sélection clavier ou détail de nœud absent')
  }
  if (state.overflow || !state.paneVisible || !state.narrowWidth || state.whiteBorder) {
    throw new Error(`Preuve CDP invalide : géométrie du panneau (${JSON.stringify(state)})`)
  }
  if (state.wizardVisible)
    throw new Error('Preuve CDP invalide : assistant de démarrage encore visible')
  if (state.error) throw new Error(`Preuve CDP invalide : ${state.error}`)
}
