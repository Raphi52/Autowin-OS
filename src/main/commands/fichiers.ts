// Groupe de commandes « lecture et édition de fichiers », sorti de AppCommandBus.run (lot 2).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
// En fin de fichier, les commandes de fichiers tracées (créer, déplacer, supprimer, état d'une copie) :
// méthodes de AppCommandBus sorties telles quelles (lot 6).
import type { AppCommandBus } from './commands'
import { decideRead, executeRead, enumererFichiersLisibles, enumererFichiersLisiblesDetail, rechercherDansFichiers } from './read-file-command'
import { decoderUtf8, refusRacineSysteme } from './edit-file-command'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join, sep, isAbsolute } from 'node:path'
import { lireProprietairesDeFichiers } from '../fichiers/proprietaire-fichier'
import {
  decideCreateFile,
  decideDeleteFile,
  decideMoveFile,
  identifiantDeBureauValide
} from './file-ops-command'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  appendWorkspaceMutationTrace,
  captureMutationTraceBase
} from '../activity/trace-workspace-mutation'

/** Cas de `AppCommandBus.run` : lecture et édition de fichiers. Corps déplacé tel quel depuis commands.ts (lot 2). */
export async function executerFichiers(
  bus: AppCommandBus,
  name: string,
  a: Record<string, unknown>,
  conversationId?: string,
  turnId?: string
): Promise<unknown> {
  switch (name) {
    case 'read_file': {
      const decision = decideRead(
        { path: a.path, from: a.from, lines: a.lines },
        bus.workspaceDuTour
      )
      if (!decision.allowed) return { lu: false, detail: `lecture refusée : ${decision.reason}` }
      /*
       * LA LECTURE DIT QUAND ELLE NE PEUT PAS ETRE FIDELE.
       *
       * `readFileSync(p, 'utf8')` ne jette pas sur une entree invalide : chaque octet non-UTF-8
       * devient `�` en silence. Rien n'est detruit sur le disque, mais la ligne rendue au
       * modele est FAUSSE tout en se presentant comme le contenu du fichier — et il peut batir un
       * `oldText` dessus. On ne REFUSE pas (les lignes ASCII restent vraies et utiles, et un refus
       * de lecture aveuglerait l'agent sans rien proteger) : on NOMME la substitution.
       */
      let encodageNonUtf8 = false
      const lu = executeRead(decision, (absolutePath) => {
        try {
          const decode = decoderUtf8(readFileSync(absolutePath))
          encodageNonUtf8 = !decode.valide
          return decode.texte
        } catch {
          return null
        }
      })
      if ('erreur' in lu) return { lu: false, detail: lu.erreur }
      return {
        lu: true,
        path: lu.relativePath,
        totalLignes: lu.totalLignes,
        tronque: lu.tronque,
        contenu: lu.contenu,
        ...(encodageNonUtf8
          ? {
              encodage:
                'non UTF-8 : des octets ont été remplacés par « � » dans ce rendu — les ' +
                'caractères accentués affichés ne sont PAS ceux du fichier, et `edit_file` ' +
                'refusera de l’écrire tant qu’il n’est pas converti.'
            }
          : {})
      }
    }
    case 'list_files': {
      /**
       * Le NOMBRE est rendu explicitement, pas seulement la liste : la tâche mesurée était
       * « donne-moi le nombre », et laisser l'agent compter lui-même une liste tronquée
       * reproduirait l'approximation qu'on corrige ici. Le plafond est DIT quand il mord, pour
       * qu'un total partiel ne se présente jamais comme un total.
       */
      const racine = resolve(bus.workspaceDuTour)
      const sousDossier = typeof a.dir === 'string' && a.dir.trim() ? a.dir.trim() : ''
      const recursif = a.recursif === true || a.recursif === 'true'
      const cible = resolve(join(racine, sousDossier))
      // Le dossier demandé doit rester DANS le workspace : `..` ne doit pas ouvrir le disque.
      if (cible !== racine && !cible.startsWith(racine + sep)) {
        return { erreur: 'chemin hors du workspace', dossier: sousDossier }
      }
      let entrees
      try {
        entrees = readdirSync(cible, { withFileTypes: true })
      } catch (erreur) {
        return {
          erreur: erreur instanceof Error ? erreur.message : String(erreur),
          dossier: sousDossier || '.'
        }
      }
      if (!recursif) {
        const fichiers = entrees.filter((e) => e.isFile()).map((e) => e.name)
        const dossiers = entrees.filter((e) => e.isDirectory()).map((e) => e.name)
        /**
         * Le COMPTE PAR SUFFIXE est rendu tout fait — mesuré, il vaut le dernier point sur dix.
         *
         * Avec la seule liste, l'agent devait compter 220 noms À LA MAIN pour répondre « combien de
         * .test.ts ? ». Sur 10 essais il se trompait une fois : l'outil avait bien été appelé (7 s),
         * mais le dénombrement humain d'une longue liste est faillible. Compter est le travail de la
         * machine ; laisser ce calcul au modèle réintroduit l'approximation qu'on venait de retirer.
         */
        const parSuffixe: Record<string, number> = {}
        for (const nom of fichiers) {
          /*
            CHAQUE suffixe possible du nom, pas seulement le premier.

            Première version : coupe au PREMIER point. `git-graph.elisions.test.ts` produisait alors
            `.elisions.test.ts`, si bien que le total de `.test.ts` était FAUX — et l'agent, qui fait
            confiance à ce chiffre, répondait faux avec assurance. Mesuré : 9/10 → 4/10. Un compte
            erroné est pire que pas de compte, puisqu'il supprime le doute qui aurait fait vérifier.

            On indexe donc tous les suffixes : `a.test.ts` alimente `.test.ts` ET `.ts`. La question
            « combien de X » se lit alors directement, quel que soit le découpage demandé.
          */
          for (let i = 0; i < nom.length; i++) {
            if (nom[i] !== '.' || i === 0) continue
            const suffixe = nom.slice(i)
            parSuffixe[suffixe] = (parSuffixe[suffixe] ?? 0) + 1
          }
        }
        return {
          dossier: sousDossier || '.',
          recursif: false,
          nombreFichiers: fichiers.length,
          nombreDossiers: dossiers.length,
          nombreParSuffixe: parSuffixe,
          fichiers,
          dossiers
        }
      }
      const PLAFOND = 5_000
      const tous = enumererFichiersLisibles(racine, sousDossier, PLAFOND)
      return {
        dossier: sousDossier || '.',
        recursif: true,
        nombreFichiers: tous.length,
        tronque: tous.length >= PLAFOND,
        fichiers: tous
      }
    }
    case 'find_in_files': {
      const motif = typeof a.pattern === 'string' ? a.pattern : ''
      if (!motif.trim()) return { trouve: 0, detail: 'motif manquant' }
      /*
       * MEME PERIMETRE QUE `read_file` ET `edit_file` : un `dir` ABSOLU vise un autre depot.
       * Sans ca, `find_in_files` restait confine alors que la lecture et l'ecriture ne l'etaient
       * plus — et l'agent retombait sur `Select-String` en PowerShell, hors de toute borne.
       * Les zones interdites (`isForbidden`) restent appliquees par `rechercherDansFichiers`.
       */
      const dirDemande = typeof a.dir === 'string' && a.dir.trim() ? a.dir.trim() : ''
      const dirExterne = dirDemande !== '' && isAbsolute(dirDemande)
      if (dirExterne) {
        const refus = refusRacineSysteme(resolve(dirDemande)) ?? refusRacineSysteme(dirDemande)
        if (refus) return { trouve: 0, detail: `recherche refusée : ${refus}` }
      }
      const racine = dirExterne ? resolve(dirDemande) : resolve(bus.workspaceDuTour)
      const sousDossier = dirExterne ? '' : dirDemande
      const enumeration = enumererFichiersLisiblesDetail(racine, sousDossier)
      const fichiers = enumeration.fichiers
      // MEME CAUSE QUE `read_file` : un fichier non-UTF-8 rend des lignes ou `�` a remplace
      // des octets. On continue de le chercher (l'ASCII y est vrai) mais on le NOMME.
      const nonUtf8: string[] = []
      const resultat = rechercherDansFichiers(motif, fichiers, (relatif) => {
        try {
          const decode = decoderUtf8(readFileSync(join(racine, relatif)))
          if (!decode.valide) nonUtf8.push(relatif)
          return decode.texte
        } catch {
          return null
        }
      })
      if (resultat.erreur) return { trouve: 0, detail: resultat.erreur }
      const cites = new Set(resultat.correspondances.map((c) => c.chemin))
      // Seuls les fichiers effectivement CITES comptent : signaler ceux qu'aucune correspondance
      // ne mentionne noierait l'avertissement dans une liste sans rapport avec la reponse.
      const suspects = nonUtf8.filter((chemin) => cites.has(chemin))
      return {
        trouve: resultat.correspondances.length,
        tronque: resultat.tronque,
        correspondances: resultat.correspondances.map(
          (c) => `${c.chemin}:${c.ligne}: ${c.texte}`
        ),
        ...(suspects.length > 0 ? { fichiersNonUtf8: suspects } : {}),
        // Plafond d'énumération atteint : une absence de résultat ne prouve PAS l'absence du motif.
        ...(enumeration.incomplet
          ? {
              incomplet: true,
              detail: `recherche INCOMPLÈTE : plafond de ${fichiers.length} fichiers atteint avant la fin du dossier — resserre \`dir\` sur un sous-dossier`
            }
          : {})
      }
    }
    case 'edit_file': {
      return await bus.runTracedEditFile(
        { path: a.path, oldText: a.oldText, newText: a.newText },
        conversationId,
        turnId
      )
    }
    case 'create_file':
      return await bus.runTracedFileCommand(
        [a.path],
        () => bus.runCreateFile({ path: a.path, content: a.content }),
        conversationId,
        turnId
      )
    case 'move_file':
      return await bus.runTracedFileCommand(
        [a.from, a.to],
        () => bus.runMoveFile({ from: a.from, to: a.to }),
        conversationId,
        turnId
      )
    case 'delete_file':
      return await bus.runTracedFileCommand(
        [a.path],
        () => bus.runDeleteFile({ path: a.path }),
        conversationId,
        turnId
      )
    case 'run_status':
      return await bus.runWorktreeStatus(a.agentId)
    case 'proprietaire_fichier':
      return await lireProprietairesDeFichiers({
        workspace: bus.workspaceDuTour,
        chemins: a.chemins,
        ...(conversationId ? { conversationId } : {})
      })
    default:
      throw new Error(`commande inconnue: ${name}`)
  }
}

/**
 * CREER / DEPLACER / SUPPRIMER — ecriture DIRECTE dans l'espace de travail, bornes de `edit_file`.
 *
 * Pas de bureau isole ici, et c'est un CHOIX assume, pas un oubli : la machinerie
 * `withIsolatedMutation` existe pour publier une edition SEULEMENT si la suite reste verte, or
 * elle raisonne sur la portee d'un fichier EDITE (`porteeDUneEdition`) — un fichier qui n'existe
 * pas encore, ou qui vient de disparaitre, n'a pas de portee derivable. Le garde-fou reste donc
 * celui qui compte : les bornes pures de `file-ops-command.ts`, plus `verify` que l'agent doit
 * lancer ensuite (la description de chaque commande le dit).
 */
/**
 * JOURNAL DES FICHIERS pour create/move/delete_file : seule `edit_file` y écrivait, donc ces
 * mutations restaient invisibles dans l'onglet Fichiers. Une commande refusée n'écrit rien.
 */
export async function runTracedFileCommand<R extends { allowed: boolean }>(
  bus: AppCommandBus,
  rawPaths: unknown[],
  run: () => R,
  conversationId?: string,
  turnId?: string
): Promise<R> {
  const workspaceRoot = bus.workspaceDuTour
  const paths = rawPaths.filter((path): path is string => typeof path === 'string')
  const before = conversationId
    ? await captureMutationTraceBase(workspaceRoot, paths)
    : undefined
  const outcome = run()
  if (outcome.allowed && conversationId) {
    await appendWorkspaceMutationTrace({
      conversationId,
      ...(turnId ? { turnId } : {}),
      workspaceRoot,
      source: 'file_command',
      paths,
      before
    })
  }
  return outcome
}

export function runCreateFile(bus: AppCommandBus, input: { path: unknown; content: unknown }): {
  allowed: boolean
  reason?: string
  path?: string
  octets?: number
} {
  const decision = decideCreateFile(input, bus.workspaceDuTour, existsSync)
  if (!decision.allowed) return { allowed: false, reason: decision.reason }
  mkdirSync(dirname(decision.absolutePath), { recursive: true })
  writeFileSync(decision.absolutePath, decision.content, 'utf8')
  return {
    allowed: true,
    path: decision.relativePath,
    octets: Buffer.byteLength(decision.content, 'utf8')
  }
}

export function runMoveFile(bus: AppCommandBus, input: { from: unknown; to: unknown }): {
  allowed: boolean
  reason?: string
  from?: string
  to?: string
} {
  const decision = decideMoveFile(input, bus.workspaceDuTour, existsSync)
  if (!decision.allowed) return { allowed: false, reason: decision.reason }
  mkdirSync(dirname(decision.cibleAbsolue), { recursive: true })
  renameSync(decision.sourceAbsolue, decision.cibleAbsolue)
  return { allowed: true, from: decision.sourceRelative, to: decision.cibleRelative }
}

export function runDeleteFile(bus: AppCommandBus, input: { path: unknown }): {
  allowed: boolean
  reason?: string
  path?: string
} {
  const decision = decideDeleteFile(input, bus.workspaceDuTour, existsSync)
  if (!decision.allowed) return { allowed: false, reason: decision.reason }
  // `recursive: false` : cette commande supprime UN fichier, jamais une arborescence.
  rmSync(decision.absolutePath, { recursive: false })
  return { allowed: true, path: decision.relativePath }
}

/**
 * ETAT DES COPIES DE TRAVAIL, en lecture. La validation d'identifiant est REPRISE ici parce que le
 * bus ne passe pas par `assertTrustedRendererSender` : c'est elle, et non le canal, qui empeche un
 * identifiant fabrique d'atteindre le disque.
 */
export async function runWorktreeStatus(
  bus: AppCommandBus,
  agentId: unknown
): Promise<{ allowed: boolean; reason?: string; status?: unknown; conflit?: unknown }> {
  const status = bus.os.getWorktreeRuntimeStatus()
  if (agentId === undefined || agentId === null || agentId === '') {
    return { allowed: true, status }
  }
  if (!identifiantDeBureauValide(agentId)) {
    return { allowed: false, reason: 'Identifiant de bureau invalide' }
  }
  return { allowed: true, status, conflit: await bus.os.getWorktreeConflictDiff(agentId) }
}
