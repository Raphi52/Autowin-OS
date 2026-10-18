import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AVENUE } from './home-decor-avenue'
import {
  DEAL,
  ecarter,
  etatClient,
  etatDealer,
  FIGURANTS,
  FUMEUR,
  GESTES,
  jalonsDeal,
  MARCHE_CLIENT
} from './home-decor-figurants'
import { AVATARS, HEURE_DE_POINTE, MARCHES } from './home-decor-foule'

/**
 * LE DEAL ET LE FUMEUR, REJOUÉS PAR DES HUMAINS RÉELS (conv-312) : « Refais le deal et le fumeur du
 * fond d'Accueil avec des humains Rocketbox animés par leurs gestes capturés, à côté des 18 passants ».
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER :
 *   1. le client qui surgit ou s'évanouit au milieu de la rue → il doit entrer par le fond, dans la
 *      brume, et sortir derrière la caméra ;
 *   2. le deal joué loin, dans la brume, ou derrière les tuiles du bas → on ne le verrait jamais ;
 *   3. un figurant choisi parmi les passants → on verrait des jumeaux ;
 *   4. un geste absent de `gestes.glb`, ou le seuil « main à la bouche » hors de la mesure → pas de
 *      bouffée ;
 *   5. un passant qui traverse le dealer, le client ou le fumeur.
 */
const vRue = AVENUE.vitesse
const vMarche = 1.0
const DOSSIER = new URL('../assets/foule-rocketbox/', import.meta.url)

/** Le JSON d'un glTF binaire. */
function jsonGlb(nom: string): { animations?: { name: string }[]; images?: unknown[] } {
  const o = readFileSync(new URL(nom, DOSSIER))
  return JSON.parse(o.subarray(20, 20 + o.readUInt32LE(12)).toString('utf8'))
}

describe('le deal : le client arrive, prend, regarde autour de lui et repart', () => {
  it('il n apparaît que dans la brume du fond et ne disparaît que derrière la caméra', () => {
    let avant = etatClient(DEAL.debutLieux, vRue, vMarche)
    let bascules = 0
    for (let z = DEAL.debutLieux; z <= 12; z += 0.01) {
      const e = etatClient(z, vRue, vMarche)
      if (e.visible !== avant.visible) {
        bascules++
        const monde = z + e.rel
        // Entrée : au-delà de 56 m de la caméra, dans la brume ; sortie : passé derrière elle.
        if (e.visible) expect(monde, `entrée à z=${z.toFixed(2)}`).toBeLessThan(-55)
        else expect(monde, `sortie à z=${z.toFixed(2)}`).toBeGreaterThan(DEAL.sortie - 0.1)
      }
      avant = e
    }
    expect(bascules).toBe(2)
  })

  it('le deal se joue à mi-distance, dans l ordre, et dure le temps de le voir', () => {
    const j = jalonsDeal(vRue, vMarche)
    const zDe = (tau: number): number => DEAL.debutLieux + vRue * tau
    // Le lieu est entre 20 et 30 m de la caméra pendant toute la scène.
    expect(zDe(j.arrivee)).toBeCloseTo(DEAL.arrivee, 6)
    expect(zDe(j.repart)).toBeGreaterThan(-30)
    expect(zDe(j.repart)).toBeLessThan(-15)
    const vus = new Set<string>()
    for (let tau = j.depart; tau < j.repart + 5; tau += 0.05)
      vus.add(etatClient(zDe(tau), vRue, vMarche).geste)
    expect([...vus]).toEqual(['marche', 'ecoute', 'prend', 'regarde'])
    expect(j.repart - j.arrivee).toBeGreaterThanOrEqual(12)
    // Arrêté, il est face au dealer ; en marchant, il regarde devant lui (vers nous).
    const arrete = etatClient(zDe(j.arrivee + 1), vRue, vMarche)
    expect(arrete.rel).toBe(DEAL.dzClient)
    expect(arrete.cap).toBeGreaterThan(0.5)
    expect(etatClient(zDe(j.depart + 1), vRue, vMarche).cap).toBe(0)
    expect(etatClient(zDe(j.repart + 3), vRue, vMarche).cap).toBeCloseTo(0, 6)
  })

  it('le paquet n est dans sa main que pendant le geste « prendre »', () => {
    expect(DEAL.paquet[0]).toBeGreaterThan(0)
    expect(DEAL.paquet[1]).toBeLessThan(DEAL.prend)
  })

  it('le dealer tape sur son téléphone, lui parle pendant le deal, puis y retourne', () => {
    const j = jalonsDeal(vRue, vMarche)
    const zDe = (tau: number): number => DEAL.debutLieux + vRue * tau
    expect(etatDealer(zDe(j.depart), vRue, vMarche).geste).toBe('m_cell_phone_textmessage')
    expect(etatDealer(zDe(j.arrivee + 1), vRue, vMarche).geste).toBe('m_gestic_talk_cool')
    expect(etatDealer(zDe(j.repart + 3), vRue, vMarche).geste).toBe('m_cell_phone_textmessage')
    // Dos au mur, il regarde la rue (-x) ; pendant le deal, il se tourne vers le client.
    expect(etatDealer(zDe(j.depart), vRue, vMarche).cap).toBeCloseTo(-Math.PI / 2, 6)
    expect(etatDealer(zDe(j.arrivee + 2), vRue, vMarche).cap).toBeLessThan(-2)
  })
})

describe('les figurants : des personnes et des gestes réels, à part de la foule', () => {
  it('trois personnes qui ne sont pas parmi les passants, et leurs fichiers', () => {
    const passants = new Set(HEURE_DE_POINTE.map((p) => p.av))
    for (const code of Object.values(FIGURANTS)) {
      expect(passants.has(code), code).toBe(false)
      expect(jsonGlb(`${AVATARS[code]}.glb`).images ?? []).toEqual([])
    }
  })

  it('chaque geste joué est dans gestes.glb, la marche du client dans marches.glb', () => {
    expect(
      jsonGlb('gestes.glb')
        .animations?.map((a) => a.name)
        .sort()
    ).toEqual([...GESTES].sort())
    expect(MARCHES).toContain(MARCHE_CLIENT)
    expect(GESTES).toContain(FUMEUR.geste)
  })

  it('le seuil « main à la bouche » sépare la mesure du repos (0,52 m) de celle de la bouffée (0,30 m)', () => {
    expect(FUMEUR.bouche).toBeGreaterThan(0.3)
    expect(FUMEUR.bouche).toBeLessThan(0.52)
  })
})

describe('les passants contournent les figurants', () => {
  const o = { x: 7.08, z: -25, distance: 0.8, plein: 1, portee: 3.5, cote: -1 as const }

  it('à hauteur du figurant, on passe à sa distance, du côté demandé (la chaussée)', () => {
    for (const x of [5, 6.2, 6.7, 7.0, 7.3]) {
      const ecarte = ecarter(x, -25, o)
      expect(ecarte, `x=${x}`).toBeLessThanOrEqual(7.08 - 0.8 + 1e-9)
      // Qui passait déjà assez loin côté chaussée garde sa file.
      if (x <= 7.08 - 0.8) expect(ecarte).toBe(x)
    }
  })

  it('l écart est continu et nul hors de portée', () => {
    expect(ecarter(6.7, -25 - 4, o)).toBe(6.7)
    let avant = ecarter(6.7, -30, o)
    for (let z = -30; z <= -20; z += 0.01) {
      const x = ecarter(6.7, z, o)
      expect(Math.abs(x - avant)).toBeLessThan(0.01)
      avant = x
    }
  })
})

describe('les scènes sont branchées dans l avenue', () => {
  const avenue = readFileSync(new URL('./home-decor-avenue.ts', import.meta.url), 'utf8')

  it('la foule reçoit les mesures de la rue, et à chaque image la position du deal et du fumeur', () => {
    expect(avenue).toMatch(/facade: FACADE,\s*garde: GARDE,\s*vRue: p\.vitesse/)
    expect(avenue).toMatch(/deal: zVisible\(Z_DEAL\),\s*fumeur: zVisible\(Z_FUMEUR\)/)
  })
})
