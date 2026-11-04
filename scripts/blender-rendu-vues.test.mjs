import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { BLENDER_DEFAUT, lireArguments } from './blender-rendu-vues.mjs'

vi.setConfig({ testTimeout: 180_000 })
const SCRIPT = fileURLToPath(new URL('./blender-rendu-vues.mjs', import.meta.url))
const racine = mkdtempSync(join(tmpdir(), 'blender-rendu-vues-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))

/** Largeur et hauteur lues dans l'en-tête IHDR d'un PNG. */
const taillePng = (f) => {
  const b = readFileSync(f)
  expect(b.subarray(1, 4).toString()).toBe('PNG')
  return { l: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

describe('lireArguments', () => {
  it('refuse sans source, et accepte --blend', () => {
    expect(() => lireArguments([])).toThrow(/--blend/)
    expect(lireArguments(['--blend', 'a.blend', '--fil', 'conv-1']).fil).toBe('conv-1')
  })
  it('refuse --blend et --mcp ensemble, accepte --mcp seul', () => {
    expect(() => lireArguments(['--mcp', '--blend', 'a.blend'])).toThrow(/exclusifs/)
    expect(lireArguments(['--mcp']).mcp).toBe(true)
  })
  it('refuse une taille hors bornes, accepte la borne', () => {
    expect(() => lireArguments(['--blend', 'a', '--taille', '63'])).toThrow(/taille/)
    expect(lireArguments(['--blend', 'a', '--taille', '64']).taille).toBe(64)
  })
  it('refuse un nom de fil qui sortirait du dossier', () => {
    expect(() => lireArguments(['--blend', 'a', '--fil', '../x'])).toThrow(/fil invalide/)
  })
})

describe.skipIf(!existsSync(BLENDER_DEFAUT))('rendu réel (Blender en arrière-plan)', () => {
  const blend = join(racine, 'cube.blend')
  // scène générée par script : un cube et une sphère décalée en X, pour que face et profil diffèrent
  const gen = spawnSync(
    BLENDER_DEFAUT,
    [
      '--background',
      '--factory-startup',
      '--python-expr',
      'import bpy\nbpy.ops.object.select_all(action="SELECT")\nbpy.ops.object.delete()\n' +
        'bpy.ops.mesh.primitive_cube_add(size=2)\nbpy.ops.mesh.primitive_uv_sphere_add(radius=0.7, location=(2,0,0))\n' +
        `bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(blend)})`
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 120_000 }
  )

  const lancer = (...extra) =>
    spawnSync(process.execPath, [SCRIPT, '--blend', blend, '--taille', '128', ...extra], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 170_000
    })

  it('rend les 3 vues et la planche, code 0', () => {
    expect(gen.status, gen.stderr).toBe(0)
    const sortie = join(racine, 'sans-ref')
    const r = lancer('--sortie', sortie)
    expect(r.status, r.stderr + r.stdout).toBe(0)
    const res = JSON.parse(r.stdout.trim().split('\n').pop())
    for (const n of ['face', 'trois-quarts', 'profil'])
      expect(taillePng(res.fichiers[n])).toEqual({ l: 128, h: 128 })
    expect(readFileSync(res.fichiers.face).equals(readFileSync(res.fichiers.profil))).toBe(false)
    expect(taillePng(res.planche)).toEqual({ l: 3 * 128 + 4 * 4, h: 128 + 2 * 4 })
    expect(res.images).toBe(3)
  })

  it('ajoute l’image de référence en tête de planche', () => {
    const ref = join(racine, 'sans-ref', 'face.png')
    const r = lancer('--sortie', join(racine, 'avec-ref'), '--reference', ref)
    expect(r.status, r.stderr + r.stdout).toBe(0)
    const res = JSON.parse(r.stdout.trim().split('\n').pop())
    expect(res.images).toBe(4)
    expect(taillePng(res.planche)).toEqual({ l: 4 * 128 + 5 * 4, h: 128 + 2 * 4 })
  })

  it('code 2 si le .blend manque', () => {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, '--blend', join(racine, 'absent.blend'), '--sortie', join(racine, 'x')],
      { encoding: 'utf8' }
    )
    expect(r.status).toBe(2)
  })
})
