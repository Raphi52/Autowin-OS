import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { nativeSkills, skillRoots } from './native-registry'
import { dossiersDeSkills, skillInstruction } from './skill-pipeline'
import { corrigeSkillMalTapee, resolveSkillAlias } from '../shared/skill-aliases'

/**
 * `skill_charger` — LE MODELE CHOISIT LUI-MEME UNE SKILL, sans que l'utilisateur la tape.
 *
 * Demande du 2026-10-21 (conv-1034) : « que dynamiquement le modèle puisse choisir d'utiliser des
 * skills de autowin sans que je les invoque moi-même ». Cause localisée : le corps d'un SKILL.md
 * n'entrait dans le tour que par `invokedSkillId`/`skillNommeeSansBarre` (agent-pilot.ts), donc
 * seulement quand le MESSAGE DE L'UTILISATEUR commence par son nom. L'état remettait bien chaque
 * skill avec son déclencheur (`skillsDisponibles`, commands.ts), mais le modèle n'avait AUCUNE route
 * pour en lire la procédure : il savait QUAND une skill servait, pas COMMENT la jouer.
 *
 * Même contenu que l'invocation par l'utilisateur (`skillInstruction`) : une seule source, aucune
 * seconde lecture du SKILL.md qui pourrait diverger. Une skill désactivée dans les réglages reste
 * refusée — désactivée veut dire ni injectée ni invocable, par l'humain comme par le modèle.
 */

export interface SkillChargee {
  skill: string
  /** Dossier de la skill : ses fichiers compagnons (références, scripts) se lisent depuis là. */
  dossier?: string
  procedure: string
}

export interface DepsSkillCharger {
  skills?: () => ReadonlyArray<{ id: string; enabled: boolean }>
  instruction?: (id: string) => string
  dossiers?: () => string[]
  racines?: () => string[]
}

/**
 * Le nom tel que le modèle le recopie : `look`, `/look`, ou la ligne entière de `skillsDisponibles`
 * (« look — Convertit ce qui est… »). On garde le premier mot, sans barre oblique.
 */
export function nomDeSkillDemande(brut: unknown): string {
  const texte = typeof brut === 'string' ? brut.trim() : ''
  const premier = texte.split(/[\s—–]+/u)[0] ?? ''
  return premier.replace(/^\/+/u, '').trim()
}

export function chargerSkillPourLeModele(
  args: Record<string, unknown>,
  deps: DepsSkillCharger = {}
): SkillChargee {
  const nom = nomDeSkillDemande(args.nom)
  if (!nom) {
    throw new Error(
      'skill_charger : `nom` manquant — donne le nom d’une skill listée dans skillsDisponibles (ex. look).'
    )
  }
  const connues = (deps.dossiers ?? dossiersDeSkills)()
  const alias = resolveSkillAlias(nom)
  const cible =
    connues.find((c) => c.toLowerCase() === alias.toLowerCase()) ??
    corrigeSkillMalTapee(alias, connues) ??
    alias
  const etat = (deps.skills ?? nativeSkills)().find(
    (s) => s.id.toLowerCase() === cible.toLowerCase()
  )
  if (etat && !etat.enabled) {
    throw new Error(
      `skill_charger : la skill « ${cible} » est désactivée dans les réglages — rien n’a été chargé. ` +
        'Fais le travail sans elle, ou dis à l’utilisateur qu’elle est désactivée.'
    )
  }
  const procedure = (deps.instruction ?? ((id: string) => skillInstruction(id)))(cible)
  if (!procedure) {
    throw new Error(
      `skill_charger : aucune skill nommée « ${nom} » — rien n’a été chargé. ` +
        `Disponibles : ${[...connues].sort().join(', ') || 'aucune'}.`
    )
  }
  const dossier = (deps.racines ?? (() => skillRoots()))()
    .map((racine) => join(racine, cible))
    .find((d) => existsSync(join(d, 'SKILL.md')))
  return { skill: cible, ...(dossier ? { dossier } : {}), procedure }
}
