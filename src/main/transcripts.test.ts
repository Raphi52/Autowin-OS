import { mkdtempSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ServiceTranscripts,
  dossierTranscripts,
  ligneTranscript,
  nomFichierTranscript
} from './transcripts'

const racine = (): string => mkdtempSync(join(tmpdir(), 'autowin-transcripts-'))

describe('enregistrements parles', () => {
  it('nomme un fichier par sa date, triable et valide sous Windows', () => {
    const nom = nomFichierTranscript(new Date(2026, 8, 1, 14, 32, 5).getTime())
    expect(nom).toBe('enregistrement-2026-09-01_14-32-05.txt')
    expect(nom).not.toMatch(/[:*?"<>|]/)
  })

  it('horodate chaque phrase figee', () => {
    expect(ligneTranscript(new Date(2026, 8, 1, 9, 4, 7).getTime(), '  bonjour  ')).toBe(
      '[09:04:07] bonjour\n'
    )
  })

  it('derive le dossier des donnees de l application', () => {
    expect(dossierTranscripts(join('C:', 'data'))).toBe(join('C:', 'data', 'transcripts'))
  })

  it('ECRIT AU FIL DE L EAU : la phrase est sur le disque avant la fin de la session', async () => {
    // LE DEFAUT REPARE : un transcript qui n'atterrit qu'a l'arret est perdu si l'app tombe apres
    // deux heures de reunion. On relit donc le fichier SANS avoir termine la session.
    const service = new ServiceTranscripts(racine())
    const session = await service.demarrer(new Date(2026, 8, 1, 14, 0, 0).getTime())
    await service.ajouter(session.id, 'premiere phrase', new Date(2026, 8, 1, 14, 0, 5).getTime())
    await service.ajouter(session.id, 'deuxieme phrase', new Date(2026, 8, 1, 14, 0, 9).getTime())

    const contenu = readFileSync(session.chemin, 'utf8')
    expect(contenu).toContain('[14:00:05] premiere phrase')
    expect(contenu).toContain('[14:00:09] deuxieme phrase')
    expect(contenu.indexOf('premiere')).toBeLessThan(contenu.indexOf('deuxieme'))
  })

  it('ne tronque rien : mille phrases restent mille lignes', async () => {
    // L'affichage plafonne (40 lignes lisibles) ; le disque, lui, garde TOUT.
    const service = new ServiceTranscripts(racine())
    const session = await service.demarrer(Date.now())
    for (let i = 0; i < 1_000; i += 1) await service.ajouter(session.id, `phrase ${i}`)
    const lignes = readFileSync(session.chemin, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('['))
    expect(lignes).toHaveLength(1_000)
  })

  it('refuse d ecrire pour une session inconnue', async () => {
    const service = new ServiceTranscripts(racine())
    await expect(service.ajouter('inexistante', 'coucou')).rejects.toThrow(/inconnu/i)
  })

  it('ignore une phrase vide', async () => {
    const service = new ServiceTranscripts(racine())
    const session = await service.demarrer(Date.now())
    await service.ajouter(session.id, '   ')
    expect(readFileSync(session.chemin, 'utf8')).not.toContain('[')
  })

  it('liste les derniers fichiers, le plus recent en tete', async () => {
    const dossier = racine()
    const service = new ServiceTranscripts(dossier)
    const ecrits: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const session = await service.demarrer(new Date(2026, 8, 1, 10 + i, 0, 0).getTime())
      await service.ajouter(session.id, `session ${i}`)
      ecrits.push(session.chemin)
    }
    // Des dates d'ecriture DISTINCTES : trois fichiers ecrits dans la meme milliseconde ne
    // prouveraient pas l'ordre.
    ecrits.forEach((chemin, i) => {
      const t = new Date(2026, 8, 1, 10 + i, 0, 0)
      utimesSync(chemin, t, t)
    })

    const liste = await service.lister()
    expect(liste.map((f) => f.nom)).toEqual([
      'enregistrement-2026-09-01_12-00-00.txt',
      'enregistrement-2026-09-01_11-00-00.txt',
      'enregistrement-2026-09-01_10-00-00.txt'
    ])
    expect(liste[0].octets).toBeGreaterThan(0)
    expect(await service.lister(2)).toHaveLength(2)
  })

  it('rend une liste vide quand rien n a jamais ete enregistre', async () => {
    const service = new ServiceTranscripts(join(racine(), 'jamais-cree'))
    expect(await service.lister()).toEqual([])
  })
})
