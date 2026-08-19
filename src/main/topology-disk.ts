import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ImportedModel } from './models'
import {
  assertTopology,
  assertTopologyAgainstAvailableModels,
  createDefaultTopology,
  migrateTopologyShape,
  type AgentTopology
} from './topology'

/**
 * Pourquoi un chargement de topologie a echoue.
 *
 * `acces` : le fichier existe (ou son chemin est occupe) mais n'a pas pu etre LU — permission,
 * verrou, chemin qui est un dossier. `contenu-invalide` : il a ete lu, mais son contenu ne fait pas
 * une topologie — JSON casse, ou structure refusee par la validation.
 *
 * L'ABSENCE n'est pas un incident : c'est un premier demarrage.
 */
export type CauseIncidentTopologie = 'acces' | 'contenu-invalide'

export interface IncidentTopologie {
  cause: CauseIncidentTopologie
  chemin: string
  detail: string
}

/** Codes systeme qui disent « je n'ai pas pu lire », par opposition a « il n'y a rien a lire ». */
const CODES_ACCES = new Set(['EACCES', 'EPERM', 'EBUSY', 'EISDIR', 'EMFILE', 'ENFILE', 'EIO'])

function causeDeLIncident(erreur: unknown): CauseIncidentTopologie | 'absent' {
  const code = (erreur as { code?: unknown } | null)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'absent'
  return typeof code === 'string' && CODES_ACCES.has(code) ? 'acces' : 'contenu-invalide'
}

/**
 * Charge la topologie, en distinguant les echecs au lieu de les confondre.
 *
 * Candidat du scout interne de l'app (score 91), cadre par l'app elle-meme : le `catch` attrapait
 * TOUTE exception et rendait la topologie par defaut. Un fichier absent le justifie — c'est un
 * premier demarrage. Mais une erreur d'ACCES faisait remplacer silencieusement la topologie
 * configuree par l'utilisateur : ses reglages de roles disparaissaient sans un mot, et il croyait
 * que l'app avait oublie.
 *
 * Le repli est CONSERVE dans tous les cas — y compris sur contenu invalide, decision deja encodee
 * par le test « falls back to a valid default when persisted JSON is corrupt » et dont le cadrage
 * avait note le risque en « Eleve » : rendre visible une corruption jusque-la masquee peut
 * interrompre le demarrage. Ce qui change, c'est qu'aucun de ces cas n'est plus SILENCIEUX :
 * `onIncident` les nomme, avec leur cause. Sans rapporteur, le comportement est identique a avant.
 */
export function loadAgentTopology(
  path: string,
  models: ImportedModel[],
  onIncident?: (incident: IncidentTopologie) => void
): AgentTopology {
  try {
    const parsed = migrateTopologyShape(JSON.parse(readFileSync(path, 'utf8'))) as AgentTopology
    return assertTopologyAgainstAvailableModels(parsed, models)
  } catch (erreur) {
    const cause = causeDeLIncident(erreur)
    if (cause !== 'absent') {
      onIncident?.({
        cause,
        chemin: path,
        detail: erreur instanceof Error ? erreur.message : String(erreur)
      })
    }
    return createDefaultTopology(models)
  }
}

export function saveAgentTopology(
  path: string,
  topology: AgentTopology,
  models: ImportedModel[]
): AgentTopology {
  const validated = assertTopology(topology, models)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(validated, null, 2), 'utf8')
  renameSync(temporary, path)
  return validated
}
