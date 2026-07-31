export interface NamedRuntimeModel {
  id: string
  provider: string
  model: string
  label?: string
}

const modelNameCollator = new Intl.Collator('fr', {
  numeric: true,
  sensitivity: 'base'
})

export function displayedModelName(model: NamedRuntimeModel): string {
  return model.label ?? model.model
}

export function compareModelsByName(
  left: NamedRuntimeModel,
  right: NamedRuntimeModel
): number {
  return (
    modelNameCollator.compare(displayedModelName(left), displayedModelName(right)) ||
    modelNameCollator.compare(left.provider, right.provider) ||
    modelNameCollator.compare(left.id, right.id)
  )
}
