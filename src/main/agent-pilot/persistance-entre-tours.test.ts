import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from '../app/app-data'
import { deposerCompteRenduNonVu } from '../runs/compte-rendu-non-vu-store'
import {
  consommerCompteRenduEnAttente,
  deposerCompteRenduEnAttente
} from './persistance-entre-tours'

/**
 * UN VIEUX COMPTE-RENDU NE REVIENT PLUS COMME UN FAIT FRAIS.
 *
 * Mesure du 2026-11-13 sur `comptes-rendus-non-vus.json` : 152 notes, dont 79 de plus de 7 jours (la
 * plus vieille, 28 jours). Le dépôt enregistrait son heure (`at`) mais la lecture ne rendait que le
 * texte : un fil repris un mois plus tard recevait la note comme « un fait établi », sans date.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : une note déposée il y a 28 jours et lue après un redémarrage (carte
 * mémoire vide). Une correction qui daterait la note de l'heure de LECTURE (« il y a 0 min ») au lieu
 * de son dépôt, ou qui ne la daterait pas, échoue ici.
 */
const CONV = `conv-persistance-${process.pid}`
const JOUR = 24 * 3_600_000
// Heure locale du poste : c'est elle que lit l'utilisateur, et elle que la note affiche.
const DEPOT = new Date(2026, 9, 16, 14, 3).getTime()

let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'persistance-entre-tours-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

describe('consommerCompteRenduEnAttente — la note dit de quand elle date', () => {
  it('une note de 28 jours relue après un redémarrage porte sa date de dépôt, son âge et une mise en garde', () => {
    deposerCompteRenduNonVu(CONV, 'Cadrage rendu : PISTE-ANCIENNE.', undefined, DEPOT)

    const note = consommerCompteRenduEnAttente(new Map(), CONV, DEPOT + 28 * JOUR)

    expect(note).toContain('PISTE-ANCIENNE')
    expect(note).toContain('16/10/2026 14:03')
    expect(note).toContain('il y a 28 jours')
    expect(note).toContain('l’état a pu changer depuis')
  })

  it('une note de quelques minutes est datée, sans mise en garde (jumeau accepté)', () => {
    const carte = new Map()
    deposerCompteRenduEnAttente(carte, CONV, 'Cadrage rendu : PISTE-FRAICHE.', DEPOT)

    const note = consommerCompteRenduEnAttente(carte, CONV, DEPOT + 5 * 60_000)

    expect(note).toContain('PISTE-FRAICHE')
    expect(note).toContain('16/10/2026 14:03')
    expect(note).toContain('il y a 5 min')
    expect(note).not.toContain('l’état a pu changer depuis')
  })

  it('deux tours de l’app à la suite : la date gardée est celle du plus ancien qui attend', () => {
    const carte = new Map()
    deposerCompteRenduEnAttente(carte, CONV, 'PISTE-DU-SCOUT', DEPOT)
    deposerCompteRenduEnAttente(carte, CONV, 'PISTE-DU-CADRAGE', DEPOT + 3 * JOUR)

    // Redémarrage : la carte mémoire est perdue, seul le disque reste.
    const note = consommerCompteRenduEnAttente(new Map(), CONV, DEPOT + 3 * JOUR + 60_000)

    expect(note).toContain('PISTE-DU-SCOUT')
    expect(note).toContain('PISTE-DU-CADRAGE')
    expect(note).toContain('16/10/2026 14:03')
    expect(note).toContain('il y a 3 jours')
  })

  it('la note n’est remise qu’une fois', () => {
    const carte = new Map()
    deposerCompteRenduEnAttente(carte, CONV, 'PISTE-UNIQUE', DEPOT)
    expect(consommerCompteRenduEnAttente(carte, CONV, DEPOT)).toContain('PISTE-UNIQUE')
    expect(consommerCompteRenduEnAttente(carte, CONV, DEPOT)).toBeUndefined()
    expect(consommerCompteRenduEnAttente(new Map(), CONV, DEPOT)).toBeUndefined()
  })
})
