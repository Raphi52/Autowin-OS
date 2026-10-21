import { describe, expect, it } from 'vitest'
import { chargerSkillPourLeModele, nomDeSkillDemande } from './skill-charger-command'
import { CATALOG } from './commands'
import { outilsDuChat } from './chat-mcp'
import { buildChatPilotagePrompt, REGLES_VISUELLES } from './chat-pilotage-prompt'

/**
 * LE MODELE CHOISIT LUI-MEME UNE SKILL (conv-1034, 2026-10-21).
 *
 * Avant : le corps d'un SKILL.md n'entrait dans le tour QUE si le message de l'utilisateur
 * commençait par son nom. Le modèle voyait `skillsDisponibles` et leurs déclencheurs, mais n'avait
 * aucune route pour lire la procédure d'une skill qu'il jugeait utile.
 */
describe('skill_charger — le modèle charge une skill qu’il a choisie', () => {
  it('rend la procédure réelle de skills/look/SKILL.md et son dossier', () => {
    const r = chargerSkillPourLeModele({ nom: 'look' })
    expect(r.skill).toBe('look')
    expect(r.procedure).toContain('=== SKILL LOOK (kit) ===')
    // Le front-matter (sélecteur) n'est pas rendu : seulement le corps à suivre.
    expect(r.procedure).not.toMatch(/^\s*---\s*\nname:/u)
    expect(r.dossier?.replace(/\\/gu, '/')).toMatch(/skills\/look$/u)
  })

  it('accepte « /look » et la ligne entière recopiée de skillsDisponibles', () => {
    expect(nomDeSkillDemande('/look')).toBe('look')
    expect(nomDeSkillDemande('look — Convertit ce qui est AFFICHÉ…')).toBe('look')
    expect(chargerSkillPourLeModele({ nom: 'forge — FORGE l’outil…' }).skill).toBe('forge')
  })

  it('refuse une skill désactivée dans les réglages, sans rien charger', () => {
    let lue = false
    expect(() =>
      chargerSkillPourLeModele(
        { nom: 'look' },
        {
          skills: () => [{ id: 'look', enabled: false }],
          dossiers: () => ['look'],
          instruction: () => {
            lue = true
            return 'corps'
          }
        }
      )
    ).toThrow(/désactivée/u)
    expect(lue).toBe(false)
  })

  it('refuse un nom inconnu en listant les skills disponibles', () => {
    expect(() =>
      chargerSkillPourLeModele(
        { nom: 'inexistante' },
        { skills: () => [], dossiers: () => ['look', 'forge'], instruction: () => '' }
      )
    ).toThrow(/aucune skill nommée « inexistante ».*forge, look/u)
  })

  it('refuse un appel sans nom', () => {
    expect(() => chargerSkillPourLeModele({})).toThrow(/`nom` manquant/u)
  })

  it('est servie au chat comme outil direct, en lecture seule', () => {
    const spec = CATALOG.find((c) => c.name === 'skill_charger')
    expect(spec).toBeDefined()
    expect(spec?.annotations?.readOnlyHint).toBe(true)
    expect(outilsDuChat(CATALOG)).toContain('skill_charger')
  })

  it('la consigne du chat dit QUAND la charger de lui-même', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('SKILL CHOISIE PAR TOI')
    expect(prompt).toContain('skill_charger')
    expect(prompt).toContain('sans que l’utilisateur la nomme')
  })

  /*
   * Mesuré le 2026-10-21 (instance cachée, « Regarde cette capture et dis-moi ce qui cloche » +
   * capture jointe) : le modèle a appliqué le RÉSUMÉ de look écrit dans la règle visuelle, sans
   * jamais charger la checklist complète que cette même règle exige pour une anomalie — la règle
   * donnait un chemin de fichier, pas la route pour la charger.
   */
  it('la règle visuelle charge la checklist complète de look par skill_charger', () => {
    expect(REGLES_VISUELLES).toContain('`skill_charger` (look)')
    expect(REGLES_VISUELLES).toContain('skills/look/SKILL.md')
  })
})
