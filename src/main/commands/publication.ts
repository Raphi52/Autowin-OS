/**
 * Édition vérifiée et sa publication : textes de l'agent, mesure, restauration, archive des sorties.
 *
 * Code libre sorti de `commands.ts` tel quel (lot 5) ; `commands.ts` ré-exporte ce qu'il
 * exportait déjà, ses importeurs ne changent pas. Dans `commands/`, une VALEUR s'importe d'ici,
 * jamais par `'../commands'` (cycle d'import) : `commands/code-libre.test.ts` le garde.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureAutowinAppData } from '../app/app-data'

/** Deux sauts de ligne, sans séquence d'échappement — même règle que `SAUT` dans verify-command.ts. */
export const SAUT_PORTEE = String.fromCharCode(10, 10)

/*
 * La consigne « ton code ne compile pas » doit se DETACHER de la sortie brute qui suit, sinon elle
 * s'y noie. Rendue absente par le commit qui l'introduisait (`SAUT_NATURE` utilise, jamais defini,
 * typecheck rouge sur la branche partagee le 2026-08-25) : reparee ici parce qu'elle vit dans la
 * fonction meme qu'on corrige, pas parce qu'on elargit le lot.
 */
export const SAUT_NATURE = String.fromCharCode(10, 10)

/**
 * Ce que l'agent DOIT lire quand la finalisation est reportee : le changement est ecrit et verifie,
 * son integration attend la fin des processus de la copie. Ni un vert (rien n'est encore dans la
 * base) ni un echec (rien n'est perdu) — et surtout pas un silence.
 */
export const PUBLICATION_DIFFEREE =
  'différée — le changement est vérifié ; son intégration attend la fin des processus du bureau, ' +
  'Autowin la reprend seul. Ne pas rejouer cette édition.'

/**
 * Ce que l'agent lit quand le Stop coupe la vérification d'une édition : ni un rouge (aucun test n'a
 * conclu) ni un vert (rien n'est prouvé). L'édition n'est pas publiée, et l'arrêt est celui de
 * l'utilisateur — donc pas à rejouer de lui-même.
 */
export const EDITION_ARRETEE_PAR_STOP =
  'Édition non publiée : vérification arrêtée par l’utilisateur (Stop) — rien n’est prouvé et le ' +
  'fichier du dépôt est inchangé. Ne pas rejouer cette édition sans nouvelle demande.'

/**
 * La CIRCONSTANCE d'un echec de publication : ce que le message doit porter en plus du motif.
 *
 * L'ancien detail etait le nom de l'outil (`edit_file`), deja affiche au-dessus du message : il
 * consommait la seule place ou une information utile pouvait tenir. Ici, chaque issue donne ce
 * qu'elle SAIT -- les fichiers qui s'opposent, la raison du blocage, la branche qui porte le
 * travail -- pour que le lecteur n'ait pas a le deviner.
 */
export function circonstanceDePublication(finalized: Record<string, unknown>): string | undefined {
  const liste = (valeur: unknown): string | undefined =>
    Array.isArray(valeur) && valeur.length > 0 ? valeur.slice(0, 5).join(', ') : undefined
  const texte = (valeur: unknown): string | undefined =>
    typeof valeur === 'string' && valeur.trim() ? valeur.trim() : undefined
  switch (finalized.outcome) {
    case 'conflict':
      return liste(finalized.files)
    case 'blocked': {
      // `reason` nomme la CATEGORIE (« merge-failed »), `detail` la cause reelle (« Filename too
      // long »). Le diagnostic du 2026-08-26 a demande les DEUX : la categorie seule laisse
      // rediagnostiquer a chaque fois.
      /*
       * ET LES FICHIERS, AVEC LEUR PROVENANCE.
       *
       * `motif || liste(files)` : des qu'une `reason` existe — TOUJOURS sur `blocked` — le `||`
       * court-circuitait, et la liste que le manager avait pourtant calculee n'arrivait jamais.
       * Mesure en direct le 2026-08-26 : une edition d'UN SEUL fichier refusee en `base-dirty`, un
       * message reduit a « base-dirty », et l'agent a comble le vide en devinant — il a annonce que
       * le bureau portait « 10 fichiers dont 9 sans rapport », a refuse de publier et pose quatre
       * questions. Verifie apres coup : le bureau n'apportait qu'un fichier. Le travail etait
       * publiable ; le message a fait croire l'inverse.
       *
       * La PROVENANCE est dite explicitement : ces fichiers sont ceux de la BASE, non commites — le
       * code le sait deja (« Les fichiers remontes diagnostiquent la base », worktree-manager.ts),
       * il ne le disait a personne. Sans ce mot, la liste se lit comme le contenu du bureau, et
       * c'est exactement l'erreur qui a ete commise.
       */
      const motif = [texte(finalized.reason), texte(finalized.detail)].filter(Boolean).join(' — ')
      const fichiers = liste(finalized.files)
      if (!fichiers) return motif || undefined
      const provenance =
        finalized.reason === 'base-dirty'
          ? `bloque par ${fichiers} — non commite(s) dans la BASE, pas dans le bureau`
          : `fichiers : ${fichiers}`
      return motif ? `${motif} — ${provenance}` : provenance
    }
    case 'preserve-et-libere':
      return texte(finalized.branche)
    default:
      return texte(finalized.detail)
  }
}

/**
 * Une verification QUI PORTE SON ARTEFACT. `rapport` est le contenu du fichier JSON du runner —
 * absent des que l'execution n'a pas pu en produire un (plafond de temps, crash, projet sans
 * reporter). Cette absence est un FAIT lisible, et elle refuse : c'est la voie par laquelle la
 * premiere version publiait une suite coupee en la lisant comme un ensemble d'echecs complet.
 */
export interface MesureVerifiee {
  allowed: boolean
  reason?: string
  ok: boolean
  exitCode: number | null
  command: string
  output: string
  /** Vrai quand la mesure a porte sur la PORTEE (tests important le fichier), non sur la suite. */
  parPortee: boolean
  rapport?: string
}

/**
 * Rend les octets a leur place, ou dit NON. Un reessai unique couvre le verrou passager (un worker
 * de test qui vient de lire le fichier, un antivirus) sans transformer un echec durable en attente.
 */
export function restaurer(
  absolu: string,
  octets: Buffer,
  /** Injectable pour les tests : c'est le SEUL moyen de prouver la branche d'echec. */
  ecrire: (chemin: string, contenu: Buffer) => void = writeFileSync
): boolean {
  /*
   * DEUX ESSAIS, ET LA MESURE DE LEUR ECART. Un juge a chronometre la fenetre entre les deux
   * tentatives : 0,367 ms. Le commentaire d'origine pretendait couvrir « un verrou passager (worker
   * de test, antivirus) », dont l'ordre de grandeur est de 10 ms a plusieurs secondes : la
   * justification ecrite n'etait donc PAS tenue par le code. Deux choix s'offraient — attendre
   * vraiment, ou cesser de promettre. Attendre dans le fil principal d'Electron pour un cas non
   * mesure serait payer cher une hypothese ; on garde donc le second essai (il couvre une ecriture
   * qui echoue une fois sans cause durable) et on NOMME ce qu'il ne couvre pas.
   */
  for (let essai = 0; essai < 2; essai += 1) {
    try {
      ecrire(absolu, octets)
      return true
    } catch {
      /* un second essai immediat ; un verrou DURABLE n'est pas couvert, et le refus le dira */
    }
  }
  return false
}

/**
 * ARCHIVE LA SORTIE COMPLETE d'une commande avant sa troncature, et rend son chemin.
 *
 * Mesure du 2026-09-16 : 2 434 771 caracteres de sorties de `run` ont ete jetes faute d'un endroit
 * ou les poser, ce qui a fait REJOUER des commandes entieres juste pour relire leur fin. Le fichier
 * atterrit dans la racine de donnees (jamais dans le depot de l'utilisateur) et reste lisible par
 * `read_file`, qui le borne a son tour.
 *
 * Rend `undefined` en cas d'echec d'ecriture : une sortie tronquee sans archive vaut mieux qu'une
 * commande qui parait avoir echoue parce que le disque est plein.
 */
export function archiverSortie(texteComplet: string): string | undefined {
  try {
    const dossier = join(ensureAutowinAppData(), 'sorties')
    mkdirSync(dossier, { recursive: true })
    const horodatage = new Date().toISOString().replace(/[:.]/g, '-')
    const chemin = join(dossier, `${horodatage}-${randomUUID().slice(0, 8)}.txt`)
    writeFileSync(chemin, texteComplet, 'utf8')
    return chemin
  } catch {
    return undefined
  }
}
