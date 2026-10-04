import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GARDES_DU_HOOK } from '../shared/garde-git-destructeur'
import type { ClaudeHookItem } from './claude-hooks'
import type { RegistryItem } from './native-registry'
import { dossierModAutowin, reglagesCliAutowin } from './providers/claude'

/**
 * CE QU'AUTOWIN INJECTE DANS CHAQUE RUN CLAUDE — pour la vue Settings › Skills · Hooks · Tools (conv-58).
 * Avant, la vue ne lisait que les hooks du settings.json de l'utilisateur, que les runs NE chargent
 * PAS (`--setting-sources ""`) : elle montrait « 0 hooks » alors que six gardes tournaient.
 * Tout est DÉRIVÉ du code qui tourne (réglages CLI, inventaire du script, manifeste du mod).
 */
export function gardesInjecteesAutowin(): ClaudeHookItem[] {
  const groupes = (reglagesCliAutowin('x') as { hooks: { PreToolUse: { matcher: string }[] } }).hooks
    .PreToolUse
  const principal = groupes[0]?.matcher ?? ''
  const tous = groupes.map((g) => g.matcher).join(' | ')
  return GARDES_DU_HOOK.map((g) => ({
    id: `autowin-garde-${g.fn}`,
    label: g.label,
    description: g.description,
    enabled: true,
    mutable: false,
    source: 'autowin',
    scope: 'global',
    event: 'PreToolUse',
    matcher: g.tousOutils ? tous : principal
  }))
}

/** Le mod Autowin, tel que les runs le chargeront : trouvé ou non, ses événements lus dans son code. */
export function modsAutowin(
  departs: readonly (string | undefined)[] = [
    typeof __dirname === 'string' ? __dirname : undefined,
    process.cwd()
  ]
): RegistryItem[] {
  const dossier = dossierModAutowin(departs)
  if (!dossier) {
    return [
      {
        id: 'autowin-mod',
        label: 'autowin (mod)',
        description: 'Mod Autowin INTROUVABLE (mods/autowin) : les runs partent sans lui.',
        enabled: false,
        mutable: false,
        source: 'autowin'
      }
    ]
  }
  let description = ''
  let evenements: string[] = []
  try {
    description = String(
      (JSON.parse(readFileSync(join(dossier, '.claude-plugin', 'plugin.json'), 'utf8')) as {
        description?: unknown
      }).description ?? ''
    )
  } catch {
    /* manifeste illisible : la vue le dira par une description vide */
  }
  try {
    const code = readFileSync(join(dossier, 'hooks', 'register.mjs'), 'utf8')
    evenements = [...new Set([...code.matchAll(/\bon\(\s*'([\w.]+)'/g)].map((m) => m[1]))]
  } catch {
    /* module illisible */
  }
  return [
    {
      id: 'autowin-mod',
      label: 'autowin (mod)',
      description:
        `${description || 'Mod Autowin.'} Événements : ${evenements.join(', ') || 'aucun lu'}. ` +
        `Chargé dans chaque run depuis ${dossier.split('\\').join('/')}.`,
      enabled: true,
      mutable: false,
      source: 'autowin'
    }
  ]
}

/**
 * GATES — les contrôles qui décident si un run peut se dire « vert » ou doit s'arrêter (conv-58).
 * `bus: true` = handler `pre-green` de `createDefaultHookBus` : un test vérifie que leur nombre est
 * EXACTEMENT celui du bus, pour qu'un contrôle ajouté sans être inscrit ici fasse échouer le test.
 */
export const GATES_DU_RUN: readonly { id: string; label: string; description: string; source: string; bus?: true }[] = [
  {
    id: 'gate-hooks-synchrones',
    label: 'Preuve avant le vert',
    description:
      'Refuse un vert sans preuve exécutée, un sleep brut ajouté au code, et la réparation à l’aveugle (même fichier édité en boucle sans cause nommée).',
    source: 'src/main/gates/hooks.ts',
    bus: true
  },
  {
    id: 'gate-appui-sources-neuves',
    label: 'Sources neuves lues',
    description: 'Exige que le run ait réellement lu les sources qu’il cite comme appui.',
    source: 'src/main/hooks/default-gate-hooks.ts',
    bus: true
  },
  {
    id: 'gate-preuve-visuelle',
    label: 'Preuve visuelle',
    description: 'Un changement d’interface exige une capture prise et lue avant le vert.',
    source: 'src/main/hooks/default-gate-hooks.ts',
    bus: true
  },
  {
    id: 'gate-preuve-mouvement',
    label: 'Preuve de mouvement',
    description: 'Un changement d’animation exige une mesure de mouvement (ui-capture --motion).',
    source: 'src/main/hooks/default-gate-hooks.ts',
    bus: true
  },
  {
    id: 'gate-rejeu-verify',
    label: 'Rejeu des vérifications',
    description: 'Rejoue lui-même les tests déclarés du projet : le vert du modèle ne suffit pas.',
    source: 'src/main/hooks/verify-replay-hook.ts',
    bus: true
  },
  {
    id: 'gate-cloture',
    label: 'Clôture du run',
    description: 'Refuse de clore un run que personne n’a déclaré fini, ou dont le juge a refusé le résultat.',
    source: 'src/main/gates/stopgate.ts'
  },
  {
    id: 'gate-plafond-reparations',
    label: 'Plafond des réparations',
    description: 'Arrête la boucle de réparation au plafond, ou quand le même refus revient à l’identique.',
    source: 'src/main/gates/stopgate.ts'
  },
  {
    id: 'gate-bundle-perime',
    label: 'Code exécuté périmé',
    description: 'Signale qu’une réparation du contrôle final ne peut rien changer tant que le code exécuté n’est pas reconstruit.',
    source: 'src/main/gates/bundle-perime.ts'
  },
  {
    id: 'gate-prod',
    label: 'Porte de la production',
    description: 'Seul point de passage vers la production : refuse sans accord borné de l’utilisateur.',
    source: 'src/main/prod-gate.ts'
  }
]

export function gatesAutowin(): RegistryItem[] {
  return GATES_DU_RUN.map((g) => ({
    id: g.id,
    label: g.label,
    description: `${g.description} (${g.source})`,
    enabled: true,
    mutable: false,
    source: 'autowin'
  }))
}
