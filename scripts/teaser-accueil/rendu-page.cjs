const { ipcRenderer } = require('electron')
const fs = require('fs'),
  path = require('path')
const ici = __dirname
const lire = (n) => fs.readFileSync(path.join(ici, n), 'utf8')
const log = (m) => ipcRenderer.invoke('log', m)

async function principal() {
  const cfg = await ipcRenderer.invoke('config')
  const { etat, BOUCLE } = require(path.join(ici, 'timeline.cjs'))
  const L = cfg.largeur,
    H = cfg.hauteur
  const canvas = document.getElementById('c')
  canvas.width = L
  canvas.height = H
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power'
  })
  if (!gl) throw new Error('pas de webgl2')
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('pas de cible flottante')
  gl.getExtension('OES_texture_float_linear')
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  await log(
    `moteur: ${info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.VERSION)}`
  )

  const VS = `#version 300 es\nout vec2 vUv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`
  const prog = (vs, fsrc) => {
    const p = gl.createProgram()
    for (const [t, s] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fsrc]
    ]) {
      const o = gl.createShader(t)
      gl.shaderSource(o, s)
      gl.compileShader(o)
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o))
      gl.attachShader(p, o)
    }
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
    const u = {}
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < n; i++) {
      const a = gl.getActiveUniform(p, i)
      u[a.name] = gl.getUniformLocation(p, a.name)
    }
    return { p, u }
  }
  const t0 = performance.now()
  const pScene = prog(VS, lire('scene.frag'))
  const pPost = prog(VS, lire('post.frag'))
  const pBas = prog(VS, lire('bas.frag'))
  const pHaut = prog(VS, lire('haut.frag'))
  const pCopie = prog(
    VS,
    `#version 300 es\nprecision highp float;in vec2 vUv;out vec4 c;uniform sampler2D t;uniform float k;void main(){c=texture(t,vUv)*k;}`
  )
  const pGrains = prog(lire('grains.vert'), lire('grains.frag'))
  await log(`nuanceurs compilés en ${Math.round(performance.now() - t0)} ms`)
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)

  const cible = (w, h, fmt = gl.RGBA16F, type = gl.HALF_FLOAT) => {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, gl.RGBA, type, null)
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { tex, fb, w, h }
  }
  const unEchantillon = cible(L, H),
    cumul = cible(L, H),
    final = cible(L, H, gl.RGBA8, gl.UNSIGNED_BYTE)
  const niveaux = []
  for (let i = 1, w = L, h = H; i <= 7; i++) {
    w = Math.max(2, w >> 1)
    h = Math.max(2, h >> 1)
    niveaux.push(cible(w, h))
  }

  // Bruit 3D qui se répète : une seule lecture par couche de brume.
  const N = 96,
    bruit = new Uint8Array(N * N * N)
  const graine = (x, y, z, p) => {
    const s =
      Math.sin(
        (((x % p) + p) % p) * 127.1 + (((y % p) + p) % p) * 311.7 + (((z % p) + p) % p) * 74.7
      ) * 43758.5453
    return s - Math.floor(s)
  }
  const lisse = (t) => t * t * (3 - 2 * t)
  const m = (a, b, t) => a + (b - a) * t
  const vnoise = (x, y, z, p) => {
    const i = Math.floor(x),
      j = Math.floor(y),
      k = Math.floor(z),
      f = lisse(x - i),
      g = lisse(y - j),
      h = lisse(z - k)
    return m(
      m(
        m(graine(i, j, k, p), graine(i + 1, j, k, p), f),
        m(graine(i, j + 1, k, p), graine(i + 1, j + 1, k, p), f),
        g
      ),
      m(
        m(graine(i, j, k + 1, p), graine(i + 1, j, k + 1, p), f),
        m(graine(i, j + 1, k + 1, p), graine(i + 1, j + 1, k + 1, p), f),
        g
      ),
      h
    )
  }
  for (let z = 0, q = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++, q++) {
        let v = 0,
          a = 0.5,
          f = 6,
          tot = 0
        for (let o = 0; o < 5; o++) {
          v += a * vnoise((x / N) * f, (y / N) * f, (z / N) * f, f)
          tot += a
          a *= 0.5
          f *= 2
        }
        bruit[q] = Math.min(255, Math.max(0, Math.round((v / tot - 0.5) * 1.9 * 255 + 127)))
      }
  gl.activeTexture(gl.TEXTURE2)
  gl.bindTexture(gl.TEXTURE_3D, gl.createTexture())
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, N, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, bruit)
  gl.generateMipmap(gl.TEXTURE_3D)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
    gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT)
  await log(`bruit prêt à ${Math.round(performance.now() - t0)} ms`)

  // Masques peints : fenêtre-horloge et vrai cercle de runes.
  const { peindreMasque, peindreGlyphe, peindreTitre } = require(path.join(ici, 'masques.cjs'))
  const envoyerImage = (unite, source) => {
    gl.activeTexture(unite)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }
  envoyerImage(gl.TEXTURE0, peindreMasque())
  envoyerImage(gl.TEXTURE1, await peindreGlyphe(fs.readFileSync(cfg.glyphe, 'utf8')))
  envoyerImage(gl.TEXTURE6, peindreTitre(L, H))

  // Grains : poussière, sable qui remonte, braises, cierges.
  const { grains } = require(path.join(ici, 'grains.cjs'))
  const G = grains()
  const vaoG = gl.createVertexArray()
  gl.bindVertexArray(vaoG)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, G.donnees, gl.STATIC_DRAW)
  const stride = G.taille * 4
  G.attributs.forEach(([nom, n, dec]) => {
    const a = gl.getAttribLocation(pGrains.p, nom)
    if (a < 0) return
    gl.enableVertexAttribArray(a)
    gl.vertexAttribPointer(a, n, gl.FLOAT, false, stride, dec * 4)
  })
  gl.bindVertexArray(vao)

  const camUniformes = (P, e, t) => {
    gl.uniform3fv(P.u.uCam, e.cam)
    gl.uniform3fv(P.u.uCible, e.cible)
    gl.uniform1f(P.u.uFov, e.fov)
    gl.uniform1f(P.u.uRoulis, e.roulis ?? 0)
    gl.uniform2f(P.u.uRes, L, H)
    gl.uniform1f(P.u.uT, t)
  }
  const halton = (i, b) => {
    let f = 1,
      r = 0
    while (i > 0) {
      f /= b
      r += f * (i % b)
      i = Math.floor(i / b)
    }
    return r
  }

  const rendreImage = (n) => {
    // Le flou de mouvement vit de ses passes : les plans rapides en demandent plus, voir `passes`.
    const S = cfg.echantillons === 1 ? 1 : (etat(n).passes ?? cfg.echantillons)
    gl.bindFramebuffer(gl.FRAMEBUFFER, cumul.fb)
    gl.viewport(0, 0, L, H)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    let e0
    for (let s = 0; s < S; s++) {
      // Obturateur à 180°, depuis le début de l'image : à cheval sur une coupe, les passes
      // superposeraient deux plans.
      const e = etat(n + (S > 1 ? ((s + 0.5) / S) * 0.5 : 0))
      e0 = e
      if (e.noir) continue
      const t = e.t
      gl.bindFramebuffer(gl.FRAMEBUFFER, unEchantillon.fb)
      gl.viewport(0, 0, L, H)
      gl.disable(gl.BLEND)
      gl.useProgram(pScene.p)
      camUniformes(pScene, e, t)
      gl.uniform1i(pScene.u.tMasque, 0)
      gl.uniform1i(pScene.u.tGlyphe, 1)
      gl.uniform1i(pScene.u.tBruit, 2)
      gl.uniform2f(pScene.u.uJit, halton(s + 1, 2) - 0.5, halton(s + 1, 3) - 0.5)
      gl.uniform1f(pScene.u.uGraine, (n * 0.61803 + s * 0.37) % 1)
      gl.uniform1f(pScene.u.uFenetre, e.fenetre)
      gl.uniform1f(pScene.u.uCercle, e.cercle)
      gl.uniform1f(pScene.u.uYeux, e.yeux)
      gl.uniform1f(pScene.u.uBrume, e.brume ?? 1)
      gl.uniform1f(pScene.u.uBalaye, e.balaye ?? 1)
      gl.uniform1f(pScene.u.uInvoque, e.invoque ?? 0)
      gl.uniform1f(pScene.u.uOnde, e.onde ?? 0)
      gl.uniform1f(pScene.u.uGeste, e.geste ?? 0)
      gl.uniform1f(pScene.u.uBaton, e.baton ?? 0)
      gl.uniform1f(pScene.u.uSouffle, e.souffle ?? 0)
      gl.uniform1f(pScene.u.uAiguilles, e.aiguilles ?? 0)
      gl.uniform1f(pScene.u.uEclipse, e.eclipse ?? 0)
      gl.uniform1f(pScene.u.uAnneaux, e.anneaux ?? 0)
      gl.uniform1f(pScene.u.uPierres, e.pierres ?? 0)
      gl.uniform1f(pScene.u.uFoudre, e.foudre ?? 0)
      gl.uniform1f(pScene.u.uVortex, e.vortex ?? 0)
      gl.uniform1f(pScene.u.uTunnel, e.tunnel ?? 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      // grains par-dessus, en lumière ajoutée
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.useProgram(pGrains.p)
      camUniformes(pGrains, e, t)
      gl.uniform1f(pGrains.u.uDensite, e.grains ?? 1)
      gl.uniform1f(pGrains.u.uCercle, e.cercle)
      gl.uniform1f(pGrains.u.uInvoque, e.invoque ?? 0)
      gl.uniform1f(pGrains.u.uChoc, e.chocAge ?? 99)
      gl.uniform3fv(pGrains.u.uChocPos, e.chocPos ?? [0, 0, -0.6])
      gl.uniform1f(pGrains.u.uBoucle, BOUCLE)
      gl.bindVertexArray(vaoG)
      if (!e.tunnel) gl.drawArrays(gl.POINTS, 0, G.nombre)
      gl.bindVertexArray(vao)
      // cumul
      gl.bindFramebuffer(gl.FRAMEBUFFER, cumul.fb)
      gl.useProgram(pCopie.p)
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, unEchantillon.tex)
      gl.uniform1i(pCopie.u.t, 3)
      gl.uniform1f(pCopie.u.k, 1 / S)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.disable(gl.BLEND)
    }
    // halo : on descend, puis on remonte en cumulant
    let src = cumul
    gl.useProgram(pBas.p)
    for (const d of niveaux) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb)
      gl.viewport(0, 0, d.w, d.h)
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, src.tex)
      gl.uniform1i(pBas.u.t, 3)
      gl.uniform2f(pBas.u.uPas, 1 / src.w, 1 / src.h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      src = d
    }
    gl.useProgram(pHaut.p)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    for (let i = niveaux.length - 1; i > 0; i--) {
      const de = niveaux[i],
        vers = niveaux[i - 1]
      gl.bindFramebuffer(gl.FRAMEBUFFER, vers.fb)
      gl.viewport(0, 0, vers.w, vers.h)
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, de.tex)
      gl.uniform1i(pHaut.u.t, 3)
      gl.uniform2f(pHaut.u.uPas, 1 / de.w, 1 / de.h)
      gl.uniform1f(pHaut.u.k, 0.72)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    gl.disable(gl.BLEND)
    // image finale
    gl.bindFramebuffer(gl.FRAMEBUFFER, final.fb)
    gl.viewport(0, 0, L, H)
    gl.useProgram(pPost.p)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, cumul.tex)
    gl.uniform1i(pPost.u.tImg, 3)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, niveaux[0].tex)
    gl.uniform1i(pPost.u.tHalo, 4)
    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, niveaux[3].tex)
    gl.uniform1i(pPost.u.tLarge, 5)
    gl.uniform2f(pPost.u.uRes, L, H)
    gl.uniform1f(pPost.u.uGraine, (n * 0.7548) % 1)
    gl.uniform1f(pPost.u.uFondu, e0.fondu ?? 1)
    gl.uniform1f(pPost.u.uFlash, e0.flash ?? 0)
    gl.uniform1f(pPost.u.uBandes, e0.bandes ?? 0)
    gl.uniform1f(pPost.u.uTitre, e0.titre ?? 0)
    gl.uniform1f(pPost.u.uSillage, e0.sillage ?? -1)
    gl.uniform1f(pPost.u.uChoc, e0.chocOnde ?? 0)
    gl.uniform1f(pPost.u.uFlouRadial, e0.flouRadial ?? 0)
    gl.uniform2fv(pPost.u.uCentre, e0.centre ?? [0.5, 0.5])
    gl.uniform1f(pPost.u.uTemps, (n / 24) % 1000)
    gl.activeTexture(gl.TEXTURE6)
    gl.uniform1i(pPost.u.tTitre, 6)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const px = new Uint8Array(L * H * 4)
    gl.readPixels(0, 0, L, H, gl.RGBA, gl.UNSIGNED_BYTE, px)
    return px
  }

  for (const n of cfg.images) {
    const nom = cfg.prefixe + String(n).padStart(4, '0')
    if (cfg.reprendre && fs.existsSync(path.join(cfg.sortie, nom + '.png'))) continue
    const d = performance.now()
    const px = rendreImage(n)
    await ipcRenderer.invoke('image', { nom, largeur: L, hauteur: H, pixels: px })
    await log(`image ${n} en ${((performance.now() - d) / 1000).toFixed(1)} s`)
  }
  ipcRenderer.invoke('fin', 0)
}
principal().catch(async (e) => {
  await log('ERREUR ' + String((e && e.stack) || e))
  ipcRenderer.invoke('fin', 1)
})
