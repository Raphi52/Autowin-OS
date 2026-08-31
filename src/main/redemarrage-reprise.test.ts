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
    expect(consommerReprise(racine)).toMatchObject({
      conversationId: 'conv-1',
      consigne: 'reprends la tâche X',
      raison: 'dev'
    })
  })

  it('ne rejoue JAMAIS deux fois la meme consigne', () => {
    poserReprise(racine, { conversationId: 'conv-1', consigne: 'reprends' })
    expect(consommerReprise(racine)).not.toBeNull()
    expect(consommerReprise(racine)).toBeNull()
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
})
