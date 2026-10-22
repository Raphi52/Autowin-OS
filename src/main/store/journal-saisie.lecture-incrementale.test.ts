/**
 * conv-1077 (2026-10-22) : `saisies-utilisateur.jsonl` (2,64 Mo) était relu EN ENTIER à chaque message
 * (`rattacherSaisieAuTour` via src/main/chat/run-pilot-chat.ts:250), à chaque ouverture de fil
 * (`lireOrientationsRattachees`, index.ts) et par le dossier kaizen — sur le fil principal. Disque
 * lent : 7 gels pour 56,2 s du 03/09 au 22/10, plus 4 lectures pour 26,7 s côté orientations.
 * Contrat : après une première lecture, un appel ne lit plus que les octets AJOUTÉS depuis.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const compteur = vi.hoisted(() => ({ octets: 0 }))

vi.mock('node:fs', async (importOriginal) => {
  const reel = await importOriginal<typeof import('node:fs')>()
  const readFileSync = ((...args: Parameters<typeof reel.readFileSync>) => {
    const r = reel.readFileSync(...args)
    compteur.octets += typeof r === 'string' ? Buffer.byteLength(r) : r.length
    return r
  }) as typeof reel.readFileSync
  const readSync = ((...args: Parameters<typeof reel.readSync>) => {
    const n = reel.readSync(...args)
    compteur.octets += n
    return n
  }) as typeof reel.readSync
  return { ...reel, default: { ...reel, readFileSync, readSync }, readFileSync, readSync }
})

import {
  journalSaisiePath,
  journaliserSaisie,
  lireOrientationsRattachees,
  lireSaisies,
  rattacherSaisieAuTour,
  saisieDuTour
} from './journal-saisie'

const ligne = (o: Record<string, unknown>): string => `${JSON.stringify(o)}\n`
const saisie = (ts: number, conversationId: string, texte: string, voie = 'message'): string =>
  ligne({ schema: 'autowin.saisie/v1', ts, conversationId, texte, voie })

describe('journal des saisies — lecture incrémentale (conv-1077)', () => {
  let racine: string
  let chemin: string
  beforeEach(() => {
    racine = mkdtempSync(join(tmpdir(), 'saisie-incr-'))
    chemin = journalSaisiePath(racine)
    // ~200 Ko de saisies d'AUTRES fils : le volume qu'on ne doit plus relire à chaque message.
    writeFileSync(
      chemin,
      Array.from({ length: 2000 }, (_, i) => saisie(i + 1, `conv-${i % 50}`, 'x'.repeat(60))).join(
        ''
      )
    )
  })
  afterEach(() => rmSync(racine, { recursive: true, force: true }))

  it('un second appel ne relit que les octets ajoutés depuis le premier', () => {
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST si le journal est encore relu en entier : 2 000 lignes
    // (~200 Ko) déjà lues, puis UNE ligne ajoutée — le second appel doit lire ~cette ligne, pas 200 Ko.
    expect(lireSaisies('conv-cible', racine)).toEqual([])
    const avant = statSync(chemin).size
    expect(
      journaliserSaisie({ conversationId: 'conv-cible', texte: 'nouveau', voie: 'message' }, racine)
    ).toBe(true)
    const ajout = statSync(chemin).size - avant
    compteur.octets = 0
    expect(lireSaisies('conv-cible', racine).map((s) => s.texte)).toEqual(['nouveau'])
    // + 256 : la relecture de l'en-tête qui détecte un fichier réécrit.
    expect(compteur.octets).toBeLessThanOrEqual(ajout + 256)
  })

  it('les trois lecteurs partagent la même lecture : rattacher, tour, orientations', () => {
    lireSaisies('conv-cible', racine)
    appendFileSync(chemin, saisie(9001, 'conv-cible', 'corrige le bouton', 'orientation'))
    compteur.octets = 0
    expect(rattacherSaisieAuTour('conv-cible', 'tour-1', 'corrige le bouton', racine)).toBe(true)
    expect(saisieDuTour('conv-cible', 'tour-1', racine)?.texte).toBe('corrige le bouton')
    expect(lireOrientationsRattachees('conv-cible', racine)).toEqual([
      { ts: 9001, texte: 'corrige le bouton', turnId: 'tour-1' }
    ])
    expect(compteur.octets).toBeLessThan(4096)
  })

  it('une ligne en cours d’écriture (sans fin de ligne) n’est lue qu’une fois complète', () => {
    lireSaisies('conv-cible', racine)
    const entiere = saisie(9002, 'conv-cible', 'phrase coupée')
    appendFileSync(chemin, entiere.slice(0, 30))
    expect(lireSaisies('conv-cible', racine)).toEqual([])
    appendFileSync(chemin, entiere.slice(30))
    expect(lireSaisies('conv-cible', racine).map((s) => s.texte)).toEqual(['phrase coupée'])
  })

  it('fichier réécrit (plus court ou autre contenu) : relu depuis le début, rien de l’ancien ne reste', () => {
    lireSaisies('conv-0', racine)
    writeFileSync(chemin, saisie(1, 'conv-0', 'seule'))
    expect(lireSaisies('conv-0', racine).map((s) => s.texte)).toEqual(['seule'])
    // Même longueur ou plus, autre contenu dès le début : relu aussi.
    writeFileSync(chemin, saisie(2, 'conv-0', 'autre') + saisie(3, 'conv-0', 'encore').repeat(20))
    expect(lireSaisies('conv-0', racine, 100).map((s) => s.ts)).toEqual([2, ...Array(20).fill(3)])
  })

  it('jumeau : sans fichier, liste vide ; recréé ensuite, il est lu', () => {
    rmSync(chemin)
    expect(lireSaisies('conv-0', racine)).toEqual([])
    expect(saisieDuTour('conv-0', 't', racine)).toBeUndefined()
    writeFileSync(chemin, saisie(5, 'conv-0', 'revenu'))
    expect(lireSaisies('conv-0', racine).map((s) => s.texte)).toEqual(['revenu'])
  })
})
