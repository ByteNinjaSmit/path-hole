import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebSocket(url){
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [serverStatus, setServerStatus] = useState({ esp32Connected:false, reactClients:0 });
  const [telemetry, setTelemetry] = useState(null);
  const [pothole, setPothole] = useState(null);
  const [routeEvent, setRouteEvent] = useState(null);
  const backoff = useRef(500);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        backoff.current = 500;
        ws.send(JSON.stringify({type:'hello',source:'ui',ts:Date.now(),data:{role:'dashboard'}}));
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'telemetry') setTelemetry({ ...msg.data, ts: msg.ts });
          if (msg.type === 'status') setServerStatus(msg.data);
          if (msg.type === 'pothole') setPothole({ ...msg.data, ts: msg.ts });
          if (msg.type === 'routeComplete') setRouteEvent({ ...msg.data, ts: msg.ts });
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, Math.min(10000, backoff.current));
        backoff.current = Math.min(10000, backoff.current * 1.7);
      };

      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    } catch {}
  }, [url]);

  useEffect(() => {
    connect();
    return () => { try { wsRef.current && wsRef.current.close(); } catch {} };
  }, [connect]);

  const send = useCallback((obj) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
    }
  }, []);

  return { connected, serverStatus, telemetry, pothole, routeEvent, send };
}
