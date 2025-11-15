import { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { SpeedPanel } from "./SpeedPanel.jsx";
import { TelemetryPanel } from "./TelemetryPanel.jsx";

export function ControlPanel({ send, esp32Connected, telemetry }){
  const [speedL, setL] = useState(120);
  const [speedR, setR] = useState(120);
  const [keyboardEnabled, setKeyboardEnabled] = useState(true);
  const [steerMix, setSteerMix] = useState(0.6);
  const [pressed, setPressed] = useState({ w:false, a:false, s:false, d:false });
  const activeDirRef = useRef('stop');
  const pressedKeysRef = useRef(new Set());
  const heldButtonRef = useRef(null); // 'forward' | 'reverse' | 'left' | 'right' | null

  const sendCmd = (direction) => {
    activeDirRef.current = direction;
    send({ type:'motorControl', source:'ui', ts:Date.now(), data:{ direction, speedLeft: speedL, speedRight: speedR } });
  };

  const startButtonHold = (direction) => {
    if (!esp32Connected) return;
    heldButtonRef.current = direction;
    activeDirRef.current = direction;
    send({ type:'motorControl', source:'ui', ts:Date.now(), data:{ direction, speedLeft: speedL, speedRight: speedR } });
  };

  const stopButtonHold = () => {
    if (!esp32Connected) return;
    heldButtonRef.current = null;
    activeDirRef.current = 'stop';
    send({ type:'motorControl', source:'ui', ts:Date.now(), data:{ direction: 'stop', speedLeft: 0, speedRight: 0 } });
  };

  const computeMotion = (keys) => {
    const hasW = keys.has('w');
    const hasS = keys.has('s');
    const hasA = keys.has('a');
    const hasD = keys.has('d');

    if (hasW && !hasS) {
      let l = speedL, r = speedR;
      if (hasA && !hasD) l = Math.round(speedL * steerMix);
      if (hasD && !hasA) r = Math.round(speedR * steerMix);
      return { direction: 'forward', l, r };
    }
    if (hasS && !hasW) {
      let l = speedL, r = speedR;
      if (hasA && !hasD) l = Math.round(speedL * steerMix);
      if (hasD && !hasA) r = Math.round(speedR * steerMix);
      return { direction: 'reverse', l, r };
    }
    if (hasA && !hasD && !hasW && !hasS) return { direction: 'left', l: speedL, r: speedR };
    if (hasD && !hasA && !hasW && !hasS) return { direction: 'right', l: speedL, r: speedR };
    return { direction: 'stop', l: 0, r: 0 };
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!esp32Connected || !keyboardEnabled) return;
      const k = e.key.toLowerCase();
      if (!['w','a','s','d'].includes(k)) return;
      e.preventDefault();
      const keys = pressedKeysRef.current;
      const sizeBefore = keys.size;
      keys.add(k);
      if (keys.size === sizeBefore) return;
      const m = computeMotion(keys);
      activeDirRef.current = m.direction;
      setPressed({ w:keys.has('w'), a:keys.has('a'), s:keys.has('s'), d:keys.has('d') });
      send({ type:'motorControl', source:'ui', ts:Date.now(), data:{ direction: m.direction, speedLeft: m.l, speedRight: m.r } });
    };

    const handleKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if (!['w','a','s','d'].includes(k)) return;
      const keys = pressedKeysRef.current;
      if (!keys.has(k)) return;
      keys.delete(k);
      const m = computeMotion(keys);
      activeDirRef.current = m.direction;
      setPressed({ w:keys.has('w'), a:keys.has('a'), s:keys.has('s'), d:keys.has('d') });
      send({ type:'motorControl', source:'ui', ts:Date.now(), data:{ direction: m.direction, speedLeft: m.l, speedRight: m.r } });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      pressedKeysRef.current.clear();
      activeDirRef.current = 'stop';
      setPressed({ w:false, a:false, s:false, d:false });
      heldButtonRef.current = null;
    };
  }, [esp32Connected, keyboardEnabled, steerMix, speedL, speedR, send]);

  // While keys are held down, continuously stream motor commands at a small interval
  useEffect(() => {
    if (!esp32Connected || !keyboardEnabled) return;
    const id = setInterval(() => {
      const keys = pressedKeysRef.current;
      if (keys.size > 0) {
        const m = computeMotion(keys);
        if (m.direction === 'stop') return;
        activeDirRef.current = m.direction;
        send({ type:'motorControl', source:'ui', ts:Date.now(), data:{ direction: m.direction, speedLeft: m.l, speedRight: m.r } });
        return;
      }

      // If no keyboard keys, but a UI button is held, stream that direction
      if (heldButtonRef.current) {
        const direction = heldButtonRef.current;
        activeDirRef.current = direction;
        send({ type:'motorControl', source:'ui', ts:Date.now(), data:{ direction, speedLeft: speedL, speedRight: speedR } });
      }
    }, 120); // ~8 updates/sec while holding
    return () => clearInterval(id);
  }, [esp32Connected, keyboardEnabled, steerMix, speedL, speedR, send]);

  // If user changes speeds while holding, resend with new PWM values
  useEffect(() => {
    if (!esp32Connected) return;
    const dir = activeDirRef.current;
    if (dir === 'stop') return;
    const keys = pressedKeysRef.current;
    if (keys.size > 0) {
      const m = computeMotion(keys);
      send({ type:'motorControl', source:'ui', ts:Date.now(), data:{ direction: m.direction, speedLeft: m.l, speedRight: m.r } });
    } else {
      send({ type:'motorControl', source:'ui', ts:Date.now(), data:{ direction: dir, speedLeft: speedL, speedRight: speedR } });
    }
  }, [speedL, speedR, steerMix, esp32Connected, send]);

  return (
    <Card className="h-full flex flex-col border border-slate-200/70 shadow-sm bg-white/80">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight">Vehicle Control</CardTitle>
            <CardDescription className="text-xs">Live speed and direction control.</CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "h-6 px-2 rounded-full font-mono text-[10px] tracking-wide",
              activeDirRef.current === 'stop' ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700 border-emerald-100"
            )}
          >
            {activeDirRef.current.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 flex-1 flex flex-col">
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 border border-slate-200/70">
          <div className="flex items-center gap-2">
            <Switch
              id="kb-switch"
              checked={keyboardEnabled}
              onCheckedChange={setKeyboardEnabled}
              disabled={!esp32Connected}
            />
            <Label htmlFor="kb-switch" className="text-xs font-medium text-slate-700">Keyboard drive</Label>
          </div>
          <span className="text-[11px] text-slate-500 hidden sm:inline">Hold W/A/S/D to move • Release to stop</span>
        </div>

        <div className="space-y-3">
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Left speed</span>
                <span className="font-mono text-xs text-foreground">{speedL}</span>
              </div>
              <Slider min={0} max={255} step={1} value={[speedL]} onValueChange={([v])=>setL(v)} />
            </div>
            <div className="flex-1">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Right speed</span>
                <span className="font-mono text-xs text-foreground">{speedR}</span>
              </div>
              <Slider min={0} max={255} step={1} value={[speedR]} onValueChange={([v])=>setR(v)} />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Steering mix</span>
              <span className="font-mono text-xs text-foreground">{Math.round(steerMix*100)}%</span>
            </div>
            <Slider min={0.3} max={0.9} step={0.05} value={[steerMix]} onValueChange={([v])=>setSteerMix(v)} />
          </div>
        </div>

        <div className="mt-2 flex flex-col gap-3">
          <div className="inline-flex items-center justify-center rounded-full bg-slate-50 border border-slate-200/80 p-1">
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full px-4 text-xs font-medium"
              disabled={!esp32Connected}
              onMouseDown={()=>startButtonHold('left')}
              onMouseUp={stopButtonHold}
              onMouseLeave={stopButtonHold}
              onTouchStart={(e)=>{ e.preventDefault(); startButtonHold('left'); }}
              onTouchEnd={(e)=>{ e.preventDefault(); stopButtonHold(); }}
            >
              Left
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full px-4 text-xs font-medium mx-1 bg-destructive text-destructive-foreground hover:bg-destructive"
              disabled={!esp32Connected}
              onMouseDown={()=>startButtonHold('stop')}
              onMouseUp={stopButtonHold}
              onMouseLeave={stopButtonHold}
              onTouchStart={(e)=>{ e.preventDefault(); startButtonHold('stop'); }}
              onTouchEnd={(e)=>{ e.preventDefault(); stopButtonHold(); }}
            >
              Stop
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full px-4 text-xs font-medium"
              disabled={!esp32Connected}
              onMouseDown={()=>startButtonHold('right')}
              onMouseUp={stopButtonHold}
              onMouseLeave={stopButtonHold}
              onTouchStart={(e)=>{ e.preventDefault(); startButtonHold('right'); }}
              onTouchEnd={(e)=>{ e.preventDefault(); stopButtonHold(); }}
            >
              Right
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={!esp32Connected}
              onMouseDown={()=>startButtonHold('forward')}
              onMouseUp={stopButtonHold}
              onMouseLeave={stopButtonHold}
              onTouchStart={(e)=>{ e.preventDefault(); startButtonHold('forward'); }}
              onTouchEnd={(e)=>{ e.preventDefault(); stopButtonHold(); }}
              size="sm"
              className="flex-1 justify-center rounded-xl bg-slate-900 text-slate-50 hover:bg-slate-800 text-xs font-medium"
            >
              Forward
            </Button>
            <Button
              disabled={!esp32Connected}
              onMouseDown={()=>startButtonHold('reverse')}
              onMouseUp={stopButtonHold}
              onMouseLeave={stopButtonHold}
              onTouchStart={(e)=>{ e.preventDefault(); startButtonHold('reverse'); }}
              onTouchEnd={(e)=>{ e.preventDefault(); stopButtonHold(); }}
              size="sm"
              variant="outline"
              className="flex-1 justify-center rounded-xl text-xs font-medium"
            >
              Reverse
            </Button>
          </div>
        </div>

        <div className="mt-1 flex items-center justify-between gap-4">
          <div className="grid grid-cols-3 gap-1 w-24">
            <div />
            <Kbd className={cn("h-7 w-7 justify-center rounded-md border bg-slate-50", pressed.w && "bg-slate-900 text-slate-50 border-slate-900")}>
              W
            </Kbd>
            <div />
            <Kbd className={cn("h-7 w-7 justify-center rounded-md border bg-slate-50", pressed.a && "bg-slate-900 text-slate-50 border-slate-900")}>
              A
            </Kbd>
            <Kbd className={cn("h-7 w-7 justify-center rounded-md border bg-slate-50", pressed.s && "bg-slate-900 text-slate-50 border-slate-900")}>
              S
            </Kbd>
            <Kbd className={cn("h-7 w-7 justify-center rounded-md border bg-slate-50", pressed.d && "bg-slate-900 text-slate-50 border-slate-900")}>
              D
            </Kbd>
          </div>
          <div className="text-[11px] text-muted-foreground leading-snug">
            <div>Use keyboard for fine control.</div>
            <div className="hidden sm:block">Buttons remain as backup controls.</div>
          </div>
        </div>

        {!esp32Connected && (
          <div className="pt-2 text-xs text-destructive">ESP32 disconnected — controls disabled.</div>
        )}

        <div className="mt-6 space-y-4">
          <SpeedPanel left={telemetry?.speedLeft} right={telemetry?.speedRight} />
          <TelemetryPanel gyro={telemetry?.gyro} accel={telemetry?.accel} distance={telemetry?.distance} />
        </div>
      </CardContent>
    </Card>
  );
}
