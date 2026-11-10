import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportedModel } from '../modeles/models'
import { amorcerReglageDeDepart } from './reglage-de-depart'
import type { Role, RoleBinding } from './roles'

const claude = (model: string, efforts: ImportedModel['reasoningEfforts']): ImportedModel => ({
  id: `claude/${model}`,
  provider: 'claude',
  model,
  label: model,
  reasoningEfforts: efforts,
  defaultReasoningEffort: efforts[0]
})
const CATALOGUE = [
  claude('claude-fable-5-2', ['high', 'medium', 'max']),
  claude('claude-haiku-5-5', ['medium', 'low', 'max'])
]
const roles = {} as Record<Role, RoleBinding>

let dossier: string
let chemin: string
beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'reglage-depart-'))
  chemin = join(dossier, 'agent-topology.json')
})
afterEach(() => rmSync(dossier, { recursive: true, force: true }))

const amorcer = (
  models: ImportedModel[],
  petitesTachesDejaReglees = false
): { poser: ReturnType<typeof vi.fn>; rendu: ReturnType<typeof amorcerReglageDeDepart> } => {
  const poser = vi.fn()
  const rendu = amorcerReglageDeDepart({
    cheminTopologie: chemin,
    models,
    roles,
    petitesTachesDejaReglees,
    poserPetitesTaches: poser
  })
  return { poser, rendu }
}

describe('réglage de départ d’un poste neuf', () => {
  it('poste neuf : écrit le profil « Défaut » et règle les petites tâches', () => {
    const { poser, rendu } = amorcer(CATALOGUE)
    const ecrit = JSON.parse(readFileSync(chemin, 'utf8'))
    expect(ecrit.orchestrator).toMatchObject({
      modelId: 'claude/claude-fable-5-2',
      reasoningEffort: 'medium'
    })
    expect(ecrit.subagents).toHaveLength(1)
    expect(ecrit.subagents[0]).toMatchObject({
      modelId: 'claude/claude-haiku-5-5',
      reasoningEffort: 'max'
    })
    expect(rendu).toEqual(ecrit)
    expect(poser).toHaveBeenCalledWith({
      provider: 'claude',
      model: 'claude-haiku-5-5',
      reasoningEffort: 'max'
    })
  })

  it('poste déjà réglé : le fichier existant n’est pas réécrit, rien n’est posé', () => {
    writeFileSync(chemin, '{"mon":"reglage"}', 'utf8')
    const { poser, rendu } = amorcer(CATALOGUE)
    expect(rendu).toBeNull()
    expect(readFileSync(chemin, 'utf8')).toBe('{"mon":"reglage"}')
    expect(poser).not.toHaveBeenCalled()
  })

  it('une fois amorcé, un second passage ne touche plus à rien', () => {
    amorcer(CATALOGUE)
    const avant = readFileSync(chemin, 'utf8')
    const { poser, rendu } = amorcer(CATALOGUE)
    expect(rendu).toBeNull()
    expect(poser).not.toHaveBeenCalled()
    expect(readFileSync(chemin, 'utf8')).toBe(avant)
  })

  it('petites tâches déjà choisies sur le poste : gardées, seule la topologie est écrite', () => {
    const { poser, rendu } = amorcer(CATALOGUE, true)
    expect(rendu).not.toBeNull()
    expect(poser).not.toHaveBeenCalled()
  })

  it('catalogue sans les modèles voulus : rien n’est écrit, le passage suivant réessaiera', () => {
    const codex: ImportedModel = {
      ...claude('gpt', ['medium']),
      id: 'codex/gpt',
      provider: 'codex'
    }
    const { poser, rendu } = amorcer([codex])
    expect(rendu).toBeNull()
    expect(existsSync(chemin)).toBe(false)
    expect(poser).not.toHaveBeenCalled()
  })

  it('chemin occupé par autre chose qu’un fichier absent : jamais écrasé', () => {
    mkdirSync(chemin)
    const { poser, rendu } = amorcer(CATALOGUE)
    expect(rendu).toBeNull()
    expect(poser).not.toHaveBeenCalled()
  })
})
