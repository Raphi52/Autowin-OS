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
