import { describe, expect, it } from 'vitest'
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
  it('lit un `fix-ok:` depose dans le diff du fichier mute', () => {
    const evidence = [
      mutation(['src/main/boucle.ts'], {
        diff: '+  // fix-ok: cause mesuree hors modele, le compteur repartait a zero\n'
      })
    ]
    expect(jetonsDeCauseParFichier(undefined, evidence, [])).toEqual({
      'src/main/boucle.ts': true
    })
  })

  it('accepte les trois jetons nommes par le hook, et eux seuls', () => {
    for (const jeton of ['CausalHypothesis:', 'fix-ok:', 'check:']) {
      const ev = [mutation(['a.ts'], { diff: `+ // ${jeton} raison` })]
      expect(jetonsDeCauseParFichier(undefined, ev, []), jeton).toEqual({ 'a.ts': true })
    }
    const muet = [mutation(['a.ts'], { diff: '+ // TODO: revoir ca plus tard' })]
    expect(jetonsDeCauseParFichier(undefined, muet, [])).toEqual({})
  })

  it('lit un jeton du TEXTE du run quand il NOMME le chemin sur la meme ligne', () => {
    const texte = 'CausalHypothesis: src/main/boucle.ts remet le compteur a zero a chaque tour.'
    expect(jetonsDeCauseParFichier(texte, [], ['src/main/boucle.ts'])).toEqual({
      'src/main/boucle.ts': true
    })
  })

  it('lit un jeton qui nomme un chemin Windows ABSOLU (lettre de lecteur)', () => {
    const texte = 'CausalHypothesis: D:/AutoWinOS/scripts/ui-capture.mjs — opt-in --instance-dediee.'
    expect(jetonsDeCauseParFichier(texte, [], ['D:/AutoWinOS/scripts/ui-capture.mjs'])).toEqual({
      'D:/AutoWinOS/scripts/ui-capture.mjs': true
    })
  })

  it('lit un jeton qui nomme un fichier dont l extension contient un CHIFFRE (.ps1)', () => {
    const texte = 'CausalHypothesis: resources/hdesk-tv.ps1 — delegue sans CharSet.Unicode.'
    expect(jetonsDeCauseParFichier(texte, [], ['resources/hdesk-tv.ps1'])).toEqual({
      'resources/hdesk-tv.ps1': true
    })
  })

  it('resout un nom de fichier SEUL quand un seul fichier edite le porte', () => {
    const texte = 'fix-ok: boucle.ts — cause prouvee par le test rouge d abord.'
    expect(jetonsDeCauseParFichier(texte, [], ['src/main/boucle.ts'])).toEqual({
      'src/main/boucle.ts': true
    })
  })

  it('refuse de trancher un nom AMBIGU porte par deux fichiers edites', () => {
    const texte = 'fix-ok: index.ts corrige.'
    const edites = ['src/main/index.ts', 'src/renderer/index.ts']
    expect(jetonsDeCauseParFichier(texte, [], edites)).toEqual({})
  })

  it('reconnait un DOSSIER edite (cle porcelain sans extension) nomme sur la ligne', () => {
    const texte = 'CausalHypothesis: .autowin-preuve/ — captures de preuve, pas un correctif.'
    expect(jetonsDeCauseParFichier(texte, [], ['.autowin-preuve/', 'src/main/b.ts'])).toEqual({
      '.autowin-preuve/': true
    })
  })

  it('un jeton qui ne nomme AUCUN fichier ne desarme rien', () => {
    const texte = 'check: npm test\nTout est vert, je cloture.'
    expect(jetonsDeCauseParFichier(texte, [], ['src/main/boucle.ts'])).toEqual({})
  })

  it('le jeton ne vaut que pour la ligne : un chemin cite AILLEURS n est pas couvert', () => {
    const texte = 'fix-ok: src/main/a.ts corrige.\nJ ai aussi touche src/main/b.ts au passage.'
    expect(jetonsDeCauseParFichier(texte, [], ['src/main/a.ts', 'src/main/b.ts'])).toEqual({
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
    expect(jetonsDeCauseParFichier(undefined, reel([neuf]), [])).toEqual({
      'src/main/boucle.ts': true
    })
    // Un jeton ancien, non ecrit par ce run, ne desarme rien.
    expect(jetonsDeCauseParFichier(undefined, reel(['const x = 1']), [])).toEqual({})
  })

  it('ne bloque PAS non plus quand la cause est nommee dans le texte du run', async () => {
    const texte = 'CausalHypothesis: src/main/boucle.ts — le listener remet le compteur a zero.'
    const verdict = await bus().run('pre-green', ctx([mutation(['src/main/boucle.ts'])], texte))
    expect(verdict.reasons.join(' ')).not.toContain('fix-gate')
  })
})
