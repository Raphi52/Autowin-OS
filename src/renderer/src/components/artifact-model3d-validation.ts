import { langueCourante } from '../langue'
import {
  traduireArtefactsEtBandeaux,
  type CleArtefactsEtBandeaux
} from '../textes-ecrans/artefacts-et-bandeaux'

/** Les seuls refus possibles : `modele3d.illisible` ou un `modele3d.refuse.*`. */
type RefusModele3d = Extract<CleArtefactsEtBandeaux, `modele3d.${'illisible' | `refuse.${string}`}`>

const MAX_MODEL_ELEMENTS = 250_000
const MAX_MODEL_SCALARS = 2_000_000
const MAX_MODEL_DECLARED_BYTES = 32 * 1024 * 1024
const GLB_MAGIC = 0x46546c67
const GLB_JSON_CHUNK = 0x4e4f534a

function gltfJson(bytes: Uint8Array, binary: boolean): Record<string, unknown> | undefined {
  let jsonBytes = bytes
  if (binary) {
    if (bytes.byteLength < 20) return undefined
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(8, true) > bytes.byteLength)
      return undefined
    const chunkLength = view.getUint32(12, true)
    if (
      view.getUint32(16, true) !== GLB_JSON_CHUNK ||
      chunkLength > bytes.byteLength - 20 ||
      chunkLength > MAX_MODEL_DECLARED_BYTES
    )
      return undefined
    jsonBytes = bytes.subarray(20, 20 + chunkLength)
  }
  try {
    const decoded = new TextDecoder().decode(jsonBytes)
    const padding = decoded.indexOf('\u0000')
    const parsed = JSON.parse(padding < 0 ? decoded : decoded.slice(0, padding))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
      )
    : []
}

function validateGltf(bytes: Uint8Array, binary: boolean): RefusModele3d | undefined {
  const document = gltfJson(bytes, binary)
  if (!document) return 'modele3d.illisible'
  const accessors = arrayOfRecords(document.accessors)
  if (accessors.length > 4_096) return 'modele3d.refuse.structure'
  const components: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16
  }
  const componentBytes: Record<string, number> = {
    '5120': 1,
    '5121': 1,
    '5122': 2,
    '5123': 2,
    '5125': 4,
    '5126': 4
  }
  let scalars = 0
  let declaredBytes = 0
  for (const accessor of accessors) {
    const count = Number(accessor.count)
    const width = components[String(accessor.type)] ?? 0
    const bytesPerComponent = componentBytes[String(accessor.componentType)] ?? 0
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > MAX_MODEL_ELEMENTS ||
      !width ||
      !bytesPerComponent
    )
      return 'modele3d.refuse.geometrie'
    scalars += count * width
    declaredBytes += count * width * bytesPerComponent
    if (scalars > MAX_MODEL_SCALARS || declaredBytes > MAX_MODEL_DECLARED_BYTES)
      return 'modele3d.refuse.geometrie'
  }
  const buffers = arrayOfRecords(document.buffers)
  if (
    buffers.reduce((sum, buffer) => sum + Math.max(0, Number(buffer.byteLength) || 0), 0) >
    MAX_MODEL_DECLARED_BYTES
  )
    return 'modele3d.refuse.buffers'
  for (const resource of [...buffers, ...arrayOfRecords(document.images)]) {
    const uri = resource.uri
    if (typeof uri === 'string' && !uri.startsWith('data:')) return 'modele3d.refuse.ressource'
  }
  if (
    arrayOfRecords(document.nodes).length > 10_000 ||
    arrayOfRecords(document.meshes).reduce(
      (sum, mesh) => sum + (Array.isArray(mesh.primitives) ? mesh.primitives.length : 0),
      0
    ) > 10_000
  )
    return 'modele3d.refuse.scene'
  return undefined
}

function isObjWhitespace(character: string): boolean {
  return (
    character === ' ' ||
    character === '\t' ||
    character === '\r' ||
    character === '\n' ||
    character === '\f'
  )
}

function validateObj(source: string): RefusModele3d | undefined {
  let elements = 0
  let generatedVertices = 0
  let cursor = 0
  while (cursor < source.length) {
    const lineEnd = source.indexOf('\n', cursor)
    const end = lineEnd < 0 ? source.length : lineEnd
    let index = cursor
    while (index < end && isObjWhitespace(source[index])) index += 1
    const commandStart = index
    while (index < end && !isObjWhitespace(source[index])) index += 1
    const command = source.slice(commandStart, index)
    if (['v', 'vn', 'vt', 'f', 'l', 'p'].includes(command)) {
      elements += 1
      if (elements > MAX_MODEL_ELEMENTS) return 'modele3d.refuse.geometrie'
    }
    if (command === 'f' || command === 'l' || command === 'p') {
      let references = 0
      let inToken = false
      for (; index < end; index += 1) {
        const whitespace = isObjWhitespace(source[index])
        if (!whitespace && !inToken) {
          references += 1
          inToken = true
        } else if (whitespace) inToken = false
      }
      if (command === 'f' && references >= 3) generatedVertices += (references - 2) * 3
      else if (command === 'l' && references >= 2) generatedVertices += (references - 1) * 2
      else if (command === 'p') generatedVertices += references
      if (generatedVertices > MAX_MODEL_ELEMENTS) return 'modele3d.refuse.geometrie'
    }
    cursor = lineEnd < 0 ? source.length : lineEnd + 1
  }
  return undefined
}

/**
 * Le refus d'un modèle 3D, en CLÉ de la table de textes : l'aperçu la traduit au rendu, donc dans la
 * langue courante même si elle change après coup (conv-1170).
 */
export function refusDuModele3d(name: string, bytes: Uint8Array): RefusModele3d | undefined {
  const lower = name.toLowerCase()
  if (lower.endsWith('.gltf')) return validateGltf(bytes, false)
  if (lower.endsWith('.glb')) return validateGltf(bytes, true)
  if (lower.endsWith('.obj')) {
    const source = new TextDecoder().decode(bytes)
    return validateObj(source)
  }
  if (lower.endsWith('.ply')) {
    const header = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 32_768)))
    const declared = [...header.matchAll(/^element\s+(?:vertex|face)\s+(\d+)/gim)].reduce(
      (sum, match) => sum + Number(match[1]),
      0
    )
    const properties = header.match(/^property\s+/gim)?.length ?? 0
    return declared > MAX_MODEL_ELEMENTS ||
      properties > 64 ||
      declared * Math.max(1, properties) > MAX_MODEL_SCALARS
      ? 'modele3d.refuse.geometrie'
      : undefined
  }
  if (lower.endsWith('.stl') && bytes.byteLength >= 84) {
    const triangles = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      80,
      true
    )
    if (triangles > MAX_MODEL_ELEMENTS || 84 + triangles * 50 > bytes.byteLength)
      return 'modele3d.refuse.geometrie'
  }
  return undefined
}

/** Le refus d'un modèle 3D en toutes lettres, dans la langue courante ; `undefined` s'il est accepté. */
export function validateModel3dBytes(name: string, bytes: Uint8Array): string | undefined {
  const refus = refusDuModele3d(name, bytes)
  return refus === undefined ? undefined : traduireArtefactsEtBandeaux(refus, langueCourante())
}
