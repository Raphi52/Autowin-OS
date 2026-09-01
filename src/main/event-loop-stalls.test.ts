import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { surveillerBoucleEvenements, withSection, sectionEnCours } from './event-loop-stalls'

const attendre = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('detecteur de gel du processus principal', () => {
  it('nomme la section en cours pendant un travail synchrone', () => {
    expect(sectionEnCours()).toBeUndefined()
    const vu = withSection('snapshot-conversations', () => sectionEnCours())
    expect(vu).toBe('snapshot-conversations')
    expect(sectionEnCours()).toBeUndefined()
  })

  it('journalise un blocage synchrone reel de la boucle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stalls-'))
    const arreter = surveillerBoucleEvenements(dir, 120, 200)
    const fin = Date.now() + 350
    while (Date.now() < fin) {
      /* blocage synchrone volontaire */
    }
    await attendre(500)
    arreter()
    const fichier = join(dir, 'event-loop-stalls.jsonl')
    expect(existsSync(fichier)).toBe(true)
    const lignes = readFileSync(fichier, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lignes[0].type).toBe('event-loop-stall')
    expect(lignes[0].blocageMs).toBeGreaterThanOrEqual(120)
  })

  /*
   * ROUGE d'abord (2026-09-01). `monitorEventLoopDelay` est AVEUGLE sous Windows : mesure faite ici
   * meme, un blocage synchrone de 350 ms ressort a 31,8 ms d'histogramme (max), soit onze fois
   * moins. Un detecteur qui sous-declare a ce point ne peut ni franchir un seuil de 250 ms, ni
   * chiffrer un gel — il rend un journal vide en pretendant surveiller.
   *
   * ENTREE QUI FAIT TOMBER CE TEST SI LA CORRECTION EST FAUSSE : ce blocage de 350 ms. Une
   * correction en trompe-l'oeil (garder l'histogramme, abaisser le seuil) ecrirait bien une ligne
   * mais avec blocageMs ~= 32 — la borne DE DUREE ci-dessous, elle, ne peut pas etre atteinte
   * autrement qu'en mesurant le retard reel du reveil.
   */
  it('chiffre le blocage a sa duree REELLE, pas a la resolution de l’histogramme', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stalls-duree-'))
    const arreter = surveillerBoucleEvenements(dir, 120, 100)
    const fin = Date.now() + 350
    while (Date.now() < fin) {
      /* blocage synchrone volontaire */
    }
    await attendre(400)
    arreter()
    const lignes = readFileSync(join(dir, 'event-loop-stalls.jsonl'), 'utf8')
      .trim()
      .split(String.fromCharCode(10))
      .map((l) => JSON.parse(l))
    const pire = Math.max(...lignes.map((l) => l.blocageMs as number))
    /*
     * 200 ms et pas 350 : le retard mesure vaut la duree du blocage MOINS l'intervalle deja
     * ecoule avant lui (mesure reelle : 250 ms pour un blocage de 350 ms a 100 ms d'intervalle).
     * La borne reste tres au-dessus des ~32 ms que rendait l'histogramme : une correction en
     * trompe-l'oeil ne peut pas la franchir.
     */
    expect(pire).toBeGreaterThanOrEqual(200)
  })
})
