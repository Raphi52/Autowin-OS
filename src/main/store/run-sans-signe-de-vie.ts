/**
 * DIRE qu'un run affiche « en cours » alors que plus rien ne le porte.
 *
 * VECU le 2026-08-24, et c'est l'utilisateur qui l'a vu avant moi : un run restait `working` dans le
 * graphe, et j'ai repondu « ca tourne » sur la foi de ce champ. Il a insiste. Mesure alors : la copie
 * du run n'avait pas bouge d'un octet en 75 secondes, aucun processus enfant ne tournait, aucun tour
 * de chat n'etait actif, aucune trace n'existait. Le run etait mort depuis six minutes et l'affichait
 * comme vivant.
 *
 * CE QUI EXISTE DEJA, et pourquoi ca ne suffisait pas. `providers/watchdog.ts` porte un vrai
 * detecteur d'inactivite (`createStreamWatchdog`, silence stdout > 5 min = fige), et il est bien
 * concu -- il distingue « long mais progresse » de « fige ». Mais il surveille LE FLUX D'UN
 * PROCESSUS. Dans ce cas-la il n'y avait AUCUN processus : il n'avait rien a surveiller. Le trou est
 * donc a un autre etage, celui du RUN.
 *
 * CE MODULE NE TUE RIEN, ET NE CONCLUT PAS A LA MORT. Un run peut legitimement n'avoir aucun
 * processus pendant qu'il attend une reponse du modele. Affirmer « mort » sur ce seul signal
 * produirait de faux positifs sur des runs sains -- et un signal qui crie au loup finit par ne plus
 * etre lu. On ENONCE donc un fait verifiable (« aucun signe de vie depuis N minutes »), et l'humain
 * tranche. Le defaut a corriger etait le SILENCE, pas l'absence d'une mise a mort.
 */

/** L'etat d'un run, reduit aux champs qui decident du diagnostic. */
export interface CandidatSansSigne {
  runId: string
  state?: string
  /** Instant du dernier signe de vie observe (changement d'etat persiste, battement de processus). */
  derniereVieMs?: number
  startedAtMs?: number
}

/**
 * Au-dela de ce silence, on le DIT.
 *
 * Cale sur les 5 minutes du watchdog de flux (`SUBAGENT_INACTIVITY_MS`) a dessein : c'est le seuil
 * que ce depot considere deja comme « fige » plutot que « long ». Deux seuils differents pour la meme
 * notion se contredisent tot ou tard, et l'utilisateur ne saurait plus lequel croire.
 */
export const SILENCE_SUSPECT_MS = 5 * 60_000

/**
 * Les runs qui affichent « en cours » sans donner signe de vie depuis trop longtemps.
 *
 * `processusActif` est fourni par l'appelant (le manager sait, lui, si un processus tourne) : un run
 * dont un processus vit est en train de travailler, quel que soit son silence -- c'est exactement la
 * distinction que le watchdog de flux fait deja, et qu'il faut respecter ici.
 *
 * Le repli sur `startedAtMs` couvre les runs d'avant ce champ : sans lui, un run herite d'une session
 * anterieure ne serait JAMAIS signale, ce qui viderait la garde de son sens sur les cas les plus
 * anciens -- donc les plus suspects.
 */
export function runsSansSigneDeVie(
  candidats: readonly CandidatSansSigne[],
  processusActif: (runId: string) => boolean,
  maintenant: number,
  silenceMs: number = SILENCE_SUSPECT_MS
): string[] {
  return candidats
    .filter((candidat) => {
      if (candidat.state !== 'working') return false
      if (processusActif(candidat.runId)) return false
      const dernier = candidat.derniereVieMs ?? candidat.startedAtMs
      if (dernier === undefined) return false
      // Une horloge qui recule ne doit pas transformer un run sain en suspect.
      if (maintenant < dernier) return false
      return maintenant - dernier >= silenceMs
    })
    .map((candidat) => candidat.runId)
}

/**
 * Le message porte a l'utilisateur. Il ENONCE, il ne juge pas.
 *
 * Les minutes sont dites parce qu'un « aucun signe de vie » sans duree ne permet pas de decider :
 * six minutes sur une compilation n'est rien, six minutes sur une edition d'une ligne est un mur.
 */
export function messageSansSigneDeVie(silenceMs: number): string {
  const minutes = Math.max(1, Math.round(silenceMs / 60_000))
  return (
    `Aucun signe de vie depuis ${minutes} min et aucun processus actif — ce run s'affiche « en cours » ` +
    `sans qu'on puisse le confirmer. Relance-le ou annule-le plutôt que d'attendre.`
  )
}
