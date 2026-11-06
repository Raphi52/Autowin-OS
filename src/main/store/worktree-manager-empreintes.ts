import { execFileSync } from 'node:child_process'
import { readFileSync, readlinkSync } from 'node:fs'
import { platform } from 'node:os'
import { execFileHorsFil, type ErreurHorsFil, type OptionsHorsFil } from '../gel/execution-hors-fil'

/**
 * Empreintes de processus (pid recyclé ou non) et leur sondage système, synchrone ou en lot.
 * Extrait tel quel de worktree-manager.ts : bloc autonome, que la classe ne lit que
 * par defaultProcessIdentity / empreinteConnue / prechargerEmpreintesProcessus.
 */

/** Découpe en lignes, quel que soit le style de fin de ligne rendu par git. */
export const LIGNES = /\r?\n/

/**
 * Empreinte d'un processus : heure de démarrage + chemin. Deux processus peuvent porter le MÊME pid
 * à quelques minutes d'écart (recyclage) ; cette empreinte distingue « toujours le nôtre » de
 * « quelqu'un d'autre a hérité du numéro ». Exportée : le rattachement d'un run en a besoin aussi.
 */
const IDENTITE_MEMOIRE_MS = 5_000
const identitesMemoisees = new Map<number, { identite: string | null; a: number }>()

/** Vide la memoire courte des empreintes — pour les tests qui sondent la PANNE de la sonde. */
export function oublierEmpreintesProcessus(): void {
  identitesMemoisees.clear()
}

/**
 * Le sondage SYSTEME de l'empreinte — un processus externe, synchrone, par appel.
 *
 * Sur Windows il lance `powershell.exe` : 1 a 3 secondes de fil principal tenu a chaque fois.
 */
function sondeIdentiteSysteme(pid: number): string | null {
  try {
    if (platform() === 'win32') {
      const command =
        `$p = Get-Process -Id ${pid} -ErrorAction Stop; ` +
        `$path = ''; try { $path = $p.Path } catch {}; ` +
        `Write-Output ($p.StartTime.ToUniversalTime().Ticks.ToString() + '|' + $path)`
      const identity = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        {
          encoding: 'utf8',
          timeout: 3_000,
          windowsHide: true
        }
      ).trim()
      return identity || null
    }
    if (platform() === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const fieldsAfterName = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)
      const startedAt = fieldsAfterName[19]
      let executable = ''
      try {
        executable = readlinkSync(`/proc/${pid}/exe`)
      } catch {
        // L'heure de démarrage reste suffisante pour distinguer un PID recyclé.
      }
      return startedAt ? `${startedAt}|${executable}` : null
    }
    const identity = execFileSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'comm='], {
      encoding: 'utf8',
      timeout: 3_000
    }).trim()
    return identity || null
  } catch {
    return null
  }
}

/**
 * Le sondage GROUPE : l'empreinte de N PID en UN SEUL processus externe.
 *
 * Mesure du 2026-09-04 (.autowin-data/autowin-os/gels.jsonl) : 68 gels, 240 s de fil principal tenu,
 * mediane 2,1 s, pointe 17,4 s. La memoire courte par PID ne supprime que les REPETITIONS ; le
 * recensement des baux, lui, balaie N PID DIFFERENTS a la suite et payait donc N lancements de
 * PowerShell d'affilee. `Get-Process` accepte une LISTE d'identifiants : un seul lancement suffit.
 */
function sondeIdentitesSystemeGroupee(pids: number[]): Map<number, string | null> {
  const resultat = new Map<number, string | null>(pids.map((pid) => [pid, null]))
  if (pids.length === 0) return resultat
  if (platform() !== 'win32') {
    for (const pid of pids) resultat.set(pid, sondeIdentiteSysteme(pid))
    return resultat
  }
  try {
    const command =
      `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { ` +
      `$path = ''; try { $path = $_.Path } catch {}; ` +
      `Write-Output ($_.Id.ToString() + '|' + $_.StartTime.ToUniversalTime().Ticks.ToString() + '|' + $path) }`
    const sortie = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', timeout: 5_000, windowsHide: true }
    )
    for (const ligne of sortie.split(LIGNES)) {
      const brut = ligne.trim()
      if (!brut) continue
      const separateur = brut.indexOf('|')
      if (separateur <= 0) continue
      const pid = Number(brut.slice(0, separateur))
      if (!Number.isSafeInteger(pid) || !resultat.has(pid)) continue
      const empreinte = brut.slice(separateur + 1)
      resultat.set(pid, empreinte || null)
    }
  } catch {
    // Un echec du sondage groupe reste un echec de LECTURE : `null` partout, memoise comme tel.
  }
  return resultat
}

/**
 * Le sondage bloquant est INTERDIT par defaut — c'est le fil principal qui est la regle.
 *
 * `isMainThread` a ete essaye et REJETE comme critere : sous vitest, les tests tournent eux-memes
 * dans des threads, donc il vaut FAUX la ou on veut precisement verrouiller le contrat. Le seul
 * endroit ou bloquer est legitime est le worker d'operations, dont l'appelant ATTEND deja la
 * reponse : il le declare explicitement au demarrage.
 */
let sondageBloquantAutorise = false

/** Appele par le worker d'operations : ici, tenir la boucle ne gele l'interface de personne. */
export function autoriserSondageBloquant(): void {
  sondageBloquantAutorise = true
}

/** VRAI quand un sondage SYNCHRONE tiendrait la boucle du fil principal. */
function sondageSynchroneInterdit(sondeUtilisee: unknown, sondeParDefaut: unknown): boolean {
  return !sondageBloquantAutorise && sondeUtilisee === sondeParDefaut
}

/** Les PID deja en cours de sondage asynchrone — pour ne pas relancer N fois le meme. */
const sondagesEnVol = new Set<number>()

/**
 * Le sondage GROUPE, mais ASYNCHRONE : le processus externe tourne HORS de la boucle du fil
 * principal, et remplit la meme memoire courte que la voie synchrone consultait deja.
 *
 * Aucun appelant n'attend ce resultat : `defaultProcessIdentity` reste synchrone et rend ce qu'il
 * SAIT. Une empreinte encore inconnue vaut `null` — c'est-a-dire « existe peut-etre, non lue »,
 * le cas conservateur que `hasActiveProcesses` traite deja en GARDANT le bail. La detection d'un
 * numero recycle n'est donc pas perdue, elle arrive au passage suivant.
 */
function planifierSondageAsynchrone(pids: number[], maintenant: () => number): void {
  const aLire = pids.filter((pid) => !sondagesEnVol.has(pid))
  if (aLire.length === 0) return
  for (const pid of aLire) sondagesEnVol.add(pid)
  const finir = (empreintes: Map<number, string | null>): void => {
    const t = maintenant()
    for (const pid of aLire) {
      sondagesEnVol.delete(pid)
      identitesMemoisees.set(pid, { identite: empreintes.get(pid) ?? null, a: t })
    }
  }
  const surSortie = (erreur: Error | null, sortie: string): void => {
    const empreintes = new Map<number, string | null>(aLire.map((pid) => [pid, null]))
    if (!erreur || sortie) {
      for (const ligne of String(sortie ?? '').split(LIGNES)) {
        const brut = ligne.trim()
        if (!brut) continue
        const separateur = brut.indexOf('|')
        if (separateur <= 0) continue
        const pid = Number(brut.slice(0, separateur))
        if (!Number.isSafeInteger(pid) || !empreintes.has(pid)) continue
        empreintes.set(pid, brut.slice(separateur + 1) || null)
      }
    }
    finir(empreintes)
  }
  /*
   * LA CRÉATION DU PROCESSUS AUSSI PART HORS DU FIL (2026-11-05). `execFile` n'est
   * asynchrone que pour la suite : créer `powershell.exe` tenait le fil principal, jusqu'à 31,9 s
   * d'un coup sur ce poste (gels.jsonl, 09:51:40 UTC), 82,8 s en 13 appels sur une session.
   * `execFileHorsFil` crée le processus dans un fil dédié ; la sortie arrive comme avant, erreur
   * comprise (elle porte `stdout`). Garde : worktree-manager-empreintes.sans-gel.test.ts.
   */
  const lancer = (
    fichier: string,
    args: string[],
    options: OptionsHorsFil,
    lire: (erreur: Error | null, sortie: string) => void
  ): void => {
    execFileHorsFil(fichier, args, options).then(
      ({ stdout }) => lire(null, stdout),
      (erreur: ErreurHorsFil) => lire(erreur, erreur?.stdout ?? '')
    )
  }
  try {
    if (platform() === 'win32') {
      const command =
        `Get-Process -Id ${aLire.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { ` +
        `$path = ''; try { $path = $_.Path } catch {}; ` +
        `Write-Output ($_.Id.ToString() + '|' + $_.StartTime.ToUniversalTime().Ticks.ToString() + '|' + $path) }`
      lancer(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { encoding: 'utf8', timeout: 5_000, windowsHide: true },
        surSortie
      )
      return
    }
    lancer(
      'ps',
      ['-o', 'pid=,lstart=,comm=', '-p', aLire.join(',')],
      { encoding: 'utf8', timeout: 5_000 },
      (erreur, sortie) => {
        const empreintes = new Map<number, string | null>(aLire.map((pid) => [pid, null]))
        for (const ligne of String(sortie ?? '').split(LIGNES)) {
          const brut = ligne.trim()
          if (!brut) continue
          const espace = brut.indexOf(' ')
          if (espace <= 0) continue
          const pid = Number(brut.slice(0, espace))
          if (!Number.isSafeInteger(pid) || !empreintes.has(pid)) continue
          empreintes.set(pid, brut.slice(espace + 1).trim() || null)
        }
        void erreur
        finir(empreintes)
      }
    )
  } catch {
    // Un echec de LANCEMENT reste un echec de lecture : `null` partout, memoise comme tel.
    finir(new Map())
  }
}

/**
 * Precharge la memoire courte pour TOUS les PID d'un recensement, en un seul processus externe.
 *
 * Les PID morts sont ecartes AVANT le lancement (`process.kill(pid, 0)` : l'absence est prouvee
 * localement, gratuitement) et ceux deja memoises ne sont pas resondes. Si rien ne reste a lire,
 * AUCUN processus externe n'est lance.
 */
export function prechargerEmpreintesProcessus(
  pids: readonly number[],
  sonde: (pids: number[]) => Map<number, string | null> = sondeIdentitesSystemeGroupee,
  maintenant: () => number = Date.now
): void {
  const t = maintenant()
  const aLire: number[] = []
  for (const pid of new Set(pids)) {
    if (!Number.isSafeInteger(pid) || pid <= 0) continue
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        identitesMemoisees.delete(pid)
        continue
      }
    }
    const memo = identitesMemoisees.get(pid)
    if (memo && t - memo.a < IDENTITE_MEMOIRE_MS) continue
    aLire.push(pid)
  }
  if (aLire.length === 0) return
  if (sondageSynchroneInterdit(sonde, sondeIdentitesSystemeGroupee)) {
    planifierSondageAsynchrone(aLire, maintenant)
    return
  }
  const empreintes = sonde(aLire)
  for (const pid of aLire) {
    identitesMemoisees.set(pid, { identite: empreintes.get(pid) ?? null, a: t })
  }
}

/**
 * L'empreinte SANS JAMAIS BLOQUER — ce que la memoire courte sait deja, rien de plus.
 *
 * C'est la lecture du RECENSEMENT des baux (`hasActiveProcesses`), le poste qui a coute 240 s de
 * boucle main le 2026-09-04 : il balaie N PID d'affilee, donc il payait N lancements de PowerShell.
 * Une empreinte encore inconnue vaut `null`, c'est-a-dire « existe peut-etre, non lue » — le cas
 * que le recensement traite deja en GARDANT le bail. La detection d'un numero recycle n'est donc
 * pas perdue : le sondage lance en fond remplit la memoire, et le passage suivant tranche.
 *
 * A ne PAS confondre avec `defaultProcessIdentity`, qui reste bloquante : le rattachement d'un run
 * a besoin de l'empreinte TOUT DE SUITE pour ne pas relancer un agent bien vivant.
 */
export function empreinteConnue(
  pid: number,
  maintenant: () => number = Date.now
): string | null | undefined {
  try {
    process.kill(pid, 0)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    identitesMemoisees.delete(pid)
    return code === 'ESRCH' ? undefined : null
  }
  const memo = identitesMemoisees.get(pid)
  if (memo && maintenant() - memo.a < IDENTITE_MEMOIRE_MS) return memo.identite
  if (!sondageBloquantAutorise) {
    planifierSondageAsynchrone([pid], maintenant)
    return null
  }
  return defaultProcessIdentity(pid, sondeIdentiteSysteme, maintenant)
}

/**
 * L'empreinte pour le RATTACHEMENT d'un run — et, sur le fil principal, SANS bloquer.
 *
 * Mesure du 2026-09-08 (`gels.jsonl`) : blocages de 1,2 s a 7,1 s sur `execFileSync powershell.exe`
 * depuis ce module, en pleine session (`ipc:os:conversations`, `ipc:git:read`). Le contrat « pas de
 * sondage bloquant sur le fil principal » etait pourtant deja pose — mais il ne couvrait que
 * `prechargerEmpreintesProcessus` et `empreinteConnue`, alors que c'est CETTE fonction que le fil
 * principal cable (`index.ts`). La porte est refermee ici, au meme endroit que la garde.
 *
 * Ce que l'on perd, et pourquoi c'est sans danger : une empreinte encore non lue vaut `null`, soit
 * « existe peut-etre » — le rattachement la traite comme un agent INCERTAIN et RATTACHE, il ne
 * relance donc jamais un agent bien vivant. La mort d'un PID, elle, reste prouvee localement et
 * gratuitement (`process.kill(pid, 0)` -> `ESRCH` -> `undefined`) : la distinction qui compte le
 * plus garde toute sa precision. Le sondage part en fond, et le passage suivant tranche le PID
 * recycle.
 */
export function defaultProcessIdentity(
  pid: number,
  sonde: (pid: number) => string | null = sondeIdentiteSysteme,
  maintenant: () => number = Date.now
): string | null | undefined {
  // La disparition du PID et l'échec de la sonde sont deux faits différents. `undefined` est
  // réservé à ESRCH (absence prouvée) ; `null` signifie que le PID existe peut-être encore mais
  // que son empreinte n'a pas pu être lue. Le rattachement traite alors l'agent comme inconnu.
  try {
    process.kill(pid, 0)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    identitesMemoisees.delete(pid)
    if (code === 'ESRCH') return undefined
    return null
  }
  /*
   * MEMOIRE COURTE, ET SEULEMENT SUR UN PID VIVANT.
   *
   * Mesure du 2026-09-02 (gels.jsonl) : 48 gels, 87,5 s de fenetre morte, tous sur le PowerShell
   * synchrone de la sonde, rappelee en rafale sur les MEMES PID par le recensement. L'empreinte
   * d'un processus vivant est immuable : dans une fenetre de quelques secondes, la resonder ne peut
   * rien apprendre. La fenetre reste COURTE et la memoire est purgee des que le PID disparait, pour
   * que la detection d'un numero recycle — la raison d'etre de cette empreinte — garde sa valeur.
   */
  const memo = identitesMemoisees.get(pid)
  const t = maintenant()
  if (memo && t - memo.a < IDENTITE_MEMOIRE_MS) return memo.identite
  if (sondageSynchroneInterdit(sonde, sondeIdentiteSysteme)) {
    planifierSondageAsynchrone([pid], maintenant)
    return null
  }
  const identity = sonde(pid)
  /*
   * L'ECHEC EST MEMOISE COMME LE SUCCES. Mesure du 2026-09-04 (gels.jsonl) : 39,3 s de fil
   * principal tenu sur cette sonde, avec des gels a exactement 3013 ms — la duree du `timeout`
   * PowerShell. Ne retenir que les succes laissait donc le cas le PLUS CHER (empreinte illisible :
   * droits, timeout) se rejouer a chaque appel du recensement. Dans une fenetre de quelques
   * secondes, un echec de lecture est un fait aussi stable qu'une empreinte : la memoire courte le
   * garde, et la purge sur PID disparu (plus haut) protege toujours la detection d'un numero recycle.
   */
  identitesMemoisees.set(pid, { identite: identity ?? null, a: t })
  return identity
}
