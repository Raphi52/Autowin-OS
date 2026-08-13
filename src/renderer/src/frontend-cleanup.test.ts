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
    // L'entree `components/WorktreeMapView.css` a ete retiree AVEC son fichier : garder un test qui
    // lit une feuille supprimee ne verifie plus une interdiction, il jette.
    ['components/WorktreeView.css', '.git-ledger__ref-catalog']
  ])('does not restore stale selector %s → %s', (file, selector) => {
    expect(source(file)).not.toContain(selector)
  })

  it('ne monte QU’UNE vue Worktrees — et c’est la frise git', () => {
    // Historique de ce garde-fou, en deux temps. Il a d'abord exige l'INVERSE (que `WorktreeView`
    // n'existe PAS et que `App.tsx` monte `WorktreeMapView`), et il rougissait a chaque run depuis que
    // l'utilisateur avait redemande la frise. Corrige, il interdisait ensuite de monter la carte EN
    // PLUS de la frise, la carte restant dans le depot sans etre branchee.
    //
    // La carte est desormais SUPPRIMEE (decision utilisateur du 2026-08-13) : elle n'avait aucun
    // consommateur, deux gardes-fous la surveillaient pour rien, et deux tours de travail ont ete
    // depenses a aligner une vue que l'app ne montait pas. Ne reste donc a garantir qu'une chose :
    // l'onglet monte la frise, et aucun fichier ne ressuscite la carte sans qu'on le voie ici.
    expect(source('App.tsx')).toContain("<WorktreeView active={tab === 'worktree'} />")
    expect(existsSync(join(rendererRoot, 'components', 'WorktreeView.tsx'))).toBe(true)
    expect(existsSync(join(rendererRoot, 'components', 'WorktreeMapView.tsx'))).toBe(false)
  })

  it('mounts a single preflight surface', () => {
    const app = source('App.tsx')
    expect(app).toContain('<FirstRunWizard />')
    expect(app).not.toContain('<PreflightBanner />')
  })

  it('does not remount Worktree when its tab visibility changes', () => {
    // Surveille la vue REELLEMENT montee. Il visait `WorktreeMapView`, qui n'est plus branchee : un
    // garde-fou pointe sur du code mort passe toujours, et ne protege plus rien.
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
    // Le nom a change (`RolesView` etait un alias d'une ligne, supprime) ; l'INVARIANT verifie est
    // inchange : `active` doit etre propage pour que l'onglet cache suspende ses ecouteurs.
    expect(source('components/AgentStudioView.tsx')).toContain(
      '<AgentsTopologyView active={active} />'
    )
    expect(source('components/AgentsTopologyView.tsx')).toContain('if (!active) return')
  })
})
