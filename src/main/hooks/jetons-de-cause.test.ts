import { describe, expect, it } from 'vitest'
import { resolve, sep } from 'node:path'
import { jetonsDeCauseParFichier, createDefaultHookBus } from './default-gate-hooks'
import type { HookContext } from './hook-bus'
import type { ExecutionEvidence } from '../providers/types'

/**
 * LE PRODUCTEUR DE JETONS DE CAUSE — ce qui manquait pour ARMER le fix-gate.
 *
 * `detectBlindFixLoop` (gates/hooks.ts:60) refuse un vert des `3` editions du MEME fichier sans
 * jeton de cause, et sa propre documentation nomme les trois jetons attendus : `CausalHypothesis`,
 * `fix-ok:`, `check:`. Mais `causeTokensByFile` n'avait AUCUN producteur : l'armer en l'etat aurait
 * bloque tout run iteratif sans qu'aucun jeton ne puisse le desarmer — un piege, pas un garde-fou.
 *
 * Deux sources reelles, toutes deux deja pratiquees dans ce depot :
 *  - le COMMENTAIRE depose dans le fichier corrige (`// fix-ok: ...`), visible dans le diff de la
 *    preuve de mutation — la forme majoritaire ici (20+ occurrences dans src/main) ;
 *  - le TEXTE du run, quand il nomme le fichier sur la meme ligne que son jeton.
 *
 * REGLE D ATTRIBUTION, deliberement etroite : un jeton ne desarme QUE les fichiers qu il NOMME.
 * Un `check:` isole ne vaut pas laissez-passer global — sinon une seule ligne desarme le hook
 * entier, et le garde-fou ne mord plus jamais.
 */
function mutation(paths: string[], extra: Partial<ExecutionEvidence> = {}): ExecutionEvidence {
  return {
    type: 'file_change',
    kind: 'mutation',
    status: 'ok',
    ok: true,
    summary: 'edition',
    paths,
    ...extra
  } as ExecutionEvidence
}

describe('jetonsDeCauseParFichier — la cause se DECLARE, elle ne se suppose pas', () => {
  it('lit un `fix-ok:` depose dans le diff du fichier mute', async () => {
    const evidence = [
      mutation(['src/main/boucle.ts'], {
        diff: '+  // fix-ok: cause mesuree hors modele, le compteur repartait a zero\n'
      })
    ]
    expect(await jetonsDeCauseParFichier(undefined, evidence, [])).toEqual({
      'src/main/boucle.ts': true
    })
  })

  it('accepte les trois jetons nommes par le hook, et eux seuls', async () => {
    for (const jeton of ['CausalHypothesis:', 'fix-ok:', 'check:']) {
      const ev = [mutation(['a.ts'], { diff: `+ // ${jeton} raison` })]
      expect(await jetonsDeCauseParFichier(undefined, ev, []), jeton).toEqual({ 'a.ts': true })
    }
    const muet = [mutation(['a.ts'], { diff: '+ // TODO: revoir ca plus tard' })]
    expect(await jetonsDeCauseParFichier(undefined, muet, [])).toEqual({})
  })

  it('lit un jeton du TEXTE du run quand il NOMME le chemin sur la meme ligne', async () => {
    const texte = 'CausalHypothesis: src/main/boucle.ts remet le compteur a zero a chaque tour.'
    expect(await jetonsDeCauseParFichier(texte, [], ['src/main/boucle.ts'])).toEqual({
      'src/main/boucle.ts': true
    })
  })

  it('lit un jeton qui nomme un chemin Windows ABSOLU (lettre de lecteur)', async () => {
    const texte = 'CausalHypothesis: D:/AutoWinOS/scripts/ui-capture.mjs — opt-in --instance-dediee.'
    expect(await jetonsDeCauseParFichier(texte, [], ['D:/AutoWinOS/scripts/ui-capture.mjs'])).toEqual({
      'D:/AutoWinOS/scripts/ui-capture.mjs': true
    })
  })

  it('lit un jeton qui nomme un fichier dont l extension contient un CHIFFRE (.ps1)', async () => {
    const texte = 'CausalHypothesis: resources/hdesk-tv.ps1 — delegue sans CharSet.Unicode.'
    expect(await jetonsDeCauseParFichier(texte, [], ['resources/hdesk-tv.ps1'])).toEqual({
      'resources/hdesk-tv.ps1': true
    })
  })

  it('resout un nom de fichier SEUL quand un seul fichier edite le porte', async () => {
    const texte = 'fix-ok: boucle.ts — cause prouvee par le test rouge d abord.'
    expect(await jetonsDeCauseParFichier(texte, [], ['src/main/boucle.ts'])).toEqual({
      'src/main/boucle.ts': true
    })
  })

  it('refuse de trancher un nom AMBIGU porte par deux fichiers edites', async () => {
    const texte = 'fix-ok: index.ts corrige.'
    const edites = ['src/main/index.ts', 'src/renderer/index.ts']
    expect(await jetonsDeCauseParFichier(texte, [], edites)).toEqual({})
  })

  it('reconnait un DOSSIER edite (cle porcelain sans extension) nomme sur la ligne', async () => {
    const texte = 'CausalHypothesis: .autowin-preuve/ — captures de preuve, pas un correctif.'
    expect(await jetonsDeCauseParFichier(texte, [], ['.autowin-preuve/', 'src/main/b.ts'])).toEqual({
      '.autowin-preuve/': true
    })
  })

  it('un jeton qui ne nomme AUCUN fichier ne desarme rien', async () => {
    const texte = 'check: npm test\nTout est vert, je cloture.'
    expect(await jetonsDeCauseParFichier(texte, [], ['src/main/boucle.ts'])).toEqual({})
  })

  it('le jeton ne vaut que pour la ligne : un chemin cite AILLEURS n est pas couvert', async () => {
    const texte = 'fix-ok: src/main/a.ts corrige.\nJ ai aussi touche src/main/b.ts au passage.'
    expect(await jetonsDeCauseParFichier(texte, [], ['src/main/a.ts', 'src/main/b.ts'])).toEqual({
      'src/main/a.ts': true
    })
  })
})

describe('fix-gate — ARME, et un run iteratif LEGITIME passe', () => {
  function ctx(evidence: ExecutionEvidence[], output?: string): HookContext {
    return {
      event: 'pre-green',
      task: 'corrige le bug',
      cwd: 'D:\\depot',
      requireProof: true,
      evidenceOkCount: 1,
      evidence,
      editsByFile: { 'src/main/boucle.ts': 6 },
      output,
      fichiersTouchesAvantLeRun: []
    }
  }
  const bus = (): ReturnType<typeof createDefaultHookBus> =>
    createDefaultHookBus(async () => ({ ok: true, exitCode: 0 }))

  it('BLOQUE un run qui edite 6 fois le meme fichier sans jamais nommer sa cause', async () => {
    const verdict = await bus().run('pre-green', ctx([mutation(['src/main/boucle.ts'])]))
    expect(verdict.reasons.join(' ')).toContain('fix-gate')
  })

  it('ne bloque PAS le meme run des qu il a depose son `fix-ok:` dans le fichier', async () => {
    const evidence = [
      mutation(['src/main/boucle.ts'], {
        diff: '+  // fix-ok: le compteur etait remis a zero par le listener, mesure hors modele\n'
      })
    ]
    const verdict = await bus().run('pre-green', ctx(evidence))
    expect(verdict.reasons.join(' ')).not.toContain('fix-gate')
  })

  /*
   * conv-540, tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4 (puis ses reparations) : la ligne
   * `// fix-ok:` etait bien DANS src/main/orchestrator.ts, et le refus « 6 edits sans cause
   * verifiee » revenait quand meme. La preuve de mutation reelle (workspace_delta) ne porte
   * jamais `diff` : seulement les empreintes des lignes ecrites. Le jeton se lit donc sur le
   * disque, et ne compte que si SA ligne fait partie des lignes ecrites par le run.
   */
  it('lit le `fix-ok:` ecrit par le run sur le DISQUE quand la preuve n a pas de diff', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { exactLineFingerprint } = await import('../exact-line-fingerprint')
    const root = mkdtempSync(join(tmpdir(), 'autowin-jeton-disque-'))
    mkdirSync(join(root, 'src/main'), { recursive: true })
    const ancien = '// fix-ok: jeton d un AUTRE run, deja present'
    const neuf = '  // fix-ok: le repli manquait apres un refus du filtre'
    writeFileSync(join(root, 'src/main/boucle.ts'), `${ancien}\nconst x = 1\n${neuf}\n`)
    const reel = (lignes: string[]): ExecutionEvidence[] => [
      mutation(['src/main/boucle.ts'], {
        type: 'workspace_delta',
        workspaceRoot: root,
        writtenLineFingerprintsByPath: { 'src/main/boucle.ts': lignes.map(exactLineFingerprint) }
      })
    ]
    expect(await jetonsDeCauseParFichier(undefined, reel([neuf]), [])).toEqual({
      'src/main/boucle.ts': true
    })
    // Un jeton ancien, non ecrit par ce run, ne desarme rien.
    expect(await jetonsDeCauseParFichier(undefined, reel(['const x = 1']), [])).toEqual({})
  })

  it('ne bloque PAS non plus quand la cause est nommee dans le texte du run', async () => {
    const texte = 'CausalHypothesis: src/main/boucle.ts — le listener remet le compteur a zero.'
    const verdict = await bus().run('pre-green', ctx([mutation(['src/main/boucle.ts'])], texte))
    expect(verdict.reasons.join(' ')).not.toContain('fix-gate')
  })
})

// conv-539 tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb (turnEvents 5:gate) : le refus fix-gate est revenu 2 fois
// et la reparation n'a pas su le lever. Boucle complete, sans modele : refus -> geste LU dans le refus -> jeton lu -> vert.
describe('fix-gate — la boucle refus -> geste dicte -> levee se referme', () => {
  it('appliquer a la lettre le geste nomme par le refus leve le refus', async () => {
    const { detectBlindFixLoop } = await import('../gates/hooks')
    const edits = { 'src/main/objections-juge.ts': 4 }
    const [refus] = detectBlindFixLoop(edits, {})
    expect(refus).toBeDefined()
    const geste = /dépose dans (\S+) un commentaire `(fix-ok:)/.exec(refus.detail)
    expect(geste, refus.detail).not.toBeNull()
    const [, fichier, jeton] = geste!
    const preuve = [mutation([fichier], { diff: `+  // ${jeton} cause mesuree par le test rouge\n` })]
    const jetons = await jetonsDeCauseParFichier(undefined, preuve, Object.keys(edits))
    expect(detectBlindFixLoop(edits, jetons)).toEqual([])
  })
})

/**
 * SOURCE 3 — le jeton DEJA present dans le fichier edite.
 *
 * Mesure conv-597, tour 4e502786-4887-4101-85b3-ea2dee304091 : le refus fix-gate demandait
 * « depose dans src/main/root-execution-contract.ts un commentaire `fix-ok:` ». Le jeton a ete
 * depose (commit a9126f34), et le MEME refus est revenu au tour suivant : le compte d'edits est
 * CUMULE sur la session, alors que la source 1 ne credite le jeton que s'il fait partie des
 * lignes ecrites par CE run-ci. Un jeton depose a une reparation ne desarmait donc jamais la
 * suivante — la porte de sortie promise par le message du refus etait murée.
 */
describe('jetonsDeCauseParFichier — source 3 : le jeton deja dans le fichier edite', () => {
  it('credite un fichier edite qui porte deja son jeton sur disque', async () => {
    const cible = 'src/main/hooks/default-gate-hooks.ts'
    expect(await jetonsDeCauseParFichier(undefined, [], [cible])).toEqual({ [cible]: true })
  })
  it('ne credite pas un fichier edite sans jeton', async () => {
    expect(await jetonsDeCauseParFichier(undefined, [], ['package.json'])).toEqual({})
  })
  it('ignore un fichier introuvable sans lever', async () => {
    expect(await jetonsDeCauseParFichier(undefined, [], ['src/main/neant-xyz.ts'])).toEqual({})
  })
  it('credite le MEME fichier nomme par son chemin ABSOLU Windows (conv-597)', async () => {
    const cible = resolve(process.cwd(), 'src/main/hooks/default-gate-hooks.ts').split(sep).join('/')
    expect(await jetonsDeCauseParFichier(undefined, [], [cible])).toEqual({ [cible]: true })
  })
})

/**
 * SOURCE 3 DEPUIS UNE COPIE DE TRAVAIL — conv-597, turnId 4e502786-4887-4101-85b3-ea2dee304091.
 * Les runs s'executent dans un worktree en HEAD detache ANTERIEUR au commit qui depose le jeton :
 * `git log -1 -- <fichier>` y renvoie l'ancien commit, le jeton reste invisible, et le meme refus
 * fix-gate revient a l'identique (4 reparations de suite).
 */
describe('jetonsDeCauseParFichier — source 3 depuis un worktree en HEAD detache', () => {
  it('credite un jeton depose par le dernier changement du depot, meme hors du HEAD local', async () => {
    const { mkdtempSync, writeFileSync: w, mkdirSync, realpathSync } = await import('node:fs')
    const { execFileSync } = await import('node:child_process')
    const { tmpdir } = await import('node:os')
    const base = mkdtempSync(resolve(realpathSync.native(tmpdir()), 'jeton-'))
    const repo = resolve(base, 'repo')
    mkdirSync(repo)
    const git = (...a: string[]): void => {
      execFileSync('git', a, { cwd: repo, stdio: 'ignore' })
    }
    git('init', '-b', 'main')
    git('config', 'user.email', 'a@b.c')
    git('config', 'user.name', 'test')
    w(resolve(repo, 'cible.ts'), 'export const x = 1\n')
    git('add', '-A')
    git('commit', '-m', 'avant')
    const avant = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
    w(resolve(repo, 'cible.ts'), '// fix-ok: cause mesuree\nexport const x = 1\n')
    git('add', '-A')
    git('commit', '-m', 'depose le jeton')
    const wt = resolve(base, 'wt')
    git('worktree', 'add', '--detach', wt, avant)
    const cible = resolve(wt, 'cible.ts').split(sep).join('/')
    expect(await jetonsDeCauseParFichier('', [], [cible])).toEqual({ [cible]: true })
  })
})
