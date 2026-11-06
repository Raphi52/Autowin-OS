import { describe, expect, it } from 'vitest'
import { lireSortieFfprobe, mesurerVideo, type ExecuteurFfprobe } from './video-ffprobe'

/**
 * MESURER LES IMAGES/S D'UNE VIDÉO AVEC FFPROBE (conv-253, 2026-10-11 : « ffprobe en échec = 30 i/s
 * affiché comme supposé »).
 *
 * Sorties RELEVÉES avec ffprobe 8.0.1 (`-v error -select_streams v:0 -show_entries
 * stream=r_frame_rate,nb_frames -of json`) :
 * - film B6 : code 0, `r_frame_rate "30/1"`, `nb_frames "1188"` ;
 * - `lignes.json` (pas une vidéo) : code 0 et `streams: []` — le code de sortie NE SUFFIT PAS ;
 * - .mp4 / .webm son seul : code 0 et `streams: []` ;
 * - texte, JSON, script ou octets renommés en .mp4 / .webm / .mov : code 1 et « Invalid data found
 *   when processing input » sur stderr ;
 * - fichier absent : code 1, `{}`.
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER une mauvaise lecture : `0/0` (flux sans cadence) pris pour
 * un nombre, une liste de flux vide sous code 0 prise pour un succès.
 */
const SORTIE_B6 = JSON.stringify({
  programs: [],
  stream_groups: [],
  streams: [{ r_frame_rate: '30/1', avg_frame_rate: '30/1', nb_frames: '1188' }]
})
const SORTIE_SANS_FLUX = JSON.stringify({ programs: [], stream_groups: [], streams: [] })

function executeurQuiRend(stdout: string): ExecuteurFfprobe {
  return async () => ({ stdout })
}

function executeurQuiEchoue(erreur: Record<string, unknown>): ExecuteurFfprobe {
  return async () => {
    throw Object.assign(new Error(String(erreur.message ?? 'échec')), erreur)
  }
}

describe('lireSortieFfprobe', () => {
  it('cas nominal (film B6) : 30 i/s et 1188 images', () => {
    expect(lireSortieFfprobe(SORTIE_B6)).toEqual({ ok: true, fps: 30, images: 1188 })
  })

  it('cadence fractionnaire NTSC (30000/1001) : 29,97 i/s', () => {
    const r = lireSortieFfprobe(JSON.stringify({ streams: [{ r_frame_rate: '30000/1001' }] }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fps).toBeCloseTo(29.97, 2)
      expect(r.images).toBeUndefined()
    }
  })

  it('`0/0` : échec nommé, pas une cadence de 0 ni NaN — le flux vidéo existe, donc pas un refus', () => {
    const r = lireSortieFfprobe(JSON.stringify({ streams: [{ r_frame_rate: '0/0' }] }))
    expect(r).toMatchObject({ ok: false })
    expect(r).not.toHaveProperty('sansFluxVideo')
    if (!r.ok) expect(r.raison).toMatch(/cadence/)
  })

  it('liste de flux vide sous code 0 (.mp4 / .webm son seul) : `sansFluxVideo`, pas un échec d’ffprobe', () => {
    // fix-ok: conv-253 — lireSortieFfprobe confondait `streams: []` sous code 0 (réponse « pas de
    // vidéo », mesurée) avec un échec d'ffprobe ; sans `sansFluxVideo`, ce test et son jumeau de
    // mesurerVideo sont rouges (code 1, 2 tests), verts avec.
    const r = lireSortieFfprobe(SORTIE_SANS_FLUX)
    expect(r).toEqual({ ok: false, sansFluxVideo: true, raison: 'aucun flux vidéo trouvé' })
  })

  it('sortie illisible ou sans liste de flux : échec nommé, jamais `sansFluxVideo`', () => {
    expect(lireSortieFfprobe('pas du json')).toMatchObject({ ok: false })
    expect(lireSortieFfprobe('pas du json')).not.toHaveProperty('sansFluxVideo')
    // Jumeau de la liste vide : `{}` ne DIT pas qu'il n'y a aucun flux vidéo.
    expect(lireSortieFfprobe('{}')).toMatchObject({ ok: false })
    expect(lireSortieFfprobe('{}')).not.toHaveProperty('sansFluxVideo')
  })

  it('cadence hors bornes (> 240 i/s) : échec ; nb_frames absurde ignoré, cadence gardée', () => {
    expect(
      lireSortieFfprobe(JSON.stringify({ streams: [{ r_frame_rate: '1000/1' }] }))
    ).toMatchObject({ ok: false })
    expect(
      lireSortieFfprobe(JSON.stringify({ streams: [{ r_frame_rate: '25/1', nb_frames: 'N/A' }] }))
    ).toEqual({ ok: true, fps: 25 })
    expect(
      lireSortieFfprobe(JSON.stringify({ streams: [{ r_frame_rate: '25/1', nb_frames: '0' }] }))
    ).toEqual({ ok: true, fps: 25 })
  })

  it('vidéo d’une seule image : 1 image', () => {
    expect(
      lireSortieFfprobe(JSON.stringify({ streams: [{ r_frame_rate: '30/1', nb_frames: '1' }] }))
    ).toEqual({ ok: true, fps: 30, images: 1 })
  })

  it.each([
    ['PNG renommé en .mp4 ou .webm', 'png_pipe', '25/1', undefined],
    ['JPEG renommé en .mp4', 'jpeg_pipe', '25/1', undefined],
    ['GIF animé renommé en .mp4 ou .mov', 'gif', '10/1', '5']
  ])(
    'image fixe ou animée (%s, format lu « %s ») : `sansFluxVideo`, jamais une cadence mesurée',
    (_cas, format, rFrameRate, nbFrames) => {
      // fix-ok: conv-253 — relevé avec ffprobe 8.0.1 : une image renommée sort en code 0 avec UN flux
      // vidéo (`png_pipe`/`jpeg_pipe` à 25/1, `gif` à 10/1 et 5 images) ; lireSortieFfprobe prenait
      // tout premier flux et rendait 25 i/s « mesuré » sur un lecteur mort. Rouge (code 1) sans la
      // lecture de `format_name`, vert avec.
      const r = lireSortieFfprobe(
        JSON.stringify({
          streams: [{ r_frame_rate: rFrameRate, ...(nbFrames ? { nb_frames: nbFrames } : {}) }],
          format: { format_name: format }
        })
      )
      expect(r).toMatchObject({ ok: false, sansFluxVideo: true })
      if (!r.ok) expect(r.raison).toContain(format)
    }
  )

  it.each([
    [
      'film B6 (.mp4)',
      'mov,mp4,m4a,3gp,3g2,mj2',
      '30/1',
      '1188',
      { ok: true, fps: 30, images: 1188 }
    ],
    [
      'vidéo d’une seule image (.mp4)',
      'mov,mp4,m4a,3gp,3g2,mj2',
      '30/1',
      '1',
      { ok: true, fps: 30, images: 1 }
    ],
    ['.mov', 'mov,mp4,m4a,3gp,3g2,mj2', '24/1', '24', { ok: true, fps: 24, images: 24 }],
    ['.webm', 'matroska,webm', '25/1', undefined, { ok: true, fps: 25 }]
  ])(
    'jumeau — vrai conteneur vidéo (%s, format lu « %s ») : cadence mesurée',
    (_cas, format, rFrameRate, nbFrames, attendu) => {
      expect(
        lireSortieFfprobe(
          JSON.stringify({
            streams: [{ r_frame_rate: rFrameRate, ...(nbFrames ? { nb_frames: nbFrames } : {}) }],
            format: { format_name: format }
          })
        )
      ).toEqual(attendu)
    }
  )
})

describe('mesurerVideo — chaque échec d’ffprobe est nommé, jamais levé', () => {
  it('lance ffprobe sur le premier VRAI flux vidéo (pochette exclue) et demande le format lu', async () => {
    // Relevé avec ffprobe 8.0.1 sur un .mp4 son + pochette PNG : `v:0` rend la pochette à 90000/1
    // (« 30 supposé » sur un lecteur sans image) ; `V:0` exclut les pochettes et rend `streams: []`.
    const appels: string[][] = []
    const r = await mesurerVideo('D:\\film.mp4', async (args) => {
      appels.push(args)
      return { stdout: SORTIE_B6 }
    })
    expect(r).toEqual({ ok: true, fps: 30, images: 1188 })
    expect(appels[0]).toEqual(
      expect.arrayContaining([
        '-select_streams',
        'V:0',
        '-show_entries',
        'format=format_name:stream=r_frame_rate,nb_frames',
        'D:\\film.mp4'
      ])
    )
    expect(appels[0]).not.toContain('v:0')
  })

  it('liste de flux vide sous code 0 : ffprobe a répondu « pas de vidéo » (`sansFluxVideo`)', async () => {
    expect(await mesurerVideo('x.mp4', executeurQuiRend(SORTIE_SANS_FLUX))).toMatchObject({
      ok: false,
      sansFluxVideo: true
    })
  })

  it('code de sortie non nul : échec nommé avec le code, pas `sansFluxVideo`', async () => {
    const r = await mesurerVideo(
      'x.mp4',
      executeurQuiEchoue({ code: 1, message: 'Command failed' })
    )
    expect(r).toMatchObject({ ok: false })
    expect(r).not.toHaveProperty('sansFluxVideo')
    if (!r.ok) expect(r.raison).toMatch(/code 1/)
  })

  it('ffprobe absent du poste (ENOENT) : échec nommé, pas `sansFluxVideo`', async () => {
    const r = await mesurerVideo('x.mp4', executeurQuiEchoue({ code: 'ENOENT', message: 'spawn' }))
    expect(r).toMatchObject({ ok: false })
    expect(r).not.toHaveProperty('sansFluxVideo')
    if (!r.ok) expect(r.raison).toMatch(/introuvable/)
  })

  it('code non nul + « Invalid data found when processing input » (texte, JSON, octets renommés) : `sansFluxVideo`', async () => {
    // Relevé avec ffprobe 8.0.1 : texte, JSON, script et octets au hasard renommés en .mp4, et texte
    // renommé en .webm / .mov, sortent TOUS avec le code 1 et ce message sur stderr — jamais code 0.
    const illisible = await mesurerVideo(
      'texte.mp4',
      executeurQuiEchoue({
        code: 1,
        message: 'Command failed',
        stderr:
          '[mov,mp4,m4a,3gp,3g2,mj2 @ 0000018bf67a72c0] moov atom not found\r\ntexte.mp4: Invalid data found when processing input\r\n'
      })
    )
    expect(illisible).toMatchObject({ ok: false, sansFluxVideo: true })
    if (!illisible.ok) expect(illisible.raison).toMatch(/Invalid data found when processing input/)
    // Jumeau, même code 1 : un autre message (fichier disparu entre-temps) reste un échec d'ffprobe.
    const autre = await mesurerVideo(
      'x.mp4',
      executeurQuiEchoue({
        code: 1,
        message: 'Command failed',
        stderr: 'x.mp4: No such file or directory\r\n'
      })
    )
    expect(autre).toMatchObject({ ok: false })
    expect(autre).not.toHaveProperty('sansFluxVideo')
  })

  it('délai dépassé (processus tué) : échec nommé, pas `sansFluxVideo`', async () => {
    const r = await mesurerVideo(
      'x.mp4',
      executeurQuiEchoue({ killed: true, signal: 'SIGTERM', code: null, message: 'timeout' })
    )
    expect(r).toMatchObject({ ok: false })
    expect(r).not.toHaveProperty('sansFluxVideo')
    if (!r.ok) expect(r.raison).toMatch(/pas répondu/)
  })
})
