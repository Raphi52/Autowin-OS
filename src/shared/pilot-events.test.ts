import { describe, expect, it } from 'vitest'
import { GENRES_DU_PILOTE } from './pilot-events'

/**
 * GARDE ANTI-DÉRIVE du vocabulaire d'évènements du pilote.
 *
 * Constaté le 2026-08-04 : la liste des `kind` était recopiée à la main dans TROIS fichiers, avec
 * trois contenus différents — 12 kinds dans `src/main/agent-pilot/agent-pilot.ts`, 11 dans `AssistantPilotEvent`
 * (`prompt-call` manquant), 10 dans `ChatView.tsx` (`reasoning` et `prompt-call` manquants). Rien ne
 * le signalait : la frontière IPC reçoit `raw as PilotEvent`, un cast non vérifié, donc un kind absent
 * d'une liste se traduisait par un évènement silencieusement ignoré, jamais par une erreur.
 *
 * Ces tests existent pour que la prochaine dérive soit une ERREUR et non un silence.
 *
 * Deux gardes se complètent. La couverture de l'union `PilotEventKind` se vérifie À LA COMPILATION,
 * dans `pilot-events.ts` (`GENRES_DU_PILOTE`). Ce fichier-ci fige le contenu de ce vocabulaire à
 * l'exécution : un genre ajouté ou retiré doit se déclarer ici aussi.
 */
describe('vocabulaire des évènements du pilote — une seule source', () => {
  // fix-ok: cause mesurée — une liste écrite dans le test n'est comparée qu'à elle-même : un genre
  // fantôme ajouté à l'union laissait vitest vert (3/3). Le test lit donc `GENRES_DU_PILOTE`.
  it('GENRES_DU_PILOTE liste exactement les 19 genres attendus', () => {
    const attendus = [
      'delta',
      'stream-reset',
      'think',
      'reasoning',
      'look-decode',
      'command',
      'action-progress',
      'provider-status',
      'result',
      'done',
      'error',
      'retry',
      'cancellation',
      'prompt-call',
      'artifact',
      'echecs-abandonnes',
      'taches-de-fond',
      'tests-du-terminal',
      'coupure-filtre'
    ]
    expect(Object.keys(GENRES_DU_PILOTE).sort()).toEqual([...attendus].sort())
  })
})
