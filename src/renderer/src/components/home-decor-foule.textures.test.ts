import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * LE BUDGET DES TEXTURES DES PASSANTS (conv-337, 2026-10-19).
 *
 * MESURE : 55 cartes de couleur en 1024², soit ≈ 307 Mo de mémoire graphique (RGBA + mipmaps) sur
 * les 366 Mo de la foule, pour des silhouettes de quelques centaines de pixels. Ramenées à 512², la
 * foule tient en ≈ 136 Mo. Au banc de rendu reproductible (même instant, même hasard, 30 instants
 * sur 60 s, fenêtre 1745 × 938), l'écart à l'écran entre 1024 et 512 est de 0 à 574 pixels sur
 * 1,6 million, au passage le plus proche de la caméra : rien que l'œil distingue.
 *
 * Ce qui doit faire échouer ce fichier : une texture de passant ajoutée ou réexportée au-delà de 512.
 */
const DOSSIER = new URL('../assets/foule-rocketbox/', import.meta.url)

/** Largeur et hauteur d'un WebP lues dans son en-tête (VP8 avec perte, VP8L sans perte, VP8X étendu). */
function tailleWebp(o: Buffer): [number, number] {
  const bloc = o.toString('latin1', 12, 16)
  if (bloc === 'VP8 ') return [o.readUInt16LE(26) & 0x3fff, o.readUInt16LE(28) & 0x3fff]
  if (bloc === 'VP8L') {
    const v = o.readUInt32LE(21)
    return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]
  }
  if (bloc === 'VP8X') return [1 + o.readUIntLE(24, 3), 1 + o.readUIntLE(27, 3)]
  throw new Error(`WebP inattendu : ${bloc}`)
}

describe('les textures des passants', () => {
  const webp = readdirSync(DOSSIER).filter((f) => f.endsWith('.webp'))

  it('sont toutes présentes et lisibles', () => {
    expect(webp.length).toBeGreaterThan(50)
  })

  it('ne dépassent pas 512 × 512 : au-delà, la mémoire graphique triple pour un écart invisible', () => {
    const tropGrandes = webp
      .map((f) => [f, tailleWebp(readFileSync(new URL(f, DOSSIER)))] as const)
      .filter(([, [l, h]]) => l > 512 || h > 512)
      .map(([f, [l, h]]) => `${f} ${l}×${h}`)
    expect(tropGrandes).toEqual([])
  })
})
