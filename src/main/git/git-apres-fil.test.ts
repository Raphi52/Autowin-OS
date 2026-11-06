import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bandeauPublie,
  blocDuTour,
  lignesGitDuTour,
  noteATrier,
  commitsPublies,
  decisionGitApresFil,
  estDepotAutowin,
  CALME_AVANT_PUBLICATION_MS,
  FileGitApresFil,
  filDeLaPasse,
  lireAmont,
  planTourneEncore,
  travauxParFil,
  travauxTentesSurDisque,
  type PasseGit,
  type TourFini
} from './git-apres-fil'
import {
  LONGUEUR_MAX_PROMPT,
  promptsDesBoutons
} from '../../renderer/src/components/bouton-prompt-html'
import type { AutoCloseReport } from '../runs/run-autoclose'
import { annonceCommitLocal } from '../chat/annonce-commit-local'
import type { IssueDePasse } from './git-apres-fil-sans-tour'
import { viderFichiersEnAttente } from '../gel/ecriture-hors-fil'

/** Un tour qui REMPLIT toutes les conditions : chaque test n'en casse qu'une. */
function tourPublie(partiel: Partial<TourFini> = {}): TourFini {
  return {
    accord: true,
    dossierAutowin: true,
    deFond: false,
    demande: 'Corrige le bouton du chat',
    demandesDuFil: ['Regarde le bouton du chat', 'Corrige le bouton du chat'],
    compteRendu: 'C’est corrigé.\nAUTOWIN_FIN_V1',
    rapport: rapportLaisse(),
    ...partiel
  }
}

function rapportLaisse(partiel: Partial<AutoCloseReport> = {}): AutoCloseReport {
  return {
    runId: 'conv-9 · tour abcd1234',
    branch: 'auto/conv-9-abcd1234',
    project: { status: 'skipped', reason: 'unattributed' },
    at: '2026-10-30T20:00:00.000Z',
    source: 'chat',
    exclus: [{ path: 'src/a.ts', motif: 'touche-par-un-autre-fil', fils: ['conv-8'] }],
    ...partiel
  }
}

describe('decisionGitApresFil — quand /git part tout seul', () => {
  it('part pour un fil fini dont l’enchaînement a laissé des fichiers faute de preuve', () => {
    expect(decisionGitApresFil(tourPublie())).toEqual({ lancer: true, fichiers: ['src/a.ts'] })
  })

  it('part aussi quand une partie est déjà publiée et qu’il reste des fichiers', () => {
    const rapport = rapportLaisse({
      project: { status: 'pushed', branch: 'main', files: 2, mode: 'direct' },
      exclus: [
        { path: 'src/a.ts', motif: 'modifie-avant-le-tour' },
        { path: 'src/b.ts', motif: 'autre-fil-en-cours' }
      ]
    })
    expect(decisionGitApresFil(tourPublie({ rapport }))).toEqual({
      lancer: true,
      fichiers: ['src/a.ts', 'src/b.ts']
    })
  })

  it('l’accord absent ne lance rien : c’est le défaut, et un lancement coûte un tour', () => {
    expect(decisionGitApresFil(tourPublie({ accord: false }))).toEqual({
      lancer: false,
      raison: 'accord-absent'
    })
  })

  it('un fil sans AUTOWIN_FIN_V1 publie aussi : 32 des 35 /git tapés en 7 jours suivaient un tel tour (conv-1544)', () => {
    const compteRendu = ['Corrigé.', 'AUTOWIN_PROMPT_V1: [80] Ajoute un test.'].join('\n')
    expect(decisionGitApresFil(tourPublie({ compteRendu }))).toEqual({
      lancer: true,
      fichiers: ['src/a.ts']
    })
  })

  it.each([
    ['tests rouges', { status: 'skipped', reason: 'tests-rouges' }, 'tests-rouges'],
    ['typage rouge', { status: 'skipped', reason: 'typage-rouge' }, 'typage-rouge']
  ] as const)('%s : le travail n’est pas validé, /git ne part pas', (_nom, project, motif) => {
    const rapport = rapportLaisse({ project, exclus: [{ path: 'src/a.ts', motif }] })
    expect(decisionGitApresFil(tourPublie({ rapport }))).toEqual({
      lancer: false,
      raison: 'pas-valide'
    })
  })

  it('un refus sans rapport avec le dossier partagé ne relance rien (secret détecté)', () => {
    const rapport = rapportLaisse({ project: { status: 'skipped', reason: 'secret-detected' } })
    expect(decisionGitApresFil(tourPublie({ rapport }))).toEqual({
      lancer: false,
      raison: 'pas-valide'
    })
  })

  it('une publication en échec ne se relance pas à l’aveugle', () => {
    const rapport = rapportLaisse({ project: { status: 'failed', error: 'rejected' } })
    expect(decisionGitApresFil(tourPublie({ rapport }))).toEqual({
      lancer: false,
      raison: 'pas-valide'
    })
  })

  it('tout est parti, ou l’interrupteur est éteint (aucun rapport) : rien à rattraper', () => {
    const toutParti = rapportLaisse({
      project: { status: 'pushed', branch: 'main', files: 1, mode: 'direct' },
      exclus: undefined
    })
    for (const rapport of [toutParti, undefined])
      expect(decisionGitApresFil(tourPublie({ rapport }))).toEqual({
        lancer: false,
        raison: 'rien-a-rattraper'
      })
  })

  it('hors du dépôt Autowin, jamais : les autres projets ne se publient pas d’eux-mêmes', () => {
    expect(decisionGitApresFil(tourPublie({ dossierAutowin: false }))).toEqual({
      lancer: false,
      raison: 'hors-autowin'
    })
  })

  it('un tour de fond ne déclenche pas : sa fin a son propre suivi', () => {
    expect(decisionGitApresFil(tourPublie({ deFond: true })).lancer).toBe(false)
  })

  it.each(['/git', '/git : publie le travail de conv-9', '/salvage all origin main'])(
    'le tour %s ne se relance pas lui-même : c’est la garde contre la boucle',
    (demande) => {
      expect(decisionGitApresFil(tourPublie({ demande }))).toEqual({
        lancer: false,
        raison: 'deja-une-publication'
      })
    }
  )

  it.each([
    'Corrige ça. Ne publie rien.',
    'Fais-le sans commit',
    'Corrige, aucun push pour l’instant',
    'corrige mais ne pousse pas',
    'tu ne commites pas',
    'ne commit pas',
    'ne fais pas de commit',
    'Ne pas publier',
    'pas de push ce soir'
  ])('la demande « %s » interdit de publier : elle prime sur l’accord', (demande) => {
    expect(decisionGitApresFil(tourPublie({ demande }))).toEqual({
      lancer: false,
      raison: 'publication-interdite'
    })
  })

  it('une interdiction posée plus tôt dans le fil vaut encore à sa fin', () => {
    const demandesDuFil = ['Refais le panneau. Ne publie rien pour l’instant.', 'ok continue']
    expect(decisionGitApresFil(tourPublie({ demande: 'ok continue', demandesDuFil }))).toEqual({
      lancer: false,
      raison: 'publication-interdite'
    })
  })

  it('une demande qui parle seulement de publication n’est pas une interdiction', () => {
    expect(
      decisionGitApresFil(tourPublie({ demande: 'Corrige le bandeau de publication' })).lancer
    ).toBe(true)
  })
})

describe('estDepotAutowin', () => {
  const dossiers: string[] = []
  afterEach(() => {
    for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true })
  })
  function dossierAvec(paquet?: string): string {
    const dossier = mkdtempSync(join(tmpdir(), 'autowin-depot-'))
    dossiers.push(dossier)
    if (paquet !== undefined) writeFileSync(join(dossier, 'package.json'), paquet)
    return dossier
  }

  it('reconnaît ce dépôt à son paquet, pas à son emplacement', () => {
    expect(estDepotAutowin(process.cwd())).toBe(true)
    expect(estDepotAutowin(dossierAvec('{"name":"autowin-os"}'))).toBe(true)
  })

  it('tout le reste vaut « pas Autowin », même sans paquet ou avec un paquet abîmé', () => {
    expect(estDepotAutowin(dossierAvec('{"name":"un-autre-projet"}'))).toBe(false)
    expect(estDepotAutowin(dossierAvec())).toBe(false)
    expect(estDepotAutowin(dossierAvec('pas du json'))).toBe(false)
  })
})

describe('bandeauPublie', () => {
  const commits = [
    { sha: '1a2b3c4d', sujet: 'fix(chat): le bouton <revient> (conv-9)' },
    { sha: '5e6f7a8b', sujet: 'test(chat): le bouton (conv-9)' }
  ]

  it('dit ce qui est parti et offre l’annulation par un bouton du fil', () => {
    const bandeau = bandeauPublie(commits)
    expect(bandeau.startsWith('```html-render\n')).toBe(true)
    expect(bandeau.endsWith('\n```')).toBe(true)
    expect(bandeau).toContain('2 commits')
    expect(bandeau).toContain('1a2b3c4d')
    // Le fil envoie le LIBELLÉ du lien : c’est lui qui nomme ce qui sera annulé.
    expect(bandeau).toContain(
      '<a class="aw-chip awp-annuler" href="#autowin-prompt">Annuler la publication (git revert 1a2b3c4d 5e6f7a8b, puis push)</a>'
    )
  })

  it('le bouton hérite de la couleur du thème, sans couleur écrite en dur', () => {
    expect(bandeauPublie(commits)).toContain('.awp-annuler{')
    expect(bandeauPublie(commits)).toMatch(/\.awp-annuler\{[^}]*color:inherit/)
    expect(bandeauPublie(commits)).not.toMatch(/#[0-9a-f]{3,6}\b(?!autowin)/i)
  })

  it('le fil reconnaît le bouton, et son libellé tient dans la limite d’un bouton', () => {
    const vingtCinq = Array.from({ length: 25 }, (_, i) => ({
      sha: i.toString(16).padStart(8, '0'),
      sujet: 's'
    }))
    const [prompt] = promptsDesBoutons(bandeauPublie(vingtCinq))
    expect(prompt).toContain('git revert 00000000')
    expect(prompt!.length).toBeLessThanOrEqual(LONGUEUR_MAX_PROMPT)
  })

  // « Publié sans /git » ne disait ni l'action ni la commande ; l'utilisateur veut
  // « GIT : N commit », le nom du commit, l'action et la ligne exacte envoyée au shell.
  it('titre de statut, nomme l’action et cite les lignes git exactes du tour', () => {
    const ligne =
      'cd /d/X && git commit -q -m "a <b>" && ALLOW_MAIN_PUSH=1 git push -q origin HEAD:main'
    const bandeau = bandeauPublie(commits, [ligne])
    // Le titre est un statut, « N commits et push <distant> <branche> réussi ».
    expect(bandeau).toContain('<div class="aw-kicker">2 commits et push origin main réussi</div>')
    expect(bandeau).not.toContain('GIT : 2 commits')
    expect(bandeau).not.toContain('Publié sans /git')
    expect(bandeau).toContain('git push -q origin HEAD:main')
    expect(bandeau).toContain('&quot;a &lt;b&gt;&quot;'.replace(/&quot;/g, '"'))
  })

  // /draft « 1 · Compact rail » : un rail, une ligne par étape, qui se déplie sur sa
  // commande ; trait de 3 px et points de 10 px, les réglages choisis par l'utilisateur.
  it('rail compact : Commit, Push puis Annuler, chaque commande sous son étape', () => {
    const commit = "cd /d/X; git add -- a.ts\ngit commit -q -F - <<'EOF'\nfeat: a (conv-9)\nEOF"
    const push = 'cd /d/X; ALLOW_MAIN_PUSH=1 git push origin HEAD:main 2>&1 | tail -8'
    const bandeau = bandeauPublie(commits, [commit, push])
    const position = (texte: string): number => bandeau.indexOf(texte)
    expect(bandeau).toContain('<div class="awp-rail">')
    expect(position('<b>Commit</b>')).toBeGreaterThan(-1)
    // La commande de commit est pliée sous Commit, celle du push sous Push, le bouton en dernier.
    expect(position('<b>Commit</b>')).toBeLessThan(position('git commit -q'))
    expect(position('git commit -q')).toBeLessThan(position('<b>Push</b>'))
    expect(position('<b>Push</b>')).toBeLessThan(position('git push origin HEAD:main'))
    expect(position('git push origin HEAD:main')).toBeLessThan(position('awp-annuler" href'))
    expect(bandeau).toContain('vers origin/main')
    // L'ancienne phrase redisait ce que les étapes nomment déjà.
    expect(bandeau).not.toContain('de ce fil <b>en ligne</b>')
  })

  it('rail compact : un seul commit montre son sha et son sujet sur la ligne Commit', () => {
    const bandeau = bandeauPublie([commits[0]!])
    expect(bandeau).toMatch(
      /<summary><b>Commit<\/b><span class="aw-chip awp-sha">1a2b3c4d<\/span><span class="aw-discret awp-coupe">fix\(chat\): le bouton &lt;revient&gt;/
    )
    // Sans ligne de push lue, « en ligne » (lu sur l'amont) et aucune destination inventée.
    expect(bandeau).toMatch(/<b>Push<\/b><span class="aw-discret awp-coupe">en ligne<\/span>/)
  })

  it('rail compact : trait de 3 px, points de 10 px, peints en image (le thème clair force le fond)', () => {
    const style = bandeauPublie(commits).match(/<style>(.*?)<\/style>/)?.[1] ?? ''
    expect(style).toMatch(/\.awp-pt\{[^}]*width:10px;height:10px/)
    expect(style).toMatch(/\.awp-trait\{[^}]*width:3px/)
    expect(style).not.toMatch(/background-color/)
    expect(style).not.toMatch(/background:/)
  })

  it('sans ligne lue, le dit au lieu d’inventer une commande', () => {
    expect(bandeauPublie(commits)).toContain('Commande du shell non retrouvée')
  })

  it('dit ce que la passe n’a pas pu prouver, au lieu de le taire', () => {
    expect(bandeauPublie(commits, [], ['tests non joués : aucun test'])).toContain(
      '<div class="aw-attention">tests non joués : aucun test</div>'
    )
  })

  it('la note « à trier » borne sa liste et tient le bouton sous la limite', () => {
    const note = noteATrier(
      'conv-9',
      Array.from({ length: 20 }, (_, i) => `f${i}.ts : <x>`)
    )
    expect(note).toContain('f11.ts : &lt;x&gt;')
    expect(note).not.toContain('f12.ts')
    expect(note).toContain('8 autres')
    expect(promptsDesBoutons(note)[0]!.length).toBeLessThanOrEqual(LONGUEUR_MAX_PROMPT)
  })

  /*
   * Vécu le 06/11/2026 : « GIT : rien publié » puis, trois minutes plus tard dans le même fil,
   * « 1 commit et push origin main réussi ». La note ne parle que des changements qu'elle liste :
   * un commit du même fil peut partir à côté (publication du tour, ou travail d'agent de la passe).
   */
  it('la note ne dit pas « rien publié » : elle ne parle que des changements qu’elle liste', () => {
    const note = noteATrier('conv-9', ['scripts/a.mjs : aussi touché par conv-2'])
    expect(note).not.toMatch(/rien publié|Publication auto arrêtée/u)
    expect(note).toContain('GIT : reste à trier')
    expect(note).toContain('ces changements')
  })

  it('échappe les sujets de commit : ils ne fixent pas le HTML du fil', () => {
    expect(bandeauPublie(commits)).toContain('le bouton &lt;revient&gt;')
  })

  it('renonce au bouton au-delà de ce qu’un libellé porte, et le dit', () => {
    const beaucoup = Array.from({ length: 40 }, (_, i) => ({ sha: `aaaa00${i}`, sujet: 's' }))
    const bandeau = bandeauPublie(beaucoup)
    expect(bandeau).not.toContain('#autowin-prompt')
    expect(bandeau).toContain('40 commits')
    expect(bandeau).toContain('trop nombreux')
  })
})

/*
 * « le style du bloc qu'on a drafté s'applique jamais ». Mesuré le 05/11 : 136 commits sur
 * main depuis la veille, une douzaine de blocs git. Les publications passaient par le fil lui-même
 * (`publier-isole.ps1`, `git push` dans son tour) ou par l'enchaînement auto, qui n'en posaient aucun.
 */
describe('blocDuTour — le rail aussi quand le fil ou l’enchaînement auto publie (conv-1574)', () => {
  const commit = { sha: 'abc12345', sujet: 'fix(x): le rail partout (conv-9)' }
  const pousseParLeFil = [
    'Bash · git status --short',
    "Bash · cd /d/AutoWinOS; git add -- src/a.ts; git commit -q -m 'fix(x): le rail partout (conv-9)'",
    'Bash terminé - 2 s',
    'Bash · ALLOW_MAIN_PUSH=1 git push origin HEAD:main 2>&1 | tail -3',
    'Bash · git log -1 --format=%s; git show --stat HEAD'
  ]
  const rapportPousse = (branche = 'main'): AutoCloseReport => ({
    runId: 'chat-conv-9',
    branch: 'autowin/chat-conv-9',
    at: '2026-11-05T11:20:00Z',
    source: 'chat',
    project: { status: 'pushed', branch: branche, files: 2, mode: 'direct' }
  })

  it('un fil qui pousse lui-même reçoit le rail, avec ses vraies commandes', () => {
    const bloc = blocDuTour({
      commits: [commit],
      actionsLog: pousseParLeFil,
      rapport: undefined,
      contenusDuFil: []
    })
    expect(bloc).toContain('awp-rail')
    expect(bloc).toContain('awp-sha">abc12345</span>')
    const commitEnPremier = bloc!.indexOf('git commit -q')
    const push = bloc!.indexOf('ALLOW_MAIN_PUSH=1 git push origin HEAD:main')
    expect(commitEnPremier).toBeGreaterThan(-1)
    expect(push).toBeGreaterThan(commitEnPremier)
  })

  it('les commandes git qui ne font que lire ne sont pas citées', () => {
    expect(lignesGitDuTour(pousseParLeFil)).toEqual([
      "cd /d/AutoWinOS; git add -- src/a.ts; git commit -q -m 'fix(x): le rail partout (conv-9)'",
      'ALLOW_MAIN_PUSH=1 git push origin HEAD:main 2>&1 | tail -3'
    ])
  })

  it('publier-isole.ps1 compte quand il est LANCÉ, pas quand une lecture le nomme (vu dans conv-1590)', () => {
    const lance = "Bash · powershell -NoProfile -File scripts/publier-isole.ps1 -Message 'fix (conv-9)'"
    const lu =
      'Bash · git fetch -q origin; for f in scripts/publier-isole.ps1; do [ "$(git rev-parse origin/main:$f)" = "$(git hash-object $f)" ] && echo identique; done'
    expect(lignesGitDuTour([lance, lu])).toEqual([lance.slice('Bash · '.length)])
  })

  it('l’enchaînement auto cite la ligne qu’il envoie (run-autoclose.ts), pas une ligne inventée', () => {
    const bloc = blocDuTour({
      commits: [commit],
      actionsLog: [],
      rapport: rapportPousse(),
      contenusDuFil: []
    })
    expect(bloc).toContain('ALLOW_MAIN_PUSH=1 git push origin abc12345:refs/heads/main')
    expect(bloc).not.toContain('non retrouvée')
    expect(bloc).toContain('push origin main réussi')
  })

  it('un commit déjà montré dans un bloc du fil ne revient pas ; le citer dans une réponse ne compte pas', () => {
    const dejaMontre = bandeauPublie([commit])
    expect(
      blocDuTour({
        commits: [commit],
        actionsLog: [],
        rapport: undefined,
        contenusDuFil: [dejaMontre]
      })
    ).toBeUndefined()
    expect(
      blocDuTour({
        commits: [commit],
        actionsLog: [],
        rapport: undefined,
        contenusDuFil: ['Publié : abc12345 sur origin/main.']
      })
    ).toContain('awp-rail')
  })

  it('le bloc déjà posé par la clôture d’un run (annonce-commit-local.ts) compte comme montré', () => {
    const blocDuRun = annonceCommitLocal(
      { outcome: 'merged', committed: true, publishedSha: `${commit.sha}ffffffff` },
      'run-1',
      'tâche (conv-9)',
      { branche: 'main', mode: 'direct' }
    )
    expect(blocDuRun).toContain('awp-rail')
    expect(
      blocDuTour({
        commits: [commit],
        actionsLog: [],
        rapport: undefined,
        contenusDuFil: [blocDuRun!]
      })
    ).toBeUndefined()
  })

  it('aucun commit du fil arrivé en amont : aucun bloc', () => {
    expect(
      blocDuTour({
        commits: [],
        actionsLog: pousseParLeFil,
        rapport: rapportPousse(),
        contenusDuFil: []
      })
    ).toBeUndefined()
  })
})

describe('les fils de plan (conv-1544) : une passe dans le chef, à la fin du plan', () => {
  const lot = { role: 'enfant' as const, plan: { chef: 'conv-1', statut: 'en-cours' as const } }
  const chef = (statut: 'en-cours' | 'termine' | 'suspendu-quota' | 'bloque' | 'arrete') => ({
    role: 'chef' as const,
    plan: { chef: 'conv-1', statut }
  })

  it('un lot publie dans le chef ; un fil hors plan, dans lui-même', () => {
    expect(filDeLaPasse('conv-2', lot)).toBe('conv-1')
    expect(filDeLaPasse('conv-1', chef('en-cours'))).toBe('conv-1')
    expect(filDeLaPasse('conv-7', undefined)).toBe('conv-7')
  })

  it('le chef attend tant que des lots peuvent encore écrire', () => {
    expect(planTourneEncore(chef('en-cours'))).toBe(true)
    expect(planTourneEncore(chef('suspendu-quota'))).toBe(true)
    for (const fin of ['termine', 'bloque', 'arrete'] as const)
      expect(planTourneEncore(chef(fin))).toBe(false)
    // Un lot ne porte aucune passe : c'est le chef qui la porte.
    expect(planTourneEncore(lot)).toBe(false)
    expect(planTourneEncore(undefined)).toBe(false)
  })
})

describe('les travaux d’agents restés hors de la branche (conv-1544)', () => {
  const travaux = [
    { agentId: 'run-a-1', fichiers: ['src/a.ts'], conversationId: 'conv-5' },
    { agentId: 'run-b-1', fichiers: ['src/b.ts'], conversationId: 'conv-5' },
    { agentId: 'run-c-1', fichiers: ['src/c.ts'], conversationId: 'conv-6' },
    { agentId: 'run-d-1', fichiers: ['src/d.ts'] },
    { agentId: 'run-e-1', fichiers: ['src/e.ts'], conversationId: 'conv-7' }
  ]

  it('les range par fil du run, sans les déjà tentés, les orphelins ni les fils interdits', () => {
    const parFil = travauxParFil({
      travaux,
      dejaTentes: new Set(['run-c-1']),
      publiable: (fil) => fil !== 'conv-7'
    })
    expect([...parFil.keys()]).toEqual(['conv-5'])
    expect(parFil.get('conv-5')!.map((t) => t.agentId)).toEqual(['run-a-1', 'run-b-1'])
    expect(parFil.get('conv-5')![0]).not.toHaveProperty('conversationId')
  })

  it('la liste des tentés survit au redémarrage, et une lecture abîmée vaut liste vide', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'autowin-tentes-'))
    try {
      const chemin = join(dossier, 'tentes.json')
      travauxTentesSurDisque(chemin).noter(['run-a-1', 'run-b-1'])
      travauxTentesSurDisque(chemin).noter(['run-b-1', 'run-c-1'])
      await viderFichiersEnAttente()
      expect([...travauxTentesSurDisque(chemin).lire()]).toEqual(['run-a-1', 'run-b-1', 'run-c-1'])
      const abime = join(dossier, 'abime.json')
      writeFileSync(abime, '{pas du json')
      expect(travauxTentesSurDisque(abime).lire().size).toBe(0)
    } finally {
      rmSync(dossier, { recursive: true, force: true })
    }
  })
})

const publiee: IssueDePasse = {
  publie: true,
  lignesShell: ['git commit --only -m "fix(chat): x (conv-1)" -- a.ts'],
  notes: [],
  aTrier: []
}

describe('FileGitApresFil — une passe à la fois', () => {
  function banc(
    sur: {
      commits?: Array<{ sha: string; sujet: string }>
      occupe?: boolean
      calmeMs?: number
      issue?: IssueDePasse
    } = {}
  ) {
    const fins: Array<() => void> = []
    const lances: string[] = []
    const passes: PasseGit[] = []
    const annonces: Array<[string, string]> = []
    const etat = { occupe: sur.occupe === true }
    const tentes: string[] = []
    const filsLus: string[][] = []
    const file = new FileGitApresFil(
      {
        publier: (fil, passe) => {
          lances.push(fil)
          passes.push(passe)
          return new Promise((resolve) => fins.push(() => resolve(sur.issue ?? publiee)))
        },
        filOccupe: () => etat.occupe,
        lireAmont: async () => 'avant',
        commitsDepuis: async (_fil, _depuis, fils) => {
          filsLus.push([...fils])
          return sur.commits ?? []
        },
        annoncer: (fil, contenu) => annonces.push([fil, contenu]),
        noterTravauxTentes: (ids) => tentes.push(...ids),
        journal: () => undefined
      },
      { calmeMs: sur.calmeMs ?? 0 }
    )
    return { file, fins, lances, passes, annonces, etat, tentes, filsLus }
  }
  const attendre = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

  it('deux fils finis en même temps passent l’un après l’autre, jamais ensemble', async () => {
    const { file, fins, lances } = banc()
    file.ajouter('conv-1', ['a.ts'])
    file.ajouter('conv-2', ['b.ts'])
    await attendre()
    expect(lances).toEqual(['conv-1'])
    fins[0]!()
    await attendre()
    expect(lances).toEqual(['conv-1', 'conv-2'])
    fins[1]!()
    await attendre()
  })

  it('un fil présenté deux fois en attente ne part qu’une fois, avec tous ses fichiers', async () => {
    const passes: PasseGit[] = []
    const fins: Array<() => void> = []
    const file = new FileGitApresFil(
      {
        publier: (_fil, passe) => {
          passes.push(passe)
          return new Promise((resolve) => fins.push(() => resolve(publiee)))
        },
        filOccupe: () => false,
        lireAmont: async () => 'avant',
        commitsDepuis: async () => [],
        annoncer: () => undefined,
        journal: () => undefined
      },
      { calmeMs: 0 }
    )
    file.ajouter('conv-1', ['a.ts'])
    file.ajouter('conv-2', ['b.ts'])
    file.ajouter('conv-2', ['c.ts'])
    await attendre()
    fins[0]!()
    await attendre()
    expect(passes).toHaveLength(2)
    expect(passes[1]!.fichiers).toEqual(['b.ts', 'c.ts'])
    fins[1]!()
    await attendre()
  })

  describe('le calme qui vaut « fini » (conv-1544)', () => {
    afterEach(() => vi.useRealTimers())
    const MINUTE = 60_000

    it('attend le calme du fil, puis part une seule fois', async () => {
      vi.useFakeTimers()
      const { file, lances, fins } = banc({ calmeMs: CALME_AVANT_PUBLICATION_MS })
      file.ajouter('conv-1', ['a.ts'])
      await vi.advanceTimersByTimeAsync(CALME_AVANT_PUBLICATION_MS - 1)
      expect(lances).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(lances).toEqual(['conv-1'])
      fins[0]!()
      await vi.advanceTimersByTimeAsync(10 * MINUTE)
      expect(lances).toEqual(['conv-1'])
    })

    it('un nouveau tour repousse la passe : une seule passe par pause, avec tous les fichiers', async () => {
      vi.useFakeTimers()
      const { file, lances, passes } = banc({ calmeMs: 3 * MINUTE })
      file.ajouter('conv-1', ['a.ts'])
      await vi.advanceTimersByTimeAsync(2 * MINUTE)
      file.ajouter('conv-1', ['b.ts'])
      await vi.advanceTimersByTimeAsync(2 * MINUTE)
      expect(lances).toEqual([])
      await vi.advanceTimersByTimeAsync(1 * MINUTE)
      expect(lances).toEqual(['conv-1'])
      expect(passes[0]!.fichiers).toEqual(['a.ts', 'b.ts'])
    })

    it('les lots d’un plan et les travaux d’agents partent en UNE passe dans le chef', async () => {
      vi.useFakeTimers()
      const { file, lances, passes, fins, tentes, filsLus } = banc({
        calmeMs: 3 * MINUTE,
        commits: [{ sha: '1a2b3c4d', sujet: 'fix (conv-2)' }]
      })
      file.ajouter('conv-1', ['src/a.ts'], 'conv-2')
      file.ajouter('conv-1', ['src/b.ts'], 'conv-3')
      file.ajouterTravaux('conv-1', [{ agentId: 'run-x-1', fichiers: ['src/x.ts'] }], 'conv-2')
      await vi.advanceTimersByTimeAsync(3 * MINUTE)
      expect(lances).toEqual(['conv-1'])
      expect(passes[0]!.fils).toEqual(['conv-1', 'conv-2', 'conv-3'])
      expect(passes[0]!.fichiers).toContain('src/b.ts')
      expect(passes[0]!.travaux.map((t) => t.agentId)).toEqual(['run-x-1'])
      // Noté AVANT la passe : une passe qui plante ne le reproposera pas à chaque fin de run.
      expect(tentes).toEqual(['run-x-1'])
      fins[0]!()
      await vi.advanceTimersByTimeAsync(0)
      // Le bandeau cherche les commits de tous les fils du plan, pas du seul chef.
      expect(filsLus).toEqual([['conv-1', 'conv-2', 'conv-3']])
    })

    it('une liste de travaux vide n’arme rien', async () => {
      vi.useFakeTimers()
      const { file, lances } = banc({ calmeMs: 3 * MINUTE })
      file.ajouterTravaux('conv-1', [])
      await vi.advanceTimersByTimeAsync(10 * MINUTE)
      expect(lances).toEqual([])
    })

    it('un fil occupé quand le calme sonne est attendu, pas sauté', async () => {
      vi.useFakeTimers()
      const { file, lances, etat } = banc({ occupe: true, calmeMs: 3 * MINUTE })
      file.ajouter('conv-1', ['a.ts'])
      await vi.advanceTimersByTimeAsync(10 * MINUTE)
      expect(lances).toEqual([])
      etat.occupe = false
      await vi.advanceTimersByTimeAsync(3 * MINUTE)
      expect(lances).toEqual(['conv-1'])
    })
  })

  it('annonce le bandeau seulement si des commits du fil sont arrivés en amont', async () => {
    const avec = banc({ commits: [{ sha: '1a2b3c4d', sujet: 'fix (conv-1)' }] })
    avec.file.ajouter('conv-1', ['a.ts'])
    await attendre()
    avec.fins[0]!()
    await attendre()
    expect(avec.annonces).toHaveLength(1)
    expect(avec.annonces[0]![1]).toContain('1a2b3c4d')

    const sans = banc()
    sans.file.ajouter('conv-1', ['a.ts'])
    await attendre()
    sans.fins[0]!()
    await attendre()
    expect(sans.annonces).toEqual([])
  })

  // « je veux pas que ça envoie un message à ma place » — la passe n'ouvre plus de tour.
  it('publié : le fil ne reçoit QUE le bloc git, avec les lignes git vraiment lancées', async () => {
    const { file, fins, annonces } = banc({ commits: [{ sha: '1a2b3c4d', sujet: 'fix (conv-1)' }] })
    file.ajouter('conv-1', ['a.ts'])
    await attendre()
    fins[0]!()
    await attendre()
    expect(annonces).toHaveLength(1)
    // Le banc ne lance que `git commit` : aucun push vu, donc « en ligne », jamais « réussi ».
    expect(annonces[0]![1]).toContain('<div class="aw-kicker">1 commit en ligne</div>')
    expect(annonces[0]![1]).toContain('git commit --only -m')
  })

  it('à trier : une note et un bouton /git que l’utilisateur clique lui-même', async () => {
    const { file, fins, annonces } = banc({
      issue: {
        publie: false,
        lignesShell: [],
        notes: [],
        aTrier: ['a.ts : aussi touché par conv-8']
      }
    })
    file.ajouter('conv-1', ['a.ts'])
    await attendre()
    fins[0]!()
    await attendre()
    expect(annonces).toHaveLength(1)
    expect(annonces[0]![1]).toContain('aussi touché par conv-8')
    expect(promptsDesBoutons(annonces[0]![1])).toEqual([
      '/git : publie le travail terminé de ce fil (conv-1), et lui seul'
    ])
  })

  it('une passe en échec n’annonce rien et ne bloque pas la suivante', async () => {
    const journal = vi.fn()
    const lances: string[] = []
    const annoncer = vi.fn()
    const file = new FileGitApresFil(
      {
        publier: async (fil) => {
          lances.push(fil)
          if (fil === 'conv-1') throw new Error('git indisponible')
          return { publie: false, lignesShell: [], notes: [], aTrier: [] }
        },
        filOccupe: () => false,
        lireAmont: async () => 'avant',
        commitsDepuis: async () => [{ sha: '1a2b3c4d', sujet: 'fix' }],
        annoncer,
        journal
      },
      { calmeMs: 0 }
    )
    file.ajouter('conv-1', ['a.ts'])
    file.ajouter('conv-2', ['b.ts'])
    await attendre()
    expect(lances).toEqual(['conv-1', 'conv-2'])
    expect(annoncer).not.toHaveBeenCalled()
    expect(journal).toHaveBeenCalled()
  })
})

describe('commitsPublies — lu sur un vrai dépôt et son distant', () => {
  const dossiers: string[] = []
  afterEach(() => {
    for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true })
  })
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  const runGit = async (args: string[], cwd: string): Promise<string> => git(cwd, ...args)

  function depot(): { local: string } {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-git-apres-fil-'))
    dossiers.push(racine)
    const distant = join(racine, 'distant.git')
    const local = join(racine, 'local')
    execFileSync('git', ['init', '--bare', '-b', 'main', distant], { windowsHide: true })
    execFileSync('git', ['init', '-b', 'main', local], { windowsHide: true })
    git(local, 'config', 'user.email', 'test@example.invalid')
    git(local, 'config', 'user.name', 'Test')
    git(local, 'remote', 'add', 'origin', distant)
    git(local, 'commit', '--allow-empty', '-m', 'init')
    git(local, 'push', '-u', 'origin', 'main')
    return { local }
  }
  function commit(local: string, message: string): void {
    writeFileSync(join(local, `${message.length}-${Date.now()}.txt`), message)
    git(local, 'add', '-A')
    git(local, 'commit', '-m', message)
  }

  it('rend les seuls commits de CE fil arrivés en amont, du plus récent au plus ancien', async () => {
    const { local } = depot()
    const avant = await lireAmont(runGit, local)
    commit(local, 'fix: un (conv-9)')
    commit(local, 'fix: autre fil (conv-8)')
    commit(local, 'fix: conv-99 ne se confond pas (conv-99)')
    commit(local, 'test: deux (conv-9)')
    git(local, 'push', 'origin', 'main')
    const commits = await commitsPublies(runGit, local, avant!, 'conv-9')
    expect(commits.map((c) => c.sujet)).toEqual(['test: deux (conv-9)', 'fix: un (conv-9)'])
    expect(commits[0]!.sha).toMatch(/^[0-9a-f]{8}$/)
  })

  it('plusieurs fils (les lots d’un plan) : les commits de chacun, et d’aucun autre', async () => {
    const { local } = depot()
    const avant = await lireAmont(runGit, local)
    commit(local, 'fix: lot un (conv-2)')
    commit(local, 'fix: hors plan (conv-8)')
    commit(local, 'fix: lot deux (conv-3)')
    git(local, 'push', 'origin', 'main')
    const commits = await commitsPublies(runGit, local, avant!, ['conv-2', 'conv-3'])
    expect(commits.map((c) => c.sujet)).toEqual(['fix: lot deux (conv-3)', 'fix: lot un (conv-2)'])
  })

  it('un commit resté local n’est pas « publié » : le bandeau mentirait', async () => {
    const { local } = depot()
    const avant = await lireAmont(runGit, local)
    commit(local, 'fix: pas poussé (conv-9)')
    expect(await commitsPublies(runGit, local, avant!, 'conv-9')).toEqual([])
  })

  // Le fil pousse depuis une copie à part, comme `scripts/publier-isole.ps1` ; le
  // dossier du fil doit le voir sans fetch, sinon le bloc du tour ne part jamais.
  it('un push fait depuis une copie à part (publier-isole.ps1) donne le rail au dossier du fil', async () => {
    const { local } = depot()
    const avant = await lireAmont(runGit, local)
    const copie = join(dirname(local), 'copie')
    git(local, 'worktree', 'add', '--quiet', '--detach', copie, 'origin/main')
    git(copie, 'config', 'user.email', 'test@example.invalid')
    commit(copie, 'fix: poussé à part (conv-9)')
    git(copie, 'push', 'origin', 'HEAD:main')
    const commits = await commitsPublies(runGit, local, avant!, 'conv-9')
    expect(commits.map((c) => c.sujet)).toEqual(['fix: poussé à part (conv-9)'])
    const bloc = blocDuTour({
      commits,
      actionsLog: [`Bash · powershell -File scripts/publier-isole.ps1 -Message 'fix (conv-9)'`],
      rapport: undefined,
      contenusDuFil: []
    })
    expect(bloc).toContain(`awp-sha">${commits[0]!.sha}</span>`)
    expect(bloc).toContain('publier-isole.ps1')
  })

  it('le push de l’enchaînement auto (sha:refs/heads/main) arrive aussi en amont', async () => {
    const { local } = depot()
    const avant = await lireAmont(runGit, local)
    commit(local, 'feat: enchaînement (conv-9)')
    const sha = git(local, 'rev-parse', 'HEAD').trim()
    git(local, 'push', 'origin', `${sha}:refs/heads/main`)
    const commits = await commitsPublies(runGit, local, avant!, 'conv-9')
    expect(commits.map((c) => c.sujet)).toEqual(['feat: enchaînement (conv-9)'])
  })

  it('une branche sans amont ne fait pas tomber la passe', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-git-apres-fil-'))
    dossiers.push(racine)
    execFileSync('git', ['init', '-b', 'main', racine], { windowsHide: true })
    git(racine, 'config', 'user.email', 'test@example.invalid')
    git(racine, 'config', 'user.name', 'Test')
    git(racine, 'commit', '--allow-empty', '-m', 'init')
    expect(await lireAmont(runGit, racine)).toBeUndefined()
  })
})
