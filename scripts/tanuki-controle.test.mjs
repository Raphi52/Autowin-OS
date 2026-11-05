// Tests du contrôle qualité d'un rendu de tanuki (conv-1566, lot 3 du plan conv-1558).
// Image conforme = un tanuki de face de l'atlas lui-même (la fiche en est mesurée), agrandi ×3 comme
// un rendu. Entrées qui DOIVENT faire échouer ce test si le contrôle était faux : le même tanuki
// étiré en largeur (proportions), repeint en bleu (palette), tête décalée sur le côté (symétrie).
// Jumeaux acceptés : fond blanc opaque, et foulard bleu (absent de la fiche, décision du chef).
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decoderAtlas } from './tanuki-mesurer.mjs'
import { controler } from './tanuki-controle.mjs'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ATLAS = join(RACINE, 'src/renderer/src/assets/quartier/atlas.avif')
const SCRIPT = join(RACINE, 'scripts/tanuki-controle.mjs')
const REF = JSON.parse(readFileSync(join(RACINE, 'skills/tanuki/reference.json'), 'utf8'))

// Fabrique les PNG de test avec Pillow (déjà requis par decoder) : case 0 de l'atlas, 126 × 170.
// Le tanuki v3 est livré en ×2 (conv-1558) : la planche est d'abord ramenée à la grille, comme decoderAtlas.
const FABRIQUE = `
import sys
from PIL import Image
d = sys.argv[1]
im = Image.open(sys.argv[2]).convert('RGBA')
k = im.width // 1512
if k > 1: im = im.resize((1512, im.height // k), Image.LANCZOS)
c = im.crop((0, 0, 126, 170))
up = c.resize((378, 510), Image.NEAREST)
up.save(d + '/conforme.png')
fond = Image.new('RGBA', up.size, (255, 255, 255, 255)); fond.alpha_composite(up)
fond.convert('RGB').save(d + '/fond-blanc.png')
c.resize((240, 170), Image.NEAREST).crop((57, 0, 183, 170)).resize((378, 510), Image.NEAREST).save(d + '/etire.png')
px = up.load(); bleu = up.copy(); pb = bleu.load()
for y in range(up.height):
    for x in range(up.width):
        r, g, b, a = px[x, y]
        if a: pb[x, y] = (40, 60, 200, a)
bleu.save(d + '/bleu.png')
large = Image.new('RGBA', (600, 510)); large.paste(up, (111, 0))
tete = up.crop((0, 0, 378, 200)); large.paste(Image.new('RGBA', (600, 200)), (0, 0)); large.paste(tete, (222, 0))
large.save(d + '/tete-decalee.png')
foulard = up.copy(); pf = foulard.load()
for y in range(205, 230):
    for x in range(up.width):
        if pf[x, y][3]: pf[x, y] = (40, 80, 200, 255)
foulard.save(d + '/foulard.png')
`

let dossier
beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'tanuki-controle-'))
  execFileSync('python', ['-I', '-c', FABRIQUE, dossier, ATLAS])
})
afterAll(() => rmSync(dossier, { recursive: true, force: true }))

const lancer = (nom) =>
  spawnSync('node', [SCRIPT, join(dossier, nom), '--json'], { encoding: 'utf8' })
const criteresKO = (r) => r.mesures.filter((m) => !m.ok).map((m) => m.critere)

describe('tanuki-controle', () => {
  it('chaque tanuki de face de l’atlas est conforme à la fiche tirée de lui', () => {
    const [w, h] = REF.source.caseEnPixels
    const im = decoderAtlas(ATLAS, w)
    let vus = 0
    for (let c = 0; c < Math.floor(im.w / w); c++) {
      const d = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++)
        d.set(im.d.subarray((y * im.w + c * w) * 4, (y * im.w + c * w + w) * 4), y * w * 4)
      if (!d.some((v, i) => i % 4 === 3 && v >= 128)) continue
      vus++
      const r = controler({ w, h, d }, REF)
      expect(criteresKO(r), `case ${c}`).toEqual([])
    }
    expect(vus).toBe(REF.cases.face)
  })

  it('rendu conforme : code 0, score 1', () => {
    const p = lancer('conforme.png')
    expect(p.status, p.stderr).toBe(0)
    const r = JSON.parse(p.stdout)
    expect(r.conforme).toBe(true)
    expect(r.score).toBe(1)
  })

  it('fond blanc opaque (rendu sans transparence) : détouré, toujours conforme', () => {
    expect(lancer('fond-blanc.png').status).toBe(0)
  })

  it('foulard bleu en plus : pas pénalisé (décision du chef conv-1558)', () => {
    const p = lancer('foulard.png')
    expect(criteresKO(JSON.parse(p.stdout))).toEqual([])
    expect(p.status).toBe(0)
  })

  it('tanuki étiré en largeur : code 1, écart de proportions détaillé', () => {
    const p = lancer('etire.png')
    expect(p.status).toBe(1)
    const r = JSON.parse(p.stdout)
    expect(criteresKO(r)).toContain('proportion.hauteurSurLargeurCorps')
    expect(r.ecarts.find((e) => e.critere === 'proportion.hauteurSurLargeurCorps').message).toMatch(
      new RegExp(`au lieu de ${String(REF.proportions.hauteurSurLargeurCorps).replace('.', '\\.')}`)
    )
  })

  it('tanuki repeint en bleu : code 1 sur la palette seule', () => {
    const p = lancer('bleu.png')
    expect(p.status).toBe(1)
    expect(criteresKO(JSON.parse(p.stdout))).toEqual(['palette'])
  })

  it('tête décalée sur le côté : code 1 sur la symétrie', () => {
    const p = lancer('tete-decalee.png')
    expect(p.status).toBe(1)
    expect(criteresKO(JSON.parse(p.stdout))).toContain('symetrie')
  })

  it('image introuvable : code 2', () => {
    expect(lancer('absente.png').status).toBe(2)
  })
})
