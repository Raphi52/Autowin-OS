import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  bilanCout,
  cheminsCites,
  codeDeSortie,
  descriptionDeSkill,
  diagnostiquer,
  ecartsAvecLeLock,
  initDeTour,
  installationsDistinctes,
  masquer,
  refusRecents,
  tachesOubliees,
  plantagesRecents,
  quantile,
  rendreTexte,
  SONDES,
  ZONES
} from './doctor.mjs'

const MAINTENANT = Date.parse('2026-10-31T12:00:00Z')
const JOUR = 86_400_000

let racine
let data

function poser(chemin, contenu) {
  const complet = join(racine, chemin)
  mkdirSync(dirname(complet), { recursive: true })
  writeFileSync(complet, typeof contenu === 'string' ? contenu : JSON.stringify(contenu))
}

/* Commandes attendues : un poste sain. Une commande inconnue rend une erreur, jamais un faux vert. */
function executeurSain(surcharges = {}) {
  const reponses = {
    'node --version': 'v24.0.0',
    'git --version': 'git version 2.54.0',
    'py -3 --version': 'Python 3.13.0',
    'claude --version': '2.1.314 (Claude Code)',
    'where claude': 'C:\\n\\claude\nC:\\n\\claude.cmd',
    'claude doctor': 'No installation issues found.',
    'git rev-list --left-right --count HEAD...@{u}': '0\t0',
    'git config core.hooksPath': '.githooks',
    'git worktree list --porcelain': 'worktree D:/a\n',
    'git check-ignore -q AGENTS.md': '',
    'node scripts/brain-doctor.mjs --lecture-seule': '[OK  ] tout va bien',
    ...surcharges
  }
  return (commande) => {
    if (commande.startsWith('py -3 -c')) return { code: 0, sortie: reponses.deps ?? '[]' }
    if (commande.startsWith('node scripts/gels-classement.mjs')) {
      return { code: 0, sortie: JSON.stringify({ totaux: { fenetre: { gels: 2, pireMs: 1200 } } }) }
    }
    const sortie = reponses[commande]
    if (sortie === undefined) return { code: 1, sortie: '' }
    return { code: 0, sortie }
  }
}

function diagnostic(options = {}) {
  return diagnostiquer({
    racine,
    data,
    maintenant: MAINTENANT,
    localAppData: join(racine, 'local'),
    appData: join(racine, 'itinerant'),
    executer: executeurSain(),
    ...options
  })
}

const constat = (constats, id) => constats.find((c) => c.id === id)

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'doctor-'))
  data = join(racine, 'donnees')
  poser('package.json', { version: '1.2.3', dependencies: { a: '^1.0.0' } })
  poser('package-lock.json', { packages: { '': { dependencies: { a: '^1.0.0' } } } })
  poser('AGENTS.md', '# Contexte\n`scripts/existe.mjs`\n')
  poser('scripts/existe.mjs', '')
  poser('.githooks/pre-push', '')
  poser('.git/FETCH_HEAD', '')
  poser('.claude/settings.json', {
    hooks: { PreToolUse: [{ hooks: [{ args: ['${CLAUDE_PROJECT_DIR}/scripts/existe.mjs'] }] }] }
  })
  poser('src/main/consignes/context-files.ts', 'export const PROJECT_CONTEXT_MAX_BYTES = 32_768\n')
  poser('skills/build/SKILL.md', '---\nname: build\ndescription: >-\n  Répare un défaut.\n---\n')
  poser('src/main/providers/claude.ts', "const mode = 'bypassPermissions'\n")
  poser('src/main/gates/stopgate.ts', '')
  poser('src/main/gates/stopgate.test.ts', '')
  poser('src/main/hooks/default-gate-hooks.ts', '')
  poser('itinerant/Claude/plan-usage-history.json', {
    samples: [{ t: MAINTENANT - JOUR, u: { fh: 12, sd: 40 } }]
  })
  poser('donnees/conversations.json', [])
  poser('donnees/roles.json', { a: 1 })
  poser(
    'donnees/run-stdout/a.stdout.jsonl',
    JSON.stringify({
      subtype: 'init',
      tools: ['Read'],
      mcp_servers: [{ name: 'autowin', status: 'connected' }]
    })
  )
  poser('donnees/scheduled-tasks.json', {
    tasks: [{ id: 't', title: 'Tâche', enabled: true, nextRunAt: MAINTENANT + JOUR }],
    occurrences: [
      {
        taskId: 't',
        scheduledFor: MAINTENANT - JOUR,
        finishedAt: MAINTENANT - JOUR,
        status: 'completed'
      }
    ]
  })
  poser(
    'donnees/turn-timing.jsonl',
    JSON.stringify({
      label: 'chat',
      ts: new Date(MAINTENANT - JOUR).toISOString(),
      marks: { 'send0:start': 900 }
    })
  )
  poser('donnees/profils/moi.md', 'court')
  poser('donnees/prompt-observability/systems/a.txt', 'consigne')
  poser('donnees/murs-rencontres.json', { 'conv-1': ['run::refus'] })
  poser('donnees/cost.jsonl', '')
  poser(
    'donnees/demarrages.jsonl',
    JSON.stringify({ ts: new Date(MAINTENANT - JOUR).toISOString(), jalons: [{ ms: 7000 }] })
  )
})

afterEach(() => rmSync(racine, { recursive: true, force: true }))

describe('doctor — le bilan complet', () => {
  it('couvre les cinq zones de Claude Code, plus les services d’Autowin', () => {
    expect(ZONES).toEqual([
      'installation',
      'extensions',
      'instructions',
      'permissions',
      'usage',
      'services'
    ])
    for (const zone of ZONES)
      expect(
        SONDES.some(([z]) => z === zone),
        zone
      ).toBe(true)
    expect(new Set(SONDES.map(([, id]) => id)).size).toBe(SONDES.length)
  })

  it('un poste sain : aucune sonde en ko ni inconnue, code de sortie 0', () => {
    const constats = diagnostic()
    expect(constats.filter((c) => ['ko', 'inconnu', 'attention'].includes(c.statut))).toEqual([])
    expect(codeDeSortie(constats)).toBe(0)
  })

  it('ne change RIEN sur le disque : contenu et dates identiques après passage', () => {
    const empreinte = () => {
      const lignes = []
      const parcourir = (dossier) => {
        for (const e of readdirSync(dossier, { withFileTypes: true })) {
          const chemin = join(dossier, e.name)
          if (e.isDirectory()) parcourir(chemin)
          else {
            const hash = createHash('sha1').update(readFileSync(chemin)).digest('hex')
            lignes.push(`${chemin} ${hash} ${statSync(chemin).mtimeMs}`)
          }
        }
      }
      parcourir(racine)
      return lignes.sort().join('\n')
    }
    const avant = empreinte()
    diagnostic()
    expect(empreinte()).toBe(avant)
  })

  it('une sonde qui casse rend « inconnu » et n’emporte pas les suivantes', () => {
    const casse = [
      'usage',
      'casse',
      () => {
        throw new Error('fichier illisible')
      }
    ]
    const suivante = ['usage', 'suivante', () => ({ statut: 'ok', titre: 'vivante' })]
    const constats = diagnostic({ sondes: [casse, suivante] })
    expect(constats[0]).toMatchObject({ statut: 'inconnu', detail: 'fichier illisible' })
    expect(constats[1].statut).toBe('ok')
  })

  it('un journal absent se voit dans le bilan, il ne disparaît pas', () => {
    rmSync(join(data, 'cost.jsonl'))
    expect(constat(diagnostic(), 'cout').statut).toBe('inconnu')
  })

  it('--zone ne joue que sa zone', () => {
    const constats = diagnostic({ zone: 'instructions' })
    expect(constats.map((c) => c.zone)).toEqual(constats.map(() => 'instructions'))
    expect(constats.length).toBeGreaterThan(0)
  })
})

describe('doctor — chaque panne rend le bon constat', () => {
  it('fichier de réglages cassé : ko, nommé, et code de sortie 1', () => {
    poser('donnees/roles.json', '{ tronqué')
    const constats = diagnostic()
    expect(constat(constats, 'reglages')).toMatchObject({ statut: 'ko', detail: 'roles.json' })
    expect(codeDeSortie(constats)).toBe(1)
  })

  it('dépendance absente de node_modules : ko', () => {
    const executer = executeurSain({ deps: '["node_modules/x"]' })
    expect(constat(diagnostic({ executer }), 'dependances').statut).toBe('ko')
  })

  it('outil absent : ko qui le nomme', () => {
    const executer = (c) => (c === 'py -3 --version' ? { code: 9, sortie: '' } : executeurSain()(c))
    expect(constat(diagnostic({ executer }), 'outils').titre).toContain('python')
  })

  /* Dire si une copie sert encore est le travail de /gc : ici, seul ce que git déclare mort compte. */
  it('une copie orpheline pour git : à surveiller ; 30 copies vivantes : ok', () => {
    const vivantes = Array.from({ length: 30 }, (_, i) => `worktree D:/c${i}\n`).join('\n')
    const saines = executeurSain({ 'git worktree list --porcelain': vivantes })
    expect(constat(diagnostic({ executer: saines }), 'copies-restantes').statut).toBe('ok')
    const orpheline = executeurSain({
      'git worktree list --porcelain': `${vivantes}\nworktree D:/morte\nprunable gitdir absent\n`
    })
    expect(constat(diagnostic({ executer: orpheline }), 'copies-restantes')).toMatchObject({
      statut: 'attention',
      titre: '31 copie(s) de travail, 1 orpheline(s)'
    })
  })

  it('deux installations du CLI : à surveiller', () => {
    const executer = executeurSain({ 'where claude': 'C:\\a\\claude.exe\nD:\\b\\claude.exe' })
    expect(constat(diagnostic({ executer }), 'installs-claude').statut).toBe('attention')
  })

  it('retard sur la branche distante : à surveiller', () => {
    const executer = executeurSain({ 'git rev-list --left-right --count HEAD...@{u}': '0\t4' })
    expect(constat(diagnostic({ executer }), 'version').titre).toContain('4 commit(s) de retard')
  })

  it('garde git débranchée : à surveiller, avec la commande qui répare', () => {
    const executer = executeurSain({ 'git config core.hooksPath': '' })
    expect(constat(diagnostic({ executer }), 'hooks-git').reparation).toContain('core.hooksPath')
  })

  it('canal Brain en panne : ko qui recopie la ligne [FAIL] et pas le reste', () => {
    const executer = (c) =>
      c === 'node scripts/brain-doctor.mjs --lecture-seule'
        ? { code: 1, sortie: 'jeton     : present\n[FAIL] signature\n' }
        : executeurSain()(c)
    expect(constat(diagnostic({ executer }), 'brain')).toMatchObject({
      statut: 'ko',
      detail: '[FAIL] signature'
    })
  })

  it('serveur d’outils en échec : ko qui le nomme', () => {
    poser(
      'donnees/run-stdout/a.stdout.jsonl',
      JSON.stringify({
        subtype: 'init',
        mcp_servers: [{ name: 'autowin', status: 'failed' }]
      })
    )
    expect(constat(diagnostic(), 'serveurs-mcp')).toMatchObject({ statut: 'ko' })
  })

  describe('planificateur', () => {
    const taches = (nextRunAt) =>
      poser('donnees/scheduled-tasks.json', {
        tasks: [{ id: 't', title: 'Bilan du matin', enabled: true, nextRunAt }],
        occurrences: []
      })
    const demarreIlYA = (ms) =>
      poser(
        'donnees/demarrages.jsonl',
        JSON.stringify({ ts: new Date(MAINTENANT - ms).toISOString(), jalons: [{ ms: 7000 }] })
      )

    it('une échéance restée derrière le dernier démarrage : ko qui la nomme', () => {
      taches(MAINTENANT - 5 * JOUR)
      demarreIlYA(JOUR)
      expect(constat(diagnostic(), 'taches')).toMatchObject({
        statut: 'ko',
        titre: 'Le planificateur ne tourne plus'
      })
      expect(constat(diagnostic(), 'taches').detail).toContain('Bilan du matin')
    })

    /* Retour de 4 jours d'absence, app encore fermée : l'échéance passée n'accuse personne. */
    it('app fermée depuis l’échéance : pas de panne', () => {
      taches(MAINTENANT - 4 * JOUR)
      demarreIlYA(5 * JOUR)
      expect(constat(diagnostic(), 'taches').statut).toBe('ok')
    })

    it('démarrage à l’instant : le planificateur a encore le temps de rattraper', () => {
      taches(MAINTENANT - 4 * JOUR)
      demarreIlYA(60_000)
      expect(constat(diagnostic(), 'taches').statut).toBe('ok')
    })

    it('tâche toute neuve, sans aucune exécution : pas de panne', () => {
      taches(MAINTENANT + JOUR)
      expect(constat(diagnostic(), 'taches').statut).toBe('ok')
    })

    it('tâche ponctuelle déjà jouée, sans prochaine échéance : pas de panne', () => {
      taches(undefined)
      expect(constat(diagnostic(), 'taches').statut).toBe('ok')
    })

    it('sans démarrage connu, on ne conclut pas à la panne', () => {
      expect(tachesOubliees([{ id: 't', nextRunAt: 1 }], undefined, MAINTENANT)).toEqual([])
    })
  })

  it('une échéance manquée, app fermée, n’est pas un échec de la tâche', () => {
    const manquee = (n) => ({ taskId: 't', scheduledFor: MAINTENANT - n * JOUR, status: 'missed' })
    poser('donnees/scheduled-tasks.json', {
      tasks: [{ id: 't', title: 'Tâche', enabled: true }],
      occurrences: [
        {
          taskId: 't',
          scheduledFor: MAINTENANT - JOUR,
          finishedAt: MAINTENANT - JOUR,
          status: 'completed'
        },
        manquee(2),
        manquee(3),
        manquee(4)
      ]
    })
    const taches = constat(diagnostic(), 'taches')
    expect(taches.statut).toBe('ok')
    expect(taches.detail).toContain('3 échéance(s) manquée(s)')
  })

  it('trois vrais échecs de la même tâche : à surveiller', () => {
    const echec = (n) => ({
      taskId: 't',
      scheduledFor: MAINTENANT - n * JOUR,
      finishedAt: MAINTENANT - n * JOUR,
      status: 'failed'
    })
    poser('donnees/scheduled-tasks.json', {
      tasks: [{ id: 't', title: 'Tâche', enabled: true }],
      occurrences: [echec(1), echec(2), echec(3)]
    })
    expect(constat(diagnostic(), 'taches')).toMatchObject({
      statut: 'attention',
      detail: 'Tâche (3)'
    })
  })

  it('chemin cité disparu : à surveiller, avec le fichier qui le cite', () => {
    poser('skills/build/SKILL.md', '---\nname: build\ndescription: d\n---\n`scripts/parti.mjs`\n')
    expect(constat(diagnostic(), 'references-mortes')).toMatchObject({
      statut: 'attention',
      detail: 'skills/build/SKILL.md → scripts/parti.mjs'
    })
  })

  it('skill dont le dossier et le nom déclaré divergent : à surveiller', () => {
    poser('skills/build/SKILL.md', '---\nname: autre\ndescription: d\n---\n')
    expect(constat(diagnostic(), 'skills-format').detail).toContain('se déclare « autre »')
  })

  it('même skill dans le kit et dans la racine locale : à surveiller', () => {
    poser('local/autowin-os/skills/build/SKILL.md', '---\nname: build\ndescription: d\n---\n')
    expect(constat(diagnostic(), 'skills-format').detail).toContain('build : en double')
  })

  it('garde du CLI sur un script disparu : ko', () => {
    poser('.claude/settings.json', {
      hooks: { PreToolUse: [{ hooks: [{ args: ['${CLAUDE_PROJECT_DIR}/scripts/parti.mjs'] }] }] }
    })
    expect(constat(diagnostic(), 'gardes').statut).toBe('ko')
  })

  it('coût doublé d’une semaine sur l’autre : à surveiller', () => {
    const ligne = (jours, costUsd) =>
      JSON.stringify({ ts: new Date(MAINTENANT - jours * JOUR).toISOString(), costUsd })
    poser('donnees/cost.jsonl', [ligne(1, 300), ligne(9, 100)].join('\n'))
    expect(constat(diagnostic(), 'cout').statut).toBe('attention')
  })
})

describe('doctor — un poste qu’on ne peut pas mesurer n’est pas un poste sain', () => {
  it('dossier de données introuvable : ko explicite et code de sortie 1', () => {
    const constats = diagnostic({ data: join(racine, 'nulle-part') })
    expect(constat(constats, 'donnees')).toMatchObject({
      statut: 'ko',
      titre: 'Dossier de données introuvable'
    })
    expect(codeDeSortie(constats)).toBe(1)
  })

  it('le journal seul suffit : un démarrage récent n’a pas encore de snapshot', () => {
    rmSync(join(data, 'conversations.json'))
    poser('donnees/conversations.json.journal.jsonl', '{"op":"upsert"}\n')
    expect(constat(diagnostic(), 'donnees').statut).toBe('ok')
  })

  it('journal abîmé : à surveiller, même si tous les .json sont lisibles', () => {
    poser('donnees/conversations.json.journal.jsonl', '{"op":"a"}\n{coupée\n{"op":"b"}\n')
    expect(constat(diagnostic(), 'donnees')).toMatchObject({
      statut: 'attention',
      titre: 'Journal des conversations : 1 ligne(s) illisible(s)'
    })
  })

  it('une dernière ligne en cours d’écriture n’est pas un journal abîmé', () => {
    poser('donnees/conversations.json.journal.jsonl', '{"op":"a"}\n{"op":"b')
    expect(constat(diagnostic(), 'donnees').statut).toBe('ok')
  })

  it('une zone seule voit aussi l’absence du dossier de données', () => {
    const constats = diagnostic({ zone: 'permissions', data: join(racine, 'nulle-part') })
    expect(constat(constats, 'donnees').statut).toBe('ko')
    expect(codeDeSortie(constats)).toBe(1)
  })

  it('une zone seule ne parle pas du dossier de données quand il va bien', () => {
    expect(constat(diagnostic({ zone: 'permissions' }), 'donnees')).toBeUndefined()
  })

  it('une majorité de sondes muettes : code 3, jamais 0', () => {
    const muet = { zone: 'usage', id: 'a', statut: 'inconnu', titre: '' }
    const sain = { zone: 'usage', id: 'b', statut: 'ok', titre: '' }
    expect(codeDeSortie([muet, muet, sain])).toBe(3)
    expect(codeDeSortie([muet, sain, sain])).toBe(0)
    expect(codeDeSortie([])).toBe(0)
  })

  it('plafond de AGENTS.md introuvable : inconnu, pas un « ok » calculé sur NaN', () => {
    poser('src/main/consignes/context-files.ts', 'export const AUTRE = 1\n')
    expect(constat(diagnostic(), 'charge-permanente').statut).toBe('inconnu')
  })

  it('dossier de profils absent : la sonde mesure quand même le reste', () => {
    rmSync(join(data, 'profils'), { recursive: true })
    expect(constat(diagnostic(), 'charge-permanente').statut).toBe('ok')
  })
})

describe('doctor — zones permissions et usage', () => {
  it('nomme la vraie surface : agents sans demande du CLI, limités par les gardes d’Autowin', () => {
    expect(constat(diagnostic(), 'mode')).toMatchObject({
      statut: 'info',
      titre: 'Agents sans demande d’autorisation du CLI, limités par 1 gardes d’Autowin',
      detail: 'stopgate'
    })
  })

  it('agents sans demande et sans garde : ko', () => {
    rmSync(join(racine, 'src', 'main', 'hooks', 'default-gate-hooks.ts'))
    expect(constat(diagnostic(), 'mode').statut).toBe('ko')
  })

  it('agents soumis au CLI : info, rien à craindre', () => {
    poser('src/main/providers/claude.ts', "const mode = 'default'\n")
    expect(constat(diagnostic(), 'mode').titre).toBe('Agents soumis aux autorisations du CLI')
  })

  it('un refus sur 5 fils récents : à surveiller, avec le geste à faire', () => {
    const murs = Object.fromEntries(
      [1, 2, 3, 4, 5].map((n) => [`conv-${n}`, ['outil::refusé par la garde']])
    )
    poser('donnees/murs-rencontres.json', murs)
    const c = constat(diagnostic(), 'refus')
    expect(c.statut).toBe('attention')
    expect(c.detail).toContain('5 fils')
    expect(c.reparation).toContain('garde')
  })

  it('un refus sur 4 fils : sous le seuil', () => {
    const murs = Object.fromEntries(
      [1, 2, 3, 4].map((n) => [`conv-${n}`, ['outil::refusé par la garde']])
    )
    poser('donnees/murs-rencontres.json', murs)
    expect(constat(diagnostic(), 'refus').statut).toBe('ok')
  })

  it('forfait à 95 % de la semaine, coût stable : à surveiller', () => {
    poser('itinerant/Claude/plan-usage-history.json', {
      samples: [{ t: MAINTENANT - JOUR / 24, u: { fh: 12, sd: 95 } }]
    })
    expect(constat(diagnostic(), 'quota')).toMatchObject({
      statut: 'attention',
      titre: 'Forfait : 95 % de la semaine consommés, 12 % sur 5 heures'
    })
  })

  it('un relevé de 2 jours informe sans alerter, et tait sa fenêtre de 5 heures', () => {
    poser('itinerant/Claude/plan-usage-history.json', {
      samples: [{ t: MAINTENANT - 2 * JOUR, u: { fh: 57, sd: 95 } }]
    })
    expect(constat(diagnostic(), 'quota')).toMatchObject({
      statut: 'info',
      titre: 'Forfait : 95 % de la semaine consommés au dernier relevé'
    })
  })

  it('forfait à 79 % : pour info', () => {
    poser('itinerant/Claude/plan-usage-history.json', {
      samples: [{ t: MAINTENANT - JOUR, u: { sd: 79 } }]
    })
    expect(constat(diagnostic(), 'quota').statut).toBe('info')
  })

  it('relevé absent ou trop vieux : inconnu, jamais un chiffre périmé', () => {
    poser('itinerant/Claude/plan-usage-history.json', {
      samples: [{ t: MAINTENANT - 9 * JOUR, u: { sd: 10 } }]
    })
    expect(constat(diagnostic(), 'quota').statut).toBe('inconnu')
    rmSync(join(racine, 'itinerant'), { recursive: true })
    expect(constat(diagnostic(), 'quota').statut).toBe('inconnu')
  })
})

describe('doctor — aucun secret dans le bilan', () => {
  it.each([
    ['fetch failed https://hote.test/api?token=abc123', 'fetch failed https://hote.test/api?***'],
    ['Authorization: Bearer abcdef0123456789', 'Authorization: Bearer ***'],
    ['api_key=sk-1234567890', 'api_key=***'],
    ['"token":"abcdef"', '"token":"***"'],
    ['https://moi:motdepasse@hote.test/depot', 'https://***@hote.test/depot'],
    ['écrit par prenom.nom@exemple.fr', 'écrit par ***@***'],
    ['valeur a1b2c3d4e5f6a7b8c9d0e1f2a3b4', 'valeur ***'],
    ['GITHUB_TOKEN=ghp_court1', 'GITHUB_TOKEN=***'],
    ['AWS_SECRET_ACCESS_KEY=abcDEF123', 'AWS_SECRET_ACCESS_KEY=***'],
    ['client_secret=abc123xyz', 'client_secret=***'],
    ['AUTOWIN_BRAIN_TOKEN=abc123', 'AUTOWIN_BRAIN_TOKEN=***'],
    ['{\\"token\\":\\"abc123secret\\"}', '{\\"token\\":\\"***\\"}']
  ])('masque %s', (brut, masque) => {
    expect(masquer(brut)).toBe(masque)
  })

  it('garde les chemins et les mots composés du dépôt, seuls utiles au diagnostic', () => {
    const texte = 'src/main/store/run-worktree-coordinator.ts run-4fa7b0c653ab-1 conv-1368'
    expect(masquer(texte)).toBe(texte)
  })

  it('un jeton dans crash.log ne sort pas du script, même par --json', () => {
    const date = new Date(MAINTENANT - JOUR).toISOString()
    poser('donnees/crash.log', `[${date}] Error: fetch failed https://h.test/x?token=abc123\n`)
    const c = constat(diagnostic(), 'plantages')
    expect(c.statut).toBe('attention')
    expect(JSON.stringify(c)).not.toContain('abc123')
  })

  it('une erreur de sonde est masquée comme le reste', () => {
    const casse = [
      'usage',
      'casse',
      () => {
        throw new Error('refus token=abc123')
      }
    ]
    expect(diagnostic({ sondes: [casse] })[0].detail).not.toContain('abc123')
  })
})

describe('doctor — les calculs', () => {
  it('quantile sur une liste non triée, et sur une liste vide', () => {
    expect(quantile([30, 10, 20], 0.5)).toBe(20)
    expect(quantile([], 0.5)).toBe(0)
  })

  it('compte un dossier une fois, quels que soient ses lanceurs', () => {
    expect(
      installationsDistinctes('C:\\n\\claude\r\nC:\\n\\claude.cmd\r\nC:\\N\\claude.ps1\r\n')
    ).toEqual(['c:\\n'])
  })

  it('voit un paquet déclaré mais absent du lock', () => {
    const pkg = { dependencies: { a: '1', b: '2' } }
    const lock = { packages: { '': { dependencies: { a: '1' } } } }
    expect(ecartsAvecLeLock(pkg, lock)).toEqual(['b'])
  })

  it('un gabarit n’est pas une adresse, et une disparition racontée non plus', () => {
    expect(cheminsCites('voir `skills/<nom>/SKILL.md` et `src/*.ts`')).toEqual([])
    expect(cheminsCites('un `scripts/fingerprint.py` absent du dépôt')).toEqual([])
    expect(cheminsCites('D:/AutoWinOS/src/a.ts et ~/.claude/skills/b.md')).toEqual([])
    expect(cheminsCites('lance `scripts/a.mjs` puis `src/b.ts` et `scripts/a.mjs`')).toEqual([
      'scripts/a.mjs',
      'src/b.ts'
    ])
  })

  it('lit une description repliée comme une description en ligne', () => {
    expect(descriptionDeSkill('---\ndescription: >-\n  Une\n  phrase.\nname: x\n---')).toBe(
      'Une phrase.'
    )
    expect(descriptionDeSkill('---\ndescription: Courte\n---')).toBe('Courte')
    expect(descriptionDeSkill('---\nname: x\n---')).toBe('')
  })

  it('classe les vrais refus par fils touchés, sans compter deux fois le même fil', () => {
    const { fils, classement } = refusRecents({
      'conv-1': ['run::refusé', 'run::refusé', 'verify::test rouge'],
      'conv-2': ['run::refusé']
    })
    expect(fils).toBe(2)
    // Un test rouge est un échec d'outil, pas un refus : il n'a rien à faire dans les permissions.
    expect(classement).toEqual([['run::refusé', 2]])
  })

  it('lit les entrées datées du registre comme les anciennes signatures seules', () => {
    const { classement } = refusRecents({
      'conv-1': [{ signature: 'run::refusé', derniereFois: '2026-11-13T09:30:00.000Z' }],
      'conv-2': ['run::refusé']
    })
    expect(classement).toEqual([['run::refusé', 2]])
  })

  it('ne garde que les fils les plus récents : le rang de conv-N tient lieu de date', () => {
    const murs = {
      'conv-9': ['run::refusé'],
      'conv-10': ['outil::bloqué'],
      'conv-2': ['run::refusé']
    }
    expect(refusRecents(murs, 1).classement).toEqual([['outil::bloqué', 1]])
  })

  it('une ligne de coût sans date n’entre dans aucune semaine', () => {
    const lignes = [
      { costUsd: 50 },
      { ts: new Date(MAINTENANT).toISOString(), costUsd: 7, role: 'r', model: 'm' }
    ]
    expect(bilanCout(lignes, MAINTENANT)).toEqual({ total: 7, avant: 0, postes: [['r sur m', 7]] })
  })

  it('regroupe les plantages récents par message et ignore la pile', () => {
    const journal = [
      '[2026-10-30T10:00:00.000Z] unhandledRejection: Boum',
      'Error: Boum',
      '    at x (y.js:1:1)',
      '[2026-01-01T10:00:00.000Z] uncaughtException: Vieux'
    ].join('\n')
    expect(plantagesRecents(journal, MAINTENANT - 7 * JOUR)).toEqual([
      ['unhandledRejection : Boum', 1]
    ])
  })

  it('une ligne init tronquée ne fait pas tomber la sonde', () => {
    expect(initDeTour('{"subtype":"init","tools":[')).toBeNull()
    expect(initDeTour('{"type":"autre"}')).toBeNull()
  })

  it('le rapport texte groupe par zone et fait le compte', () => {
    const texte = rendreTexte([
      {
        zone: 'usage',
        id: 'a',
        statut: 'ko',
        titre: 'Cassé',
        detail: 'pourquoi',
        reparation: 'faire X'
      },
      { zone: 'services', id: 'b', statut: 'ok', titre: 'Bon', detail: '' }
    ])
    expect(texte).toContain('USAGE\n  [KO] Cassé\n       pourquoi\n       -> faire X')
    expect(texte).toContain('Bilan : 1 ko · 0 à surveiller · 0 inconnu(s) · 0 pour info · 1 ok')
  })
})
