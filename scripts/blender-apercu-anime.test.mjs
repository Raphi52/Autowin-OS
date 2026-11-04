// Tests de l'aperçu animé Blender (conv-1564, lot 4 du plan conv-1558).
// Pourquoi : un GIF « écrit » mais d'une seule image, ou figé, serait une fausse preuve. On génère
// deux scènes par script (avec actions oreilles/queue, et sans action) et on relit le GIF produit.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { BLENDER_DEFAUT, compterImagesGif } from './blender-apercu-anime.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'blender-apercu-anime.mjs')
const avecBlender = process.platform === 'win32' && existsSync(BLENDER_DEFAUT)
const dossier = mkdtempSync(join(tmpdir(), 'apercu-test-'))
afterAll(() => rmSync(dossier, { recursive: true, force: true }))

// Scène générée : un corps, deux oreilles, une queue ; actions « oreilles » et « queue » si animer.
const SCENE_PY = `
import bpy, sys
animer = sys.argv[-2] == "1"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0, 0, 0))
for x in (-0.5, 0.5):
    bpy.ops.mesh.primitive_cone_add(radius1=0.3, depth=0.6, location=(x, 0, 1.1))
    o = bpy.context.object
    o.name = "oreille"
    if animer:
        for f, r in ((1, 0), (12, 0.6), (24, 0)):
            o.rotation_euler = (0, r, 0)
            o.keyframe_insert("rotation_euler", frame=f)
        o.animation_data.action.name = "oreilles"
bpy.ops.mesh.primitive_cylinder_add(radius=0.2, depth=1.2, location=(0, 1.2, -0.3))
q = bpy.context.object
if animer:
    for f, z in ((1, -0.5), (12, 0.5), (24, -0.5)):
        q.rotation_euler = (0.8, 0, z)
        q.keyframe_insert("rotation_euler", frame=f)
    q.animation_data.action.name = "queue"
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[-1])
`

function genererScene(nom, animer) {
  const py = join(dossier, 'scene.py')
  const blend = join(dossier, `${nom}.blend`)
  writeFileSync(py, SCENE_PY)
  const r = spawnSync(
    BLENDER_DEFAUT,
    ['--background', '--python', py, '--', animer ? '1' : '0', blend],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000
    }
  )
  expect(existsSync(blend), r.stdout + r.stderr).toBe(true)
  return blend
}

const lancer = (args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 300_000 })

describe('blender-apercu-anime', () => {
  it('compterImagesGif refuse un fichier qui n’est pas un GIF, et un GIF tronqué', () => {
    expect(compterImagesGif(Buffer.from('PNG pas un gif'))).toBeNull()
    expect(compterImagesGif(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1'))).toBeNull()
    // jumeau accepté : même en-tête, avec la marque de fin et zéro image
    expect(compterImagesGif(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00\x3b', 'latin1'))).toBe(
      0
    )
  })

  it('refuse (code 2) un .blend introuvable, sans lancer Blender', () => {
    expect(lancer(['--blend', join(dossier, 'absent.blend')]).status).toBe(2)
  })

  it.skipIf(!avecBlender)(
    'rend les actions présentes (oreilles, queue) en GIF animé — code 0',
    () => {
      const blend = genererScene('tanuki-anime', true)
      const sortie = join(dossier, 'anime.gif')
      const r = lancer([
        '--blend',
        blend,
        '--sortie',
        sortie,
        '--images',
        '8',
        '--taille',
        '96',
        '--moteur',
        'BLENDER_WORKBENCH'
      ])
      expect(r.status, r.stdout + r.stderr).toBe(0)
      const rapport = JSON.parse(r.stdout.trim().split('\n').pop())
      expect(rapport.mode).toBe('actions')
      expect(rapport.actionsParlantes).toEqual(expect.arrayContaining(['oreilles', 'queue']))
      expect(rapport.imagesDistinctes).toBeGreaterThan(1)
      expect(compterImagesGif(readFileSync(sortie))).toBe(8)
    },
    300_000
  )

  it.skipIf(!avecBlender)(
    'sans action, tourne autour de la scène et écrit dans .autowin-tmp/<fil>/ — code 0',
    () => {
      const blend = genererScene('tanuki-fixe', false)
      const fil = `test-apercu-${process.pid}`
      const r = lancer([
        '--blend',
        blend,
        '--fil',
        fil,
        '--images',
        '6',
        '--taille',
        '64',
        '--moteur',
        'BLENDER_WORKBENCH'
      ])
      expect(r.status, r.stdout + r.stderr).toBe(0)
      const rapport = JSON.parse(r.stdout.trim().split('\n').pop())
      expect(rapport.mode).toBe('rotation')
      expect(rapport.chemin.replace(/\\/g, '/')).toContain(
        `.autowin-tmp/${fil}/tanuki-fixe-apercu.gif`
      )
      expect(compterImagesGif(readFileSync(rapport.chemin))).toBe(6)
      rmSync(dirname(rapport.chemin), { recursive: true, force: true })
    },
    300_000
  )
})
