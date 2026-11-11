/**
 * LA COPIE DU FIL S'OUVRE JUSTE AVANT SA PREMIÈRE ÉCRITURE DANS LE CODE DU DÉPÔT.
 *
 * Avant, elle s'ouvrait au début du tour, sur une devinette lue dans le texte du message : « resume
 * cette video » passait pour une demande d'action et recevait une copie, un dossier sur le disque et
 * une annonce, pour un tour qui n'écrivait rien. Le seul moment où l'on SAIT qu'un tour écrit dans le
 * code, c'est l'appel d'outil qui écrit : le contrôle lancé avant chaque outil (`scriptHookGardes`) le
 * voit, demande la copie à l'app, attend sa réponse, puis renvoie l'agent dans la copie.
 *
 * L'échange passe par des fichiers à côté du script du contrôle, comme `reservation.json` :
 *  - `copie-a-la-demande.json` (écrit par l'app au lancement) : le dépôt partagé et les deux chemins ;
 *  - `copie-demandee.json` (écrit par le contrôle) : la première écriture vue ;
 *  - `copie-ouverte.json` (écrit par l'app) : `{ ok: true, chemin }` ou `{ ok: false, raison }`.
 *
 * Fonctions AUTOPORTÉES : sérialisées telles quelles dans le script du contrôle. Aucune ne nomme un
 * identifiant extérieur ; ce dont elles ont besoin (chemins, git, horloge) leur est passé.
 *
 * Limite connue : un script lancé du terminal (`node scripts/x.mjs`) qui écrit lui-même dans le code
 * n'est pas vu d'avance. Ce qu'il écrit atterrit dans le dossier partagé, comme avant les copies.
 */

import { decouperHeredocs } from './heredocs'

export const NOM_CONF_COPIE_A_LA_DEMANDE = 'copie-a-la-demande.json'
export const NOM_DEMANDE_DE_COPIE = 'copie-demandee.json'
export const NOM_REPONSE_DE_COPIE = 'copie-ouverte.json'
/** Attente du contrôle : l'ouverture borne elle-même la photo à 30 s et chaque appel git à 120 s. */
export const ATTENTE_COPIE_MS = 150_000

/** Ce que le contrôle sait de l'appel d'outil. */
export interface AppelVuParLeControle {
  outil: string
  /** `file_path` ou `notebook_path` d'un outil d'édition. */
  chemin: string
  /** La commande du terminal, sans les corps de heredoc de simple texte. */
  shell: string
  /** Dossier courant de la session au moment de l'appel. */
  cwd: string
}

export interface IoCibleDuDepot {
  /** `node:path` de la plateforme. */
  path: {
    resolve: (...morceaux: string[]) => string
    relative: (de: string, vers: string) => string
    isAbsolute: (chemin: string) => boolean
  }
  /** Vrai si git ignore ce chemin dans le dépôt ; `undefined` si git n'a pas su répondre. */
  estIgnore: (chemin: string) => boolean | undefined
  windows: boolean
  /** Le découpage des heredocs, PASSÉ (jamais appelé par nom : voir `src/shared/heredocs.ts`). */
  decoupeHeredocs: typeof decouperHeredocs
}

/**
 * Le premier chemin du CODE du dépôt que cet appel écrirait, ou `undefined`. Le code, c'est le dépôt
 * moins ce que git ignore (`node_modules`, `.autowin-data` où vivent les copies, `entreprise/`…) :
 * écrire là n'a rien à isoler. Git muet sur un chemin : on le compte dans le code (dans le doute, on isole).
 */
export function cibleDEcritureDansLeDepot(
  appel: AppelVuParLeControle,
  depot: string,
  io: IoCibleDuDepot
): string | undefined {
  const p = io.path
  const REDIRECTION = '\u0001>'
  const SAUTER = '\u0001<'
  const versChemin = (brut: string | undefined, base: string | undefined): string | undefined => {
    let t = String(brut ?? '').trim()
    if (!t || t.startsWith('-') || t.startsWith('&') || t.startsWith('~')) return undefined
    // Une variable, un motif ou une sous-commande ne se résout pas ici.
    if (/[$%`*?(){}]/.test(t)) return undefined
    if (/^(\/dev\/(null|stdout|stderr)|nul|con)$/i.test(t)) return undefined
    if (io.windows) {
      const m = /^\/([a-zA-Z])(\/.*)?$/.exec(t)
      if (m) t = `${m[1].toUpperCase()}:${m[2] ?? '/'}`
    }
    // Dossier courant inconnu (`cd "$TMP/x"`) : un chemin relatif ne désigne plus rien de lisible.
    if (base === undefined) return p.isAbsolute(t) ? p.resolve(t) : undefined
    return p.resolve(base, t)
  }
  const dansLeCode = (abs: string | undefined): boolean => {
    if (!abs) return false
    const rel = p.relative(depot, abs)
    if (rel === '') return true
    if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || p.isAbsolute(rel))
      return false
    return io.estIgnore(abs) !== true
  }
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(appel.outil)) {
    const abs = versChemin(appel.chemin, appel.cwd || depot)
    return dansLeCode(abs) ? abs : undefined
  }
  if (!/^(Bash|PowerShell|Monitor)$/.test(appel.outil)) return undefined

  return analyser(sansCorpsDeCode(String(appel.shell ?? '')), appel.cwd || depot, 0)

  /**
   * Le corps d'un heredoc donné à un programme de code (`node <<E`, `python - <<E`), ou écrit dans un
   * fichier de code (`cat > x.mjs <<E`), est du code de ce langage, pas du shell : ses `=>` et ses `>`
   * ne sont pas des redirections. Un corps qu'un shell lance (`bash <<E`, `cat <<E | sh`, ou un fichier
   * dont la première ligne est `#!/bin/bash`) reste lu.
   */
  function sansCorpsDeCode(texte: string): string {
    const { lignes, heredocs } = io.decoupeHeredocs(texte)
    const retires = new Set<number>()
    for (const h of heredocs) {
      if (/(^|[\s|;&(])(bash|sh|zsh|dash|ksh|cmd|powershell|pwsh)(?=\s|$)/.test(h.tube)) continue
      if (/^#!.*\b(bash|sh|zsh|dash|ksh)\b/.test(lignes[h.debut] ?? '')) continue
      const code =
        /(^|[\s|;&(])(node|nodejs|bun|deno|python3?|py)(?=\s|$)/.test(h.tube) ||
        /\.([mc]?[jt]sx?|py)$/i.test(h.cible ?? '')
      if (code) for (let j = h.debut; j <= h.fin; j++) retires.add(j)
    }
    return retires.size ? lignes.filter((_, j) => !retires.has(j)).join('\n') : texte
  }

  // Découpage en commandes simples (séparateurs hors guillemets) et en mots ; une redirection
  // devient le mot REDIRECTION suivi de sa cible. `depart` : le dossier courant au début du texte.
  function analyser(texte: string, depart: string | undefined, niveau: number): string | undefined {
    const segments: string[][] = [[]]
    let mot = ''
    let aMot = false
    let guillemet = ''
    const pousser = (): void => {
      if (aMot) segments[segments.length - 1].push(mot)
      mot = ''
      aMot = false
    }
    const couper = (): void => {
      pousser()
      if (segments[segments.length - 1].length) segments.push([])
    }
    for (let i = 0; i < texte.length; i++) {
      const c = texte[i]
      if (guillemet) {
        if (c === guillemet) guillemet = ''
        else mot += c
        continue
      }
      if (c === '"' || c === "'") {
        guillemet = c
        aMot = true
        continue
      }
      if (c === ' ' || c === '\t') {
        pousser()
        continue
      }
      if (c === '>') {
        // `2>` : le chiffre est le descripteur, pas un mot.
        if (/^\d$/.test(mot)) {
          mot = ''
          aMot = false
        } else pousser()
        if (texte[i + 1] === '>') i++
        if (texte[i + 1] === '&') {
          i++
          while (/[0-9-]/.test(texte[i + 1] ?? '')) i++
          continue
        }
        segments[segments.length - 1].push(REDIRECTION)
        continue
      }
      if (c === '<') {
        pousser()
        while (texte[i + 1] === '<' || texte[i + 1] === '-') i++
        segments[segments.length - 1].push(SAUTER)
        continue
      }
      if (c === '&' && texte[i + 1] === '>') {
        pousser()
        i++
        if (texte[i + 1] === '>') i++
        segments[segments.length - 1].push(REDIRECTION)
        continue
      }
      if (
        c === '\n' ||
        c === '\r' ||
        c === ';' ||
        c === '|' ||
        c === '&' ||
        c === '(' ||
        c === ')'
      ) {
        couper()
        continue
      }
      mot += c
      aMot = true
    }
    pousser()

    let cwd = depart
    const ECRIT_TOUT = new Set([
      'rm',
      'rmdir',
      'unlink',
      'touch',
      'mkdir',
      'md',
      'truncate',
      'chmod',
      'del',
      'erase',
      'rd',
      'tee',
      'mv',
      'move',
      'ren',
      'rename',
      'shred'
    ])
    const ECRIT_LA_DESTINATION = new Set(['cp', 'copy', 'install', 'ln', 'rsync'])
    const CMDLETS = new Set([
      'remove-item',
      'ri',
      'new-item',
      'ni',
      'set-content',
      'sc',
      'add-content',
      'ac',
      'clear-content',
      'out-file',
      'move-item',
      'mi',
      'rename-item',
      'rni',
      'copy-item',
      'cpi'
    ])
    const GIT_ECRIT = new Set([
      'add',
      'commit',
      'mv',
      'rm',
      'apply',
      'am',
      'merge',
      'rebase',
      'cherry-pick',
      'revert',
      'restore',
      'checkout',
      'switch',
      'reset',
      'stash',
      'pull',
      'clean'
    ])
    const NPM_ECRIT = new Set([
      'install',
      'i',
      'ci',
      'uninstall',
      'remove',
      'rm',
      'un',
      'update',
      'up',
      'upgrade',
      'add',
      'version',
      'dedupe',
      'prune',
      'link'
    ])
    for (const brut of segments) {
      const redirections: string[] = []
      const mots: string[] = []
      for (let i = 0; i < brut.length; i++) {
        if (brut[i] === REDIRECTION) {
          if (i + 1 < brut.length && !brut[i + 1].startsWith('\u0001')) redirections.push(brut[++i])
        } else if (brut[i] === SAUTER) {
          if (i + 1 < brut.length && !brut[i + 1].startsWith('\u0001')) i++
        } else mots.push(brut[i])
      }
      for (const r of redirections) {
        const abs = versChemin(r, cwd)
        if (dansLeCode(abs)) return abs
      }
      // Affectations de variables et préfixes sans effet sur la cible.
      while (
        mots.length &&
        (/^[A-Za-z_][A-Za-z0-9_]*=/.test(mots[0]) ||
          /^(sudo|env|time|command|exec|nohup|builtin|&)$/i.test(mots[0]))
      )
        mots.shift()
      if (!mots.length) continue
      const nom = (mots[0].split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|ps1)$/, '')
      const args = mots.slice(1)
      const sansOptions = args.filter((a) => !a.startsWith('-'))
      const cibles: string[] = []
      /** Cibles déjà résolues : le dépôt visé par git, le dossier d'un formateur. */
      const absolus: (string | undefined)[] = []
      if (
        nom === 'cd' ||
        nom === 'pushd' ||
        nom === 'chdir' ||
        nom === 'set-location' ||
        nom === 'sl'
      ) {
        // Cible illisible (variable, `cd -`, `cd` seul) : la suite tourne on ne sait où. Garder
        // l'ancien dossier ferait passer un `mkdir x` lancé ailleurs pour une écriture dans le code.
        cwd = versChemin(sansOptions[0], cwd)
        continue
      }
      if (ECRIT_TOUT.has(nom)) cibles.push(...sansOptions)
      else if (ECRIT_LA_DESTINATION.has(nom)) {
        if (sansOptions.length) cibles.push(sansOptions[sansOptions.length - 1])
      } else if (CMDLETS.has(nom)) {
        const nommes: string[] = []
        const positionnels: string[] = []
        for (let i = 0; i < args.length; i++) {
          const a = args[i]
          if (/^-(path|literalpath|filepath|destination)$/i.test(a)) {
            if (i + 1 < args.length) nommes.push(args[++i])
          } else if (
            /^-(itemtype|type|value|encoding|name|newname|filter|include|exclude)$/i.test(a)
          )
            i++
          else if (!a.startsWith('-')) positionnels.push(a)
        }
        if (nommes.length) cibles.push(...nommes)
        else if (/^(move-item|mi)$/.test(nom)) cibles.push(...positionnels.slice(0, 2))
        else if (/^(copy-item|cpi)$/.test(nom)) cibles.push(...positionnels.slice(1, 2))
        else cibles.push(...positionnels.slice(0, 1))
      } else if (nom === 'sed' || nom === 'perl') {
        if (!args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) continue
        const fichiers: string[] = []
        let script = false
        for (let i = 0; i < args.length; i++) {
          if (/^(-e|-f|--expression|--file)$/.test(args[i])) {
            script = true
            i++
          } else if (/^(--expression|--file)=/.test(args[i])) script = true
          else if (!args[i].startsWith('-')) fichiers.push(args[i])
        }
        cibles.push(...(script ? fichiers : fichiers.slice(1)))
      } else if (nom === 'git') {
        let ici = cwd
        let i = 0
        for (; i < args.length; i++) {
          if (args[i] === '-C') {
            const abs = versChemin(args[i + 1], ici)
            if (abs) ici = abs
            i++
          } else if (args[i] === '-c') i++
          else if (!args[i].startsWith('-')) break
        }
        const sous = args[i]
        const suite = args.slice(i + 1).filter((a) => !a.startsWith('-'))
        if (
          sous &&
          GIT_ECRIT.has(sous) &&
          !(sous === 'stash' && /^(list|show)$/.test(suite[0] ?? ''))
        )
          absolus.push(ici)
      } else if (nom === 'npm' || nom === 'pnpm' || nom === 'yarn' || nom === 'bun') {
        const sous = sansOptions[0]
        if (sous && NPM_ECRIT.has(sous)) absolus.push(versChemin('package.json', cwd))
        else if (sous === 'run' && /^(format|fix|lint:fix)$/.test(sansOptions[1] ?? ''))
          absolus.push(cwd)
      } else if (/^(bash|sh|zsh|dash|cmd|powershell|pwsh)$/.test(nom)) {
        // Commande enveloppée (`bash -lc "…"`, `powershell -Command "…"`, `cmd /c …`) : Codex et Grok
        // lancent ainsi les leurs. Ce qui suit l'option est relu comme une commande, au même endroit.
        const k = args.findIndex((a) => /^(-[a-z]*c|-command|[/]c|[/]k)$/i.test(a))
        if (k >= 0 && k + 1 < args.length && niveau < 3) {
          const dedans = analyser(args.slice(k + 1).join(' '), cwd, niveau + 1)
          if (dedans) return dedans
        }
      } else {
        // `prettier --write`, `eslint --fix`, directement ou par npx.
        const outils = nom === 'npx' || nom === 'pnpx' ? args : mots
        const k = outils.findIndex((a) => /^(prettier|eslint|@biomejs\/biome|biome)$/.test(a))
        if (k >= 0 && outils.slice(k + 1).some((a) => /^(--write|-w|--fix|--apply)$/.test(a))) {
          const fichiers = outils.slice(k + 1).filter((a) => !a.startsWith('-') && a !== 'check')
          if (fichiers.length) cibles.push(...fichiers)
          else absolus.push(cwd)
        }
      }
      for (const abs of [...absolus, ...cibles.map((c) => versChemin(c, cwd))])
        if (dansLeCode(abs)) return abs
    }
    return undefined
  }
}

/** Réponse de l'app, relue par le contrôle. */
export type ReponseDeCopie = { ok: true; chemin: string } | { ok: false; raison: string }

export interface ConfCopieALaDemande {
  depot: string
  demande: string
  reponse: string
  attenteMs?: number
}

export interface IoCopieALaDemande {
  lireJson: (chemin: string) => unknown
  ecrireJson: (chemin: string, valeur: unknown) => void
  attendre: (ms: number) => void
  maintenant: () => number
  cible: (appel: AppelVuParLeControle, depot: string) => string | undefined
  path: { join: (...m: string[]) => string; relative: (de: string, vers: string) => string }
}

/**
 * Le motif de refus que le contrôle rend à l'agent, ou `undefined` pour laisser passer.
 *  - pas d'écriture dans le code : rien ;
 *  - première écriture : la demande part, le contrôle attend la réponse de l'app, puis refuse l'appel
 *    en donnant le chemin de la copie, pour que l'agent y refasse son geste ;
 *  - copie déjà ouverte : toute écriture dans le dossier partagé est renvoyée vers la copie ;
 *  - ouverture refusée par l'app : le tour écrit dans le dossier partagé (l'app l'a dit dans le fil).
 * Pas de réponse à temps : refus, sans rien écrire ; l'appel suivant relit la réponse.
 */
export function copieAvantLEcriture(
  appel: AppelVuParLeControle,
  conf: ConfCopieALaDemande,
  io: IoCopieALaDemande
): string | undefined {
  const lireReponse = (): { ok: boolean; chemin?: string } | undefined => {
    const r = io.lireJson(conf.reponse) as { ok?: unknown; chemin?: unknown } | undefined
    if (!r || typeof r !== 'object') return undefined
    if (r.ok === true && typeof r.chemin === 'string' && r.chemin)
      return { ok: true, chemin: r.chemin }
    if (r.ok === false) return { ok: false }
    return undefined
  }
  let reponse = lireReponse()
  if (reponse && !reponse.ok) return undefined
  const cible = io.cible(appel, conf.depot)
  if (!cible) return undefined
  const enCopie = (chemin: string): string =>
    io.path.join(chemin, io.path.relative(conf.depot, cible))
  const terminal = /^(Bash|PowerShell|Monitor)$/.test(appel.outil)
  const geste = (chemin: string): string =>
    terminal
      ? `Relance cette commande depuis la copie : \`cd "${chemin}"\` d'abord (elle vise ${enCopie(chemin)}).`
      : `Refais cette modification sur ${enCopie(chemin)} : relis-le là d'abord.`
  if (reponse?.chemin)
    return `📂 Ce fil travaille dans sa copie ${reponse.chemin}, pas dans le dossier partagé ${conf.depot}. ${geste(reponse.chemin)} Garde tes chemins sous ${reponse.chemin} jusqu'à la fin du tour.`
  io.ecrireJson(conf.demande, { chemin: cible, outil: appel.outil, a: io.maintenant() })
  const fin = io.maintenant() + (conf.attenteMs ?? 150_000)
  while (io.maintenant() < fin) {
    io.attendre(200)
    reponse = lireReponse()
    if (reponse) break
  }
  if (!reponse)
    return `📂 La copie de travail de ce fil est en train de s'ouvrir (première modification du code de ${conf.depot}) et n'est pas encore prête. Rien n'a été écrit : refais ce geste dans un instant.`
  if (!reponse.ok) return undefined
  const chemin = reponse.chemin as string
  return `📂 Ce fil a maintenant sa propre copie de travail, ouverte juste avant cette première modification : ${chemin}. Rien n'a été écrit dans le dossier partagé ${conf.depot}. ${geste(chemin)} Jusqu'à la fin du tour, lis et écris sous ${chemin} (et \`cd "${chemin}"\` pour le terminal) : c'est ce qui entre dans le dépôt à la fin du tour.`
}

/** Modules de `node:` dont le contrôle a besoin, passés tels quels : la fonction ne nomme rien d'extérieur. */
export interface ModulesDuControle {
  fs: {
    readFileSync: (chemin: string, encodage: 'utf8') => string
    writeFileSync: (chemin: string, contenu: string) => void
    renameSync: (de: string, vers: string) => void
    unlinkSync: (chemin: string) => void
  }
  path: IoCibleDuDepot['path'] & IoCopieALaDemande['path']
  /** Le découpage des heredocs, passé au contrôle (voir `IoCibleDuDepot`). */
  decoupeHeredocs: IoCibleDuDepot['decoupeHeredocs']
  cp: {
    spawnSync: (
      commande: string,
      args: string[],
      options: { timeout: number; windowsHide: boolean }
    ) => { status: number | null }
  }
}

/**
 * LE CONTRÔLE, BRANCHÉ SUR LE DISQUE : le même pour le CLI Claude (script de ses réglages) et pour
 * Codex, Grok et agy (`moduleCopieALaDemande`). Un appel d'outil peut viser plusieurs fichiers (un
 * correctif `apply_patch`) : le premier qui écrit dans le code décide. Toute panne = `undefined`,
 * l'appel passe comme avant les copies.
 */
export function copieAvantLEcritureSurDisque(
  appels: AppelVuParLeControle[],
  conf: ConfCopieALaDemande,
  modules: ModulesDuControle,
  cible: typeof cibleDEcritureDansLeDepot,
  avant: typeof copieAvantLEcriture
): string | undefined {
  try {
    if (
      !conf ||
      typeof conf.depot !== 'string' ||
      typeof conf.demande !== 'string' ||
      typeof conf.reponse !== 'string'
    )
      return undefined
    const { fs, path, cp, decoupeHeredocs } = modules
    const ioCible = {
      path,
      windows: process.platform === 'win32',
      estIgnore: (c: string): boolean | undefined => {
        const r = cp.spawnSync('git', ['-C', conf.depot, 'check-ignore', '-q', '--', c], {
          timeout: 5000,
          windowsHide: true
        })
        return r.status === 0 ? true : r.status === 1 ? false : undefined
      },
      decoupeHeredocs
    }
    const sommeil = new Int32Array(new SharedArrayBuffer(4))
    const io = {
      lireJson: (p: string): unknown => {
        try {
          return JSON.parse(fs.readFileSync(p, 'utf8'))
        } catch {
          return undefined
        }
      },
      ecrireJson: (p: string, v: unknown): void => {
        const tmp = p + '.' + process.pid + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(v))
        try {
          fs.renameSync(tmp, p)
        } catch (e) {
          try {
            fs.unlinkSync(tmp)
          } catch {
            /* rien à retirer */
          }
          throw e
        }
      },
      attendre: (ms: number): void => {
        Atomics.wait(sommeil, 0, 0, ms)
      },
      maintenant: (): number => Date.now(),
      cible: (a: AppelVuParLeControle, depot: string): string | undefined =>
        cible(a, depot, ioCible),
      path
    }
    for (const appel of appels) {
      const motif = avant(appel, conf, io)
      if (motif) return motif
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * CODEX, GROK ET AGY : leur contrôle avant outil est un script FIXE du dépôt
 * (`scripts/garde-ecriture-hors-copie.mjs`), nommé par leurs réglages personnels, le même pour tous
 * leurs lancements. Il ne peut donc pas trouver la conf « à côté de lui », comme celui de Claude :
 * l'app la désigne par cette variable d'environnement, posée sur le seul lancement concerné.
 */
export const VARIABLE_COPIE_A_LA_DEMANDE = 'AUTOWIN_COPIE_A_LA_DEMANDE'
export const NOM_MODULE_COPIE_A_LA_DEMANDE = 'copie-a-la-demande.mjs'
/**
 * Ces CLI coupent un contrôle qui dure (10 s dans leurs réglages personnels) : le contrôle rend la
 * main avant, et l'agent refait son geste — l'appel suivant relit la réponse de l'app.
 */
export const ATTENTE_COPIE_CONTROLE_COURT_MS = 6_000

/** La conf d'un lancement de Codex, Grok ou agy : celle de Claude, plus le module à charger. */
export interface ConfCopieALaDemandeDesCli extends ConfCopieALaDemande {
  module: string
}

/**
 * Le module que ce script fixe charge : les mêmes fonctions que le contrôle de Claude, écrites par
 * l'app à chaque lancement (le script du dépôt n'a aucune dépendance, il ne peut pas les importer).
 */
export function moduleCopieALaDemande(): string {
  return `// Généré par Autowin (src/shared/copie-a-la-demande.ts) : ne pas modifier.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
const cibleDEcritureDansLeDepot = ${cibleDEcritureDansLeDepot.toString()};
const copieAvantLEcriture = ${copieAvantLEcriture.toString()};
const copieAvantLEcritureSurDisque = ${copieAvantLEcritureSurDisque.toString()};
const decouperHeredocs = ${decouperHeredocs.toString()};
/** \`appels\` : [{ outil: 'Bash' | 'Edit', chemin, shell, cwd }]. Rend le motif de refus, ou undefined. */
export function motifDeCopie(appels, conf) {
  return copieAvantLEcritureSurDisque(appels, conf, { fs, path, cp, decoupeHeredocs: decouperHeredocs }, cibleDEcritureDansLeDepot, copieAvantLEcriture);
}
`
}
