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
