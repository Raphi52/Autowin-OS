// Fenêtre-horloge : R = pierre fixe et chiffres, G = couronne à crans, B = grande roue.
// Noir = opaque, blanc = la lumière passe.
function couche(taille, dessiner) {
  const c = document.createElement('canvas')
  c.width = c.height = taille
  const g = c.getContext('2d', { willReadFrequently: true })
  g.fillStyle = '#fff'
  g.fillRect(0, 0, taille, taille)
  g.translate(taille / 2, taille / 2)
  g.scale(taille / 2, taille / 2)
  g.fillStyle = '#000'
  g.strokeStyle = '#000'
  dessiner(g)
  return c
}
const anneau = (g, r, ep) => {
  g.lineWidth = ep
  g.beginPath()
  g.arc(0, 0, r, 0, Math.PI * 2)
  g.stroke()
}
function peindreMasque() {
  const T = 2048
  const fixe = couche(T, (g) => {
    anneau(g, 0.985, 0.03)
    anneau(g, 0.72, 0.022)
    anneau(g, 0.96, 0.01)
    anneau(g, 0.475, 0.012)
    for (let i = 0; i < 12; i++) {
      g.save()
      g.rotate((i * Math.PI) / 6)
      g.fillRect(-0.012, -0.97, 0.024, 0.25)
      // ogive gothique entre deux rayons
      g.save()
      g.rotate(Math.PI / 12)
      g.beginPath()
      g.lineWidth = 0.009
      g.moveTo(-0.1, -0.735)
      g.quadraticCurveTo(-0.1, -0.86, 0, -0.945)
      g.quadraticCurveTo(0.1, -0.86, 0.1, -0.735)
      g.stroke()
      g.restore()
      g.restore()
    }
    const romains = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    romains.forEach((t, i) => {
      g.save()
      g.rotate((i * Math.PI) / 6)
      g.translate(0, -0.6)
      g.scale(0.0016, 0.0016)
      g.font = '700 74px "Times New Roman", serif'
      g.fillText(t, 0, 0)
      g.restore()
    })
    for (let i = 0; i < 60; i++) {
      g.save()
      g.rotate((i * Math.PI) / 30)
      g.fillRect(-0.0035, -0.715, 0.007, i % 5 ? 0.02 : 0.04)
      g.restore()
    }
    for (let i = 0; i < 24; i++) {
      g.save()
      g.rotate((i * Math.PI) / 12)
      g.fillRect(-0.002, -0.47, 0.004, 0.12)
      g.restore()
    }
  })
  const crans = couche(T, (g) => {
    anneau(g, 0.44, 0.012)
    for (let i = 0; i < 60; i++) {
      g.save()
      g.rotate((i * Math.PI) / 30)
      g.fillRect(-0.006, -0.47, 0.012, 0.05)
      g.restore()
    }
  })
  const roue = couche(T, (g) => {
    const dents = 24
    g.beginPath()
    for (let i = 0; i < dents; i++) {
      const a = (i / dents) * Math.PI * 2,
        p = (Math.PI * 2) / dents
      const rs = [0.885, 0.925, 0.925, 0.885]
      ;[0, 0.22, 0.72, 0.94].forEach((t, k) => {
        const b = a + t * p
        g.lineTo(Math.cos(b) * rs[k], Math.sin(b) * rs[k])
      })
    }
    g.closePath()
    g.moveTo(0.845, 0)
    g.arc(0, 0, 0.845, 0, Math.PI * 2, true)
    g.fill('evenodd')
    for (let i = 0; i < 6; i++) {
      g.save()
      g.rotate((i * Math.PI) / 3)
      g.fillRect(-0.012, -0.85, 0.024, 0.37)
      g.restore()
    }
  })
  const fus = document.createElement('canvas')
  fus.width = fus.height = T
  const f = fus.getContext('2d')
  const sortie = f.createImageData(T, T)
  const pixels = (c) =>
    c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, T, T).data
  const a = pixels(fixe),
    b = pixels(crans),
    d = pixels(roue)
  for (let i = 0; i < T * T * 4; i += 4) {
    sortie.data[i] = a[i]
    sortie.data[i + 1] = b[i]
    sortie.data[i + 2] = d[i]
    sortie.data[i + 3] = 255
  }
  f.putImageData(sortie, 0, 0)
  return fus
}
// Le vrai glyphe de la mascotte, blanc sur noir. Marge de 12 unités : la couronne déborde du carré.
async function peindreGlyphe(interieur) {
  const T = 2048
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 88 88" width="${T}" height="${T}"><style>.gn{fill:#fff;stroke:none}</style><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">${interieur}</g></svg>`
  const im = new Image()
  await new Promise((ok, ko) => {
    im.onload = ok
    im.onerror = () => ko(new Error('glyphe'))
    im.src = 'data:image/svg+xml;base64,' + btoa(svg)
  })
  const c = document.createElement('canvas')
  c.width = c.height = T
  const g = c.getContext('2d')
  g.fillStyle = '#000'
  g.fillRect(0, 0, T, T)
  g.drawImage(im, 0, 0, T, T)
  return c
}
function peindreTitre(L, H) {
  const c = document.createElement('canvas')
  c.width = L
  c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#000'
  g.fillRect(0, 0, L, H)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const taille = Math.round(H * 0.125)
  g.font = `500 ${taille}px "Times New Roman", serif`
  g.letterSpacing = `${Math.round(taille * 0.3)}px`
  const d = g.createLinearGradient(0, H * 0.38, 0, H * 0.52)
  d.addColorStop(0, '#fff1c9')
  d.addColorStop(0.55, '#e8b65c')
  d.addColorStop(1, '#9c6a22')
  g.shadowColor = 'rgba(255,170,70,.75)'
  g.shadowBlur = taille * 0.5
  g.fillStyle = d
  g.fillText('AUTOWIN', L / 2 + taille * 0.15, H * 0.46)
  g.shadowBlur = 0
  g.fillText('AUTOWIN', L / 2 + taille * 0.15, H * 0.46)
  const petit = Math.round(H * 0.031)
  g.font = `400 ${petit}px "Times New Roman", serif`
  g.letterSpacing = `${Math.round(petit * 0.62)}px`
  g.fillStyle = '#c9a56a'
  g.fillText('LE MAGICIEN DU TEMPS OBSCUR', L / 2 + petit * 0.3, H * 0.58)
  return c
}
module.exports = { peindreMasque, peindreGlyphe, peindreTitre }
