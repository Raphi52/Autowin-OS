/**
 * Ce que les outils `navigateur_*` et `terminal_lire` prennent de leurs moteurs.
 *
 * Code libre sorti de `commands.ts` tel quel (conv-1580, lot 5) ; `commands.ts` ré-exporte ce qu'il
 * exportait déjà, ses importeurs ne changent pas. Dans `commands/`, une VALEUR s'importe d'ici,
 * jamais par `'../commands'` (cycle d'import) : `commands/code-libre.test.ts` le garde.
 */

// Import de TYPE seulement : le moteur charge Electron, le bus ne doit pas (tests sans Electron).
import type { GestionnaireNavigateur } from '../bureau/navigateur-integre'
import type { GestionnaireTerminal } from '../bureau/terminal-integre'
import type { RefusActionNavigateur } from '../../shared/navigateur'

/**
 * Ce que les outils `navigateur_*` prennent du moteur (conv-1286) : ses méthodes d'agent, rien
 * d'autre. Pas `ouvrir`, le chemin des boutons de l'interface : aucune pause ne le retient.
 * fix-ok: run-adc12547df2d-1 (objection du juge) — `navigateur_ouvrir` + `nouvelOnglet` l'appelait :
 * en main reprise, `ok: true` et onglet actif changé. Un outil qui l'appellerait ne compile plus.
 */
export type NavigateurDeLAgent = Pick<
  GestionnaireNavigateur,
  | 'etat'
  | 'agentOuvrir'
  | 'lire'
  | 'capturer'
  | 'agir'
  | 'lignesConsole'
  | 'requetesEchouees'
>

/**
 * Ce que `terminal_lire` prend du moteur (conv-1362, lot 3/3) : lire, et l'état pour dire pourquoi il
 * n'y a rien à lire. Ni `ecrire` ni `ouvrir` : un outil qui taperait dans le terminal ne compile pas.
 */
export type TerminalDeLAgent = Pick<GestionnaireTerminal, 'etat' | 'lire'>

export const TERMINAL_LIGNES_DEFAUT = 100
export const TERMINAL_LIGNES_MAX = 2_000

const OUTILS_NAVIGATEUR = [
  'navigateur_ouvrir',
  'navigateur_lire',
  'navigateur_capture',
  'navigateur_agir',
  'navigateur_console'
] as const
export type OutilNavigateur = (typeof OUTILS_NAVIGATEUR)[number]

export function estOutilNavigateur(name: string): name is OutilNavigateur {
  return (OUTILS_NAVIGATEUR as readonly string[]).includes(name)
}

/**
 * Ce que l'agent doit faire d'un refus des GARDE-FOUS du moteur (conv-1286). Les autres refus
 * (cible introuvable, page changée…) disent déjà quoi faire dans leur message.
 */
export const SUITE_REFUS_NAVIGATEUR: Partial<Record<RefusActionNavigateur, string>> = {
  'mot-de-passe':
    "Ne contourne pas ce refus : demande à l'utilisateur de se connecter lui-même dans le panneau, puis reprends.",
  'cadre-integre':
    "Ne contourne pas ce refus : demande à l'utilisateur de remplir ce champ lui-même, puis reprends.",
  'accord-refuse':
    'Sans son accord pour ce site, ne réessaie pas : dis-lui ce que tu voulais faire ; il autorise le site dans le bandeau du panneau.'
}
