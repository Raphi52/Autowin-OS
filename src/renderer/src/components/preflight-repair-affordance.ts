import { langueCourante } from '../langue'
import {
  traduireReglagesEtDecor,
  type CleReglagesEtDecor
} from '../textes-ecrans/reglages-et-decor'

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

/**
 * Les clés de traduction de chaque réparable (conv-1170). `PREFLIGHT_REPAIRS` reste en français :
 * c'est lui que le test de contrat compare, mot pour mot, au plan du moteur (`preflight-repair.ts`).
 * Ce que l'écran AFFICHE passe par `repairAffordance`, dans la langue de l'interface.
 */
const CLES_REPARATION: Readonly<
  Record<string, { label: CleReglagesEtDecor; note: CleReglagesEtDecor }>
> = {
  'claude-session': {
    label: 'reparation.claudeSession.libelle',
    note: 'reparation.claudeSession.note'
  },
  'brain-venv': { label: 'reparation.brainVenv.libelle', note: 'reparation.brainVenv.note' },
  brain: { label: 'reparation.brain.libelle', note: 'reparation.brain.note' }
}

/** Affordance de réparation d'un check, ou `undefined` → aucun bouton (rien d'honnête à proposer). */
export function repairAffordance(checkId: string): RepairAffordance | undefined {
  const reparation = PREFLIGHT_REPAIRS[checkId]
  const cles = CLES_REPARATION[checkId]
  if (!reparation || !cles) return reparation
  const langue = langueCourante()
  return {
    label: traduireReglagesEtDecor(cles.label, langue),
    note: traduireReglagesEtDecor(cles.note, langue)
  }
}
