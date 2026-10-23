/**
 * LA FICHE DE LA CARTE DES BESOINS (/draft conv-1102, 2026-10-22).
 *
 * Demande : « Implémente la Fiche avec un menu « Branches » qui propose état, semaine et dernier
 * constat, semaine par défaut, dans la vue Besoins. » Maquette choisie au /draft : un menu « Dépôt »
 * (un projet de la carte), un menu « Branches », une étoile dont le centre compte les fils du dépôt
 * et dont chaque branche est un groupe de fils, et à côté la fiche du fil choisi, demande par
 * demande. Le cercle or montre la branche où tombe ce fil.
 *
 * Trois dessins, ceux des maquettes montrées : le PEIGNE chronologique (une dent par semaine de
 * dernière activité, trous compris), l'ÉTOILE à colliers de perles (état), l'ÉTOILE à jauges (dernier
 * constat). Le calcul vit dans `carte-des-besoins-branches.ts`.
 *
 * Ajout au-delà de la maquette, pour qu'elle se parcoure : un clic sur une branche (ou une perle)
 * choisit son fil le plus récent, et la fiche porte « fil précédent / suivant » dans sa branche et
 * un lien qui ouvre le fil.
 */
import React, { useMemo, useState } from 'react'
import type { CarteDesBesoins, StatutDemande } from '../../../shared/carte-des-besoins'
import { LIBELLES_STATUT } from './carte-du-fil'
import {
  brancheDuFil,
  branchesDe,
  filsDuProjet,
  RANGEMENT_PAR_DEFAUT,
  RANGEMENTS,
  type BrancheDeLaCarte,
  type FilDeLaCarte,
  type Rangement
} from './carte-des-besoins-branches'

/** Demandes montrées dans la fiche : les plus récentes du fil, le reste se lit dans le fil. */
const DEMANDES_DE_LA_FICHE = 12
const LARGEUR = 370

const R = Math.round
const f1 = (n: number): number => Math.round(n * 10) / 10
const rad = (d: number): number => (d * Math.PI) / 180
const pol = (x: number, y: number, r: number, a: number): [number, number] => [
  x + r * Math.cos(rad(a)),
  y + r * Math.sin(rad(a))
]
const pourcent = (a: number, b: number): string => (b ? `${R((a / b) * 100)} %` : '—')

/** L'ancre d'une étiquette posée au bout d'une branche d'angle `a`. */
function ancre(a: number): 'start' | 'middle' | 'end' {
  const c = Math.cos(rad(a))
  return c < -0.2 ? 'end' : c > 0.2 ? 'start' : 'middle'
}

/** La jauge d'une branche : vert (fils prouvés), rouge (refusés), rose (en cours), gris dessous. */
function Jauge({
  x,
  y,
  r,
  comptes,
  total
}: {
  x: number
  y: number
  r: number
  comptes: Record<StatutDemande, number>
  total: number
}): React.JSX.Element {
  const c = 2 * Math.PI * r
  let deja = 0
  const parts = (['prouve', 'refuse', 'en-cours'] as const).flatMap((etat) => {
    const long = total ? (c * comptes[etat]) / total : 0
    const part =
      long > 0 ? (
        <circle
          key={etat}
          cx={f1(x)}
          cy={f1(y)}
          r={f1(r)}
          className="besoins-arc"
          data-statut={etat}
          strokeDasharray={`0 ${f1(deja)} ${f1(long)} 9999`}
        />
      ) : null
    deja += long
    return part ? [part] : []
  })
  return (
    <>
      <circle
        cx={f1(x)}
        cy={f1(y)}
        r={f1(r)}
        className="besoins-arc besoins-noeud"
        data-statut="sans-preuve"
      />
      {parts}
    </>
  )
}

interface ProprietesDuDessin {
  branches: BrancheDeLaCarte[]
  choisie: string | undefined
  fil: FilDeLaCarte | undefined
  totalFils: number
  choisir: (fil: FilDeLaCarte) => void
}

/** Une branche cliquable : le clic choisit son fil le plus récent. */
function Cliquable({
  branche,
  choisie,
  choisir,
  children
}: {
  branche: BrancheDeLaCarte
  choisie: boolean
  choisir: (fil: FilDeLaCarte) => void
  children: React.ReactNode
}): React.JSX.Element {
  const actif = branche.fils.length > 0
  return (
    <g
      className="besoins-branche"
      data-testid="besoins-branche"
      data-cle={branche.cle}
      data-choisie={choisie ? 'oui' : undefined}
      role={actif ? 'button' : undefined}
      tabIndex={actif ? 0 : undefined}
      aria-label={`${branche.libelle} : ${branche.fils.length} fils`}
      onClick={actif ? () => choisir(branche.fils[0]) : undefined}
      onKeyDown={
        actif
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                choisir(branche.fils[0])
              }
            }
          : undefined
      }
    >
      {children}
    </g>
  )
}

function Centre({ x, y, total }: { x: number; y: number; total: number }): React.JSX.Element {
  return (
    <g className="besoins-centre">
      <circle cx={x} cy={y} r={24} />
      <text x={x} y={y + 2} textAnchor="middle" className="besoins-centre-chiffre">
        {total}
      </text>
      <text x={x} y={y + 12} textAnchor="middle" className="besoins-centre-unite">
        fils
      </text>
    </g>
  )
}

/** Le peigne : une dent par semaine de dernière activité, de la plus ancienne à la plus récente. */
function Peigne({ branches, choisie, totalFils, choisir }: ProprietesDuDessin): React.JSX.Element {
  const n = branches.length
  const pas = 44
  const largeur = Math.max(LARGEUR, 48 + (n - 1) * pas)
  const hauteur = 212
  const cx = largeur / 2
  const cy = 40
  const yDent = 140
  const maxFils = Math.max(1, ...branches.map((b) => b.fils.length))
  const k = Math.min(0.65, 11 / Math.sqrt(maxFils))
  const xDe = (i: number): number => (n === 1 ? cx : 24 + (i * (largeur - 48)) / (n - 1))
  return (
    <svg
      className="besoins-dessin"
      data-testid="besoins-dessin"
      data-rangement="semaine"
      viewBox={`0 0 ${largeur} ${hauteur}`}
      width={largeur}
      height={hauteur}
      role="img"
      aria-label="Fils du dépôt par semaine de dernière activité"
    >
      <path className="besoins-rail" d={`M16 ${yDent}H${largeur - 16}`} />
      {branches.map((b, i) => {
        const x = xDe(i)
        const r = 4 + Math.sqrt(b.fils.length) * k
        const a = (Math.atan2(yDent - cy, x - cx) * 180) / Math.PI
        const [sx, sy] = pol(cx, cy, 26, a)
        const [ex, ey] = pol(x, yDent, r + 3, a + 180)
        const est = b.cle === choisie
        return (
          <Cliquable key={b.cle} branche={b} choisie={est} choisir={choisir}>
            {b.fils.length > 0 && (
              <path className="besoins-rayon" d={`M${R(sx)} ${R(sy)}L${R(ex)} ${R(ey)}`} />
            )}
            {b.fils.length > 0 ? (
              <Jauge x={x} y={yDent} r={r} comptes={b.comptes} total={b.fils.length} />
            ) : (
              <circle cx={f1(x)} cy={yDent} r={5} className="besoins-silence" />
            )}
            {est && <circle cx={f1(x)} cy={yDent} r={f1(r + 5.5)} className="besoins-choix" />}
            <text
              x={f1(x)}
              y={180}
              textAnchor="middle"
              className={`besoins-lib${est ? ' is-choisie' : ''}`}
            >
              {b.libelle}
            </text>
            <text
              x={f1(x)}
              y={192}
              textAnchor="middle"
              className={`besoins-val${est ? ' is-choisie' : ''}`}
            >
              {b.fils.length || 'silence'}
            </text>
            {b.fils.length > 0 && (
              <text
                x={f1(x)}
                y={204}
                textAnchor="middle"
                className={`besoins-val${est ? ' is-choisie' : b.comptes.prouve / b.fils.length >= 0.4 ? ' is-ok' : ''}`}
              >
                {pourcent(b.comptes.prouve, b.fils.length)}
              </text>
            )}
          </Cliquable>
        )
      })}
      <Centre x={cx} y={cy} total={totalFils} />
    </svg>
  )
}

/** L'étoile à jauges : une branche par famille de dernier constat, la première en bas. */
function Etoile({ branches, choisie, totalFils, choisir }: ProprietesDuDessin): React.JSX.Element {
  const n = branches.length
  const hauteur = 292
  const cx = 190
  const cy = 140
  const r0 = 92
  const maxFils = Math.max(1, ...branches.map((b) => b.fils.length))
  const k = Math.min(0.75, 17 / Math.sqrt(maxFils))
  return (
    <svg
      className="besoins-dessin"
      data-testid="besoins-dessin"
      data-rangement="constat"
      viewBox={`0 0 ${LARGEUR} ${hauteur}`}
      width={LARGEUR}
      height={hauteur}
      role="img"
      aria-label="Fils du dépôt par dernier constat"
    >
      {branches.map((b, i) => {
        const a = 90 + (360 / n) * i
        const [x, y] = pol(cx, cy, r0, a)
        const r = 5 + Math.sqrt(b.fils.length) * k
        const [sx, sy] = pol(cx, cy, 27, a)
        const [ex, ey] = pol(x, y, r + 3, a + 180)
        const est = b.cle === choisie
        const [lx, ly] = pol(x, y, r + (est ? 13 : 10), a)
        const sn = Math.sin(rad(a))
        const [y1, y2] =
          sn < -0.5 ? [ly - 12, ly - 1] : sn > 0.5 ? [ly + 8, ly + 19] : [ly - 1, ly + 10]
        const an = ancre(a)
        return (
          <Cliquable key={b.cle} branche={b} choisie={est} choisir={choisir}>
            <path className="besoins-rayon" d={`M${R(sx)} ${R(sy)}L${R(ex)} ${R(ey)}`} />
            <Jauge x={x} y={y} r={r} comptes={b.comptes} total={b.fils.length} />
            {est && <circle cx={f1(x)} cy={f1(y)} r={f1(r + 5.5)} className="besoins-choix" />}
            <text
              x={f1(lx)}
              y={f1(y1)}
              textAnchor={an}
              className={`besoins-lib${est ? ' is-choisie' : ''}`}
            >
              {b.libelle}
            </text>
            <text
              x={f1(lx)}
              y={f1(y2)}
              textAnchor={an}
              className={`besoins-val${est ? ' is-choisie' : ''}`}
            >
              {b.fils.length} · {pourcent(b.comptes.prouve, b.fils.length)}
            </text>
          </Cliquable>
        )
      })}
      <Centre x={cx} y={cy} total={totalFils} />
    </svg>
  )
}

/** L'étoile à colliers : une branche par état, un collier de perles par branche (perle ≈ N fils). */
function Colliers({
  branches,
  choisie,
  fil,
  totalFils,
  choisir
}: ProprietesDuDessin): React.JSX.Element {
  const n = branches.length
  const hauteur = 274
  const cx = 185
  const cy = 132
  const parPerle = Math.max(1, Math.ceil(totalFils / 96))
  const ecart = Math.min(116, (360 / Math.max(n, 1)) * 0.7)
  return (
    <svg
      className="besoins-dessin"
      data-testid="besoins-dessin"
      data-rangement="etat"
      viewBox={`0 0 ${LARGEUR} ${hauteur}`}
      width={LARGEUR}
      height={hauteur}
      role="img"
      aria-label={`Fils du dépôt par état, une perle pour ${parPerle} fils`}
    >
      {branches.map((b, i) => {
        const a = 90 + (360 / n) * (i + 1)
        const [x, y] = pol(cx, cy, 70, a)
        const r =
          6 + Math.sqrt(b.fils.length) * Math.min(0.55, 11 / Math.sqrt(Math.max(1, totalFils)))
        const [sx, sy] = pol(cx, cy, 26, a)
        const [ex, ey] = pol(x, y, r, a + 180)
        const est = b.cle === choisie
        const perles = Math.ceil(b.fils.length / parPerle)
        const pasPerle = perles > 1 ? ecart / (perles - 1) : 0
        const debut = a - (pasPerle * (perles - 1)) / 2
        const rangDuFil = fil
          ? b.fils.findIndex((f) => f.conversationId === fil.conversationId)
          : -1
        const [lx, ly] = pol(cx, cy, 128, a)
        const sn = Math.sin(rad(a))
        // La perle du fil choisi, et son identifiant écrit vers l'intérieur (comme sur la maquette).
        const anglePerle = debut + Math.floor(Math.max(rangDuFil, 0) / parPerle) * pasPerle
        const [mx, my] = pol(cx, cy, 112, anglePerle)
        const [ix, iy] = pol(cx, cy, 99, anglePerle)
        return (
          <Cliquable key={b.cle} branche={b} choisie={est} choisir={choisir}>
            <path className="besoins-rayon" d={`M${R(sx)} ${R(sy)}L${R(ex)} ${R(ey)}`} />
            <circle cx={f1(x)} cy={f1(y)} r={f1(r)} className="besoins-etat" data-statut={b.cle} />
            <text x={f1(x)} y={f1(y + 3)} textAnchor="middle" className="besoins-etat-chiffre">
              {b.fils.length}
            </text>
            {est && <circle cx={f1(x)} cy={f1(y)} r={f1(r + 4)} className="besoins-choix" />}
            {Array.from({ length: perles }, (_, p) => {
              const [px, py] = pol(cx, cy, 112, debut + p * pasPerle)
              const premier = b.fils[p * parPerle]
              return (
                <circle
                  key={p}
                  cx={f1(px)}
                  cy={f1(py)}
                  r={1.9}
                  className="besoins-perle"
                  data-statut={b.cle}
                  onClick={(e) => {
                    e.stopPropagation()
                    choisir(premier)
                  }}
                >
                  <title>{premier.titre}</title>
                </circle>
              )
            })}
            {est && fil && rangDuFil >= 0 && (
              <>
                <circle cx={f1(mx)} cy={f1(my)} r={6} className="besoins-choix" />
                <text
                  x={f1(ix)}
                  y={f1(iy + 3)}
                  textAnchor={ancre(anglePerle + 180)}
                  className="besoins-val is-choisie besoins-perle-id"
                >
                  {fil.conversationId}
                </text>
              </>
            )}
            <text
              x={f1(lx)}
              y={f1(ly + (sn > 0.5 ? 8 : 0))}
              textAnchor={ancre(a)}
              className={`besoins-lib${est ? ' is-choisie' : ''}`}
            >
              {b.libelle}
            </text>
          </Cliquable>
        )
      })}
      <Centre x={cx} y={cy} total={totalFils} />
    </svg>
  )
}

function accord(n: number, singulier: string, pluriel = `${singulier}s`): string {
  return `${n} ${n > 1 ? pluriel : singulier}`
}

/** « dans cette carte : branche semaine du 19/10 · 69 fils ». */
function libelleDeLaBranche(branche: BrancheDeLaCarte, rangement: Rangement): string {
  if (rangement === 'semaine' && branche.cle.startsWith('semaine-'))
    return `semaine du ${branche.libelle}`
  if (branche.cle === 'avant') return 'semaines plus anciennes'
  return branche.libelle
}

function FicheDuFil({
  fil,
  branche,
  rangement,
  choisir,
  ouvrir
}: {
  fil: FilDeLaCarte
  branche: BrancheDeLaCarte | undefined
  rangement: Rangement
  choisir: (fil: FilDeLaCarte) => void
  ouvrir: (conversationId: string) => void
}): React.JSX.Element {
  const rang = branche ? branche.fils.findIndex((f) => f.conversationId === fil.conversationId) : -1
  const precedent = branche && rang > 0 ? branche.fils[rang - 1] : undefined
  const suivant = branche && rang >= 0 ? branche.fils[rang + 1] : undefined
  const montrees = fil.demandes.slice(-DEMANDES_DE_LA_FICHE)
  const cachees = fil.demandes.length - montrees.length
  return (
    <div className="besoins-fiche" data-testid="besoins-fiche-fil" data-fil={fil.conversationId}>
      <div className="besoins-kicker">fil choisi</div>
      <div className="besoins-fiche-titre">
        <button
          type="button"
          className="besoins-fiche-id"
          onClick={() => ouvrir(fil.conversationId)}
          title="Ouvrir ce fil"
        >
          {fil.conversationId}
        </button>
        <span>{fil.titre}</span>
      </div>
      {branche && (
        <div className="besoins-fiche-ici" data-testid="besoins-fiche-ici">
          dans cette carte : branche <b>{libelleDeLaBranche(branche, rangement)}</b> ·{' '}
          {accord(branche.fils.length, 'fil')}
        </div>
      )}
      <div className="besoins-fiche-comptes">
        <b>{accord(fil.demandes.length, 'demande')}</b>
        {fil.comptes.prouve > 0 && <b className="is-ok">{accord(fil.comptes.prouve, 'prouvée')}</b>}
        {fil.comptes.refuse > 0 && (
          <b className="is-err">{accord(fil.comptes.refuse, 'refusée')}</b>
        )}
        {fil.comptes['en-cours'] > 0 && (
          <b className="is-accent">{fil.comptes['en-cours']} en cours</b>
        )}
        {fil.comptes['sans-preuve'] > 0 && <span>{fil.comptes['sans-preuve']} sans preuve</span>}
      </div>
      {cachees > 0 && (
        <div className="besoins-fiche-reste">
          {accord(cachees, 'demande plus ancienne', 'demandes plus anciennes')} — ouvre le fil pour
          les voir
        </div>
      )}
      <ol className="besoins-fiche-demandes" start={cachees + 1}>
        {montrees.map((d) => (
          <li key={d.rang} data-statut={d.statut} title={LIBELLES_STATUT[d.statut]}>
            <span className="besoins-fiche-demande">{d.titre}</span>
            <em>{d.constat}</em>
          </li>
        ))}
      </ol>
      {branche && branche.fils.length > 1 && (
        <div className="besoins-fiche-nav">
          <button
            type="button"
            disabled={!precedent}
            onClick={() => precedent && choisir(precedent)}
            title="Fil plus récent de la même branche"
          >
            ‹ précédent
          </button>
          <span>
            {rang + 1} / {branche.fils.length} dans la branche
          </span>
          <button
            type="button"
            disabled={!suivant}
            onClick={() => suivant && choisir(suivant)}
            title="Fil plus ancien de la même branche"
          >
            suivant ›
          </button>
        </div>
      )}
    </div>
  )
}

export function CarteDesBesoinsFiche({
  carte,
  ouvrir
}: {
  carte: CarteDesBesoins
  ouvrir: (conversationId: string) => void
}): React.JSX.Element | null {
  const depots = useMemo(() => carte.projets.filter((p) => p.demandes.length > 0), [carte])
  const [depotChoisi, setDepotChoisi] = useState<string | null>(null)
  const [rangement, setRangement] = useState<Rangement>(RANGEMENT_PAR_DEFAUT)
  const [filChoisi, setFilChoisi] = useState<string | null>(null)

  const depot = depots.find((p) => p.cle === depotChoisi) ?? depots[0]
  const fils = useMemo(() => (depot ? filsDuProjet(depot.demandes) : []), [depot])
  const branches = useMemo(() => branchesDe(fils, rangement), [fils, rangement])
  if (!depot || fils.length === 0) return null

  const fil = fils.find((f) => f.conversationId === filChoisi) ?? fils[0]
  const choisie = brancheDuFil(branches, fil.conversationId)
  const branche = branches.find((b) => b.cle === choisie)
  const avecPreuve = fils.filter((f) => f.etat === 'prouve').length
  const refuses = fils.filter((f) => f.etat === 'refuse').length
  const enCours = fils.filter((f) => f.etat === 'en-cours').length
  const sansPreuve = fils.length - avecPreuve - refuses - enCours
  const choisir = (f: FilDeLaCarte): void => setFilChoisi(f.conversationId)
  const dessin: ProprietesDuDessin = { branches, choisie, fil, totalFils: fils.length, choisir }

  return (
    <section className="besoins-carte" data-testid="besoins-fiche" aria-label="Carte du dépôt">
      <div className="besoins-carte-menus">
        <label>
          Dépôt
          <select
            className="besoins-menu"
            data-testid="besoins-menu-depot"
            value={depot.cle}
            title={depot.cle}
            onChange={(e) => {
              setDepotChoisi(e.target.value)
              setFilChoisi(null)
            }}
          >
            {depots.map((p) => (
              <option key={p.cle} value={p.cle}>
                {p.libelle} · {accord(p.conversations, 'fil')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Branches
          <select
            className="besoins-menu is-axe"
            data-testid="besoins-menu-branches"
            value={rangement}
            onChange={(e) => setRangement(e.target.value as Rangement)}
          >
            {RANGEMENTS.map((r) => (
              <option key={r.cle} value={r.cle}>
                {r.libelle}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="besoins-carte-resume">
        <b>{accord(fils.length, 'fil')}</b> · <b className="is-ok">{avecPreuve}</b> avec une preuve
        · <b className="is-err">{refuses}</b> {refuses > 1 ? 'refusés' : 'refusé'}
        {enCours > 0 && (
          <>
            {' '}
            · <b className="is-accent">{enCours}</b> en cours
          </>
        )}{' '}
        · <b>{sansPreuve}</b> sans preuve
      </div>
      <div className="besoins-carte-corps">
        <div className="besoins-carte-dessin">
          {rangement === 'semaine' ? (
            <Peigne {...dessin} />
          ) : rangement === 'etat' ? (
            <Colliers {...dessin} />
          ) : (
            <Etoile {...dessin} />
          )}
        </div>
        <FicheDuFil
          fil={fil}
          branche={branche}
          rangement={rangement}
          choisir={choisir}
          ouvrir={ouvrir}
        />
      </div>
      <div className="besoins-carte-legende">
        {rangement === 'semaine' && (
          <span>dent = semaine de dernière activité · chiffre = fils</span>
        )}
        {rangement === 'etat' && (
          <span>
            perle ≈ {accord(Math.max(1, Math.ceil(fils.length / 96)), 'fil')} · clic = ce fil
          </span>
        )}
        {rangement !== 'etat' && (
          <>
            <span>
              <i data-statut="prouve" />
              anneau vert = fils avec une preuve
            </span>
            <span>
              <i data-statut="refuse" />
              rouge = refusés
            </span>
            <span>
              <i data-statut="sans-preuve" />
              gris = sans preuve
            </span>
          </>
        )}
        <span>
          <i data-statut="choix" />
          cercle or = branche du fil choisi
        </span>
      </div>
    </section>
  )
}
