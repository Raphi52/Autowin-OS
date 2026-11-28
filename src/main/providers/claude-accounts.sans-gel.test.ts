import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { attendreFichier } from '../gel/ecriture-hors-fil'
import { ClaudeAccountsStore, parseState } from './claude-accounts'

/**
 * L'ÉTAT DES COMPTES CLAUDE NE TIENT PLUS LE FIL PRINCIPAL.
 *
 * Mesure `gels.jsonl` du 21 au 28/11/2026 (`node scripts/gels-classement.mjs --jours 7 --json
 * --top 200`, cartes archivées) : `writeFileSync` de l'écrivain par défaut du store
 * (`claude-accounts.ts`), appelé par `persist`, a figé la fenêtre 2 fois, 3,4 s en tout. La liste
 * des comptes sonde chaque compte à l'ouverture, et chaque identité lue réécrit le fichier.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER :
 *  - `writeFileSync` remis comme écrivain par défaut → le premier test voit l'écriture bloquante ;
 *  - un ajout qui rend la main avant de savoir l'état posé → le second test le voit réussir alors
 *    que le disque a refusé (compte perdu au redémarrage, le défaut que `add` refuse).
 */
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    writeFileSync: vi.fn(real.writeFileSync),
    appendFileSync: vi.fn(real.appendFileSync),
    openSync: vi.fn(real.openSync)
  }
})
// Toute écriture qui tient le fil, même cachée dans une fonction « async » de façade.
const ecrituresBloquantes = [
  vi.mocked(fs.writeFileSync),
  vi.mocked(fs.appendFileSync),
  vi.mocked(fs.openSync)
]
const ecrituresBloquantesDe = (chemin: string): unknown[] =>
  ecrituresBloquantes.flatMap((espion) =>
    espion.mock.calls.filter(([cible]) => String(cible) === chemin)
  )

const racine = mkdtempSync(join(tmpdir(), 'aos-comptes-sans-gel-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))
let numero = 0
const nouveauDossier = (): string => join(racine, `poste-${++numero}`)

beforeEach(() => {
  for (const espion of ecrituresBloquantes) espion.mockClear()
})

describe('ClaudeAccountsStore — l’état se pose hors du fil principal', () => {
  it('ajoute, bascule et enregistre une identité sans writeFileSync', async () => {
    const dossier = nouveauDossier()
    const etat = join(dossier, 'claude-accounts.json')
    const store = new ClaudeAccountsStore(etat, join(dossier, 'claude-accounts'))

    const ajoute = await store.add('perso')
    store.switchTo(ajoute.id)
    store.setIdentity(ajoute.id, { email: 'a@exemple.test' })

    expect(ecrituresBloquantesDe(etat)).toEqual([])
    expect(await attendreFichier(etat)).toBe(true)
    const relu = parseState(JSON.parse(readFileSync(etat, 'utf8')), 'maintenant')
    expect(relu.activeId).toBe(ajoute.id)
    expect(relu.accounts.find((compte) => compte.id === ajoute.id)?.email).toBe('a@exemple.test')
    expect(store.persistError).toBeNull()
    expect(ecrituresBloquantesDe(etat)).toEqual([])
  })

  it('un ajout que le disque refuse est refusé, et l’échec reste exposé', async () => {
    const dossier = nouveauDossier()
    // Un dossier à la place du fichier : le renommage du temporaire échoue, comme un disque refusé.
    const etat = join(dossier, 'claude-accounts.json')
    mkdirSync(join(etat, 'bloque'), { recursive: true })
    const store = new ClaudeAccountsStore(etat, join(dossier, 'claude-accounts'))

    await expect(store.add('perdu')).rejects.toThrow(/non enregistre/)

    expect(store.current().accounts.map((compte) => compte.id)).toEqual(['default'])
    expect(store.persistError).not.toBeNull()
  })
})
