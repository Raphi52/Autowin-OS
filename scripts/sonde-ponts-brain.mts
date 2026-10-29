/**
 * SONDE DU SEUIL DES PONTS perso → équipe (conv-1262, 2026-10-29).
 *
 * Aucun Brain perso n'était peuplé au moment du réglage : on mesure donc sur le Brain d'ÉQUIPE
 * lui-même, en traitant un échantillon de ses notes comme des notes « perso » (chacune exclue de
 * ses propres voisines). Trois chiffres : la similarité de la 1re et de la 3e voisine (ce qu'un
 * vrai voisin atteint) et celle de paires TIRÉES AU HASARD (le bruit de fond). Le seuil
 * `PONTS_SIMILARITE_MIN` de `src/main/brain-ponts.ts` doit laisser passer la plupart des vraies
 * voisines et presque aucune paire au hasard.
 *
 * Usage : npx tsx scripts/sonde-ponts-brain.mts [taille d'échantillon, défaut 400]
 */
import { sharedBrainRoot } from '../src/main/brain-paths'
import { calculerPonts, lireIndexBrain } from '../src/main/brain-ponts'

const taille = Number(process.argv[2] ?? 400)
const racine = sharedBrainRoot()
const debut = Date.now()
const index = await lireIndexBrain(racine)
if (!index) {
  console.log(JSON.stringify({ erreur: 'index d’équipe introuvable' }))
  process.exit(1)
}
const lecture = Date.now() - debut
const ids = [...index.notes.keys()]
// Tirage déterministe (pas de Math.random) : deux passes de la sonde rendent les mêmes chiffres.
let graine = 12345
const hasard = (): number => {
  graine = (graine * 1103515245 + 12345) % 2147483648
  return graine / 2147483648
}
const echantillon = new Map<string, Float32Array>()
while (echantillon.size < Math.min(taille, ids.length)) {
  const id = ids[Math.floor(hasard() * ids.length)]
  echantillon.set(id, index.notes.get(id)!)
}
const t0 = Date.now()
const voisins = new Map<string, number[]>()
for (const [id, vecteur] of echantillon) {
  const ponts = calculerPonts(new Map([[id, vecteur]]), index.notes, {
    parNote: 3,
    similariteMin: -1,
    equipeAutorisee: (autre) => autre !== id
  })
  voisins.set(
    id,
    ponts.map((pont) => pont.similarite)
  )
}
const calcul = Date.now() - t0
const aleatoires: number[] = []
for (let n = 0; n < 2000; n += 1) {
  const a = index.notes.get(ids[Math.floor(hasard() * ids.length)])!
  const b = index.notes.get(ids[Math.floor(hasard() * ids.length)])!
  let produit = 0
  for (let d = 0; d < a.length; d += 1) produit += a[d] * b[d]
  aleatoires.push(produit)
}
const quantiles = (valeurs: number[]): Record<string, number> => {
  const tri = [...valeurs].sort((x, y) => x - y)
  const q = (p: number): number => Number(tri[Math.floor(p * (tri.length - 1))].toFixed(3))
  return { p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), p99: q(0.99) }
}
const part = (valeurs: number[], seuil: number): number =>
  Number((valeurs.filter((v) => v >= seuil).length / valeurs.length).toFixed(3))
const premieres = [...voisins.values()].map((liste) => liste[0])
const troisiemes = [...voisins.values()].map((liste) => liste[2])
console.log(
  JSON.stringify(
    {
      notes: ids.length,
      echantillon: echantillon.size,
      lectureMs: lecture,
      calculMsParNote: Number((calcul / echantillon.size).toFixed(2)),
      premiereVoisine: quantiles(premieres),
      troisiemeVoisine: quantiles(troisiemes),
      paireAuHasard: quantiles(aleatoires),
      partAuDessus: Object.fromEntries(
        [0.5, 0.55, 0.6, 0.65, 0.7, 0.75].map((seuil) => [
          seuil,
          {
            premiere: part(premieres, seuil),
            troisieme: part(troisiemes, seuil),
            hasard: part(aleatoires, seuil)
          }
        ])
      )
    },
    null,
    1
  )
)
