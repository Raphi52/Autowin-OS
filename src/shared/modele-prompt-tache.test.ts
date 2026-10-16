import { describe, expect, it } from 'vitest'
import {
  MODELE_PROMPT_TACHE,
  MODELE_PROMPT_TACHE_COURT,
  TETES_DU_MODELE_PROMPT_TACHE
} from './modele-prompt-tache'

/**
 * conv-983 (2026-10-16) : un seul modèle de prompt de tâche, en deux formes (écran / agent).
 * Ce test tient leur accord : un bloc ajouté ou retiré l'est dans les deux à la fois.
 */
describe('modèle de prompt d’une tâche', () => {
  it('porte les blocs qui font la justesse : critère, cas vide, sortie repérable', () => {
    expect(TETES_DU_MODELE_PROMPT_TACHE).toEqual([
      '<Verbe> <cible nommée> —',
      'Contexte :',
      'Fait =',
      'Si rien à faire :',
      'Interdit :',
      'Rends :'
    ])
  })

  it('forme longue : une ligne par bloc, dans l’ordre, puis le raccourci skill', () => {
    const lignes = MODELE_PROMPT_TACHE.split('\n')
    expect(lignes).toHaveLength(TETES_DU_MODELE_PROMPT_TACHE.length + 1)
    TETES_DU_MODELE_PROMPT_TACHE.forEach((tete, i) =>
      expect(lignes[i]!.startsWith(tete)).toBe(true)
    )
    expect(lignes.at(-1)).toContain('/<skill>')
  })

  it('forme courte : les mêmes blocs sur une seule ligne, plus légère que la longue', () => {
    expect(MODELE_PROMPT_TACHE_COURT).not.toContain('\n')
    for (const tete of TETES_DU_MODELE_PROMPT_TACHE)
      expect(MODELE_PROMPT_TACHE_COURT).toContain(tete)
    expect(MODELE_PROMPT_TACHE_COURT).toContain('/<skill>')
    expect(MODELE_PROMPT_TACHE_COURT.length).toBeLessThan(MODELE_PROMPT_TACHE.length)
  })

  it('ne pousse ni limite de temps ni obligation de boucler (mesurées sans gain)', () => {
    for (const forme of [MODELE_PROMPT_TACHE, MODELE_PROMPT_TACHE_COURT]) {
      expect(forme).not.toMatch(/timeout|jusqu.au vert|boucle/i)
    }
  })
})
