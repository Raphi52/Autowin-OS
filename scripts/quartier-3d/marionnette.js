// Le tanuki en feutrine, en vrai volume (conv-1421) : maillage sculpté, squelette, marche par cinématique inverse.
// Les pieds sont posés par le calcul : le pied d'appui ne peut pas glisser, car la phase avance avec la distance parcourue.
async function chargerTanuki(M) {
  const o = Uint8Array.from(atob(M.d), (c) => c.charCodeAt(0))
  const flux = new Blob([o]).stream().pipeThrough(new DecompressionStream('gzip'))
  const ab = await new Response(flux).arrayBuffer()
  const n = M.nv, ni = M.ni
  let p = 0
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), ao = new Float32Array(n)
  const ski = new Uint8Array(n * 4), skw = new Float32Array(n * 4)
  for (let c = 0; c < 3; c++) { const a = new Int16Array(ab, p, n); for (let i = 0; i < n; i++) pos[i * 3 + c] = a[i] / M.ech; p += n * 2 }
  for (let c = 0; c < 3; c++) { const a = new Int8Array(ab, p, n); for (let i = 0; i < n; i++) nor[i * 3 + c] = a[i] / 127; p += n }
  for (let c = 0; c < 3; c++) { const a = new Uint8Array(ab, p, n); for (let i = 0; i < n; i++) { const v = a[i] / 255; col[i * 3 + c] = v < .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4) } p += n }
  const gl = new Uint8Array(ab, p, n); p += n
  for (let i = 0; i < n; i++) ao[i] = gl[i] / 255
  const ba = new Uint8Array(ab, p, n); p += n
  const bb = new Uint8Array(ab, p, n); p += n
  const bw = new Uint8Array(ab, p, n); p += n
  for (let i = 0; i < n; i++) { ski[i * 4] = ba[i]; ski[i * 4 + 1] = bb[i]; skw[i * 4] = bw[i] / 255; skw[i * 4 + 1] = 1 - bw[i] / 255 }
  // conv-1558 : modèle haute définition au-delà de 65 535 sommets → index 32 bits (drapeau i32).
  const d = M.i32 ? new Int32Array(ab.slice(p), 0, ni) : new Int16Array(ab.slice(p), 0, ni), idx = M.i32 ? new Uint32Array(ni) : new Uint16Array(ni)
  let v = 0
  for (let i = 0; i < ni; i++) { v += d[i]; idx[i] = v }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aG', new THREE.BufferAttribute(ao, 1))
  g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(ski, 4))
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skw, 4))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  return { g, os: M.os, mat: matFeutre() }
}
// La feutrine : des fibres qui accrochent la lumière, un voile clair sur les bords, et les perles restent brillantes.
function matFeutre() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96, metalness: 0 })
  m.onBeforeCompile = (s) => {
    s.vertexShader = 'attribute float aG;varying float vG;varying vec3 vO;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvG=aG;vO=position;')
    s.fragmentShader = `varying float vG;varying vec3 vO;
float h3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
vec3 fibres(vec3 p){vec3 q=p+.04*vec3(vn(p*33.),vn(p*33.+7.),vn(p*33.+13.));vec3 a=vec3(vn(q*vec3(150.,420.,150.)),vn(q*vec3(420.,150.,160.)),vn(q*vec3(160.,170.,420.)));vec3 b=vec3(vn(q*520.),vn(q*520.+3.),vn(q*520.+5.));return a*.65+b*.35-.5;}
` + s.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.1,vG);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nvec3 fb=fibres(vO);float fk=clamp(1.-length(fwidth(vO))*90.,0.,1.);normal=normalize(normal+(1.-vG)*1.15*fk*fb);')
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat fc=vn(vO*260.)*.6+vn(vO*90.)*.4;diffuseColor.rgb*=mix(.76+.5*fc,1.,vG);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat rv=1.-clamp(dot(normalize(vViewPosition),normal),0.,1.);totalEmissiveRadiance+=(1.-vG)*diffuseColor.rgb*pow(rv,2.4)*uVoile;')
      .replace('#include <common>', '#include <common>\nuniform float uVoile;')
    s.uniforms.uVoile = m.userData.voile
  }
  m.userData.voile = { value: .55 }
  return m
}
function creerTanuki(T) {
  const os = T.os.map((b) => { const o = new THREE.Bone(); o.name = b.n; return o })
  T.os.forEach((b, i) => {
    if (b.p >= 0) { const q = T.os[b.p]; os[i].position.set(b.x - q.x, b.y - q.y, b.z - q.z); os[b.p].add(os[i]) } else os[i].position.set(b.x, b.y, b.z)
  })
  const m = new THREE.SkinnedMesh(T.g, T.mat)
  m.add(os[0]); m.bind(new THREE.Skeleton(os))
  m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true
  const o = {}; T.os.forEach((b, i) => { o[b.n] = os[i]; os[i].userData.r = os[i].position.clone() })
  return { m, o, ph: Math.random(), ca: 0 }
}
const CUISSE = .096, TIBIA = .117, FOULEE = .098, APPUI = .62, LEVE = .066, BAISSE = .028, H_CHEV = .068, L_ORT = .13, L_TAL = .06
const douce = (u) => u * u * (3 - 2 * u)
// Le pied tourne autour du point qui touche le sol : orteils en poussée, talon à la pose. Cheville = point de contact recalé.
function contact(z, a) {
  if (a > 0) return [z + L_ORT - (-H_CHEV * Math.sin(a) + L_ORT * Math.cos(a)), H_CHEV * (Math.cos(a) - 1) + L_ORT * Math.sin(a), a]
  if (a < 0) return [z - L_TAL + H_CHEV * Math.sin(a) + L_TAL * Math.cos(a), H_CHEV * (Math.cos(a) - 1) - L_TAL * Math.sin(a), a]
  return [z, 0, 0]
}
function appui(u) {
  const z = FOULEE - 2 * FOULEE * u
  if (u < .14) { const k = 1 - u / .14; return contact(z, -.38 * k * k) }
  if (u > .64) { const k = (u - .64) / .36; return contact(z, .85 * k * k) }
  return [z, 0, 0]
}
function piedCycle(t) {
  t -= Math.floor(t)
  if (t < APPUI) return appui(t / APPUI)
  const u = (t - APPUI) / (1 - APPUI), [z0, y0, a0] = appui(1), [z1, y1, a1] = appui(0), v = douce(u)
  return [z0 + (z1 - z0) * v, y0 + (y1 - y0) * u + LEVE * Math.pow(Math.sin(Math.PI * u), 1.15), a0 + (a1 - a0) * v]
}
function jambe(c, t, s, b, hy, k, pente) {
  const [z0, y0, a0] = piedCycle(t), z = z0 * k, y = y0 * k, a = a0 * k
  const cu = c.o['cu' + s], ti = c.o['ti' + s], pi = c.o['pi' + s]
  const tz = z, ty = -.212 + b + y - hy + pente * z
  const d = Math.min(CUISSE + TIBIA - .001, Math.hypot(tz, ty))
  const A = Math.acos(Math.min(1, (CUISSE * CUISSE + d * d - TIBIA * TIBIA) / (2 * CUISSE * d)))
  const B = Math.acos(Math.min(1, (CUISSE * CUISSE + TIBIA * TIBIA - d * d) / (2 * CUISSE * TIBIA)))
  const al = Math.atan2(tz, -ty)
  cu.rotation.x = -(al + A)
  ti.rotation.x = Math.PI - B
  pi.rotation.x = -(cu.rotation.x + ti.rotation.x) + a - Math.atan(pente) * k
}
// ph : phase du pas de 0 à 1. On avance de 2·FOULEE pendant APPUI du cycle : c'est ce qui colle le pied au sol.
// Le bassin ne tourne pas : un bassin qui tourne ferait glisser les pieds. Le buste porte tout le balancement.
function poseMarche(c, ph, k = 1, pente = 0) {
  const s4 = Math.sin(4 * Math.PI * (ph - .06)), c4 = Math.cos(4 * Math.PI * (ph - .06)), s2 = Math.sin(2 * Math.PI * ph)
  const hy = -.011 * c4 * k, b = BAISSE * (.3 + .7 * k)
  const o = c.o
  o.hanches.position.y = o.hanches.userData.r.y - b + hy
  o.hanches.rotation.set(0, 0, 0)
  o.buste.rotation.set(.05 + .02 * s4 * k + pente * .3, -.2 * s2 * k, .05 * Math.sin(2 * Math.PI * (ph - .08)) * k)
  o.tete.rotation.set(-.05 + .025 * Math.sin(4 * Math.PI * (ph - .16)) * k - pente * .3, .1 * s2 * k, .03 * Math.sin(2 * Math.PI * (ph - .2)) * k)
  jambe(c, ph, 'G', b, hy, k, pente); jambe(c, ph + .5, 'D', b, hy, k, pente)
  const bras = .52 * Math.sin(2 * Math.PI * (ph + .02)) * k
  o.epG.rotation.set(bras, 0, -.12); o.epD.rotation.set(-bras, 0, .12)
  o.coG.rotation.x = -.22 + .2 * Math.sin(2 * Math.PI * (ph - .08)) * k
  o.coD.rotation.x = -.22 - .2 * Math.sin(2 * Math.PI * (ph - .08)) * k
  const or = .13 * Math.sin(4 * Math.PI * (ph - .22)) * k
  o.oG.rotation.set(or, 0, -.05); o.oD.rotation.set(or, 0, .05)
  const q = .34 * Math.sin(2 * Math.PI * (ph - .1)) * k
  o.q1.rotation.set(.05 * s4, q, 0); o.q2.rotation.y = q * .7; o.q3.rotation.set(-.06 * s4, q * .8, 0)
}
// Gestes de travail : on repart d'une pose debout, puis les bras disent ce qu'il fait.
const GESTES = {
  marteau(c, t) {
    const u = (t * 1.5) % 1
    c.o.epD.rotation.set(-2.75 + 1.75 * (u < .72 ? douce(Math.min(1, u / .22)) * 0 + Math.pow(Math.min(1, Math.max(0, (u - .45) / .27)), 2) : 1 - douce((u - .72) / .28)), 0, .1)
    c.o.coD.rotation.x = -.45
    c.o.epG.rotation.set(-.3, 0, -.25)
    c.o.buste.rotation.x = .1 + .22 * Math.pow(Math.min(1, Math.max(0, (u - .45) / .27)), 2) * (u < .72 ? 1 : 1 - douce((u - .72) / .28))
  },
  pinceau(c, t) {
    const a = Math.sin(t * 2.4)
    c.o.epD.rotation.set(-1.15, a * .3, .2); c.o.epG.rotation.set(-1.25, a * .3, -.2)
    c.o.coD.rotation.x = -.4; c.o.coG.rotation.x = -.4
    c.o.buste.rotation.set(.24, a * .22, 0); c.o.tete.rotation.x = .16
  },
  lire(c, t) {
    c.o.epD.rotation.set(-1.15, 0, .28); c.o.epG.rotation.set(-1.15, 0, -.28)
    c.o.coD.rotation.x = -.75; c.o.coG.rotation.x = -.75
    c.o.tete.rotation.set(.2 + .05 * Math.sin(t * 1.3), .12 * Math.sin(t * .7), 0)
  },
  sabre(c, t) {
    const u = (t * .95) % 1, b = u < .55 ? douce(u / .55) : 1 - Math.pow((u - .55) / .45, 2)
    c.o.epD.rotation.set(-1.0 - 1.75 * b, 0, .3); c.o.epG.rotation.set(-1.0 - 1.75 * b, 0, -.3)
    c.o.coD.rotation.x = -.5; c.o.coG.rotation.x = -.5
    c.o.buste.rotation.x = .16 * (1 - b)
  },
  parler(c, t) {
    c.o.epD.rotation.set(-.4, 0, 1.0 + .5 * Math.sin(t * 5)); c.o.coD.rotation.x = -.4 * (1 + Math.sin(t * 5))
    c.o.tete.rotation.set(-.08, .18 * Math.sin(t * 1.6), .08 * Math.sin(t * 2.3))
  },
  bain(c, t) {
    c.o.epD.rotation.set(-.2, 0, .95); c.o.epG.rotation.set(-.2, 0, -.95)
    c.o.tete.rotation.set(-.12 + .04 * Math.sin(t * .8), .1 * Math.sin(t * .5), .06 * Math.sin(t * .6))
    c.o.oG.rotation.z = -.35; c.o.oD.rotation.z = .35
  }
}
function poseGeste(c, nom, t) {
  poseMarche(c, .25, 0)
  c.o.buste.rotation.set(.02, 0, 0); c.o.tete.rotation.set(-.04, 0, 0)
  c.o.coG.rotation.x = -.22; c.o.coD.rotation.x = -.22
  GESTES[nom]?.(c, t)
}
