import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

export function MapPanel({ telemetry, pothole, routeEvent, send, esp32Connected }) {
  const canvasRef = useRef(null);
  const [trail, setTrail] = useState([]); // {x,y,heading}
  const [potholes, setPotholes] = useState([]); // {x,y}
  const [routeName, setRouteName] = useState('');
  const [builderRouteName, setBuilderRouteName] = useState('');
  const [routeRename, setRouteRename] = useState('');
  const [routes, setRoutes] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [selectedRoutePath, setSelectedRoutePath] = useState([]);
  const [routeStats, setRouteStats] = useState(null);
  const [routePotholes, setRoutePotholes] = useState([]); // stored potholes for selected route
  const [useStoredPotholes, setUseStoredPotholes] = useState(false);
  const [driveStatus, setDriveStatus] = useState('idle'); // 'idle' | 'driving' | 'completed'
  const [autoSpeed, setAutoSpeed] = useState(120);
  const [builderSegments, setBuilderSegments] = useState([]);
  const [builderPath, setBuilderPath] = useState([]); // generated from segments
  const [recentRuns, setRecentRuns] = useState([]);

  // accumulate live trail from telemetry
  useEffect(() => {
    if (!telemetry || typeof telemetry.posX !== 'number' || typeof telemetry.posY !== 'number') return;
    setTrail(prev => {
      const next = [...prev, { x: telemetry.posX, y: telemetry.posY, heading: telemetry.heading ?? 0 }];
      // keep last N points to avoid unbounded growth
      if (next.length > 2000) next.shift();
      return next;
    });
  }, [telemetry]);

  // accumulate pothole markers
  useEffect(() => {
    if (!pothole || typeof pothole.posX !== 'number' || typeof pothole.posY !== 'number') return;
    setPotholes(prev => [...prev, { x: pothole.posX, y: pothole.posY }]);
  }, [pothole]);

  // fetch routes list on mount
  useEffect(() => {
    const loadRoutes = async () => {
      try {
        const res = await fetch('/api/routes');
        if (!res.ok) return;
        const data = await res.json();
        setRoutes(data || []);
      } catch {}
    };
    loadRoutes();
  }, []);

  // when selected route changes, fetch its full path
  useEffect(() => {
    if (!selectedRouteId) {
      setSelectedRoutePath([]);
      setRouteStats(null);
      setRoutePotholes([]);
      setUseStoredPotholes(false);
      setDriveStatus('idle');
      return;
    }
    const loadRoute = async () => {
      try {
        const [routeRes, statsRes, pothRes] = await Promise.all([
          fetch(`/api/routes/${selectedRouteId}`),
          fetch(`/api/routes/${selectedRouteId}/stats`),
          fetch(`/api/routes/${selectedRouteId}/potholes`)
        ]);

        if (routeRes.ok) {
          const data = await routeRes.json();
          setSelectedRoutePath(data.path || []);
          if (data && typeof data.name === 'string') {
            setRouteRename(data.name);
          }
        }

        if (statsRes.ok) {
          const stats = await statsRes.json();
          setRouteStats(stats);
        } else {
          setRouteStats(null);
        }

        if (pothRes.ok) {
          const items = await pothRes.json();
          setRoutePotholes(
            (items || []).map((p) => ({
              x: p.posX,
              y: p.posY,
              severity: p.severity || 'unknown',
              value: typeof p.value === 'number' ? p.value : null,
              ts: typeof p.ts === 'number' ? p.ts : null
            }))
          );
        } else {
          setRoutePotholes([]);
        }
      } catch {}
    };
    loadRoute();
  }, [selectedRouteId]);

  // recompute builder path whenever segments change
  useEffect(() => {
    if (!builderSegments || builderSegments.length === 0) {
      setBuilderPath([]);
      return;
    }
    let x = 0;
    let y = 0;
    let heading = 0; // degrees, 0 = +X axis
    const pts = [{ x, y, heading }];
    const toNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    builderSegments.forEach((seg) => {
      const len = Math.max(0, toNum(seg.length));
      const turn = toNum(seg.turn);
      heading += turn;
      const rad = (heading * Math.PI) / 180;
      x += len * Math.cos(rad);
      y += len * Math.sin(rad);
      pts.push({ x, y, heading });
    });
    setBuilderPath(pts);
  }, [builderSegments]);

  // accumulate recent completed runs
  useEffect(() => {
    if (!routeEvent) return;
    setRecentRuns((prev) => {
      const route = routes.find((r) => r._id === routeEvent.routeId);
      const name = route ? route.name : (routeEvent.routeId || 'Route');
      const entry = {
        id: `${routeEvent.ts}-${routeEvent.routeId || 'noid'}`,
        routeId: routeEvent.routeId || null,
        name,
        ts: routeEvent.ts
      };
      const next = [entry, ...prev];
      return next.slice(0, 5);
    });
    setDriveStatus('completed');
  }, [routeEvent, routes]);

  // reset drive status if ESP disconnects
  useEffect(() => {
    if (!esp32Connected) setDriveStatus('idle');
  }, [esp32Connected]);

  // draw on canvas when data changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const displayPotholes = useStoredPotholes ? routePotholes : potholes;

    // collect all points for bounds
    const allPoints = [...trail, ...selectedRoutePath, ...builderPath, ...displayPotholes];
    if (allPoints.length === 0) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '12px system-ui';
      ctx.fillText('No path yet. Drive the car or load a route.', 16, height / 2);
      return;
    }

    let minX = allPoints[0].x;
    let maxX = allPoints[0].x;
    let minY = allPoints[0].y;
    let maxY = allPoints[0].y;
    for (const p of allPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const padding = 20;
    const spanX = Math.max(maxX - minX, 0.5);
    const spanY = Math.max(maxY - minY, 0.5);
    const scaleX = (width - 2 * padding) / spanX;
    const scaleY = (height - 2 * padding) / spanY;
    const scale = Math.min(scaleX, scaleY);

    const toCanvas = (p) => {
      const cx = padding + (p.x - minX) * scale;
      const cy = height - padding - (p.y - minY) * scale;
      return { cx, cy };
    };

    // draw selected route (planned path from DB)
    if (selectedRoutePath.length > 1) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      selectedRoutePath.forEach((p, idx) => {
        const { cx, cy } = toCanvas(p);
        if (idx === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
    }

    // draw builder route (programmed from segments)
    if (builderPath.length > 1) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      builderPath.forEach((p, idx) => {
        const { cx, cy } = toCanvas(p);
        if (idx === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
    }

    // draw live trail
    if (trail.length > 1) {
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      trail.forEach((p, idx) => {
        const { cx, cy } = toCanvas(p);
        if (idx === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
    }

    // draw potholes as red dots
    ctx.fillStyle = '#ef4444';
    displayPotholes.forEach((p) => {
      const { cx, cy } = toCanvas(p);
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [trail, potholes, selectedRoutePath, routePotholes, useStoredPotholes, builderPath]);

  const handleClear = () => {
    setTrail([]);
    setPotholes([]);
    setDriveStatus('idle');
  };

  const handleCleanMap = () => {
    setTrail([]);
    setPotholes([]);
    setBuilderSegments([]);
    setUseStoredPotholes(false);
    setDriveStatus('idle');
  };

  const handleSaveRoute = async () => {
    if (trail.length < 2 || !routeName.trim()) return;
    try {
      const body = {
        name: routeName.trim(),
        description: '',
        path: trail.map(p => ({ x: p.x, y: p.y, heading: p.heading ?? 0 }))
      };
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) return;
      const saved = await res.json();
      setRoutes(prev => [saved, ...prev]);
      setRouteName('');
      setSelectedRouteId(saved._id);
    } catch {}
  };

  const handleExportRoute = () => {
    if (!selectedRouteId || selectedRoutePath.length === 0) return;
    const routeMeta = routes.find((r) => r._id === selectedRouteId) || null;
    const payload = {
      id: selectedRouteId,
      name: routeMeta?.name || routeRename || '',
      description: routeMeta?.description || '',
      createdAt: routeMeta?.createdAt || null,
      path: selectedRoutePath,
      potholes: routePotholes
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `route-${selectedRouteId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  };

  const handleRenameRoute = async () => {
    if (!selectedRouteId || !routeRename.trim()) return;
    try {
      const body = { name: routeRename.trim() };
      const res = await fetch(`/api/routes/${selectedRouteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) return;
      const updated = await res.json();
      setRoutes((prev) =>
        prev.map((r) => (r._id === updated._id ? { ...r, name: updated.name, description: updated.description } : r))
      );
    } catch {}
  };

  const handleDeleteRoute = async () => {
    if (!selectedRouteId) return;
    try {
      const res = await fetch(`/api/routes/${selectedRouteId}`, {
        method: 'DELETE'
      });
      if (!res.ok) return;
      setRoutes((prev) => prev.filter((r) => r._id !== selectedRouteId));
      setSelectedRouteId('');
      setSelectedRoutePath([]);
      setRouteRename('');
    } catch {}
  };

  const handleStartAuto = () => {
    if (!esp32Connected || !selectedRouteId || selectedRoutePath.length === 0) return;
    const path = selectedRoutePath.map(p => ({ x: p.x, y: p.y, heading: p.heading ?? 0 }));
    send({
      type: 'autoDrive',
      source: 'ui',
      ts: Date.now(),
      data: {
        routeId: selectedRouteId,
        speed: autoSpeed,
        path
      }
    });
    setDriveStatus('driving');
  };

  const handleSaveBuilderRoute = async () => {
    if (builderPath.length < 2 || !builderRouteName.trim()) return;
    try {
      const body = {
        name: builderRouteName.trim(),
        description: '',
        path: builderPath.map((p) => ({ x: p.x, y: p.y, heading: p.heading ?? 0 }))
      };
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) return;
      const saved = await res.json();
      setRoutes((prev) => [saved, ...prev]);
      setBuilderRouteName('');
      setSelectedRouteId(saved._id);
    } catch {}
  };

  const updateSegment = (index, field, value) => {
    setBuilderSegments((prev) =>
      prev.map((seg, i) => (i === index ? { ...seg, [field]: value } : seg))
    );
  };

  const addSegment = () => {
    setBuilderSegments((prev) => [...prev, { length: 5, turn: 0 }]);
  };

  const removeSegment = (index) => {
    setBuilderSegments((prev) => prev.filter((_, i) => i !== index));
  };

  const totalBuilderDistance = builderSegments.reduce((sum, seg) => {
    const n = Number(seg.length);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);

  const handleStartBuilderAuto = () => {
    if (!esp32Connected || builderPath.length < 2) return;
    const path = builderPath.map((p) => ({ x: p.x, y: p.y, heading: p.heading ?? 0 }));
    send({
      type: 'autoDrive',
      source: 'ui',
      ts: Date.now(),
      data: {
        routeId: selectedRouteId || undefined,
        speed: autoSpeed,
        path
      }
    });
    setDriveStatus('driving');
  };

  return (
    <Card className="h-full flex flex-col border border-slate-200/70 shadow-sm bg-white/80">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight">Local Map & Route</CardTitle>
            <CardDescription className="text-xs">
              Visualize live motion from the car, saved routes from Mongo, and programmed routes you design.
            </CardDescription>
          </div>
          <div className="hidden md:flex items-center gap-2 text-[11px]">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border text-[10px] font-medium ${
                esp32Connected
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {esp32Connected ? 'ESP32 connected' : 'ESP32 disconnected'}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 flex-1 flex flex-col">
        <div className="relative border rounded-md bg-slate-50 overflow-hidden">
          <canvas ref={canvasRef} width={520} height={320} className="w-full h-[260px] md:h-[320px]" />
          <div className="pointer-events-none absolute inset-0 flex items-start justify-between p-2">
            <div className="bg-white/85 border border-slate-200 rounded px-2 py-1 text-[10px] space-y-1 shadow-sm">
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded bg-slate-900" />
                <span>Live trail (from ESP)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded bg-emerald-500" />
                <span>Selected saved route</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded bg-blue-500" />
                <span>Programmed route</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                <span>Potholes</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 text-xs mt-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-medium text-slate-700">Live trail</div>
              <span className="text-[11px] text-slate-500">Record path while you manually drive.</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                placeholder="Route name"
                className="flex-1 px-2 py-1 rounded border border-slate-200 text-xs bg-white"
              />
              <Button size="xs" variant="outline" onClick={handleSaveRoute} disabled={trail.length < 2 || !routeName.trim()}>
                Save route
              </Button>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Points: {trail.length}</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleClear}
                  className="underline-offset-2 hover:underline"
                >
                  Clear trail
                </button>
                <button
                  type="button"
                  onClick={handleCleanMap}
                  className="underline-offset-2 hover:underline"
                >
                  Clean map
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-medium text-slate-700">Replay route</div>
              <span className="text-[11px] text-slate-500">Select and send saved routes back to the car.</span>
            </div>
            <select
              value={selectedRouteId}
              onChange={(e) => setSelectedRouteId(e.target.value)}
              className="w-full px-2 py-1 rounded border border-slate-200 text-xs bg-white"
            >
              <option value="">Select saved route</option>
              {routes.map(r => (
                <option key={r._id} value={r._id}>{r.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-1 mt-1">
              <input
                type="text"
                value={routeRename}
                onChange={(e) => setRouteRename(e.target.value)}
                placeholder="Rename route"
                className="flex-1 px-2 py-1 rounded border border-slate-200 text-[11px] bg-white"
              />
              <Button
                size="xs"
                variant="outline"
                onClick={handleRenameRoute}
                disabled={!selectedRouteId || !routeRename.trim()}
              >
                Rename
              </Button>
              <button
                type="button"
                onClick={handleDeleteRoute}
                className="px-1 text-[11px] text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </div>
            <div className="mt-1 flex items-center justify-end">
              <Button
                size="xs"
                variant="outline"
                onClick={handleExportRoute}
                disabled={!selectedRouteId || selectedRoutePath.length === 0}
              >
                Download route JSON
              </Button>
            </div>
            <div className="space-y-1 mt-1">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Auto speed</span>
                <span className="font-mono text-xs text-foreground">{autoSpeed}</span>
              </div>
              <Slider min={60} max={220} step={5} value={[autoSpeed]} onValueChange={([v]) => setAutoSpeed(v)} />
            </div>
            <Button
              size="xs"
              className="mt-1 w-full"
              disabled={!esp32Connected || !selectedRouteId || selectedRoutePath.length === 0}
              onClick={handleStartAuto}
            >
              Start autonomous drive
            </Button>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
              <span>Drive status</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  driveStatus === 'driving'
                    ? 'bg-amber-100 text-amber-700'
                    : driveStatus === 'completed'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {driveStatus === 'driving'
                  ? 'Driving'
                  : driveStatus === 'completed'
                  ? 'Completed'
                  : 'Idle'}
              </span>
            </div>
            {routeEvent && (
              <div className="mt-1 text-[11px] text-emerald-600">
                Route complete{routeEvent.routeId ? ` (id: ${routeEvent.routeId})` : ''}
              </div>
            )}
            {routeStats && (
              <div className="mt-2 space-y-1 text-[11px] text-slate-600">
                <div className="font-medium text-slate-700 text-xs">Selected route stats</div>
                <div className="flex items-center justify-between">
                  <span>Distance</span>
                  <span className="font-mono">{routeStats.distanceMeters.toFixed(1)} m</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Potholes</span>
                  <span className="font-mono">{routeStats.potholesTotal}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>By severity</span>
                  <span className="font-mono">
                    L:{routeStats.potholesBySeverity.low}
                    {' '}M:{routeStats.potholesBySeverity.medium}
                    {' '}H:{routeStats.potholesBySeverity.high}
                  </span>
                </div>
              </div>
            )}
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-600">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="h-3 w-3"
                  checked={useStoredPotholes}
                  onChange={(e) => setUseStoredPotholes(e.target.checked)}
                  disabled={!selectedRouteId || routePotholes.length === 0}
                />
                <span>Show stored potholes for selected route</span>
              </label>
            </div>
            {routePotholes.length > 0 && (
              <div className="mt-2 space-y-1 text-[11px] text-slate-600 max-h-32 overflow-y-auto pr-1 border-t pt-2">
                <div className="font-medium text-slate-700 text-xs mb-1">Route potholes</div>
                {routePotholes.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span>
                      {p.severity || 'unknown'}
                      {typeof p.value === 'number' ? ` (${p.value.toFixed(1)})` : ''}
                      {' '}@ ({p.x.toFixed(2)}, {p.y.toFixed(2)})
                    </span>
                    {typeof p.ts === 'number' && (
                      <span className="font-mono text-[10px] text-slate-500">
                        {new Date(p.ts).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 space-y-1 border-t pt-2">
              <div className="flex items-center justify-between">
                <div className="font-medium text-slate-700 text-xs">Programmed route (meters & turns)</div>
                <span className="text-[11px] text-slate-500">Design a route without driving first.</span>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                {builderSegments.map((seg, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={seg.length}
                      onChange={(e) => updateSegment(idx, 'length', e.target.value)}
                      className="w-16 px-1 py-0.5 rounded border border-slate-200 text-[11px] bg-white"
                    />
                    <span className="text-[11px] text-slate-500">m</span>
                    <input
                      type="number"
                      step="5"
                      value={seg.turn}
                      onChange={(e) => updateSegment(idx, 'turn', e.target.value)}
                      className="w-16 px-1 py-0.5 rounded border border-slate-200 text-[11px] bg-white"
                    />
                    <span className="text-[11px] text-slate-500">° turn</span>
                    <button
                      type="button"
                      onClick={() => removeSegment(idx)}
                      className="px-1 text-[11px] text-slate-400 hover:text-slate-700"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                <button
                  type="button"
                  onClick={addSegment}
                  className="underline-offset-2 hover:underline"
                >
                  Add segment
                </button>
                <span>Total: {totalBuilderDistance.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  value={builderRouteName}
                  onChange={(e) => setBuilderRouteName(e.target.value)}
                  placeholder="Programmed route name"
                  className="flex-1 px-2 py-1 rounded border border-slate-200 text-[11px] bg-white"
                />
                <Button
                  size="xs"
                  variant="outline"
                  onClick={handleSaveBuilderRoute}
                  disabled={builderPath.length < 2 || !builderRouteName.trim()}
                >
                  Save programmed route
                </Button>
              </div>
              <Button
                size="xs"
                variant="outline"
                className="mt-1 w-full"
                disabled={!esp32Connected || builderPath.length < 2}
                onClick={handleStartBuilderAuto}
              >
                Drive programmed route
              </Button>
            </div>
            {recentRuns.length > 0 && (
              <div className="mt-3 space-y-1 border-t pt-2">
                <div className="font-medium text-slate-700 text-xs">Recent runs</div>
                <div className="space-y-0.5 text-[11px] text-slate-600">
                  {recentRuns.map((run) => (
                    <div key={run.id} className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => run.routeId && setSelectedRouteId(run.routeId)}
                        className={`text-left underline-offset-2 ${
                          run.routeId ? 'hover:underline text-slate-700' : 'text-slate-400 cursor-default'
                        }`}
                      >
                        {run.name}
                      </button>
                      <span className="font-mono text-[10px] text-slate-500">
                        {new Date(run.ts).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
