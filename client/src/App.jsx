import './App.css'
import { useEffect, useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket.js'
import { ControlPanel } from './components/ControlPanel.jsx'
import { PotholeAlert } from './components/PotholeAlert.jsx'
import { ConnectionStatus } from './components/ConnectionStatus.jsx'
import { Chassis3D } from './components/Chassis3D.jsx'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'

const wsUrl = (import.meta?.env?.VITE_WS_URL) || 'ws://localhost:8080/ws'

function App() {
  const { connected, serverStatus, telemetry, pothole, send } = useWebSocket(wsUrl)
  const [orientation, setOrientation] = useState({ pitch: 0, roll: 0, yaw: 0, lastTs: null })
  const [zero, setZero] = useState({ pitch: 0, roll: 0, yaw: 0 })
  const [smoothing, setSmoothing] = useState(0.18) // slerp smoothing for 3D

  // Complementary filter to fuse gyro (deg/s) + accel into stable orientation in degrees
  useEffect(() => {
    if (!telemetry || !telemetry.gyro || !telemetry.accel || !telemetry.ts) return

    setOrientation(prev => {
      const { pitch, roll, yaw, lastTs } = prev
      const ts = telemetry.ts
      let dt = lastTs ? (ts - lastTs) / 1000 : 0
      if (dt < 0 || dt > 0.5) dt = 0

      const gx = telemetry.gyro.x || 0
      const gy = telemetry.gyro.y || 0
      const gz = telemetry.gyro.z || 0
      const ax = telemetry.accel.x || 0
      const ay = telemetry.accel.y || 0
      const az = telemetry.accel.z || 0

      // Integrate gyro (deg/s) over time
      const rollGyro = roll + gx * dt
      const pitchGyro = pitch + gy * dt
      const yawGyro = yaw + gz * dt

      // Compute roll/pitch from accelerometer (rad -> deg)
      const toDeg = 180 / Math.PI
      const rollAccel = Math.atan2(ay, az) * toDeg
      const pitchAccel = Math.atan2(-ax, Math.sqrt(ay * ay + az * az)) * toDeg

      const alpha = 0.96
      const newRoll = dt ? alpha * rollGyro + (1 - alpha) * rollAccel : rollAccel
      const newPitch = dt ? alpha * pitchGyro + (1 - alpha) * pitchAccel : pitchAccel
      const newYaw = yawGyro

      return { pitch: newPitch, roll: newRoll, yaw: newYaw, lastTs: ts }
    })
  }, [telemetry])

  return (
    <div className="min-h-dvh bg-linear-to-b from-slate-50 to-slate-100">
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight">PathHole Vehicle Dashboard</div>
            <div className="text-xs text-gray-500">Realtime telemetry and control</div>
          </div>
          <ConnectionStatus nodeConnected={connected} esp32Connected={serverStatus.esp32Connected} />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <ControlPanel
            send={send}
            esp32Connected={serverStatus.esp32Connected}
            telemetry={telemetry}
          />
          <Card className="overflow-hidden">
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Vehicle Orientation</CardTitle>
                <CardDescription>MPU6050 mounted on chassis</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={()=>setZero({pitch:orientation.pitch, roll:orientation.roll, yaw:orientation.yaw})}>Set Zero</Button>
                <Button size="sm" variant="ghost" onClick={()=>setZero({pitch:0, roll:0, yaw:0})}>Reset</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Chassis3D
                pitch={orientation.pitch - zero.pitch}
                roll={orientation.roll - zero.roll}
                yaw={orientation.yaw - zero.yaw}
                smoothing={smoothing}
                showAxes={false}
                interactive={true}
              />
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <div className="flex items-baseline gap-1">
                      <span>Pitch</span>
                      <span className="font-mono text-base text-foreground">{(orientation.pitch - zero.pitch).toFixed(1)}°</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span>Roll</span>
                      <span className="font-mono text-base text-foreground">{(orientation.roll - zero.roll).toFixed(1)}°</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span>Yaw</span>
                      <span className="font-mono text-base text-foreground">{(orientation.yaw - zero.yaw).toFixed(1)}°</span>
                    </div>
                  </div>
                  <PotholeAlert event={pothole} />
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">3D Smoothing</div>
                    <Slider min={0.05} max={0.6} step={0.01} value={[smoothing]} onValueChange={([v])=>setSmoothing(v)} />
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-xs text-muted-foreground">Distance travelled</span>
                    <span className="font-mono text-base text-foreground">
                      {typeof telemetry?.distance === 'number' ? telemetry.distance.toFixed(2) : '—'}
                      <span className="ml-1 text-[11px] text-muted-foreground">m</span>
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* motor + IMU cards are now rendered inside ControlPanel for a tighter top layout */}
      </div>
    </div>
  )
}

export default App
