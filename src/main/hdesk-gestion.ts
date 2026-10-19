/**
 * GESTION DE TOUS LES BUREAUX CACHÉS (conv-951, 2026-10-16) : « j'aimerais une view dédiée pour gérer
 * tous mes Hdesk, pouvoir les fermer, les créer et tout ». La petite TV du chat (hdesk-tv.ts) ne montre
 * que les bureaux du fil ouvert et ne sait ni fermer ni créer ; ce module voit TOUS les bureaux vivants.
 *
 * Il s'appuie sur l'existant : registre (`lireRegistre`), liste du processus de capture ouvert
 * (`CapteurHdesk.listeVivants`), fermeture par bureau (`fermerHdesk` -> scripts/hdesk-fermer.ps1),
 * lanceur scripts/hdesk-lancer.ps1.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ID_BUREAU,
  fermerHdesk,
  lireRegistre,
  processusVivant,
  type DemandeFermeture,
  type ListeVivants,
  type EntreeRegistre,
  type ResultatFermeture
} from './hdesk-tv'
import {
  CREATION_ATTENTE_MS,
  filDeLaDemande,
  refusCreation,
  type BureauGere,
  type DemandeCreationBureau,
  type GesteJournal,
  type LancementRecent,
  type ResultatChoixExe,
  type ResultatCreationBureau,
  type ResultatFermetureGeree,
  type ResultatListeBureaux
} from '../shared/hdesk-gestion'

/** Même dossier que CapteurHdesk et que les scripts (%LOCALAPPDATA%\autowin-hdesk). */
export function registreParDefaut(): string {
  return join(process.env.LOCALAPPDATA ?? tmpdir(), 'autowin-hdesk')
}

type FicheComplete = EntreeRegistre & { executable?: string }

/**
 * TOUS les bureaux vivants, plus récent d'abord. Diffère de `fusionnerBureaux` (hdesk-tv.ts) sur un
 * seul point : aucun filtre par fil. Même règle « application morte = bureau fini » (conv-536) : le
 * bureau Windows survit à son application, la liste ne doit pas montrer un bureau vide comme ouvert.
 * Un bureau vivant SANS fiche reste listé, marqué non relié : il existe, l'utilisateur doit le voir.
 */
export function listerTousLesBureaux(
  vivants: readonly string[],
  registre: readonly EntreeRegistre[],
  pidVivant: (pid: number) => boolean = processusVivant
): BureauGere[] {
  const parId = new Map(registre.map((e) => [e.id, e as FicheComplete]))
  return [...new Set(vivants)]
    .filter((id) => ID_BUREAU.test(id))
    .filter((id) => {
      const pid = parId.get(id)?.pid
      return typeof pid !== 'number' || pidVivant(pid)
    })
    .map((id): BureauGere => {
      const e = parId.get(id)
      return {
        id,
        travail: e?.travail?.trim() || 'travail non relié',
        relie: Boolean(e),
        ...(e?.conversationId ? { conversationId: e.conversationId } : {}),
        ...(e?.lanceLe ? { lanceLe: e.lanceLe } : {}),
        ...(typeof e?.pid === 'number' ? { pid: e.pid } : {}),
        ...(typeof e?.executable === 'string' ? { executable: e.executable } : {})
      }
    })
    .sort((a, b) => (b.lanceLe ?? '').localeCompare(a.lanceLe ?? ''))
}

/** Derniere ligne JSON d'une sortie PowerShell, ou null. */
function derniereLigneJson(sortie: string): Record<string, unknown> | null {
  for (const l of String(sortie ?? '')
    .split(/\r?\n/)
    .reverse()) {
    const t = l.trim()
    if (!t.startsWith('{')) continue
    try {
      return JSON.parse(t) as Record<string, unknown>
    } catch {
      /* ligne non JSON : on continue */
    }
  }
  return null
}

export type { ListeVivants }

/**
 * TOUS les bureaux, reliés à leur fiche. `lire` est la liste du processus de capture DÉJÀ ouvert
 * (`CapteurHdesk.listeVivants`, câblé dans index.ts) : plus de PowerShell neuf à chaque tour
 * (conv-344, scout n°7 — la raison « méthode privée intouchable » du 2026-10-16 ne tenait plus).
 */
export async function bureauxGeres(
  lire: () => Promise<ListeVivants>,
  registre = registreParDefaut()
): Promise<ResultatListeBureaux> {
  const r = await lire()
  if (!r.ok) return r
  return {
    ok: true,
    bureaux: listerTousLesBureaux(r.vivants, lireRegistre(registre)).map((b) => {
      const gestes = lireGestes(registre, b.id)
      return gestes.length ? { ...b, gestes } : b
    }),
    recents: lireRecents(registre, r.vivants)
  }
}

export const RECENTS_MAX = 5
export const GESTES_MONTRES = 5

/**
 * Derniers gestes d'un bureau (conv-344, scout n°5), le plus ancien d'abord : le journal
 * `<id>.gestes.jsonl` qu'écrit scripts/hdesk-act.ps1 pour TOUT geste (TV, vue, agent). Ligne abîmée
 * ignorée ; journal absent = aucun geste.
 */
export function lireGestes(registre: string, id: string): GesteJournal[] {
  if (!ID_BUREAU.test(id)) return []
  const chemin = join(registre, `${id}.gestes.jsonl`)
  let texte: string
  try {
    texte = existsSync(chemin) ? readFileSync(chemin, 'utf8') : ''
  } catch {
    return []
  }
  const gestes: GesteJournal[] = []
  for (const ligne of texte.split(/\r?\n/)) {
    try {
      const g = JSON.parse(ligne) as GesteJournal
      if (g && typeof g === 'object' && typeof g.quand === 'string' && typeof g.ok === 'boolean')
        gestes.push(g)
    } catch {
      /* ligne abîmée : ignorée */
    }
  }
  return gestes.slice(-GESTES_MONTRES)
}

/**
 * « Récents » (conv-344, scout n°6) : les derniers lancements réussis de `historique.jsonl` (écrit par
 * hdesk-lancer.ps1, borné à 50 lignes), plus récent d'abord. Une ligne abîmée ou incomplète est
 * ignorée ; le même lancement répété (même identifiant, exécutable et arguments) compte une fois ;
 * un bureau encore vivant n'en est pas : il est déjà dans la liste.
 */
export function lireRecents(registre: string, vivants: readonly string[]): LancementRecent[] {
  const chemin = join(registre, 'historique.jsonl')
  let texte: string
  try {
    texte = existsSync(chemin) ? readFileSync(chemin, 'utf8') : ''
  } catch {
    return []
  }
  const enVie = new Set(vivants.map((v) => v.toLowerCase()))
  const vus = new Set<string>()
  const recents: LancementRecent[] = []
  const chaine = (v: unknown): string => (typeof v === 'string' ? v : '')
  for (const ligne of texte
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .reverse()) {
    if (recents.length >= RECENTS_MAX) break
    let e: Record<string, unknown>
    try {
      e = JSON.parse(ligne) as Record<string, unknown>
    } catch {
      continue
    }
    const id = chaine(e?.id)
    const executable = chaine(e.executable)
    const travail = chaine(e.travail)
    if (!ID_BUREAU.test(id) || !executable.trim() || !travail.trim()) continue
    if (enVie.has(id.toLowerCase())) continue
    const args = chaine(e.arguments)
    const cle = `${id.toLowerCase()}|${executable.toLowerCase()}|${args}`
    if (vus.has(cle)) continue
    vus.add(cle)
    recents.push({
      id,
      executable,
      arguments: args,
      travail,
      conversationId: chaine(e.conversationId),
      ...(chaine(e.lanceLe) ? { lanceLe: chaine(e.lanceLe) } : {})
    })
  }
  return recents
}

/**
 * « Parcourir… » (conv-344, scout n°10) : le sélecteur natif choisit le fichier, cette fonction le
 * juge. `null` = annulé (ou sélecteur refusé : instance de test, aucune fenêtre visible) ; un fichier
 * qui n'est pas un .exe est refusé AVANT d'arriver au lanceur.
 */
export async function choisirExecutable(
  choisir: () => Promise<string | null>
): Promise<ResultatChoixExe> {
  const chemin = await choisir()
  if (!chemin) return { ok: false }
  if (!/\.exe$/i.test(chemin)) return { ok: false, message: 'Choisis un fichier .exe.' }
  return { ok: true, chemin }
}

/** Résultat du script de fermeture, dit pour un humain. */
export function traduireFermeture(r: ResultatFermeture): ResultatFermetureGeree {
  // Code 2 = plus aucun bureau a ce nom (disparu entre la liste et le clic) : rien a fermer, pas un échec.
  if (r.code === 2)
    return {
      ok: true,
      code: 2,
      dejaFerme: true,
      message: 'Ce bureau n’existe plus : rien à fermer.'
    }
  if (r.ok && r.dejaFerme)
    return { ok: true, code: r.code, dejaFerme: true, message: 'Ce bureau était déjà vide.' }
  if (r.ok) return { ok: true, code: r.code, message: 'Application fermée, bureau libéré.' }
  if (r.code === 6 && r.survivants?.length)
    return {
      ok: false,
      code: 6,
      message: `Des processus survivent dans ce bureau (pid ${r.survivants.join(', ')}).`
    }
  return {
    ok: false,
    code: r.code,
    message: r.erreur?.trim() || `hdesk-fermer.ps1 a rendu le code ${r.code}.`
  }
}

/**
 * Ferme le bureau `id`, quel que soit son fil. Le fil passé au script est TOUJOURS celui de la FICHE,
 * jamais une valeur venue de l'écran : le refus « bureau d'une autre conversation » (code 5) protège
 * les agents entre eux et reste intact pour eux (outil bureau_cache_fermer, commands.ts).
 * Un bureau SANS fiche (ui-capture-*, preuve-* : autowin-headless.ps1 n'en écrit pas) est fermé en mode
 * « sans fiche » (conv-344) : le script ne vise que ce qui a une fenêtre sur ce bureau, et refuse ce
 * mode si une fiche est apparue entre-temps. Une fiche SANS fil n'est pas fermée : la raison est rendue.
 */
export async function fermerBureauGere(
  racine: string,
  id: string,
  registre = registreParDefaut(),
  fermer: (racine: string, d: DemandeFermeture) => Promise<ResultatFermeture> = fermerHdesk
): Promise<ResultatFermetureGeree> {
  if (typeof id !== 'string' || !ID_BUREAU.test(id))
    return { ok: false, code: null, message: 'Identifiant de bureau invalide.' }
  const fiche = lireRegistre(registre).find((e) => e.id === id)
  if (!fiche) return traduireFermeture(await fermer(racine, { id, sansFiche: true }))
  const fil = typeof fiche.conversationId === 'string' ? fiche.conversationId : ''
  if (!ID_BUREAU.test(fil))
    return {
      ok: false,
      code: null,
      message: "La fiche de ce bureau ne dit pas à quel fil il appartient. Rien n'a été fermé."
    }
  return traduireFermeture(await fermer(racine, { id, conversationId: fil }))
}

/**
 * CRÉATION (conv-951). Le lanceur passe par scripts/lancer-detache.ps1 (WMI) : Autowin tourne dans un
 * Job Windows (sonde IsProcessInJob, job=True, 2026-10-16), et une application créée par un simple
 * execFile en hériterait — elle mourrait avec Autowin. Un PowerShell lancé détaché par Node ne
 * s'exécute pas du tout (leçon du 2026-10-16, bouton ⇄). Détaché, le lanceur ne rend ni sa sortie ni
 * son code : une petite enveloppe les écrit dans un fichier d'état, que l'on attend.
 */
export { CREATION_ATTENTE_MS }
const CREATION_SONDE_MS = 300

export interface DependancesCreation {
  /** Lance powershell.exe (attaché, fenêtre cachée) et rend son code et sa sortie standard. */
  executer: (args: string[]) => Promise<{ code: number | null; sortie: string }>
  /** Contenu du fichier d'état, ou null tant qu'il n'existe pas. */
  lire: (chemin: string) => string | null
  supprimer: (chemin: string) => void
  attendre: (ms: number) => Promise<void>
  maintenant: () => number
  fichierStatut: (id: string) => string
}

export function dependancesCreation(): DependancesCreation {
  return {
    executer: (args) =>
      new Promise((resolve) => {
        execFile('powershell.exe', args, { windowsHide: true, timeout: 30_000 }, (err, out) => {
          const code = err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as { code: number }).code
              : null
            : 0
          resolve({ code, sortie: String(out ?? '') })
        })
      }),
    lire: (chemin) => {
      if (!existsSync(chemin)) return null
      try {
        return readFileSync(chemin, 'utf8')
      } catch {
        // Fichier tenu à l'instant par l'enveloppe qui l'écrit : la sonde suivante le relira.
        return null
      }
    },
    supprimer: (chemin) => rmSync(chemin, { force: true }),
    attendre: (ms) => new Promise((r) => setTimeout(r, ms)),
    maintenant: () => Date.now(),
    fichierStatut: (id) =>
      join(tmpdir(), `autowin-hdesk-creation-${id}-${process.pid}-${Date.now()}.json`)
  }
}

/**
 * Chaîne PowerShell entre apostrophes. PowerShell ferme une telle chaîne sur « ' » mais AUSSI sur les
 * apostrophes typographiques ‘ ’ ‚ ‛ ; chacune s'échappe en la doublant.
 */
// fix-ok: src/main/hdesk-gestion.ts — seule « ' » etait doublee : un libelle « l’essai » fermait la chaine, l'enveloppe ne s'executait pas (test chaine reelle rouge, 60 s sans verdict, 2026-10-16)
const chainePowerShell = (s: string): string => `'${s.replace(/['‘’‚‛]/g, (q) => q + q)}'`

/**
 * Script PowerShell de l'enveloppe : appelle hdesk-lancer.ps1 DANS son processus (pas de second
 * passage de ligne de commande, donc des arguments à guillemets intacts), capte sa sortie, son code et
 * son erreur (le `trap` du lanceur écrit sur [Console]::Error), puis écrit le tout dans `statut`.
 */
export function scriptEnveloppeCreation(
  racine: string,
  d: DemandeCreationBureau,
  statut: string
): string {
  const parametres = [
    `-Id ${chainePowerShell(d.id.trim())}`,
    `-Executable ${chainePowerShell(d.executable.trim())}`,
    `-Travail ${chainePowerShell(d.travail.trim())}`,
    `-Conversation ${chainePowerShell(filDeLaDemande(d))}`
  ]
  if (typeof d.arguments === 'string' && d.arguments.trim())
    parametres.push(`-Arguments ${chainePowerShell(d.arguments.trim())}`)
  const lanceur = chainePowerShell(join(racine, 'scripts', 'hdesk-lancer.ps1'))
  return [
    "$ErrorActionPreference = 'Continue'",
    '$erreurs = New-Object IO.StringWriter',
    '[Console]::SetError($erreurs)',
    '$code = $null',
    '$sortie = @()',
    'try {',
    `  $sortie = @(& ${lanceur} ${parametres.join(' ')} | ForEach-Object { [string]$_ })`,
    '  $code = $LASTEXITCODE',
    '} catch { $erreurs.WriteLine($_.Exception.Message); $code = 1 }',
    '$etat = [pscustomobject]@{ code = $code; sortie = ($sortie -join "`n"); erreur = $erreurs.ToString().Trim() } | ConvertTo-Json -Compress',
    `[IO.File]::WriteAllText(${chainePowerShell(statut)}, $etat, (New-Object Text.UTF8Encoding $false))`
  ].join('\n')
}

/** Arguments de powershell.exe qui font lancer l'enveloppe par lancer-detache.ps1 (hors du Job). */
export function argumentsLancementCreation(
  racine: string,
  d: DemandeCreationBureau,
  statut: string
): string[] {
  const enveloppe = Buffer.from(scriptEnveloppeCreation(racine, d, statut), 'utf16le').toString(
    'base64'
  )
  // -EncodedCommand : la commande confiée à WMI ne contient ni guillemet ni espace à protéger.
  const commande = `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${enveloppe}`
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(racine, 'scripts', 'lancer-detache.ps1'),
    '-Commande',
    commande,
    '-Dossier',
    racine
  ]
}

interface EtatEnveloppe {
  code: number | null
  sortie: string
  erreur: string
}

/** Fichier d'état de l'enveloppe ; null tant qu'il est absent ou en cours d'écriture. */
export function lireEtatEnveloppe(texte: string | null): EtatEnveloppe | null {
  if (!texte) return null
  try {
    const j = JSON.parse(texte.replace(/^\uFEFF/, '')) as Record<string, unknown>
    if (!('code' in j)) return null
    return {
      code: typeof j.code === 'number' ? j.code : null,
      sortie: typeof j.sortie === 'string' ? j.sortie : '',
      erreur: typeof j.erreur === 'string' ? j.erreur : ''
    }
  } catch {
    return null
  }
}

/**
 * Verdict du lanceur (codes de hdesk-lancer.ps1 : 0 prêt · 1 échec · 2 arrêtée avant sa fenêtre ·
 * 3 sans fenêtre · 4 arrêtée après sa fenêtre · 5 occupé).
 */
export function interpreterCreation(id: string, etat: EtatEnveloppe): ResultatCreationBureau {
  const j = derniereLigneJson(etat.sortie)
  const texte = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  if (etat.code === 0 && j?.pret === true)
    return {
      ok: true,
      id,
      ...(typeof j.pid === 'number' ? { pid: j.pid } : {}),
      message: `Bureau « ${id} » prêt.`
    }
  if (etat.code === 5)
    return {
      ok: false,
      code: 5,
      message: texte(j?.erreur) ?? `Identifiant « ${id} » déjà utilisé par un travail vivant.`,
      ...(texte(j?.idLibre) ? { idLibre: texte(j?.idLibre) } : {}),
      ...(texte(j?.travailOccupant) ? { travailOccupant: texte(j?.travailOccupant) } : {}),
      ...(texte(j?.conversationOccupante)
        ? { conversationOccupante: texte(j?.conversationOccupante) }
        : {})
    }
  if (etat.code === 2)
    return {
      ok: false,
      code: 2,
      message:
        `L’application s’est arrêtée avant d’ouvrir sa fenêtre (code de sortie ${typeof j?.codeSortie === 'number' ? j.codeSortie : 'inconnu'}) : ` +
        'elle a passé la main à une copie déjà ouverte — sa fenêtre est peut-être sur ton écran — ou a planté au démarrage.'
    }
  if (etat.code === 3)
    return {
      ok: false,
      code: 3,
      message:
        "L'application n'a ouvert aucune fenêtre visible dans le bureau caché (30 s d'attente)."
    }
  return {
    ok: false,
    code: etat.code,
    message:
      texte(j?.erreur) ?? texte(etat.erreur) ?? `hdesk-lancer.ps1 a rendu le code ${etat.code}.`
  }
}

/**
 * Crée un bureau caché et y lance `executable`. Ne rend { ok: true } qu'une fois le lanceur prêt
 * (fenêtre visible ET application vivante après sa période de survie). Une demande invalide est
 * refusée sans rien lancer.
 */
export async function creerBureau(
  racine: string,
  d: DemandeCreationBureau,
  deps: DependancesCreation = dependancesCreation(),
  attenteMs = CREATION_ATTENTE_MS
): Promise<ResultatCreationBureau> {
  const refus = refusCreation(d)
  if (refus) return { ok: false, code: null, message: refus }
  const id = d.id.trim()
  const statut = deps.fichierStatut(id)
  deps.supprimer(statut)
  const lancement = await deps.executer(argumentsLancementCreation(racine, d, statut))
  const lance = derniereLigneJson(lancement.sortie)
  if (typeof lance?.pid !== 'number') {
    const cause =
      typeof lance?.erreur === 'string'
        ? lance.erreur
        : `lancer-detache.ps1 a rendu le code ${lancement.code}`
    return { ok: false, code: null, message: `Le lanceur n'a pas pu démarrer (${cause}).` }
  }
  const fin = deps.maintenant() + attenteMs
  for (;;) {
    const etat = lireEtatEnveloppe(deps.lire(statut))
    if (etat) {
      deps.supprimer(statut)
      return interpreterCreation(id, etat)
    }
    if (deps.maintenant() >= fin) break
    await deps.attendre(CREATION_SONDE_MS)
  }
  deps.supprimer(statut)
  return {
    ok: false,
    code: null,
    message: `Le lanceur (processus ${lance.pid}) n'a rendu aucun verdict en ${Math.round(attenteMs / 1000)} s. Le bureau existe peut-être : regarde la liste.`
  }
}
