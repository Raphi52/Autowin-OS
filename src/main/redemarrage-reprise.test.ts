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
    expect(existsSync(cheminReprise(racine))).toBe(true)
  })

  it('la rend au processus suivant, demarre apres la pose', () => {
    poserReprise(racine, { conversationId: 'conv-1', consigne: 'verifie apres redemarrage' })
    expect(consommerReprise(racine, Date.now(), Date.now() - 120_000)).toBeNull()
    expect(consommerReprise(racine, Date.now(), Date.now() + 1)).toMatchObject({
      consigne: 'verifie apres redemarrage'
    })
    expect(existsSync(cheminReprise(racine))).toBe(false)
  })
})
