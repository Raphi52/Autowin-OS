/**
 * VUE « BESOINS » — la carte des besoins, lot 1 (conv-1089, 2026-10-22).
 *
 * Demande : « une vue qui agrège les étapes de la carte du fil de toutes les conversations, groupées
 * par projet, avec l'état prouvé de chaque demande et les runs bloqués, sans aucun appel de
 * modèle ». Le calcul vit dans le processus principal (`src/main/carte-des-besoins.ts`) ; ici,
 * l'affichage, le filtre par état et l'ouverture du fil d'une demande.
 *
 * Lot 2 (même jour) : chaque demande montre QUI A PROMPTÉ (identité git, relevée au tour ou déduite
 * du dossier pour les demandes plus anciennes que le journal) et ce que l'agent a déclaré
 * (`AUTOWIN_BESOIN_V1`) ; un second filtre choisit la personne.
 *
 * Mesuré le 2026-10-22 : 4 065 demandes pour le seul projet AutoWinOS. Une liste rendue d'un bloc
 * aurait figé la vue (même famille de gel que la vue chat entière) : chaque projet montre ses
 * demandes par paquets de `PAQUET`, et seul le projet le plus récent s'ouvre d'office.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte,
  RunBloqueDeLaCarte,
  StatutDemande
} from '../../../shared/carte-des-besoins'
import { STATUTS_DEMANDE } from '../../../shared/carte-des-besoins'
import { LIBELLES_STATUT } from './carte-du-fil'
import { libelleDuBesoin, titreDuDemandeur } from './carte-des-besoins-libelles'
import { ViewTopBar } from './ViewTopBar'
import { deposerOuvertureConversation } from './pending-conversation-open'
import './ViewPage.css'
import './CarteDesBesoinsView.css'

/** Demandes affichées d'un coup par projet, puis à chaque « Afficher plus ». */
export const PAQUET = 40

type Filtre = StatutDemande | 'tous'

/** `tous`, ou la clé d'une personne (`DemandeurDeLaCarte.cle`). */
type FiltreDemandeur = string

const TOUS = 'tous'

function retenue(demande: DemandeDeLaCarte, filtre: Filtre, demandeur: FiltreDemandeur): boolean {
  return (
    (filtre === TOUS || demande.statut === filtre) &&
    (demandeur === TOUS || demande.demandeur?.cle === demandeur)
  )
}

function dateCourte(instant: number | undefined, maintenant: number): string {
  if (instant === undefined) return '—'
  const date = new Date(instant)
  const memeAnnee = date.getFullYear() === new Date(maintenant).getFullYear()
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    ...(memeAnnee ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Le mot accordé au compte : « 1 prouvée », « 2 prouvées ». */
function accord(n: number, singulier: string, plurielForme = `${singulier}s`): string {
  return n > 1 ? plurielForme : singulier
}

function pluriel(n: number, singulier: string, plurielForme = `${singulier}s`): string {
  return `${n} ${accord(n, singulier, plurielForme)}`
}

/** La barre empilée d'un projet : une part par état, dans l'ordre d'affichage. */
function BarreDesEtats({
  comptes,
  total
}: {
  comptes: Record<StatutDemande, number>
  total: number
}): React.JSX.Element | null {
  if (total === 0) return null
  return (
    <span className="besoins-barre" aria-hidden="true">
      {STATUTS_DEMANDE.map((statut) =>
        comptes[statut] > 0 ? (
          <span
            key={statut}
            data-statut={statut}
            style={{ flexGrow: comptes[statut] }}
            title={`${comptes[statut]} ${LIBELLES_STATUT[statut]}`}
          />
        ) : null
      )}
    </span>
  )
}

function LigneDeRun({
  run,
  maintenant,
  ouvrir
}: {
  run: RunBloqueDeLaCarte
  maintenant: number
  ouvrir: (conversationId: string) => void
}): React.JSX.Element {
  return (
    <li className="besoins-run" data-testid="besoins-run">
      <span className="besoins-date">{dateCourte(run.mtime, maintenant)}</span>
      <span className="besoins-pastille" data-statut="refuse">
        run {run.statut}
      </span>
      <span className="besoins-titre" title={run.chemin}>
        {run.sujet}
      </span>
      {run.conversationId ? (
        <button
          type="button"
          className="besoins-fil"
          onClick={() => ouvrir(run.conversationId!)}
          title="Ouvrir le fil qui a lancé ce run"
        >
          {run.conversationTitre || run.conversationId}
        </button>
      ) : (
        <span className="besoins-fil is-sans-fil">sans fil connu</span>
      )}
    </li>
  )
}

function LigneDeDemande({
  demande,
  maintenant,
  ouvrir
}: {
  demande: DemandeDeLaCarte
  maintenant: number
  ouvrir: (conversationId: string) => void
}): React.JSX.Element {
  return (
    <li className="besoins-demande" data-statut={demande.statut} data-testid="besoins-demande">
      <span className="besoins-date">{dateCourte(demande.debut, maintenant)}</span>
      <span className="besoins-pastille" data-statut={demande.statut}>
        {LIBELLES_STATUT[demande.statut]}
      </span>
      <span className="besoins-corps">
        <b className="besoins-titre">{demande.titre}</b>
        <span className="besoins-meta">
          {demande.demandeur ? (
            <span
              className="besoins-demandeur"
              data-testid="besoins-demandeur"
              data-origine={demande.demandeur.origine}
              title={titreDuDemandeur(demande.demandeur)}
            >
              {demande.demandeur.nom}
              {demande.demandeur.origine === 'git-du-dossier' && (
                <span className="besoins-deduit"> · déduit</span>
              )}
            </span>
          ) : (
            <span className="besoins-demandeur is-inconnu" data-testid="besoins-demandeur">
              demandeur inconnu
            </span>
          )}
          {demande.besoin &&
            (demande.besoin.de ? (
              <button
                type="button"
                className="besoins-besoin"
                data-nature={demande.besoin.nature}
                data-testid="besoins-besoin"
                onClick={() => ouvrir(demande.besoin!.de!)}
                title="Déclaré par l'agent · ouvrir le fil repris"
              >
                {libelleDuBesoin(demande.besoin)}
              </button>
            ) : (
              <span
                className="besoins-besoin"
                data-nature={demande.besoin.nature}
                data-testid="besoins-besoin"
                title="Déclaré par l'agent (AUTOWIN_BESOIN_V1)"
              >
                {libelleDuBesoin(demande.besoin)}
              </span>
            ))}
          <span className="besoins-constat">{demande.constat}</span>
        </span>
      </span>
      <button
        type="button"
        className="besoins-fil"
        onClick={() => ouvrir(demande.conversationId)}
        title="Ouvrir ce fil"
      >
        {demande.conversationTitre || demande.conversationId}
      </button>
    </li>
  )
}

function BlocDuProjet({
  projet,
  filtre,
  demandeur,
  ouvertParDefaut,
  maintenant,
  ouvrir
}: {
  projet: ProjetDeLaCarte
  filtre: Filtre
  demandeur: FiltreDemandeur
  ouvertParDefaut: boolean
  maintenant: number
  ouvrir: (conversationId: string) => void
}): React.JSX.Element {
  const [ouvert, setOuvert] = useState(ouvertParDefaut)
  // Un compte PAR FILTRE : changer de filtre repart du premier paquet de CETTE liste, sinon
  // « Afficher plus » garderait un compte pris sur une autre.
  const [limites, setLimites] = useState<Partial<Record<string, number>>>({})
  const cleDuFiltre = `${filtre}|${demandeur}`
  const limite = limites[cleDuFiltre] ?? PAQUET
  const demandes = useMemo(
    () =>
      filtre === TOUS && demandeur === TOUS
        ? projet.demandes
        : projet.demandes.filter((d) => retenue(d, filtre, demandeur)),
    [projet.demandes, filtre, demandeur]
  )
  const total = projet.demandes.length
  const visibles = demandes.slice(0, limite)
  const reste = demandes.length - visibles.length

  return (
    <details
      className="besoins-projet"
      data-testid="besoins-projet"
      data-cle={projet.cle}
      open={ouvert}
      onToggle={(e) => setOuvert((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="besoins-projet-nom" title={projet.cle}>
          {projet.libelle}
        </span>
        <BarreDesEtats comptes={projet.comptes} total={total} />
        <span className="besoins-projet-chiffres">
          {/* Un groupe qui ne porte QUE des runs bloqués (fil inconnu, rangé sous « Divers ») : des
              « 0 demande · 0 prouvée · 0 fil » n'y diraient rien. */}
          {total === 0 ? (
            <span>aucune demande</span>
          ) : (
            <>
              <span>
                <b>{total}</b> {accord(total, 'demande')}
              </span>
              <span>
                <b className="is-ok">{projet.comptes.prouve}</b>{' '}
                {accord(projet.comptes.prouve, 'prouvée')}
              </span>
            </>
          )}
          {projet.comptes.refuse > 0 && (
            <span>
              <b className="is-err">{projet.comptes.refuse}</b>{' '}
              {accord(projet.comptes.refuse, 'refusée')}
            </span>
          )}
          {projet.comptes['en-cours'] > 0 && (
            <span>
              <b className="is-accent">{projet.comptes['en-cours']}</b> en cours
            </span>
          )}
          {projet.runsBloques.length > 0 && (
            <span className="is-alerte" data-testid="besoins-projet-runs">
              <b>{projet.runsBloques.length}</b>{' '}
              {accord(projet.runsBloques.length, 'run bloqué', 'runs bloqués')}
            </span>
          )}
          <span className="besoins-projet-fils">
            {projet.conversations > 0 ? `${pluriel(projet.conversations, 'fil')} · ` : ''}
            {dateCourte(projet.derniereActivite, maintenant)}
          </span>
        </span>
      </summary>
      {ouvert && (
        <div className="besoins-projet-corps">
          {projet.runsBloques.length > 0 && (
            <>
              <h3 className="besoins-sous-titre">Runs bloqués</h3>
              <ul className="besoins-liste">
                {projet.runsBloques.map((run) => (
                  <LigneDeRun key={run.chemin} run={run} maintenant={maintenant} ouvrir={ouvrir} />
                ))}
              </ul>
            </>
          )}
          <h3 className="besoins-sous-titre">
            Demandes
            {filtre !== 'tous' && <span> · {LIBELLES_STATUT[filtre]}</span>}
          </h3>
          {visibles.length === 0 ? (
            <p className="besoins-vide">Aucune demande pour ce filtre.</p>
          ) : (
            <ul className="besoins-liste">
              {visibles.map((demande) => (
                <LigneDeDemande
                  key={`${demande.conversationId}:${demande.rang}`}
                  demande={demande}
                  maintenant={maintenant}
                  ouvrir={ouvrir}
                />
              ))}
            </ul>
          )}
          {reste > 0 && (
            <button
              type="button"
              className="btn btn-sm besoins-plus"
              data-testid="besoins-plus"
              onClick={() => setLimites((l) => ({ ...l, [cleDuFiltre]: limite + PAQUET }))}
            >
              Afficher {Math.min(PAQUET, reste)} de plus · {reste} restantes
            </button>
          )}
        </div>
      )}
    </details>
  )
}

export function CarteDesBesoinsView({
  active,
  onOpenConversation
}: {
  active: boolean
  onOpenConversation: (target: { conversationId: string }) => void
}): React.JSX.Element {
  const [carte, setCarte] = useState<CarteDesBesoins | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(false)
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const [demandeur, setDemandeur] = useState<FiltreDemandeur>(TOUS)

  const charger = useCallback(async () => {
    setChargement(true)
    try {
      setCarte(await window.api.carteDesBesoins())
      setErreur(null)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setChargement(false)
    }
  }, [])

  // Relue à chaque retour sur l'onglet : le calcul ne refait que les fils qui ont bougé.
  useEffect(() => {
    // Même chargement à l'activation que la vue Tests : l'état posé par `charger` vient d'un appel
    // asynchrone, il ne boucle pas.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void charger()
  }, [active, charger])

  const ouvrir = useCallback(
    (conversationId: string) => {
      // Chat jamais monté : son écouteur n'existe pas encore, la demande est déposée pour lui.
      deposerOuvertureConversation(conversationId)
      onOpenConversation({ conversationId })
    },
    [onOpenConversation]
  )

  // L'heure du CALCUL, pas celle du rendu : sans carte, aucune date n'est affichée.
  const maintenant = carte?.calculeeA ?? 0
  const projets = useMemo(() => {
    if (!carte) return []
    if (filtre === TOUS && demandeur === TOUS) return carte.projets
    return carte.projets.filter((p) => p.demandes.some((d) => retenue(d, filtre, demandeur)))
  }, [carte, filtre, demandeur])

  return (
    <section className="view-page besoins-view" data-testid="besoins-view" data-active={active}>
      <ViewTopBar
        eyebrow="PROJET"
        title="Besoins"
        description="Chaque demande de tous tes fils, rangée par projet, avec ce qu’elle a prouvé. Calculé sans modèle, à partir des fils."
        actions={
          <span className="besoins-entete">
            {carte && (
              <span className="besoins-stats" data-testid="besoins-stats">
                <span>
                  <b>{carte.demandes}</b> {accord(carte.demandes, 'demande')}
                </span>
                <span>
                  <b className="is-ok">{carte.comptes.prouve}</b>{' '}
                  {accord(carte.comptes.prouve, 'prouvée')}
                </span>
                <span>
                  <b className="is-err">{carte.comptes.refuse}</b>{' '}
                  {accord(carte.comptes.refuse, 'refusée')}
                </span>
                {carte.runsBloques > 0 && (
                  <span className="is-alerte">
                    <b>{carte.runsBloques}</b>{' '}
                    {accord(carte.runsBloques, 'run bloqué', 'runs bloqués')}
                  </span>
                )}
              </span>
            )}
            <button
              type="button"
              className="btn btn-sm"
              data-testid="besoins-actualiser"
              disabled={chargement}
              onClick={() => void charger()}
            >
              {chargement ? 'Calcul…' : 'Actualiser'}
            </button>
          </span>
        }
      />

      {erreur && (
        <p className="besoins-erreur" role="alert" data-testid="besoins-erreur">
          Carte impossible à calculer : {erreur}
        </p>
      )}

      {carte && (
        <div className="besoins-filtres" role="group" aria-label="Filtrer par état">
          <button
            type="button"
            className={`besoins-filtre${filtre === 'tous' ? ' is-actif' : ''}`}
            aria-pressed={filtre === 'tous'}
            onClick={() => setFiltre('tous')}
          >
            Toutes <b>{carte.demandes}</b>
          </button>
          {STATUTS_DEMANDE.map((statut) => (
            <button
              key={statut}
              type="button"
              data-statut={statut}
              data-testid={`besoins-filtre-${statut}`}
              className={`besoins-filtre${filtre === statut ? ' is-actif' : ''}`}
              aria-pressed={filtre === statut}
              onClick={() => setFiltre(statut)}
            >
              {LIBELLES_STATUT[statut]} <b>{carte.comptes[statut]}</b>
            </button>
          ))}
        </div>
      )}

      {carte && carte.demandeurs.length > 0 && (
        <div
          className="besoins-filtres besoins-filtres-demandeurs"
          role="group"
          aria-label="Filtrer par personne qui a prompté"
        >
          <span className="besoins-filtres-libelle">Demandé par</span>
          <button
            type="button"
            className={`besoins-filtre${demandeur === TOUS ? ' is-actif' : ''}`}
            aria-pressed={demandeur === TOUS}
            onClick={() => setDemandeur(TOUS)}
          >
            Tout le monde
          </button>
          {carte.demandeurs.map((personne) => (
            <button
              key={personne.cle}
              type="button"
              data-testid="besoins-filtre-demandeur"
              className={`besoins-filtre${demandeur === personne.cle ? ' is-actif' : ''}`}
              aria-pressed={demandeur === personne.cle}
              title={personne.email ?? personne.nom}
              onClick={() => setDemandeur(personne.cle)}
            >
              {personne.nom} <b>{personne.demandes}</b>
            </button>
          ))}
        </div>
      )}

      {!carte && !erreur && <p className="besoins-vide">Calcul de la carte…</p>}
      {carte && projets.length === 0 && (
        <p className="besoins-vide">Aucune demande pour ce filtre.</p>
      )}

      <div className="besoins-projets">
        {projets.map((projet, i) => (
          <BlocDuProjet
            key={projet.cle}
            projet={projet}
            filtre={filtre}
            demandeur={demandeur}
            ouvertParDefaut={i === 0}
            maintenant={maintenant}
            ouvrir={ouvrir}
          />
        ))}
      </div>

      {carte && (
        <p className="besoins-pied" data-testid="besoins-pied">
          {pluriel(carte.conversationsLues, 'fil lu', 'fils lus')} · calculé en {carte.dureeMs} ms ·
          « sans preuve » = fini sans aucune vérification jouée, jamais compté comme fait ·{' '}
          <span data-testid="besoins-pied-demandeurs">
            qui a prompté :{' '}
            {pluriel(carte.demandesJournalisees, 'demande relevée', 'demandes relevées')} dans git
            au moment du prompt, les autres déduites de la config git actuelle du dossier
          </span>
          {carte.runsNonExamines ? (
            <>
              {' '}
              · <span className="is-alerte">liste des runs partielle</span> :{' '}
              {carte.runsNonExamines} RUN.md non examinés
            </>
          ) : null}
        </p>
      )}
    </section>
  )
}
