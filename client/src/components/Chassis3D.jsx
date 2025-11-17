import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Environment, useGLTF, Center } from '@react-three/drei'
import { useMemo, useRef } from 'react'

function degToRad(d){ return (d * Math.PI) / 180 }

function CarBody({ pitch=0, roll=0, yaw=0, smoothing=0.15, showAxes=false }){
  const ref = useRef()
  const targetQ = useMemo(() => new THREE.Quaternion(), [])
  const euler = useMemo(() => new THREE.Euler(0,0,0,'XYZ'), [])
  // Three.js example car model (Ferrari) from official examples
  const { scene } = useGLTF('https://threejs.org/examples/models/gltf/ferrari.glb')

  useFrame(() => {
    if (!ref.current) return
    // Map IMU orientation (deg) to Three.js axes: pitch->X, yaw->Y, roll->Z
    euler.set(degToRad(pitch), degToRad(yaw), degToRad(roll))
    targetQ.setFromEuler(euler)
    // Smoothly slerp toward target quaternion
    ref.current.quaternion.slerp(targetQ, Math.max(0.01, Math.min(0.6, smoothing)))
  })

  return (
    <group ref={ref}>
      {/* center the GLTF car from the official example on the origin */}
      <Center>
        <primitive
          object={scene}
          scale={1.5}
          position={[0, 2.2, 0]}
          castShadow
          receiveShadow
        />
      </Center>
      {showAxes && <axesHelper args={[2]} />}
    </group>
  )
}

function Ground(){
  return (
    <group>
      {/* Wide dark asphalt base */}
      <mesh rotation={[-Math.PI/2,0,0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#e5e7eb" />
      </mesh>

      {/* Road strip under the car */}
      <mesh rotation={[-Math.PI/2,0,0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[6, 40]} />
        <meshStandardMaterial color="#111827" />
      </mesh>

      {/* Center lane markings */}
      {[ -6, -3, 0, 3, 6 ].map((z, i) => (
        <mesh key={i} rotation={[-Math.PI/2,0,0]} position={[0, 0.02, z]}>
          <planeGeometry args={[0.3, 1.2]} />
          <meshStandardMaterial color="#facc15" />
        </mesh>
      ))}
    </group>
  )
}

export function Chassis3D({ pitch, roll, yaw, smoothing=0.15, showAxes=false, interactive=false }){
  return (
    <Canvas shadows camera={{ position: [5, 4, 6], fov: 45 }} style={{ width: '100%', height: 360, borderRadius: 12 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5,6,5]} intensity={0.8} castShadow />
      <Environment preset="city" />
      <Ground />
      <CarBody pitch={pitch} roll={roll} yaw={yaw} smoothing={smoothing} showAxes={showAxes} />
      {interactive && <OrbitControls enableDamping dampingFactor={0.08} />}
      <GizmoHelper alignment="bottom-right" margin={[80,80]}> 
        <GizmoViewport axisColors={["#ef4444","#22c55e","#3b82f6"]} labelColor="#111827" />
      </GizmoHelper>
    </Canvas>
  )
}
