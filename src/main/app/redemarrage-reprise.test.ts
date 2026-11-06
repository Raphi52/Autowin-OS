import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cheminReprise,
  consommerReprise,
  poserReprise,
  PEREMPTION_REPRISE_MS
} from './redemarrage-reprise'

/** Un processus principal demarre APRES la pose — le cas d'un vrai redemarrage. */
const apresRedemarrage = (): number => Date.now() + 1

let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'aw-reprise-'))
})
afterEach(() => rmSync(racine, { recursive: true, force: true }))

describe('reprise apres redemarrage', () => {
  it('rend la consigne posee avant le redemarrage', () => {
    poserReprise(racine, {
      conversationId: 'conv-1',
      consigne: 'reprends la tâche X',
      raison: 'dev'
    })
    expect(consommerReprise(racine, Date.now(), apresRedemarrage())).toMatchObject({
      conversationId: 'conv-1',
      consigne: 'reprends la tâche X',
      raison: 'dev'
    })
  })

  it('ne rejoue JAMAIS deux fois la meme consigne', () => {
    poserReprise(racine, { conversationId: 'conv-1', consigne: 'reprends' })
    expect(consommerReprise(racine, Date.now(), apresRedemarrage())).not.toBeNull()
    expect(consommerReprise(racine, Date.now(), apresRedemarrage())).toBeNull()
    expect(existsSync(cheminReprise(racine))).toBe(false)
  })

  it('jette une consigne perimee au lieu de la ressusciter', () => {
    const poseeA = Date.now() - PEREMPTION_REPRISE_MS - 1
    poserReprise(racine, { conversationId: 'conv-1', consigne: 'vieille consigne', poseeA })
    expect(consommerReprise(racine)).toBeNull()
  })

  it('survit a un fichier corrompu et le supprime', () => {
    const chemin = cheminReprise(racine)
    mkdirSync(join(racine, 'redemarrage'), { recursive: true })
    writeFileSync(chemin, '{ pas du json', 'utf8')
    expect(consommerReprise(racine)).toBeNull()
    expect(existsSync(chemin)).toBe(false)
  })

  it('refuse une pose sans cible ou sans consigne', () => {
    expect(() => poserReprise(racine, { conversationId: '', consigne: 'x' })).toThrow()
    expect(() => poserReprise(racine, { conversationId: 'conv-1', consigne: '  ' })).toThrow()
    expect(existsSync(cheminReprise(racine))).toBe(false)
  })

  it('rend null quand rien n a ete pose', () => {
    expect(consommerReprise(racine)).toBeNull()
  })

  /*
   * conv-1033, 2026-10-21 : `restart_app` mis en file pose la consigne TOUT DE SUITE (commands.ts),
   * et le renderer la reclame a chaque montage de ChatView. A 15:20:30, l'interface l'a reprise
   * alors que le processus principal tournait depuis 10:22 : la verification du redemarrage est
   * partie sur l'ancien code, le redemarrage lui-meme etant encore en attente.
   */
  it('ne rend pas a un rechargement de l interface une consigne posee par CE processus', () => {
    const demarreA = Date.now() - 60_000
    poserReprise(racine, { conversationId: 'conv-1', consigne: 'verifie apres redemarrage' })
    expect(consommerReprise(racine, Date.now(), demarreA)).toBeNull()
    expect(existsSync(cheminReprise(racine, 'conv-1'))).toBe(true)
  })

  it('la rend au processus suivant, demarre apres la pose', () => {
    poserReprise(racine, { conversationId: 'conv-1', consigne: 'verifie apres redemarrage' })
    expect(consommerReprise(racine, Date.now(), Date.now() - 120_000)).toBeNull()
    expect(consommerReprise(racine, Date.now(), Date.now() + 1)).toMatchObject({
      consigne: 'verifie apres redemarrage'
    })
    expect(existsSync(cheminReprise(racine, 'conv-1'))).toBe(false)
  })

  /*
   * conv-1306, 2026-10-30 : un seul fichier pour toutes les conversations. conv-1329 a posé sa
   * consigne à 15:50:32 PAR-DESSUS celle de conv-1306 (15:31) ; après le redémarrage, seule
   * conv-1329 aurait repris, alors que les deux avaient reçu « la consigne sera rejouée ».
   */
  it('deux conversations : chacune retrouve SA consigne, la plus ancienne d abord', () => {
    poserReprise(racine, {
      conversationId: 'conv-1306',
      consigne: 'verifie Choisir',
      poseeA: Date.now() - 2_000
    })
    poserReprise(racine, { conversationId: 'conv-1329', consigne: 'verifie le port 5173' })
    const demarreA = Date.now() + 1
    expect(consommerReprise(racine, Date.now(), demarreA)).toMatchObject({
      conversationId: 'conv-1306',
      consigne: 'verifie Choisir'
    })
    expect(consommerReprise(racine, Date.now(), demarreA)).toMatchObject({
      conversationId: 'conv-1329',
      consigne: 'verifie le port 5173'
    })
    expect(consommerReprise(racine, Date.now(), demarreA)).toBeNull()
  })

  it('une seconde pose du MEME fil remplace sa consigne, pas celle des autres', () => {
    poserReprise(racine, { conversationId: 'conv-1', consigne: 'ancienne', poseeA: Date.now() - 5 })
    poserReprise(racine, {
      conversationId: 'conv-2',
      consigne: 'autre fil',
      poseeA: Date.now() - 4
    })
    poserReprise(racine, { conversationId: 'conv-1', consigne: 'nouvelle' })
    const demarreA = Date.now() + 1
    const rendues = [
      consommerReprise(racine, Date.now(), demarreA),
      consommerReprise(racine, Date.now(), demarreA),
      consommerReprise(racine, Date.now(), demarreA)
    ]
    expect(rendues.map((r) => r && `${r.conversationId}:${r.consigne}`)).toEqual([
      'conv-2:autre fil',
      'conv-1:nouvelle',
      null
    ])
  })

  it('lit encore l ancien fichier unique, posé par un processus d avant ce correctif', () => {
    mkdirSync(join(racine, 'redemarrage'), { recursive: true })
    writeFileSync(
      cheminReprise(racine),
      JSON.stringify({
        conversationId: 'conv-1329',
        consigne: 'ancienne forme',
        poseeA: Date.now()
      }),
      'utf8'
    )
    poserReprise(racine, { conversationId: 'conv-1306', consigne: 'nouvelle forme' })
    const demarreA = Date.now() + 1
    const ids = [
      consommerReprise(racine, Date.now(), demarreA)?.conversationId,
      consommerReprise(racine, Date.now(), demarreA)?.conversationId
    ].sort()
    expect(ids).toEqual(['conv-1306', 'conv-1329'])
    expect(consommerReprise(racine, Date.now(), demarreA)).toBeNull()
    expect(existsSync(cheminReprise(racine))).toBe(false)
  })

  it('un identifiant de conversation ne sort jamais du dossier des reprises', () => {
    poserReprise(racine, { conversationId: '../../evil', consigne: 'x' })
    expect(existsSync(join(racine, 'evil.json'))).toBe(false)
    expect(consommerReprise(racine, Date.now(), Date.now() + 1)).toMatchObject({
      conversationId: '../../evil'
    })
  })
})
