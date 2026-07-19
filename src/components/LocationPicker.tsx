"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { Crosshair } from "@/lib/icons";

/**
 * OpenStreetMap location picker built directly on Leaflet (no API key,
 * no billing). Leaflet touches `window`, so it's imported dynamically
 * inside an effect to stay clear of SSR. Click the map or drag the pin
 * to set the coordinates; "Use my location" calls the browser
 * geolocation API.
 */

const DEFAULT_CENTER: [number, number] = [31.9539, 35.9106]; // Amman, JO

export default function LocationPicker({
  lat,
  lng,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  // Keep the latest onChange without re-initialising the map.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const start: [number, number] =
        lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER;
      const map = L.map(containerRef.current, {
        center: start,
        zoom: lat != null && lng != null ? 15 : 11,
        scrollWheelZoom: true,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const pin = L.divIcon({
        className: "",
        html: '<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:#E2231A;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);transform:rotate(-45deg)"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 18],
      });

      function place(la: number, ln: number) {
        if (markerRef.current) {
          markerRef.current.setLatLng([la, ln]);
        } else {
          const m = L.marker([la, ln], { icon: pin, draggable: true }).addTo(map);
          m.on("dragend", () => {
            const p = m.getLatLng();
            onChangeRef.current(p.lat, p.lng);
          });
          markerRef.current = m;
        }
      }

      if (lat != null && lng != null) place(lat, lng);

      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        place(e.latlng.lat, e.latlng.lng);
        onChangeRef.current(e.latlng.lat, e.latlng.lng);
      });

      // Leaflet mis-measures the container if it mounts inside a modal
      // that animates in; nudge it once on the next frame.
      setTimeout(() => map.invalidateSize(), 0);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Init once — subsequent lat/lng changes from parent typing aren't
    // re-centred to avoid fighting the user's map interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      onChangeRef.current(latitude, longitude);
      const map = mapRef.current;
      if (map) {
        map.setView([latitude, longitude], 15);
        // Re-place the marker.
        map.fire("click", { latlng: { lat: latitude, lng: longitude } });
      }
    });
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="h-56 w-full overflow-hidden rounded-xl border border-magic-border"
        style={{ background: "#e8eef5" }}
      />
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          className="inline-flex items-center gap-1.5 rounded-lg border border-magic-border px-2.5 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
        >
          <Crosshair className="h-3.5 w-3.5" />
          Use my location
        </button>
        <span className="text-[11px] text-magic-ink/50">
          {lat != null && lng != null
            ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
            : "Click the map to drop a pin"}
        </span>
      </div>
    </div>
  );
}
