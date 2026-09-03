import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * La réserve affichée sous l'interrupteur « Mode clair » PROMET quelque chose à
 * l'utilisateur : la liste des écrans qui resteront sombres. Une liste incomplète est plus
 * nuisible qu'absente — elle laisse croire que le reste basculera.
 *
 * Ce test ne relit pas une liste écrite à la main : il MESURE, dans le CSS réel, combien de
 * couleurs chaque écran peint en dur, et exige que tout écran massivement en dur ET sans
 * reprise claire dans theme-modes.css soit NOMMÉ dans la réserve. Ajouter une surcharge
 * claire retire l'écran de la liste attendue ; en oublier un rend le test rouge.
 */

const COMPONENTS = join(__dirname)
const THEME_MODES = join(__dirname, '..', 'assets', 'theme-modes.css')

/** Au-delà de ce nombre de couleurs écrites en dur, l'écran restera visiblement sombre. */
const SEUIL_EN_DUR = 100

/** Écran → le mot que l'utilisateur reconnaît, et la classe racine de son CSS. */
const ECRANS = [
  { css: 'ChatView.css', nom: 'Chat', classe: 'chat-view' },
  { css: 'GraphView.css', nom: 'Memory', classe: 'graph-view' },
  { css: 'HomeView.css', nom: 'Accueil', classe: 'home-view' },
  { css: 'ObservatoryView.css', nom: 'Observatory', classe: 'observatory-view' },
  { css: 'AgentsTopologyView.css', nom: 'topologie', classe: 'agents-topology' }
] as const

const COULEUR_EN_DUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(/g

function compterCouleursEnDur(chemin: string): number {
  return (readFileSync(chemin, 'utf8').match(COULEUR_EN_DUR) ?? []).length
}

/** Une reprise claire existe si theme-modes.css cible la classe de l'écran sous data-theme. */
function aUneRepriseClaire(themeModes: string, classe: string): boolean {
  return themeModes
    .split(/\}/)
    .some((bloc) => bloc.includes("data-theme='clair'") && bloc.includes(classe))
}

function texteDeLaReserve(): string {
  const source = readFileSync(join(COMPONENTS, 'InterfaceView.tsx'), 'utf8')
  const debut = source.indexOf('interface-reserve')
  expect(debut, 'la réserve doit exister dans InterfaceView.tsx').toBeGreaterThan(-1)
  return source.slice(debut, source.indexOf('</p>', debut))
}

describe('réserve du mode clair', () => {
  const themeModes = readFileSync(THEME_MODES, 'utf8')
  const reserve = texteDeLaReserve()

  const restentSombres = ECRANS.filter(
    (e) =>
      compterCouleursEnDur(join(COMPONENTS, e.css)) > SEUIL_EN_DUR &&
      !aUneRepriseClaire(themeModes, e.classe)
  )

  it('au moins un écran est concerné, sinon ce test ne prouve rien', () => {
    expect(restentSombres.length).toBeGreaterThan(0)
  })

  for (const ecran of ECRANS) {
    const concerne = restentSombres.includes(ecran)
    it(`${ecran.nom} : ${concerne ? 'nommé dans la réserve' : 'repris en clair, donc hors réserve'}`, () => {
      if (concerne) {
        expect(
          reserve,
          `${ecran.css} peint plus de ${SEUIL_EN_DUR} couleurs en dur sans reprise claire : la réserve doit citer « ${ecran.nom} »`
        ).toContain(ecran.nom)
      }
    })
  }
})
