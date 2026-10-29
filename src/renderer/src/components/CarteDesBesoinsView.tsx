/**
 * VUE « CARTE DU PROJET » — la carte des besoins (conv-1089, 2026-10-22).
 *
 * Demande d'origine : « une vue qui agrège les étapes de la carte du fil de toutes les conversations,
 * avec l'état prouvé de chaque demande et les runs bloqués, sans aucun appel de modèle ». Le calcul
 * vit dans le processus principal (`src/main/carte-des-besoins.ts`) ; ici, l'en-tête et la rivière.
 *
 * Depuis le 23/10 (conv-1113) : « il doit y avoir que ce board dans la view, supprime tout ce qui
 * est en dessous, et la vue n'est pas scrollable verticalement, on peut scroll que le kanban ». La
 * fiche d'un dépôt (/draft conv-1102), la liste « Toutes les demandes », ses filtres et son pied
 * sont retirés ; la vue ne défile plus, seul le tableau de la rivière défile (`RiviereDuProjet`).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { formaterDate, langueCourante } from '../langue'
import { nomDeDestination } from '../textes'
import {
  traduireBoardEtMaintenance,
  useTextesBoardEtMaintenance
} from '../textes-ecrans/board-et-maintenance'
import {
  cleDeLaDemande,
  type CarteDesBesoins,
  type DemandeDeLaCarte,
  type WorkItemDeLaDemande
} from '../../../shared/carte-des-besoins'
import type { EtatDuDossierDuBoard } from '../../../shared/board-dossier'
import type { BoardsDesCollegues } from '../../../shared/board-collegues'
import { carteAvecCollegues } from './board-collegues'
import { ProjetsPartagesDuBoard } from './ProjetsPartagesDuBoard'
import { RouageDuBoard } from './RouageDuBoard'
import {
  carteDuBoardAffichee,
  lignesDuMenuDesProjets,
  lireDossiersDuChat,
  lireDossierPersonnel,
  lireDossiersRetires,
  lireDossiersToujoursProposes,
  retirerDossierDuChat,
  transmettreDossiersDuChat
} from './dossiers-du-chat'
import { RiviereDuProjet } from './RiviereDuProjet'
import type { SourceDeTache } from './TachesDeLaDemande'
import { ViewTopBar } from './ViewTopBar'
import { deposerOuvertureConversation } from './pending-conversation-open'
import { useVerificationDuBoard } from './verification-du-board'
import { lireEtatsManuels } from './etats-manuels-carte'
import './ViewPage.css'
import './CarteDesBesoinsView.css'

/** Le dernier nom du chemin (`Board` pour `\\serveur\partage\Board`) : le chemin entier est au survol. */
function nomCourtDuDossier(chemin: string): string {
  const morceaux = chemin.split(/[\\/]+/).filter(Boolean)
  return morceaux[morceaux.length - 1] ?? chemin
}

/** Le mot accordé au compte : « 1 prouvée », « 2 prouvées ». */
function accord(n: number, singulier: string, plurielForme = `${singulier}s`): string {
  return n > 1 ? plurielForme : singulier
}

export function CarteDesBesoinsView({
  active,
  onOpenConversation
}: {
  active: boolean
  onOpenConversation: (target: { conversationId: string }) => void
}): React.JSX.Element {
  const { t, langue } = useTextesBoardEtMaintenance()
  const [carte, setCarte] = useState<CarteDesBesoins | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(false)
  // Les dossiers de travail du Chat (conv-1212) : les seuls projets du Board. Relus à chaque calcul,
  // donc à chaque retour sur l'onglet — un dossier retiré dans le Chat sort aussi d'ici.
  const [dossiersDuChat, setDossiersDuChat] = useState<string[]>(() => lireDossiersDuChat())
  // « This computer » (conv-1231) : jamais retirable, donc sans croix et gardé malgré un retrait.
  const [dossierPersonnel, setDossierPersonnel] = useState<string | null>(null)

  const charger = useCallback(async () => {
    setChargement(true)
    try {
      // La liste d'abord : c'est le processus principal qui réduit le Board à ces dossiers.
      const dossiers = lireDossiersDuChat()
      const retires = lireDossiersRetires()
      setDossiersDuChat(dossiers)
      await transmettreDossiersDuChat(dossiers, retires)
      const [toujours, personnel] = await Promise.all([
        lireDossiersToujoursProposes(),
        lireDossierPersonnel()
      ])
      setDossierPersonnel(personnel)
      // Les états posés à la main vivent ici : joints pour que la copie du dossier (conv-1206)
      // range chaque post-it à l'étage qu'il a À L'ÉCRAN.
      const calculee = await window.api.carteDesBesoins({
        etatsManuels: lireEtatsManuels(window.localStorage)
      })
      setCarte(carteDuBoardAffichee(calculee, dossiers, toujours, retires, personnel))
      setErreur(null)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setChargement(false)
    }
  }, [])
  // « Vérifier » / « Tout vérifier » du Board (conv-1136) : `/check` dans le fil, carte relue pendant le tour.
  const verifier = useVerificationDuBoard(active, carte, charger)

  // Relue à chaque retour sur l'onglet : le calcul ne refait que les fils qui ont bougé.
  // Work items (conv-1127) : ce que la passe de lecture des `#1234` n'a pas pu faire, dit en clair.
  const [avisTaches, setAvisTaches] = useState<string | null>(null)
  // Les sources de tickets configurées (conv-1127) : à partir de deux, « + task » propose de choisir.
  const [sourcesDesTaches, setSourcesDesTaches] = useState<SourceDeTache[]>([])

  useEffect(() => {
    if (!active || typeof window.api.ticketSources !== 'function') return
    let annule = false
    window.api
      .ticketSources()
      .then((liste) => {
        if (!annule)
          setSourcesDesTaches(liste.map((s) => ({ id: s.profile.id, label: s.profile.label })))
      })
      .catch(() => {
        // Liste illisible : pas de choix affiché ; avec une seule source le rattachement marche
        // quand même, avec plusieurs le processus principal refuse et le dit.
      })
    return () => {
      annule = true
    }
  }, [active])

  /**
   * Une passe de lecture des fiches nommées par les prompts (`#1234`, titres des fils de la vue
   * Tickets), bornée côté processus principal. Elle pose un lien seulement si la fiche existe ; si
   * elle a lu quelque chose, la carte est recalculée UNE fois.
   */
  const verifierLesTaches = useCallback(async () => {
    if (typeof window.api.carteVerifierMentions !== 'function') return
    try {
      const bilan = await window.api.carteVerifierMentions()
      setAvisTaches(
        bilan.injoignable
          ? traduireBoardEtMaintenance('vue.sourceInjoignable', langueCourante())
          : null
      )
      if (bilan.lues > bilan.introuvables) await charger()
    } catch (e) {
      setAvisTaches(
        traduireBoardEtMaintenance('vue.tasksNonVerifiees', langueCourante(), {
          erreur: e instanceof Error ? e.message : String(e)
        })
      )
    }
  }, [charger])

  useEffect(() => {
    // Même chargement à l'activation que la vue Tests : l'état posé par `charger` vient d'un appel
    // asynchrone, il ne boucle pas. Puis la lecture des `#1234` (conv-1127), après le calcul.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void charger().then(verifierLesTaches)
  }, [active, charger, verifierLesTaches])

  const lierWorkItem = useCallback(
    async (d: DemandeDeLaCarte, saisie: string, sourceId?: string) => {
      const resultat = await window.api.carteLierWorkItem({
        conversationId: d.conversationId,
        demande: cleDeLaDemande(d),
        saisie,
        ...(sourceId ? { sourceId } : {})
      })
      if (resultat.ok) await charger()
      return resultat
    },
    [charger]
  )

  const delierWorkItem = useCallback(
    async (d: DemandeDeLaCarte, w: WorkItemDeLaDemande) => {
      const resultat = await window.api.carteDelierWorkItem({
        conversationId: d.conversationId,
        demande: cleDeLaDemande(d),
        sourceId: w.sourceId,
        id: w.id
      })
      if (resultat.ok) await charger()
      else setAvisTaches(resultat.raison)
    },
    [charger]
  )

  // LE DOSSIER DU BOARD (conv-1206) : où le Board est recopié à chaque calcul. Relu à l'activation,
  // puis toutes les 3 s tant qu'une copie attend ou tourne, pour dire quand elle a abouti.
  const [dossier, setDossier] = useState<EtatDuDossierDuBoard | null>(null)
  const relireDossier = useCallback(async () => {
    if (typeof window.api.boardDossier !== 'function') return
    try {
      setDossier(await window.api.boardDossier())
    } catch {
      // État illisible : le bouton reste sur « Dossier… », le Board marche sans.
    }
  }, [])
  useEffect(() => {
    // Même motif que le chargement : l'état vient d'un appel asynchrone, il ne boucle pas.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void relireDossier()
  }, [active, carte, relireDossier])
  useEffect(() => {
    if (!active || !dossier?.enCours) return
    const minuteur = window.setTimeout(() => void relireDossier(), 3000)
    return () => window.clearTimeout(minuteur)
  }, [active, dossier, relireDossier])

  const choisirDossier = useCallback(async () => {
    const etat = await window.api.boardDossierChoisir()
    setDossier(etat)
    // Dossier tout juste choisi : un calcul l'y recopie aussitôt.
    if (etat.dossier && !etat.erreur) await charger()
  }, [charger])
  const oublierDossier = useCallback(async () => {
    setDossier(await window.api.boardDossierEffacer())
  }, [])
  // Les projets recopiés (conv-1211, « choisir quel CWD on partage ») : choix gardé sur le poste,
  // puis un calcul recopie aussitôt le Board avec les seuls projets cochés.
  const choisirProjets = useCallback(
    async (projets: string[] | null) => {
      setDossier(await window.api.boardDossierProjets(projets))
      await charger()
    },
    [charger]
  )

  // La croix d'une ligne du menu « Projets » (conv-1212) : retire le dossier de la liste du Chat —
  // la même que la croix du Chat —, puis recalcule le Board sans lui.
  const retirerDuChat = useCallback(
    async (chemin: string) => {
      setDossiersDuChat(retirerDossierDuChat(chemin))
      await charger()
    },
    [charger]
  )

  // LES POST-IT DES COLLÈGUES (conv-1210) : les Boards que les autres postes recopient dans le même
  // dossier, relus APRÈS la carte et à part, pour qu'un partage lent ne retarde jamais le nôtre ; le
  // processus principal espace lui-même les relectures. Mêlés à la carte AFFICHÉE seulement.
  const [collegues, setCollegues] = useState<BoardsDesCollegues | null>(null)
  const dossierChoisi = dossier?.dossier ?? null
  useEffect(() => {
    if (!active || !carte || typeof window.api.boardCollegues !== 'function') return
    let annule = false
    window.api
      .boardCollegues()
      .then((lu) => {
        if (!annule) setCollegues(lu)
      })
      .catch(() => {
        // Illisibles : seuls nos post-it restent, le Board marche sans.
      })
    return () => {
      annule = true
    }
  }, [active, carte, dossierChoisi])
  // Sans dossier choisi, aucun collègue : leurs post-it partent avec lui.
  const carteAffichee = useMemo(
    () => carte && carteAvecCollegues(carte, dossierChoisi ? (collegues?.collegues ?? []) : []),
    [carte, collegues, dossierChoisi]
  )
  const aideDesCollegues = [
    dossierChoisi && collegues?.collegues.length
      ? t('vue.dossierCollegues', { noms: collegues.collegues.map((c) => c.nom).join(', ') })
      : '',
    dossierChoisi && collegues?.erreur
      ? t('vue.dossierColleguesErreur', { erreur: collegues.erreur })
      : ''
  ]
    .filter(Boolean)
    .map((ligne) => `\n${ligne}`)
    .join('')

  const ouvrir = useCallback(
    (conversationId: string) => {
      // Chat jamais monté : son écouteur n'existe pas encore, la demande est déposée pour lui.
      deposerOuvertureConversation(conversationId)
      onOpenConversation({ conversationId })
    },
    [onOpenConversation]
  )

  return (
    <section className="view-page besoins-view" data-testid="besoins-view" data-active={active}>
      <ViewTopBar
        eyebrow={t('vue.surtitre')}
        title={nomDeDestination('besoins', langue)}
        actions={
          <span className="besoins-entete">
            {carte && (
              <span className="besoins-stats" data-testid="besoins-stats">
                <span>
                  <b>{carte.demandes}</b>{' '}
                  {accord(carte.demandes, t('vue.demande'), t('vue.demandes'))}
                </span>
                <span>
                  <b className="is-ok">{carte.comptes.prouve}</b>{' '}
                  {accord(carte.comptes.prouve, t('vue.prouvee'), t('vue.prouvees'))}
                </span>
                <span>
                  <b className="is-err">{carte.comptes.refuse}</b>{' '}
                  {accord(carte.comptes.refuse, t('vue.refusee'), t('vue.refusees'))}
                </span>
                {carte.runsBloques > 0 && (
                  <span className="is-alerte">
                    <b>{carte.runsBloques}</b>{' '}
                    {accord(carte.runsBloques, t('vue.runBloque'), t('vue.runsBloques'))}
                  </span>
                )}
                {avisTaches && (
                  <span className="is-alerte" data-testid="besoins-avis-taches">
                    {avisTaches}
                  </span>
                )}
              </span>
            )}
            {/* Les boutons passent à la ligne ENSEMBLE, sous les compteurs, quand l'en-tête est
                étroit : sans ce groupe, « Actualiser » restait seul sur une ligne (conv-1211). */}
            <span className="besoins-boutons">
              <span className="besoins-dossier" data-testid="besoins-dossier">
                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="besoins-dossier-choisir"
                  title={
                    (dossier?.erreur
                      ? t('vue.dossierErreur', { erreur: dossier.erreur })
                      : dossier?.dernier
                        ? t('vue.dossierEnregistre', {
                            cible: dossier.cible ?? '',
                            heure: formaterDate(dossier.dernier.a, { timeStyle: 'short' }),
                            n: dossier.dernier.postIts
                          })
                        : dossier?.cible
                          ? t('vue.dossierAttente', { cible: dossier.cible })
                          : t('vue.dossierAide')) + aideDesCollegues
                  }
                  onClick={() => void choisirDossier()}
                >
                  <span aria-hidden="true">📁</span>{' '}
                  {dossier?.dossier ? nomCourtDuDossier(dossier.dossier) : t('vue.dossier')}
                  {dossier?.erreur && (
                    <span className="is-alerte" data-testid="besoins-dossier-erreur">
                      {' '}
                      ⚠
                    </span>
                  )}
                </button>
                {dossier?.dossier && (
                  <button
                    type="button"
                    className="btn btn-sm besoins-dossier-oublier"
                    data-testid="besoins-dossier-oublier"
                    title={t('vue.dossierOublier')}
                    aria-label={t('vue.dossierOublier')}
                    onClick={() => void oublierDossier()}
                  >
                    ×
                  </button>
                )}
                {/* Le rouage (conv-1230) : « Actualiser », le nom de ce poste sur le Board, puis
                    la liste des projets — qui n'existe qu'une fois un dossier choisi. */}
                <RouageDuBoard
                  chargement={chargement}
                  onActualiser={() => void charger()}
                  onNomEnregistre={() => void charger()}
                >
                  {/* NOS projets seulement (`carte`, pas `carteAffichee`) : les post-it des
                      collègues ne repartent pas d'ici (conv-1211, conv-1210). */}
                  {dossier?.dossier && carte && (
                    <ProjetsPartagesDuBoard
                      projets={lignesDuMenuDesProjets(
                        carte.projets.map((p) => ({
                          cle: p.cle,
                          libelle: p.libelle,
                          demandes: p.demandes.length
                        })),
                        dossiersDuChat,
                        dossierPersonnel
                      )}
                      choisis={dossier.projets ?? null}
                      onChoisir={(p) => void choisirProjets(p)}
                      onRetirer={(chemin) => void retirerDuChat(chemin)}
                    />
                  )}
                </RouageDuBoard>
              </span>
            </span>
          </span>
        }
      />

      {erreur && (
        <p className="besoins-erreur" role="alert" data-testid="besoins-erreur">
          {t('vue.erreur', { erreur })}
        </p>
      )}

      {!carte && !erreur && <p className="besoins-vide">{t('vue.chargement')}</p>}

      {/* LA RIVIÈRE (/draft conv-1113) : seule dans la vue ; elle prend toute la hauteur restante et
          son tableau est le seul endroit qui défile. */}
      {carteAffichee && (
        <RiviereDuProjet
          carte={carteAffichee}
          ouvrir={ouvrir}
          lierWorkItem={lierWorkItem}
          delierWorkItem={delierWorkItem}
          sourcesDesTaches={sourcesDesTaches}
          verifier={verifier}
        />
      )}
    </section>
  )
}
