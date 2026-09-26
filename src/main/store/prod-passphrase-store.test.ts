import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { definirPhrase, phraseCorrespond } from '../prod-passphrase'
import {
  cheminEmpreinteProd,
  ecrireEmpreinteProd,
  effacerEmpreinteProd,
  lireEmpreinteProd
} from './prod-passphrase-store'

/**
 * STOCKAGE DE L'EMPREINTE — ce qui compte ici : la phrase n'atteint jamais le disque, et un fichier
 * abîmé FERME la production au lieu de l'ouvrir.
 *
 * `scrypt` est lent : une seule empreinte est dérivée pour toute la série.
 */
const PHRASE = 'phrase-de-passe-de-reference'
const EMPREINTE = definirPhrase(PHRASE, 4_242)
const racines: string[] = []

function racineNeuve(): string {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-prod-phrase-'))
  racines.push(racine)
  return racine
}

afterAll(() => {
  for (const racine of racines) rmSync(racine, { recursive: true, force: true })
})

describe('écriture et relecture', () => {
  it('relit exactement ce qui a été écrit, et la phrase reste vérifiable', () => {
    const racine = racineNeuve()
    ecrireEmpreinteProd(racine, EMPREINTE)
    const relue = lireEmpreinteProd(racine)
    expect(relue).toEqual(EMPREINTE)
    expect(phraseCorrespond(PHRASE, relue)).toBe(true)
    expect(phraseCorrespond('autre-phrase-longue', relue)).toBe(false)
  })

  /** La propriété qui justifie tout le module : le secret n'atteint pas le disque. */
  it('n’écrit NULLE PART la phrase en clair', () => {
    const racine = racineNeuve()
    ecrireEmpreinteProd(racine, EMPREINTE)
    const contenu = readFileSync(cheminEmpreinteProd(racine), 'utf8')
    expect(contenu).not.toContain(PHRASE)
    expect(contenu).not.toContain('phrase-de-passe')
    expect(contenu).toContain('scrypt')
  })

  it('remplace l’empreinte précédente quand la phrase change', () => {
    const racine = racineNeuve()
    ecrireEmpreinteProd(racine, EMPREINTE)
    const nouvelle = definirPhrase('une-toute-autre-phrase', 9_000)
    ecrireEmpreinteProd(racine, nouvelle)
    const relue = lireEmpreinteProd(racine)
    expect(relue?.empreinte).toBe(nouvelle.empreinte)
    expect(phraseCorrespond(PHRASE, relue)).toBe(false)
    expect(phraseCorrespond('une-toute-autre-phrase', relue)).toBe(true)
  })

  it('crée le dossier de données s’il n’existe pas encore', () => {
    const racine = join(racineNeuve(), 'sous', 'dossier')
    ecrireEmpreinteProd(racine, EMPREINTE)
    expect(lireEmpreinteProd(racine)).toEqual(EMPREINTE)
  })

  it('ne laisse aucun fichier temporaire derrière elle', () => {
    const racine = racineNeuve()
    ecrireEmpreinteProd(racine, EMPREINTE)
    expect(() => readFileSync(`${cheminEmpreinteProd(racine)}.tmp`, 'utf8')).toThrow()
  })

  it('refuse d’écrire une empreinte invalide plutôt que de produire un réglage mort', () => {
    const racine = racineNeuve()
    expect(() =>
      ecrireEmpreinteProd(racine, { ...EMPREINTE, empreinte: 'pas-de-l-hexadecimal' })
    ).toThrow()
    expect(lireEmpreinteProd(racine)).toBeUndefined()
  })
})

describe('un réglage absent ou abîmé ferme la production', () => {
  it('rend undefined quand aucun fichier n’existe', () => {
    expect(lireEmpreinteProd(racineNeuve())).toBeUndefined()
  })

  it('rend undefined sur du JSON illisible', () => {
    const racine = racineNeuve()
    writeFileSync(cheminEmpreinteProd(racine), '{ ceci n est pas du json', 'utf8')
    expect(lireEmpreinteProd(racine)).toBeUndefined()
  })

  /**
   * Chaque forme d'abîmage est listée : un champ manquant ou d'un autre type ne doit pas produire
   * une empreinte à moitié valide, qui échouerait ensuite de façon incompréhensible.
   */
  it('rend undefined sur chaque champ manquant, vide ou d’un autre algorithme', () => {
    const abimes: unknown[] = [
      null,
      'une chaîne',
      { algorithme: 'md5', sel: 'ab', empreinte: 'cd' },
      { algorithme: 'scrypt', empreinte: 'abcd' },
      { algorithme: 'scrypt', sel: 'abcd' },
      { algorithme: 'scrypt', sel: '', empreinte: 'abcd' },
      { algorithme: 'scrypt', sel: 'abcd', empreinte: 'pas hexa' },
      { algorithme: 'scrypt', sel: 42, empreinte: 'abcd' }
    ]
    for (const abime of abimes) {
      const racine = racineNeuve()
      writeFileSync(cheminEmpreinteProd(racine), JSON.stringify(abime), 'utf8')
      expect(lireEmpreinteProd(racine)).toBeUndefined()
    }
  })

  it('tolère une date manquante — elle ne sert qu’à l’affichage', () => {
    const racine = racineNeuve()
    writeFileSync(
      cheminEmpreinteProd(racine),
      JSON.stringify({ algorithme: 'scrypt', sel: EMPREINTE.sel, empreinte: EMPREINTE.empreinte }),
      'utf8'
    )
    const relue = lireEmpreinteProd(racine)
    expect(relue?.definieLe).toBe(0)
    expect(phraseCorrespond(PHRASE, relue)).toBe(true)
  })
})

describe('effacement', () => {
  it('retire le réglage, ce qui FERME la production', () => {
    const racine = racineNeuve()
    ecrireEmpreinteProd(racine, EMPREINTE)
    expect(effacerEmpreinteProd(racine)).toBe(true)
    expect(lireEmpreinteProd(racine)).toBeUndefined()
  })

  it('ne se plaint pas quand il n’y a rien à effacer', () => {
    expect(effacerEmpreinteProd(racineNeuve())).toBe(false)
  })
})
