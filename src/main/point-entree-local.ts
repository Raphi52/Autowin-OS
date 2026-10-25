import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CommandResult, CommandSpec } from './commands'
import type { LanceurCommandeSkill } from './skill-node-tools'
import { demarrerServeurOutilsNoeudSkill, type PerimetreOutils } from './skill-node-mcp'

/**
 * POINT D'ENTRÉE LOCAL PERMANENT — piloter Autowin depuis un script extérieur (conv-1144).
 *
 * POURQUOI. Lancer un fil, lui envoyer une demande et attendre sa réponse n'était possible que de
 * l'intérieur de l'app : le serveur d'outils (`skill-node-mcp.ts`) ne vivait que le temps d'un envoi
 * au modèle, le port de débogage est coupé dans l'app installée (`index.ts`, « surface de debug »),
 * et la relance par tâche planifiée va dans un seul sens. On réutilise donc LE MÊME serveur et le
 * même protocole que les outils du chat, ouvert pour toute la vie de l'app.
 *
 * CE QUI EST SERVI : trois commandes, rien d'autre. `tools/call` d'un autre nom est refusé par le
 * filtre du serveur ET par le lanceur ci-dessous — deux barrières, comme pour les nœuds skill : le
 * filtre de publication seul ne suffit pas à garantir qu'un nom non publié ne s'exécute jamais.
 *
 * LE JETON. Le port est en loopback, mais tout processus du poste peut le joindre. Le jeton n'est
 * écrit QUE dans le fichier ci-dessous, dans le dossier de données de l'instance : un script qui
 * peut le lire peut déjà lire toutes les conversations sur le disque. Il ne passe dans aucun journal.
 *
 * PAS DE PORT FIXE : chaque instance (dont les instances cachées de test, qui ont leur propre
 * dossier de données) a son port choisi par Windows et SON fichier. Un port fixe ferait se disputer
 * deux instances, et un client pourrait parler à la mauvaise.
 */

/** Les seules commandes servies. Créer un fil, y lancer un tour, le relire. */
export const COMMANDES_POINT_ENTREE: readonly string[] = [
  'create_conversation',
  'chat_send',
  'conversation_read'
]

/** Nom du fichier, dans le dossier de données de l'instance, qui donne l'adresse et le jeton. */
export const FICHIER_POINT_ENTREE = 'point-entree-local.json'

/** Contenu du fichier lu par `scripts/autowin-client.mjs`. */
export interface DescriptionPointEntree {
  url: string
  port: number
  jeton: string
  pid: number
  demarreLe: string
  commandes: readonly string[]
}

export interface PointEntreeLocal {
  readonly url: string
  readonly port: number
  /** Chemin du fichier écrit au démarrage. */
  readonly fichier: string
  /** Ferme le serveur et retire le fichier s'il est encore le nôtre. Idempotent. */
  arreter(): Promise<void>
}

const refusHorsPerimetre = (nom: string): string =>
  `REFUSÉ — \`${nom}\` n'est pas servi par le point d'entrée local, qui ne sert que ` +
  `${COMMANDES_POINT_ENTREE.join(', ')}. L'appel n'a pas eu lieu.`

export async function demarrerPointEntreeLocal(o: {
  dossierDonnees: string
  catalogue: () => readonly CommandSpec[]
  exec: (nom: string, args: Record<string, unknown>) => Promise<CommandResult>
  /** Injectable pour les tests ; par défaut le vrai serveur. */
  demarrer?: typeof demarrerServeurOutilsNoeudSkill
  pid?: number
}): Promise<PointEntreeLocal> {
  const lanceur: LanceurCommandeSkill = {
    catalogue: () => o.catalogue().filter((c) => COMMANDES_POINT_ENTREE.includes(c.name)),
    exec: async (nom, args) => {
      // Seconde barrière : même si le filtre du serveur changeait, rien d'autre ne s'exécute ici.
      if (!COMMANDES_POINT_ENTREE.includes(nom))
        return { ok: false, error: refusHorsPerimetre(nom) }
      const r = await o.exec(nom, args)
      // Les pièces jointes et cartes du fil ne concernent pas un script : on rend le seul résultat.
      return {
        ok: r.ok,
        ...(r.data !== undefined ? { data: r.data } : {}),
        ...(r.error ? { error: r.error } : {})
      }
    }
  }
  const perimetre: PerimetreOutils = { outils: COMMANDES_POINT_ENTREE, refus: refusHorsPerimetre }
  const serveur = await (o.demarrer ?? demarrerServeurOutilsNoeudSkill)(lanceur, { perimetre })
  const fichier = join(o.dossierDonnees, FICHIER_POINT_ENTREE)
  const description: DescriptionPointEntree = {
    url: serveur.url,
    port: serveur.port,
    jeton: serveur.jeton,
    pid: o.pid ?? process.pid,
    demarreLe: new Date().toISOString(),
    commandes: COMMANDES_POINT_ENTREE
  }
  try {
    // Écriture puis renommage : un client qui lit au même instant ne voit jamais un JSON à moitié écrit.
    const provisoire = `${fichier}.${description.pid}.tmp`
    writeFileSync(provisoire, JSON.stringify(description, null, 2), 'utf8')
    renameSync(provisoire, fichier)
  } catch (erreur) {
    // Sans fichier, aucun script ne trouve le serveur : un port ouvert pour personne ne sert à rien.
    await serveur.arreter()
    throw erreur
  }
  let arrete = false
  return {
    url: serveur.url,
    port: serveur.port,
    fichier,
    arreter: async () => {
      if (arrete) return
      arrete = true
      // On ne retire que NOTRE fichier : une instance relancée entre-temps a pu écrire le sien.
      try {
        const lu = JSON.parse(readFileSync(fichier, 'utf8')) as Partial<DescriptionPointEntree>
        if (lu.jeton === serveur.jeton) rmSync(fichier, { force: true })
      } catch {
        // Fichier déjà absent ou illisible : rien à retirer.
      }
      await serveur.arreter()
    }
  }
}
