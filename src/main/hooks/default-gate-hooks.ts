import { execFile, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { exactLineFingerprint } from '../exact-line-fingerprint'
import { HookBus, type HookContext, type HookResult } from './hook-bus'
import { createVerifyReplayHook, type VerifyRunner } from './verify-replay-hook'
import {
  runHooks,
  requireVisualProofForFrontDiff,
  requireMotionProofForAnimationDiff
} from '../gates/hooks'
import type { HookHandler } from './hook-bus'
import type { ExecutionEvidence } from '../providers/types'
import { exigenceAppuiSourcesNeuves } from '../autowin-kaizen-context'

/**
 * Un handler pre-green qui RÉUTILISE les hooks synchrones existants (gates/hooks.ts :
 * anti-flaky / fix-gate / done-without-proof). On ne réécrit PAS leur logique — on la branche
 * comme handler du bus (unification demandée, zéro duplication).
 */
function syncGateHooksHandler(ctx: HookContext): HookResult {
  const violations = runHooks({
    requireProof: ctx.requireProof,
    evidenceOkCount: ctx.evidenceOkCount,
    producedDiff: ctx.producedDiff,
    /*
     * FIX-GATE ARME (2026-09-12). Il exige un jeton de cause des `3` editions du meme fichier.
     * Sa porte de sortie existe enfin : `jetonsDeCauseParFichier` collecte les `CausalHypothesis`
     * / `fix-ok:` / `check:` deposes dans le fichier corrige ou nommes dans le texte du run. Un
     * run qui itere en nommant sa cause passe ; un run qui itere en aveugle est refuse — c est
     * exactement ce que le hook a toujours dit faire, et qu il ne faisait pas.
     */
    editsByFile: ctx.editsByFile,
    causeTokensByFile:
      ctx.causeTokensByFile ??
      jetonsDeCauseParFichier(ctx.output, ctx.evidence, Object.keys(ctx.editsByFile ?? {}))
  })
  return violations.length
    ? { block: true, reason: violations.map((h) => `hook ${h.hook}: ${h.detail}`).join('; ') }
    : { block: false }
}

/**
 * APPUI SUR LES SOURCES NEUVES — contrôle hors modèle d'un rendu de /kaizen.
 *
 * Mesuré sur conv-105 : le dossier de preuve joignait les appels modèle, le journal des tours et
 * les saisies, l'exigence de s'en servir était écrite dans la consigne, et le rendu n'en citait
 * aucun — les corrections portaient sur le mécanisme qui fabrique le dossier. Une exigence
 * seulement écrite ne tient pas : elle est donc VÉRIFIÉE ici, sur le texte produit. Le contrôle ne
 * juge pas la pertinence de la correction, seulement qu'un identifiant réel est cité ; il ne
 * s'applique ni hors kaizen, ni quand le dossier ne porte aucune de ces trois sources.
 */
export function appuiSourcesNeuvesHandler(ctx: HookContext): HookResult {
  if (!ctx.output) return { block: false }
  const verdict = exigenceAppuiSourcesNeuves(ctx.task, ctx.output)
  return verdict.manque
    ? { block: true, reason: `hook kaizen-appui-sources-neuves: ${verdict.motif}` }
    : { block: false }
}

/**
 * Les fichiers que le RUN a REELLEMENT edites, derives de ses propres preuves d execution.
 *
 * Une `ExecutionEvidence` de `kind: 'mutation'` nomme ses chemins (`paths`, `path`, ou les cles
 * de `pathFingerprints`). Cette information existait deja dans le contexte des hooks ; personne
 * ne la lisait, et `editsByFile` restait vide en production — le fix-gate etait donc muet, et les
 * garde-fous de preuve devaient DEVINER le perimetre du run par soustraction sur `git status`.
 *
 * Une lecture ou une verification n'est PAS une edition : seules les mutations comptent.
 */
export function fichiersEditesParLeRun(
  evidence: readonly ExecutionEvidence[] | undefined,
  cwd?: string
): Record<string, number> {
  const compte: Record<string, number> = {}
  // fix-ok: conv-539 tour 24e29815 — le meme fichier compte sous son chemin relatif ET absolu.
  const racine = cwd ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') + '/' : ''
  for (const item of evidence ?? []) {
    if (item.kind !== 'mutation') continue
    const chemins = [
      ...(item.paths ?? []),
      ...(item.path ? [item.path] : []),
      ...Object.keys(item.pathFingerprints ?? {})
    ]
    for (const brut of new Set(chemins)) {
      let chemin = brut.replace(/\\/g, "/").trim()
      if (racine && chemin.toLowerCase().startsWith(racine.toLowerCase())) {
        chemin = chemin.slice(racine.length)
      }
      if (!chemin) continue
      compte[chemin] = (compte[chemin] ?? 0) + 1
    }
  }
  return compte
}

/**
 * LE PRODUCTEUR DE JETONS DE CAUSE — ce qui manquait pour armer le fix-gate.
 *
 * `detectBlindFixLoop` refuse un vert des `3` editions du MEME fichier sans jeton de cause, et
 * nomme lui-meme les trois jetons attendus : `CausalHypothesis`, `fix-ok:`, `check:`. Personne ne
 * les collectait — le hook ne pouvait donc qu etre desarme, ou etre un piege sans porte de sortie.
 *
 * Deux sources REELLES, toutes deux deja pratiquees dans ce depot :
 *  - le commentaire depose dans le fichier corrige (`// fix-ok: ...`), lisible dans le diff de la
 *    preuve de mutation — la forme majoritaire ici ;
 *  - le texte du run, quand la ligne du jeton NOMME le fichier.
 *
 * Attribution deliberement ETROITE : un jeton ne desarme que les fichiers qu il NOMME, sur SA
 * ligne. Un `check:` isole ne vaut pas laissez-passer global, sinon le garde-fou ne mord jamais.
 * Un nom de fichier seul (sans dossier) n est resolu que s il designe UN SEUL fichier edite :
 * deviner entre deux `index.ts` reviendrait a desarmer le mauvais.
 */
const JETON_DE_CAUSE = /\b(?:CausalHypothesis|fix-ok|check)\s*:/

export function jetonsDeCauseParFichier(
  texteDuRun: string | undefined,
  evidence: readonly ExecutionEvidence[] | undefined,
  fichiersEdites: readonly string[]
): Record<string, boolean> {
  const jetons: Record<string, boolean> = {}
  const norm = (f: string): string => f.replace(/\\/g, '/').trim()

  // Source 1 — le jeton depose DANS le fichier, vu par le diff (ou resume) de sa mutation.
  for (const item of evidence ?? []) {
    if (item.kind !== 'mutation') continue
    // fix-ok: conv-540 tour 4dfe2821 — la preuve reelle (workspace_delta) n a jamais de `diff`, seulement les empreintes des lignes ecrites : le jeton depose dans le fichier etait invisible et le refus revenait
    for (const [chemin, empreintes] of Object.entries(item.writtenLineFingerprintsByPath ?? {})) {
      if (!item.workspaceRoot || !norm(chemin) || !empreintes.length) continue
      let contenu = ''
      try {
        contenu = readFileSync(resolve(item.workspaceRoot, chemin), 'utf8')
      } catch {
        continue
      }
      const ecrites = new Set(empreintes)
      if (
        contenu
          .split(/\r?\n/)
          .some((l) => JETON_DE_CAUSE.test(l) && ecrites.has(exactLineFingerprint(l)))
      )
        jetons[norm(chemin)] = true
    }
    if (!JETON_DE_CAUSE.test(`${item.diff ?? ''}\n${item.summary ?? ''}`)) continue
    const chemins = [
      ...(item.paths ?? []),
      ...(item.path ? [item.path] : []),
      ...Object.keys(item.pathFingerprints ?? {})
    ]
    for (const c of chemins) if (norm(c)) jetons[norm(c)] = true
  }

  // Source 2 — le jeton ecrit dans le texte du run, sur une ligne qui nomme un fichier edite.
  const connus = fichiersEdites.map(norm).filter(Boolean)
  const parBase = new Map<string, string[]>()
  for (const f of connus) {
    const base = f.split('/').pop() as string
    parBase.set(base, [...(parBase.get(base) ?? []), f])
  }
  for (const ligne of (texteDuRun ?? '').split(/\r?\n/)) {
    if (!JETON_DE_CAUSE.test(ligne)) continue
    // fix-ok: un dossier non suivi arrive de `git status` comme `.autowin-preuve/` (sans extension) :
    // la regex de chemin ci-dessous exige une extension, il ne pouvait donc JAMAIS etre nomme (recupere de run-febaa41f9647-1).
    const ligneNorm = norm(ligne)
    for (const f of connus) if (f.endsWith('/') && ligneNorm.includes(f)) jetons[f] = true
    // fix-ok: la classe excluait « : » — un chemin absolu Windows (D:/...) perdait sa lettre de lecteur et ne pouvait jamais desarmer le fichier (conv-526, refus « 5 edits de D:/AutoWinOS/scripts/ui-capture.mjs »)
    // fix-ok: l'extension exigeait des lettres seules — un « .ps1 » ne pouvait jamais desarmer son fichier (conv-528, refus « 7 edits de resources/hdesk-tv.ps1 » malgre le jeton ; recupere de run-0e76c99a3021-1)
    const candidats = ligne.match(/(?:\b[A-Za-z]:)?[\w./\\-]+\.[A-Za-z][A-Za-z0-9]{0,4}\b/g) ?? []
    for (const brut of candidats) {
      const c = norm(brut)
      if (connus.includes(c)) {
        jetons[c] = true
        continue
      }
      const homonymes = parBase.get(c.split('/').pop() as string)
      if (c.includes('/') || !homonymes || homonymes.length !== 1) continue
      jetons[homonymes[0]] = true
    }
  }
  return jetons
}

/**
 * Le CHEMIN porte par une ligne de `git status --porcelain`, prefixe d etat retire.
 *
 * DEFAUT MESURE le 2026-09-12 : la lecture faisait `.trim()` sur la ligne AVANT de couper 3
 * caracteres. Or le porcelain ecrit DEUX colonnes d etat + un espace, et une modification non
 * indexee commence par un ESPACE (« _M_chemin ») : le trim mangeait cet espace, et la coupe
 * emportait alors la premiere lettre du chemin — `src/renderer/...` devenait `rc/renderer/...`.
 * On coupe donc sur la ligne BRUTE, et on garde la CIBLE d un renommage.
 */
export function cheminPorcelain(ligneBrute: string): string {
  const sansPrefixe = /^[ MADRCU?!]{2} /.test(ligneBrute) ? ligneBrute.slice(3) : ligneBrute
  const chemin = sansPrefixe.includes(' -> ') ? sansPrefixe.split(' -> ')[1] : sansPrefixe
  return chemin.trim()
}

/**
 * Ce que le RUN a touche : l etat courant MOINS ce qui etait deja sale a son demarrage.
 *
 * Sans etat de depart connu (`undefined`), on ne soustrait rien : un garde-fou prefere refuser a
 * tort que laisser passer un faux vert. Avec une liste VIDE, le run est seul responsable.
 */
export function attribuablesAuRun(
  touchesMaintenant: readonly string[],
  avantLeRun: readonly string[] | undefined
): readonly string[] {
  if (!avantLeRun) return touchesMaintenant
  const deja = new Set(avantLeRun.map((f) => f.replace(/\\/g, "/")))
  return touchesMaintenant.filter((f) => !deja.has(f.replace(/\\/g, "/")))
}

/**
 * PREUVE VISUELLE — le hook existait, personne ne l'allumait.
 *
 * `requireVisualProofForFrontDiff` (gates/hooks.ts) refuse un vert quand le RENDU est modifié sans
 * capture réellement lue. Il était écrit, testé... et passé par AUCUN site de production : `grep -rn
 * requireVisualProof src/main` ne rendait que sa propre définition. L'exigence ne vivait donc qu'en
 * PROSE (pipeline-discipline.ts), et une prose ne refuse rien.
 *
 * Mesure (conv-512, tour `24bf5294-7ab1-4104-aa0c-1c0f62009fb8`) : un run modifie
 * `ModelActivityLogPane.tsx` + `.css`, se clôture VERT, et l'agent écrit lui-même « je ne l'ai pas
 * observé à l'écran — aucune capture, aucun verdict visuel de ma part ».
 *
 * Le diff n'est pas transporté jusqu'ici : on reconstruit la liste des fichiers TOUCHÉS depuis le
 * dépôt de travail (état non enregistré + écart avec HEAD), au format `+++ b/<chemin>` que le hook
 * sait lire. Injectable pour les tests ; en cas d'échec git, on rend une liste vide — un garde-fou
 * ne doit pas inventer un refus sur un dépôt qu'il n'a pas su lire.
 */
export function fichiersTouchesGit(cwd: string): readonly string[] {
  const lire = (args: string[], brut = false): string[] => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true })
        .split(/\r?\n/)
        .map((l) => (brut ? l : l.trim()))
        .filter(Boolean)
    } catch {
      return []
    }
  }
  const porcelain = lire(['status', '--porcelain'], true).map(cheminPorcelain).filter(Boolean)
  return [...new Set([...porcelain, ...lire(['diff', '--name-only', 'HEAD'])])]
}

/** Une capture est une preuve VISUELLE seulement si elle a réellement été exécutée et rendue ok. */
function capturesLues(evidence: HookContext['evidence']): number {
  return (evidence ?? []).filter((e) => e.ok && /ui-capture/.test(e.command ?? '')).length
}

export function creerPreuveVisuelleHandler(
  listerFichiersTouches: (cwd: string) => readonly string[] = fichiersTouchesGit
): HookHandler {
  return (ctx: HookContext): HookResult => {
    // `requireProof` marque déjà les tâches MUTANTES : hors de là, aucun rendu n'est en jeu.
    if (!ctx.requireProof || !ctx.cwd) return { block: false }
    // Le diff du RUN fait foi quand il existe ; sinon seulement, on deduit par soustraction.
    const mutes = Object.keys(ctx.editsByFile ?? fichiersEditesParLeRun(ctx.evidence))
    const perimetre = mutes.length
      ? mutes
      : attribuablesAuRun(listerFichiersTouches(ctx.cwd), ctx.fichiersTouchesAvantLeRun)
    const diff = perimetre
      .map((f) => `+++ b/${f.replace(/\\/g, '/')}`)
      .join('\n')
    if (!diff) return { block: false }
    const violations = requireVisualProofForFrontDiff(diff, capturesLues(ctx.evidence))
    return violations.length
      ? { block: true, reason: violations.map((h) => `hook ${h.hook}: ${h.detail}`).join('; ') }
      : { block: false }
  }
}

/**
 * Le DIFF reduit aux fichiers attribuables au run : on retire les sections `diff --git` des
 * fichiers deja sales au demarrage. Un diff unifie se decoupe sur ses en-tetes `diff --git`.
 */
export function diffAttribuable(
  diff: string,
  avantLeRun: readonly string[] | undefined
): string {
  if (!avantLeRun || !diff) return diff
  const deja = new Set(avantLeRun.map((f) => f.replace(/\\/g, "/")))
  const sections = diff.split(/^(?=diff --git )/m).filter(Boolean)
  return sections
    .filter((section) => {
      const m = /^\+\+\+ b\/(.+)$/m.exec(section)
      return !m || !deja.has(m[1].trim())
    })
    .join('')
}

/**
 * Le DIFF reduit aux seuls fichiers NOMMES (perimetre du run). Complement exact de
 * `diffAttribuable`, qui lui RETIRE une liste : ici on ne GARDE que ce que le run a mute.
 */
export function diffLimiteAux(diff: string, fichiers: readonly string[]): string {
  if (!diff || !fichiers.length) return diff
  const garder = new Set(fichiers.map((f) => f.replace(/\\/g, "/")))
  return diff
    .split(/^(?=diff --git )/m)
    .filter(Boolean)
    .filter((section) => {
      const m = /^\+\+\+ b\/(.+)$/m.exec(section)
      return m ? garder.has(m[1].trim()) : false
    })
    .join('')
}

/**
 * PREUVE DE MOUVEMENT — meme trou que la preuve visuelle, autre hook.
 *
 * `requireMotionProofForAnimationDiff` n'etait lui non plus passe par AUCUN appelant de production.
 * Une capture FIXE satisfait la preuve visuelle tout en etant aveugle a la seule chose qu'un diff
 * d'animation modifie : le mouvement. On lui donne donc le VRAI diff du depot de travail (`git diff
 * HEAD`), seul texte ou les lignes ajoutees `animation:` / `@keyframes` sont lisibles. Diff illisible
 * ou vide => aucun refus invente.
 */
export function diffGit(cwd: string): string {
  try {
    return execFileSync('git', ['diff', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    })
  } catch {
    return ''
  }
}

export function creerPreuveMouvementHandler(
  lireDiff: (cwd: string) => string = diffGit
): HookHandler {
  return (ctx: HookContext): HookResult => {
    if (!ctx.requireProof || !ctx.cwd) return { block: false }
    // Un diff d animation ne se lit que dans le TEXTE du diff : on garde la lecture git, mais
    // bornee au perimetre du run quand il est connu.
    const mutes = Object.keys(ctx.editsByFile ?? fichiersEditesParLeRun(ctx.evidence))
    const diff = mutes.length
      ? diffLimiteAux(lireDiff(ctx.cwd), mutes)
      : diffAttribuable(lireDiff(ctx.cwd), ctx.fichiersTouchesAvantLeRun)
    if (!diff) return { block: false }
    const mesures = (ctx.evidence ?? []).filter(
      (e) => e.ok && /ui-capture/.test(e.command ?? '') && /--motion/.test(e.command ?? '')
    ).length
    const violations = requireMotionProofForAnimationDiff(diff, mesures)
    return violations.length
      ? { block: true, reason: violations.map((h) => `hook ${h.hook}: ${h.detail}`).join('; ') }
      : { block: false }
  }
}

/** Cap du re-jeu de vérification (comme le stop-gate CC) : au-delà → kill → bloque. */
const VERIFY_TIMEOUT_MS = 120_000

/** Runner réel par défaut (verify-replay) : exécute la commande via le shell et rend son exit code. */
const defaultVerifyRunner: VerifyRunner = (cmd, cwd) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      { cwd, shell: true, windowsHide: true, timeout: VERIFY_TIMEOUT_MS },
      (error) => {
        // timeout → error.killed=true → exitCode non-zéro → block (jamais un faux-vert sur dépassement).
        const exitCode =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? ((error as { code: number }).code as number)
            : error
              ? 1
              : 0
        resolve({ exitCode })
      }
    )
  })

/**
 * Construit le HookBus par défaut d'Autowin : les hooks synchrones existants + verify-replay,
 * tous branchés sur `pre-green`. Sans bus fourni à l'orchestrateur, celui-ci utilise CE bus →
 * comportement d'enforcement identique à l'existant (rétrocompat) + verify-replay en plus.
 * Les events pre-exec/post-exec/run-stop existent (extensibles) mais n'ont pas de handler par défaut.
 */
export function createDefaultHookBus(verifyRunner: VerifyRunner = defaultVerifyRunner): HookBus {
  return new HookBus()
    .register('pre-green', syncGateHooksHandler)
    .register('pre-green', appuiSourcesNeuvesHandler)
    .register('pre-green', creerPreuveVisuelleHandler())
    .register('pre-green', creerPreuveMouvementHandler())
    .register('pre-green', createVerifyReplayHook(verifyRunner))
}
