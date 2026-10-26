import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TEXTES_EN, TEXTES_FR } from '../textes'

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
  { css: 'ChatView.css', nom: 'Chat', nomEn: 'Chat', classe: 'chat-view' },
  { css: 'GraphView.css', nom: 'Memory', nomEn: 'Memory', classe: 'graph-view' },
  { css: 'HomeView.css', nom: 'Accueil', nomEn: 'Home', classe: 'home-view' },
  {
    css: 'ObservatoryView.css',
    nom: 'Observatory',
    nomEn: 'Observatory',
    classe: 'observatory-view'
  },
  { css: 'AgentsTopologyView.css', nom: 'topologie', nomEn: 'topology', classe: 'agents-topology' }
] as const

const COULEUR_EN_DUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(/g

function compterCouleursEnDur(chemin: string): number {
  return (readFileSync(chemin, 'utf8').match(COULEUR_EN_DUR) ?? []).length
}

/*
 * Une reprise claire existe si theme-modes.css cible la classe de l'ecran sous le selecteur du
 * mode clair. LES DEUX NOMS SONT ACCEPTES : mesure du 2026-09-07 (conv-334), le commit 640f92ea a
 * renomme `data-theme='clair'` en `data-base='clair'` (les surcharges visent la BASE du theme).
 * Ce test ne cherchait que l'ancien nom : plus AUCUNE reprise n'etait vue, tous les ecrans
 * passaient pour « restera sombre », et la reserve etait declaree incomplete a tort.
 */
function aUneRepriseClaire(themeModes: string, classe: string): boolean {
  return themeModes
    .split(/\}/)
    .some(
      (bloc) => /data-(base|theme)=['"]clair['"]/.test(bloc) && bloc.includes(classe)
    )
}

/*
 * LA réserve, pas le premier paragraphe qui en porte la classe (conv-770, 2026-09-28) : depuis
 * 3517698a (2026-09-22), un paragraphe « Pour agrandir tout l'écran » (`data-testid="interface-zoom"`)
 * reprend la classe `interface-reserve` et passe AVANT. Le test lisait ce paragraphe-là et
 * déclarait absents « Chat », « Memory » et « topologie », pourtant bien nommés dans la réserve.
 * On exige qu'il en reste EXACTEMENT une hors zoom : un troisième paragraphe ambigu refera rougir.
 */
/*
 * LE TEXTE VIT DANS LA TABLE DES TEXTES depuis la bascule de langue (conv-1146, 2026-10-26) : le
 * paragraphe de `InterfaceView.tsx` ne porte plus que la clé `interface.reserve`. On vérifie donc
 * que l'écran rend CETTE clé, dans le paragraphe de réserve et lui seul, puis on lit son texte dans
 * les DEUX langues : une réserve anglaise incomplète tromperait l'utilisateur autant qu'une française.
 */
function texteDeLaReserve(): { fr: string; en: string } {
  const source = readFileSync(join(COMPONENTS, 'InterfaceView.tsx'), 'utf8')
  const paragraphes = [
    ...source.matchAll(/<p className="interface-reserve"([^>]*)>([\s\S]*?)<\/p>/g)
  ]
  expect(paragraphes.length, 'la réserve doit exister dans InterfaceView.tsx').toBeGreaterThan(0)
  const reserves = paragraphes.filter((p) => !p[1].includes('data-testid="interface-zoom"'))
  expect(reserves, 'une seule réserve des écrans restés sombres, hors aide au zoom').toHaveLength(1)
  expect(reserves[0][2], 'la réserve affichée doit être la clé interface.reserve').toContain(
    "t('interface.reserve')"
  )
  return { fr: TEXTES_FR['interface.reserve'], en: TEXTES_EN['interface.reserve'] }
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
          reserve.fr,
          `${ecran.css} peint plus de ${SEUIL_EN_DUR} couleurs en dur sans reprise claire : la réserve doit citer « ${ecran.nom} »`
        ).toContain(ecran.nom)
        expect(
          reserve.en,
          `même écran, réserve anglaise : elle doit citer « ${ecran.nomEn} »`
        ).toContain(ecran.nomEn)
      }
    })
  }
})
