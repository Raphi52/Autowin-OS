import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppCommandBus } from './commands'
import { ConversationStore } from './store/conversations'
import { materializeChatArtifact } from './store/chat-artifact-store'
import { preparerVideoAMontrer } from './show-video-command'
import { mesurerVideo, type MesureVideo } from './video-ffprobe'

// ffprobe est remplacé : le faux MP4 du test n'est pas une vraie vidéo, et la suite ne doit pas
// dépendre du binaire du poste. Sa lecture réelle est couverte par `video-ffprobe.test.ts`.
vi.mock('./video-ffprobe', () => ({ mesurerVideo: vi.fn() }))
const mesure = vi.mocked(mesurerVideo)
const MESURE_B6: MesureVideo = { ok: true, fps: 30, images: 1188 }

/**
 * MONTRER UNE VIDÉO DANS LE FIL (conv-253, 2026-10-11).
 *
 * Avant : un MP4 fabriqué par une commande shell (ffmpeg) n'arrivait JAMAIS dans le fil — une carte
 * ne naît que d'un bloc image/fichier d'un outil natif ou d'une capture IMAGE de commande. Le dossier
 * `chat-artifacts/conv-253-…` contenait 23 PNG et aucun MP4.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER une mauvaise correction :
 * - la vidéo passée dans `attachments` partirait au modèle IA (`agent-pilot.ts`, commandAttachments) ;
 * - un chemin hors du dossier de travail écarté SANS raison (`normalizeProviderArtifacts` le saute
 *   en silence) ;
 * - la copie conservée par le fil qui ÉCRASE le chemin d'origine (l'agent recevrait
 *   `.autowin-data/chat-artifacts/…/artifact-….mp4` au lieu du film à modifier).
 */
function espace(prefixe: string): string {
  return resolve(mkdtempSync(join(tmpdir(), `autowin-${prefixe}-`)))
}

const OCTETS_FILM = 'FAUX-MP4-OCTETS-QUI-NE-DOIVENT-PAS-PARTIR'

function monter(): { bus: AppCommandBus; conv: string; projet: string } {
  const projet = espace('video')
  let horloge = 1000
  const conversations = new ConversationStore(() => horloge++)
  const bus = new AppCommandBus(
    {
      conversations,
      executionWorkspace: espace('global'),
      getWorktreeRuntimeStatus: () => ({ available: false, workspacePath: projet }),
      getWorktreeConflictDiff: async () => ({ available: false, reason: 'not-conflict' })
    } as never,
    () => undefined
  )
  const conversation = conversations.create({ title: 'fil', provider: 'claude' })
  conversations.rangerDansDossier(conversation.id, projet)
  mkdirSync(join(projet, 'artifacts', 'b6'), { recursive: true })
  writeFileSync(join(projet, 'artifacts', 'b6', 'film.mp4'), OCTETS_FILM)
  writeFileSync(join(projet, 'notes.txt'), 'texte')
  writeFileSync(join(projet, 'lignes.json'), '[]')
  return { bus, conv: conversation.id, projet }
}

beforeEach(() => {
  mesure.mockReset()
  mesure.mockResolvedValue(MESURE_B6)
})

describe('show_video — une vidéo du dossier de travail devient une carte du fil', () => {
  it('un .mp4 du dossier produit une carte `video` avec son chemin et les images/s MESURÉES', async () => {
    const { bus, conv, projet } = monter()
    const r = await bus.exec('show_video', { path: 'artifacts/b6/film.mp4' }, conv)
    expect(r.ok).toBe(true)
    expect(r.artifacts).toHaveLength(1)
    expect(mesure).toHaveBeenCalledWith(join(projet, 'artifacts', 'b6', 'film.mp4'))
    const carte = r.artifacts![0]
    expect(carte).toMatchObject({
      kind: 'video',
      mimeType: 'video/mp4',
      name: 'film.mp4',
      size: OCTETS_FILM.length,
      fps: 30,
      images: 1188,
      path: join(projet, 'artifacts', 'b6', 'film.mp4'),
      source: { tool: 'show_video', originalPath: join(projet, 'artifacts', 'b6', 'film.mp4') }
    })
    expect(carte.content).toBeUndefined()
  })

  it('aucun octet de la vidéo ne part au modèle IA : rien dans `attachments` ni dans `data`', async () => {
    const { bus, conv } = monter()
    const r = await bus.exec('show_video', { path: 'artifacts/b6/film.mp4' }, conv)
    expect(r.ok).toBe(true)
    expect(r.attachments).toBeUndefined()
    const versLeModele = JSON.stringify({ data: r.data, attachments: r.attachments })
    expect(versLeModele).not.toContain(OCTETS_FILM)
    expect(versLeModele).not.toContain(Buffer.from(OCTETS_FILM).toString('base64'))
  })

  it('la copie conservée par le fil GARDE le chemin d’origine (celui que la référence cite)', async () => {
    const { bus, conv, projet } = monter()
    const r = await bus.exec('show_video', { path: 'artifacts/b6/film.mp4' }, conv)
    const conservee = materializeChatArtifact(r.artifacts![0], conv, 'tour-1', espace('donnees'))
    expect(conservee.path).not.toBe(join(projet, 'artifacts', 'b6', 'film.mp4'))
    expect(conservee.source.originalPath).toBe(join(projet, 'artifacts', 'b6', 'film.mp4'))
  })

  it('le même fichier montré deux fois donne une carte par appel, sans erreur', async () => {
    const { bus, conv } = monter()
    const a = await bus.exec('show_video', { path: 'artifacts/b6/film.mp4' }, conv)
    const b = await bus.exec('show_video', { path: 'artifacts/b6/film.mp4' }, conv)
    expect(a.ok && b.ok).toBe(true)
    expect(a.artifacts).toHaveLength(1)
    expect(b.artifacts).toHaveLength(1)
  })

  it.each([
    ['chemin absent', {}, /chemin manquant/],
    ['chemin vide', { path: '   ' }, /chemin manquant/],
    ['hors du dossier (..)', { path: '../ailleurs.mp4' }, /hors du dossier de travail/],
    ['fichier absent', { path: 'artifacts/b6/absent.mp4' }, /introuvable/],
    ['dossier', { path: 'artifacts/b6' }, /pas un fichier/],
    ['pas une vidéo (.txt)', { path: 'notes.txt' }, /pas une vidéo/],
    ['pas une vidéo (.json)', { path: 'lignes.json' }, /pas une vidéo/]
  ])('refus NOMMÉ : %s', async (_cas, args, raison) => {
    const { bus, conv } = monter()
    const r = await bus.exec('show_video', args, conv)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(raison)
    expect(r.artifacts).toBeUndefined()
    // Un refus ne lance pas ffprobe : il n'y a rien à mesurer.
    expect(mesure).not.toHaveBeenCalled()
  })

  it('ffprobe en échec : la carte est montrée SANS images/s, et l’agent lit « 30 supposé »', async () => {
    mesure.mockResolvedValue({ ok: false, raison: 'ffprobe introuvable sur ce poste' })
    const { bus, conv } = monter()
    const r = await bus.exec('show_video', { path: 'artifacts/b6/film.mp4' }, conv)
    expect(r.ok).toBe(true)
    expect(r.artifacts![0].fps).toBeUndefined()
    expect(r.artifacts![0].images).toBeUndefined()
    expect(JSON.stringify(r.data)).toMatch(/ffprobe introuvable sur ce poste/)
    expect(JSON.stringify(r.data)).toMatch(/30 supposé/)
  })

  it('ffprobe répond SANS flux vidéo (son seul, ou texte renommé illisible) : refus NOMMÉ, pas de carte', async () => {
    // Relevé avec ffprobe 8.0.1 : .mp4 son seul = code 0 + `streams: []` ; texte renommé en .mp4 =
    // code 1 + « Invalid data… ». `mesurerVideo` rend `sansFluxVideo` dans les deux cas.
    // fix-ok: conv-253 — preparerVideoAMontrer rangeait ce cas avec les échecs d'ffprobe (lecteur
    // vide, « 30 supposé ») ; refus retiré de show-video-command.ts = ce test rouge (code 1).
    mesure.mockResolvedValue({ ok: false, sansFluxVideo: true, raison: 'aucun flux vidéo trouvé' })
    const { bus, conv } = monter()
    const r = await bus.exec('show_video', { path: 'artifacts/b6/film.mp4' }, conv)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/artifacts\/b6\/film\.mp4 ne contient aucune image vidéo/)
    expect(r.artifacts).toBeUndefined()
  })

  it('refus NOMMÉ : chemin absolu hors du dossier de travail', async () => {
    const { bus, conv } = monter()
    const ailleurs = espace('ailleurs')
    writeFileSync(join(ailleurs, 'x.mp4'), OCTETS_FILM)
    const r = await bus.exec('show_video', { path: join(ailleurs, 'x.mp4') }, conv)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/hors du dossier de travail/)
  })
})

describe('preparerVideoAMontrer — bornes', () => {
  it('le `fps` donné par l’agent ne compte pas : seule la mesure d’ffprobe fait foi', async () => {
    const { projet } = monter()
    mesure.mockResolvedValue({ ok: true, fps: 25 })
    const mesuree = await preparerVideoAMontrer({ path: 'artifacts/b6/film.mp4', fps: 60 }, projet)
    expect(mesuree.ok && mesuree.artifact.fps).toBe(25)
    // Jumeau : ffprobe en échec, le 60 de l'agent ne masque pas l'échec (« 30 supposé » au lecteur).
    mesure.mockResolvedValue({ ok: false, raison: 'ffprobe a échoué (code 1)' })
    const supposee = await preparerVideoAMontrer({ path: 'artifacts/b6/film.mp4', fps: 60 }, projet)
    expect(supposee.ok).toBe(true)
    if (supposee.ok) expect(supposee.artifact.fps).toBeUndefined()
  })

  it('au-delà de la limite de conservation (256 Mo) : refus nommé AVANT la copie, pas de carte', async () => {
    const { projet } = monter()
    const trop = await preparerVideoAMontrer(
      { path: 'artifacts/b6/film.mp4' },
      projet,
      OCTETS_FILM.length - 1
    )
    expect(trop).toMatchObject({ ok: false })
    if (!trop.ok) expect(trop.raison).toMatch(/256 Mo|limite/)
    // Jumeau accepté : pile à la limite, la carte est créée.
    expect(
      (await preparerVideoAMontrer({ path: 'artifacts/b6/film.mp4' }, projet, OCTETS_FILM.length))
        .ok
    ).toBe(true)
  })
})
