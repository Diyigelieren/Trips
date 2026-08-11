# RouteBookLayer

A reusable Leaflet route-book renderer for the `Trips` repository.

## What it provides

- dual-stroke route rendering (dark casing + colored core)
- repeated direction arrows along the route
- optional route labels and route nodes
- click-to-focus a route
- non-active route dimming
- responsive arrow spacing for desktop/mobile
- automatic arrow re-layout after zoom / pan
- progressive geometry fallback:
  1. static GeoJSON (`geometryUrl`)
  2. browser cache
  3. online router (currently OSRM)
  4. straight waypoint polyline

## Shared files

```text
assets/routebook/
├── route-book.js
├── route-book.css
└── README.md
```

Do not copy these files into every trip. All trip pages should reference this shared component.

## Per-trip files

Recommended structure:

```text
trips/<trip-id>/
├── index.html
├── route-book.json
├── premium.css
├── mobile.css
├── legend-toggle.css
└── routes/                 # optional
    ├── d1.geojson
    ├── d2.geojson
    └── ...
```

Each trip uses a single `index.html` page. Do not add an iframe shell or a separate `app.html` unless a trip has a specific reason to isolate another application.

`routes/*.geojson` is optional. If a static geometry file is absent, the renderer can use cached geometry, request road geometry from the configured router, and finally fall back to waypoint lines if routing is unavailable.

## Minimal config

```json
{
  "router": {
    "enabled": true,
    "service": "osrm",
    "endpoint": "https://router.project-osrm.org/route/v1/driving/",
    "timeout": 6500,
    "minIntervalMs": 1100,
    "cacheTtlDays": 14
  },
  "points": {
    "Start": [30.0, 104.0],
    "Stop": [30.5, 103.5],
    "End": [31.0, 103.0]
  },
  "routes": [
    {
      "id": "d1",
      "name": "D1",
      "title": "Start → Stop → End",
      "color": "#4f8cff",
      "waypoints": ["Start", "Stop", "End"]
    }
  ]
}
```

GeoJSON coordinates use standard `[longitude, latitude]` order.

## Integration

The trip page needs an existing Leaflet `map`. Load the shared CSS/JS directly from the single trip page and initialize:

```js
const book = await RouteBookLayer.fromConfig({
  map,
  L,
  configUrl: './route-book.json',
  baseUrl: new URL('./', location.href).href
});

await book.init();
book.setActive('all', { fit: true });
```

Useful methods:

```js
book.setActive('d2', { fit: true });
book.setActive('all', { fit: true });
book.fit('d3');
book.destroy();
```

Use `book.onChange = (id) => { ... }` to synchronize custom D1–D4 buttons.

## Static route geometry

For production-quality road books, prefer checked-in GeoJSON instead of relying on an online routing service at page load. The renderer will automatically use a valid static `geometryUrl` first.

Example:

```json
{
  "type": "Feature",
  "properties": { "id": "d1" },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [104.0668, 30.5728],
      [103.4900, 31.0610]
    ]
  }
}
```

This makes the published GitHub Pages site deterministic and removes runtime routing dependency.