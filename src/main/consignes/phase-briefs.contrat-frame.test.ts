import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PHASE_BRIEFS } from './phase-briefs'

/*
 * Le contrat de sortie de FRAME est écrit deux fois : dans skills/frame/SKILL.md (étapes 6-7) et
 * dans la consigne que l'app donne au modèle (PHASE_BRIEFS.frame). Deux rédactions séparées
 * divergent sans bruit ; ce test garde au moins la LISTE des sections exigées identique.
 */
const SECTIONS_DU_CONTRAT = ['Besoin', 'Contraintes', 'Confiance', 'Options']

const sectionsCitees = (texte: string): Set<string> =>
  new Set([...texte.matchAll(/##\s+([A-ZÉ][a-zéè]+)/gu)].map((m) => m[1]))

describe('contrat de FRAME : la skill et la consigne de l’app exigent les mêmes sections', () => {
  const skill = sectionsCitees(readFileSync('skills/frame/SKILL.md', 'utf8'))
  const consigne = sectionsCitees(PHASE_BRIEFS.frame)

  it.each(SECTIONS_DU_CONTRAT)('« ## %s » figure des deux côtés', (section) => {
    expect({ section, skill: skill.has(section) }).toEqual({ section, skill: true })
    expect({ section, consigne: consigne.has(section) }).toEqual({ section, consigne: true })
  })

  it('la consigne n’exige aucune section que la skill ignore', () => {
    expect([...consigne].filter((s) => !skill.has(s))).toEqual([])
  })
})
