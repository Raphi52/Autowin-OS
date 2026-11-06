/**
 * « AFFICHER MES AGENTS À » (demande utilisateur du 2026-11-05) : le poste retient les postes
 * à qui il masque ses agents, les écrit dans `presence.json`, et le lecteur d'un poste nommé ne les
 * affiche pas — tout en gardant la personne dans la liste des réglages. Écrit pour de vrai dans des
 * dossiers temporaires.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PRESENCE_MASQUES_MAX,
  postesLisibles,
  type AgentAPublier
} from '../../shared/quartier-presence'
import { creerDossierDuBoard, FICHIER_DU_REGLAGE, lireMasquesDeLaPresence } from '../board/board-dossier'
import { presenceAEcrire } from './quartier-presence'
import { creerLecteurDePresence, presenceLue } from './quartier-presence-collegues'

const MAINTENANT = Date.parse('2026-11-05T09:00:00.000Z')
const iso = (decalageMs = 0): string => new Date(MAINTENANT + decalageMs).toISOString()

let racine: string
let partage: string
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'masques-reglage-'))
  partage = mkdtempSync(join(tmpdir(), 'masques-partage-'))
})
afterEach(() => {
  rmSync(racine, { recursive: true, force: true })
  rmSync(partage, { recursive: true, force: true })
})

const agent: AgentAPublier = {
  id: 'conv-1',
  titre: 'Fil 1',
  phase: 'travail',
  metier: 'lire',
  depuis: MAINTENANT - 60_000
}

function ecrirePresence(poste: string, extra: Record<string, unknown> = {}): void {
  mkdirSync(join(partage, poste), { recursive: true })
  writeFileSync(
    join(partage, poste, 'presence.json'),
    JSON.stringify({
      format: 'autowin-presence/1',
      poste,
      nom: `${poste[0].toUpperCase()}${poste.slice(1)} Martin`,
      enregistreA: iso(-30_000),
      agents: [
        { id: 'conv-1', titre: 'Fil 1', phase: 'travail', metier: 'lire', depuis: iso(-60_000) }
      ],
      ...extra
    }),
    'utf8'
  )
}

const lecteurDe = (moi: string) =>
  creerLecteurDePresence({
    ou: () => ({ dossier: partage, poste: moi }),
    maintenant: () => MAINTENANT
  })

describe('postesLisibles : la liste vient d’un fichier ou de la vue', () => {
  it('met en minuscules, retire doublons, vides, chemins et invisibles, et borne à 50', () => {
    expect(
      postesLisibles([' Bob ', 'bob', '', 'a/b', 'c\\d', 'e‮f', 42, 'x'.repeat(65), 'Carol'])
    ).toEqual(['bob', 'carol'])
    expect(postesLisibles('bob')).toEqual([])
    expect(postesLisibles(Array.from({ length: 80 }, (_, i) => `poste${i}`))).toHaveLength(
      PRESENCE_MASQUES_MAX
    )
  })
})

describe('presence.json porte la liste des postes masqués', () => {
  it('écrit masquesPour quand la liste n’est pas vide, et jamais quand le partage est coupé', () => {
    expect(
      presenceAEcrire(
        [agent],
        { nom: 'Alice', partager: true, masquesPour: ['Bob', 'bob'] },
        'alice'
      ).masquesPour
    ).toEqual(['bob'])
    expect(
      presenceAEcrire([agent], { nom: 'Alice', partager: true, masquesPour: [] }, 'alice')
    ).not.toHaveProperty('masquesPour')
    expect(
      presenceAEcrire([agent], { nom: 'Alice', partager: false, masquesPour: ['bob'] }, 'alice')
    ).not.toHaveProperty('masquesPour')
  })
})

describe('le réglage, rangé dans le réglage du Board', () => {
  it('retenu, relu au démarrage, et préservé par les autres réglages', async () => {
    expect(lireMasquesDeLaPresence(racine)).toEqual([])
    const board = creerDossierDuBoard({ racine, utilisateur: 'alice' })
    expect(board.etat().masquerPresencePour).toBeUndefined()
    expect((await board.choisirMasquesPresence(['Bob', 'carol'])).masquerPresencePour).toEqual([
      'bob',
      'carol'
    ])
    // Le nom, l'animal, le partage coupé ou l'oubli du dossier ne font pas perdre la liste.
    await board.choisirNom('Alice M.')
    await board.choisirAnimal('renard')
    await board.choisirPartagePresence(false)
    await board.effacer()
    expect(lireMasquesDeLaPresence(racine)).toEqual(['bob', 'carol'])
    expect(
      creerDossierDuBoard({ racine, utilisateur: 'alice' }).etat().masquerPresencePour
    ).toEqual(['bob', 'carol'])
    // Et changer la liste ne fait pas perdre l'animal.
    await board.choisirMasquesPresence([])
    const fichier = JSON.parse(readFileSync(join(racine, FICHIER_DU_REGLAGE), 'utf8'))
    expect(fichier).not.toHaveProperty('masquerPresencePour')
    expect(fichier.animal).toBe('renard')
  })

  it('un réglage illisible ne masque personne', () => {
    writeFileSync(join(racine, FICHIER_DU_REGLAGE), '{ pas du json', 'utf8')
    expect(lireMasquesDeLaPresence(racine)).toEqual([])
    writeFileSync(
      join(racine, FICHIER_DU_REGLAGE),
      JSON.stringify({ masquerPresencePour: 'bob' }),
      'utf8'
    )
    expect(lireMasquesDeLaPresence(racine)).toEqual([])
  })
})

describe('la relecture respecte la liste du collègue', () => {
  it('masqué pour moi : ses agents n’apparaissent pas, mais il reste dans la liste des personnes', async () => {
    ecrirePresence('alice', { masquesPour: ['bob'] })
    ecrirePresence('carol')
    const pourBob = await lecteurDe('Bob').lire()
    expect(pourBob.collegues.map((c) => c.poste)).toEqual(['carol'])
    expect(pourBob.personnes).toEqual([
      { poste: 'alice', prenom: 'Alice', enLigne: false },
      { poste: 'carol', prenom: 'Carol', enLigne: true }
    ])
    // Un autre poste, lui, voit toujours les agents d'Alice.
    const pourDan = await lecteurDe('dan').lire()
    expect(pourDan.collegues.map((c) => c.poste)).toEqual(['alice', 'carol'])
  })

  it('une personne éteinte ou au partage coupé reste listée, hors ligne', async () => {
    ecrirePresence('alice', { enregistreA: iso(-10 * 60_000) })
    ecrirePresence('carol', { coupe: true, agents: [] })
    const lu = await lecteurDe('bob').lire()
    expect(lu.collegues).toEqual([])
    expect(lu.personnes?.map((p) => [p.poste, p.enLigne])).toEqual([
      ['alice', false],
      ['carol', false]
    ])
  })

  it('une liste abîmée dans le fichier ne masque rien et n’écarte pas le collègue', () => {
    const lu = presenceLue(
      JSON.stringify({
        format: 'autowin-presence/1',
        poste: 'alice',
        nom: 'Alice',
        enregistreA: iso(),
        masquesPour: { bob: true },
        agents: []
      })
    )
    expect(lu.kind).toBe('presence')
    if (lu.kind === 'presence') expect(lu.masquesPour).toEqual([])
  })
})
