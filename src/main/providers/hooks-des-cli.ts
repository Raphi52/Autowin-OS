/**
 * LA GARDE NPM DANS LES CONTRÔLES PERSONNELS DE GROK ET DE CODEX.
 *
 * Les copies de travail des agents relient le `node_modules` du dépôt (`dependances-copie-agent.ts`) :
 * un `npm install` lancé dans une copie réécrit celui de l'app ouverte. Claude reçoit la garde par ses
 * réglages de lancement (`claude.ts`) ; Grok et Codex n'en ont pas d'équivalent, d'où un contrôle
 * « avant commande » (PreToolUse) dans leurs fichiers personnels :
 *  - Grok lancé sans fenêtre (`--prompt-file`) fait tourner `~/.grok/hooks/*.json` sans dossier de
 *    confiance (`~/.grok/docs/user-guide/10-hooks.md`, lignes 68 et 84). Le fichier est à nous seuls.
 *  - Codex lit `$CODEX_HOME/hooks.json` malgré `--ignore-user-config`, mais pas la validation rangée
 *    dans `config.toml` : un contrôle n'y tourne qu'avec `--dangerously-bypass-hook-trust`, option
 *    prévue pour un lanceur qui vérifie lui-même ses contrôles. `verifierControlesCodex` joue ce rôle.
 *    Ce fichier porte aussi le contrôle du Brain : on y ajoute une entrée, on ne réécrit jamais la sienne.
 *
 * La garde d'écriture hors copie (`scripts/garde-ecriture-hors-copie.mjs`) suit le même chemin : un
 * fil dans sa copie n'écrit pas dans le dossier partagé d'où tourne l'app. Elle juge aussi les outils
 * qui écrivent des fichiers, d'où un contrôle à part (`garde-ecriture.json`, groupe `Bash|apply_patch`).
 *
 * Aucun import hors `node:` : le module se lance aussi seul, `node src/main/providers/hooks-des-cli.ts
 * <chemin absolu de garde-npm-modules.mjs>`, pour installer les contrôles sur un poste (la garde
 * d'écriture aussi, quand elle est à côté de la garde npm).
 */
import {
  copyFileSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { memeCheminSurDisque } from '../fichiers/meme-chemin'

export const FICHIER_GARDE_NPM_GROK = 'garde-npm.json'
export const FICHIER_GARDE_ECRITURE_GROK = 'garde-ecriture.json'
/** La garde d'écriture hors copie vit à côté de la garde npm, dans `<dépôt>/scripts`. */
export const SCRIPT_GARDE_ECRITURE = 'garde-ecriture-hors-copie.mjs'

/** `run_terminal_command` est le nom réel de l'outil shell de Grok (entrée tracée le 2026-11-06). */
const OUTILS_SHELL_GROK = 'Bash|run_terminal_command'
/** Codex présente ses commandes shell sous le nom `Bash` (https://learn.chatgpt.com/docs/hooks). */
const OUTIL_SHELL_CODEX = 'Bash'
/**
 * La garde d'écriture juge aussi les outils qui écrivent des fichiers. Grok : ses noms réels
 * (`search_replace`, `write`, `write_file`, `hashline_edit`) et les noms Claude, qu'il fait
 * correspondre aux siens (`~/.grok/docs/user-guide/10-hooks.md`, « Tool Name Aliases »).
 */
const OUTILS_ECRITURE_GROK = `${OUTILS_SHELL_GROK}|Edit|Write|MultiEdit|NotebookEdit|search_replace|write|write_file|hashline_edit`
/** Codex : ses éditions de fichiers passent par `apply_patch` (https://learn.chatgpt.com/docs/hooks). */
const OUTILS_ECRITURE_CODEX = `${OUTIL_SHELL_CODEX}|apply_patch`
/** Un `node` qui démarre tient en une seconde ; Codex attendrait 600 s par défaut sur un blocage. */
const DELAI_GARDE_S = 10

/** Le contrôle Grok : `command` + `args`, donc lancé sans shell (forme exigée sans dossier de confiance). */
export function controleGrokGardeNpm(script: string): Record<string, unknown> {
  return controleGrok(OUTILS_SHELL_GROK, script)
}

/** Même forme pour la garde d'écriture, sur le shell ET les outils qui écrivent des fichiers. */
export function controleGrokGardeEcriture(script: string): Record<string, unknown> {
  return controleGrok(OUTILS_ECRITURE_GROK, script)
}

function controleGrok(matcher: string, script: string): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher,
          hooks: [{ type: 'command', command: 'node', args: [script], timeout: DELAI_GARDE_S }]
        }
      ]
    }
  }
}

/** Codex ne connaît pas `args` : la commande passe par son shell, le chemin entre guillemets. */
export function commandeCodexGardeNpm(script: string): string {
  return `node "${script}"`
}

export function dossierHooksGrok(maison: string = homedir()): string {
  return join(maison, '.grok', 'hooks')
}

/** Le fichier que Codex lit : `$CODEX_HOME/hooks.json`, `~/.codex` par défaut. */
export function fichierHooksCodex(
  env: NodeJS.ProcessEnv = process.env,
  maison: string = homedir()
): string {
  return join(env.CODEX_HOME?.trim() || join(maison, '.codex'), 'hooks.json')
}

function lireSiPresent(fichier: string): string | undefined {
  try {
    return readFileSync(fichier, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw e
  }
}

/** Écrit à côté puis renomme : un Codex qui lit pendant l'écriture ne voit jamais un fichier à moitié. */
function ecrireEntier(fichier: string, contenu: string): void {
  mkdirSync(dirname(fichier), { recursive: true })
  const provisoire = `${fichier}.${process.pid}.tmp`
  writeFileSync(provisoire, contenu, 'utf8')
  renameSync(provisoire, fichier)
}

/**
 * Pose `garde-npm.json` dans le dossier des contrôles de Grok. Idempotent : déjà identique → rien
 * n'est écrit. Les autres fichiers du dossier ne sont jamais lus ni touchés.
 */
export function installerGardeNpmGrok(
  dossierHooks: string,
  script: string
): 'cree' | 'inchange' | 'mis-a-jour' {
  return poserControleGrok(join(dossierHooks, FICHIER_GARDE_NPM_GROK), controleGrokGardeNpm(script))
}

/** Pose `garde-ecriture.json` à côté de `garde-npm.json`, avec les mêmes règles. */
export function installerGardeEcritureGrok(
  dossierHooks: string,
  script: string
): 'cree' | 'inchange' | 'mis-a-jour' {
  return poserControleGrok(
    join(dossierHooks, FICHIER_GARDE_ECRITURE_GROK),
    controleGrokGardeEcriture(script)
  )
}

function poserControleGrok(
  fichier: string,
  controle: Record<string, unknown>
): 'cree' | 'inchange' | 'mis-a-jour' {
  const voulu = `${JSON.stringify(controle, null, 2)}\n`
  const actuel = lireSiPresent(fichier)
  if (actuel === voulu) return 'inchange'
  ecrireEntier(fichier, voulu)
  return actuel === undefined ? 'cree' : 'mis-a-jour'
}

interface ControleCodex {
  type?: unknown
  command?: unknown
  [cle: string]: unknown
}
interface GroupeCodex {
  matcher?: unknown
  hooks?: unknown
  [cle: string]: unknown
}

function lireHooksCodex(brut: string): { hooks?: Record<string, unknown>; [cle: string]: unknown } {
  const racine = JSON.parse(brut.charCodeAt(0) === 0xfeff ? brut.slice(1) : brut) as unknown
  if (!racine || typeof racine !== 'object' || Array.isArray(racine)) {
    throw new Error('hooks.json : la racine n’est pas un objet')
  }
  const hooks = (racine as { hooks?: unknown }).hooks
  if (hooks !== undefined && (!hooks || typeof hooks !== 'object' || Array.isArray(hooks))) {
    throw new Error('hooks.json : « hooks » n’est pas un objet')
  }
  return racine as { hooks?: Record<string, unknown> }
}

function groupesDe(evenement: unknown): GroupeCodex[] {
  return Array.isArray(evenement) ? (evenement as GroupeCodex[]) : []
}
function controlesDe(groupe: GroupeCodex): ControleCodex[] {
  return Array.isArray(groupe?.hooks) ? (groupe.hooks as ControleCodex[]) : []
}

function estGardeNpm(controle: ControleCodex, script: string): boolean {
  const m = typeof controle.command === 'string' ? /^node "([^"]+)"$/.exec(controle.command) : null
  return controle.type === 'command' && m !== null && memeCheminSurDisque(m[1]!, script)
}

/** La garde d'écriture du même dépôt que la garde npm `scriptNpm`, et d'aucun autre. */
function estGardeEcriture(controle: ControleCodex, scriptNpm: string): boolean {
  return estGardeNpm(controle, join(dirname(scriptNpm), SCRIPT_GARDE_ECRITURE))
}

/**
 * Ajoute la garde npm aux contrôles « avant commande » de Codex. Idempotent : déjà présente → rien
 * n'est écrit. Sinon, copie horodatée du fichier d'abord, puis ajout d'UN groupe : les autres
 * entrées (le contrôle du Brain) sont recopiées telles quelles. Fichier illisible → exception, et
 * rien n'est écrit : on ne remplace pas ce qu'on ne sait pas relire.
 */
export function installerGardeNpmCodex(
  fichierHooks: string,
  script: string,
  horodatage: string = new Date().toISOString().replace(/[:.]/g, '-')
): { issue: 'cree' | 'inchange' | 'ajoute'; sauvegarde?: string } {
  return ajouterControleCodex(fichierHooks, OUTIL_SHELL_CODEX, script, horodatage)
}

/**
 * Ajoute la garde d'écriture (`script` = son chemin absolu) aux contrôles « avant outil » de Codex,
 * sur `Bash` et `apply_patch`. Mêmes règles que la garde npm : idempotent, copie horodatée d'abord,
 * les autres entrées recopiées telles quelles, fichier illisible → exception sans rien écrire.
 */
export function installerGardeEcritureCodex(
  fichierHooks: string,
  script: string,
  horodatage: string = new Date().toISOString().replace(/[:.]/g, '-')
): { issue: 'cree' | 'inchange' | 'ajoute'; sauvegarde?: string } {
  return ajouterControleCodex(fichierHooks, OUTILS_ECRITURE_CODEX, script, horodatage)
}

function ajouterControleCodex(
  fichierHooks: string,
  matcher: string,
  script: string,
  horodatage: string
): { issue: 'cree' | 'inchange' | 'ajoute'; sauvegarde?: string } {
  const brut = lireSiPresent(fichierHooks)
  const groupe = {
    matcher,
    hooks: [{ type: 'command', command: commandeCodexGardeNpm(script), timeout: DELAI_GARDE_S }]
  }
  if (brut === undefined) {
    ecrireEntier(fichierHooks, `${JSON.stringify({ hooks: { PreToolUse: [groupe] } }, null, 2)}\n`)
    return { issue: 'cree' }
  }
  const racine = lireHooksCodex(brut)
  const hooks = racine.hooks ?? {}
  const avant = groupesDe(hooks.PreToolUse)
  if (avant.some((g) => controlesDe(g).some((c) => estGardeNpm(c, script))))
    return { issue: 'inchange' }
  const sauvegarde = `${fichierHooks}.${horodatage}.bak`
  // COPYFILE_EXCL : une sauvegarde déjà là n'est jamais écrasée.
  copyFileSync(fichierHooks, sauvegarde, constants.COPYFILE_EXCL)
  const nouveau = { ...racine, hooks: { ...hooks, PreToolUse: [...avant, groupe] } }
  ecrireEntier(fichierHooks, `${JSON.stringify(nouveau, null, 2)}\n`)
  return { issue: 'ajoute', sauvegarde }
}

/**
 * Les contrôles personnels que le poste déclare de confiance (celui du Brain, par exemple), rangés
 * dans le dossier de données de l'app, hors git : le code ne connaît aucun contrôle tiers par son
 * nom, il ne fait que comparer. Forme : `{ "controles": [{ "evenement": …, "command": … }] }`.
 */
// fix-ok: le nom de l'entreprise était écrit en dur dans l'expression du contrôle reconnu ; rouge mesuré : separation-entreprise.test.ts listait ce fichier.
export const FICHIER_CONTROLES_DE_CONFIANCE = 'controles-codex-de-confiance.json'

export interface ControleDeConfiance {
  evenement: string
  command: string
}

/**
 * Lit la liste du poste. Absente → liste vide : sans elle, seul ce que l'app écrit elle-même est
 * connu. Mal formée → exception : une liste à moitié lue ferait confiance à ce qu'on n'a pas relu.
 */
export function lireControlesDeConfiance(fichier: string | undefined): ControleDeConfiance[] {
  const brut = fichier ? lireSiPresent(fichier) : undefined
  if (brut === undefined) return []
  const racine = JSON.parse(brut.charCodeAt(0) === 0xfeff ? brut.slice(1) : brut) as unknown
  const liste = (racine as { controles?: unknown } | null)?.controles
  if (!Array.isArray(liste)) throw new Error('« controles » n’est pas une liste')
  return liste.map((entree: unknown, i) => {
    const { evenement, command } = (entree ?? {}) as Record<string, unknown>
    if (typeof evenement !== 'string' || !evenement || typeof command !== 'string' || !command) {
      throw new Error(
        `entrée ${i} : « evenement » et « command » doivent être des textes non vides`
      )
    }
    return { evenement, command }
  })
}

/** Champs qu'un contrôle connu peut porter. Un autre (`commandWindows`, `async`…) change ce qui tourne. */
const CHAMPS_CONNUS = new Set(['type', 'command', 'timeout'])

/** Égalité exacte, événement compris : jamais un motif, qui ferait confiance à un voisin. */
function estDeConfiance(
  evenement: string,
  controle: ControleCodex,
  liste: readonly ControleDeConfiance[]
): boolean {
  return (
    controle.type === 'command' &&
    typeof controle.command === 'string' &&
    liste.some((c) => c.evenement === evenement && c.command === controle.command)
  )
}

export interface VerdictControlesCodex {
  /** Vrai seulement si tout ce que Codex ferait tourner est connu de l'app, garde npm comprise. */
  contourner: boolean
  avertissement?: string
}

/**
 * Codex peut-il partir avec `--dangerously-bypass-hook-trust` ? Cette option fait tourner TOUS les
 * contrôles activés sans leur relecture : on ne la passe que si chacun est une garde de l'app ou un
 * contrôle listé, à l'identique, par le poste (`controlesDeConfiance`), et que la garde npm est là.
 * Sinon Codex part sans elle, et l'avertissement le dit au fil.
 *
 * `cwd` : les dossiers `.codex` d'un projet, du dossier du tour jusqu'à la racine de son dépôt, sont
 * des contrôles que l'app ne relit pas. Leur seule présence suffit à refuser l'option.
 */
export function verifierControlesCodex(entree: {
  fichierHooks: string
  script: string | undefined
  cwd?: string
  existe?: (chemin: string) => boolean
  /** Chemin de `FICHIER_CONTROLES_DE_CONFIANCE` sur ce poste ; absent → aucun contrôle tiers connu. */
  controlesDeConfiance?: string
}): VerdictControlesCodex {
  const existe = entree.existe ?? existsSync
  const sans = (raison: string): VerdictControlesCodex => ({
    contourner: false,
    avertissement: `Garde npm inactive pour ce tour Codex : ${raison}. Codex part sans --dangerously-bypass-hook-trust, donc sans ses contrôles personnels.`
  })
  if (!entree.script) return sans('scripts/garde-npm-modules.mjs introuvable à côté de l’app')
  const projet = controlesDeProjet(entree.cwd, dirname(entree.fichierHooks), existe)
  if (projet) return sans(`${projet} porte des contrôles de projet que l’app ne relit pas`)
  let racine: ReturnType<typeof lireHooksCodex>
  try {
    const brut = lireSiPresent(entree.fichierHooks)
    if (brut === undefined) return sans(`${entree.fichierHooks} n’existe pas`)
    racine = lireHooksCodex(brut)
  } catch (e) {
    return sans(`${entree.fichierHooks} illisible (${(e as Error).message})`)
  }
  let deConfiance: ControleDeConfiance[]
  try {
    deConfiance = lireControlesDeConfiance(entree.controlesDeConfiance)
  } catch (e) {
    return sans(`${entree.controlesDeConfiance} illisible (${(e as Error).message})`)
  }
  const inconnus: string[] = []
  let garde = false
  for (const [evenement, valeur] of Object.entries(racine.hooks ?? {})) {
    if (!Array.isArray(valeur)) {
      inconnus.push(`${evenement} : entrée non reconnue`)
      continue
    }
    for (const groupe of groupesDe(valeur)) {
      for (const controle of controlesDe(groupe)) {
        const champsEnPlus = Object.keys(controle ?? {}).filter((cle) => !CHAMPS_CONNUS.has(cle))
        const npm = evenement === 'PreToolUse' && estGardeNpm(controle, entree.script)
        // La garde d'écriture est connue elle aussi ; seule la garde npm reste exigée pour lever
        // la relecture, comme avant qu'elle existe.
        const ecriture = evenement === 'PreToolUse' && estGardeEcriture(controle, entree.script)
        const connu =
          champsEnPlus.length === 0 &&
          (npm || ecriture || estDeConfiance(evenement, controle, deConfiance))
        if (connu && npm) garde = true
        if (!connu) {
          const quoi =
            typeof controle?.command === 'string'
              ? controle.command
              : `type ${String(controle?.type)}`
          inconnus.push(
            `${evenement} : ${quoi}${champsEnPlus.length ? ` (${champsEnPlus.join(', ')})` : ''}`
          )
        }
      }
    }
  }
  if (inconnus.length > 0) {
    return sans(
      `${entree.fichierHooks} contient un contrôle que l’app ne connaît pas — ${inconnus.join(' ; ')}`
    )
  }
  if (!garde) return sans(`la garde npm manque dans ${entree.fichierHooks}`)
  return { contourner: true }
}

function controlesDeProjet(
  cwd: string | undefined,
  dossierCodexPersonnel: string,
  existe: (chemin: string) => boolean
): string | undefined {
  let d = cwd ? resolve(cwd) : undefined
  for (let i = 0; d && i < 40; i++) {
    const dossier = join(d, '.codex')
    if (!memeCheminSurDisque(dossier, dossierCodexPersonnel)) {
      for (const nom of ['hooks.json', 'config.toml']) {
        if (existe(join(dossier, nom))) return join(dossier, nom)
      }
    }
    if (existe(join(d, '.git'))) return undefined
    const parent = dirname(d)
    if (parent === d) return undefined
    d = parent
  }
  return undefined
}

/** Installation sur ce poste, lancée à la main : les deux contrôles, avec le chemin donné. */
function principal(): void {
  const script = process.argv[2]
  if (!script || !isAbsolute(script) || !existsSync(script)) {
    process.stderr.write(
      'Usage : node hooks-des-cli.ts <chemin absolu de scripts/garde-npm-modules.mjs>\n'
    )
    process.exitCode = 2
    return
  }
  const grok = installerGardeNpmGrok(dossierHooksGrok(), script)
  const codex = installerGardeNpmCodex(fichierHooksCodex(), script)
  // La garde d'écriture, quand le dépôt la porte à côté de la garde npm.
  const ecriture = join(dirname(script), SCRIPT_GARDE_ECRITURE)
  const enPlus = existsSync(ecriture)
    ? {
        grokEcriture: installerGardeEcritureGrok(dossierHooksGrok(), ecriture),
        codexEcriture: installerGardeEcritureCodex(fichierHooksCodex(), ecriture)
      }
    : {}
  process.stdout.write(`${JSON.stringify({ grok, codex, ...enPlus })}\n`)
}

if (/hooks-des-cli\.ts$/i.test(process.argv[1] ?? '')) principal()
