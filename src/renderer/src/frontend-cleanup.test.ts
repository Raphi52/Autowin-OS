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
    ['components/WorktreeView.css', '.git-ledger__ref-catalog']
  ])('does not restore stale selector %s → %s', (file, selector) => {
    expect(source(file)).not.toContain(selector)
  })

  it('mounts a single preflight surface', () => {
    const app = source('App.tsx')
    expect(app).toContain('<FirstRunWizard />')
    expect(app).not.toContain('<PreflightBanner />')
  })

  it('does not remount Worktree when its tab visibility changes', () => {
    expect(source('components/WorktreeView.tsx')).not.toContain(
      "key={active ? 'active' : 'inactive'}"
    )
  })

  it('suspends the 3D graph while Knowledge is hidden', () => {
    const graph = source('components/GraphView.tsx')
    expect(graph).toContain('pauseAnimation')
    expect(graph).toContain('resumeAnimation')
  })

  it('suspends Agent Studio event listeners while its tab is hidden', () => {
    expect(source('components/AgentStudioView.tsx')).toContain('<RolesView active={active} />')
    expect(source('components/AgentsTopologyView.tsx')).toContain('if (!active) return')
  })
})
