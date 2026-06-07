'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MapPin, RefreshCw, Users } from 'lucide-react';
import { Button, EmptyState, PageLoader } from '@/components/ui';
import { patientService, staffService } from '@/services';

// Load Leaflet from CDN once (no npm dependency, no SSR issues)
function loadLeaflet(): Promise<any> {
  return new Promise((resolve) => {
    const w = window as any;
    if (w.L) return resolve(w.L);
    if (!document.getElementById('leaflet-css')) {
      const css = document.createElement('link');
      css.id = 'leaflet-css';
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
    }
    const existing = document.getElementById('leaflet-js') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(w.L));
      return;
    }
    const script = document.createElement('script');
    script.id = 'leaflet-js';
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve(w.L);
    document.body.appendChild(script);
  });
}

export default function MapPage() {
  const [caregiverId, setCaregiverId] = useState('');
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [leafletReady, setLeafletReady] = useState(false);

  const { data: caregivers } = useQuery({
    queryKey: ['staff', 'caregivers'],
    queryFn:  () => staffService.list('caregiver'),
  });

  const { data: locations = [], isLoading, refetch } = useQuery({
    queryKey: ['patient-map', caregiverId],
    queryFn:  () => patientService.mapLocations(caregiverId || undefined),
  });

  const backfillMut = useMutation({
    mutationFn: () => patientService.backfillGeocode(),
    onSuccess: (res) => { toast.success(res.message || 'Geocoding complete ✓'); refetch(); },
    onError: (e: any) => toast.error(e?.response?.data?.detail?.message || 'Geocoding unavailable. Add the Azure Maps key first.'),
  });

  // Initialize the Leaflet map once the library and container are ready
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current).setView([31.0, -97.5], 7); // central Texas default
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      markersRef.current = L.layerGroup().addTo(map);
      setLeafletReady(true);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // Redraw markers whenever locations change
  useEffect(() => {
    const w = window as any;
    const L = w.L;
    if (!L || !mapRef.current || !markersRef.current) return;

    markersRef.current.clearLayers();
    const bounds: [number, number][] = [];

    locations.forEach((p: any) => {
      if (p.latitude == null || p.longitude == null) return;
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:#1B4332;width:26px;height:26px;border-radius:50% 50% 50% 0;
                 transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3);
                 display:flex;align-items:center;justify-content:center;">
                 <div style="width:8px;height:8px;background:white;border-radius:50%;transform:rotate(45deg);"></div>
               </div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 26],
        popupAnchor: [0, -26],
      });
      const addr = [p.address_line1, p.city, p.state, p.zip].filter(Boolean).join(', ');
      const marker = L.marker([p.latitude, p.longitude], { icon }).bindPopup(`
        <div style="font-family:system-ui;min-width:180px;">
          <div style="font-weight:700;font-size:14px;">${p.first_name} ${p.last_name}</div>
          ${p.primary_diagnosis ? `<div style="color:#2D6A4F;font-size:12px;margin-top:2px;">${p.primary_diagnosis}</div>` : ''}
          <div style="color:#4A4845;font-size:12px;margin-top:4px;">${addr}</div>
          ${p.phone ? `<div style="color:#8A8784;font-size:12px;">${p.phone}</div>` : ''}
          ${p.caregiver_name ? `<div style="color:#8A8784;font-size:11px;margin-top:4px;">Caregiver: ${p.caregiver_name}</div>` : ''}
          <a href="/patients/${p.id}" style="color:#1B4332;font-size:12px;font-weight:600;display:inline-block;margin-top:6px;">Open chart →</a>
        </div>
      `);
      markersRef.current.addLayer(marker);
      bounds.push([p.latitude, p.longitude]);
    });

    if (bounds.length > 0) {
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
    }
  }, [locations, leafletReady]);

  const mappable = locations.filter((p: any) => p.latitude != null && p.longitude != null);

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Patient Map</h1>
          <p className="page-subtitle">Plan caregiver routes by seeing every patient's home on the map</p>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw size={13} />}
          loading={backfillMut.isPending}
          onClick={() => backfillMut.mutate()}>
          Geocode Existing Patients
        </Button>
      </div>

      {/* Filter bar */}
      <div className="card p-3 mb-4">
        <div className="flex items-center gap-3">
          <Users size={15} className="text-ink-3" />
          <select className="form-select w-auto" value={caregiverId} onChange={e => setCaregiverId(e.target.value)}>
            <option value="">All caregivers</option>
            {caregivers?.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select>
          <span className="text-sm text-ink-3">
            <MapPin size={12} className="inline mr-1" />
            {mappable.length} patient{mappable.length === 1 ? '' : 's'} mapped
          </span>
        </div>
      </div>

      {/* Map */}
      <div className="card overflow-hidden" style={{ position: 'relative' }}>
        <div ref={containerRef} style={{ height: '600px', width: '100%', background: '#e8eef0' }} />
        {isLoading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.6)' }}>
            <PageLoader />
          </div>
        )}
        {!isLoading && mappable.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto', maxWidth: 420 }}>
              <EmptyState
                icon="🗺️"
                title="No mapped patients yet"
                description="Patients appear here once their addresses are geocoded. If you've just added the Azure Maps key, click 'Geocode Existing Patients' above to map your current patients."
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
