import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ecrireMascotteAffichee,
  ecrirePositionMascotte,
  lireMascotteAffichee,
  ecrireStyleMascotte,
  lirePositionMascotte,
  lireStyleMascotte,
  mascotteReglageFile
} from './mascotte-reglage'

describe('réglage « mascotte du bureau » (conv-1145)', () => {
  let dossier: string
  let env: NodeJS.ProcessEnv
  beforeEach(() => {
    dossier = mkdtempSync(join(tmpdir(), 'mascotte-reglage-'))
    env = { APPDATA: dossier }
  })
  afterEach(() => rmSync(dossier, { recursive: true, force: true }))

  it('affichée par défaut, sans fichier', () => {
    expect(lireMascotteAffichee(env)).toBe(true)
  })

  it('masquer puis réafficher est mémorisé ; le même choix n’écrit rien', () => {
    expect(ecrireMascotteAffichee(false, env)).toBe(true)
    expect(lireMascotteAffichee(env)).toBe(false)
    expect(ecrireMascotteAffichee(false, env)).toBe(false)
    expect(ecrireMascotteAffichee(true, env)).toBe(true)
    expect(lireMascotteAffichee(env)).toBe(true)
  })

  it('un fichier abîmé laisse la mascotte affichée', () => {
    const fichier = mascotteReglageFile(env)!
    mkdirSync(join(fichier, '..'), { recursive: true })
    writeFileSync(fichier, '{pas du json', 'utf8')
    expect(lireMascotteAffichee(env)).toBe(true)
  })

  it('garde la place de la bille sans toucher au choix affichée / masquée (conv-1142)', () => {
    expect(lirePositionMascotte(env)).toBeNull()
    expect(ecrirePositionMascotte({ x: 300, y: -20 }, env)).toBe(true)
    expect(lirePositionMascotte(env)).toEqual({ x: 300, y: -20 })
    expect(lireMascotteAffichee(env)).toBe(true)
    expect(ecrirePositionMascotte({ x: 300, y: -20 }, env)).toBe(false)
    // Fermer ne fait pas oublier la place ; déplacer ne réaffiche pas une bille fermée.
    expect(ecrireMascotteAffichee(false, env)).toBe(true)
    expect(lirePositionMascotte(env)).toEqual({ x: 300, y: -20 })
    expect(ecrirePositionMascotte({ x: 10, y: 20 }, env)).toBe(true)
    expect(lireMascotteAffichee(env)).toBe(false)
  })

  it('refuse une place qui n’est pas en pixels entiers', () => {
    expect(() => ecrirePositionMascotte({ x: 1.5, y: 2 }, env)).toThrow()
    expect(() => ecrirePositionMascotte({ x: '1', y: 2 }, env)).toThrow()
    expect(() => ecrirePositionMascotte(null, env)).toThrow()
    expect(lirePositionMascotte(env)).toBeNull()
  })

  it('refuse une valeur qui n’est pas un booléen', () => {
    expect(() => ecrireMascotteAffichee('non', env)).toThrow()
    expect(lireMascotteAffichee(env)).toBe(true)
  })

  it('style : magicien par défaut, basique gardé sans toucher au reste (conv-1249)', () => {
    expect(lireStyleMascotte(env)).toBe('magicien')
    // Le style par défaut ne crée pas de fichier.
    expect(ecrireStyleMascotte('magicien', env)).toBe(false)
    expect(ecrirePositionMascotte({ x: 40, y: 50 }, env)).toBe(true)
    expect(ecrireMascotteAffichee(false, env)).toBe(true)
    expect(ecrireStyleMascotte('basique', env)).toBe(true)
    expect(lireStyleMascotte(env)).toBe('basique')
    expect(ecrireStyleMascotte('basique', env)).toBe(false)
    expect(lirePositionMascotte(env)).toEqual({ x: 40, y: 50 })
    expect(lireMascotteAffichee(env)).toBe(false)
    // Déplacer ou réafficher ne ramène pas le magicien.
    expect(ecrirePositionMascotte({ x: 1, y: 2 }, env)).toBe(true)
    expect(ecrireMascotteAffichee(true, env)).toBe(true)
    expect(lireStyleMascotte(env)).toBe('basique')
    expect(ecrireStyleMascotte('magicien', env)).toBe(true)
    expect(lireStyleMascotte(env)).toBe('magicien')
  })

  it('style : refuse une valeur inconnue ; un style abîmé redevient magicien', () => {
    expect(() => ecrireStyleMascotte('pirate', env)).toThrow()
    expect(() => ecrireStyleMascotte(null, env)).toThrow()
    const fichier = mascotteReglageFile(env)!
    mkdirSync(join(fichier, '..'), { recursive: true })
    writeFileSync(fichier, JSON.stringify({ affichee: true, style: 'pirate' }), 'utf8')
    expect(lireStyleMascotte(env)).toBe('magicien')
  })
})
