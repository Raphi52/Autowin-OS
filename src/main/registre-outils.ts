import { CATALOG, OUTILS_DEBRANCHES } from './commands'
import { seedRegistrySnapshot, type RegistryItem } from './native-registry'

/**
 * LES LIGNES DE L'ÉCRAN DES OUTILS, amorcées à chaque démarrage (index.ts).
 *
 * DÉFAUT VÉCU (conv-353, 2026-10-19, reproduit par `registre-outils.redemarrage.test.ts`) : le
 * registre était amorcé depuis `bus.catalog()`, c'est-à-dire la liste DÉJÀ FILTRÉE par l'interrupteur
 * de ce même registre. Un outil coupé à l'écran sortait donc du catalogue enregistré au démarrage
 * suivant ; l'interrupteur, ne trouvant plus sa ligne, le disait actif par défaut. Résultat mesuré
 * sur trois redémarrages : l'outil disparaissait de l'écran (impossible à rallumer : « Capacité
 * inconnue ») et redevenait offert aux agents un démarrage sur deux.
 *
 * Les lignes viennent donc du catalogue COMPLET. Seuls les outils débranchés dans le code
 * (`OUTILS_DEBRANCHES`) en sont exclus : un interrupteur sur eux n'aurait aucun effet.
 */
export function lignesDuRegistreOutils(): RegistryItem[] {
  return CATALOG.filter((command) => !OUTILS_DEBRANCHES.has(command.name)).map((command) => ({
    id: command.name,
    label: command.name,
    description: command.description,
    enabled: true,
    mutable: true,
    source: 'app-command-bus'
  }))
}

/** Amorce le registre des outils sans jamais perdre un interrupteur déjà posé. */
export function amorcerRegistreOutils(base?: string): void {
  seedRegistrySnapshot({ tools: lignesDuRegistreOutils() }, base)
}
