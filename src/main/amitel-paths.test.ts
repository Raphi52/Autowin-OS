import { describe, expect, it } from 'vitest'
import {
  amitelBrainOrigin,
  amitelBrainRoot,
  amitelBrainTooling,
  amitelWorkspaces,
  DEFAULT_AMITEL_WORKSPACES,
  DEFAULT_BRAIN_ROOT
} from './amitel-paths'

/**
 * Ces chemins etaient ecrits en dur dans QUATRE fichiers du main process (audit 2026-07-29). Ce que
 * ces tests figent : la source est UNIQUE, chaque valeur reste SURCHARGEABLE sous son nom historique,
 * et le residu `C:\Nouveau dossier` — qui trainait dans une liste blanche ANTI-TRAVERSAL — ne revient
 * jamais.
 */
describe('amitel-paths — source unique et surchargeable', () => {
  it('rend le defaut Amitel quand rien n’est configure', () => {
    expect(amitelBrainRoot({})).toBe(DEFAULT_BRAIN_ROOT)
    expect(amitelBrainOrigin({})).toBe('http://127.0.0.1:8765')
  })

  it('respecte les noms de variables HISTORIQUES (les renommer serait une regression silencieuse)', () => {
    expect(amitelBrainRoot({ AMITEL_BRAIN_ROOT: 'D:\\brain' })).toBe('D:\\brain')
    expect(amitelBrainOrigin({ AMITEL_BRAIN_ORIGIN: 'http://localhost:9000' })).toBe(
      'http://localhost:9000'
    )
    expect(amitelBrainTooling({ AUTOWIN_BRAIN_TOOLING: 'D:\\t' })).toBe('D:\\t')
  })

  it('le tooling SUIT la racine du Brain — avant, les deux litteraux pouvaient diverger', () => {
    // C'est LE gain de la centralisation : deplacer la racine deplace le tooling avec elle.
    expect(amitelBrainTooling({ AMITEL_BRAIN_ROOT: 'D:\\brain' })).toBe('D:\\brain\\tooling')
    // Mais la surcharge explicite du tooling reste prioritaire sur la derivation.
    expect(amitelBrainTooling({ AMITEL_BRAIN_ROOT: 'D:\\brain', AUTOWIN_BRAIN_TOOLING: 'E:\\t' })).toBe(
      'E:\\t'
    )
  })

  it('une valeur VIDE ou en espaces ne masque pas le defaut', () => {
    // Piege classique : `AMITEL_BRAIN_ROOT=` (vide) faisait rendre '' avec un `??`, donc un chemin
    // relatif silencieux. On retombe sur le defaut.
    expect(amitelBrainRoot({ AMITEL_BRAIN_ROOT: '' })).toBe(DEFAULT_BRAIN_ROOT)
    expect(amitelBrainRoot({ AMITEL_BRAIN_ROOT: '   ' })).toBe(DEFAULT_BRAIN_ROOT)
  })

  it('les workspaces sont surchargeables en liste, et NE CONTIENNENT PLUS le residu de bricolage', () => {
    expect(amitelWorkspaces({})).toEqual([...DEFAULT_AMITEL_WORKSPACES])
    expect(amitelWorkspaces({})).not.toContain('C:\\Nouveau dossier')
    expect(DEFAULT_AMITEL_WORKSPACES).not.toContain('C:\\Nouveau dossier')
    expect(amitelWorkspaces({ AUTOWIN_AMITEL_WORKSPACES: 'D:\\a ; D:\\b' })).toEqual([
      'D:\\a',
      'D:\\b'
    ])
  })

  it('une liste de workspaces vide ou faite de separateurs retombe sur le defaut', () => {
    expect(amitelWorkspaces({ AUTOWIN_AMITEL_WORKSPACES: '  ;  ;' })).toEqual([
      ...DEFAULT_AMITEL_WORKSPACES
    ])
  })
})
