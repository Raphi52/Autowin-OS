import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  empreinteFichier,
  lireEtatMigration,
  ecrireEtatMigration,
  doitMigrerLaConversation,
  type EtatMigrationTraces
} from './migration-traces-etat'

/**
 * LA MIGRATION DES TRACES NE DOIT PAS SE REJOUER EN ENTIER À CHAQUE DÉMARRAGE.
 *
 * Mesure du 2026-09-05 (`gels.jsonl`) : « démarrage : construction de la fenêtre » a bloqué
 * l'application 3579 ms, dont 1347 ms dans 283 `readFileSync`. La pile désigne
 * `migrateLegacyCausalTraces` : pour CHAQUE conversation (263 sur ce poste), elle relit la trace
 * causale ET le journal de prompts — alors que cette migration est idempotente et déjà faite.
 *
 * Ce module décide qui doit être relu. Ce que ces tests exigent :
 *  (a) une conversation dont le journal de prompts n'a pas bougé et qui portait des appels natifs
 *      est SAUTÉE — c'est tout le gain ;
 *  (b) le moindre changement de ce journal la fait re-migrer — sinon on perdrait des événements ;
 *  (c) une conversation SANS appel natif dépend du spool natif partagé : elle re-migre dès que ce
 *      spool change, car c'est de lui que viennent ses traces ;
 *  (d) un état absent, illisible ou incomplet fait TOUT re-migrer : on ne saute jamais dans le doute.
 */
let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'migration-traces-'))
})
afterEach(() => rmSync(racine, { recursive: true, force: true }))

const etatAvec = (entrees: EtatMigrationTraces['conversations']): EtatMigrationTraces => ({
  spool: 'spool-v1',
  conversations: entrees
})

describe('empreinte de fichier', () => {
  it('change quand le contenu change, et vaut absent quand le fichier n existe pas', () => {
    const chemin = join(racine, 'conv-1.jsonl')
    expect(empreinteFichier(chemin)).toBe('absent')
    writeFileSync(chemin, 'a\n', 'utf8')
    const premiere = empreinteFichier(chemin)
    expect(premiere).not.toBe('absent')
    writeFileSync(chemin, 'a\nb\n', 'utf8')
    expect(empreinteFichier(chemin)).not.toBe(premiere)
  })
})

describe('faut-il re-migrer cette conversation', () => {
  it('saute une conversation inchangee qui portait des appels natifs', () => {
    const etat = etatAvec({ 'conv-1': { prompts: 'e1', natif: true } })
    expect(doitMigrerLaConversation('conv-1', 'e1', etat, 'spool-v1')).toBe(false)
    // Le spool a beau bouger, elle n'en dependait pas.
    expect(doitMigrerLaConversation('conv-1', 'e1', etat, 'spool-v2')).toBe(false)
  })

  it('re-migre des que le journal de prompts a change', () => {
    const etat = etatAvec({ 'conv-1': { prompts: 'e1', natif: true } })
    expect(doitMigrerLaConversation('conv-1', 'e2', etat, 'spool-v1')).toBe(true)
  })

  it('re-migre une conversation sans natif quand le spool partage a change', () => {
    const etat = etatAvec({ 'conv-2': { prompts: 'absent', natif: false } })
    expect(doitMigrerLaConversation('conv-2', 'absent', etat, 'spool-v1')).toBe(false)
    expect(doitMigrerLaConversation('conv-2', 'absent', etat, 'spool-v2')).toBe(true)
  })

  it('re-migre une conversation jamais vue, ou quand l etat est absent', () => {
    const etat = etatAvec({ 'conv-1': { prompts: 'e1', natif: true } })
    expect(doitMigrerLaConversation('conv-neuve', 'e9', etat, 'spool-v1')).toBe(true)
    expect(doitMigrerLaConversation('conv-1', 'e1', undefined, 'spool-v1')).toBe(true)
  })
})

describe('etat sur disque', () => {
  it('relit ce qui a ete ecrit', () => {
    const chemin = join(racine, 'etat.json')
    const etat = etatAvec({ 'conv-1': { prompts: 'e1', natif: true } })
    ecrireEtatMigration(chemin, etat)
    expect(lireEtatMigration(chemin)).toEqual(etat)
  })

  it('rend undefined sur un fichier absent ou illisible — jamais un etat invente', () => {
    expect(lireEtatMigration(join(racine, 'rien.json'))).toBeUndefined()
    const casse = join(racine, 'casse.json')
    writeFileSync(casse, '{ pas du json', 'utf8')
    expect(lireEtatMigration(casse)).toBeUndefined()
  })

  it('cree le dossier parent au besoin plutot que d echouer en silence', () => {
    const chemin = join(racine, 'sous', 'dossier', 'etat.json')
    ecrireEtatMigration(chemin, etatAvec({}))
    expect(lireEtatMigration(chemin)).toEqual(etatAvec({}))
  })

  it('une ecriture qui echoue ne jette pas — la migration doit continuer sans son cache', () => {
    const dossier = join(racine, 'occupe')
    mkdirSync(dossier, { recursive: true })
    // Chemin qui est un DOSSIER : l'écriture est impossible.
    expect(() => ecrireEtatMigration(dossier, etatAvec({}))).not.toThrow()
  })
})
