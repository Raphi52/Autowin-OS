import * as THREE from 'three'
import type { GraphNode } from './graph-view-model'

/**
 * Builders de sprites/textures THREE.js pour l'observatoire 3D (GraphView).
 * Purs et mis en cache par couleur/label ; extraits de GraphView.tsx pour l'alléger.
 */

const galaxyStarTextures = new Map<string, THREE.CanvasTexture>()
const connectedLabelTextures = new Map<
  string,
  { texture: THREE.CanvasTexture; aspectRatio: number }
>()
let seriousNodeTextureCache: THREE.CanvasTexture | null = null

/** Libère les textures mises en cache (à appeler au démontage de l'observatoire 3D). */
export function disposeGraphTextures(): void {
  for (const texture of galaxyStarTextures.values()) texture.dispose()
  galaxyStarTextures.clear()
  for (const { texture } of connectedLabelTextures.values()) texture.dispose()
  connectedLabelTextures.clear()
}

function seriousNodeTexture(): THREE.CanvasTexture {
  if (seriousNodeTextureCache) return seriousNodeTextureCache
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.arc(32, 32, 25, 0, Math.PI * 2)
    context.fill()
  }
  seriousNodeTextureCache = new THREE.CanvasTexture(canvas)
  seriousNodeTextureCache.colorSpace = THREE.SRGBColorSpace
  return seriousNodeTextureCache
}

export function createSeriousNode(
  node: GraphNode,
  appearance: { color: string; opacity: number },
  value: number,
  showLabel: boolean
): THREE.Sprite {
  const scale = 8 * Math.sqrt(Math.max(0.5, value))
  const dot = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: seriousNodeTexture(),
      color: appearance.color,
      opacity: appearance.opacity,
      transparent: true,
      depthWrite: false
    })
  )
  dot.scale.set(scale, scale, 1)
  dot.renderOrder = appearance.opacity === 1 ? 2 : 1
  dot.userData.nodeId = node.id
  if (showLabel) dot.add(createConnectedLabel(node.label, appearance.color, scale, 0.035))
  return dot
}

function galaxyStarTexture(color: string): THREE.CanvasTexture {
  const cached = galaxyStarTextures.get(color)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) return new THREE.CanvasTexture(canvas)

  const center = canvas.width / 2
  const halo = context.createRadialGradient(center, center, 2, center, center, 62)
  halo.addColorStop(0, '#ffffff')
  halo.addColorStop(0.08, color)
  halo.addColorStop(0.32, `${color}b8`)
  halo.addColorStop(1, `${color}00`)
  context.fillStyle = halo
  context.beginPath()
  context.arc(center, center, 62, 0, Math.PI * 2)
  context.fill()
  context.globalCompositeOperation = 'lighter'
  context.beginPath()
  for (let point = 0; point < 16; point += 1) {
    const angle = -Math.PI / 2 + (point * Math.PI) / 8
    const radius = point % 4 === 0 ? 61 : point % 2 === 0 ? 30 : 9
    const x = center + Math.cos(angle) * radius
    const y = center + Math.sin(angle) * radius
    if (point === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
  context.fillStyle = `${color}d9`
  context.fill()
  context.beginPath()
  context.arc(center, center, 9, 0, Math.PI * 2)
  context.fillStyle = '#ffffff'
  context.fill()
  context.globalCompositeOperation = 'source-over'

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  galaxyStarTextures.set(color, texture)
  return texture
}

export function createGalaxyStar(
  node: GraphNode,
  appearance: { color: string; opacity: number },
  value: number
): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: galaxyStarTexture(appearance.color),
    color: '#ffffff',
    opacity: appearance.opacity,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const star = new THREE.Sprite(material)
  const scale = 12 * Math.sqrt(Math.max(0.5, value))
  star.scale.set(scale, scale, 1)
  star.renderOrder = appearance.opacity === 1 ? 2 : 1
  star.userData.nodeId = node.id
  // Scintillement : phase/vitesse DÉTERMINISTES par nœud (stables entre re-rendus) — la boucle
  // d'animation de GraphView module opacité + taille en mode galaxy. Les nœuds de contexte
  // (opacité faible) scintillent moins pour rester lisibles.
  const seed = [...node.id].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 9973, 7)
  star.userData.twinkle = {
    phase: (seed % 628) / 100,
    speed: 0.55 + ((seed % 97) / 97) * 1.25,
    baseOpacity: appearance.opacity,
    baseScale: scale,
    amp: appearance.opacity >= 0.9 ? 0.3 : 0.12
  }
  return star
}

function connectedLabelTexture(
  label: string,
  color: string
): { texture: THREE.CanvasTexture; aspectRatio: number } {
  const cacheKey = `${color}:${label}`
  const cached = connectedLabelTextures.get(cacheKey)
  if (cached) return cached

  const measureCanvas = document.createElement('canvas')
  const measureContext = measureCanvas.getContext('2d')
  const font = '600 20px Inter, system-ui, sans-serif'
  if (measureContext) measureContext.font = font
  const measuredWidth = measureContext?.measureText(label).width ?? label.length * 11
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(Math.min(560, Math.max(120, measuredWidth + 30)))
  canvas.height = 54
  const context = canvas.getContext('2d')
  if (context) {
    context.font = font
    context.fillStyle = 'rgba(4, 9, 17, 0.94)'
    context.strokeStyle = color
    context.lineWidth = 2
    context.beginPath()
    context.roundRect(1, 1, canvas.width - 2, canvas.height - 2, 10)
    context.fill()
    context.stroke()
    context.fillStyle = '#f7fbff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width - 24)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  const result = { texture, aspectRatio: canvas.width / canvas.height }
  connectedLabelTextures.set(cacheKey, result)
  return result
}

export function createConnectedLabel(
  label: string,
  color: string,
  parentScale = 1,
  screenHeight = 0.035
): THREE.Sprite {
  const { texture, aspectRatio } = connectedLabelTexture(label, color)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      color: '#ffffff',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false
    })
  )
  const height = screenHeight / parentScale
  sprite.position.set(0, 0, 0)
  sprite.scale.set(height * aspectRatio, height, 1)
  sprite.center.set(0.5, -0.16)
  sprite.renderOrder = 20
  sprite.userData.connectedNodeLabel = label
  return sprite
}
