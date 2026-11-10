import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { copieALaDemandePossible } from '../copies/copie-a-la-demande-possible'
import {
  NOM_GARDE_ECRITURE_AGY,
  SCRIPT_GARDE_ECRITURE,
  controleDeCopiePret,
  dossierHooksGrok,
  fichierHooksAgy,
  fichierHooksCodex,
  installerGardeEcritureAgy,
  installerGardeEcritureCodex,
  installerGardeEcritureGrok,
  installerGardeNpmCodex
} from './hooks-des-cli'

/*
 * LE TOUR NE PART SANS COPIE QUE SI LE CONTRÔLE DU MODÈLE LA DEMANDERA. Codex, Grok et agy tiennent
 * ce contrôle de leurs réglages personnels : absents ou modifiés, le tour écrirait dans le dossier
 * partagé sans que personne n'ouvre la copie. Ici, ce que l'app relit avant de décider.
 */
let maison: string
let scriptNpm: string
let ecriture: string
beforeEach(() => {
  maison = mkdtempSync(join(tmpdir(), 'controle-de-copie-'))
  const scripts = join(maison, 'depot', 'scripts')
  mkdirSync(scripts, { recursive: true })
  // Un dépôt git : la recherche de contrôles de projet de Codex s'arrête à sa racine.
  mkdirSync(join(maison, 'depot', '.git'))
  scriptNpm = join(scripts, 'garde-npm-modules.mjs')
  ecriture = join(scripts, SCRIPT_GARDE_ECRITURE)
  writeFileSync(scriptNpm, '', 'utf8')
  writeFileSync(ecriture, '', 'utf8')
})
afterEach(() => {
  rmSync(maison, { recursive: true, force: true })
})

const pret = (provider: string): boolean =>
  controleDeCopiePret({ provider, scriptNpm, maison, env: {}, cwd: join(maison, 'depot') })

describe('installerGardeEcritureAgy', () => {
  it('pose notre entrée nommée : la commande sans guillemets, sur les outils qui écrivent', () => {
    const fichier = fichierHooksAgy(maison)
    expect(installerGardeEcritureAgy(fichier, ecriture)).toEqual({ issue: 'cree' })
    const entree = JSON.parse(readFileSync(fichier, 'utf8'))[NOM_GARDE_ECRITURE_AGY]
    const groupe = entree.PreToolUse[0]
    expect(groupe.matcher.split('|')).toEqual(
      expect.arrayContaining(['run_command', 'write_file', 'edit_file'])
    )
    expect(groupe.matcher.split('|')).not.toContain('read_file')
    expect(groupe.hooks).toEqual([{ type: 'command', command: `node ${ecriture}`, timeout: 180 }])
    expect(installerGardeEcritureAgy(fichier, ecriture)).toEqual({ issue: 'inchange' })
  })

  it('garde les entrées des autres, après une copie du fichier', () => {
    const fichier = fichierHooksAgy(maison)
    mkdirSync(dirname(fichier), { recursive: true })
    const autre = { PreInvocation: [{ type: 'command', command: './rappel.sh' }] }
    writeFileSync(fichier, JSON.stringify({ rappel: autre }), 'utf8')
    const rendu = installerGardeEcritureAgy(fichier, ecriture, 'h')
    expect(rendu.issue).toBe('mis-a-jour')
    const ecrit = JSON.parse(readFileSync(fichier, 'utf8'))
    expect(ecrit.rappel).toEqual(autre)
    expect(ecrit[NOM_GARDE_ECRITURE_AGY]).toBeDefined()
    expect(readdirSync(dirname(fichier))).toContain('hooks.json.h.bak')
  })

  it('refuse un chemin qui porte un espace : agy lancerait une commande cassée, qui bloque ses outils', () => {
    const fichier = fichierHooksAgy(maison)
    expect(installerGardeEcritureAgy(fichier, 'C:\\Mes outils\\garde.mjs')).toEqual({
      issue: 'chemin-avec-espace'
    })
    expect(() => readFileSync(fichier, 'utf8')).toThrow()
  })
})

describe('controleDeCopiePret', () => {
  it('rien d’installé : aucun des trois ne peut ouvrir sa copie à la première écriture', () => {
    expect(pret('grok')).toBe(false)
    expect(pret('agy')).toBe(false)
    expect(pret('codex')).toBe(false)
  })

  it('Grok et agy : prêts dès que leur fichier est exactement le nôtre', () => {
    installerGardeEcritureGrok(dossierHooksGrok(maison), ecriture)
    installerGardeEcritureAgy(fichierHooksAgy(maison), ecriture)
    expect(pret('grok')).toBe(true)
    expect(pret('agy')).toBe(true)
  })

  it('un fichier qui nomme le script d’un autre dépôt ne compte pas', () => {
    const ailleurs = join(maison, 'autre', SCRIPT_GARDE_ECRITURE)
    installerGardeEcritureGrok(dossierHooksGrok(maison), ailleurs)
    installerGardeEcritureAgy(fichierHooksAgy(maison), ailleurs)
    expect(pret('grok')).toBe(false)
    expect(pret('agy')).toBe(false)
  })

  it('Codex : il faut la garde d’écriture ET des contrôles que Codex fera tourner', () => {
    const fichier = fichierHooksCodex({}, maison)
    // La garde d'écriture seule : Codex ne lève pas la relecture de ses contrôles sans la garde npm.
    installerGardeEcritureCodex(fichier, ecriture)
    expect(pret('codex')).toBe(false)
    installerGardeNpmCodex(fichier, scriptNpm, 'h')
    expect(pret('codex')).toBe(true)
  })

  it('Codex : un contrôle inconnu dans son fichier, et il part sans ses contrôles', () => {
    const fichier = fichierHooksCodex({}, maison)
    installerGardeNpmCodex(fichier, scriptNpm)
    installerGardeEcritureCodex(fichier, ecriture, 'h')
    const racine = JSON.parse(readFileSync(fichier, 'utf8'))
    racine.hooks.Stop = [{ matcher: '', hooks: [{ type: 'command', command: 'inconnu.exe' }] }]
    writeFileSync(fichier, JSON.stringify(racine), 'utf8')
    expect(pret('codex')).toBe(false)
  })

  it('un autre modèle, ou un script de garde absent du dépôt : non', () => {
    installerGardeEcritureGrok(dossierHooksGrok(maison), ecriture)
    expect(pret('openrouter')).toBe(false)
    expect(controleDeCopiePret({ provider: 'grok', scriptNpm: undefined, maison })).toBe(false)
    rmSync(ecriture)
    expect(pret('grok')).toBe(false)
  })
})

describe('copieALaDemandePossible', () => {
  it('Claude toujours ; Codex, Grok et agy selon leurs réglages ; les autres jamais', () => {
    const vus: string[] = []
    const oui = (entree: { provider: string }): boolean => {
      vus.push(entree.provider)
      return true
    }
    expect(copieALaDemandePossible('claude', 'D:\\depot', () => false)).toBe(true)
    for (const cli of ['codex', 'grok', 'agy']) {
      expect(copieALaDemandePossible(cli, 'D:\\depot', oui)).toBe(true)
      expect(copieALaDemandePossible(cli, 'D:\\depot', () => false)).toBe(false)
    }
    expect(vus).toEqual(['codex', 'grok', 'agy'])
    expect(copieALaDemandePossible('openrouter', 'D:\\depot', oui)).toBe(false)
    expect(copieALaDemandePossible(undefined, 'D:\\depot', oui)).toBe(false)
  })
})
