import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

/**
 * La passerelle Outlook LOCALE, côté process principal.
 *
 * Elle lance `scripts/outlook-local-snapshot.ps1`, qui lit le profil Outlook de la machine par
 * automation COM, et rend son instantané. Rien ne sort du poste : aucune requête réseau, aucun jeton,
 * aucune adresse envoyée où que ce soit. C'est la raison pour laquelle l'utilisateur a écarté
 * Microsoft Graph.
 *
 * Trois décisions structurent ce fichier, chacune adossée à une mesure de ce poste :
 *  - le script écrit son JSON dans un FICHIER, jamais sur la sortie standard : celle de PowerShell
 *    est rendue en cp1252 ici, et un accent y est perdu avant même d'arriver à Node ;
 *  - un ÉCHEC est une valeur, pas une exception muette : « Outlook fermé » et « lecture impossible »
 *    doivent atteindre l'écran, sinon une liste vide se lit comme « vous n'avez pas de mail » ;
 *  - un CACHE court, parce qu'un appel COM démarre un dialogue avec une application lourde et que la
 *    page d'accueil se rafraîchit périodiquement.
 */

export interface OutlookGatewayResult {
  ok: boolean
  [key: string]: unknown
}

export interface OutlookOpenResult {
  ok: boolean
  erreur?: string
}

export interface OutlookReplyResult {
  ok: boolean
  erreur?: string
}

export interface OutlookMarkReadResult {
  ok: boolean
  erreur?: string
}

export interface OutlookNewMessageResult {
  ok: boolean
  erreur?: string
}

/** Plafond du corps d'une reponse. Assez pour un message, assez peu pour rester un widget. */
const MAX_CORPS = 20_000
/** Plafond de l'OBJET d'un message neuf. Au-dela, aucune messagerie n'en montre la fin. */
const MAX_OBJET = 255
/**
 * Plafonds des PIECES JOINTES d'un message neuf. Demande de l'utilisateur du 2026-09-08 : glisser
 * un PDF dans l'ecran « nouveau message ». Memes ordres de grandeur que le compositeur du chat,
 * pour que l'utilisateur n'ait pas deux regles a retenir selon l'endroit ou il lache son fichier.
 */
const MAX_PIECES = 5
const MAX_PIECE_OCTETS = 10 * 1024 * 1024
const MAX_PIECES_OCTETS = 20 * 1024 * 1024
/**
 * Ce qu'un nom de pièce jointe n'a PAS le droit de contenir.
 *
 * Ce nom vient du renderer par IPC et il sert à NOMMER un fichier écrit sur le disque, parce que
 * `Attachments.Add` prend le nom du fichier pour nom de pièce. Un séparateur de chemin (`/` ou
 * `\`), un deux-points ou un caractère interdit par Windows écrirait donc ailleurs que dans le
 * dossier temporaire, ou ne s'écrirait pas du tout.
 */
const NOM_PIECE_INTERDIT = /[\\/:*?"<>|]/
/**
 * Le nom d'une pièce jointe est-il utilisable comme nom de fichier ?
 *
 * Les caractères de CONTRÔLE sont écartés par leur code et non par le motif ci-dessus : un motif
 * qui les contient est illisible, et la règle `no-control-regex` le refuse — à raison.
 */
function nomPieceAcceptable(nom: string): boolean {
  if (nom === '' || nom === '.' || nom === '..' || nom.length > 150) return false
  if (NOM_PIECE_INTERDIT.test(nom)) return false
  for (const caractere of nom) {
    const code = caractere.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

/** Du base64 canonique, et rien d'autre : un contenu abime ecrirait un fichier corrompu. */
const BASE64_STRICT = /^[A-Za-z0-9+/]*={0,2}$/
/** Le refus, en une phrase qui dit quoi regarder : le NOM du fichier, pas son contenu. */
const PIECE_NOM_REFUSE =
  'Le nom d’une pièce jointe n’est pas utilisable comme nom de fichier : le message n’est pas parti.'
/**
 * La forme d'une adresse acceptée pour un message NEUF.
 *
 * Un envoi neuf n'a pas d'élément de départ : l'adresse du destinataire est FOURNIE, elle ne se
 * déduit d'aucun message existant. C'est le seul endroit de cette passerelle où l'utilisateur nomme
 * lui-même à qui l'on écrit — donc le seul où une faute de frappe envoie un message chez un
 * inconnu, et où une chaîne libre partirait dans un appel COM. Le motif est ASCII strict, et le
 * script le re-vérifie : une frontière de confiance ne se garde pas d'un seul côté.
 */
const ADRESSE_SMTP = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/

export interface OutlookGatewayOptions {
  /** Racine du dépôt / de l'application, d'où le script est résolu. */
  appRoot: string
  /** Durée de vie du cache. Un appel plus rapproché rend l'instantané déjà lu. */
  ttlMs?: number
  /** Injection pour les tests : évite de dépendre d'un Outlook installé. */
  runner?: (scriptPath: string, outPath: string) => Promise<void>
  /** Idem pour l'ouverture d'un élément. Rend le code de sortie du script. */
  opener?: (scriptPath: string, id: string) => Promise<number>
  /**
   * Idem pour la RÉPONSE. Le corps est passé par un fichier, pas en argument. La LISTE des pièces
   * jointes aussi, et `piecesPath` est absent quand la réponse n'en a aucune.
   */
  replier?: (
    scriptPath: string,
    id: string,
    corpsPath: string,
    piecesPath?: string
  ) => Promise<number>
  /** Idem pour le MARQUAGE LU. Les identifiants passent par un fichier, un par ligne. */
  marqueur?: (scriptPath: string, idsPath: string) => Promise<number>
  /** Idem pour la lecture du texte ENTIER d'un seul message. Le script écrit son JSON dans `outPath`. */
  lecteurCorps?: (scriptPath: string, id: string, outPath: string, max: number) => Promise<void>
  /**
   * Idem pour un message NEUF. Objet, corps et LISTE DE PIECES JOINTES passent par des fichiers,
   * pas en arguments. `piecesPath` est absent quand le message n'a aucune piece.
   */
  redacteur?: (
    scriptPath: string,
    adresse: string,
    objetPath: string,
    corpsPath: string,
    piecesPath?: string
  ) => Promise<number>
  now?: () => number
}

const DEFAULT_TTL_MS = 60_000
/** Au-delà, on considère qu'Outlook ne répondra pas : il vaut mieux une erreur nommée qu'une attente. */
const TIMEOUT_MS = 45_000

function defaultRunner(scriptPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        // La politique d'exécution de la machine ne doit pas décider si l'app peut lire la boîte :
        // le script est livré AVEC l'application, il n'est pas téléchargé.
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Out',
        outPath
      ],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error) => {
        // Le code de sortie 1 est un ÉCHEC ÉCRIT par le script : le fichier contient alors sa cause,
        // qui est plus précise que le message d'`execFile`. On laisse donc la lecture décider.
        if (error && (error as { code?: number }).code !== 1) reject(error)
        else resolve()
      }
    )
  })
}

function defaultLecteurCorps(
  scriptPath: string,
  id: string,
  outPath: string,
  max: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Id',
        id,
        '-Out',
        outPath,
        '-MaxCorps',
        String(max)
      ],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error) => {
        // Comme la lecture : un code non nul ECRIT sa cause dans le fichier, qui la dit mieux
        // qu'`execFile`. Seule une panne sans fichier (script tue, introuvable) remonte telle quelle.
        if (error && typeof (error as { code?: unknown }).code !== 'number') reject(error)
        else resolve()
      }
    )
  })
}

/**
 * Codes de sortie du script d'ouverture, traduits en phrases.
 *
 * Ils sont explicites côté script pour que la cause survive au passage de frontière : un code de
 * sortie nu ne dirait pas la différence entre « cet identifiant n'a pas la bonne forme » et « cet
 * élément a été supprimé entre-temps », et ces deux-là appellent des réactions opposées.
 */
const OPEN_FAILURES: Readonly<Record<number, string>> = {
  1: "Outlook n'a pas pu ouvrir cet élément.",
  2: "Cet identifiant n'a pas la forme d'un élément Outlook.",
  3: 'Cet élément n’existe plus dans Outlook — il a peut-être été supprimé ou déplacé.'
}

/**
 * Codes de sortie du script de réponse, traduits en phrases.
 *
 * Un envoi est IRRÉVERSIBLE : la différence entre « le message a été envoyé » et « Outlook l'a
 * refusé » ne doit jamais se perdre en route, sinon l'utilisateur renvoie deux fois — ou croit avoir
 * répondu alors que rien n'est parti.
 */
const REPLY_FAILURES: Readonly<Record<number, string>> = {
  1: "Outlook n'a pas pu envoyer cette réponse.",
  2: "Cet identifiant n'a pas la forme d'un élément Outlook.",
  3: 'Ce message n’existe plus dans Outlook — il a peut-être été supprimé ou déplacé.',
  4: 'La réponse est vide : rien n’a été envoyé.',
  7: 'Outlook a refusé une pièce jointe : la réponse n’est pas partie.'
}

/**
 * Codes de sortie du script de marquage lu, traduits en phrases.
 *
 * Marquer lu ÉCRIT dans la boîte réelle. Un échec doit donc se voir : sinon la pastille reste, on
 * la croit cassée, et personne ne sait que c'est Outlook qui a refusé.
 */
const MARK_FAILURES: Readonly<Record<number, string>> = {
  1: "Outlook n'a pas pu marquer ces messages comme lus.",
  2: "Aucun de ces messages n'a la forme d'un élément Outlook.",
  3: 'Ces messages n’existent plus dans Outlook — ils ont peut-être été supprimés ou déplacés.'
}

/**
 * Codes de sortie du script de message NEUF, traduits en phrases.
 *
 * Le code 6 est propre à ce chemin : une réponse hérite du destinataire de l'élément d'origine,
 * un message neuf le reçoit d'une saisie. « Outlook ne sait pas à qui remettre cette adresse » est
 * donc l'échec le plus probable ici, et c'est le seul que l'utilisateur peut corriger lui-même.
 */
const NEW_FAILURES: Readonly<Record<number, string>> = {
  1: "Outlook n'a pas pu envoyer ce message.",
  2: "Cette adresse n'a pas la forme d'une adresse e-mail.",
  3: 'Le message n’a pas pu être préparé sur le disque.',
  4: 'Le message est vide : rien n’a été envoyé.',
  5: 'L’objet est vide : rien n’a été envoyé.',
  6: 'Outlook ne reconnaît pas cette adresse — vérifiez-la avant de renvoyer.',
  7: 'Outlook a refusé une pièce jointe : le message n’est pas parti.'
}

/**
 * Une pièce jointe VÉRIFIÉE, prête à être écrite sur le disque pour qu'Outlook l'attache.
 *
 * Le renderer envoie le CONTENU du fichier, pas son chemin : un fichier glissé depuis Outlook ou
 * depuis une archive n'existe pas sur le disque, et Electron ne rend plus `File.path`. Les octets
 * redeviennent donc un fichier ICI.
 */
interface PieceJointeVerifiee {
  nom: string
  octets: Buffer
}

/**
 * Rend les pièces jointes prêtes à écrire, ou la PHRASE qui dit pourquoi rien ne partira.
 *
 * Ce qui arrive vient du renderer par IPC : le nom servira à NOMMER un fichier sur le disque et le
 * contenu à le remplir. Tout est donc revérifié ici, comme l'adresse — une frontière de confiance ne
 * se garde pas d'un seul côté.
 *
 * Une pièce refusée ANNULE l'envoi, elle ne le laisse pas partir sans elle : un envoi est
 * irréversible, et un message parti sans son devis se lit comme un message envoyé.
 */
function verifierPieces(pieces: unknown): { pieces: PieceJointeVerifiee[] } | { erreur: string } {
  if (pieces === undefined || pieces === null) return { pieces: [] }
  if (!Array.isArray(pieces)) {
    return {
      erreur: 'Les pièces jointes n’ont pas la forme attendue : le message n’est pas parti.'
    }
  }
  if (pieces.length > MAX_PIECES) {
    return { erreur: `Pas plus de ${MAX_PIECES} pièces jointes par message.` }
  }
  const pretes: PieceJointeVerifiee[] = []
  let total = 0
  for (const brute of pieces) {
    const piece = (brute ?? {}) as { nom?: unknown; contenuBase64?: unknown }
    const nom = typeof piece.nom === 'string' ? piece.nom.trim() : ''
    if (!nomPieceAcceptable(nom)) return { erreur: PIECE_NOM_REFUSE }
    const base64 = typeof piece.contenuBase64 === 'string' ? piece.contenuBase64 : ''
    if (base64 === '' || !BASE64_STRICT.test(base64)) {
      return { erreur: `« ${nom} » n’a pas pu être lu : le message n’est pas parti.` }
    }
    const octets = Buffer.from(base64, 'base64')
    if (octets.length > MAX_PIECE_OCTETS) {
      return { erreur: `« ${nom} » dépasse la limite de 10 Mo : le message n’est pas parti.` }
    }
    total += octets.length
    pretes.push({ nom, octets })
  }
  if (total > MAX_PIECES_OCTETS) {
    return { erreur: 'Le total des pièces jointes dépasse 20 Mo : le message n’est pas parti.' }
  }
  return { pieces: pretes }
}

function defaultRedacteur(
  scriptPath: string,
  adresse: string,
  objetPath: string,
  corpsPath: string,
  piecesPath?: string
): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-A',
        adresse,
        '-ObjetFichier',
        objetPath,
        '-CorpsFichier',
        corpsPath,
        // Le parametre n'est POSE que s'il y a des pieces : un message sans piece part exactement
        // comme avant, et le script n'a pas de fichier vide a interpreter.
        ...(piecesPath ? ['-PiecesFichier', piecesPath] : [])
      ],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 },
      (error) => {
        const code = (error as { code?: number } | null)?.code
        resolve(typeof code === 'number' ? code : error ? 1 : 0)
      }
    )
  })
}

function defaultMarqueur(scriptPath: string, idsPath: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-IdsFichier', idsPath],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 },
      (error) => {
        const code = (error as { code?: number } | null)?.code
        resolve(typeof code === 'number' ? code : error ? 1 : 0)
      }
    )
  })
}

function defaultReplier(
  scriptPath: string,
  id: string,
  corpsPath: string,
  piecesPath?: string
): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Id',
        id,
        '-CorpsFichier',
        corpsPath,
        // Le paramètre n'est POSÉ que s'il y a des pièces : une réponse sans pièce part exactement
        // comme avant, et le script n'a pas de fichier vide à interpréter.
        ...(piecesPath ? ['-PiecesFichier', piecesPath] : [])
      ],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 },
      (error) => {
        const code = (error as { code?: number } | null)?.code
        resolve(typeof code === 'number' ? code : error ? 1 : 0)
      }
    )
  })
}

function defaultOpener(scriptPath: string, id: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Id', id],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 },
      (error) => {
        // Le code de sortie porte la cause : c'est lui qu'on veut, pas le message d'`execFile`.
        const code = (error as { code?: number } | null)?.code
        resolve(typeof code === 'number' ? code : error ? 1 : 0)
      }
    )
  })
}

export class OutlookLocalGateway {
  private readonly appRoot: string
  private readonly ttlMs: number
  private readonly runner: (scriptPath: string, outPath: string) => Promise<void>
  private readonly opener: (scriptPath: string, id: string) => Promise<number>
  private readonly replier: (
    scriptPath: string,
    id: string,
    corpsPath: string,
    piecesPath?: string
  ) => Promise<number>
  private readonly marqueur: (scriptPath: string, idsPath: string) => Promise<number>
  private readonly lecteurCorps: (
    scriptPath: string,
    id: string,
    outPath: string,
    max: number
  ) => Promise<void>
  private readonly redacteur: (
    scriptPath: string,
    adresse: string,
    objetPath: string,
    corpsPath: string,
    piecesPath?: string
  ) => Promise<number>
  private readonly now: () => number
  private cache: { at: number; result: OutlookGatewayResult } | null = null
  /** Lecture en cours : deux widgets qui interrogent en même temps ne doivent lancer QU'UN script. */
  private pending: Promise<OutlookGatewayResult> | null = null

  constructor(options: OutlookGatewayOptions) {
    this.appRoot = options.appRoot
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.runner = options.runner ?? defaultRunner
    this.opener = options.opener ?? defaultOpener
    this.replier = options.replier ?? defaultReplier
    this.marqueur = options.marqueur ?? defaultMarqueur
    this.lecteurCorps = options.lecteurCorps ?? defaultLecteurCorps
    this.redacteur = options.redacteur ?? defaultRedacteur
    this.now = options.now ?? (() => Date.now())
  }

  /** L'instantané, depuis le cache s'il est encore frais. */
  async snapshot(force = false): Promise<OutlookGatewayResult> {
    if (!force && this.cache && this.now() - this.cache.at < this.ttlMs) {
      return this.cache.result
    }
    if (this.pending) return this.pending
    this.pending = this.read()
      .then((result) => {
        // Seul un succès est mis en cache : garder une panne pendant une minute empêcherait de voir
        // qu'Outlook vient d'être ouvert.
        if (result.ok) this.cache = { at: this.now(), result }
        return result
      })
      .finally(() => {
        this.pending = null
      })
    return this.pending
  }

  private async read(): Promise<OutlookGatewayResult> {
    const scriptPath = resolveOutlookScriptPath(this.appRoot)
    let dossier: string | null = null
    try {
      dossier = await mkdtemp(join(tmpdir(), 'autowin-outlook-'))
      const outPath = join(dossier, 'snapshot.json')
      await this.runner(scriptPath, outPath)
      // Lu en UTF-8 explicitement : c'est l'encodage que le script écrit, et le défaut de la
      // plate-forme ne doit pas s'en mêler.
      const brut = await readFile(outPath, 'utf8')
      const parsed = JSON.parse(brut) as OutlookGatewayResult
      if (typeof parsed !== 'object' || parsed === null) {
        return { ok: false, erreur: 'la passerelle Outlook a rendu une réponse illisible' }
      }
      return parsed
    } catch (error) {
      return { ok: false, erreur: describeFailure(error) }
    } finally {
      if (dossier) await rm(dossier, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Le texte ENTIER d'un seul message (lecture seule), borné à `max` caractères.
   *
   * L'instantané coupe chaque corps à 800 caractères pour la tuile d'accueil — 54 mails sur 80 l'étaient,
   * mesure du 2026-09-26 —, et la règle « Assistant mails » ne donnait donc à l'agent que le début du
   * mail auquel il répond. Ce chemin relit CE SEUL message, sans toucher l'instantané ni son cache.
   * fix-ok: MaxCorps=800 (outlook-local-snapshot.ps1) coupait 54 mails sur 80 ; relus par ce chemin sur la vraie boîte le 2026-09-26 : 4008, 1007 et 1598 caractères, chacun commençant par l'aperçu.
   */
  async readBody(
    id: unknown,
    max = 8_000
  ): Promise<{ ok: true; corps: string } | { ok: false; erreur: string }> {
    if (typeof id !== 'string' || !/^[0-9A-Fa-f]{16,512}$/.test(id)) {
      return { ok: false, erreur: OPEN_FAILURES[2] }
    }
    let dossier: string | null = null
    try {
      dossier = await mkdtemp(join(tmpdir(), 'autowin-outlook-corps-'))
      const outPath = join(dossier, 'corps.json')
      await this.lecteurCorps(this.scriptVoisin('outlook-local-corps.ps1'), id, outPath, max)
      const parsed = JSON.parse(await readFile(outPath, 'utf8')) as {
        ok?: unknown
        corps?: unknown
        erreur?: unknown
      }
      if (parsed?.ok === true && typeof parsed.corps === 'string')
        return { ok: true, corps: parsed.corps }
      return {
        ok: false,
        erreur:
          typeof parsed?.erreur === 'string' ? parsed.erreur : "Outlook n'a pas rendu ce message."
      }
    } catch (error) {
      return { ok: false, erreur: describeFailure(error) }
    } finally {
      // Le texte d'un mail ne traîne pas dans le dossier temporaire une fois lu.
      if (dossier) await rm(dossier, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Ouvre un élément dans Outlook.
   *
   * Passe par un script SÉPARÉ de la lecture. Lire n'est pas agir : mélanger les deux dans le même
   * script aurait dilué la garantie « lecture seule » que porte la passerelle, alors que c'est elle
   * qui rend l'intégration acceptable. Ouvrir une fenêtre ne modifie rien dans la boîte.
   */
  async openItem(id: unknown): Promise<OutlookOpenResult> {
    // La validation est ici AUSSI, et pas seulement dans le script : cet identifiant vient du
    // renderer par IPC, et une frontière de confiance ne se garde pas d'un seul côté.
    if (typeof id !== 'string' || !/^[0-9A-Fa-f]{16,512}$/.test(id)) {
      return { ok: false, erreur: OPEN_FAILURES[2] }
    }
    try {
      const code = await this.opener(this.scriptVoisin('outlook-local-open.ps1'), id)
      if (code === 0) return { ok: true }
      return { ok: false, erreur: OPEN_FAILURES[code] ?? OPEN_FAILURES[1] }
    } catch (error) {
      return { ok: false, erreur: describeFailure(error) }
    }
  }

  /**
   * RÉPOND à un message, et l'envoie.
   *
   * Le seul chemin de ce fichier qui ÉCRIT quelque part. Il vit dans un script à part
   * (`outlook-local-reply.ps1`) pour la même raison que l'ouverture : la garantie « lecture seule »
   * du script d'instantané doit rester vérifiable en le lisant, sans avoir à suivre une branche.
   *
   * Le corps passe par un FICHIER en UTF-8 et non par la ligne de commande. Deux raisons mesurées sur
   * ce poste : l'encodage de la console est cp1252, donc un accent en argument arrive abîmé ; et un
   * texte libre concaténé dans une ligne de commande est une porte ouverte, alors qu'un fichier n'est
   * jamais interprété.
   *
   * Et depuis le 2026-09-09, sur demande de l'utilisateur (« ça marche bien pour les nouveaux fils
   * de message, il faudrait aussi que ça marche pour les messages de réponse »), ce chemin porte
   * aussi des PIÈCES JOINTES — exactement comme `sendNew` depuis la veille, et par le même
   * mécanisme : elles arrivent en CONTENU et non en chemin (un fichier glissé depuis Outlook
   * n'existe pas sur le disque, et Electron ne rend plus `File.path`), les octets redeviennent des
   * fichiers ici, chacun dans son propre sous-dossier pour que son NOM reste celui que verra le
   * destinataire, et la LISTE des chemins voyage par un fichier UTF-8 comme le corps.
   */
  async replyToItem(id: unknown, corps: unknown, pieces?: unknown): Promise<OutlookReplyResult> {
    if (typeof id !== 'string' || !/^[0-9A-Fa-f]{16,512}$/.test(id)) {
      return { ok: false, erreur: REPLY_FAILURES[2] }
    }
    // Un envoi ne se DEVINE pas : un corps vide ne devient pas un message vide, il devient un refus.
    const texte = typeof corps === 'string' ? corps.trim() : ''
    if (texte === '') return { ok: false, erreur: REPLY_FAILURES[4] }
    if (texte.length > MAX_CORPS) {
      return { ok: false, erreur: `La réponse dépasse ${MAX_CORPS} caractères.` }
    }
    // Les pièces jointes sont vérifiées AVANT d'ouvrir un dossier temporaire : un refus ne doit pas
    // laisser d'octets derrière lui, et il annule l'envoi entier.
    const verifiees = verifierPieces(pieces)
    if ('erreur' in verifiees) return { ok: false, erreur: verifiees.erreur }
    let dossier: string | null = null
    try {
      dossier = await mkdtemp(join(tmpdir(), 'autowin-outlook-reply-'))
      const corpsPath = join(dossier, 'corps.txt')
      await writeFile(corpsPath, texte, 'utf8')
      const piecesPath = await this.ecrirePieces(dossier, verifiees.pieces)
      const code = await this.replier(
        this.scriptVoisin('outlook-local-reply.ps1'),
        id,
        corpsPath,
        piecesPath
      )
      if (code === 0) return { ok: true }
      return { ok: false, erreur: REPLY_FAILURES[code] ?? REPLY_FAILURES[1] }
    } catch (error) {
      return { ok: false, erreur: describeFailure(error) }
    } finally {
      // Le texte d'un message ne traîne pas dans le dossier temporaire une fois parti.
      if (dossier) await rm(dossier, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * MARQUE des messages comme LUS dans Outlook.
   *
   * Le défaut corrigé, relevé par l'utilisateur le 2026-09-04 : « la notif reste même après avoir lu
   * le message ». Lire dans le widget ne touchait rien dans la boîte, donc l'instantané suivant
   * rendait toujours `nonLu: true` et la pastille ne partait jamais — sauf en ouvrant Outlook.
   *
   * Deux propriétés dont dépend l'effet visible :
   *  - les identifiants voyagent par un FICHIER, un par ligne : un fil peut en compter des dizaines,
   *    chacun jusqu'à 512 caractères, et une ligne de commande a une longueur maximale ;
   *  - un succès VIDE le cache. Sans cela, l'écran continuerait d'afficher l'instantané d'avant le
   *    marquage pendant toute sa durée de vie, et le correctif ne se verrait pas.
   */
  async markRead(ids: unknown): Promise<OutlookMarkReadResult> {
    // Filtré et non refusé en bloc : un seul identifiant abîmé ne doit pas empêcher de marquer les
    // autres messages du fil. La validation est ici AUSSI, pas seulement dans le script — ces
    // identifiants viennent du renderer par IPC.
    const valides = (Array.isArray(ids) ? ids : []).filter(
      (id): id is string => typeof id === 'string' && /^[0-9A-Fa-f]{16,512}$/.test(id)
    )
    if (valides.length === 0) return { ok: false, erreur: MARK_FAILURES[2] }
    let dossier: string | null = null
    try {
      dossier = await mkdtemp(join(tmpdir(), 'autowin-outlook-lu-'))
      const idsPath = join(dossier, 'ids.txt')
      await writeFile(idsPath, valides.join('\n'), 'utf8')
      const code = await this.marqueur(this.scriptVoisin('outlook-local-marquer-lu.ps1'), idsPath)
      if (code !== 0) return { ok: false, erreur: MARK_FAILURES[code] ?? MARK_FAILURES[1] }
      // L'instantané en cache décrit une boîte qui n'existe plus : ces messages viennent de passer
      // en lu. On l'oublie, la prochaine lecture rendra l'état réel.
      this.invalidate()
      return { ok: true }
    } catch (error) {
      return { ok: false, erreur: describeFailure(error) }
    } finally {
      if (dossier) await rm(dossier, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * ENVOIE un message NEUF : une adresse, un objet, un premier message.
   *
   * Demande de l'utilisateur du 2026-09-07 : depuis l'écran d'un interlocuteur, ouvrir une
   * conversation qui n'existe pas encore. `replyToItem` ne pouvait pas le faire — il part d'un
   * élément existant, dont Outlook tire le destinataire et l'objet « RE: … ». Ici il n'y a aucun
   * élément de départ : tout vient de la saisie, donc tout est validé.
   *
   * Trois choses que ce chemin ne partage pas avec la réponse :
   *  - l'ADRESSE est fournie, pas héritée : elle est contrainte à un motif ASCII strict des deux
   *    côtés, parce qu'une faute de frappe écrit à un inconnu et qu'une chaîne libre part dans COM ;
   *  - l'OBJET voyage par un fichier UTF-8 comme le corps (console en cp1252, texte interprétable) ;
   *  - un succès VIDE le cache. Le message part dans les éléments envoyés, donc il APPARTIENT au fil
   *    que la tuile affiche : sans cela, la nouvelle conversation resterait invisible jusqu'à
   *    l'expiration du cache, et le clic paraîtrait sans effet.
   *
   * Et depuis le 2026-09-08, sur demande de l'utilisateur (« glisser déposer des fichiers, par
   * exemple des pdf »), ce chemin porte aussi des PIÈCES JOINTES. Elles arrivent en CONTENU, pas en
   * chemin : un fichier glissé depuis Outlook n'existe pas sur le disque, et Electron ne rend plus
   * `File.path`. Les octets redeviennent donc des fichiers ici, chacun dans son propre sous-dossier
   * pour que son NOM reste celui que verra le destinataire — `Attachments.Add` prend le nom du
   * fichier. Et la LISTE des chemins voyage par un fichier UTF-8, comme l'objet et le corps.
   */
  async sendNew(
    adresse: unknown,
    objet: unknown,
    corps: unknown,
    pieces?: unknown
  ): Promise<OutlookNewMessageResult> {
    if (typeof adresse !== 'string' || !ADRESSE_SMTP.test(adresse.trim())) {
      return { ok: false, erreur: NEW_FAILURES[2] }
    }
    // L'objet tient sur UNE ligne : un retour chariot dans un en-tête de courrier n'a pas de sens,
    // et le laisser passer permettrait d'écrire une ligne d'en-tête de plus.
    const sujet = typeof objet === 'string' ? objet.replace(/[\r\n]+/g, ' ').trim() : ''
    if (sujet === '') return { ok: false, erreur: NEW_FAILURES[5] }
    if (sujet.length > MAX_OBJET) {
      return { ok: false, erreur: `L’objet dépasse ${MAX_OBJET} caractères.` }
    }
    // Un envoi ne se DEVINE pas : un corps vide ne devient pas un message vide, il devient un refus.
    const texte = typeof corps === 'string' ? corps.trim() : ''
    if (texte === '') return { ok: false, erreur: NEW_FAILURES[4] }
    if (texte.length > MAX_CORPS) {
      return { ok: false, erreur: `Le message dépasse ${MAX_CORPS} caractères.` }
    }
    // Les pièces jointes sont vérifiées AVANT d'ouvrir un dossier temporaire : un refus ne doit pas
    // laisser d'octets derrière lui, et il annule l'envoi entier.
    const verifiees = verifierPieces(pieces)
    if ('erreur' in verifiees) return { ok: false, erreur: verifiees.erreur }
    let dossier: string | null = null
    try {
      dossier = await mkdtemp(join(tmpdir(), 'autowin-outlook-nouveau-'))
      const objetPath = join(dossier, 'objet.txt')
      const corpsPath = join(dossier, 'corps.txt')
      await writeFile(objetPath, sujet, 'utf8')
      await writeFile(corpsPath, texte, 'utf8')
      const piecesPath = await this.ecrirePieces(dossier, verifiees.pieces)
      const code = await this.redacteur(
        this.scriptVoisin('outlook-local-nouveau.ps1'),
        adresse.trim(),
        objetPath,
        corpsPath,
        piecesPath
      )
      if (code !== 0) return { ok: false, erreur: NEW_FAILURES[code] ?? NEW_FAILURES[1] }
      this.invalidate()
      return { ok: true }
    } catch (error) {
      return { ok: false, erreur: describeFailure(error) }
    } finally {
      // Le texte d'un message ne traîne pas dans le dossier temporaire une fois parti.
      if (dossier) await rm(dossier, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Écrit les pièces jointes sur le disque et rend le chemin du fichier qui les LISTE.
   *
   * Chaque pièce va dans SON sous-dossier, sous son vrai nom : `Attachments.Add` prend le nom du
   * fichier pour nom de pièce, donc renommer pour éviter une collision renommerait ce que le
   * destinataire voit. Deux pièces homonymes restent ainsi distinctes.
   *
   * Rend `undefined` quand il n'y a aucune pièce : le script ne reçoit alors pas le paramètre, et un
   * message sans pièce part exactement comme avant.
   */
  private async ecrirePieces(
    dossier: string,
    pieces: readonly PieceJointeVerifiee[]
  ): Promise<string | undefined> {
    if (pieces.length === 0) return undefined
    const chemins: string[] = []
    for (const [index, piece] of pieces.entries()) {
      const dossierPiece = join(dossier, 'pieces', String(index))
      await mkdir(dossierPiece, { recursive: true })
      const chemin = join(dossierPiece, piece.nom)
      await writeFile(chemin, piece.octets)
      chemins.push(chemin)
    }
    const liste = join(dossier, 'pieces.txt')
    // UTF-8, comme l'objet et le corps : un nom de fichier accentué passé par la console cp1252 de
    // ce poste arriverait abîmé, et Outlook ne trouverait pas le fichier.
    await writeFile(liste, chemins.join('\n'), 'utf8')
    return liste
  }

  /** Un script livré À CÔTÉ de celui de lecture, résolu de la même façon (packagé compris). */
  private scriptVoisin(nom: string): string {
    return resolveOutlookScriptPath(this.appRoot).replace('outlook-local-snapshot.ps1', nom)
  }

  /** Vide le cache. Sert au rafraîchissement demandé explicitement par l'utilisateur. */
  invalidate(): void {
    this.cache = null
  }
}

/**
 * Traduit une panne technique en une phrase qui dit quoi faire.
 *
 * « ENOENT » ou « code 0x80080005 » n'aident personne : ce qui aide est « Outlook n'est pas
 * installé » ou « Outlook n'a pas répondu ».
 */
export function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOENT/i.test(message) && /powershell/i.test(message)) {
    return 'PowerShell est introuvable : la passerelle Outlook locale ne peut pas démarrer.'
  }
  if (/ENOENT/i.test(message)) {
    return "Le script de lecture d'Outlook est introuvable dans l'installation."
  }
  if (/timed out|ETIMEDOUT|timeout/i.test(message)) {
    return "Outlook n'a pas répondu à temps. Est-il en cours de synchronisation ?"
  }
  if (/Unexpected (token|end)/i.test(message) || /JSON/i.test(message)) {
    return "La lecture d'Outlook s'est interrompue avant d'avoir fini d'écrire."
  }
  if (/8000401a|80080005|80040154|Class not registered|Serveur RPC|RPC server/i.test(message)) {
    return "Outlook a refusé l'accès. Ouvrez Outlook, puis réessayez."
  }
  return message
}

/**
 * Où trouver le script de lecture, en développement comme en packagé.
 *
 * En packagé, le code vit dans `app.asar` — et PowerShell ne sait pas ouvrir un fichier à
 * l'intérieur d'une archive. `electron-builder.yml` extrait donc ce script (`asarUnpack`), ce qui le
 * dépose dans un dossier frère nommé `app.asar.unpacked`. La substitution ci-dessous est la seule
 * chose qui relie les deux : sans elle, la passerelle fonctionne en développement et reste
 * introuvable une fois installée.
 */
export function resolveOutlookScriptPath(appPath: string): string {
  // Découpage sur les DEUX séparateurs plutôt qu'une expression régulière : sur Windows le séparateur
  // est l'antislash, et une classe de caractères qui ne le contient pas ne matche rien — un piège
  // silencieux, puisqu'on retombe alors sur le chemin dans l'archive.
  const segments = appPath.split(/[\\/]/)
  const racine = segments
    .map((segment) => (segment === 'app.asar' ? 'app.asar.unpacked' : segment))
    .join(sep)
  return join(racine, 'scripts', 'outlook-local-snapshot.ps1')
}
