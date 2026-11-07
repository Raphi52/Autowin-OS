import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { creerCoffre, type Coffre } from './coffre-cles'
import { rangerDepuisPressePapier, type PressePapier } from './coffre-presse-papier'

/**
 * CE QUE CE FICHIER PROUVE : une clé copiée sur un site entre au coffre sans que sa valeur revienne à
 * l'agent ; le presse-papier est vidé ; ce que le tour avait déjà écrit est masqué après coup ; et rien
 * n'est rangé quand le presse-papier ne porte pas une clé seule, ni quand le nom est déjà pris.
 * Le coffre est le VRAI (`creerCoffre`), sur un fichier temporaire et un chiffrement factice.
 */
const CLE = 'sk-proj-Zx9Qw8Er7Ty6Ui5Op4As3Df2'

let dossier: string
let coffre: Coffre

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'coffre-presse-papier-'))
  coffre = creerCoffre({
    chemin: () => join(dossier, 'coffre.bin'),
    chiffrement: () => ({
      isEncryptionAvailable: () => true,
      encryptString: (texte) => Buffer.from(texte, 'utf8'),
      decryptString: (donnees) => donnees.toString('utf8')
    }),
    lireRegistre: () => new Map(),
    env: {}
  })
})
afterEach(() => {
  rmSync(dossier, { recursive: true, force: true })
})

/** Comme celui d'Electron 44 : la lecture rend une promesse, le vidage est immédiat. */
function pressePapier(contenu: string): PressePapier & { contenu: string } {
  const p = {
    contenu,
    readText: async () => p.contenu,
    clear: () => {
      p.contenu = ''
    }
  }
  return p
}

describe('ranger au coffre la clé copiée sur un site', () => {
  it('la range, vide le presse-papier et ne rend jamais la valeur', async () => {
    const copie = pressePapier(`  ${CLE}\n`)
    const r = await rangerDepuisPressePapier({
      nom: 'OPENAI_API_KEY',
      pressePapier: copie,
      coffre,
      fichiersARepasser: async () => []
    })
    expect(r).toMatchObject({ ok: true, nom: 'OPENAI_API_KEY', longueur: CLE.length })
    expect(JSON.stringify(r)).not.toContain(CLE)
    expect(coffre.valeursPourAgent([])).toEqual({ OPENAI_API_KEY: CLE })
    expect(copie.contenu).toBe('')
  })

  it('attend la lecture du presse-papier, qui rend une promesse dans Electron 44', async () => {
    const copie = pressePapier(CLE)
    expect(copie.readText()).toBeInstanceOf(Promise)
    const r = await rangerDepuisPressePapier({
      nom: 'MISTRAL_API_KEY',
      pressePapier: copie,
      coffre,
      fichiersARepasser: async () => []
    })
    expect(r).toMatchObject({ ok: true, longueur: CLE.length })
    expect(coffre.valeursPourAgent([])).toEqual({ MISTRAL_API_KEY: CLE })
    expect(copie.contenu).toBe('')
  })

  it('masque après coup ce que le tour avait déjà écrit, à la même place', async () => {
    const journal = join(dossier, 'tour.jsonl')
    const ligne = `{"kind":"tool-result","text":"Votre clé : ${CLE} (copiez-la)"}\n`
    writeFileSync(journal, ligne, 'utf8')
    const r = await rangerDepuisPressePapier({
      nom: 'OPENAI_API_KEY',
      pressePapier: pressePapier(CLE),
      coffre,
      fichiersARepasser: async () => [journal]
    })
    expect(r.masqueesApresCoup).toBe(1)
    const apres = readFileSync(journal, 'utf8')
    expect(apres).not.toContain(CLE)
    expect(apres).toContain('[secret:OPENAI_API_KEY]')
    expect(apres.length).toBe(ligne.length)
    expect(() => JSON.parse(apres)).not.toThrow()
  })

  it('presse-papier vide, plusieurs mots ou trop court : rien n’est rangé, rien n’est vidé', async () => {
    for (const contenu of [
      '',
      '   ',
      'mot de passe de l’utilisateur',
      `${CLE}\n${CLE}`,
      'abc123'
    ]) {
      const copie = pressePapier(contenu)
      const r = await rangerDepuisPressePapier({
        nom: 'OPENAI_API_KEY',
        pressePapier: copie,
        coffre,
        fichiersARepasser: async () => []
      })
      expect(r.ok, JSON.stringify(contenu)).toBe(false)
      expect(r.detail).not.toContain(contenu.trim() || '§')
      expect(copie.contenu).toBe(contenu)
    }
    expect(coffre.listerCles()).toEqual([])
  })

  it('ne remplace jamais une clé déjà au coffre, casse ignorée', async () => {
    coffre.ajouterCle('OPENAI_API_KEY', 'valeur-de-l-utilisateur-0123')
    const r = await rangerDepuisPressePapier({
      nom: 'openai_api_key',
      pressePapier: pressePapier(CLE),
      coffre,
      fichiersARepasser: async () => []
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/déjà au coffre/)
    expect(coffre.valeursPourAgent([])).toEqual({ OPENAI_API_KEY: 'valeur-de-l-utilisateur-0123' })
  })

  it('un nom refusé par le coffre (PATH) : refus du coffre, sans la valeur', async () => {
    const r = await rangerDepuisPressePapier({
      nom: 'PATH',
      pressePapier: pressePapier(CLE),
      coffre,
      fichiersARepasser: async () => []
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/ne désigne pas une clé/)
    expect(r.detail).not.toContain(CLE)
  })

  it('hors de l’app (aucun presse-papier) : refus lisible', async () => {
    const r = await rangerDepuisPressePapier({ nom: 'OPENAI_API_KEY', coffre })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/indisponible/)
  })
})
