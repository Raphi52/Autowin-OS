/**
 * Ce que le renderer doit savoir pour AFFICHER un bouton « réparer » : quels prérequis sont
 * réparables, et sous quel libellé.
 *
 * Pourquoi une copie et pas un import de `planPreflightRepair` : ce dernier vit dans le main et tire
 * `node:child_process` — inimportable depuis le renderer. La divergence entre les deux listes est le
 * risque réel (un bouton pour un check que le main refuse, ou l'inverse) ; elle est verrouillée par un
 * test de contrat qui compare les deux sources, pas par la vigilance.
 */
export interface RepairAffordance {
  label: string
  note: string
}

export const PREFLIGHT_REPAIRS: Record<string, RepairAffordance> = {
  'codex-session': {
    label: 'Se connecter',
    note: 'Une console s’ouvre : le login OAuth s’y fait. Rien n’est saisi dans Autowin.'
  },
  'claude-session': {
    label: 'Se connecter',
    note: 'Une console s’ouvre : le CLI est installé s’il manque, puis le login Anthropic s’y fait. Rien n’est saisi dans Autowin.'
  },
  'brain-venv': {
    label: 'Installer',
    note: 'Ouvre une console sur scripts/bootstrap-deps.ps1 : il pose le venv et le tooling du Brain (plusieurs minutes).'
  },
  brain: {
    label: 'Démarrer',
    note: 'Tente de lancer le brain_server local (le port s’ouvre après ~30-40 s de préchauffage).'
  }
}

/** Affordance de réparation d'un check, ou `undefined` → aucun bouton (rien d'honnête à proposer). */
export function repairAffordance(checkId: string): RepairAffordance | undefined {
  return PREFLIGHT_REPAIRS[checkId]
}
