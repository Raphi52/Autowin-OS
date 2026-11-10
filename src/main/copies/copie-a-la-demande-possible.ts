import { join } from 'node:path'
import { autowinAppDataRoot } from '../app/app-data'
import { dossierModAutowin, gardeNpmDuDepot } from '../providers/claude'
import { FICHIER_CONTROLES_DE_CONFIANCE, controleDeCopiePret } from '../providers/hooks-des-cli'

/** Les CLI dont le contrôle avant outil vit dans leurs réglages personnels, hors de l'app. */
const CLI_A_CONTROLE_PERSONNEL = new Set(['codex', 'grok', 'agy'])

/**
 * LE TOUR PEUT-IL PARTIR SANS COPIE, POUR L'OUVRIR À SA PREMIÈRE ÉCRITURE ?
 *
 * Oui seulement si le contrôle lancé avant chaque outil du modèle la demandera. Claude le reçoit de
 * l'app à chaque lancement. Codex, Grok et agy le tiennent de leurs réglages personnels, que l'app
 * ne pose pas elle-même : on les relit (`controleDeCopiePret`). Absents ou modifiés, ou tout autre
 * modèle : non, et la copie s'ouvre au début du tour, comme avant.
 */
export function copieALaDemandePossible(
  provider: string | undefined,
  cwd: string,
  pret: typeof controleDeCopiePret = controleDeCopiePret
): boolean {
  if (provider === 'claude') return true
  if (!provider || !CLI_A_CONTROLE_PERSONNEL.has(provider)) return false
  return pret({
    provider,
    // Le script du dépôt de l'app, jamais celui d'une copie : c'est lui que nomment ces réglages.
    scriptNpm: gardeNpmDuDepot(
      dossierModAutowin([typeof __dirname === 'string' ? __dirname : undefined])
    ),
    cwd,
    controlesDeConfiance: join(autowinAppDataRoot(), FICHIER_CONTROLES_DE_CONFIANCE)
  })
}
