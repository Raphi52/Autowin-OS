import { statSync } from 'node:fs'

/*
 * CACHE DU WORKER BRAIN INDEXE PAR FICHIER — constat du 2026-09-29 (brain clautilde) : un graph.json
 * reconstruit sur le MEME chemin restait affiche dans son ancienne version (load_graph rendait
 * 300 noeuds / 923 liens depuis la memoire, alors que le fichier en portait 561 / 1 251) jusqu'au
 * redemarrage de l'app, parce que la cle du cache ne portait que le chemin et les options de vue.
 * Chaque entree retient donc la SIGNATURE du fichier lu (date + taille) : un graph.json reecrit est
 * relu au prochain appel, sans redemarrer ni cliquer « Rafraichir ».
 */

/**
 * Signature d'un graphe FICHIER : date de modification + taille. Un DOSSIER (vault de notes) garde
 * une signature fixe : son contenu vit dans des fichiers imbriques que la date du dossier ne reflete
 * pas, et fs-brains.ts tient deja son propre cache de notes ; il se rafraichit par « Rafraichir ».
 */
export function signatureGraphe(path: string): string {
  let stats
  try {
    stats = statSync(path)
  } catch {
    // Chemin absent ou illisible : le chargeur leve lui-meme l'erreur explicite (« graphe
    // introuvable »), et un echec n'est jamais mis en cache — rien n'est donc masque ici.
    return 'illisible'
  }
  return stats.isDirectory() ? 'dossier' : `${stats.mtimeMs}:${stats.size}`
}

/** Cache a une entree par cle, invalidee des que la signature du fichier source change. */
export class CacheParSignature<V> {
  private readonly entrees = new Map<string, { signature: string; valeur: V }>()

  constructor(private readonly signature: (path: string) => string = signatureGraphe) {}

  async obtenir(cle: string, path: string, charger: () => V | Promise<V>): Promise<V> {
    // Signature prise AVANT la lecture : un fichier reecrit pendant le chargement porte deja une
    // autre signature, il sera donc relu au prochain appel au lieu d'etre fige dans sa version lue.
    const signature = this.signature(path)
    const entree = this.entrees.get(cle)
    if (entree && entree.signature === signature) return entree.valeur
    const valeur = await charger()
    // Une reconstruction REMPLACE l'entree de sa cle : la memoire ne grossit pas a chaque rebuild.
    this.entrees.set(cle, { signature, valeur })
    return valeur
  }

  get taille(): number {
    return this.entrees.size
  }
}
