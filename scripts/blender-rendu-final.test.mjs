import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  BLENDER_DEFAUT,
  SCRIPT_QUALITE,
  lireArguments,
  lireResultat,
  pageHtml,
  valeurDuPoint
} from './blender-rendu-final.mjs'

// Skill blender (conv-1570) : le contrôle de la recette et le rendu final passent par le vrai Blender 5.2.
vi.setConfig({ testTimeout: 240_000 })
const SCRIPT = fileURLToPath(new URL('./blender-rendu-final.mjs', import.meta.url))
const racine = mkdtempSync(join(tmpdir(), 'blender-rendu-final-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))
const blenderPresent = existsSync(BLENDER_DEFAUT)

describe('lireArguments', () => {
  it('exige --blend, et range la sortie sous le fil', () => {
    expect(() => lireArguments([])).toThrow(/--blend/)
    const o = lireArguments(['--blend', 'a.blend', '--fil', 'conv-9'])
    expect(o.sortie).toMatch(/conv-9[\\/]blender$/u)
    expect(o.nom).toBe('rendu')
  })
  it('refuse des échantillons, une langue ou un nom invalides', () => {
    expect(() => lireArguments(['--blend', 'a', '--samples', '0'])).toThrow(/samples/)
    expect(() => lireArguments(['--blend', 'a', '--langue', 'de'])).toThrow(/langue/)
    expect(() => lireArguments(['--blend', 'a', '--nom', '../x'])).toThrow(/nom/)
    expect(() => lireArguments(['--blend', 'a', '--inconnu', 'x'])).toThrow(/inconnu/)
  })
})

describe('page du fil', () => {
  const resultat = {
    ok: false,
    rendu: { secondes: 24.2, echantillons: 128, resolution: [1280, 720] },
    points: [
      { id: 'objectif', ok: true, detail: '85 mm', mesure: { mm: 85 } },
      { id: 'materiaux', ok: true, detail: '3 objet(s) habillé(s)', mesure: { objets: 3 } },
      {
        id: 'biseaux',
        ok: false,
        detail: 'arêtes vives sans biseau : Cube (12)',
        correction: 'Bevel'
      }
    ]
  }
  it('met les valeurs vertes en mots dans la langue demandée, garde le détail d’un point rouge', () => {
    expect(valeurDuPoint(resultat.points[1], 'en')).toBe('3 object(s) dressed')
    expect(valeurDuPoint(resultat.points[1], 'fr')).toBe('3 objet(s) habillé(s)')
    expect(valeurDuPoint(resultat.points[2], 'en')).toBe('arêtes vives sans biseau : Cube (12)')
  })
  it('pose l’image en base64, la grille, et aucune couleur en dur', () => {
    const html = pageHtml({ jpegBase64: 'QUJD', resultat, titre: 'Vase <1>', langue: 'en' })
    expect(html).toContain('src="data:image/jpeg;base64,QUJD"')
    expect(html).toContain('Vase &lt;1&gt;')
    expect(html).toContain('aw-ok')
    expect(html).toContain('aw-ko')
    expect(html).toContain('1280×720')
    expect(html).toContain('24 s</span> to render')
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/iu)
  })
  it('lit la ligne QUALITE_JSON au milieu du bruit de Blender', () => {
    expect(lireResultat('Blender 5.2\nQUALITE_JSON: {"ok":true,"points":[]}\nFin')).toEqual({
      ok: true,
      points: []
    })
    expect(lireResultat('rien')).toBeNull()
  })
})

/** Construit une scène avec un script Python et l'enregistre, Blender sans fenêtre. */
function scene(nom, python) {
  const blend = join(racine, `${nom}.blend`)
  const code = `import bpy\n${python}\nbpy.ops.wm.save_as_mainfile(filepath=r"${blend}")\n`
  const r = spawnSync(BLENDER_DEFAUT, ['-b', '--factory-startup', '--python-expr', code], {
    encoding: 'utf8'
  })
  expect(existsSync(blend), r.stderr).toBe(true)
  return blend
}

describe.skipIf(!blenderPresent)('dans le vrai Blender', () => {
  it('la scène de départ de Blender échoue sur les six points attendus (AgX est déjà le défaut)', () => {
    const r = spawnSync(BLENDER_DEFAUT, ['-b', '--factory-startup', '--python', SCRIPT_QUALITE], {
      encoding: 'utf8'
    })
    const res = lireResultat(r.stdout)
    expect(res.ok).toBe(false)
    const rouges = res.points.filter((p) => !p.ok).map((p) => p.id)
    expect(rouges).toEqual(['hdri', 'materiaux', 'biseaux', 'objectif', 'profondeur', 'cycles'])
    expect(res.points.find((p) => p.id === 'biseaux').detail).toContain('Cube (12)')
  })

  it('une scène qui suit la recette passe les sept points, se rend, et donne sa page', () => {
    const blend = scene(
      'recette',
      `
import math
sc = bpy.context.scene
cube = bpy.data.objects['Cube']
b = cube.modifiers.new('Biseau', 'BEVEL'); b.width = 0.08; b.segments = 3
p = next(n for n in cube.active_material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
p.inputs['Base Color'].default_value = (0.5, 0.1, 0.05, 1)
p.inputs['Roughness'].default_value = 0.35
ciel = bpy.data.images.new('ciel', 64, 32, float_buffer=True)
ciel.generated_color = (0.9, 0.85, 0.8, 1)
w = sc.world; nt = w.node_tree
fond = next(n for n in nt.nodes if n.type == 'BACKGROUND')
env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = ciel
nt.links.new(env.outputs['Color'], fond.inputs['Color'])
cam = sc.camera; cam.data.lens = 85
cam.data.dof.use_dof = True; cam.data.dof.focus_object = cube; cam.data.dof.aperture_fstop = 2.8
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 32; sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 160, 90, 100
`
    )
    const r = spawnSync(
      process.execPath,
      [
        SCRIPT,
        '--blend',
        blend,
        '--sortie',
        racine,
        '--nom',
        'recette',
        '--samples',
        '8',
        '--langue',
        'en'
      ],
      { encoding: 'utf8' }
    )
    const sortie = JSON.parse(r.stdout.trim().split('\n').pop())
    const res = JSON.parse(readFileSync(join(racine, 'recette.json'), 'utf8'))
    const scenePoints = res.points.filter((p) => p.id !== 'exposition')
    expect(scenePoints.map((p) => p.id)).toEqual([
      'hdri',
      'materiaux',
      'biseaux',
      'objectif',
      'profondeur',
      'agx',
      'cycles'
    ])
    expect(scenePoints.filter((p) => !p.ok)).toEqual([])
    // L'exposition est MESURÉE sur l'image écrite, et le code de sortie suit son verdict.
    const expo = res.points.find((p) => p.id === 'exposition')
    expect(typeof expo.mesure.moyenne).toBe('number')
    expect(r.status).toBe(expo.ok ? 0 : 5)
    expect(sortie.code).toBe(r.status)
    expect(res.rendu.resolution).toEqual([160, 90])
    for (const f of [sortie.png, sortie.jpg, sortie.html]) expect(existsSync(f)).toBe(true)
    expect(readFileSync(sortie.jpg).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    expect(readFileSync(sortie.html, 'utf8')).toContain('data:image/jpeg;base64,')
  })
})
