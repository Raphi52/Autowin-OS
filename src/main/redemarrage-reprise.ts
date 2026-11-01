import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * REPRISE APRES REDEMARRAGE — le chainon qui manquait.
 *
 * Un workflow qui exige un redemarrage de l'app (rechargement du process principal, dependance
 * native, variable d'environnement non rechargeable a chaud) coupait la tache en deux : l'app
 * repartait vierge et la consigne mourait avec l'ancien process. Le modele n'a AUCUNE memoire qui
 * survive au process — la consigne doit donc etre posee SUR LE DISQUE avant de tuer l'app, puis
 * consommee UNE SEULE FOIS au demarrage suivant.
 *
 * Trois proprietes non negociables :
 * - consommation destructive (le fichier est supprime a la lecture) : sinon un plantage au premier
 *   tour relancerait la meme consigne a chaque demarrage, en boucle.
 * - peremption : une consigne posee puis jamais reprise (l'utilisateur a ferme, la relance a
 *   echoue) ne doit pas resurgir trois jours plus tard dans une conversation devenue sans rapport.
 * - aucune execution ici : ce module ecrit et lit du texte, il ne redemarre rien.
 *
 * UNE CONSIGNE PAR CONVERSATION (conv-1306, 2026-10-30). Il n'y avait qu'UN fichier : conv-1329 a
 * pose sa consigne a 15:50:32 par-dessus celle de conv-1306 (15:31), dans le meme redemarrage en
 * file. Les deux fils avaient lu « la consigne sera rejouee dans cette conversation » ; un seul
 * l'aurait ete. Chaque fil a donc son fichier (`redemarrage/reprises/<fil>.json`), et une seconde
 * pose du MEME fil remplace seulement la sienne. L'ancien fichier unique reste LU : le processus
 * qui tourne au moment de ce correctif l'ecrit encore a sa relance.
 */
export interface RepriseEnAttente {
  /** La conversation ou la tache doit reprendre. */
  conversationId: string
  /** Le message renvoye a l'agent au demarrage, redige comme une consigne autonome. */
  consigne: string
  /** Pourquoi le redemarrage a ete demande — trace lisible, jamais interprete. */
  raison?: string
  /** Horodatage de la pose, pour la peremption. */
  poseeA: number
}

/** Au-dela, la consigne est consideree perimee et jetee sans etre rejouee. */
export const PEREMPTION_REPRISE_MS = 15 * 60 * 1000

/**
 * Sans conversation : l'ANCIEN fichier unique (lu, plus jamais ecrit). Avec : le fichier de ce fil.
 * L'identifiant est reduit a [A-Za-z0-9_-] : il vient d'un appel d'outil, il ne doit jamais faire
 * sortir l'ecriture du dossier des reprises.
 */
export function cheminReprise(racineDonnees: string, conversationId?: string): string {
  if (conversationId === undefined)
    return join(racineDonnees, 'redemarrage', 'reprise-en-attente.json')
  return join(
    dossierReprises(racineDonnees),
    `${conversationId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`
  )
}

function dossierReprises(racineDonnees: string): string {
  return join(racineDonnees, 'redemarrage', 'reprises')
}

/** L'ancien fichier unique, puis celui de chaque fil. */
function fichiersEnAttente(racineDonnees: string): string[] {
  const fichiers: string[] = []
  const ancien = cheminReprise(racineDonnees)
  if (existsSync(ancien)) fichiers.push(ancien)
  const dossier = dossierReprises(racineDonnees)
  if (existsSync(dossier)) {
    for (const nom of readdirSync(dossier)) {
      if (nom.endsWith('.json')) fichiers.push(join(dossier, nom))
    }
  }
  return fichiers
}

export function poserReprise(
  racineDonnees: string,
  reprise: Omit<RepriseEnAttente, 'poseeA'> & { poseeA?: number }
): RepriseEnAttente {
  const conversationId = reprise.conversationId?.trim()
  const consigne = reprise.consigne?.trim()
  if (!conversationId) throw new Error('Reprise impossible : aucune conversation cible.')
  if (!consigne) throw new Error('Reprise impossible : aucune consigne à reprendre.')
  const payload: RepriseEnAttente = {
    conversationId,
    consigne,
    ...(reprise.raison?.trim() ? { raison: reprise.raison.trim() } : {}),
    poseeA: reprise.poseeA ?? Date.now()
  }
  const chemin = cheminReprise(racineDonnees, conversationId)
  mkdirSync(dirname(chemin), { recursive: true })
  writeFileSync(chemin, JSON.stringify(payload, null, 2), 'utf8')
  return payload
}

/**
 * Demarrage du processus qui charge ce module — le processus PRINCIPAL dans l'app.
 *
 * Une consigne posee APRES cet instant l'a ete par ce processus-ci : elle attend le SUIVANT.
 */
const DEMARRAGE_DU_PROCESSUS = Date.now() - process.uptime() * 1000

/**
 * Lit la consigne en attente ET la supprime, qu'elle soit valide ou non — sauf si elle a ete
 * posee par le processus qui demande (`demarreA` anterieur a la pose).
 *
 * La suppression precede toute decision de validite : un fichier corrompu qui resterait la
 * ferait echouer chaque demarrage suivant de la meme facon.
 *
 * MEME PROCESSUS = PAS DE REPRISE (conv-1033, 2026-10-21). `restart_app` mis en file pose la
 * consigne tout de suite (commands.ts), et le renderer la reclame a CHAQUE montage de ChatView,
 * pas seulement apres un redemarrage. Mesure : l'interface l'a reprise a 15:20:30 alors que le
 * processus principal tournait depuis 10:22 et que le redemarrage attendait encore trois fils —
 * la verification est partie sur l'ancien code. Le fichier reste donc en place pour le processus
 * suivant ; la peremption ci-dessous borne toujours sa duree de vie.
 */
export function consommerReprise(
  racineDonnees: string,
  maintenant: number = Date.now(),
  demarreA: number = DEMARRAGE_DU_PROCESSUS
): RepriseEnAttente | null {
  /*
   * UNE consigne par appel, la plus ancienne d'abord : l'interface rappelle jusqu'a `null`
   * (`reprendreToutesApresRedemarrage`). Seule la consigne RENDUE est effacee, avec les fichiers
   * invalides ou perimes croises en chemin ; celles des autres fils attendent l'appel suivant.
   */
  const lus: Array<{ chemin: string; contenu: unknown }> = []
  for (const chemin of fichiersEnAttente(racineDonnees)) {
    try {
      lus.push({ chemin, contenu: JSON.parse(readFileSync(chemin, 'utf8')) })
    } catch {
      // Corrompu : il ferait echouer chaque demarrage suivant de la meme facon.
      rmSync(chemin, { force: true })
    }
  }
  const poseeDe = (contenu: unknown): number =>
    contenu &&
    typeof contenu === 'object' &&
    typeof (contenu as Partial<RepriseEnAttente>).poseeA === 'number'
      ? ((contenu as Partial<RepriseEnAttente>).poseeA as number)
      : 0
  lus.sort((a, b) => poseeDe(a.contenu) - poseeDe(b.contenu))
  for (const { chemin, contenu } of lus) {
    // Posee par CE processus : elle attend le suivant (voir plus haut).
    if (poseeDe(contenu) >= demarreA) continue
    rmSync(chemin, { force: true })
    const reprise = repriseValide(contenu, maintenant)
    if (reprise) {
      retenirConsigneRendue(reprise.consigne)
      return reprise
    }
  }
  return null
}

/**
 * LES CONSIGNES RENDUES PAR CE PROCESSUS (conv-1306, 2026-10-30). L'interface les envoie telles
 * quelles, comme une frappe : le tour les recoit avec le role `user`, sans aucune marque d'origine.
 * La bascule de dossier (`depotCiteDansLeMessage`) les prenait donc pour une demande de
 * l'utilisateur ; celle de conv-1329 citait des dossiers a RETIRER du Board. Le texte recu est
 * identique a la consigne (mesure sur conv-1330 : 870 caracteres, egaux) : on le reconnait a l'egalite.
 * Borne : un redemarrage rend au plus quelques consignes ; 50 couvre largement la vie du processus.
 */
const CONSIGNES_RENDUES_MAX = 50
const consignesRendues: string[] = []

function retenirConsigneRendue(consigne: string): void {
  consignesRendues.push(consigne.trim())
  if (consignesRendues.length > CONSIGNES_RENDUES_MAX) consignesRendues.shift()
}

/** Ce message est-il une consigne de reprise rendue par ce processus, et non une frappe ? */
export function estUneConsigneDeRedemarrage(message: string | undefined): boolean {
  const texte = (message ?? '').trim()
  return texte !== '' && consignesRendues.includes(texte)
}

function repriseValide(parse: unknown, maintenant: number): RepriseEnAttente | null {
  if (!parse || typeof parse !== 'object') return null
  const candidat = parse as Partial<RepriseEnAttente>
  if (typeof candidat.conversationId !== 'string' || !candidat.conversationId.trim()) return null
  if (typeof candidat.consigne !== 'string' || !candidat.consigne.trim()) return null
  const poseeA = typeof candidat.poseeA === 'number' ? candidat.poseeA : 0
  if (maintenant - poseeA > PEREMPTION_REPRISE_MS) return null
  return {
    conversationId: candidat.conversationId.trim(),
    consigne: candidat.consigne.trim(),
    ...(typeof candidat.raison === 'string' && candidat.raison.trim()
      ? { raison: candidat.raison.trim() }
      : {}),
    poseeA
  }
}
