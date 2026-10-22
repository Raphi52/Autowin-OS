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
 *
 * « TOUT ENSEMBLE » (/draft conv-1088, 2026-10-22, choisi par l'utilisateur parmi 6 mélanges) :
 * dépliée, la carte porte un BILAN en tête (barre de proportions, un compte par couleur, coût connu),
 * le rail prend la couleur de chaque étape, le numéro vit dans le point, les titres se posent en
 * QUAIS ALTERNÉS (dessus / dessous), la ligne se remplit à l'arrivée, et le CLIC ouvre une FICHE
 * sous la ligne (constat, fichiers, mémoire, coût, « aller au message ») au lieu d'y emmener direct.
 */
import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Msg, AsstMsg } from './chat-view-types'
import {
  carteDuFil,
  quaisDe,
  LIBELLES_STATUT,
  type Carte,
  type EtapeCarte,
  type StatutEtape
} from './carte-du-fil'
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
  morceaux.push('clic : ouvrir sa fiche')
  return morceaux.join(' · ')
}

/** « 2 prouvées · 1 refusée · 2 sans preuve · 1 en cours » : un compte par couleur présente. */
function Bilan({ carte }: { carte: Carte }): React.JSX.Element {
  const morceaux: { statut: StatutEtape; n: number; libelle: string }[] = [
    { statut: 'prouve', n: carte.prouvees, libelle: `prouvée${carte.prouvees > 1 ? 's' : ''}` },
    { statut: 'refuse', n: carte.refusees, libelle: `refusée${carte.refusees > 1 ? 's' : ''}` },
    { statut: 'sans-preuve', n: carte.sansPreuve, libelle: 'sans preuve' },
    { statut: 'en-cours', n: carte.enCours, libelle: 'en cours' }
  ]
  // « prouvées » reste même à zéro : « 0 prouvée » est le constat le plus utile de tous.
  const presents = morceaux.filter((m) => m.n > 0 || m.statut === 'prouve')
  return (
    <span className="carte-compte" data-testid="carte-compte">
      {presents.map((m, k) => (
        <React.Fragment key={m.statut}>
          {k > 0 && ' · '}
          <b data-statut={m.statut}>{m.n}</b> {m.libelle}
        </React.Fragment>
      ))}
    </span>
  )
}

/** La barre de proportions de l'en-tête : une case par étape réelle, rangées par couleur. */
const ORDRE_DE_LA_BARRE: StatutEtape[] = ['prouve', 'refuse', 'sans-preuve', 'en-cours']

function memoireDe(etape: EtapeCarte, oubliees: number): string | null {
  if (etape.compactage)
    return oubliees > 0
      ? `◆ compactage ici — l’agent ne relit plus ${oubliees > 1 ? `les étapes 1 – ${oubliees}` : 'l’étape 1'}`
      : '◆ compactage ici — l’agent repart de ce résumé'
  if (etape.horsMemoire) return 'avant le compactage — l’agent ne relit plus cette étape'
  return null
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
  // L'étape dont la FICHE est ouverte (« Tout ensemble », conv-1088) : le clic ouvre la fiche, le
  // bouton « aller au message » de la fiche ramène au message. Le survol ne détaille plus rien.
  const [choisie, setChoisie] = useState<string | null>(null)
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
  const quais = useMemo(() => quaisDe(carte.etapes, carte.tuEtaisLa), [carte])

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

  // Repliée, un clic sur un point déplie la carte sur sa fiche — sans changer le choix enregistré.
  function choisir(cle: string): void {
    if (!ouverte) {
      setOuverte(true)
      setChoisie(cle)
      return
    }
    setChoisie((avant) => (avant === cle ? null : cle))
  }

  const etapeChoisie = carte.etapes.find((etape) => etape.cle === choisie)
  const numeroDe = (etape: EtapeCarte): number => carte.etapes.indexOf(etape) + 1
  const oubliees = carte.etapes.filter((etape) => etape.horsMemoire).length
  const reelles = carte.etapes.filter((etape) => etape.statut !== 'a-venir')
  const cases = ORDRE_DE_LA_BARRE.flatMap((statut) =>
    reelles.filter((etape) => etape.statut === statut)
  )
  const premiereTitree = quais.findIndex((quai) => quai !== null)
  const memoire = etapeChoisie ? memoireDe(etapeChoisie, oubliees) : null

  return (
    <section
      className={`carte-du-fil${ouverte ? ' is-ouverte' : ''}`}
      data-origine="carte-du-fil"
      aria-label="Carte du fil"
      onKeyDown={(evenement) => {
        if (evenement.key === 'Escape' && choisie) setChoisie(null)
      }}
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
        {ouverte ? (
          <>
            <span
              className="carte-barre"
              data-dense={cases.length > 16 ? 'oui' : undefined}
              aria-hidden="true"
            >
              {cases.map((etape) => (
                <i key={etape.cle} data-statut={etape.statut} />
              ))}
            </span>
            <Bilan carte={carte} />
            {carte.coutConnuUsd !== undefined && (
              <span className="carte-cout" data-testid="carte-cout">
                coût connu <b>{carte.coutConnuUsd.toFixed(2)} $</b>
              </span>
            )}
          </>
        ) : (
          <span className="carte-compte" data-testid="carte-compte">
            <b data-statut="prouve">
              {carte.prouvees} / {carte.total}
            </b>{' '}
            prouvée{carte.prouvees > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <ol ref={ligneRef} className={`carte-ligne${carte.tuEtaisLa ? ' avec-repere' : ''}`}>
        {carte.etapes.map((etape, rang) => {
          const repere = etape.cle === carte.tuEtaisLa
          const description = descriptionDe(etape, rang + 1)
          const quai = quais[rang]
          const bord =
            quai !== null && rang === premiereTitree && rang <= 1
              ? 'debut'
              : quai !== null && rang === nombre - 1
                ? 'fin'
                : undefined
          const fleche = (
            <span
              className="carte-repere"
              data-testid={repere ? 'carte-repere' : undefined}
              aria-hidden={!repere}
              title={repere && absence ? `Depuis ton passage : ${phraseAbsence(absence)}` : ''}
            >
              {/* La flèche seule : le texte « tu étais là » encombrait la ligne (conv-1059). */}
              {repere ? '▼' : ''}
            </span>
          )
          const surLeQuai = (
            <span className="carte-quai" aria-hidden="true">
              <b>{etape.titre}</b>
              <small>{libelleCourt(etape)}</small>
            </span>
          )
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
              data-quai={ouverte && quai ? quai : undefined}
              data-bord={ouverte ? bord : undefined}
              data-choisie={ouverte && etape.cle === choisie ? 'oui' : undefined}
              style={{ '--carte-rang': Math.min(rang, 15) } as CSSProperties}
            >
              {ouverte ? (
                <span className="carte-haut">{quai === 'haut' ? surLeQuai : repere && fleche}</span>
              ) : (
                carte.tuEtaisLa && fleche
              )}
              <span className="carte-rail">
                <i className="carte-troncon is-avant" />
                <button
                  type="button"
                  className="carte-point"
                  aria-expanded={ouverte ? etape.cle === choisie : undefined}
                  aria-label={
                    repere && absence
                      ? `${description} · depuis ton passage : ${phraseAbsence(absence)}`
                      : description
                  }
                  onClick={() => choisir(etape.cle)}
                >
                  {ouverte && <b>{etape.statut === 'a-venir' ? '→' : rang + 1}</b>}
                </button>
                <i className="carte-troncon is-apres" />
              </span>
              {ouverte && <span className="carte-bas">{quai === 'bas' && surLeQuai}</span>}
            </li>
          )
        })}
      </ol>
      {ouverte && etapeChoisie && (
        <div
          className="carte-fiche"
          data-testid="carte-fiche"
          data-statut={etapeChoisie.statut}
          role="region"
          aria-label={`Fiche de l’étape : ${etapeChoisie.titre}`}
        >
          <div className="carte-fiche-tete">
            <span className="carte-fiche-no">
              {etapeChoisie.statut === 'a-venir' ? '→' : numeroDe(etapeChoisie)}
            </span>
            <b className="carte-fiche-titre">{etapeChoisie.titreEntier}</b>
            <b className="carte-fiche-statut">{libelleCourt(etapeChoisie)}</b>
            <button
              type="button"
              className="carte-fiche-fermer"
              aria-label="Fermer la fiche"
              title="Fermer la fiche (Échap)"
              onClick={() => setChoisie(null)}
            >
              ✕
            </button>
          </div>
          <div className="carte-fiche-ligne">
            <span className="carte-fiche-cle">constat</span>
            <code className="carte-fiche-constat">
              {LIBELLES_STATUT[etapeChoisie.statut]} — {etapeChoisie.constat}
            </code>
          </div>
          {etapeChoisie.fichiers.length > 0 && (
            <div className="carte-fiche-ligne">
              <span className="carte-fiche-cle">fichiers</span>
              {etapeChoisie.fichiers.slice(0, 4).map((chemin) => (
                <code key={chemin} title={chemin}>
                  {chemin.split(/[\\/]/u).at(-1)}
                </code>
              ))}
              {etapeChoisie.fichiers.length > 4 && (
                <span className="carte-fiche-plus">+{etapeChoisie.fichiers.length - 4}</span>
              )}
            </div>
          )}
          {memoire && (
            <div className="carte-fiche-ligne">
              <span className="carte-fiche-cle">mémoire</span>
              <span className="carte-fiche-memoire">{memoire}</span>
            </div>
          )}
          {etapeChoisie.cle === carte.tuEtaisLa && absence && (
            <div className="carte-fiche-ligne">
              <span className="carte-fiche-cle">passage</span>
              <span className="carte-fiche-absence">
                depuis ton passage : {phraseAbsence(absence)}
              </span>
            </div>
          )}
          <div className="carte-fiche-ligne carte-fiche-pied">
            {etapeChoisie.coutUsd !== undefined && (
              <>
                <span className="carte-fiche-cle">coût</span>
                <b className="carte-fiche-cout">{etapeChoisie.coutUsd.toFixed(2)} $</b>
              </>
            )}
            <button
              type="button"
              className="carte-fiche-aller"
              onClick={() => onAller(etapeChoisie.cible)}
            >
              aller au message ↓
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
