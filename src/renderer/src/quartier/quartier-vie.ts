/**
 * LE DÉCOR VIT (conv-1421, « ce décor doit pas etre statique il doit y avoir plein d'éléments qui
 * bougent partout »). Tout ce qui bouge sans être un tanuki : ciel, ville, eau, vapeurs, feuillages.
 *
 * Rien n'est repeint : ce sont des morceaux de la peinture qui glissent, ou de petites touches
 * dessinées par-dessus. Les teintes sont fixes : ce décor est une maquette, il ne suit pas le thème.
 */
import type { DonneesQuartier, ObjetCoupe } from './quartier-scene'

type Ctx = CanvasRenderingContext2D
interface Calque {
  x: number
  y: number
  w: number
  h: number
  i: HTMLImageElement
  px?: number
  py?: number
  bx?: number
  by?: number
}

export const toile = (l: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(l))
  c.height = Math.max(1, Math.ceil(h))
  return c
}

export const contexte = (c: HTMLCanvasElement): Ctx => c.getContext('2d') as Ctx

export const image = async (src: string): Promise<HTMLImageElement> => {
  const i = new Image()
  i.src = src
  await i.decode()
  return i
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a)
const lisse = (t: number): number => t * t * (3 - 2 * t)

/** Un rond flou d'une teinte : vapeurs, poussière, lueurs. */
const rondFlou = (r: number, g: number, b: number): HTMLCanvasElement => {
  const k = toile(48, 48)
  const c2 = contexte(k)
  const d = c2.createRadialGradient(24, 24, 1, 24, 24, 24)
  d.addColorStop(0, `rgba(${r},${g},${b},1)`)
  d.addColorStop(0.45, `rgba(${r},${g},${b},.42)`)
  d.addColorStop(1, `rgba(${r},${g},${b},0)`)
  c2.fillStyle = d
  c2.fillRect(0, 0, 48, 48)
  return k
}

/** L'instant où le maillet touche le gong, après le début du geste. */
const IMPACT_S = 0.34
const RECUL = 0.5
/** Un tanuki au poste du gong ne frappe pas sans arrêt. */
const PAUSE_FRAPPE_S = 8

export interface VieDecor {
  /** `actifs(...postes)` : un tanuki y travaille-t-il ? La machine et le gong réagissent. */
  avancer(
    dt: number,
    actifs: (...postes: number[]) => boolean,
    tanukis: readonly { etat: string; sur: number; y: number; x: number; ph: number; pas: number }[]
  ): void
  ciel(x: Ctx): void
  eau(x: Ctx): void
  pieces(x: Ctx): void
  feuillages(x: Ctx, devant: boolean): void
  airs(x: Ctx): void
  /** Le maillet du gong : au-dessus de tout, et redessiné quand le survol repeint la zone. */
  maillet(x: Ctx): void
  frapper(sonner: () => void): void
  temps(): number
}

export async function creerVie(
  D: DonneesQuartier,
  F: HTMLImageElement,
  S: number,
  OB: ObjetCoupe[],
  FE: ObjetCoupe[]
): Promise<
  VieDecor & { rond: HTMLCanvasElement; rondO: HTMLCanvasElement; rondR: HTMLCanvasElement }
> {
  const VI = D.vie
  const rond = rondFlou(255, 255, 255)
  const rondS = rondFlou(214, 186, 140)
  const rondO = rondFlou(255, 196, 70)
  const rondR = rondFlou(235, 62, 48)
  const faisceau = toile(256, 64)
  {
    const c2 = contexte(faisceau)
    const d = c2.createLinearGradient(0, 0, 256, 0)
    d.addColorStop(0, 'rgba(255,244,190,.9)') // couleur-fixe: faisceau du phare, peint dans la maquette
    d.addColorStop(1, 'rgba(255,244,190,0)') // couleur-fixe: faisceau du phare, peint dans la maquette
    c2.fillStyle = d
    c2.beginPath()
    c2.moveTo(0, 32)
    c2.lineTo(256, 0)
    c2.lineTo(256, 64)
    c2.closePath()
    c2.fill()
  }
  const CAL: Record<string, Calque> = {}
  await Promise.all(
    Object.entries(VI.calques).map(async ([n, o]) => {
      CAL[n] = { ...o, i: await image(o.m) }
    })
  )
  for (const o of OB) if (o.n && CAL[o.n]) o.cal = CAL[o.n]
  const e = VI.eau
  const EAUm = await image(e.m)
  const EAUc = toile(e.w, e.h)
  const EAUg = contexte(EAUc)
  const EAUs = toile(e.w + 6, e.h)
  contexte(EAUs).drawImage(F, 0, e.y * S, (e.w + 6) * S, e.h * S, 0, 0, e.w + 6, e.h)
  const NUA = await Promise.all(
    VI.nuages.map(async (o, i) => ({
      ...o,
      i: await image(o.m),
      v: [4.6, 3.1, 2.2][i],
      dx: [420, -120, 760][i],
      y: [34, 118, 8][i]
    }))
  )
  const bonsai = OB.filter((o) => o.cle === 'worktree').map((o) => ({ ...o, A: 1.4, f: 1.1, p: 2 }))
  FE.push(...bonsai)

  let temps = 0
  let gust = 1
  let angleVolant = 0
  let dtVolant = 0
  let machineActive = false
  let frappeDebut = -99
  let impactFait = true
  let sonner: (() => void) | null = null
  const GONG = VI.gong
  const SRC = [
    { x: 305, y: 706, r: 11, dt: 0.32, v: 15, a: 0.36, t: 0, mach: false },
    { x: 460, y: 652, r: 8, dt: 0.55, v: 11, a: 0.26, t: 0.2, mach: false },
    { x: 535, y: 666, r: 10, dt: 0.36, v: 14, a: 0.36, t: 0.4, mach: false },
    { x: 885, y: 180, r: 3, dt: 0.4, v: 10, a: 0.4, t: 0.1, mach: false },
    { x: 483, y: 590, r: 4, dt: 0.9, v: 16, a: 0.32, t: 0.3, mach: true }
  ]
  const FUM: {
    x: number
    y: number
    vx: number
    vy: number
    r: number
    a: number
    age: number
    vie: number
    g: number
  }[] = []
  const POU: { x: number; y: number; r: number; age: number; vie: number }[] = []
  const ONDES: { age: number }[] = []
  const PET = Array.from({ length: 44 }, () => ({
    x: rnd(0, 900),
    y: rnd(320, 720),
    v: rnd(10, 22),
    c: rnd(0, 6),
    s: rnd(1.6, 2.6)
  }))
  const NIDS = [
    [55, 355],
    [120, 350],
    [170, 352],
    [278, 345],
    [357, 340],
    [450, 335],
    [530, 335],
    [20, 505]
  ]
  const OIS = Array.from({ length: 11 }, (_, i) => {
    const g = i < 5 ? 0 : i < 8 ? 1 : 2
    return {
      x: [-40, 500, 1180][g] - (i % 5) * 16 + rnd(-5, 5),
      y: [120, 62, 150][g] + (i % 3) * 9 + rnd(-4, 4),
      v: [17, 13, -15][g],
      ph: rnd(0, 6),
      s: rnd(3.2, 4.6)
    }
  })
  const BAT = [
    { x: 120, y: 386, v: 6, c: '#c8553d' }, // couleur-fixe: bateau de la maquette
    { x: 470, y: 372, v: -4.2, c: '#e8b23e' }, // couleur-fixe: bateau de la maquette
    { x: 300, y: 442, v: 7.5, c: '#3f6fb5' } // couleur-fixe: bateau de la maquette
  ]
  const ECL = Array.from({ length: 70 }, () => ({
    x: rnd(0, e.w),
    y: rnd(0, e.h),
    f: rnd(0.8, 2.4),
    p: rnd(0, 6)
  }))
  const FEN = Array.from({ length: 34 }, () => {
    const b = [
      [56, 225, 44, 120],
      [147, 230, 38, 110],
      [232, 232, 42, 112],
      [316, 225, 38, 90],
      [472, 250, 40, 84]
    ][Math.floor(rnd(0, 5))]
    return {
      x: b[0] + Math.floor(rnd(0, b[2] / 5)) * 5,
      y: b[1] + Math.floor(rnd(0, b[3] / 7)) * 7,
      t: rnd(0, 6),
      on: Math.random() < 0.5
    }
  })
  const PAP = Array.from({ length: 7 }, (_, i) => ({
    cx: rnd(260, 880),
    cy: rnd(640, 700),
    r: rnd(12, 34),
    p: rnd(0, 6),
    v: rnd(0.5, 1.1),
    c: ['#f2a23a', '#f6f1e4', '#e86a92', '#7fb7e8'][i % 4] // couleur-fixe: papillons de la maquette
  }))
  const BAL = { x: 690, y: 92, v: -3.4 }
  const TRAM = {
    t: 0.2,
    s: 1,
    ps: [
      [556, 342],
      [600, 339],
      [640, 342],
      [680, 352],
      [712, 365]
    ]
  }

  const dessinerBateau = (g: Ctx, b: (typeof BAT)[number]): void => {
    const k = (b.y - 340) / 60 + 0.7
    g.save()
    g.translate(b.x, b.y - e.y + Math.sin(temps * 1.4 + b.x * 0.1) * 0.5)
    g.scale(k * Math.sign(b.v), k)
    g.fillStyle = 'rgba(255,255,255,.35)' // couleur-fixe: sillage sur l'eau
    g.fillRect(-16, 1.6, 9, 0.9)
    g.fillStyle = b.c
    g.beginPath()
    g.moveTo(-7, -1)
    g.lineTo(7.5, -1)
    g.lineTo(5, 2)
    g.lineTo(-5, 2)
    g.closePath()
    g.fill()
    g.fillStyle = '#fbf3e1' // couleur-fixe: voile
    g.beginPath()
    g.moveTo(0, -10)
    g.lineTo(0, -1.6)
    g.lineTo(6, -1.6)
    g.closePath()
    g.fill()
    g.restore()
  }

  const ballon = (x: Ctx): void => {
    const bx = BAL.x
    const by = BAL.y + Math.sin(temps * 0.4) * 5
    const ba = ['#e4572e', '#f3c340', '#2f7ec2'] // couleur-fixe: montgolfière de la maquette
    x.save()
    x.translate(bx, by)
    x.beginPath()
    x.moveTo(-3, 11)
    x.bezierCurveTo(-17, -2, -12, -18, 0, -18)
    x.bezierCurveTo(12, -18, 17, -2, 3, 11)
    x.closePath()
    x.clip()
    for (let k = 0; k < 5; k++) {
      x.fillStyle = ba[k % 3]
      x.fillRect(-16 + k * 6.4, -20, 6.4, 34)
    }
    x.restore()
    x.strokeStyle = 'rgba(60,44,30,.8)' // couleur-fixe: cordes de la nacelle
    x.lineWidth = 0.7
    x.beginPath()
    x.moveTo(bx - 3, by + 11)
    x.lineTo(bx - 2, by + 16)
    x.moveTo(bx + 3, by + 11)
    x.lineTo(bx + 2, by + 16)
    x.stroke()
    x.fillStyle = '#7a5230' // couleur-fixe: nacelle
    x.fillRect(bx - 2.5, by + 16, 5, 3.6)
  }

  const dessinerMaillet = (x: Ctx): void => {
    // Le maillet recule, retombe sur le disque, puis se balance encore un peu.
    const t = temps - frappeDebut
    let bal = 0
    if (t < 0.2) bal = -lisse(t / 0.2) * RECUL
    else if (t < IMPACT_S) bal = -(1 - ((t - 0.2) / (IMPACT_S - 0.2)) ** 2) * RECUL
    else if (t < 4)
      bal = -0.12 * Math.exp(-(t - IMPACT_S) * 1.6) * Math.abs(Math.sin((t - IMPACT_S) * 5.2))
    const Ma = CAL.maillet
    x.save()
    x.translate(Ma.px ?? 0, Ma.py ?? 0)
    x.rotate(bal + Math.sin(temps * 0.9) * 0.008)
    x.drawImage(Ma.i, Ma.x - (Ma.px ?? 0), Ma.y - (Ma.py ?? 0), Ma.w, Ma.h)
    x.restore()
  }

  return {
    rond,
    rondO,
    rondR,
    temps: () => temps,
    frapper(son) {
      if (temps - frappeDebut < 1.6) return
      frappeDebut = temps
      impactFait = false
      sonner = son
    },
    avancer(dt, actifs, tanukis) {
      temps += dt
      dtVolant = dt
      machineActive = actifs(0, 1, 2, 3)
      gust = 0.65 + 0.35 * Math.sin(temps * 0.23) * Math.sin(temps * 0.071 + 1)
      for (const s of SRC) {
        s.t -= dt * (s.mach && actifs(0, 1, 2, 3) ? 3.2 : 1)
        if (s.t <= 0) {
          s.t = s.dt * rnd(0.7, 1.3)
          FUM.push({
            x: s.x + rnd(-s.r, s.r) * 0.6,
            y: s.y,
            vx: rnd(1, 5),
            vy: -rnd(s.v * 0.7, s.v),
            r: s.r * rnd(0.8, 1.2),
            a: s.a,
            age: 0,
            vie: rnd(2.2, 3.8),
            g: s.r * 1.1
          })
        }
      }
      for (let i = FUM.length - 1; i >= 0; i--) {
        const p = FUM[i]
        p.age += dt
        if (p.age > p.vie) {
          FUM.splice(i, 1)
          continue
        }
        p.x += (p.vx + Math.sin(p.age * 1.9 + p.vie * 4) * 5) * dt
        p.y += p.vy * dt
        p.r += p.g * dt
      }
      for (const w of tanukis)
        if (w.etat === 'va' && w.sur < 0 && w.y > 672) {
          const q = Math.floor(w.ph * 2)
          if (q !== w.pas) {
            ;(w as { pas: number }).pas = q
            POU.push({ x: w.x + rnd(-4, 4), y: w.y + 1, r: 2.5, age: 0, vie: rnd(0.5, 0.9) })
          }
        }
      for (let i = POU.length - 1; i >= 0; i--) {
        const p = POU[i]
        p.age += dt
        if (p.age > p.vie) POU.splice(i, 1)
        else {
          p.r += 11 * dt
          p.y -= 3 * dt
        }
      }
      for (const p of PET) {
        p.x += (p.v * gust + 4) * dt
        p.y += (9 + Math.sin(temps * 1.3 + p.c) * 9) * dt
        p.c += dt
        if (p.x > 1000 || p.y > 760) {
          const n = NIDS[Math.floor(rnd(0, NIDS.length))]
          p.x = n[0] + rnd(-14, 14)
          p.y = n[1] + rnd(-8, 8)
        }
      }
      for (const b of OIS) {
        b.x += b.v * dt
        if (b.x > 1400) b.x = -60
        if (b.x < -60) b.x = 1400
      }
      for (const b of BAT) {
        b.x += b.v * dt
        if (b.x > 760) b.v = -Math.abs(b.v)
        if (b.x < 20) b.v = Math.abs(b.v)
      }
      for (const f of FEN) {
        f.t -= dt
        if (f.t <= 0) {
          f.t = rnd(2, 9)
          f.on = !f.on
        }
      }
      TRAM.t += TRAM.s * dt * 0.035
      if (TRAM.t > 1) {
        TRAM.t = 1
        TRAM.s = -1
      }
      if (TRAM.t < 0) {
        TRAM.t = 0
        TRAM.s = 1
      }
      BAL.x += BAL.v * dt
      if (BAL.x < -40) BAL.x = 1380
      for (const n of NUA) {
        n.dx += n.v * dt
        if (n.dx > 1500) n.dx = -n.w - 60
      }
      // Le disque se balance longtemps après le coup, et ne reste jamais tout à fait immobile.
      const apres = temps - frappeDebut - IMPACT_S
      const choc = impactFait && apres >= 0 ? Math.exp(-apres * 0.9) : 0
      for (const o of OB)
        if (o.n === 'gong')
          o.rot = choc * Math.sin(apres * 3.4) * 0.05 + Math.sin(temps * 0.9) * 0.003
        else if (o.cal) {
          const poste = o.n === 'mannequin1' ? 20 : 21
          o.rot = actifs(poste)
            ? Math.sin(temps * 13) * 0.075 * Math.max(0, Math.sin(temps * 6))
            : Math.sin(temps * 0.8 + poste) * 0.006
        }
      // Un tanuki au poste du gong le frappe de temps en temps : sans son (voir quartier-son.ts).
      if (actifs(26) && temps - frappeDebut > PAUSE_FRAPPE_S) {
        frappeDebut = temps
        impactFait = false
        sonner = null
      }
      if (!impactFait && temps - frappeDebut >= IMPACT_S) {
        impactFait = true
        sonner?.()
        sonner = null
        ONDES.push({ age: 0 }, { age: -0.24 }, { age: -0.48 })
      }
      for (let i = ONDES.length - 1; i >= 0; i--) {
        ONDES[i].age += dt
        if (ONDES[i].age > 1.7) ONDES.splice(i, 1)
      }
    },
    eau(x) {
      const g = EAUg
      g.globalCompositeOperation = 'source-over'
      g.globalAlpha = 1
      g.clearRect(0, 0, e.w, e.h)
      // L'eau bouge pour de vrai : chaque ligne glisse un peu, davantage quand elle est proche.
      for (let j = 0; j < e.h; j++) {
        const Yv = e.y + j
        const k = j / e.h
        const dx =
          Math.sin(Yv * 0.46 + temps * 1.8) * (0.5 + k * 1.6) +
          Math.sin(Yv * 0.15 - temps * 0.9) * (0.4 + k * 1.2)
        g.drawImage(EAUs, 0, j, e.w + 6, 1, dx - 3, j, e.w + 6, 1.15)
      }
      for (const b of BAT) dessinerBateau(g, b)
      g.fillStyle = '#ffffff' // couleur-fixe: scintillement de l'eau
      for (const p of ECL) {
        const a = Math.abs(Math.sin(temps * p.f + p.p)) ** 12
        if (a < 0.05) continue
        g.globalAlpha = a * 0.85
        g.fillRect(p.x - 1.5, p.y, 3, 0.8)
        g.fillRect(p.x, p.y - 0.8, 0.8, 2.4)
      }
      g.globalAlpha = 1
      g.globalCompositeOperation = 'destination-in'
      g.drawImage(EAUm, 0, 0, e.w, e.h)
      x.drawImage(EAUc, e.x, e.y)
    },
    ciel(x) {
      ballon(x)
      for (const n of NUA) {
        x.globalAlpha = 0.7
        x.drawImage(n.i, n.dx, n.y, n.w, n.h)
        x.globalAlpha = 1
      }
      // Les nuages passent derrière ce qui est grand : le Brain, les tours et l'observatoire restent devant.
      for (const o of OB) if (o.fixe === 'ciel') x.drawImage(o.k, o.x, o.y, o.w, o.h)
      x.strokeStyle = 'rgba(38,46,66,.72)' // couleur-fixe: oiseaux dans le ciel peint
      x.lineWidth = 1.1
      x.lineCap = 'round'
      x.beginPath()
      for (const b of OIS) {
        const a = Math.sin(temps * 8 + b.ph) * b.s * 0.55
        x.moveTo(b.x - b.s, b.y - a)
        x.quadraticCurveTo(b.x - b.s * 0.45, b.y - b.s * 0.4, b.x, b.y)
        x.quadraticCurveTo(b.x + b.s * 0.45, b.y - b.s * 0.4, b.x + b.s, b.y - a)
      }
      x.stroke()
      x.globalCompositeOperation = 'lighter'
      for (const [a, b, s] of VI.etoiles) {
        const v = 0.5 + 0.5 * Math.sin(temps * (1 + (a % 7) * 0.23) + b)
        x.globalAlpha = 0.1 + 0.6 * v * v
        const r = s * (1.1 + v * 0.7)
        x.drawImage(rond, a - r, b - r, r * 2, r * 2)
      }
      // L'anneau de Jarvis respire, le phare balaie la ville.
      const v = 0.55 + 0.45 * Math.sin(temps * 1.5)
      const r = 25 + v * 7
      x.globalAlpha = 0.22 + 0.3 * v
      x.drawImage(rond, 493 - r, 222 - r, r * 2, r * 2)
      const th = temps * 0.62
      const dx = Math.cos(th)
      const dy = Math.sin(th) * 0.16
      x.globalAlpha = 0.1 + 0.22 * Math.abs(dx)
      x.save()
      x.translate(413, 204)
      x.rotate(Math.atan2(dy, dx))
      x.scale(Math.hypot(dx, dy) * 0.86, 0.34)
      x.drawImage(faisceau, 0, -32)
      x.restore()
      x.globalAlpha = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(temps * 3.3))
      x.drawImage(rond, 402, 194, 22, 22)
      x.globalAlpha = 0.9
      x.globalCompositeOperation = 'source-over'
      x.fillStyle = '#ffe9a8' // couleur-fixe: fenêtres allumées
      for (const f of FEN) if (f.on) x.fillRect(f.x, f.y, 2.6, 3.2)
      x.globalAlpha = 1
      // Le tram sur le pont.
      const n = TRAM.ps.length - 1
      const u = TRAM.t * n
      const i = Math.min(n - 1, Math.floor(u))
      const a = TRAM.ps[i]
      const b = TRAM.ps[i + 1]
      x.save()
      x.translate(a[0] + (b[0] - a[0]) * (u - i), a[1] + (b[1] - a[1]) * (u - i))
      x.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]))
      x.fillStyle = '#d4483a' // couleur-fixe: tram de la maquette
      x.fillRect(-7, -5, 14, 5)
      x.fillStyle = '#fbe6b0' // couleur-fixe: vitres du tram
      for (let k = -6; k < 6; k += 3) x.fillRect(k, -4, 1.6, 2)
      x.restore()
    },
    pieces(x) {
      // La salle de méditation : posée sur la peinture, les tanukis passent devant.
      const Ze = CAL.zendo
      x.drawImage(Ze.i, Ze.x, Ze.y, Ze.w, Ze.h)
      const R0 = CAL.roue
      const Vo = CAL.volant
      x.save()
      x.translate(R0.px ?? 0, R0.py ?? 0)
      x.rotate(temps * 0.32)
      x.drawImage(R0.i, R0.x - (R0.px ?? 0), R0.y - (R0.py ?? 0), R0.w, R0.h)
      x.restore()
      x.save()
      x.translate(Vo.px ?? 0, Vo.py ?? 0)
      angleVolant += (machineActive ? 7.5 : 1.1) * dtVolant
      x.rotate(angleVolant)
      x.drawImage(Vo.i, Vo.x - (Vo.px ?? 0), Vo.y - (Vo.py ?? 0), Vo.w, Vo.h)
      x.restore()
      // L'ombre du gong reste sur le mur, le disque se balance devant (voir `avancer`).
      const Oo = CAL.gongOmbre
      x.drawImage(Oo.i, Oo.x, Oo.y, Oo.w, Oo.h)
      // La longue-vue de l'observatoire cherche quelque chose, très lentement.
      const lv = OB.find((o) => o.cle === 'observatory')
      if (lv) {
        x.save()
        x.translate(1165, 128)
        x.rotate(Math.sin(temps * 0.31) * 0.012)
        x.translate(-1165, -128)
        x.drawImage(lv.k, lv.x, lv.y, lv.w, lv.h)
        x.restore()
      }
    },
    maillet: dessinerMaillet,
    feuillages(x, devant) {
      for (const f of FE) {
        if (Boolean(f.dv) !== devant) continue
        const A = f.A ?? 0
        const fr = f.f ?? 1
        const p = f.p ?? 0
        const k =
          (A / f.h) * gust * Math.sin(temps * fr + p) +
          (A / f.h) * 0.3 * Math.sin(temps * fr * 2.3 + p)
        const by = f.y + f.h
        x.save()
        x.transform(1, 0, k, 1, -k * by, 0)
        x.drawImage(f.k, f.x, f.y, f.w, f.h)
        x.restore()
      }
    },
    airs(x) {
      for (const p of POU) {
        x.globalAlpha = 0.34 * (1 - p.age / p.vie)
        x.drawImage(rondS, p.x - p.r, p.y - p.r * 0.6, p.r * 2, p.r * 1.2)
      }
      for (const p of FUM) {
        x.globalAlpha = p.a * (1 - p.age / p.vie) * Math.min(1, p.age * 2.5)
        x.drawImage(rond, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)
      }
      const t = temps - frappeDebut
      dessinerMaillet(x)
      // Le bronze s'éclaire au coup, et le son se voit : des ondes dorées qui partent du disque.
      const [cx, cy, rayon] = GONG.disque
      x.globalCompositeOperation = 'lighter'
      if (t >= IMPACT_S && t < 3) {
        x.globalAlpha = 0.55 * Math.exp(-(t - IMPACT_S) * 2)
        x.drawImage(rondO, cx - rayon, cy - rayon, rayon * 2, rayon * 2)
      }
      x.lineWidth = 2
      for (const o of ONDES) {
        if (o.age < 0) continue
        const u = o.age / 1.7
        x.globalAlpha = 0.6 * (1 - u)
        x.strokeStyle = '#ffe2a0' // couleur-fixe: onde du gong, lumière du bronze
        x.beginPath()
        x.ellipse(cx, cy, rayon + u * 110, (rayon + u * 110) * 0.82, 0, 0, 6.3)
        x.stroke()
      }
      x.globalCompositeOperation = 'source-over'
      x.globalAlpha = 1
      x.fillStyle = '#f8c4d6' // couleur-fixe: pétales de cerisier
      for (const p of PET) {
        x.save()
        x.translate(p.x, p.y)
        x.rotate(p.c)
        x.scale(1, Math.abs(Math.sin(p.c * 2.2)) * 0.8 + 0.25)
        x.beginPath()
        x.ellipse(0, 0, p.s, p.s * 0.62, 0, 0, 6.3)
        x.fill()
        x.restore()
      }
      for (const b of PAP) {
        const t0 = temps * b.v + b.p
        const px = b.cx + Math.sin(t0) * b.r + Math.sin(t0 * 2.7) * 5
        const py = b.cy + Math.cos(t0 * 1.3) * b.r * 0.35 + Math.sin(t0 * 3.1) * 3
        const f = Math.abs(Math.sin(temps * 16 + b.p)) * 0.9 + 0.15
        x.fillStyle = b.c
        x.beginPath()
        x.ellipse(px - 2.1 * f, py - 0.5, 2.4 * f, 2.2, -0.4, 0, 6.3)
        x.ellipse(px + 2.1 * f, py - 0.5, 2.4 * f, 2.2, 0.4, 0, 6.3)
        x.fill()
      }
    }
  }
}
