import { describe, expect, it } from 'vitest'
import {
  decideCreateFile,
  decideDeleteFile,
  decideMoveFile,
  identifiantDeBureauValide
} from './file-ops-command'

const WS = process.platform === 'win32' ? String.raw`D:\ws` : '/ws'
const rien = () => false
const tout = () => true

describe('create_file', () => {
  it('accepte un fichier neuf dans le workspace', () => {
    const d = decideCreateFile({ path: 'src/neuf.ts', content: 'export const x = 1\n' }, WS, rien)
    expect(d.allowed).toBe(true)
    if (d.allowed) expect(d.relativePath).toBe('src/neuf.ts')
  })
  it('refuse d’écraser un fichier existant', () => {
    const d = decideCreateFile({ path: 'src/deja.ts', content: 'x' }, WS, tout)
    expect(d).toMatchObject({ allowed: false })
    if (!d.allowed) expect(d.reason).toContain('existe déjà')
  })
  it('refuse la traversée de chemin', () => {
    expect(decideCreateFile({ path: '../evade.ts', content: 'x' }, WS, rien)).toMatchObject({
      allowed: false,
      reason: 'chemin hors du workspace'
    })
  })
  it('refuse .git', () => {
    const d = decideCreateFile({ path: '.git/hooks/pre-commit', content: 'x' }, WS, rien)
    expect(d.allowed).toBe(false)
  })
  it('refuse un fichier de secrets', () => {
    expect(decideCreateFile({ path: 'src/.env', content: 'x' }, WS, rien).allowed).toBe(false)
  })
  it('refuse un contenu absent', () => {
    expect(decideCreateFile({ path: 'src/neuf.ts' }, WS, rien).allowed).toBe(false)
  })
  it('accepte un contenu vide', () => {
    expect(decideCreateFile({ path: 'src/vide.ts', content: '' }, WS, rien).allowed).toBe(true)
  })
  it('refuse une racine système', () => {
    const cible = process.platform === 'win32' ? String.raw`C:\Windows\x.txt` : '/etc/x.txt'
    expect(decideCreateFile({ path: cible, content: 'x' }, WS, rien).allowed).toBe(false)
  })
})

describe('move_file', () => {
  it('accepte un déplacement dont la source existe et la destination non', () => {
    const d = decideMoveFile({ from: 'a.ts', to: 'b/c.ts' }, WS, (p) => p.endsWith('a.ts'))
    expect(d.allowed).toBe(true)
    if (d.allowed) expect(d.cibleRelative).toBe('b/c.ts')
  })
  it('refuse une source absente', () => {
    expect(decideMoveFile({ from: 'a.ts', to: 'b.ts' }, WS, rien)).toMatchObject({ allowed: false })
  })
  it('refuse d’écraser la destination', () => {
    const d = decideMoveFile({ from: 'a.ts', to: 'b.ts' }, WS, tout)
    expect(d).toMatchObject({ allowed: false })
    if (!d.allowed) expect(d.reason).toContain('destination existe')
  })
  it('refuse une destination hors workspace', () => {
    expect(decideMoveFile({ from: 'a.ts', to: '../b.ts' }, WS, tout)).toMatchObject({
      allowed: false,
      reason: 'destination hors du workspace'
    })
  })
  it('refuse une destination protégée', () => {
    expect(decideMoveFile({ from: 'a.ts', to: '.git/b.ts' }, WS, tout).allowed).toBe(false)
  })
  it('refuse origine = destination', () => {
    expect(decideMoveFile({ from: 'a.ts', to: 'a.ts' }, WS, tout).allowed).toBe(false)
  })
})

describe('delete_file', () => {
  it('accepte un fichier existant du workspace', () => {
    expect(decideDeleteFile({ path: 'src/vieux.ts' }, WS, tout).allowed).toBe(true)
  })
  it('refuse un fichier inexistant', () => {
    const d = decideDeleteFile({ path: 'src/vieux.ts' }, WS, rien)
    expect(d).toMatchObject({ allowed: false })
    if (!d.allowed) expect(d.reason).toContain('inexistant')
  })
  it('refuse .git et node_modules', () => {
    expect(decideDeleteFile({ path: '.git/config' }, WS, tout).allowed).toBe(false)
    expect(decideDeleteFile({ path: 'node_modules/x/index.js' }, WS, tout).allowed).toBe(false)
  })
  it('refuse la traversée de chemin', () => {
    expect(decideDeleteFile({ path: '../x.ts' }, WS, tout).allowed).toBe(false)
  })
})

describe('identifiant de copie de travail', () => {
  it('accepte un identifiant simple et refuse tout le reste', () => {
    expect(identifiantDeBureauValide('agent__run-1')).toBe(true)
    expect(identifiantDeBureauValide('../evasion')).toBe(false)
    expect(identifiantDeBureauValide('a/b')).toBe(false)
    expect(identifiantDeBureauValide(42)).toBe(false)
  })
})
