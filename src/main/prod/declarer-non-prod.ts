/**
 * DÉCLARER UNE CIBLE HORS PRODUCTION EN UN CLIC (conv-2195).
 *
 * LE DÉFAUT VÉCU. L'utilisateur écrit « non prod, go, autorisation pour tout » sur une copie de test.
 * Le terminal de l'agent refuse quand même `sqlcmd`, parce que la base n'est pas dans
 * `prod-autorite.json`, et ce fichier ne s'écrivait qu'À LA MAIN : l'agent l'a donc renvoyé éditer
 * du JSON dans un dossier de données. Son accord explicite ne menait nulle part.
 *
 * LA VOIE. L'agent appelle l'outil `declarer_hors_production` ; la demande s'ouvre DANS LE FIL, par le
 * même guichet que les accès à la production ; l'utilisateur clique (ou saisit sa phrase de passe si
 * c'est le niveau qu'il a choisi) ; l'application AJOUTE alors la ligne au fichier. Le terminal la
 * relit à chaque appel SQL (`basesNonProdDuTexte`), donc l'agent continue dans le même tour.
 *
 * CE QUI NE CHANGE PAS : le modèle n'écrit toujours pas ce fichier (hook `refusReglageProd`), et rien
 * ne s'y ajoute sans un geste de l'utilisateur dans la fenêtre — le clic ne peut venir que du guichet.
 * Et la voie n'ouvre QUE ce qui n'est pas déjà fermé :
 *   - une cible déclarée `prod` par l'utilisateur reste prod (seul lui la change, dans son fichier) ;
 *   - une base EXPLOITÉE selon le catalogue SQL, ou un serveur qui en héberge, est refusée sans même
 *     demander : un clic distrait ne doit pas ouvrir une base exploitée ;
 *   - le niveau `aucun` ne dispense PAS du clic : déclarer, c'est ouvrir l'écriture aux agents.
 * Le fichier existant est COMPLÉTÉ, jamais réécrit depuis sa lecture validée : une entrée fautive de
 * l'utilisateur reste où elle est. Un fichier illisible n'est pas touché.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { NiveauProtectionProd } from '../../shared/prod-protection'
import { chargerAutoriteProd, cheminAutoriteProd } from '../store/prod-autorite-store'
import { classerCible, type Cible } from './prod-guard'
import { nommerCible, type PorteProd } from './prod-gate'
import type { GuichetProd } from './prod-guichet'
import type { LectureBasesExploitees } from './sql-read-catalog'

export const OPERATION_DECLARATION = 'déclarer hors production (lecture ET écriture par les agents)'

export interface DeclarerNonProdPorts {
  /** Dossier de données d'Autowin, où vit `prod-autorite.json`. */
  racine: string
  conversationId?: string
  guichet?: GuichetProd
  /** Sert seulement au niveau `phrase` : c'est la porte qui valide le jeton saisi. */
  porte?: PorteProd
  niveau(): NiveauProtectionProd
  basesExploitees(): Promise<LectureBasesExploitees>
  /**
   * La base CATALOGUE et son serveur (`sql-catalog.json`) : absents de la liste des bases exploitées,
   * ils n'en sont pas moins de la production. Vrai → refus d'office.
   */
  estCatalogue?(nature: 'base' | 'serveur', nom: string): boolean
  maintenant?(): Date
}

export type ResultatDeclaration =
  | { ok: true; dejaDeclaree: boolean; message: string }
  | { ok: false; raison: string }

const NOM_VALIDE = /^[A-Za-z0-9_.$\\-]{1,128}$/

export async function declarerNonProd(
  args: { nature?: unknown; nom?: unknown; motif?: unknown },
  ports: DeclarerNonProdPorts
): Promise<ResultatDeclaration> {
  const nature = args.nature === undefined ? 'base' : args.nature
  if (nature !== 'base' && nature !== 'serveur') {
    return { ok: false, raison: 'nature attendue : « base » ou « serveur ».' }
  }
  const nom = typeof args.nom === 'string' ? args.nom.trim() : ''
  if (!NOM_VALIDE.test(nom)) {
    return { ok: false, raison: `nom de ${nature} invalide : « ${String(args.nom ?? '')} ».` }
  }
  const cible: Cible = { nature, nom }

  const actuelle = classerCible(cible, chargerAutoriteProd(ports.racine).autorite)
  if (actuelle.classe === 'prod') {
    return {
      ok: false,
      raison: `${nommerCible(cible)} est déclarée PRODUCTION dans prod-autorite.json : seul l'utilisateur peut la reclasser, dans ce fichier.`
    }
  }
  if (actuelle.classe === 'non-prod') {
    return { ok: true, dejaDeclaree: true, message: `${nommerCible(cible)} est déjà déclarée hors production.` }
  }

  if (ports.estCatalogue?.(nature, nom)) {
    return {
      ok: false,
      raison: `${nommerCible(cible)} porte le catalogue SQL de production : elle ne se déclare pas hors production.`
    }
  }

  const lecture = await ports.basesExploitees()
  if (lecture.ok) {
    const cle = nom.toLowerCase()
    const exploitee = lecture.exploitees.some((t) =>
      nature === 'base'
        ? (t.database ?? '').trim().toLowerCase() === cle
        : (t.server ?? '').trim().toLowerCase() === cle
    )
    if (exploitee) {
      return {
        ok: false,
        raison:
          nature === 'base'
            ? `${nom} est une base EXPLOITÉE selon le catalogue SQL : elle ne se déclare pas hors production.`
            : `le serveur ${nom} héberge des bases EXPLOITÉES selon le catalogue SQL : déclare la base de test elle-même.`
      }
    }
  }

  if (!ports.guichet) {
    return { ok: false, raison: 'aucune fenêtre pour demander l’accord de l’utilisateur : rien n’est déclaré.' }
  }
  const niveau = ports.niveau() === 'phrase' ? 'phrase' : 'confirmation'
  const motif = typeof args.motif === 'string' ? args.motif.trim().slice(0, 200) : ''
  const raison =
    `Les agents pourront LIRE ET ÉCRIRE dans ${nature === 'serveur' ? 'toutes les bases de ce serveur' : 'cette base'} ` +
    'depuis leur terminal, sans autre confirmation.' +
    (motif ? ` Motif donné : ${motif}.` : '') +
    (lecture.ok
      ? ' Absente des bases exploitées du catalogue.'
      : ` Catalogue des bases exploitées illisible (${lecture.erreur}) : vérifie toi-même que ce n’est pas une base exploitée.`)
  const reponse = await ports.guichet.demander({
    cible: nommerCible(cible),
    operation: OPERATION_DECLARATION,
    raison,
    niveau,
    ...(ports.conversationId ? { conversationId: ports.conversationId } : {})
  })
  if (!reponse) {
    return { ok: false, raison: 'l’utilisateur n’a pas confirmé (refus ou délai expiré) : rien n’est déclaré.' }
  }
  if (niveau === 'phrase') {
    if (reponse.type !== 'jeton' || !ports.porte) {
      return { ok: false, raison: 'la phrase de passe est exigée à ce niveau de protection : rien n’est déclaré.' }
    }
    const verdict = ports.porte.verifier({ nature, nom, operation: OPERATION_DECLARATION, jeton: reponse.valeur })
    if (!verdict.autorise) return { ok: false, raison: verdict.motif }
  } else if (reponse.type !== 'confirme') {
    return { ok: false, raison: 'réponse inattendue de la fenêtre : rien n’est déclaré.' }
  }

  const jour = (ports.maintenant?.() ?? new Date()).toISOString().slice(0, 10)
  const ecriture = ajouterEntree(ports.racine, {
    nature,
    nom,
    classe: 'non-prod',
    motif:
      `Déclarée par l'utilisateur d'un clic${ports.conversationId ? ` (${ports.conversationId})` : ''} le ${jour}` +
      (motif ? ` — ${motif}` : '')
  })
  if (!ecriture.ok) return ecriture
  return {
    ok: true,
    dejaDeclaree: false,
    message: `${nommerCible(cible)} déclarée hors production : le terminal des agents l'accepte dès maintenant.`
  }
}

/**
 * AJOUTE une entrée au fichier tel qu'il est : tableau → poussée à la fin ; objet `{ entrees }` →
 * poussée dans `entrees` ; absent → créé. Illisible ou d'une autre forme → on n'y touche pas.
 * Écriture par fichier temporaire puis renommage : un arrêt en plein milieu ne laisse pas un JSON
 * tronqué, qui fermerait toute la production.
 */
function ajouterEntree(
  racine: string,
  entree: { nature: 'base' | 'serveur'; nom: string; classe: 'non-prod'; motif: string }
): { ok: true } | { ok: false; raison: string } {
  const chemin = cheminAutoriteProd(racine)
  let texte: string | undefined
  try {
    texte = readFileSync(chemin, 'utf8')
  } catch {
    texte = undefined
  }
  let brut: unknown = []
  if (texte !== undefined) {
    try {
      brut = JSON.parse(texte)
    } catch {
      return { ok: false, raison: `${chemin} est illisible (JSON invalide) : je n'y écris pas, il faut d'abord le corriger.` }
    }
  }
  let contenu: unknown
  if (Array.isArray(brut)) contenu = [...brut, entree]
  else if (brut && typeof brut === 'object' && Array.isArray((brut as { entrees?: unknown }).entrees)) {
    contenu = { ...(brut as object), entrees: [...(brut as { entrees: unknown[] }).entrees, entree] }
  } else {
    return { ok: false, raison: `${chemin} n'a pas la forme attendue (tableau ou { entrees }) : je n'y écris pas.` }
  }
  const temporaire = `${chemin}.${process.pid}.tmp`
  writeFileSync(temporaire, `${JSON.stringify(contenu, null, 2)}\n`, 'utf8')
  renameSync(temporaire, chemin)
  return { ok: true }
}
