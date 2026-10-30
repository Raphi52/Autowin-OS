import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bandeauPublie,
  commitsPublies,
  decisionGitApresFil,
  estDepotAutowin,
  FileGitApresFil,
  lireAmont,
  promptGitDuFil,
  type TourFini
} from './git-apres-fil'
import {
  LONGUEUR_MAX_PROMPT,
  promptsDesBoutons
} from '../renderer/src/components/bouton-prompt-html'
import type { AutoCloseReport } from './run-autoclose'

/** Un tour qui REMPLIT toutes les conditions : chaque test n'en casse qu'une. */
function tourPublie(partiel: Partial<TourFini> = {}): TourFini {
  return {
    accord: true,
    dossierAutowin: true,
    deFond: false,
    filDePlan: false,
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

  it('un fil qui ne se dit pas fini ne publie pas : la suite peut encore changer ses fichiers', () => {
    expect(decisionGitApresFil(tourPublie({ compteRendu: 'Il reste à corriger X.' }))).toEqual({
      lancer: false,
      raison: 'fil-pas-fini'
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

  it('un tour de fond ou un fil de plan ne déclenche pas : leur fin a son propre suivi', () => {
    expect(decisionGitApresFil(tourPublie({ deFond: true })).lancer).toBe(false)
    expect(decisionGitApresFil(tourPublie({ filDePlan: true })).lancer).toBe(false)
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

describe('promptGitDuFil', () => {
  it('commence par /git (seule forme reconnue) et borne la passe à ce fil', () => {
    const prompt = promptGitDuFil('conv-9', ['src/a.ts'])
    expect(prompt.startsWith('/git')).toBe(true)
    expect(prompt).toContain('conv-9')
    expect(prompt).toContain('src/a.ts')
    expect(prompt).toContain('(conv-9)')
    expect(prompt).toContain('tour tourne encore')
    expect(prompt).toContain('Rien à publier pour conv-9')
  })

  it('exige de rejouer typage et tests : quand tout est exclu, aucun des deux n’a tourné', () => {
    expect(promptGitDuFil('conv-9', ['src/a.ts'])).toContain('typage et tests')
  })

  it('ne recopie pas une liste sans fin', () => {
    const fichiers = Array.from({ length: 50 }, (_, i) => `src/f${i}.ts`)
    const prompt = promptGitDuFil('conv-9', fichiers)
    expect(prompt).toContain('src/f19.ts')
    expect(prompt).not.toContain('src/f20.ts')
    expect(prompt).toContain('30 autres')
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

describe('FileGitApresFil — une passe à la fois', () => {
  function banc(sur: { commits?: Array<{ sha: string; sujet: string }>; occupe?: boolean } = {}) {
    const fins: Array<() => void> = []
    const lances: string[] = []
    const annonces: Array<[string, string]> = []
    const file = new FileGitApresFil({
      lancerTour: (fil) => {
        lances.push(fil)
        return new Promise((resolve) => fins.push(() => resolve({ ok: true })))
      },
      filOccupe: () => sur.occupe === true,
      lireAmont: async () => 'avant',
      commitsDepuis: async () => sur.commits ?? [],
      annoncer: (fil, contenu) => annonces.push([fil, contenu]),
      journal: () => undefined
    })
    return { file, fins, lances, annonces }
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
    const prompts: string[] = []
    const fins: Array<() => void> = []
    const file = new FileGitApresFil({
      lancerTour: (_fil, prompt) => {
        prompts.push(prompt)
        return new Promise((resolve) => fins.push(() => resolve({ ok: true })))
      },
      filOccupe: () => false,
      lireAmont: async () => 'avant',
      commitsDepuis: async () => [],
      annoncer: () => undefined,
      journal: () => undefined
    })
    file.ajouter('conv-1', ['a.ts'])
    file.ajouter('conv-2', ['b.ts'])
    file.ajouter('conv-2', ['c.ts'])
    await attendre()
    fins[0]!()
    await attendre()
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('b.ts')
    expect(prompts[1]).toContain('c.ts')
    fins[1]!()
    await attendre()
  })

  it('un fil repris entre-temps par l’utilisateur n’est pas interrompu : il est sauté', async () => {
    const { file, lances } = banc({ occupe: true })
    file.ajouter('conv-1', ['a.ts'])
    await attendre()
    expect(lances).toEqual([])
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

  it('une passe en échec n’annonce rien et ne bloque pas la suivante', async () => {
    const journal = vi.fn()
    const lances: string[] = []
    const annoncer = vi.fn()
    const file = new FileGitApresFil({
      lancerTour: async (fil) => {
        lances.push(fil)
        if (fil === 'conv-1') throw new Error('modèle indisponible')
        return { ok: false, error: 'refusé' }
      },
      filOccupe: () => false,
      lireAmont: async () => 'avant',
      commitsDepuis: async () => [{ sha: '1a2b3c4d', sujet: 'fix' }],
      annoncer,
      journal
    })
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

  it('un commit resté local n’est pas « publié » : le bandeau mentirait', async () => {
    const { local } = depot()
    const avant = await lireAmont(runGit, local)
    commit(local, 'fix: pas poussé (conv-9)')
    expect(await commitsPublies(runGit, local, avant!, 'conv-9')).toEqual([])
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
