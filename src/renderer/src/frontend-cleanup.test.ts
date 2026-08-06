import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const rendererRoot = join(process.cwd(), 'src', 'renderer', 'src')

function source(relativePath: string): string {
  return readFileSync(join(rendererRoot, relativePath), 'utf8')
}

describe('frontend cleanup guard', () => {
  it('keeps superseded assets out of the renderer sources', () => {
    expect(existsSync(join(rendererRoot, 'assets', 'autowin-galaxy-bg.png'))).toBe(false)
    expect(existsSync(join(rendererRoot, 'assets', 'autowin-logo.png'))).toBe(false)
  })

  it.each([
    ['components/BehaviourView.css', '.behaviour-context-bar'],
    ['components/BehaviourView.css', '.behaviour-reader'],
    ['components/ChatView.css', '.proof-lightbox'],
    ['components/ChatView.css', '.action-name'],
    ['assets/cosmic-outline.css', '.action-event'],
    ['assets/cosmic-outline.css', '.capability-controls'],
    ['components/SourceControlPane.css', '.sc-promptbar'],
    ['components/GraphView.css', '.panel-tabs'],
    ['components/GraphView.css', '.lod-presets'],
    ['components/GraphView.css', '.graph-toolbar__title'],
    ['components/GraphView.css', '.float-tooltip-kap'],
    ['components/TicketsView.css', '.tickets-batch-progress'],
    ['components/ObservatoryView.css', '.observatory-call-sent'],
    ['assets/ui-system.css', '.surface-card'],
    ['assets/cosmic-outline.css', '.behaviour-reader'],
    // Le cockpit d'activite agents `WorktreeView` a ete supprime : l'onglet Worktrees porte
    // desormais le plan git (`WorktreeMapView`). Le selecteur mort est garde ici comme
    // interdiction, contre le fichier qui a herite du sujet.
    ['components/WorktreeMapView.css', '.git-ledger__ref-catalog']
  ])('does not restore stale selector %s → %s', (file, selector) => {
    expect(source(file)).not.toContain(selector)
  })

  it('keeps the superseded agent-activity cockpit out of the renderer', () => {
    // La vue Worktrees a change de SUJET (activite des agents -> copies git). Ses fichiers ne
    // doivent pas revenir : un residu monte par erreur rendrait deux vues concurrentes.
    for (const file of ['WorktreeView.tsx', 'WorktreeView.css', 'GitGraphLayout.ts']) {
      expect(existsSync(join(rendererRoot, 'components', file))).toBe(false)
    }
    expect(source('App.tsx')).toContain("<WorktreeMapView active={tab === 'worktree'} />")
    expect(source('App.tsx')).not.toContain('<WorktreeView ')
  })

  it('mounts a single preflight surface', () => {
    const app = source('App.tsx')
    expect(app).toContain('<FirstRunWizard />')
    expect(app).not.toContain('<PreflightBanner />')
  })

  it('does not remount Worktree when its tab visibility changes', () => {
    expect(source('components/WorktreeMapView.tsx')).not.toContain(
      "key={active ? 'active' : 'inactive'}"
    )
  })

  it('suspends the 3D graph while Knowledge is hidden', () => {
    const graph = source('components/GraphView.tsx')
    expect(graph).toContain('pauseAnimation')
    expect(graph).toContain('resumeAnimation')
  })

  it('suspends Agent Studio event listeners while its tab is hidden', () => {
    // Le nom a change (`RolesView` etait un alias d'une ligne, supprime) ; l'INVARIANT verifie est
    // inchange : `active` doit etre propage pour que l'onglet cache suspende ses ecouteurs.
    expect(source('components/AgentStudioView.tsx')).toContain(
      '<AgentsTopologyView active={active} />'
    )
    expect(source('components/AgentsTopologyView.tsx')).toContain('if (!active) return')
  })
})
