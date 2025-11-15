import { useEffect, useState } from 'react';
import { Badge } from "@/components/ui/badge";

export function PotholeAlert({ event }){
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (event) { setFlash(true); const t = setTimeout(()=>setFlash(false), 1500); return ()=>clearTimeout(t); }
  }, [event]);

  const severity = event?.severity;
  let variant = "secondary";
  if (severity === 'high') variant = 'destructive';

  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${flash ? 'bg-red-600 animate-pulse' : 'bg-gray-300'}`} />
      <Badge variant={variant} className="text-[10px] uppercase tracking-wide">
        {severity ? `Pothole: ${severity}` : 'No pothole'}
      </Badge>
    </div>
  );
}
