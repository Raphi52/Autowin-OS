/**
 * Entree qui ferait echouer une correction fausse : un banc dont UN SEUL bras a fini alors que la
 * commande observee est toujours en cours — c'est exactement l'instant ou l'utilisateur regarde un
 * bloc vide (conv-355, 2026-09-08). Un module qui n'afficherait que l'etat final serait vert sur un
 * banc termine et inutile ici.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  avancementBanc,
  avancementDepuisCommande,
  dossierBancDepuisCommande
} from './arene-avancement'

let banc = ''

beforeEach(() => {
  banc = mkdtempSync(join(tmpdir(), 'arena-bench-essai-')).split(String.fromCharCode(92)).join('/')
  for (const b of ['a', 'b', 'c', 'x']) writeFileSync(join(banc, `prompt-${b}.txt`), 'p')
})
afterEach(() => rmSync(banc, { recursive: true, force: true }))

describe('avancement d’un banc d’arène en cours', () => {
  it('nomme les bras finis et ceux qui tournent encore', () => {
    writeFileSync(join(banc, 'statut.txt'), 'c exit=0 wall=92s\n')
    expect(avancementBanc(banc)).toBe('4 bras : c fini 92 s · a, b, x en cours')
  })

  it('sans aucun bras fini, dit que les quatre tournent', () => {
    writeFileSync(join(banc, 'statut.txt'), '')
    expect(avancementBanc(banc)).toBe('4 bras : a, b, c, x en cours')
  })

  it('signale un bras en échec au lieu de le compter comme fini', () => {
    writeFileSync(join(banc, 'statut.txt'), 'a exit=1 wall=7s\n')
    expect(avancementBanc(banc)).toContain('a ECHEC (1) 7 s')
  })

  it('rend null sur un dossier qui n’est pas un banc', () => {
    const vide = mkdtempSync(join(tmpdir(), 'pas-un-banc-'))
    expect(avancementBanc(vide)).toBeNull()
    rmSync(vide, { recursive: true, force: true })
  })

  it('extrait le dossier du banc depuis la commande du battement', () => {
    const cmd = `cd /d/AutoWinOS; sh ${banc}/lance.sh 2>&1 | tail -10`
    expect(dossierBancDepuisCommande(cmd)).toBe(banc)
    expect(dossierBancDepuisCommande('npx vitest run src/main')).toBeNull()
  })

  it('laisse un battement ordinaire intact', () => {
    expect(avancementDepuisCommande('npx vitest run src/main/store')).toBeNull()
  })
})
