/**
 * Contrat des calques de la Falaise : chaque bâtiment de `donnees.json` a son image, à la taille
 * de son empreinte, et aucune image ne traîne sans bâtiment. Une image manquante ferait disparaître le
 * bâtiment de l'Accueil (le calque « derrière » le recouvre) ; une taille fausse le décalerait.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import D from '../assets/quartier/donnees.json'
import { adresseBatiment, nomDuBatiment } from './quartier-calques'

const DOSSIER = join(__dirname, '../assets/quartier/batiments')
/** Pixels de peinture par pixel d'Accueil : la Falaise fait 2688 de large pour 1344. */
const S = 2

/** Largeur et hauteur d'un WebP, lues dans son en-tête (VP8L sans perte, ou VP8X étendu). */
function tailleWebp(octets: Buffer): [number, number] {
  const morceau = octets.toString('ascii', 12, 16)
  if (morceau === 'VP8L') {
    const b = octets.readUInt32LE(21)
    return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]
  }
  if (morceau === 'VP8X') return [octets.readUIntLE(24, 3) + 1, octets.readUIntLE(27, 3) + 1]
  throw new Error(`en-tête WebP inattendu : ${morceau}`)
}

describe('calques de la Falaise', () => {
  const objets = (D as unknown as { obj: { n?: string; cle?: string; w: number; h: number }[] }).obj

  it('chaque bâtiment a son image, servie et à la taille de son empreinte', () => {
    for (const o of objets) {
      const nom = nomDuBatiment(o)
      expect(adresseBatiment(nom), nom).toBeTruthy()
      const [w, h] = tailleWebp(readFileSync(join(DOSSIER, `${nom}.webp`)))
      expect([w, h], nom).toEqual([o.w * S, o.h * S])
    }
  })

  it('aucune image de bâtiment sans bâtiment', () => {
    const noms = new Set(objets.map(nomDuBatiment))
    expect(noms.size).toBe(objets.length)
    const orphelines = readdirSync(DOSSIER).filter((f) => !noms.has(f.replace(/\.webp$/, '')))
    expect(orphelines).toEqual([])
  })

  it('un nom absent est une erreur nommée', () => {
    expect(() => adresseBatiment('nexiste-pas')).toThrow(/batiments\/nexiste-pas\.webp/)
  })
})
