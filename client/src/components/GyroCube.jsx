import { useEffect, useRef, useState } from 'react';

export function GyroCube({ x=0, y=0, z=0 }){
  // simple EMA smoothing to avoid jitter
  const [ang, setAng] = useState({x:0,y:0,z:0});
  const raf = useRef();

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      setAng(prev => ({
        x: prev.x*0.8 + x*0.2,
        y: prev.y*0.8 + y*0.2,
        z: prev.z*0.8 + z*0.2,
      }));
    });
    return () => cancelAnimationFrame(raf.current);
  }, [x,y,z]);

  return (
    <div className="w-64 h-64 mx-auto perspective-midrange">
      <div className="relative w-full h-full transform-gpu transition-transform duration-75"
           style={{ transform: `rotateX(${ang.x}deg) rotateY(${ang.y}deg) rotateZ(${ang.z}deg)` }}>
        <div className="absolute inset-0 bg-indigo-500/30 border border-indigo-400 rounded-md grid place-items-center text-indigo-900 font-medium">
          Cube
        </div>
      </div>
    </div>
  );
}
