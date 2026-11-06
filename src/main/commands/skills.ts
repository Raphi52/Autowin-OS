/**
 * Skills invocables remises au modèle à chaque tour, une ligne chacune avec son déclencheur.
 *
 * Code libre sorti de `commands.ts` tel quel (lot 5) ; `commands.ts` ré-exporte ce qu'il
 * exportait déjà, ses importeurs ne changent pas. Dans `commands/`, une VALEUR s'importe d'ici,
 * jamais par `'../commands'` (cycle d'import) : `commands/code-libre.test.ts` le garde.
 */

import { nativeSkills } from '../app/native-registry'

/**
 * Longueur du declencheur remis au modele : assez pour reconnaitre le MOMENT, pas le contrat.
 *
 * Etait a 200. Ramene a 120 le 2026-08-31 : ce bloc est le plus gros volume INVARIANT du prompt
 * (17 skills a chaque tour) pour un usage rare. La borne n'est pas un gout — elle est MESUREE :
 * a 90, `commands.declencheur-graft` tombe, le mot « procedure » de graft passant apres la coupe,
 * et graft devient indistinguable de forge. 120 est donc le plancher qui garde chaque MOMENT
 * lisible ; descendre plus bas exige de raccourcir d'abord les `description` des SKILL.md.
 */
const DECLENCHEUR_MAX = 120

/**
 * Longueur de la FRONTIERE (« PAS pour : … ») accolee au declencheur (2026-10-21).
 *
 * `kit-cliquets.test.ts` impose cette clause a chaque description, pour qu'une skill ne soit pas
 * choisie a la place d'une voisine (heal, qui CORRIGE, pour un audit de `judge`). Mesure le
 * 2026-10-21 : les 23 clauses du kit commencent toutes apres le 120e caractere — la coupe a
 * DECLENCHEUR_MAX les retirait TOUTES, et le chat choisissait une skill sans jamais voir sa
 * frontiere. 90 garde la premiere voisine, celle qu'on confond. Cout mesure sur les 26 skills :
 * le bloc passe de 3 443 a 5 602 caracteres par tour (ligne la plus longue : 229).
 */
const FRONTIERE_MAX = 90

/** Meme reconnaissance que le cliquet `kit-cliquets.test.ts` (CLAUSE), qui impose la phrase. */
const CLAUSE_FRONTIERE =
  /PAS pour|NE PAS utiliser|Ne pas utiliser|NE PAS l'utiliser|PAS l'utiliser/u

const couper = (texte: string, max: number): string =>
  texte.length > max ? `${texte.slice(0, max).trimEnd()}…` : texte

/**
 * Une ligne de `skillsDisponibles` : `id — <debut de description>[ · <frontiere>]`.
 *
 * La frontiere s'arrete a la fin de SA phrase (la suite de la description parle d'autre chose),
 * puis a FRONTIERE_MAX ; le declencheur s'arrete avant elle pour ne jamais la dire deux fois.
 */
export function ligneDeSkill(id: string, description: string | undefined): string {
  const brut = (description ?? '').replace(/\s+/gu, ' ').trim()
  if (!brut || brut === 'Skill (SKILL.md)') return id
  const debut = CLAUSE_FRONTIERE.exec(brut)?.index ?? -1
  if (debut < 0) return `${id} — ${couper(brut, DECLENCHEUR_MAX)}`
  const declencheur = couper(brut.slice(0, debut).trimEnd(), DECLENCHEUR_MAX)
  const clause = brut.slice(debut)
  const finDePhrase = clause.search(/\.\s/u)
  const frontiere = couper(
    finDePhrase > 0 ? clause.slice(0, finDePhrase + 1) : clause,
    FRONTIERE_MAX
  )
  return declencheur ? `${id} — ${declencheur} · ${frontiere}` : `${id} — ${frontiere}`
}

/**
 * Skills ACTIVES sur disque, chacune avec son DECLENCHEUR : `id — <debut de description>`.
 *
 * Defaut vecu le 2026-08-28 : le snapshot ne portait que des NOMS NUS (`forge`, `heal`, `look`...).
 * Un nom ne dit pas QUAND s'en servir, donc aucune skill ne pouvait se declencher d'elle-meme : il
 * fallait que l'utilisateur tape le slash. Or chaque SKILL.md ecrit son propre declencheur dans son
 * front-matter `description` (« Trigger the MOMENT ... ») : cette phrase existait, elle n'etait
 * simplement jamais remise au modele. La cause est ici, pas dans les SKILL.md.
 *
 * Bornee a DECLENCHEUR_MAX par skill : le declencheur suffit a RECONNAITRE le moment ; le contrat
 * complet reste charge par `skillInstruction()` a l'invocation, pas a chaque tour.
 * Une lecture qui echoue n'est jamais fatale : un snapshot sans skills vaut mieux qu'un tour perdu.
 */
export function skillsInvocables(): string[] {
  try {
    return nativeSkills()
      .filter((s) => s.enabled)
      .map((s) => ligneDeSkill(s.id, s.description))
      .sort()
  } catch {
    return []
  }
}
