// @vitest-environment happy-dom
/**
 * BLOC ACTIONS — commandes nommées et dépliables, bloc plié sur deux lignes (conv-910, 2026-10-12).
 *
 * Demande : « ce bloc fermé je veux qu'il fasse que 2 lignes et ouvert je veux que ce soit comme une
 * orchestration (une tache de fond est dépliable pour voir la liste d'actions liées a cette tache de
 * fond), n'écris pas tache de fond, écris direct ce qu'est la tache de fond ».
 *
 * Le JOURNAL ci-dessous est recopié tel quel du tour de la capture (conv-906, tour 24185479…,
 * lignes de statut 35 à 46). Une « tache de fond » y est la commande Bash en cours devenue longue :
 * même `tool_use_id`, annoncée entre `Bash · <commande>` et `Bash terminé`.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ThinkingBlock } from './ThinkingBlock'
import { actionsDuTour, sousCommandes, statutLisible } from './thinking-block-corps'

const JOURNAL = [
  'Bash · grep -n "rebaseTraceSequence\\b" chat/run-pilot-chat.ts | head -3; grep -n "function rebaseTraceSequence" -r --include=*.',
  'Bash terminé - 1 s',
  'Bash · sed -n 205,232p chat/run-pilot-chat.ts | grep -n "recovery\\|continuation"; cd /d/AutoWinOS && timeout 400 npx tsc --noEm',
  'tache de fond en cours - Check recovery variable and typecheck main',
  'tache de fond terminee - Check recovery variable and typecheck main',
  'Bash terminé - 10 s',
  'Write · D:\\AutoWinOS\\src\\main\\activity\\chat-turn-trace.test.ts',
  'Write terminé - 0 s',
  'Bash · npx prettier --write src/main/activity/chat-turn-trace.test.ts >/dev/null; timeout 300 npx vitest run src/main/activity/',
  'tache de fond en cours - Run the new trace event tests',
  'tache de fond terminee - Run the new trace event tests',
  'Bash terminé - 4 s'
]

describe('bloc Actions — une tâche nomme la commande qu’elle enveloppe', () => {
  it('ne crée aucune ligne « tache de fond » : la commande prend le nom de sa tâche', () => {
    const actions = actionsDuTour(JOURNAL, undefined, true)
    expect(actions.map((a) => [a.texte, a.outil, a.etat, a.secondes])).toEqual([
      [
        'Bash · grep -n "rebaseTraceSequence\\b" chat/run-pilot-chat.ts | head -3; grep -n "function rebaseTraceSequence" -r --include=*. — 1 s',
        'Bash',
        'ok',
        1
      ],
      ['Check recovery variable and typecheck main — 10 s', 'Bash', 'ok', 10],
      [
        'Write · D:\\AutoWinOS\\src\\main\\activity\\chat-turn-trace.test.ts — 0 s',
        'Write',
        'ok',
        0
      ],
      ['Run the new trace event tests — 4 s', 'Bash', 'ok', 4]
    ])
    expect(actions.some((a) => /tache de fond/.test(a.texte))).toBe(false)
    // Ses actions liées : les commandes que la ligne Bash enchaîne. Le libellé arrive coupé à 120
    // caractères par claude.ts : le dernier morceau le dit par « … ».
    expect(actions[1]!.sousActions).toEqual([
      'sed -n 205,232p chat/run-pilot-chat.ts | grep -n "recovery\\|continuation"',
      'cd /d/AutoWinOS',
      'timeout 400 npx tsc --noEm…'
    ])
    expect(actions[3]!.sousActions).toEqual([
      'npx prettier --write src/main/activity/chat-turn-trace.test.ts >/dev/null',
      'timeout 300 npx vitest run src/main/activity/…'
    ])
    // Une commande jamais devenue tâche reste une ligne simple, sans dépliage.
    expect(actions[0]!.sousActions).toBeUndefined()
  })

  it('une tâche en arrière-plan reste en cours après le « Bash terminé - 0 s » de son lancement', () => {
    const debut = [
      'Bash · npm test',
      'tache de fond en cours - Run the whole suite',
      'Bash terminé - 0 s',
      'Read · src/a.ts',
      'Read terminé - 1 s'
    ]
    expect(actionsDuTour(debut, undefined).map((a) => [a.texte, a.etat])).toEqual([
      ['Run the whole suite — 0 s', 'encours'],
      ['Read · src/a.ts — 1 s', 'ok']
    ])
    const fin = [...debut, 'tache de fond en echec - Run the whole suite']
    expect(actionsDuTour(fin, undefined)[0]!.etat).toBe('ko')
  })

  it('deux commandes lancées ensemble gardent chacune leur nom', () => {
    const actions = actionsDuTour(
      [
        'Bash · npm run lint',
        'Bash · npm test',
        'tache de fond en cours - Lint',
        'tache de fond en cours - Tests',
        'tache de fond terminee - Tests',
        'tache de fond terminee - Lint'
      ],
      undefined,
      true
    )
    expect(actions.map((a) => [a.texte, a.sousActions])).toEqual([
      ['Lint', ['npm run lint']],
      ['Tests', ['npm test']]
    ])
  })

  it('coupe une ligne shell en commandes, hors guillemets, et garde un tube entier', () => {
    expect(sousCommandes('cd a && git log | head -3; echo "x && y" || true')).toEqual([
      'cd a',
      'git log | head -3',
      'echo "x && y"',
      'true'
    ])
  })

  it('le signe de vie plié dit ce que fait la tâche, sans « tache de fond »', () => {
    expect(statutLisible('tache de fond en cours - Run the new trace event tests')).toBe(
      'Run the new trace event tests'
    )
    expect(statutLisible('tache de fond en echec - Lint')).toBe('Lint · en échec')
    expect(statutLisible('Bash en cours - 30 s')).toBe('Bash en cours - 30 s')
  })
})

describe('bloc Actions — rendu', () => {
  it('plié : la légende tient dans son enveloppe d’une ligne ; ouvert : la tâche se déplie', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const enCours = [...JOURNAL.slice(0, 8), JOURNAL[8]!, JOURNAL[9]!]
    await act(async () => {
      root.render(
        createElement(ThinkingBlock, {
          text: '',
          done: false,
          status: JOURNAL[9]!,
          statusLog: enCours
        })
      )
    })
    const resume = host.querySelector('[data-testid="action-block"] > summary')!
    // Seconde ligne : légende enveloppée (coupée en « … » par le CSS), puis le signe de vie lisible.
    const legende = resume.querySelector('.anneau-l2 > .anneau-legende')
    expect(legende).not.toBeNull()
    expect(
      [...legende!.querySelectorAll('[data-testid="legende-outil"]')].map((l) => l.textContent)
    ).toEqual(['Bash ×2', 'Write', 'Bash'])
    expect(host.querySelector('[data-testid="action-block-status"]')?.textContent).toBe(
      'Run the new trace event tests'
    )
    expect(host.textContent).not.toMatch(/tache de fond/)

    const taches = [
      ...host.querySelectorAll('details.thinking-frise-tache')
    ] as HTMLDetailsElement[]
    expect(taches.map((t) => [t.querySelector('summary')?.textContent, t.dataset['etat']])).toEqual(
      [
        ['Check recovery variable and typecheck main — 10 s', 'ok'],
        ['Run the new trace event tests', 'encours']
      ]
    )
    // Pliée par défaut : le détail n'est pas rendu.
    expect(host.querySelector('[data-testid="action-frise-sous-actions"]')).toBeNull()
    await act(async () => {
      taches[0]!.open = true
      taches[0]!.dispatchEvent(new Event('toggle'))
    })
    expect(
      [...host.querySelectorAll('[data-testid="action-frise-sous-action"]')].map(
        (l) => l.textContent
      )
    ).toEqual([
      'sed -n 205,232p chat/run-pilot-chat.ts | grep -n "recovery\\|continuation"',
      'cd /d/AutoWinOS',
      'timeout 400 npx tsc --noEm…'
    ])
    await act(async () => root.unmount())
    host.remove()
  })
})
