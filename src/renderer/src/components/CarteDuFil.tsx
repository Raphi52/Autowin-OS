/**
 * CARTE DU FIL (conv-1059, 2026-10-22) — la ligne de métro en haut du fil, À LA PLACE du carnet.
 *
 * Demande : « une ligne de métro en haut du fil, une étape par demande, une couleur selon le
 * résultat prouvé (vert, refusé, en cours, à venir), un repère « tu étais là » à la place de la
 * carte « Pendant ton absence », un clic sur une étape qui ramène au message ». Ce qu'elle montre
 * est calculé par `carte-du-fil.ts` ; ici, l'affichage, la lecture des fichiers touchés (relue à
 * chaque tour fini, comme le carnet) et le survol qui détaille une étape.
 *
 * Un cinquième état existe, « sans preuve » : un tour fini sans aucune vérification n'est pas vert.
 * Le montrer vert aurait fait de la carte une déclaration de succès, pas un constat.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Msg, AsstMsg } from './chat-view-types'
import { carteDuFil, LIBELLES_STATUT, type EtapeCarte } from './carte-du-fil'
import { resumeDAbsence, type ResumeAbsence } from './carnet-du-fil'
import './CarteDuFil.css'

type TraceDeFichier = { timestamp: string; paths: string[] }

/** Le choix replié/déplié suit l'utilisateur d'un fil à l'autre. */
const CLE_OUVERTE = 'autowin.chat.carte.ouverte'

function lireOuverte(): boolean {
  try {
    return window.localStorage.getItem(CLE_OUVERTE) !== '0'
  } catch {
    return true
  }
}

function ecrireOuverte(ouverte: boolean): void {
  try {
    window.localStorage.setItem(CLE_OUVERTE, ouverte ? '1' : '0')
  } catch {
    /* un stockage plein ne doit pas empêcher de replier la carte */
  }
}

/** Repris de la carte « Pendant ton absence » du carnet : le repère porte désormais ce résumé. */
function phraseAbsence(resume: ResumeAbsence): string {
  const morceaux = [
    `${resume.tours} tour${resume.tours > 1 ? 's' : ''} fini${resume.tours > 1 ? 's' : ''}`
  ]
  if (resume.fichiers > 0)
    morceaux.push(
      `${resume.fichiers} fichier${resume.fichiers > 1 ? 's' : ''} modifié${resume.fichiers > 1 ? 's' : ''}`
    )
  if (resume.question) morceaux.push('une question t’attend')
  if (resume.coutUsd !== undefined)
    morceaux.push(`coût ${resume.coutPartiel ? 'd’au moins ' : ''}${resume.coutUsd.toFixed(2)} $`)
  return morceaux.join(' · ')
}

function libelleCourt(etape: EtapeCarte): string {
  if (etape.question) return 'question'
  if (etape.horsMemoire) return 'oubliée'
  return LIBELLES_STATUT[etape.statut]
}

function descriptionDe(etape: EtapeCarte, numero: number): string {
  const morceaux = [
    etape.statut === 'a-venir' ? `À venir : ${etape.titre}` : `Étape ${numero} : ${etape.titre}`,
    `${LIBELLES_STATUT[etape.statut]} — ${etape.constat}`
  ]
  if (etape.horsMemoire) morceaux.push('l’agent ne relit plus cette étape depuis le compactage')
  if (etape.fichiers.length > 0)
    morceaux.push(
      `${etape.fichiers.length} fichier${etape.fichiers.length > 1 ? 's' : ''} touché${etape.fichiers.length > 1 ? 's' : ''}`
    )
  if (etape.coutUsd !== undefined) morceaux.push(`coût connu ${etape.coutUsd.toFixed(2)} $`)
  morceaux.push('clic : aller au message')
  return morceaux.join(' · ')
}

export function CarteDuFil({
  conversationId,
  fil,
  vueAvantOuverture,
  onAller
}: {
  conversationId: string
  fil: readonly Msg[]
  /** Repère « non lu » lu AVANT d'ouvrir le fil, seulement s'il était non lu. */
  vueAvantOuverture?: number
  /** Ramène le fil au message de rang donné. */
  onAller: (rang: number) => void
}): React.JSX.Element | null {
  const [traces, setTraces] = useState<TraceDeFichier[]>([])
  const [ouverte, setOuverte] = useState(lireOuverte)
  const [survol, setSurvol] = useState<string | null>(null)
  const ligneRef = useRef<HTMLOListElement | null>(null)
  const ouverteParLeRepere = useRef(false)

  // RELU À CHAQUE TOUR FINI, comme le carnet : un tour en cours n'a encore rien conclu.
  const dernier = fil.at(-1)
  const tourEnCours = dernier?.role === 'assistant' && (dernier as AsstMsg).status === 'streaming'
  const signature = `${fil.length}:${tourEnCours ? 'en-cours' : 'fini'}`
  useEffect(() => {
    let vivant = true
    // Un pont d'avant redémarrage n'a pas ce canal : la carte se dessine sans les fichiers.
    void Promise.resolve(window.api?.conversationFileTraces?.(conversationId)).then(
      (lues) => {
        if (vivant && Array.isArray(lues))
          setTraces(lues.map(({ timestamp, paths }) => ({ timestamp, paths })))
      },
      () => undefined
    )
    return () => {
      vivant = false
    }
  }, [conversationId, signature])

  const carte = useMemo(
    () => carteDuFil({ fil, vueA: vueAvantOuverture, traces }),
    [fil, vueAvantOuverture, traces]
  )
  const absence = useMemo(
    () => resumeDAbsence({ fil, vueA: vueAvantOuverture, traces }),
    [fil, vueAvantOuverture, traces]
  )

  // Un fil non lu s'ouvre sur le repère : une fois, sans toucher au choix enregistré.
  useEffect(() => {
    if (carte.tuEtaisLa && !ouverteParLeRepere.current) {
      ouverteParLeRepere.current = true
      setOuverte(true)
    }
  }, [carte.tuEtaisLa])

  // La ligne défile d'elle-même jusqu'au repère, sinon jusqu'à la dernière étape.
  const nombre = carte.etapes.length
  useEffect(() => {
    const ligne = ligneRef.current
    if (!ligne) return
    const repere = carte.tuEtaisLa
      ? ligne.querySelector<HTMLElement>(`[data-cle="${carte.tuEtaisLa}"]`)
      : null
    ligne.scrollLeft = repere
      ? Math.max(0, repere.offsetLeft - ligne.clientWidth / 3)
      : ligne.scrollWidth
  }, [nombre, carte.tuEtaisLa, ouverte])

  if (nombre === 0) return null

  function basculer(): void {
    const suivante = !ouverte
    setOuverte(suivante)
    ecrireOuverte(suivante)
  }

  const etapeSurvolee = carte.etapes.find((etape) => etape.cle === survol)
  const numeroDe = (etape: EtapeCarte): number => carte.etapes.indexOf(etape) + 1

  return (
    <section
      className={`carte-du-fil${ouverte ? ' is-ouverte' : ''}`}
      data-origine="carte-du-fil"
      aria-label="Carte du fil"
    >
      <div className="carte-entete">
        <button
          type="button"
          className="carte-bascule"
          aria-expanded={ouverte}
          title="Le chemin du fil : une étape par demande, colorée par ce qu’elle a prouvé"
          onClick={basculer}
        >
          <span className="carte-chevron" aria-hidden="true">
            {ouverte ? '▾' : '▸'}
          </span>
          <span className="carte-titre">Carte du fil</span>
        </button>
        <span className="carte-compte" data-testid="carte-compte">
          <b>
            {carte.prouvees} / {carte.total}
          </b>{' '}
          prouvée{carte.prouvees > 1 ? 's' : ''}
        </span>
      </div>
      <ol
        ref={ligneRef}
        className={`carte-ligne${carte.tuEtaisLa ? ' avec-repere' : ''}`}
        onMouseLeave={() => setSurvol(null)}
      >
        {carte.etapes.map((etape, rang) => {
          const repere = etape.cle === carte.tuEtaisLa
          const description = descriptionDe(etape, rang + 1)
          return (
            <li
              key={etape.cle}
              className="carte-station"
              data-cle={etape.cle}
              data-statut={etape.statut}
              data-nouvelle={etape.nouvelle ? 'oui' : undefined}
              data-hors-memoire={etape.horsMemoire ? 'oui' : undefined}
              data-compactage={etape.compactage ? 'oui' : undefined}
              data-question={etape.question ? 'oui' : undefined}
            >
              {carte.tuEtaisLa && (
                <span
                  className="carte-repere"
                  data-testid={repere ? 'carte-repere' : undefined}
                  aria-hidden={!repere}
                  title={repere && absence ? `Depuis ton passage : ${phraseAbsence(absence)}` : ''}
                >
                  {repere ? '▼ tu étais là' : ''}
                </span>
              )}
              <span className="carte-rail">
                <i className="carte-troncon is-avant" />
                <button
                  type="button"
                  className="carte-point"
                  aria-label={
                    repere && absence
                      ? `${description} · tu étais là ; depuis : ${phraseAbsence(absence)}`
                      : description
                  }
                  onMouseEnter={() => setSurvol(etape.cle)}
                  onFocus={() => setSurvol(etape.cle)}
                  onBlur={() => setSurvol(null)}
                  onClick={() => onAller(etape.cible)}
                />
                <i className="carte-troncon is-apres" />
              </span>
              {ouverte && (
                <span className="carte-libelle" aria-hidden="true">
                  <b>{etape.titre}</b>
                  <small>{libelleCourt(etape)}</small>
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {etapeSurvolee && (
        <div
          className="carte-detail"
          data-testid="carte-detail"
          data-statut={etapeSurvolee.statut}
          role="status"
        >
          <b className="carte-detail-titre">
            {etapeSurvolee.statut === 'a-venir' ? 'À venir' : `Étape ${numeroDe(etapeSurvolee)}`} ·{' '}
            {etapeSurvolee.titre}
          </b>
          <span className="carte-detail-constat">
            {LIBELLES_STATUT[etapeSurvolee.statut]} — {etapeSurvolee.constat}
          </span>
          {etapeSurvolee.horsMemoire && (
            <span className="carte-detail-oubli">
              l’agent ne relit plus cette étape depuis le compactage
            </span>
          )}
          {etapeSurvolee.cle === carte.tuEtaisLa && absence && (
            <span className="carte-detail-absence">
              tu étais là · depuis : {phraseAbsence(absence)}
            </span>
          )}
          {(etapeSurvolee.fichiers.length > 0 || etapeSurvolee.coutUsd !== undefined) && (
            <span className="carte-detail-puces">
              {etapeSurvolee.fichiers.slice(0, 4).map((chemin) => (
                <code key={chemin}>{chemin.split(/[\\/]/u).at(-1)}</code>
              ))}
              {etapeSurvolee.fichiers.length > 4 && (
                <span>+{etapeSurvolee.fichiers.length - 4}</span>
              )}
              {etapeSurvolee.coutUsd !== undefined && (
                <span className="carte-detail-cout">{etapeSurvolee.coutUsd.toFixed(2)} $</span>
              )}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
