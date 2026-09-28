import { useEffect, useRef } from 'react';
import mapboxgl, { type GeoJSONSource, type Map as MapboxMap } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { FleetSnapshot } from '../../types/dispatcher';
import { AlertTriangle } from 'lucide-react';

interface FleetMapProps {
  fleet: FleetSnapshot;
  compact?: boolean;
  fullPage?: boolean;
}

function geofencePolygon(latitude: number, longitude: number, radiusKm: number) {
  const points = 96;
  const coordinates = Array.from({ length: points + 1 }, (_, index) => {
    const bearing = (index / points) * Math.PI * 2;
    const latOffset = (radiusKm / 111.32) * Math.cos(bearing);
    const lngOffset = (radiusKm / (111.32 * Math.cos((latitude * Math.PI) / 180))) * Math.sin(bearing);
    return [longitude + lngOffset, latitude + latOffset];
  });
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [coordinates] } };
}

export function FleetMap({ fleet, compact = false, fullPage = false }: FleetMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const initialVehiclesRef = useRef(fleet.vehicles);
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  const { latitude, longitude, activeZoneRadiusKm, terminalArrivalRadiusKm } = fleet.terminal;
  const terminalRadiusMeters = Math.round(terminalArrivalRadiusKm * 1_000);

  useEffect(() => {
    if (!containerRef.current || !token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [longitude, latitude],
      zoom: compact ? 10.2 : 10.8,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), fullPage ? 'top-right' : 'bottom-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'top-right');
    map.on('load', () => {
      map.addSource('active-zone', { type: 'geojson', data: geofencePolygon(latitude, longitude, activeZoneRadiusKm) });
      map.addLayer({ id: 'active-zone-fill', type: 'fill', source: 'active-zone', paint: { 'fill-color': '#087A36', 'fill-opacity': 0.1 } });
      map.addLayer({ id: 'active-zone-line', type: 'line', source: 'active-zone', paint: { 'line-color': '#087A36', 'line-width': 2, 'line-dasharray': [2, 2] } });
      map.addSource('terminal-arrival-zone', { type: 'geojson', data: geofencePolygon(latitude, longitude, terminalArrivalRadiusKm) });
      map.addLayer({ id: 'terminal-arrival-zone-fill', type: 'fill', source: 'terminal-arrival-zone', paint: { 'fill-color': '#F59E0B', 'fill-opacity': 0.24 } });
      map.addLayer({ id: 'terminal-arrival-zone-line', type: 'line', source: 'terminal-arrival-zone', paint: { 'line-color': '#B45309', 'line-width': 3 } });
      map.addSource('terminal', { type: 'geojson', data: { type: 'Feature', properties: { label: 'NCEBT' }, geometry: { type: 'Point', coordinates: [longitude, latitude] } } });
      map.addLayer({ id: 'terminal-point', type: 'circle', source: 'terminal', paint: { 'circle-radius': 10, 'circle-color': '#043D20', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
      map.addLayer({ id: 'terminal-label', type: 'symbol', source: 'terminal', layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.6], 'text-anchor': 'top' }, paint: { 'text-color': '#043D20', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
      map.addSource('vehicles', { type: 'geojson', data: { type: 'FeatureCollection', features: initialVehiclesRef.current.map((vehicle) => ({ type: 'Feature', properties: { vanId: vehicle.vanId, status: vehicle.status, insideActiveZone: vehicle.insideActiveZone, insideTerminalZone: vehicle.insideTerminalZone }, geometry: { type: 'Point', coordinates: [vehicle.longitude, vehicle.latitude] } })) } });
      map.addLayer({ id: 'vehicle-points', type: 'circle', source: 'vehicles', paint: { 'circle-radius': 9, 'circle-color': ['match', ['get', 'status'], 'incoming', '#1769E0', 'delayed', '#DC2626', 'ready_for_dispatch', '#15813A', '#087A36'], 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
      map.addLayer({ id: 'vehicle-labels', type: 'symbol', source: 'vehicles', layout: { 'text-field': ['get', 'vanId'], 'text-size': 11, 'text-offset': [0, -1.5], 'text-anchor': 'bottom' }, paint: { 'text-color': '#13271B', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
    });
    return () => { map.remove(); mapRef.current = null; };
  }, [activeZoneRadiusKm, compact, fullPage, latitude, longitude, terminalArrivalRadiusKm, token]);

  useEffect(() => {
    const source = mapRef.current?.getSource('vehicles') as GeoJSONSource | undefined;
    if (!source) return;
    source.setData({ type: 'FeatureCollection', features: fleet.vehicles.map((vehicle) => ({ type: 'Feature', properties: { vanId: vehicle.vanId, status: vehicle.status, insideActiveZone: vehicle.insideActiveZone, insideTerminalZone: vehicle.insideTerminalZone }, geometry: { type: 'Point', coordinates: [vehicle.longitude, vehicle.latitude] } })) });
  }, [fleet.vehicles]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  if (!token) return <div className="flex min-h-80 items-center justify-center rounded-card bg-cream p-6 text-center"><div><AlertTriangle className="mx-auto h-7 w-7 text-warning" /><p className="mt-3 font-bold">Mapbox token is not configured</p><p className="mt-1 text-sm text-text-secondary">Add the public token to `client/.env`.</p></div></div>;
  const mapHeightClass = compact
    ? 'min-h-[20rem] w-full flex-1'
    : fullPage
      ? 'h-[calc(100dvh-6rem)] min-h-[30rem] w-full'
      : 'h-[clamp(28rem,65dvh,44rem)] w-full';
  return (
    <div className={`relative overflow-hidden ${mapHeightClass}`}>
      <div ref={containerRef} className="h-full w-full" aria-label={`Dispatcher fleet map showing the NCEBT ${terminalRadiusMeters} meter terminal arrival zone, 5 kilometer Active Zone, and current vehicle positions`} />
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%_-_5rem)] flex-col gap-2">
        <button
          type="button"
          className="w-fit rounded-control border border-amber-700/30 bg-white/95 px-3 py-2 text-left text-xs font-extrabold text-amber-800 shadow-card backdrop-blur hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
          onClick={() => mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 17, duration: 900 })}
        >
          View {terminalRadiusMeters} m terminal zone
        </button>
        <div className="pointer-events-none flex flex-wrap gap-x-3 gap-y-1 rounded-control border border-border/80 bg-white/90 px-3 py-2 text-[0.65rem] font-bold text-text-secondary shadow-card backdrop-blur">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-amber-700 bg-amber-400/40" />{terminalRadiusMeters} m loading zone</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-primary bg-primary/10" />5 km incoming zone</span>
        </div>
      </div>
    </div>
  );
}
