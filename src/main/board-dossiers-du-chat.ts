/**
 * LA LISTE DES DOSSIERS DU CHAT, GARDÉE PAR LE PROCESSUS PRINCIPAL (conv-1212, 2026-10-28).
 *
 * Le Board ne montre que les dossiers de travail du Chat (`shared/board-dossiers-du-chat.ts`). Cette
 * liste vit dans la vue (`autowin.conv-folders.connus`, stockage local) : le Chat la transmet à
 * chaque changement, et elle est gardée ici sur le poste (`board-dossiers-du-chat.json`). Sans cette
 * copie, la recopie de fin de tour (`board-copie-fin-de-tour.ts`), qui part sans la vue, enverrait
 * sur le partage les dossiers retirés jusqu'à la prochaine ouverture du Chat.
 *
 * Les RETRAITS voyagent avec elle (même jour, 2e demande : toutes les lignes du Board ont une croix,
 * même le dépôt par défaut et « This computer », que le Chat propose toujours) : seule la vue sait
 * qu'une croix les a retirés, et la recopie de fin de tour doit le savoir aussi.
 */
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dossiersDuChatLisibles } from '../shared/board-dossiers-du-chat'

export const FICHIER_DES_DOSSIERS_DU_CHAT = 'board-dossiers-du-chat.json'

export interface ListeDuChat {
  /** Les dossiers du menu « Ranger dans… » du Chat. */
  dossiers: string[]
  /** Les dossiers qu'une croix a retirés (`autowin.conv-folders.retires`). */
  retires: string[]
}

export interface DossiersDuChat {
  /** La dernière liste reçue ; `null` = jamais reçue sur ce poste (le Board reste complet). */
  lire: () => ListeDuChat | null
  /** Retient la liste transmise par la vue ; gardée sur le poste si elle change. */
  retenir: (dossiers: readonly string[], retires?: readonly string[]) => void
  /** Pour les tests : attend la dernière écriture. */
  attendre: () => Promise<void>
}

/**
 * La liste gardée sur le poste ; absente ou illisible = `null`, jamais d'échec. Un tableau seul est
 * la forme d'avant les retraits (premier jet du même jour) : relu sans retrait.
 */
export function lireDossiersDuChatGardes(racine: string): ListeDuChat | null {
  try {
    const brut = JSON.parse(
      readFileSync(join(racine, FICHIER_DES_DOSSIERS_DU_CHAT), 'utf8')
    ) as unknown
    if (Array.isArray(brut)) {
      const dossiers = dossiersDuChatLisibles(brut)
      return dossiers ? { dossiers, retires: [] } : null
    }
    const objet = (brut ?? {}) as { dossiers?: unknown; retires?: unknown }
    const dossiers = dossiersDuChatLisibles(objet.dossiers)
    if (!dossiers) return null
    return { dossiers, retires: dossiersDuChatLisibles(objet.retires ?? []) ?? [] }
  } catch {
    // Absente au premier lancement : le Chat la transmettra dès son ouverture.
    return null
  }
}

export function creerDossiersDuChat(deps: {
  /** Dossier de données du poste ; absent = liste gardée en mémoire seulement. */
  racine?: string
}): DossiersDuChat {
  let liste = deps.racine ? lireDossiersDuChatGardes(deps.racine) : null
  let garde: Promise<void> = Promise.resolve()
  return {
    lire: () => (liste ? { dossiers: [...liste.dossiers], retires: [...liste.retires] } : null),
    retenir(dossiers, retires = []) {
      const nouvelle: ListeDuChat = { dossiers: [...dossiers], retires: [...retires] }
      const texte = JSON.stringify(nouvelle)
      if (liste && JSON.stringify(liste) === texte) return
      liste = nouvelle
      const racine = deps.racine
      if (!racine) return
      garde = garde
        .then(async () => {
          await mkdir(racine, { recursive: true })
          await writeFile(join(racine, FICHIER_DES_DOSSIERS_DU_CHAT), `${texte}\n`, 'utf8')
        })
        .catch((e: unknown) =>
          console.warn('[board] dossiers du Chat non gardés :', e instanceof Error ? e.message : e)
        )
    },
    attendre: () => garde
  }
}
