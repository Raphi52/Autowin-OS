/**
 * QUESTION À CÔTÉ — le moteur (conv-1362, lot 1/3, 2026-10-31).
 *
 * Une question posée depuis un fil : elle voit tout ce que la session du fil contient déjà, elle marche
 * pendant qu'un tour tourne sans l'interrompre, et RIEN n'en est gardé (ni message, ni journal de tour,
 * ni Board, ni fichier de session). Modèle : `/btw` de Claude Code, section « Side questions » de
 * https://code.claude.com/docs/en/interactive-mode.md.
 *
 * LE PROCÉDÉ, mesuré par le fil chef le 2026-10-31 : `claude -p --resume <session> --fork-session
 * --no-session-persistence`. Le CLI reprend le fil dans une copie en mémoire ; la session d'origine
 * garde la même empreinte, aucun fichier n'apparaît (rejoué ici sur le CLI 2.1.314).
 *
 * LE CHOIX DES OUTILS, mesuré (conv-1365, 2026-10-31, CLI 2.1.314, session de 147 867 jetons, un vrai
 * tour enregistré juste avant, prix Opus 5.5 : lecture 0,50 $/M, écriture 1 h 10 $/M) :
 *
 *   appel                                   cache relu   cache écrit   coût par question
 *   outils du fil déclarés puis refusés        147 867            45   0,08 $
 *   `--tools ""`, cache des outils perdu        36 960        73 644   0,76 $
 *   `--tools ""`, tout premier appel                 0       110 457   1,10 $
 *
 * Sur le vrai fil chef du plan (conv-1362, 308 000 jetons, vrai serveur d'outils, ce module) : 305 942
 * relus, environ 1 900 écrits, 0,17 $ et 3 s par question. `--tools ""` n'y a pas été joué.
 *
 * Le cache de l'API commence par la définition des outils : `--tools ""` lui présente un autre début
 * et réécrit tout le fil, à CHAQUE question différente. Déclarer les mêmes outils que le tour revient
 * dix fois moins cher, et l'écart grandit avec le fil. On garde donc les outils du fil, et `--tools ""`
 * ne reste que le repli quand ils ne peuvent pas être déclarés.
 *
 * MAIS « DÉCLARÉ » N'EST PAS « REFUSÉ », et c'est la seule règle qui compte ici. Mesuré sur le même
 * banc : `--permission-mode dontAsk` laisse passer `Read` (le contenu du fichier est revenu), et
 * `--max-turns` ne fait que borner le nombre d'appels au modèle. Le refus vient donc d'un crochet
 * PreToolUse posé pour CET appel, sur TOUS les outils, en échec fermé (`onFailure: 'block'`). Mesuré
 * avec le vrai Bash : `Bash` et `Read` refusés avant de s'exécuter, fichier témoin non écrit, cache
 * toujours relu en entier. Le serveur d'outils directs ajoute une seconde barrière : il refuse tout
 * appel avant d'exécuter quoi que ce soit.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import { accountEnv, withClaudeAccountEnv, type ClaudeAccount } from './claude-accounts'
import { ouvrirOutilsNatifsDuChat, type OutilsNatifsDuChat } from './chat-mcp'
import type { CommandSpec } from './commands'
import {
  argumentsModsAutowin,
  binaireClaudeLancable,
  dossierModAutowin,
  ecrireConfigMcp,
  environnementAgent,
  OUTILS_TOUR_DE_CHAT,
  reglagesCliAutowin,
  resolveClaudeBin
} from './providers/claude'
import { loadChatSessions, type ChatSessionIndex } from './runs/chat-session-store'
import { AUTOWIN_WORKSPACE_ENV } from '../shared/app-identity'
import type { IssueQuestionACote, MotifSansReponse } from '../shared/question-a-cote'

/** Une question prend quelques secondes : au-delà de deux minutes, le CLI est tenu pour bloqué. */
export const DELAI_QUESTION_MS = 120_000

/**
 * Deux appels au plus : un outil tenté et refusé, puis la réponse. Sans cette borne, un modèle qui
 * insiste relancerait des appels payants ; la question reste « une question, une réponse ».
 */
const APPELS_MAX = '2'

/**
 * Consigne mise en tête de la question. Elle existe parce que le prompt système repris est celui du
 * fil, avec nos consignes de fin de tour : sans elle, la réponse porte un bloc de clôture et des lignes
 * `AUTOWIN_*` (mesuré : `AUTOWIN_BESOIN_V1: aucun` dans la première réponse du banc).
 */
export const CONSIGNE_QUESTION =
  'QUESTION À CÔTÉ, hors du fil : réponds brièvement, depuis ce que cette conversation contient déjà. ' +
  'Aucun outil, aucune commande, ils sont refusés. Pas de bloc de clôture, pas de ligne technique. ' +
  'Reprends le fil après cette réponse comme si cette question n’avait pas eu lieu.'

/** Compose ce que le CLI reçoit sur son entrée. */
export function messageDeQuestion(question: string): string {
  return `${CONSIGNE_QUESTION}\n\nQuestion : ${question.trim()}`
}

/** Retire les lignes techniques que le modèle écrit par habitude (`AUTOWIN_FIN_V1`, `AUTOWIN_PROMPT_V1: …`). */
export function nettoyerReponse(texte: string): string {
  return texte
    .split('\n')
    .filter((ligne) => !/^\s*AUTOWIN_[A-Z0-9_]*(?::|\s|$)/.test(ligne))
    .join('\n')
    .trim()
}

/** Le fil tel que la session l'a ouvert : c'est là, et seulement là, qu'elle se retrouve. */
export interface SessionDuFil {
  sessionId: string
  fournisseur: string
  /** Vide : le fil n'a pas de modèle imposé, le CLI prend son modèle par défaut. */
  modele: string
  /** Vide : compte par défaut, les clés d'avant les comptes n'en portent pas. */
  compte: string
  dossier: string
}

/**
 * Relit la clé de `chat-sessions.json`, écrite par `agent-pilot.ts` (`cleDeSession`) :
 * `<fournisseur>:<modèle>:<compte>:<dossier>:c<n>:w<n>`. Le dossier contient lui-même un `:` sous
 * Windows, d'où l'ancrage sur les deux compteurs de fin. Une clé plus ancienne, sans dossier ni
 * compteurs, reste lisible : elle ne donne que le fournisseur et le modèle.
 */
export function lireCleDeSession(cle: string): Omit<SessionDuFil, 'sessionId'> | undefined {
  const complete = /^([^:]*):([^:]*):([^:]*):(.*):c\d+(?::w\d+)?$/.exec(cle)
  if (complete) {
    const [, fournisseur, modele, compte, dossier] = complete
    return { fournisseur: fournisseur!, modele: modele!, compte: compte!, dossier: dossier! }
  }
  const [fournisseur, modele = ''] = cle.split(':')
  return fournisseur ? { fournisseur, modele, compte: '', dossier: '' } : undefined
}

/** Le nom que le CLI donne au dossier d'un projet sous `projects/`. */
function dossierDeProjet(dossier: string): string {
  return dossier.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Le compte qui garde ce fichier de session, s'il y en a un parmi les comptes connus. */
function compteQuiGarde(
  sessionId: string,
  dossier: string,
  comptes: readonly ClaudeAccount[]
): ClaudeAccount | undefined {
  return comptes.find((compte) =>
    existsSync(
      join(
        // Sans dossier propre, c'est le compte par défaut : `~/.claude`.
        compte.dir ?? join(homedir(), '.claude'),
        'projects',
        dossierDeProjet(dossier),
        `${sessionId}.jsonl`
      )
    )
  )
}

/**
 * LE PREMIER TOUR D'UN FIL, ENCORE EN COURS. `chat-sessions.json` n'est écrit qu'à la fin d'un envoi
 * (`agent-pilot.ts`, « Mémorise la session ») : sans ce repli, la question à côté dirait « pas de
 * session » pendant tout le premier tour, qui est justement le long tour pendant lequel on la pose.
 * La session existe pourtant déjà : le journal du tour nomme son journal de sortie, dont la première
 * ligne (`system/init`) donne la session, le modèle et le dossier.
 *
 * Un journal terminé (`.exit.json`) ne compte pas : le fil n'a plus de session si l'index l'a oubliée.
 */
export function sessionDuTourEnCours(
  conversationId: string,
  comptes: readonly ClaudeAccount[],
  racine: string = ensureAutowinAppData()
): SessionDuFil | undefined {
  try {
    const dossierTours = join(racine, 'turn-journals', conversationId)
    if (!existsSync(dossierTours)) return undefined
    const dernier = readdirSync(dossierTours)
      .filter((nom) => nom.endsWith('.jsonl'))
      .map((nom) => ({ nom, mtime: statSync(join(dossierTours, nom)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0]
    if (!dernier) return undefined
    const debut = readFileSync(join(dossierTours, dernier.nom), 'utf8').split('\n', 1)[0] ?? ''
    const entete = JSON.parse(debut) as { kind?: string; provider?: string; token?: string }
    if (entete.kind !== 'provider-journal' || entete.provider !== 'claude') return undefined
    if (!entete.token || !/^[0-9a-f-]{36}$/i.test(entete.token)) return undefined
    const journal = join(racine, 'run-stdout', `${entete.token}.stdout.jsonl`)
    if (!existsSync(journal) || existsSync(`${journal}.exit.json`)) return undefined
    const init = JSON.parse(readFileSync(journal, 'utf8').split('\n', 1)[0] ?? '') as {
      subtype?: string
      session_id?: string
      model?: string
      cwd?: string
    }
    if (init.subtype !== 'init' || !init.session_id || !init.cwd) return undefined
    return {
      sessionId: init.session_id,
      fournisseur: 'claude',
      modele: init.model ?? '',
      compte: compteQuiGarde(init.session_id, init.cwd, comptes)?.id ?? '',
      dossier: init.cwd
    }
  } catch {
    return undefined // un journal illisible vaut « pas de session » : le panneau le dit clairement
  }
}

/** Ce que l'appel ajoute à ce que le tour de chat passe déjà au CLI. */
export interface AppelQuestion {
  sessionId: string
  modele: string
  dossier: string
  /** Chemin de la config MCP du serveur d'outils ; absent = repli `--tools ""`. */
  configMcp?: string
  /** Dossier du mod Autowin : il change la description des outils, donc le cache. */
  modAutowin?: string
  argumentsMods?: readonly string[]
}

/**
 * Réglages de CET appel : ceux des tours du chat (mémoire, compaction, messages entre sessions), avec
 * les crochets REMPLACÉS par le seul refus total. Passés en JSON dans l'argument : aucun fichier.
 */
export function reglagesDeQuestion(): string {
  return JSON.stringify({
    ...reglagesCliAutowin(''),
    hooks: {
      PreToolUse: [
        {
          // `*` couvre les outils natifs ET les outils `mcp__…`.
          matcher: '*',
          hooks: [
            {
              type: 'command',
              // Sortie 2 : refus. `onFailure` ferme aussi le cas où `node` ne se lance pas.
              command:
                'node -e "console.error(\'Question à côté : aucun outil.\');process.exit(2)"',
              onFailure: 'block'
            }
          ]
        }
      ]
    }
  })
}

/**
 * Les arguments du CLI. Chaque drapeau qui touche au prompt est le MÊME que celui du tour de chat
 * (`providers/claude.ts`) : c'est ce qui fait relire le cache du fil.
 *
 * `--effort low` n'y touche pas (mesuré : 147 867 jetons relus aussi) et évite de payer une longue
 * réflexion pour une réponse d'une phrase.
 */
export function argumentsQuestion(appel: AppelQuestion): string[] {
  const outils = appel.configMcp
    ? [
        '--tools',
        OUTILS_TOUR_DE_CHAT,
        '--mcp-config',
        appel.configMcp,
        ...(appel.dossier ? ['--add-dir', appel.dossier] : []),
        '--permission-mode',
        'dontAsk'
      ]
    : ['--tools', '']
  return [
    '-p',
    '--output-format',
    'json',
    '--resume',
    appel.sessionId,
    '--fork-session',
    '--no-session-persistence',
    ...(appel.modele ? ['--model', appel.modele] : []),
    '--thinking-display',
    'summarized',
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--disable-slash-commands',
    ...(appel.argumentsMods ?? []),
    ...(appel.modAutowin ? ['--plugin-dir', appel.modAutowin] : []),
    ...outils,
    '--settings',
    reglagesDeQuestion(),
    '--max-turns',
    APPELS_MAX,
    '--effort',
    'low'
  ]
}

/** La dernière ligne utile de la sortie d'erreur du CLI : assez pour nommer la panne. */
function finDErreur(texte: string): string {
  return texte.trim().split('\n').slice(-2).join(' ').slice(0, 400)
}

const SANS_SESSION = /no conversation found/i

/** Traduit ce que le CLI a rendu. */
export function lireSortie(
  sortie: string,
  erreur: string,
  code: number | null
): IssueQuestionACote {
  let resultat:
    | {
        subtype?: string
        is_error?: boolean
        result?: string
        permission_denials?: unknown[]
      }
    | undefined
  try {
    resultat = JSON.parse(sortie) as typeof resultat
  } catch {
    resultat = undefined
  }
  const panne = `${resultat?.result ?? ''} ${erreur}`
  if (SANS_SESSION.test(panne) || SANS_SESSION.test(sortie)) {
    return { ok: false, motif: 'session-introuvable' }
  }
  if (resultat?.subtype === 'error_max_turns') return { ok: false, motif: 'outil-requis' }
  const reponse = nettoyerReponse(resultat?.result ?? '')
  if (!resultat || resultat.is_error || code !== 0 || !reponse) {
    return {
      ok: false,
      motif: 'echec',
      detail: finDErreur(erreur) || (resultat?.result ?? '').slice(0, 400) || `code ${code ?? '?'}`
    }
  }
  return {
    ok: true,
    reponse,
    outilRefuse: (resultat.permission_denials?.length ?? 0) > 0
  }
}

export interface DependancesQuestionACote {
  /** Le catalogue du bus : le même que celui du tour, sans quoi les outils directs diffèrent. */
  catalogue: () => readonly CommandSpec[]
  /** Les comptes connus : une session vit dans le dossier du compte qui l'a créée. */
  comptes: () => readonly ClaudeAccount[]
  // Injectables pour les tests : par défaut, le vrai CLI et les vrais fichiers.
  sessions?: () => ChatSessionIndex
  tourEnCours?: (conversationId: string) => SessionDuFil | undefined
  lancer?: (bin: string, args: string[], options: SpawnOptions) => ChildProcess
  ouvrirOutils?: typeof ouvrirOutilsNatifsDuChat
  binaire?: () => Promise<string>
  delaiMs?: number
}

/** Refus de la seconde barrière : le serveur d'outils n'exécute rien pour une question à côté. */
const refusOutil = async (): Promise<{ ok: false; error: string }> => ({
  ok: false,
  error: 'Question à côté : aucun outil, rien n’a été exécuté.'
})

/**
 * Les questions en cours, une par fil au plus. Aucun historique ici : les questions précédentes vivent
 * dans la mémoire de l'interface, et ce service ne garde rien une fois la réponse rendue.
 */
export class QuestionsACote {
  private readonly enCours = new Map<string, { annuler: () => void }>()

  constructor(private readonly deps: DependancesQuestionACote) {}

  /** Arrête la question de ce fil : SON processus, jamais par nom ni par famille. */
  annuler(conversationId: string): void {
    this.enCours.get(conversationId)?.annuler()
  }

  async poser(conversationId: string, question: string): Promise<IssueQuestionACote> {
    this.annuler(conversationId)
    const session = this.sessionDuFil(conversationId)
    if (!session) return { ok: false, motif: 'sans-session' }
    if (session.fournisseur !== 'claude') return { ok: false, motif: 'autre-modele' }
    const comptes = this.deps.comptes()
    const compte = session.compte ? comptes.find((c) => c.id === session.compte) : undefined
    if (session.compte && !compte) return { ok: false, motif: 'compte-absent' }

    let annulee = false
    let arreterProcessus: (() => void) | undefined
    const jeton = {
      annuler: (): void => {
        annulee = true
        arreterProcessus?.()
      }
    }
    this.enCours.set(conversationId, jeton)
    let outils: OutilsNatifsDuChat | undefined
    let configMcp: { chemin: string; nettoyer: () => Promise<void> } | undefined
    try {
      const issue = await (this.deps.ouvrirOutils ?? ouvrirOutilsNatifsDuChat)({
        provider: 'claude',
        catalogue: this.deps.catalogue(),
        exec: refusOutil
      })
      if ('servis' in issue) {
        outils = issue.servis
        // Le jeton du serveur passe par un fichier retiré juste après, jamais par la ligne de commande.
        configMcp = ecrireConfigMcp(outils.options.mcpConfig)
      }
      if (annulee) return { ok: false, motif: 'annulee' }
      const bin = await (this.deps.binaire ?? binaireParDefaut)()
      if (annulee) return { ok: false, motif: 'annulee' }
      const dossier = session.dossier || process.env[AUTOWIN_WORKSPACE_ENV] || undefined
      const args = argumentsQuestion({
        sessionId: session.sessionId,
        modele: session.modele,
        dossier: dossier ?? '',
        argumentsMods: argumentsModsAutowin(),
        ...(configMcp ? { configMcp: configMcp.chemin } : {}),
        ...modAutowinDuTour(dossier)
      })
      const env = environnementAgent({
        ...withClaudeAccountEnv(process.env, accountEnv(compte)),
        // Sans ça, un fil au bord de sa fenêtre paierait un résumé complet, jeté aussitôt.
        DISABLE_AUTO_COMPACT: '1'
      })
      return await this.executer(
        bin,
        args,
        { cwd: dossier, env, windowsHide: true, shell: false },
        messageDeQuestion(question),
        (arret) => {
          arreterProcessus = arret
        },
        () => annulee
      )
    } finally {
      if (this.enCours.get(conversationId) === jeton) this.enCours.delete(conversationId)
      await configMcp?.nettoyer()
      await outils?.arreter()
    }
  }

  private sessionDuFil(conversationId: string): SessionDuFil | undefined {
    const trouvee = (this.deps.sessions ?? loadChatSessions)()[conversationId]
    if (trouvee) {
      const lue = lireCleDeSession(trouvee.key)
      return lue ? { ...lue, sessionId: trouvee.sessionId } : undefined
    }
    const tour =
      this.deps.tourEnCours ??
      ((id): SessionDuFil | undefined => sessionDuTourEnCours(id, this.deps.comptes()))
    return tour(conversationId)
  }

  private executer(
    bin: string,
    args: string[],
    options: SpawnOptions,
    message: string,
    poserArret: (arret: () => void) => void,
    estAnnulee: () => boolean
  ): Promise<IssueQuestionACote> {
    return new Promise((rendre) => {
      const enfant = (this.deps.lancer ?? spawn)(bin, args, options)
      let sortie = ''
      let erreur = ''
      let delaiEcoule = false
      const arreter = (): void => {
        enfant.kill()
      }
      poserArret(arreter)
      const minuteur = setTimeout(() => {
        delaiEcoule = true
        arreter()
      }, this.deps.delaiMs ?? DELAI_QUESTION_MS)
      const finir = (issue: IssueQuestionACote): void => {
        clearTimeout(minuteur)
        rendre(issue)
      }
      const sansReponse = (motif: MotifSansReponse, detail?: string): void =>
        finir({ ok: false, motif, ...(detail ? { detail } : {}) })
      enfant.stdout?.on('data', (morceau: Buffer) => (sortie += morceau.toString('utf8')))
      enfant.stderr?.on('data', (morceau: Buffer) => (erreur += morceau.toString('utf8')))
      // Un CLI mort avant d'avoir lu son message fait lever `EPIPE` ici : sa sortie en échec le dit.
      enfant.stdin?.on('error', () => undefined)
      enfant.stdin?.end(message)
      enfant.once('error', (e) => sansReponse('echec', e.message))
      enfant.once('close', (code) => {
        if (estAnnulee()) return sansReponse('annulee')
        if (delaiEcoule) return sansReponse('delai')
        finir(lireSortie(sortie, erreur, code))
      })
    })
  }
}

async function binaireParDefaut(): Promise<string> {
  const bin = resolveClaudeBin()
  return binaireClaudeLancable(bin, { designe: Boolean(process.env.CLAUDE_BIN) })
}

/** Le mod Autowin chargé par le tour : même recherche que `providers/claude.ts`. */
function modAutowinDuTour(dossier: string | undefined): { modAutowin?: string } {
  const mod = dossierModAutowin([
    typeof __dirname === 'string' ? __dirname : undefined,
    process.env[AUTOWIN_WORKSPACE_ENV],
    dossier,
    process.cwd()
  ])
  return mod ? { modAutowin: mod } : {}
}
