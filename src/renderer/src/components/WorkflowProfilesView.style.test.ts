import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Toutes les feuilles de style sous une racine, en descendant. */
const fichiersCss = (racine: URL | string): string[] => {
  const base = typeof racine === 'string' ? racine : fileURLToPath(racine)
  return readdirSync(base, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(base, entree.name)
    if (entree.isDirectory()) return fichiersCss(chemin)
    return entree.name.endsWith('.css') ? [chemin] : []
  })
}

const lire = (nom: string): string => readFileSync(new URL(`./${nom}`, import.meta.url), 'utf8')

const corpsDeRegle = (nom: string, selecteur: string): string | undefined => {
  const echappe = selecteur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return lire(nom).match(new RegExp(`${echappe}\\s*{([^}]*)}`, 's'))?.[1]
}

/**
 * Gardes nées de défauts RÉELS signalés par l'utilisateur le 2026-08-06 sur la vue Workflows.
 *
 * Aucun de ces défauts n'était attrapable autrement : les tests de rendu montent le DOM sans feuille
 * de style, et une capture ne dit pas POURQUOI une couleur est fausse — seulement qu'elle l'est.
 */
describe('vue Workflows — le style tient ses promesses', () => {
  it('la liste DÉFILE au lieu de pousser la page hors de l’écran', () => {
    // Défaut vécu : la liste n'avait pas de hauteur bornée, donc rien ne « débordait » au sens CSS
    // et aucune barre n'apparaissait — les derniers workflows étaient inatteignables. Le trio
    // ci-dessous est ce qui fait réellement défiler : sans `min-height: 0`, un enfant de flex refuse
    // de rétrécir et `overflow` ne sert à rien.
    const liste = corpsDeRegle('WorkflowProfilesView.css', '.workflow-profiles-list')
    expect(liste, 'règle .workflow-profiles-list introuvable').toBeDefined()
    expect(liste).toMatch(/overflow-y\s*:\s*auto/)
    expect(liste).toMatch(/min-height\s*:\s*0/)

    const vue = corpsDeRegle('WorkflowProfilesView.css', '.workflow-profiles')
    expect(vue).toMatch(/height\s*:\s*100%/)
  })

  it('le plan des blueprints DÉFILE horizontalement quand la chaîne s’allonge', () => {
    // Défaut vécu : `overflow: auto` et la largeur du graphe étaient posés sur LE MÊME élément. Une
    // boîte ne déborde pas d'elle-même : elle grandissait avec le contenu, donc rien ne défilait et
    // une longue chaîne sortait de l'écran par la droite. Il faut deux boîtes, et le test vérifie
    // exactement cette séparation — pas la simple présence d'un `overflow` quelque part.
    const viewport = corpsDeRegle('WorkflowCanvas.css', '.wf-plan-viewport')
    expect(viewport, 'règle .wf-plan-viewport introuvable').toBeDefined()
    expect(viewport).toMatch(/overflow\s*:\s*auto/)

    const surface = corpsDeRegle('WorkflowCanvas.css', '.wf-plan')
    expect(surface).toBeDefined()
    // La surface ne doit PAS défiler elle-même, sinon on recrée le défaut.
    expect(surface).not.toMatch(/overflow\s*:/)

    // Et sa taille vient du graphe, posée en ligne par le composant.
    const tsx = lire('WorkflowCanvas.tsx')
    expect(tsx).toMatch(/className="wf-plan-viewport"/)
    expect(tsx).toMatch(/className="wf-plan"[\s\S]{0,80}width:\s*planW/)
  })

  it('le devis « ≤N exéc. » reste visible quand on défile vers la droite', () => {
    // Défaut commis en corrigeant le précédent : la barre d'état posée DANS le viewport. Un enfant
    // `absolute` d'un conteneur qui défile suit le contenu — les pastilles se faisaient couper à
    // gauche dès qu'on regardait la droite du graphe. Son ancre doit être une boîte qui NE défile pas.
    const zone = corpsDeRegle('WorkflowCanvas.css', '.wf-plan-zone')
    expect(zone, 'règle .wf-plan-zone introuvable').toBeDefined()
    expect(zone).toMatch(/position\s*:\s*relative/)
    expect(zone).not.toMatch(/overflow\s*:\s*(auto|scroll)/)

    // Et le viewport ne doit pas redevenir l'ancre en reprenant `position: relative`.
    expect(corpsDeRegle('WorkflowCanvas.css', '.wf-plan-viewport')).not.toMatch(/position\s*:\s*relative/)

    // La barre est un frère du viewport, pas son enfant.
    const tsx = lire('WorkflowCanvas.tsx')
    const viewportPuisBarre = tsx.match(/wf-plan-viewport[\s\S]*?wf-statusbar/)?.[0] ?? ''
    expect(viewportPuisBarre).toMatch(/<\/div>\s*<\/div>[\s\S]*wf-statusbar/)
  })

  it('le voile flouté ne recouvre pas le quadrillage du plan', () => {
    // Régression vécue : la règle de voile visait `.wf-plan` et, venant APRÈS, écrasait le
    // `background` quadrillé déclaré plus haut. Le papier millimétré avait disparu en silence.
    const css = lire('WorkflowCanvas.css')
    const voile = css.match(/([^}]*)\{[^}]*backdrop-filter[^}]*\}/g)?.join('\n') ?? ''
    expect(voile).not.toMatch(/\.wf-plan\s*[,{]/)
    expect(corpsDeRegle('WorkflowCanvas.css', '.wf-plan')).toMatch(/linear-gradient/)
  })

  it.each([
    ['WorkflowProfilesView.css', '.workflow-profile'],
    ['WorkflowProfilesView.css', '.workflow-profiles-head'],
    ['WorkflowBenchPanel.css', '.workflow-bench']
  ])('%s › %s pose une surface, au lieu de flotter sur le fond cosmique', (fichier, selecteur) => {
    // Défaut vécu : titre et panneaux posés À NU sur `autowin-galaxy-bg-hq.png`. Lisible là où
    // l'image est sombre, illisible dès qu'une nébuleuse passe derrière — donc un défaut qui ne se
    // reproduit pas de façon fiable, et que seule une règle explicite empêche.
    const corps = corpsDeRegle(fichier, selecteur)
    expect(corps, `règle ${selecteur} introuvable dans ${fichier}`).toBeDefined()
    expect(corps).toMatch(/background\s*:\s*var\(--surface-/)
  })

  it('n’utilise que des variables de thème réellement définies dans le dépôt', () => {
    // LE défaut de fond : six tokens (`--c-faint`, `--c-text`, `--surface2`, ...) n'existaient nulle
    // part. C'est leur valeur de repli en dur qui rendait — un gris-bleu absent de la palette, que
    // rien ne signale : ni le build, ni le typecheck, ni un test de rendu. On vérifie les var()
    // RÉELLEMENT référencées plutôt qu'une liste noire de noms connus : une liste noire ne dirait
    // rien du PROCHAIN token inventé.
    const utilisees = fichiersCss(new URL('.', import.meta.url))
      .filter((chemin) => /[\\/]Workflow[^\\/]*\.css$/.test(chemin))
      .flatMap((chemin) => [...readFileSync(chemin, 'utf8').matchAll(/var\(\s*(--[a-z0-9-]+)/g)])
      .map((match) => match[1])
    expect(utilisees.length).toBeGreaterThan(0)

    // Une définition ne commence pas forcément une ligne : `.wf-ph-scout { --wf-hue: var(--cyan); }`
    // tient sur une seule, et une regex ancrée en début de ligne la manquait — le test accusait alors
    // un token parfaitement défini. On accepte donc `{` et `;` comme frontières.
    const definies = new Set(
      [
        ...fichiersCss(new URL('..', import.meta.url))
          .map((chemin) => readFileSync(chemin, 'utf8'))
          .join('\n')
          .matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/gm)
      ].map((match) => match[1])
    )

    // Un token peut aussi être posé par le JS (`style={{ '--execution-depth': n }}`) : c'est une
    // définition réelle, simplement pas dans une feuille. L'ignorer produisait un faux rouge.
    for (const match of readdirSync(fileURLToPath(new URL('.', import.meta.url)))
      .filter((nom) => nom.endsWith('.tsx'))
      .flatMap((nom) =>
        [...lire(nom).matchAll(/['"](--[a-z0-9-]+)['"]\s*:/g)].map((m) => m[1])
      )) {
      definies.add(match)
    }

    const inconnues = [...new Set(utilisees)].filter((nom) => !definies.has(nom))
    expect(inconnues, `tokens jamais définis : ${inconnues.join(', ')}`).toEqual([])
  })
})
