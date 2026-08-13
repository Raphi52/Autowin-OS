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

  it('ne monte QU’UNE vue Worktrees — et c’est la frise git', () => {
    // Ce garde-fou exigeait l'INVERSE : que `WorktreeView.tsx/.css` et `GitGraphLayout.ts` n'existent
    // pas, et que `App.tsx` monte `WorktreeMapView`. Il datait du moment ou l'onglet Worktrees avait
    // change de sujet (activite des agents -> plan des copies git). L'utilisateur a ensuite demande le
    // RETOUR de la frise d'historique : `WorktreeView` a ete restauree et remontee, donc ce test
    // rougissait a chaque run en defendant une decision renversee. Un garde que plus personne ne croit
    // est pire qu'un garde absent — il devient du bruit qu'on apprend a ignorer.
    //
    // L'INTENTION est conservee telle quelle : pas DEUX vues Worktrees concurrentes montees en meme
    // temps. Seuls les roles sont inverses, conformement a l'etat reellement voulu.
    expect(source('App.tsx')).toContain("<WorktreeView active={tab === 'worktree'} />")
    expect(source('App.tsx')).not.toContain('<WorktreeMapView ')
    // `WorktreeMapView` RESTE dans le depot sans etre montee : elle chiffre le retard, la salete et la
    // taille disque des copies, ce que la frise ne dit pas. Sa presence en fichier n'est donc pas une
    // faute — la monter en plus de la frise en serait une, et c'est ce qu'interdit la ligne au-dessus.
    expect(existsSync(join(rendererRoot, 'components', 'WorktreeView.tsx'))).toBe(true)
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
