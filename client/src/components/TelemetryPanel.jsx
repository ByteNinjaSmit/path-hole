import { Card, CardContent } from "@/components/ui/card";

export function TelemetryPanel({ gyro, accel }){
  const fmt = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');
  const Item = ({ label, value }) => (
    <div className="text-center space-y-1">
      <div className="text-2xl font-semibold tabular-nums">{fmt(value)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Gyroscope (deg/s)</div>
          <div className="grid grid-cols-3 gap-2">
            <Item label="X" value={gyro?.x} />
            <Item label="Y" value={gyro?.y} />
            <Item label="Z" value={gyro?.z} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Accelerometer (m/s²)</div>
          <div className="grid grid-cols-3 gap-2">
            <Item label="X" value={accel?.x} />
            <Item label="Y" value={accel?.y} />
            <Item label="Z" value={accel?.z} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
