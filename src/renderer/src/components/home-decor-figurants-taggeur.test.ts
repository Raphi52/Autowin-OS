import { describe, expect, it } from 'vitest'
import { AVENUE } from './home-decor-avenue'
import { DEAL, etatTaggeur, FIGURANTS, GESTES, TAGGEUR } from './home-decor-figurants'
import { AVATARS, HEURE_DE_POINTE, MARCHES } from './home-decor-foule'
import { TRIBUS } from './home-decor-foule-tribus'

/**
 * LE TAGGEUR, REJOUÉ PAR UN HUMAIN RÉEL (conv-312) : « met un pieton taggeur aussi ». Il bombe le mur
 * tagué de l'avenue, à côté des passants, du deal et du fumeur.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER :
 *   1. le mot peint loin dans la brume, ou fini avant que le mur soit visible → on ne le voit jamais ;
 *   2. la bombe qui crache pendant qu'il marche, ou un mot qui se dépeint en cours de passage ;
 *   3. un taggeur qui glisse le long du mur sans marcher, ou qui peint dos au mur ;
 *   4. un taggeur choisi parmi les passants, ou un geste absent de `gestes.glb`.
 */
const vRue = AVENUE.vitesse
const vMarche = 0.9
const FACE_AU_MUR = Math.PI / 2

/** Un passage complet du mur : de sa réapparition au fond à son passage derrière la caméra. */
function passage(pas = 0.01): { z: number; e: ReturnType<typeof etatTaggeur> }[] {
  const out: { z: number; e: ReturnType<typeof etatTaggeur> }[] = []
  for (let z = DEAL.debutLieux; z <= 12; z += pas) out.push({ z, e: etatTaggeur(z, vRue, vMarche) })
  return out
}

describe('le taggeur : il secoue sa bombe, trace le mot en quatre traits, puis surveille', () => {
  it('le mur est vierge quand il réapparaît, et le mot ne fait que se remplir pendant le passage', () => {
    const p = passage()
    expect(p[0].e.peinture).toBe(0)
    expect(p[0].e.bombe).toBe(false)
    for (let i = 1; i < p.length; i++)
      expect(p[i].e.peinture, `z=${p[i].z.toFixed(2)}`).toBeGreaterThanOrEqual(p[i - 1].e.peinture)
    expect(p[p.length - 1].e.peinture).toBe(1)
  })

  it('il peint à mi-distance, là où on le voit : ni dans la brume du fond, ni derrière les tuiles du bas', () => {
    const p = passage()
    const premier = p.find((x) => x.e.bombe)
    const fini = p.find((x) => x.e.peinture >= 1)
    expect(premier && premier.z).toBeGreaterThan(-45)
    expect(fini && fini.z).toBeLessThan(-22)
    expect(fini && premier && fini.z - premier.z).toBeGreaterThan(5)
  })

  it('quatre traits, la bombe ne crache que face au mur, et il marche vers nous entre deux traits', () => {
    const p = passage()
    let traits = 0
    for (let i = 1; i < p.length; i++) if (p[i].e.bombe && !p[i - 1].e.bombe) traits++
    expect(traits).toBe(TAGGEUR.traits.length)
    for (const { e } of p) {
      if (e.bombe) {
        expect(e.geste).toBe('trait')
        expect(e.cap).toBeCloseTo(FACE_AU_MUR, 6)
      }
      if (e.geste === 'marche') expect(e.bombe).toBe(false)
    }
    // il avance d'un trait à l'autre en marchant, jamais en glissant : sa position ne change qu'en marche
    for (let i = 1; i < p.length; i++)
      if (p[i].e.rel !== p[i - 1].e.rel)
        expect(p[i].e.geste, `z=${p[i].z.toFixed(2)}`).toBe('marche')
    // le mot se lit de loin vers près : il progresse vers la caméra (z croissant)
    const places = [...new Set(p.filter((x) => x.e.bombe).map((x) => x.e.rel))]
    expect(places).toHaveLength(TAGGEUR.traits.length)
    for (let k = 1; k < places.length; k++) expect(places[k]).toBeGreaterThan(places[k - 1])
    // et il reste devant le mur peint (4,8 m de large)
    for (const { e } of p) expect(Math.abs(e.rel)).toBeLessThan(2.4)
  })

  it('une personne absente de la foule, en survêt et cagoule, avec des gestes de gestes.glb', () => {
    const passants = new Set(HEURE_DE_POINTE.map((p) => p.av))
    expect(passants.has(FIGURANTS.taggeur)).toBe(false)
    expect(AVATARS[FIGURANTS.taggeur]).toBe('Male_Adult_16')
    expect(TRIBUS[FIGURANTS.taggeur]).toBe('survet')
    for (const g of Object.values(TAGGEUR.gestes)) expect(GESTES).toContain(g)
    expect(MARCHES).toContain(TAGGEUR.marche)
  })
})
