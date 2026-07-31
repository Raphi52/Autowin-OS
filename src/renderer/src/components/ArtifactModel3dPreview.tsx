import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ChatArtifact } from '../../../shared/artifacts'
import { validateModel3dBytes } from './artifact-model3d-validation'

function artifactBytes(artifact: ChatArtifact): Uint8Array | undefined {
  if (!artifact.content) return undefined
  if (artifact.encoding === 'utf8') return new TextEncoder().encode(artifact.content)
  const binary = atob(artifact.content)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function ArtifactModel3dPreview({
  artifact
}: {
  artifact: ChatArtifact
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [failure, setFailure] = useState<{ id: string; message: string }>()

  useEffect(() => {
    const host = hostRef.current
    const bytes = artifactBytes(artifact)
    if (!host || !bytes) return
    const validationError = validateModel3dBytes(artifact.name, bytes)
    if (validationError) {
      queueMicrotask(() => setFailure({ id: artifact.id, message: validationError }))
      return
    }
    let stopped = false
    let frame = 0
    let renderer: THREE.WebGLRenderer | undefined
    let controls: OrbitControls | undefined

    const mount = (object: THREE.Object3D): void => {
      if (stopped) return
      const width = Math.max(host.clientWidth, 320)
      const height = 360
      const scene = new THREE.Scene()
      scene.background = new THREE.Color('#050608')
      scene.add(new THREE.HemisphereLight(0xffffff, 0x303040, 2.4))
      const directional = new THREE.DirectionalLight(0xffffff, 2.2)
      directional.position.set(4, 5, 6)
      scene.add(directional)
      scene.add(object)

      const bounds = new THREE.Box3().setFromObject(object)
      const center = bounds.getCenter(new THREE.Vector3())
      const size = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1)
      object.position.sub(center)
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, size * 100)
      camera.position.set(size * 0.75, size * 0.55, size * 0.9)
      camera.lookAt(0, 0, 0)
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
      renderer.setSize(width, height)
      host.replaceChildren(renderer.domElement)
      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.autoRotate = true
      controls.autoRotateSpeed = 0.7
      const render = (): void => {
        if (stopped) return
        controls?.update()
        renderer?.render(scene, camera)
        frame = requestAnimationFrame(render)
      }
      render()
    }

    try {
      if (artifact.name.toLowerCase().endsWith('.obj')) {
        mount(new OBJLoader().parse(new TextDecoder().decode(bytes)))
      } else if (artifact.name.toLowerCase().endsWith('.stl')) {
        const geometry = new STLLoader().parse(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        )
        geometry.computeVertexNormals()
        mount(
          new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: '#f2c94c', roughness: 0.55 })
          )
        )
      } else if (artifact.name.toLowerCase().endsWith('.ply')) {
        const geometry = new PLYLoader().parse(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        )
        geometry.computeVertexNormals()
        mount(
          new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: '#f2c94c', roughness: 0.55 })
          )
        )
      } else {
        new GLTFLoader().parse(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          '',
          (gltf) => mount(gltf.scene),
          () => {
            if (!stopped)
              setFailure({
                id: artifact.id,
                message: 'Modèle 3D illisible ou ressources externes manquantes'
              })
          }
        )
      }
    } catch {
      queueMicrotask(() => {
        if (!stopped) setFailure({ id: artifact.id, message: 'Modèle 3D illisible' })
      })
    }
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      controls?.dispose()
      renderer?.dispose()
      host.replaceChildren()
    }
  }, [artifact])

  const error = failure?.id === artifact.id ? failure.message : undefined
  if (error) return <div className="artifact-preview__blocked">{error}</div>
  return (
    <div className="artifact-model3d" ref={hostRef}>
      <span>Chargement de la scène 3D…</span>
    </div>
  )
}
