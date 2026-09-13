import { describe, expect, it } from 'vitest'
import { nativeSkills } from './native-registry'

/**
 * L'API Skills d'Anthropic plafonne `description` à 1 024 caractères
 * (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) : au-delà, la skill
 * est refusée à la publication. Et ces descriptions sont chargées à CHAQUE tour — mesuré le
 * 2026-09-12 : 27 327 caractères au total (20 664 après compression de kaizen, arena et scout), dont 4 279 pour `kaizen` seule, dont la procédure
 * complète tenait dans le sélecteur. Elle a été ramenée dans le corps de la skill.
 *
 * DETTE_CONNUE est VIDE depuis le 2026-09-12 : les 20 skills tiennent sous le plafond (max 997,
 * total 16 021, apres la reecriture des six descriptions saturees ci-dessous). Elle ne peut que RÉTRÉCIR — le troisième test refuse d'y laisser une skill déjà
 * revenue dans les clous, donc on n'y réinscrit pas une skill pour faire taire le plafond.
 */
const PLAFOND = 1024
const DETTE_CONNUE = new Set<string>([
])

describe('plafond de 1 024 caractères sur la description des skills', () => {
  const skills = nativeSkills()

  it('scanne bien le kit (sinon l’assertion suivante ne prouve rien)', () => {
    expect(skills.map((s) => s.id)).toEqual(expect.arrayContaining(['kaizen', 'build', 'judge']))
  })

  it('aucune skill hors dette connue ne dépasse le plafond', () => {
    const fautives = skills
      .filter((s) => !DETTE_CONNUE.has(s.id) && (s.description ?? '').length > PLAFOND)
      .map((s) => `${s.id}: ${(s.description ?? '').length}`)
    expect(fautives).toEqual([])
  })

  it('la dette ne contient que des skills réellement encore hors norme', () => {
    const guéries = [...DETTE_CONNUE].filter(
      (id) => (skills.find((s) => s.id === id)?.description ?? '').length <= PLAFOND
    )
    expect(guéries).toEqual([])
  })
})

/**
 * MARGE D'EDITION — DEPLACEE le 2026-09-12 vers src/main/kit-cliquets.test.ts.
 * Elle ne portait que SIX noms ecrits en dur ; elle couvre desormais TOUTES les skills decouvertes
 * sur disque, et le controle de frontieres l'a suivie. Ce fichier garde le seul plafond DUR de 1 024.
 */
