import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Autowin UI contract', () => {
  const css = readFileSync(new URL('./ui-system.css', import.meta.url), 'utf8')
  const themeModes = readFileSync(new URL('./theme-modes.css', import.meta.url), 'utf8')
  const cosmicOutline = readFileSync(new URL('./cosmic-outline.css', import.meta.url), 'utf8')
  const component = (name: string): string =>
    readFileSync(new URL(`../components/${name}`, import.meta.url), 'utf8')

  it('defines only reusable color and container primitives', () => {
    for (const token of [
      '--surface-page',
      '--surface-panel',
      '--surface-card',
      '--surface-inset',
      '--container-border',
      '--container-radius-page',
      '--container-radius-panel',
      '--container-shadow'
    ]) {
      expect(css).toContain(token)
    }
    expect(css).not.toMatch(/\.(graph|observatory|topology|cockpit|behaviour|chat|conv|runs)-/)
    expect(css).not.toMatch(/\b!important\b/)
    expect(css).not.toMatch(/^\s*(grid-template|width|height|overflow|position)\s*:/m)
  })

  const VUES = [
    ['AgentStudioView.tsx', 'domain-shell'],
    ['KnowledgeView.tsx', 'domain-shell'],
    ['SettingsView.tsx', 'domain-shell'],
    ['ObservatoryView.tsx', 'observatory-view'],
    ['TaskManagerView.tsx', 'task-manager-view'],
    ['TicketsView.tsx', 'tickets-view'],
    ['WorktreeView.tsx', 'worktree-tab']
  ] as const

  it.each(VUES)('%s pose son titre dans LE cadre de page partagé', (fichier, racine) => {
    // Chaque vue decrivait son propre cadre : Task Manager et Tickets a `16px 18px`, Observatory a
    // `5px 28px`, Worktrees sans padding, et trois vues sans cadre du tout — donc un titre de page
    // jamais a la meme distance des bords selon l'onglet. `.view-page` est desormais la seule
    // description de ce cadre, et ce test refuse qu'une vue reparte en solo.
    const tsx = component(fichier)
    expect(tsx).toContain(`className="view-page ${racine}`)
    expect(tsx).toContain("import './ViewPage.css'")
  })

  it('aucune vue ne redéfinit la police du titre ni la couleur du surtitre', () => {
    // Deux divergences vues a l'oeil : Observatory imposait sa propre famille de police au titre, et
    // Task Manager comme Tickets peignaient leur surtitre en `--gold` — un titre de page jaune dans
    // deux onglets sur sept. Les tokens `--module-title-font` / `--module-eyebrow-color` existent
    // precisement pour que ce choix soit fait UNE fois.
    for (const feuille of [
      'ObservatoryView.css',
      'TaskManagerView.css',
      'TicketsView.css',
      'WorktreeView.css',
      'DomainShell.css'
    ]) {
      const contenu = component(feuille)
      expect(contenu).not.toMatch(/\.module-header\s*>?\s*h1\s*\{[^}]*font-family/)
      expect(contenu).not.toMatch(/\.module-header\s*>?\s*span\s*\{[^}]*color/)
    }
  })

  it('uses ModuleHeader in every active product view', () => {
    for (const file of [
      'ChatView.tsx',
      'GraphView.tsx',
      'ObservatoryView.tsx',
      'AgentsTopologyView.tsx',
      'CapabilitiesView.tsx',
      'BehaviourView.tsx'
    ]) {
      expect(component(file), file).toContain("import { ModuleHeader } from './ModuleHeader'")
      expect(component(file), file).toContain('<ModuleHeader')
    }
  })

  it('lets the cosmic backdrop show: transparent shell edges, ~95% translucent containers', () => {
    // Backdrop de shell transparent -> les bords / espaces hors containers montrent le cosmique.
    expect(themeModes).toMatch(/\.theme-serious \.main\s*\{\s*background:\s*transparent;/)
    // Rail = container "fenetre" a 95% d'opacite.
    expect(themeModes).toMatch(
      /\.theme-serious \.rail\s*\{[\s\S]*?background:\s*rgba\(0, 0, 0, 0\.95\);/
    )
    // Surfaces partagees translucides (alpha 0.95) et toujours routees via tokens semantiques.
    expect(css).toMatch(/--surface-panel:\s*rgba\([^)]*0\.95\)/)
    expect(css).toMatch(/--surface-card:\s*rgba\([^)]*0\.95\)/)
    for (const token of [
      'var(--surface-page)',
      'var(--surface-panel)',
      'var(--surface-card)',
      'var(--surface-inset)'
    ]) {
      expect(cosmicOutline).toContain(token)
    }
  })

  it('centralizes module title typography without view-level overrides', () => {
    for (const token of [
      '--module-title-font: var(--display)',
      '--module-title-color: var(--text)',
      '--module-title-size: 22px',
      '--module-eyebrow-color: var(--text-faint)',
      '--module-eyebrow-size: 9px'
    ]) {
      expect(css).toContain(token)
    }

    const forbiddenOverrides: Array<[string, RegExp]> = [
      ['ObservatoryView.css', /\.observatory-head > div:first-child > span|\.observatory-head h1/],
      ['CapabilitiesView.css', /\.cockpit-header > div:first-child > span|\.cockpit-header h1/],
      ['BehaviourView.css', /\.behaviour-view > header span|\.behaviour-view h1/],
      ['AgentsTopologyView.css', /\.topology-toolbar span/]
    ]

    for (const [file, selector] of forbiddenOverrides) {
      expect(component(file), file).not.toMatch(selector)
    }
  })
})
