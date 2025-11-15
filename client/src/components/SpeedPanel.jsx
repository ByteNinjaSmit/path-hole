import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export function SpeedPanel({ left = 0, right = 0 }){
  const pct = (v) => Math.max(0, Math.min(100, Math.round((v / 255) * 100)));
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-4xl font-semibold tabular-nums">{left}</div>
            <div className="text-[10px] text-muted-foreground">/ 255</div>
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Left PWM</div>
          <Progress value={pct(left)} className="h-1" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-4xl font-semibold tabular-nums">{right}</div>
            <div className="text-[10px] text-muted-foreground">/ 255</div>
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Right PWM</div>
          <Progress value={pct(right)} className="h-1 bg-primary/10" />
        </CardContent>
      </Card>
    </div>
  );
}
