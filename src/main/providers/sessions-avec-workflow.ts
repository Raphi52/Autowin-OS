import { ensureAutowinAppData } from '../app/app-data'
import { creerIndexStore } from '../runs/json-index-store'

/**
 * LES SESSIONS DU CLI QUI ONT DÉJÀ L'OUTIL `Workflow` — pour qu'il n'en soit plus jamais retiré.
 *
 * `Workflow` n'est chargé que sur une demande de gros chantier (`demandeUnChantier`,
 * claude-workflow.ts). Le tour suivant de la même session ne le demandait plus : l'outil disparaissait
 * de la liste, et une liste d'outils qui change fait relire toute la conversation hors cache. Mesure
 * du 2026-11-08 (`scripts/poids-du-contexte.mjs`, rubrique « Fils repris ») : la session 5595d443 a
 * payé deux fois, à l'ajout (1,25 $) puis au retrait (1,39 $). Le garder ensuite coûte ses 8 242
 * jetons relus au 1/40e du prix, soit des centaines d'étapes avant d'égaler un seul retrait.
 *
 * Sur disque parce que la reprise survit à un redémarrage de l'app (`chat-session-store.ts`) : un
 * index en mémoire seule ferait retomber l'outil, donc relire la conversation, au premier tour qui
 * suit. Valeur : l'instant d'enregistrement, qui borne l'index à `DUREE_DE_GARDE_MS`.
 */
const store = creerIndexStore<number>(
  'sessions-avec-workflow.json',
  (valeur): valeur is number => typeof valeur === 'number' && Number.isFinite(valeur)
)

/** Au-delà, la session n'est plus reprise (le poids ou le temps l'a remplacée) : l'entrée part. */
export const DUREE_DE_GARDE_MS = 7 * 24 * 3_600_000

let enMemoire: { base: string; index: Record<string, number> } | undefined

function index(base: string): Record<string, number> {
  if (enMemoire?.base !== base) enMemoire = { base, index: store.lire(base) }
  return enMemoire.index
}

/** La session reprise porte-t-elle déjà `Workflow` ? Faux sans session. */
export function sessionAvecWorkflow(
  sessionId: string | undefined,
  base = ensureAutowinAppData()
): boolean {
  return !!sessionId && sessionId in index(base)
}

/** Retient qu'une session a reçu `Workflow`, et oublie celles plus vieilles que la durée de garde. */
export function retenirSessionAvecWorkflow(
  sessionId: string,
  base = ensureAutowinAppData(),
  maintenant = Date.now()
): void {
  if (!sessionId) return
  const courant = index(base)
  if (sessionId in courant) return
  const garde = Object.fromEntries(
    Object.entries(courant).filter(([, instant]) => maintenant - instant < DUREE_DE_GARDE_MS)
  )
  garde[sessionId] = maintenant
  enMemoire = { base, index: garde }
  store.ecrire(garde, base)
}

/** Tests : oublie le miroir en mémoire, pour relire le disque. */
export function oublierMiroirSessionsAvecWorkflow(): void {
  enMemoire = undefined
}
