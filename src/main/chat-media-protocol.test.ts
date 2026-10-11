import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { ChatArtifact } from '../shared/artifacts'
import { chatMediaUrl, isChatMediaUrl, parseChatMediaUrl } from '../shared/chat-media'
import type { Conversation } from './store/conversations'
import { materializeChatArtifact } from './store/chat-artifact-store'

vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }
}))

const { plageMedia, reponseMedia, resoudreMediaConserve, servirMediaDuFil } =
  await import('./chat-media-protocol')

/**
 * Kaizen conv-260 (tour 41ab69ad-0ff8-4a45-8ecd-efb9be30e4a2) : une pub de 74,6 Mo ne pouvait
 * s'ouvrir dans aucun lecteur du fil, parce que la seule voie était une copie base64 plafonnée à
 * 16 Mo. Ces tests tiennent la nouvelle voie : lecture par plages, sous les mêmes gardes.
 */

function fichier(octets: number, nom = 'pub.mp4'): string {
  const dossier = mkdtempSync(join(tmpdir(), 'kz-media-'))
  const chemin = join(dossier, nom)
  writeFileSync(chemin, Buffer.from(Array.from({ length: octets }, (_, i) => i % 251)))
  return chemin
}

describe('adresse autowin-media', () => {
  it('aller-retour fidèle, y compris avec des caractères réservés', () => {
    const url = chatMediaUrl('conv-260', 'tour/41ab', 'artifact-a b#c')
    expect(isChatMediaUrl(url)).toBe(true)
    expect(parseChatMediaUrl(url)).toEqual({
      conversationId: 'conv-260',
      turnId: 'tour/41ab',
      artifactId: 'artifact-a b#c'
    })
  })

  it('refuse une adresse étrangère ou incomplète', () => {
    expect(parseChatMediaUrl('file:///C:/secret.mp4')).toBeUndefined()
    expect(parseChatMediaUrl('autowin-media://artefact/conv/tour')).toBeUndefined()
    expect(isChatMediaUrl('data:video/mp4;base64,AAAA')).toBe(false)
  })
})

describe('plageMedia', () => {
  it('sans en-tête : fichier entier en 200', () => {
    expect(plageMedia(undefined, 100)).toEqual({ statut: 200, debut: 0, fin: 99 })
  })
  it('plage ouverte, fermée, suffixe, bornée à la fin', () => {
    expect(plageMedia('bytes=10-', 100)).toEqual({ statut: 206, debut: 10, fin: 99 })
    expect(plageMedia('bytes=10-19', 100)).toEqual({ statut: 206, debut: 10, fin: 19 })
    expect(plageMedia('bytes=-5', 100)).toEqual({ statut: 206, debut: 95, fin: 99 })
    expect(plageMedia('bytes=90-500', 100)).toEqual({ statut: 206, debut: 90, fin: 99 })
  })
  it('début au-delà de la fin : 416 ; en-tête illisible : ignorée', () => {
    expect(plageMedia('bytes=100-', 100)).toEqual({ statut: 416 })
    expect(plageMedia('octets=1-2', 100)).toEqual({ statut: 200, debut: 0, fin: 99 })
    expect(plageMedia('bytes=20-10', 100)).toEqual({ statut: 200, debut: 0, fin: 99 })
  })
})

describe('reponseMedia', () => {
  it('sert exactement les octets demandés, avec Content-Range', async () => {
    const chemin = fichier(1000)
    const reponse = reponseMedia({ chemin, mimeType: 'video/mp4' }, 'bytes=100-199')
    expect(reponse.status).toBe(206)
    expect(reponse.headers.get('content-range')).toBe('bytes 100-199/1000')
    expect(reponse.headers.get('content-length')).toBe('100')
    expect(reponse.headers.get('accept-ranges')).toBe('bytes')
    expect(reponse.headers.get('content-type')).toBe('video/mp4')
    const octets = new Uint8Array(await reponse.arrayBuffer())
    expect(octets.length).toBe(100)
    expect(octets[0]).toBe(100 % 251)
    expect(octets[99]).toBe(199 % 251)
  })

  it('un fichier de plus de 16 Mo est servi, pas refusé', async () => {
    const chemin = fichier(17 * 1024 * 1024)
    const reponse = reponseMedia({ chemin, mimeType: 'video/mp4' }, 'bytes=16777216-')
    expect(reponse.status).toBe(206)
    expect(reponse.headers.get('content-range')).toBe(
      `bytes 16777216-${17 * 1024 * 1024 - 1}/${17 * 1024 * 1024}`
    )
    expect((await reponse.arrayBuffer()).byteLength).toBe(1024 * 1024)
  })

  it('416 avec la taille réelle quand la plage sort du fichier', () => {
    const reponse = reponseMedia({ chemin: fichier(10), mimeType: 'video/mp4' }, 'bytes=50-')
    expect(reponse.status).toBe(416)
    expect(reponse.headers.get('content-range')).toBe('bytes */10')
  })
})

describe('servirMediaDuFil', () => {
  const requete = (url: string, init?: RequestInit): Request => new Request(url, init)

  it('adresse invalide : 400 ; média non résolu : 404 ; méthode d’écriture : 405', () => {
    expect(servirMediaDuFil(requete('autowin-media://artefact/x'), () => undefined).status).toBe(
      400
    )
    expect(servirMediaDuFil(requete(chatMediaUrl('c', 't', 'a')), () => undefined).status).toBe(404)
    expect(
      servirMediaDuFil(requete(chatMediaUrl('c', 't', 'a'), { method: 'POST' }), () => undefined)
        .status
    ).toBe(405)
  })

  it('transmet le triplet exact au résolveur et la plage du navigateur', async () => {
    const chemin = fichier(50)
    const resoudre = vi.fn(() => ({ chemin, mimeType: 'video/mp4' }))
    const reponse = servirMediaDuFil(
      requete(chatMediaUrl('conv-260', 'tour', 'pub'), { headers: { Range: 'bytes=0-9' } }),
      resoudre
    )
    expect(resoudre).toHaveBeenCalledWith({
      conversationId: 'conv-260',
      turnId: 'tour',
      artifactId: 'pub'
    })
    expect(reponse.status).toBe(206)
    expect((await reponse.arrayBuffer()).byteLength).toBe(10)
  })
})

describe('resoudreMediaConserve', () => {
  function conversationAvec(artifact: ChatArtifact): Conversation {
    return {
      id: 'conv-260',
      title: 'pub',
      provider: 'claude',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          role: 'assistant',
          content: '',
          ts: 1,
          turnId: 'tour',
          parts: [{ kind: 'artifact', artifact }]
        }
      ]
    }
  }

  function carte(nom: string, chemin: string, kind: ChatArtifact['kind']): ChatArtifact {
    return {
      id: `id-${nom}`,
      name: nom,
      mimeType: kind === 'video' ? 'video/mp4' : 'image/png',
      kind,
      size: 0,
      createdAt: 1,
      path: chemin,
      source: { provider: 'autowin' }
    }
  }

  it('vidéo conservée dans le stockage du fil : résolue avec son type', () => {
    const base = mkdtempSync(join(tmpdir(), 'kz-media-base-'))
    const conservee = materializeChatArtifact(
      carte('pub.mp4', fichier(64), 'video'),
      'conv-260',
      'tour',
      base
    )
    expect(
      resoudreMediaConserve(
        conversationAvec(conservee),
        { conversationId: 'conv-260', turnId: 'tour', artifactId: conservee.id },
        base
      )
    ).toEqual({ chemin: conservee.path, mimeType: 'video/mp4' })
  })

  it('jumeau : une image conservée, ou une vidéo HORS du stockage, ne passe pas', () => {
    const base = mkdtempSync(join(tmpdir(), 'kz-media-base-'))
    const image = materializeChatArtifact(
      carte('capture.png', fichier(8, 'capture.png'), 'image'),
      'conv-260',
      'tour',
      base
    )
    expect(
      resoudreMediaConserve(
        conversationAvec(image),
        { conversationId: 'conv-260', turnId: 'tour', artifactId: image.id },
        base
      )
    ).toBeUndefined()
    const dehors = carte('pub.mp4', fichier(64), 'video')
    expect(
      resoudreMediaConserve(
        conversationAvec(dehors),
        { conversationId: 'conv-260', turnId: 'tour', artifactId: dehors.id },
        base
      )
    ).toBeUndefined()
  })
})
