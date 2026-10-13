/**
 * Blocs « Raisonnement » et « Actions » du fil — DEUX blocs repliables EMPILÉS, écrits en direct.
 *
 * Avant le 2026-09-12 un seul bloc « Réflexion » portait les deux : la pensée du modèle ET les
 * lignes de signe de vie (outil en cours, tâche de fond, nouvelle tentative API). Sur les modèles
 * dont la pensée arrive chiffrée (opus-5), le bloc ne montrait donc QUE des actions sous un titre
 * qui promettait de la réflexion. Demande de l'utilisateur : « un bloc raisonnement et un bloc
 * action l'un au dessus de l'autre ».
 *
 * Ouverture : PLIÉS par défaut, en cours comme terminés (demande du 2026-09-01) — l'en-tête dit
 * déjà ce qui se passe. Un clic de l'utilisateur reprend TOUJOURS la main.
 *
 * EN-TETE « R5 · Sous la ligne » (choix de l'utilisateur sur maquettes, conv-162, 2026-10-10 :
 * « la gueule du 1, la barre avec les actions du 3, pas les mots de raisonnement, seulement un
 * compteur de secondes », puis « go R5 ») : chaque titre est une CAPSULE à bord dégradé (icône
 * ronde, libellé, compteurs, chevron DEDANS) ; le signe de vie reste dehors, en gris.
 *
 * Habillage « Fumé net » (conv-173, 2026-10-10, maquettes .autowin-tmp/draft-capsules, « Agent
 * assorti implémente c magnifique », puis « reflet bombé ») : la capsule est en verre fumé (reflet
 * en arc, bord dégradé de 2 px). La barre de temps des actions reste SOUS la ligne, hors de la
 * capsule, et déborde sous le signe de vie : un essai l'avait mise dans la capsule, refusé
 * (« sors-la de la capsule Actions, mets-la comme avant en dessous »). Visible bloc plié.
 */
// fix-ok: le bloc Actions ne recevait que statusLog (texte) sans statut ; mesure claude.ts:1687 (is_error) jamais transmis -> lignes de fin parsees dans thinking-block-corps.ts, frise C3 ; edits 3-4 = echappement de retour a la ligne casse par le shell, corrige.
import React, { Fragment, useEffect, useRef, useState } from 'react'
import { LegendeDesOutils, RondDIcone, RondDuCompte } from './anneau-activite'
import {
  actionsDuTour,
  bilanDesActions,
  chronoMemorise,
  corpsDuBloc,
  derniereLigneDuRaisonnement,
  dureeLisible,
  memoriserChrono,
  secondesDesActions,
  secondesDuChrono,
  statutLisible,
  type ActionFrise,
  type Chrono
} from './thinking-block-corps'

/** Étincelle : la pensée. Dessinée en SVG — l'ancien glyphe « ✻ » dépendait de la police. */
const ICONE_RAISONNEMENT = (
  <svg viewBox="0 0 16 16" focusable="false">
    <path d="M8 1 L9.6 6.4 L15 8 L9.6 9.6 L8 15 L6.4 9.6 L1 8 L6.4 6.4 Z" fill="currentColor" />
  </svg>
)

/**
 * DEUX LIGNES (conv-904, 2026-10-12 : « je veux aussi 2 lignes pour les boutons raisonnement et
 * actions », a la suite du cadre choisi pour la barre d'activite). Le bloc prend le meme cadre que
 * la barre : un grand rond degrade a gauche (le NOMBRE d'actions et la pastille de leur exception,
 * ou l'icone de la pensee — « Rond de verre »), puis deux lignes : le libelle et ses compteurs, et
 * dessous ce qui se passe — la legende des outils, la derniere pensee, l'action courante. Le
 * chevron dessine ferme la ligne. Le rond et la legende remplacent la barre de temps sous la ligne.
 */
function BlocRepliable({
  testid,
  classe,
  rond,
  libelle,
  live,
  compteurs,
  titre,
  legende,
  entete,
  corps,
  frise,
  dependances
}: {
  testid: string
  classe: string
  /** Le grand rond de gauche : l'anneau des actions, ou le rond degrade de l'icone. */
  rond: React.ReactNode
  libelle: string
  live: boolean
  /** Ce qui suit le libellé : secondes du raisonnement, durée des actions. */
  compteurs?: React.ReactNode
  /** Infobulle de la première ligne (bilan complet des actions, échecs compris). */
  titre?: string
  /** Seconde ligne : la légende de l'anneau (outils, couleur sur l'exception). */
  legende?: React.ReactNode
  entete?: string
  corps: string
  /** Actions structurees : si present, le corps est dessine en FRISE (variante C3). */
  frise?: ActionFrise[]
  dependances: unknown[]
}): React.JSX.Element {
  const [manuel, setManuel] = useState<boolean | null>(null)
  const ouvert = manuel ?? false
  const ref = useRef<HTMLElement | null>(null)
  // Le flux s'écrit vers le BAS : sans cela, le contenu défile hors du cadre et on regarde le début.
  useEffect(() => {
    const el = ref.current
    if (el && ouvert) el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependances, ouvert])
  return (
    <details
      className={`thinking-block thinking-block--deux-lignes cadre-anneau ${classe}${live ? ' is-live' : ' is-done'}`}
      data-testid={testid}
      open={ouvert}
      onToggle={(event) => setManuel(event.currentTarget.open)}
    >
      <summary>
        {/* AUCUN spinner ici : un seul tourne pour tout le tour, sur la ligne « Agent »
            (demande du 2026-09-12 « met qu'un spinner sur la ligne agent »). Deux blocs
            empiles donnaient deux spinners cote a cote pour une seule attente. */}
        <span className="anneau-tete">
          {rond}
          <span className="anneau-col">
            <span
              className="anneau-l1"
              data-testid={`${testid}-capsule`}
              {...(titre ? { title: titre } : {})}
            >
              <span className="thinking-label">{libelle}</span>
              {compteurs}
            </span>
            {(legende || entete) && (
              <span className="anneau-l2">
                {/* Enveloppe de la legende : bloc plie = DEUX lignes, jamais plus (conv-910). Elle
                    se coupe en « … » au lieu de passer a la ligne. */}
                {legende && <span className="anneau-legende">{legende}</span>}
                {entete && (
                  <span className="thinking-status" data-testid={`${testid}-status`} title={entete}>
                    {entete}
                  </span>
                )}
              </span>
            )}
          </span>
          <span className="anneau-chevron" aria-hidden="true" />
        </span>
      </summary>
      {frise ? (
        <FriseDesActions
          actions={frise}
          testid={`${testid}-body`}
          refCorps={(el) => {
            ref.current = el
          }}
        />
      ) : (
        <pre
          className="thinking-body"
          ref={(el) => {
            ref.current = el
          }}
          data-testid={`${testid}-body`}
        >
          {corps}
        </pre>
      )}
    </details>
  )
}

/**
 * Variante C3 (choix de l'utilisateur, 2026-09-24) : une FRISE verticale, une pastille par
 * action. Icones et pastilles sont en CSS (`::before`) : le texte du corps reste exactement les
 * lignes d'action separees par des retours a la ligne, comme l'ancien `<pre>`.
 */
function FriseDesActions({
  actions,
  testid,
  refCorps
}: {
  actions: ActionFrise[]
  testid: string
  refCorps: (el: HTMLDivElement | null) => void
}): React.JSX.Element {
  return (
    <div className="thinking-body thinking-frise" ref={refCorps} data-testid={testid}>
      <div className="thinking-frise-liste">
        {actions.map((a, i) => (
          <Fragment key={i}>
            {i > 0 && '\n'}
            {a.sousActions?.length ? (
              <TacheDeLaFrise action={a} />
            ) : (
              <div
                className="thinking-frise-ligne"
                data-etat={a.etat}
                data-famille={a.famille}
                data-testid="action-frise-ligne"
                title={a.etat === 'ko' ? 'Échec' : a.etat === 'encours' ? 'En cours' : 'Réussie'}
              >
                <span
                  className="thinking-frise-icone"
                  data-famille={a.famille}
                  aria-hidden="true"
                />
                {a.texte}
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/**
 * UNE COMMANDE NOMMEE, DEPLIABLE « comme une orchestration » (conv-910) : la ligne dit ce que fait
 * la commande (sa description), le chevron ouvre la liste des commandes qu'elle enchaine. Pliee par
 * defaut ; le detail n'est rendu qu'ouvert, comme le corps de la capsule d'orchestration.
 */
function TacheDeLaFrise({ action }: { action: ActionFrise }): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false)
  const actions = action.sousActions ?? []
  return (
    <details
      className="thinking-frise-ligne thinking-frise-tache"
      data-etat={action.etat}
      data-famille={action.famille}
      data-testid="action-frise-ligne"
      open={ouvert}
      onToggle={(event) => setOuvert(event.currentTarget.open)}
    >
      <summary
        title={`${action.etat === 'ko' ? 'Échec' : action.etat === 'encours' ? 'En cours' : 'Réussie'} · ${actions.length} commande${actions.length > 1 ? 's' : ''}`}
      >
        <span className="thinking-frise-chevron" aria-hidden="true" />
        <span className="thinking-frise-tache-nom">{action.texte}</span>
      </summary>
      {ouvert && (
        <ul className="thinking-frise-sous-actions" data-testid="action-frise-sous-actions">
          {actions.map((commande, i) => (
            <li
              key={i}
              className="thinking-frise-sous-action"
              data-testid="action-frise-sous-action"
            >
              <span className="thinking-frise-icone" data-famille="commande" aria-hidden="true" />
              {commande}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

/**
 * Compteur de secondes du raisonnement. Voir `Chrono` dans thinking-block-corps.ts : mesuré à
 * l'écran pendant le tour, figé à la fin.
 *
 * Un tour RELU sans compteur en mémoire (app relancée, tour jamais vu en cours) prend la durée que
 * le tour a CONSERVÉE (`conserveMs`, écrite à la clôture par le processus principal, même mesure).
 * Le compteur vu en direct garde la priorité : le chiffre ne saute pas sous les yeux de
 * l'utilisateur à l'arrivée de la valeur conservée. Ni l'un ni l'autre : aucun chiffre inventé.
 *
 * UN TOUR RALLUMÉ RECOMPTE (conv-916, 2026-10-13 : « le timer du bloc raisonnement ne bouge même
 * plus »). Un tour peut être vu clos à l'écran puis repartir — son orchestration tournait encore, une
 * nouvelle bulle l'adopte. La `fin` mémorisée de cette clôture ne vaut plus : la garder figeait le
 * compteur à 15 min 9 s sous le libellé « Raisonnement » d'un tour en cours. Il reprend donc depuis le
 * DÉBUT du tour, au montage comme sous les yeux.
 */
function useChronoDuRaisonnement(
  turnId: string | undefined,
  done: boolean,
  conserveMs: number | undefined
): number | null {
  const [chrono, setChrono] = useState<Chrono | null>(() => {
    const memorise = chronoMemorise(turnId)
    if (done) return memorise
    return { debut: memorise?.debut ?? Date.now() }
  })
  const [maintenant, setMaintenant] = useState(() => chrono?.fin ?? Date.now())
  useEffect(() => {
    if (done) return
    // Chaque battement retire aussi la `fin` d'une clôture démentie — tour rallumé SOUS LES YEUX,
    // bloc monté clos — ou démarre le chrono d'un bloc monté clos sans mémoire. Le premier part tout
    // de suite : un tour rallumé ne garde pas une seconde de plus son chiffre figé.
    const battre = (): void => {
      const t = Date.now()
      setChrono((c) => (c && c.fin === undefined ? c : { debut: c?.debut ?? t }))
      setMaintenant(t)
    }
    const premier = window.setTimeout(battre, 0)
    const id = window.setInterval(battre, 1000)
    return () => {
      window.clearTimeout(premier)
      window.clearInterval(id)
    }
  }, [done])
  // Memorise le debut (et, tour fini, la fin) pour qu'un remontage ne reparte pas de zero.
  useEffect(() => {
    if (!turnId || !chrono) return
    memoriserChrono(turnId, done ? { debut: chrono.debut, fin: chrono.fin ?? maintenant } : chrono)
  }, [turnId, chrono, done, maintenant])
  if (!chrono) return done && conserveMs !== undefined ? Math.floor(conserveMs / 1000) : null
  return secondesDuChrono(
    done ? { ...chrono, fin: chrono.fin ?? maintenant } : { debut: chrono.debut },
    maintenant
  )
}

export function ThinkingBlock({
  text,
  done,
  status,
  statusLog,
  turnId,
  reasoningMs
}: {
  text: string
  done: boolean
  /** Signe de vie COURANT du fournisseur : outil en cours, tâche de fond, nouvelle tentative API. */
  status?: string
  /** TOUTES les lignes de signe de vie du tour, dans l'ordre — le corps du bloc « Actions ». */
  statusLog?: string[]
  /** Identifiant du tour : garde le chrono du raisonnement si le bloc est démonté puis remonté. */
  turnId?: string
  /** Durée du raisonnement CONSERVÉE par le tour (ms) : le compteur d'un tour relu du disque. */
  reasoningMs?: number
}): React.JSX.Element {
  const pensee = corpsDuBloc(text)
  const frise = actionsDuTour(statusLog, status, done)
  const actions = frise.map((a) => a.texte).join('\n')
  // Plie, le bloc doit quand meme dire OU en est la pensee : sa derniere ligne, en gris, comme le
  // bloc Actions montre l'action courante (demande de l'utilisateur, 2026-09-12). DEUX LIGNES
  // (conv-904) : tour fini, la seconde ligne garde la DERNIERE ligne de la pensee — sa conclusion.
  // Une pensee chiffree par le modele (corps vide) n'invente rien : le bloc reste sur une ligne.
  const dernierePensee = derniereLigneDuRaisonnement(pensee)
  const secondesPensee = useChronoDuRaisonnement(turnId, done, reasoningMs)
  const secondesActions = secondesDesActions(frise)
  return (
    <>
      <BlocRepliable
        testid="thinking-block"
        classe="thinking-block--raisonnement"
        rond={<RondDIcone>{ICONE_RAISONNEMENT}</RondDIcone>}
        libelle={done ? 'Raisonnement terminé' : 'Raisonnement'}
        live={!done}
        compteurs={
          secondesPensee !== null && (
            <span className="thinking-secondes" data-testid="thinking-block-secondes">
              {dureeLisible(secondesPensee)}
            </span>
          )
        }
        {...(dernierePensee ? { entete: dernierePensee } : {})}
        corps={pensee}
        dependances={[text]}
      />
      {actions && (
        <BlocRepliable
          testid="action-block"
          classe="thinking-block--actions"
          // Le nombre d'actions est dans le rond : la pastille bleue qui le portait dans la
          // capsule le dirait une seconde fois.
          rond={<RondDuCompte etats={frise.map((a) => a.etat)} testid="action-block-compte" />}
          libelle="Actions"
          live={!done}
          titre={bilanDesActions(frise)}
          compteurs={
            secondesActions > 0 && (
              <span className="thinking-duree" data-testid="action-block-duree">
                {dureeLisible(secondesActions)}
              </span>
            )
          }
          legende={<LegendeDesOutils outils={frise.map((a) => ({ nom: a.outil, etat: a.etat }))} />}
          {...(!done && status ? { entete: statutLisible(status) } : {})}
          corps={actions}
          frise={frise}
          dependances={[actions]}
        />
      )}
    </>
  )
}
