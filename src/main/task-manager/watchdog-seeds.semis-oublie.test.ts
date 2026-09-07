import { describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import type { TaskStoreSnapshot } from './types'
import { seedWatchdogTasks } from './watchdog-seeds'

/**
 * LE SEMIS QUE LE MENAGE NE RECONNAISSAIT PAS — et qui a donc continue a payer.
 *
 * `removeSeededAutoKaizen` ne supprime que ce qui correspond a une empreinte EXACTE : c'est ce qui
 * garantit qu'une regle adaptee par l'utilisateur reste la sienne. Le prix de cette prudence est
 * qu'une version LIVREE oubliee dans la liste survit a jamais, en silence.
 *
 * Mesure du 2026-09-07 sur le poste : `scheduled-tasks.json` ne contenait plus qu'UNE tache, la
 * regle auto-kaizen, `enabled: true`, `action: 'orchestration'`, sans plafond de cout journalier —
 * alors que l'auto-kaizen a ete retire du produit. `seeds: ["auto-kaizen-v1"]` prouve que c'est un
 * semis d'origine et non une creation manuelle, et son `updatedAt` (2026-09-02T13:45:04Z) coincide
 * avec un reveil, pas avec une edition humaine. Le binaire en cours (`out/main/index.js`, reconstruit
 * le meme matin) contenait bien les sept empreintes : le menage a tourne et n'a rien supprime.
 *
 * Cout constate du trou : cinq reveils payants sur LA MEME signature (`run-c3ea95026bf4-1`,
 * conv-21), dont 7,64 $ le 09-05 et 12,28 $ le 09-06 — ce dernier ayant produit un travail valide
 * (110 tests verts) perdu ensuite au refus d'integration.
 *
 * Le TEMOIN ci-dessous est l'enregistrement DU DISQUE, recopie tel quel, et il passe par `hydrate`
 * comme au demarrage reel : c'est la seule facon d'eprouver le chemin qui a echoue. La regle vient
 * du commit `e8f084db` (`watchdog-seeds.ts:31-88` a l'epoque) ; `authorityMode` n'y figure plus
 * parce que `hydrate` l'efface deja comme champ legacy.
 */
const REGLE_DU_DISQUE = {
  id: 'f48eea16-d07f-4da5-bbde-409c16207ddd',
  title: 'Auto-kaizen — orchestration rouge ou workflow douteux',
  prompt:
    'Un workflow vient de mal se terminer — soit en echec, soit en annoncant un succes que rien\n' +
    "n'etaye. Etablis ce qui s'est reellement passe avant de conclure.\n" +
    '\n' +
    '1. Lis le RUN.md cite dans le contexte : son besoin, ses decisions, son journal.\n' +
    '2. Cherche la cause RACINE, pas le symptome le plus visible. Un echec en fin de chaine vient\n' +
    "   souvent d'une decision prise bien plus tot.\n" +
    "3. Si le workflow s'est dit REUSSI sans preuve, la question n'est pas « qu'est-ce qui a\n" +
    "   casse » mais « est-ce reellement fait ? ». Cherche la preuve manquante ; si elle n'existe\n" +
    "   pas, dis-le : un faux vert coute plus cher qu'un rouge.\n" +
    '4. Si la cause est claire ET la correction bornee, corrige-la et prouve-le par un signal\n' +
    '   hors-modele (test rouge->vert, code de sortie, requete). Sans preuve, ne dis pas que\n' +
    "   c'est repare.\n" +
    "5. Si la cause n'est pas etablie, ne repare rien : rapporte ce que tu as ecarte et ce qui\n" +
    '   reste a verifier. Une reparation sur une cause supposee cree le defaut suivant.',
  enabled: true,
  mode: 'active-only',
  destination: {
    kind: 'new',
    title: 'Auto-kaizen',
    category: 'Qualite',
    provider: 'claude',
    // Donnee RUNTIME : la conversation dediee creee au premier reveil. Elle ne compte pas comme une
    // edition (voir `hasExactSeedDestination`), et le temoin la porte donc exprès.
    conversationId: 'conv-15'
  },
  watchdog: {
    source: {
      kind: 'app-event',
      events: [
        'orchestration-red',
        'workflow-gate-failed',
        'workflow-unverified',
        'workflow-proof-lost'
      ]
    },
    action: 'orchestration',
    guards: {
      dedupWindowMs: 300_000,
      maxTriggersPerHour: 4,
      maxChainDepth: 0,
      maxPerRoot: 3
    }
  },
  nextRunAt: null,
  createdAt: 1786360536641,
  updatedAt: 1788356704924
} as unknown as TaskStoreSnapshot['tasks'][number]

function storeDuDisque(): TaskStore {
  const tasks = new TaskStore({ now: () => 1788762957336, id: () => 'task-1' })
  tasks.hydrate({
    schemaVersion: 1,
    tasks: [REGLE_DU_DISQUE],
    occurrences: [],
    alerts: [],
    seeds: ['auto-kaizen-v1']
  })
  return tasks
}

describe('seedWatchdogTasks — la premiere version livree de l’auto-kaizen', () => {
  it('efface la regle telle qu’elle existe sur le poste', () => {
    const tasks = storeDuDisque()

    seedWatchdogTasks(tasks)

    expect(tasks.listTasks()).toEqual([])
  })

  it('laisse cette meme version si l’utilisateur en a change un seul reglage', () => {
    const tasks = storeDuDisque()
    const mienne = tasks.listTasks()[0]
    tasks.update(mienne.id, { watchdog: { ...mienne.watchdog!, action: 'chat' } })

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(mienne.id)?.watchdog?.action).toBe('chat')
  })
})
