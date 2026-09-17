import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { noteSkillInconnue, skillInstruction } from './skill-pipeline'

/**
 * UN `/nom` INCONNU DOIT PORTER, PAS ECHOUER SANS BRUIT.
 *
 * Mesure du 2026-09-16 sur `conversations.json` : 12 invocations réellement tapées par l'utilisateur
 * n'ont chargé aucune procédure — `/design` 6 fois (après son retrait volontaire du 2026-09-03),
 * `/skill` 3 fois, puis `/usage`, `/front-converge`, `/ingest`. Le message repartait comme du texte
 * ordinaire : ni l'utilisateur ni l'agent ne savaient que la commande n'avait pas pris.
 */
const racine = join(tmpdir(), `skills-inconnue-${Date.now()}`)

beforeAll(() => {
  for (const nom of ['draft', 'build', 'judge', 'scout']) {
    mkdirSync(join(racine, nom), { recursive: true })
    writeFileSync(join(racine, nom, 'SKILL.md'), `corps de ${nom}`, 'utf8')
  }
})
afterAll(() => rmSync(racine, { recursive: true, force: true }))

describe('noteSkillInconnue', () => {
  it('se tait quand la skill EXISTE — rien à signaler', () => {
    expect(noteSkillInconnue('draft', [racine])).toBeUndefined()
    expect(skillInstruction('draft', [racine])).toContain('corps de draft')
  })

  it('se tait sur une faute d’UNE lettre : le rattrapage existant fait déjà le travail', () => {
    expect(noteSkillInconnue('draf', [racine])).toBeUndefined()
    expect(skillInstruction('draf', [racine])).toContain('corps de draft')
  })

  it('nomme la commande inconnue et ordonne de le dire — le cas réel de /design', () => {
    const note = noteSkillInconnue('design', [racine])
    expect(note).toBeDefined()
    expect(note).toContain('/design')
    expect(note).toContain("aucune procédure de ce nom n'existe")
    expect(note).toContain('Dis-le-lui')
    // Le corps, lui, reste vide : la note ne fabrique aucune procédure.
    expect(skillInstruction('design', [racine])).toBe('')
  })

  it('propose les noms les plus PROCHES plutôt que tout le kit', () => {
    // `/bui` partage un préfixe avec `build` : c'est lui qu'on remonte.
    expect(noteSkillInconnue('bui', [racine])).toContain('/build')
  })

  it('liste les procédures disponibles quand rien ne ressemble à la commande tapée', () => {
    const note = noteSkillInconnue('ingest', [racine])
    expect(note).toContain('Les procédures disponibles')
    expect(note).toContain('/draft')
  })

  it('refuse un identifiant hors forme sans jamais le renvoyer tel quel', () => {
    expect(noteSkillInconnue('../../ailleurs', [racine])).toBeUndefined()
  })
})
