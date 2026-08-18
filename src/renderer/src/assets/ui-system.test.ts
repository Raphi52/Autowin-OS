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

  it('les trois panneaux de Chat portent le liseré, via le token partagé', () => {
    // Demande utilisateur : le lisere sur les trois conteneurs de Chat (rail des conversations,
    // colonne centrale, panneau lateral). Il est pose en COUCHE de fond composee avec le fond propre
    // de chaque panneau — pas en regle complete recopiee, sinon quatre copies derivent.
    // Piege verifie a l'execution : dans le theme actif (`cosmic-outline`), `.conv-pane` recoit un
    // fond APRES la regle groupee, qui l'ecrasait entierement — la couche doit donc y etre remise.
    const theme = readFileSync(new URL('./cosmic-outline.css', import.meta.url), 'utf8')
    const cadre = component('ViewPage.css')

    // Le degrade litteral vit dans `--lisere-degrade` (source unique), `--lisere-haut` le compose en
    // couche de fond. Ce test suivait l'ancien nom : il verifie desormais les deux maillons, sans quoi
    // renommer le token le rendrait vert sans rien garantir.
    expect(cadre).toMatch(/--lisere-degrade:\s*linear-gradient\(/)
    expect(cadre).toMatch(/--lisere-haut:\s*var\(--lisere-degrade\)\s*top \/ 100% 1px no-repeat/)
    for (const bloc of theme.split('}')) {
      const coupe = bloc.lastIndexOf('{')
      if (coupe < 0) continue
      const selecteur = bloc.slice(0, coupe).trim()
      const declarations = bloc.slice(coupe + 1)
      if (!/\.(conv-pane|chat|runs-pane)$/m.test(selecteur)) continue
      // Toute regle qui repose un `background` sur un de ces panneaux doit conserver la couche.
      // `transparent` est exclu : c'est un fond volontairement absent, pas un cadre a decorer.
      if (/background\s*:/.test(declarations) && !/transparent/.test(declarations)) {
        expect(declarations, selecteur).toMatch(/var\(--lisere-haut\)/)
      }
    }
  })

  it('le menu Conversations du Chat finit sur un fond noir opaque', () => {
    const chatCss = component('ChatView.css')
    const rules = [...chatCss.matchAll(/\.cosmic-outline \.conv-pane\s*\{([^}]*)\}/gs)]
    const finalRule = rules.map((rule) => rule[1]).filter((rule) => /background\s*:/.test(rule)).at(-1) ?? ''

    expect(finalRule).toMatch(/background:\s*#000\s*;/)
    expect(finalRule).not.toMatch(/background:\s*rgba\(/)
  })

  it('aucune règle de thème ne réécrit le cadre de page', () => {
    // Defaut vecu : `.theme-serious .observatory-view { background: var(--surface-panel) }` etait
    // PLUS SPECIFIQUE que `.view-page` et remplacait donc le degrade — dont le lisere rose->dore du
    // haut — par un aplat. Le cadre partage etait applique, et pourtant Observatory etait la seule
    // vue sans lisere dans le theme reellement utilise. Les mesures prises ne l'avaient pas vu :
    // elles relevaient position, police et couleur du titre, jamais le FOND.
    // Un theme ajuste des TOKENS (`--surface-panel`, `--container-shadow`) ; il ne redecrit pas le
    // cadre, sinon chaque theme peut defaire l'unification a l'insu de tous.
    const RACINES = [
      'observatory-view',
      'task-manager-view',
      'tickets-view',
      'worktree-tab',
      'domain-shell'
    ]
    const fautes: string[] = []
    for (const feuille of [
      'ObservatoryView.css',
      'TaskManagerView.css',
      'TicketsView.css',
      'WorktreeView.css',
      'DomainShell.css',
      'GraphView.css'
    ]) {
      // Decoupage simple et VERIFIABLE : chaque bloc est « selecteur { declarations } ». Une premiere
      // version par expression reguliere savante ne capturait RIEN — un test vert qui n'assertait
      // rien, le defaut meme qu'on traque ici. Prouve par mutation : reinjecter le `background` fait
      // rougir ce test, le retirer le remet vert.
      for (const bloc of component(feuille).split('}')) {
        const coupe = bloc.lastIndexOf('{')
        if (coupe < 0) continue
        const lignes = bloc.slice(0, coupe).trim().split('\n')
        const selecteur = lignes[lignes.length - 1].trim()
        const declarations = bloc.slice(coupe + 1)
        const racine = RACINES.find((r) => selecteur.endsWith(`.${r}`))
        // Cible la racine QUALIFIEE par un theme ou un etat ; `.racine {` seule reste libre de se
        // decrire, c'est sa propre feuille.
        if (!racine || selecteur === `.${racine}`) continue
        // COMPOSER est permis, REMPLACER non : un theme peut reposer un fond (Observatory doit garder
        // la surface de Models) a condition de conserver la couche `--lisere-haut`. C'est la
        // distinction qui manquait — la premiere version de ce garde-fou interdisait tout `background`
        // et entrait en conflit avec un contrat de palette legitime, teste par ailleurs.
        const fond = /(^|\n)\s*background\s*:([^;]*);/.exec(declarations)
        if (fond && !fond[2].includes('var(--lisere-haut)'))
          fautes.push(`${feuille} — ${selecteur} — fond sans liseré`)
        // Le BORD, lui, appartient au cadre partage : aucun theme n'a de raison de le repeindre.
        if (/(^|\n)\s*border(-color)?\s*:/.test(declarations))
          fautes.push(`${feuille} — ${selecteur} — bord redéfini`)
      }
    }
    expect(fautes).toEqual([])
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

  it('lets the cosmic backdrop show around opaque navigation and translucent containers', () => {
    // Backdrop de shell transparent -> les bords / espaces hors containers montrent le cosmique.
    expect(themeModes).toMatch(/\.theme-serious \.main\s*\{\s*background:\s*transparent;/)
    // Le menu de navigation reste noir opaque : aucun bleu cosmique ne filtre à travers.
    expect(themeModes).toMatch(/\.theme-serious \.rail\s*\{[\s\S]*?background:\s*#000;/)
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
