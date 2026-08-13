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
  const { latitude, longitude, activeZoneRadiusKm } = fleet.terminal;

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
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), fullPage ? 'top-right' : 'bottom-left');
    map.on('load', () => {
      map.addSource('active-zone', { type: 'geojson', data: geofencePolygon(latitude, longitude, activeZoneRadiusKm) });
      map.addLayer({ id: 'active-zone-fill', type: 'fill', source: 'active-zone', paint: { 'fill-color': '#087A36', 'fill-opacity': 0.1 } });
      map.addLayer({ id: 'active-zone-line', type: 'line', source: 'active-zone', paint: { 'line-color': '#087A36', 'line-width': 2, 'line-dasharray': [2, 2] } });
      map.addSource('terminal', { type: 'geojson', data: { type: 'Feature', properties: { label: 'NCEBT' }, geometry: { type: 'Point', coordinates: [longitude, latitude] } } });
      map.addLayer({ id: 'terminal-point', type: 'circle', source: 'terminal', paint: { 'circle-radius': 10, 'circle-color': '#043D20', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
      map.addLayer({ id: 'terminal-label', type: 'symbol', source: 'terminal', layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.6], 'text-anchor': 'top' }, paint: { 'text-color': '#043D20', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
      map.addSource('vehicles', { type: 'geojson', data: { type: 'FeatureCollection', features: initialVehiclesRef.current.map((vehicle) => ({ type: 'Feature', properties: { vanId: vehicle.vanId, status: vehicle.status, inside: vehicle.insideActiveZone }, geometry: { type: 'Point', coordinates: [vehicle.longitude, vehicle.latitude] } })) } });
      map.addLayer({ id: 'vehicle-points', type: 'circle', source: 'vehicles', paint: { 'circle-radius': 9, 'circle-color': ['match', ['get', 'status'], 'incoming', '#1769E0', 'delayed', '#DC2626', 'ready_for_dispatch', '#15813A', '#087A36'], 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
      map.addLayer({ id: 'vehicle-labels', type: 'symbol', source: 'vehicles', layout: { 'text-field': ['get', 'vanId'], 'text-size': 11, 'text-offset': [0, -1.5], 'text-anchor': 'bottom' }, paint: { 'text-color': '#13271B', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
    });
    return () => { map.remove(); mapRef.current = null; };
  }, [activeZoneRadiusKm, compact, fullPage, latitude, longitude, token]);

  useEffect(() => {
    const source = mapRef.current?.getSource('vehicles') as GeoJSONSource | undefined;
    if (!source) return;
    source.setData({ type: 'FeatureCollection', features: fleet.vehicles.map((vehicle) => ({ type: 'Feature', properties: { vanId: vehicle.vanId, status: vehicle.status, inside: vehicle.insideActiveZone }, geometry: { type: 'Point', coordinates: [vehicle.longitude, vehicle.latitude] } })) });
  }, [fleet.vehicles]);

  if (!token) return <div className="flex min-h-80 items-center justify-center rounded-card bg-cream p-6 text-center"><div><AlertTriangle className="mx-auto h-7 w-7 text-warning" /><p className="mt-3 font-bold">Mapbox token is not configured</p><p className="mt-1 text-sm text-text-secondary">Add the public token to `client/.env`.</p></div></div>;
  const mapHeightClass = compact
    ? 'h-[23rem] w-full'
    : fullPage
      ? 'min-h-[30rem] w-full'
      : 'h-[31rem] w-full';
  return <div ref={containerRef} className={mapHeightClass} style={fullPage ? { height: 'calc(100dvh - 6rem)' } : undefined} aria-label="Dispatcher fleet map showing the NCEBT 5 km Active Zone and current vehicle positions" />;
}
