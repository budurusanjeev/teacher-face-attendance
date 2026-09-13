export type GeoFix = { lat: number; lng: number; accuracy: number };

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const r = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function readGps(timeoutMs = 8000): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This tablet has no GPS. Turn off “Require GPS” in office settings, or use a device with location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        reject(new Error(err.message || "Location permission denied."));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10_000 },
    );
  });
}
