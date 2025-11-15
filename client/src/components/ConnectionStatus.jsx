import { Badge } from "@/components/ui/badge";

export function ConnectionStatus({ nodeConnected, esp32Connected }){
  const Dot = ({ ok }) => (
    <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
  );

  return (
    <div className="flex gap-2 items-center text-xs">
      <Badge variant={nodeConnected ? 'secondary' : 'destructive'} className="flex items-center gap-2">
        <Dot ok={nodeConnected} />
        <span>Server</span>
      </Badge>
      <Badge variant={esp32Connected ? 'secondary' : 'destructive'} className="flex items-center gap-2">
        <Dot ok={esp32Connected} />
        <span>ESP32</span>
      </Badge>
    </div>
  );
}
