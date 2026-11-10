import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { depotPrincipalSurDisque } from '../git/depot-git'

/**
 * UN GESTIONNAIRE DE COPIES PAR DÉPÔT.
 *
 * Un gestionnaire de copies est lié à UN dépôt : il y crée la copie d'un run et y fait entrer son
 * travail. L'app n'en ouvrait qu'un, sur le dossier principal. Un run lancé depuis un fil rangé sur un
 * autre dépôt recevait donc le bon dossier de lecture, mais une copie du dossier principal : l'agent
 * travaillait dans le mauvais projet. Ici, le dépôt du run choisit le gestionnaire ; celui d'un autre
 * dépôt est ouvert à la première demande, puis gardé.
 */
const cle = (dossier: string): string =>
  resolve(dossier).replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase()

export class CoordinateursParDepot<C> {
  private readonly autres = new Map<string, C>()

  constructor(
    private readonly principal: { depot: string; coordinateur: () => C | undefined },
    /** Ouvre le gestionnaire d'un autre dépôt ; `undefined` s'il ne peut pas l'être. */
    private readonly ouvrir: (depot: string) => C | undefined,
    private readonly depotDe: (dossier: string) => string | undefined = depotPrincipalSurDisque,
    private readonly estUnDepot: (dossier: string) => boolean = (dossier) =>
      existsSync(join(dossier, '.git'))
  ) {}

  /**
   * La RACINE du dépôt qui porte `dossier` : celle du dossier principal pour lui et ses copies, celle
   * d'un autre dépôt sinon. Sans dossier : le dossier principal. Hors de tout dépôt : `undefined`.
   * C'est là que se publie un run vert — jamais dans une copie de travail.
   */
  depotPour(dossier?: string): string | undefined {
    const voulu = dossier?.trim()
    if (!voulu || cle(voulu) === cle(this.principal.depot)) return this.principal.depot
    const depot = this.depotDe(voulu)
    if (!depot) return undefined
    return cle(depot) === cle(this.principal.depot) ? this.principal.depot : depot
  }

  /**
   * Le gestionnaire du dépôt qui porte `dossier`. Sans dossier, ou pour le dossier principal et ses
   * copies : celui du dossier principal, comme avant. Pour un dossier hors de tout dépôt : aucun — une
   * copie du dossier principal n'y serait pas la sienne, et le run doit le dire au lieu de s'y tromper.
   */
  pour(dossier?: string): C | undefined {
    const depot = this.depotPour(dossier)
    if (!depot) return undefined
    const cleDuDepot = cle(depot)
    if (cleDuDepot === cle(this.principal.depot)) return this.principal.coordinateur()
    const ouvert = this.autres.get(cleDuDepot)
    if (ouvert) return ouvert
    // Un échec d'ouverture n'est pas gardé : le run suivant réessaie, au lieu de refuser ce dépôt
    // jusqu'au redémarrage de l'app.
    const nouveau = this.estUnDepot(depot) ? this.ouvrir(depot) : undefined
    if (nouveau) this.autres.set(cleDuDepot, nouveau)
    return nouveau
  }

  /** Tous les gestionnaires ouverts, celui du dossier principal en tête. */
  tous(): C[] {
    return [this.principal.coordinateur(), ...this.autres.values()].filter(
      (coordinateur): coordinateur is C => coordinateur !== undefined
    )
  }

  /** Des gestionnaires d'autres dépôts sont-ils ouverts ? Sinon, tout se lit sur le principal seul. */
  plusieurs(): boolean {
    return this.autres.size > 0
  }
}
