import { useEffect, useState } from 'react'
import { libelleTravail, type TravailNonPublie } from './travail-non-publie'
import type { RapportRetention } from '../../../shared/rapport-retention'
import { Spinner } from './Spinner'

/**
 * LA LISTE DES TRAVAUX FINIS MAIS JAMAIS PUBLIÉS — et le moyen de les LIRE.
 *
 * Mesuré le 2026-08-23 : 14 travaux terminés attendaient sur des branches `autowin/recovery/`, et
 * AUCUNE vue de l'app ne les montrait. La vue Workspace, la seule qui porte des actions sur un
 * bureau d'agent, affichait « 0 bureau » — parce qu'elle ne connaît que les bureaux VIVANTS, et que
 * la copie de ces travaux avait été balayée. Il ne restait que la branche.
 *
 * Conséquence : la seule option offerte à l'utilisateur était de fusionner ou de supprimer À
 * L'AVEUGLE. Ce panneau MONTRE d'abord — c'est le préalable à toute décision — puis offre le seul
 * geste qui ne détruit rien : réintégrer, c'est-à-dire retenter la publication.
 *
 * La frontière est tenue par un test qui lit ce fichier : supprimer, écraser ou trancher un conflit
 * restent interdits ici. Un travail qu'on ne peut pas lire ne se jette pas.
 */

/**
 * DELAI ENTRE DEUX TENTATIVES DE LECTURE DU RAPPORT, pendant la seule fenetre ou il manque encore.
 *
 * Calibre sur le cout MESURE de la passe de demarrage (11 720 ms) : plus court multiplierait les
 * lectures pour rien, plus long laisserait le panneau afficher « pas encore balayees » alors que le
 * rapport est deja pose. La relecture cesse des qu'un rapport arrive.
 */
export const INTERVALLE_ATTENTE_RAPPORT_MS = 3_000

export function TravauxNonPublies({ onFermer }: { onFermer: () => void }): React.JSX.Element {
  const [travaux, setTravaux] = useState<TravailNonPublie[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [patch, setPatch] = useState<{ patch: string; tronque: boolean } | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [resultat, setResultat] = useState<string | null>(null)
  /**
   * `undefined` = pas encore lu · `null` = lu, mais AUCUNE passe n'a eu lieu.
   * La distinction compte : « rien a signaler » et « on n'a rien regarde » ne se disent pas pareil.
   */
  const [rapport, setRapport] = useState<RapportRetention | null | undefined>(undefined)

  useEffect(() => {
    let vivant = true
    void (async () => {
      try {
        const liste = (await window.api.getTravauxNonPublies?.()) ?? []
        if (vivant) setTravaux(liste)
      } catch (cause) {
        if (vivant) setErreur(String(cause))
      }
    })()
    return () => {
      vivant = false
    }
  }, [])

  /*
   * LE RAPPORT DU BALAYAGE. Il ne DECLENCHE aucune passe : il rend le dernier verdict deja calcule
   * par le minuteur. Ce verdict ne vivait que dans la console, c'est-a-dire nulle part pour qui
   * utilise l'application.
   *
   * POURQUOI ON RELIT, au lieu de lire une fois au montage. La passe du demarrage arrive EN DIFFERE :
   * elle lance un `git cherry` par sauvegarde, soit 97 appels enchaines sur ce depot -- 11 720 ms
   * mesures. Une lecture unique tombe donc AVANT le rapport, affiche « pas encore balayees », et
   * reste bloquee la jusqu'a ce qu'on ferme et rouvre le panneau : le rapport existe, il est
   * invisible. On relit tant qu'il manque, et on S'ARRETE des qu'il arrive -- ce n'est pas un
   * rafraichissement periodique, c'est une attente qui se termine.
   */
  useEffect(() => {
    if (rapport) return
    let vivant = true
    const lire = async (): Promise<void> => {
      try {
        const lu = await window.api.getRapportRetention?.()
        if (vivant && lu) setRapport(lu)
        else if (vivant) setRapport(null)
      } catch {
        // Un rapport illisible ne doit pas masquer la liste des travaux : on reste silencieux.
        if (vivant) setRapport(null)
      }
    }
    void lire()
    const minuteur = setInterval(() => void lire(), INTERVALLE_ATTENTE_RAPPORT_MS)
    return () => {
      vivant = false
      clearInterval(minuteur)
    }
  }, [rapport])

  const voir = async (agentId: string): Promise<void> => {
    if (ouvert === agentId) {
      setOuvert(null)
      setPatch(null)
      return
    }
    setOuvert(agentId)
    setPatch(null)
    try {
      setPatch((await window.api.getPatchTravailNonPublie?.(agentId)) ?? null)
    } catch (cause) {
      setErreur(String(cause))
    }
  }

  /**
   * RÉINTÉGRER : le seul geste offert ici, et il n'est pas destructeur — il tente de reprendre la
   * publication du travail. Il reste ENTIÈREMENT à l'initiative de l'utilisateur, après lecture du
   * diff : la machine ne réintègre rien toute seule.
   *
   * Ce bouton n'existait pas avant le 2026-08-23 parce qu'il aurait été mort-né : la garde de reprise
   * exigeait `verdict === 'green'`, or 11 des 14 travaux bloqués sont des `command-edit` que personne
   * ne juge jamais. La garde distingue désormais « jamais jugé » de « jugé mauvais ».
   */
  const reintegrer = async (agentId: string): Promise<void> => {
    setEnCours(agentId)
    setResultat(null)
    try {
      const rendu = await window.api.retryWorktreeRecovery?.(agentId)
      /*
       * LIRE L'ISSUE, pas le fait qu'un objet soit revenu. Première version : ce message annonçait
       * « Reprise lancée » dès que l'appel rendait quelque chose — or il rend l'activité MISE À JOUR,
       * y compris quand elle est retombée en `blocked`. Le bouton félicitait donc l'utilisateur d'un
       * échec. Le motif réel, lui, est dans `detail` : par exemple « la copie ne descend pas du SHA
       * de départ autorisé », qui dit exactement quoi faire (rebaser) au lieu d'un « échec » opaque.
       */
      if (!rendu) {
        setResultat(`Reprise refusée pour ${agentId} — travail jugé rouge, ou déjà repris.`)
      } else if (rendu.state === 'blocked') {
        setResultat(`Reprise bloquée : ${rendu.detail ?? 'motif non précisé par le moteur.'}`)
      } else {
        setResultat(`Reprise lancée. Suis son avancement dans Source control.`)
      }
    } catch (cause) {
      setResultat(String(cause))
    } finally {
      setEnCours(null)
    }
  }

  return (
    <div className="tnp" data-testid="travaux-non-publies">
      <header className="tnp-tete">
        <b>Travaux terminés, jamais publiés</b>
        <button type="button" onClick={onFermer} aria-label="Fermer">
          ×
        </button>
      </header>

      {erreur && <p className="tnp-erreur">{erreur}</p>}
      {resultat && (
        <p className="tnp-resultat" data-testid="tnp-resultat">
          {resultat}
        </p>
      )}
      {!travaux && !erreur && <p className="tnp-vide">Lecture des branches…</p>}
      {travaux?.length === 0 && <p className="tnp-vide">Tout est publié.</p>}

      <ul className="tnp-liste">
        {(travaux ?? []).map((travail) => (
          <li key={travail.agentId} data-testid="tnp-ligne">
            <div className="tnp-ligne-tete">
              <span className="tnp-nom" title={`autowin/recovery/${travail.agentId}`}>
                {libelleTravail(travail)}
              </span>
              <span className="tnp-date">{travail.date}</span>
              <button
                type="button"
                data-testid={`tnp-voir-${travail.agentId}`}
                onClick={() => void voir(travail.agentId)}
              >
                {ouvert === travail.agentId ? 'Masquer' : 'Voir le diff'}
              </button>
              <button
                type="button"
                data-testid={`tnp-reintegrer-${travail.agentId}`}
                disabled={enCours === travail.agentId}
                onClick={() => void reintegrer(travail.agentId)}
                title="Retenter la publication de ce travail"
              >
                {enCours === travail.agentId ? '…' : 'Réintégrer'}
              </button>
            </div>
            {ouvert === travail.agentId && (
              <pre className="tnp-patch" data-testid="tnp-patch">
                {patch ? (
                  patch.patch || '(diff vide)'
                ) : (
                  <>
                    <Spinner /> Lecture…
                  </>
                )}
                {patch?.tronque ? '\n\n[…] diff tronqué — trop long pour être lu ici.' : ''}
              </pre>
            )}
          </li>
        ))}
      </ul>

      {/*
        DEUX VERSIONS DE CE TEXTE ONT MENTI, toutes deux ecrites le 2026-08-24, et l'historique vaut
        d'etre garde ici.

        La premiere finissait par « A la main : `git merge autowin/recovery/<id>` » -- une commande a
        recopier dans un terminal. Elle exposait du git brut, et elle etait fausse.

        La seconde annoncait « Autowin retente ces publications tout seul, regulierement ». Vrai pour
        un refus TRANSITOIRE, faux pour ceux-ci : mesure le meme jour sur les quatorze travaux reels
        de cette liste, tous etaient refuses pour ascendance rompue, donc « Reintegrer » echouait sur
        les quatorze, en silence. Promettre une reprise automatique qui ne peut pas aboutir est pire
        que ne rien dire -- l'utilisateur a d'ailleurs demande « et apres je fais quoi avec ca ? ».
      */}
      {/*
        LE BALAYAGE DE RETENTION, rendu VISIBLE. Il tourne au demarrage puis chaque heure et se
        contentait d'ecrire son verdict dans la console — un rapport qu'il faut savoir ou chercher
        est un rapport que personne ne lit, et c'est exactement ce qui a laisse quatorze travaux
        dormir sur des branches de secours (2026-08-24).

        On montre les deux categories SEPAREMENT parce qu'elles n'engagent pas la meme chose : ce
        qui est « deja en base » ne peut rien couter, ce qui est « perime » PORTE du travail que
        personne n'a lu. Les melanger inviterait a tout supprimer d'un geste.
      */}
      {rapport !== undefined && (
        <section className="tnp-retention" data-testid="tnp-retention">
          <b>Sauvegardes automatiques</b>
          {rapport === null ? (
            <p className="tnp-vide" data-testid="tnp-retention-jamais">
              <Spinner /> Balayage en cours… le premier examen prend une dizaine de secondes.
            </p>
          ) : (
            <>
              <p data-testid="tnp-retention-resume">
                {rapport.examines} sauvegarde(s) examinée(s) · {rapport.sansPerte.length} sans
                perte · {rapport.aTrancher.length} à trancher
                {rapport.reportees > 0 ? ` · ${rapport.reportees} au prochain passage` : ''}
              </p>
              {rapport.sansPerte.length > 0 && (
                <details data-testid="tnp-retention-sans-perte">
                  <summary>{rapport.sansPerte.length} déjà en base — rien à perdre</summary>
                  <ul>
                    {rapport.sansPerte.map((nom) => (
                      <li key={nom}>{nom}</li>
                    ))}
                  </ul>
                </details>
              )}
              {rapport.aTrancher.length > 0 && (
                <details data-testid="tnp-retention-a-trancher">
                  <summary>
                    {rapport.aTrancher.length} périmée(s) — elles portent du travail non lu
                  </summary>
                  <ul>
                    {rapport.aTrancher.map((nom) => (
                      <li key={nom}>{nom}</li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="tnp-note">
                Aucune n’est supprimée automatiquement — c’est un constat, pas un geste.
              </p>
            </>
          )}
        </section>
      )}

      <p className="tnp-note">
        Rien n’est supprimé ici. Autowin retente les publications qui peuvent encore aboutir ;
        certaines ne peuvent plus l’être, et « Traiter » est là pour faire trancher ces cas.
      </p>
    </div>
  )
}
