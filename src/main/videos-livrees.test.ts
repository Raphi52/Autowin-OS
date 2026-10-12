import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatArtifact } from '../shared/artifacts'
import { cheminsVideoCites, cleDeVideo, videosLivreesDuTour } from './videos-livrees'

/**
 * LA VIDÉO FABRIQUÉE PENDANT LE TOUR ARRIVE DANS LE LECTEUR SANS QU'ON LE DEMANDE (conv-253,
 * 2026-10-11).
 *
 * Constat (conv-260, ~22:10) : l'agent rend `D:\Autowin\.autowin-tmp\pub\autowin-os-pub-v2.mp4`
 * par ffmpeg puis écrit seulement son chemin ; l'utilisateur doit taper « /kaizen tu dois me la
 * montrer dans un lecteur ». Une IMAGE lue arrive seule dans le fil (`claude.ts`, bloc image du
 * résultat d'outil) ; une vidéo n'y arrivait que par `show_video`, qu'il fallait penser à appeler.
 *
 * Pertinent = la réponse CITE une vidéo du dossier MODIFIÉE pendant le tour. Une vidéo ancienne
 * simplement nommée ne déclenche rien ; une vidéo déjà montrée ne revient pas.
 */

let racine: string
const debut = Date.now()

function video(rel: string, ancienne = false): string {
  const chemin = join(racine, rel)
  mkdirSync(join(chemin, '..'), { recursive: true })
  writeFileSync(chemin, 'octets')
  if (ancienne) {
    const passe = new Date(debut - 3_600_000)
    utimesSync(chemin, passe, passe)
  }
  return chemin
}

const preparerOk = vi.fn(async (args: Record<string, unknown>) => ({
  ok: true as const,
  artifact: {
    id: `carte-${String(args.path)}`,
    name: String(args.path).split(/[\\/]/).pop() ?? 'v.mp4',
    mimeType: 'video/mp4',
    kind: 'video',
    size: 6,
    createdAt: 1,
    path: String(args.path)
  } as ChatArtifact,
  resume: {}
}))

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'videos-livrees-'))
  preparerOk.mockClear()
})
afterEach(() => rmSync(racine, { recursive: true, force: true }))

describe('cheminsVideoCites — lire les chemins de vidéo dans une réponse', () => {
  it('trouve un chemin Windows en gras + code, un relatif, un chemin de shell /d/', () => {
    const texte =
      'La pub est prête : **`D:\\Autowin\\.autowin-tmp\\pub\\autowin-os-pub-v2.mp4`**.\n' +
      'Aperçu : artifacts/video-b6-clavier/film.webm, et /d/Autowin/out/essai.mov ; fin.'
    expect(cheminsVideoCites(texte)).toEqual([
      'D:\\Autowin\\.autowin-tmp\\pub\\autowin-os-pub-v2.mp4',
      'artifacts/video-b6-clavier/film.webm',
      'D:/Autowin/out/essai.mov'
    ])
  })

  it('ignore un nom sans extension vidéo, une image, et une ponctuation finale', () => {
    expect(cheminsVideoCites('voir planche.png, notes.txt et rendu.mp4.')).toEqual(['rendu.mp4'])
  })

  it('ne lit pas le chemin d’une commande <cmd> : show_video s’en charge déjà', () => {
    const texte =
      'Je la montre. <cmd>{"name":"show_video","args":{"path":"out/film.mp4"}}</cmd> Voilà.'
    expect(cheminsVideoCites(texte)).toEqual([])
  })

  it('dédoublonne un même chemin cité deux fois', () => {
    expect(cheminsVideoCites('`out/a.mp4` puis encore out/a.mp4')).toEqual(['out/a.mp4'])
  })
})

describe('videosLivreesDuTour — quelle vidéo montrer', () => {
  it('montre une vidéo du dossier modifiée pendant le tour', async () => {
    const chemin = video('out/pub.mp4')
    const cartes = await videosLivreesDuTour(
      `La pub est prête : \`${chemin}\``,
      racine,
      debut,
      new Set(),
      preparerOk
    )
    expect(cartes.map((c) => c.kind)).toEqual(['video'])
    expect(preparerOk).toHaveBeenCalledWith({ path: chemin }, racine)
  })

  it('ne montre PAS une vidéo ancienne simplement citée (la v1 « restée à côté »)', async () => {
    const ancienne = video('out/pub-v1.mp4', true)
    const cartes = await videosLivreesDuTour(
      `La v1 est restée à côté : ${ancienne}`,
      racine,
      debut,
      new Set(),
      preparerOk
    )
    expect(cartes).toEqual([])
    expect(preparerOk).not.toHaveBeenCalled()
  })

  it('résout un chemin relatif au dossier du tour', async () => {
    video('out/relatif.mp4')
    const cartes = await videosLivreesDuTour('rendu : out/relatif.mp4', racine, debut, new Set(), preparerOk)
    expect(cartes).toHaveLength(1)
  })

  it('ne remontre pas une vidéo déjà montrée ce tour, et retient celle qu’il montre', async () => {
    const chemin = video('out/deja.mp4')
    const dejaMontrees = new Set([cleDeVideo(chemin)])
    expect(await videosLivreesDuTour(chemin, racine, debut, dejaMontrees, preparerOk)).toEqual([])

    const autre = video('out/neuve.mp4')
    const vues = new Set<string>()
    await videosLivreesDuTour(autre, racine, debut, vues, preparerOk)
    expect(vues.has(cleDeVideo(autre))).toBe(true)
    expect(await videosLivreesDuTour(autre, racine, debut, vues, preparerOk)).toEqual([])
  })

  it('laisse à show_video la vidéo qu’il montre dans la MÊME réponse (pas deux lecteurs)', async () => {
    const chemin = video('out/doublon.mp4')
    const texte = `Voici \`${chemin}\`. <cmd>${JSON.stringify({ name: 'show_video', args: { path: chemin } })}</cmd>`
    expect(await videosLivreesDuTour(texte, racine, debut, new Set(), preparerOk)).toEqual([])
    const relatif = `Voici out/doublon.mp4 <cmd>{"name":"show_video","args":{"path":"out/doublon.mp4"}}</cmd>`
    expect(await videosLivreesDuTour(relatif, racine, debut, new Set(), preparerOk)).toEqual([])
  })

  it('une préparation qui LÈVE ne fait pas échouer le tour : la vidéo suivante passe', async () => {
    const casse = video('out/casse.mp4')
    const bonne = video('out/bonne.mp4')
    const preparer = vi.fn(async (args: Record<string, unknown>) => {
      if (String(args.path) === casse) throw new Error('ffprobe a planté')
      return preparerOk(args)
    })
    const cartes = await videosLivreesDuTour(`${casse} ${bonne}`, racine, debut, new Set(), preparer)
    expect(cartes.map((c) => c.path)).toEqual([bonne])
  })

  it('un fichier absent ou un refus de show_video ne fait rien, sans lever', async () => {
    const refus = vi.fn(async () => ({ ok: false as const, raison: 'hors du dossier' }))
    const chemin = video('out/refusee.mp4')
    expect(
      await videosLivreesDuTour(`${chemin} et out/absente.mp4`, racine, debut, new Set(), refus)
    ).toEqual([])
    expect(refus).toHaveBeenCalledTimes(1)
  })

  it('borne à 3 cartes par réponse', async () => {
    const chemins = ['a', 'b', 'c', 'd', 'e'].map((n) => video(`out/${n}.mp4`))
    const cartes = await videosLivreesDuTour(chemins.join(' '), racine, debut, new Set(), preparerOk)
    expect(cartes).toHaveLength(3)
  })

  it('sans dossier de travail, ne montre rien', async () => {
    const chemin = video('out/x.mp4')
    expect(await videosLivreesDuTour(chemin, '', debut, new Set(), preparerOk)).toEqual([])
  })
})
