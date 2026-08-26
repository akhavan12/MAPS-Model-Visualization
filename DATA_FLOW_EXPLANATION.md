# MAPS Visualization Data Flow

## Overview

This document explains how data flows from the raw NetCDF file, through iPython processing, to the interactive web visualization. The pipeline involves multiple data transformations, optimizations, and export formats for different use cases.

---

## Source Data: NetCDF File

**File**: `maps_output_SC05_07_26_2026.nc` (~6.4 GB)

The source is a large NetCDF (Network Common Data Form) file containing MAPS (epidemiological model) output:

- **Dimensions**: 46 time steps × 3,105 lat × 7,025 lon grid points
- **Geographic Coverage**: CONUS (Continental US) bounding box
  - Latitude: 24.06°N to 49.93°N
  - Longitude: -125.02°E to -66.49°E
- **Variables** (all gridded):
  - `S`: Susceptible population
  - `I_total`: Total infectious population
  - `D`: D field (deaths/demographic data)
  - `NDI_total`: **New daily infections (total)** ← this is what the web app visualizes
- **Time Coverage**: Jul 26, 2026 → Dec 6, 2026 (weekly snapshots)

The file is lazily loaded with `xarray` + `dask` to avoid loading ~32 GB of data into memory at once.

---

## Stage 1: Data Exploration & Export (iPython Notebook)

**File**: `maps_output_exploration.ipynb`

The notebook performs exploratory analysis and exports data in two formats:

### 1a. CSV Export for Kepler.gl

**Output**: `maps_output_SC05_07_26_2026.csv` (~4M rows, 100 MB)

**Process**:
1. **Spatial downsampling**: Every 8th grid cell in both lat/lon directions
   - Full grid: 3,105 × 7,025 = 21.8M cells/step
   - Downsampled: 389 × 879 = 342K cells/step
   - Stride factor: 8
2. **Drop zero cells**: Removes rows where all 4 variables are exactly zero (74-79% of cells are ocean/no-population)
3. **Precision reduction**: Coordinates rounded to 4 decimals, values to 3 decimals
4. **All 42 time steps included**
5. **Output format**: Long-format CSV with columns:
   ```
   time, lat, lon, S, I_total, D, NDI_total
   2026-07-26, 24.0625, -110.4208, 1.458, 0.0, 0.0, 0.0
   ...
   ```

**Use case**: This CSV is designed for import into [Kepler.gl](https://kepler.gl/demo), a browser-based mapping tool. It's too large for direct web use but suitable for desktop analysis or Kepler's JavaScript runtime.

---

## Stage 2: Binary Encoding & PNG Rendering (Preprocessing)

The web app does **not** use the CSV directly. Instead, it relies on preprocessed binary data and raster frames:

### 2a. Binary Lookup Table

**Output**: `viz/data/ndi_lookup.bin` (28 MB)

**What it contains**: Quantized NDI_total values for all grid cells across all time steps

**Encoding**:
- **Format**: Raw binary int16 array (16-bit signed integers)
- **Quantization**: Values multiplied by 100 before encoding (stored as int16)
  - Actual range: 0 → 167.227
  - Quantized range: 0 → 16,722
  - `quant_scale = 100` stored in metadata to reverse this
- **Layout**: Row-major array with shape `[42 time steps, 389 lat, 879 lon]`
- **Indexing**: `lookup[t * stride + latIdx * n_lon + lonIdx]` where stride = lat × lon = 389 × 879

**Purpose**: Fast retrieval of point-specific time series data for tooltips and detail charts

### 2b. PNG Frame Images

**Output**: `viz/frames/{scheme}/frame_NN.png` for each color scheme (yloRd, plasma, viridis, bupu)

**What they are**: Pre-rendered 2D heatmap images, one per time step per color scheme

**Specifications**:
- **Count**: 42 time steps × 4 color schemes = 168 PNG files
- **Dimensions**: Match the downsampled grid (389 × 879 pixels)
- **Pixel values**: Encode NDI_total with gamma-corrected color mapping
  - Each scheme has a colormap (e.g., YlOrRd, Viridis)
  - Gamma correction: 0.25 (darkens mid-tones for better visibility)
  - Floor value: 0.35–0.0 (visual threshold for very small values)
  - vmax (max displayed value): 132.5 infections per cell

**Purpose**: Fast, efficient visualization layer that can be displayed directly without per-pixel computation

---

## Stage 3: Metadata Assembly

**Output**: `viz/data/meta.json` (31 KB)

Contains all configuration needed by the web app:

```json
{
  "variable": "NDI_total",
  "long_name": "new daily infections total",
  "stride": 8,
  
  "n_time": 42,
  "n_lat": 389,
  "n_lon": 879,
  
  "lat": [24.0625, 24.129, ..., 49.929],  // All 389 lat values
  "lon": [-125.020, -124.954, ..., -66.487],  // All 879 lon values
  "time": ["2026-06-21", "2026-06-24", ..., "2026-10-22"],  // 42 dates
  
  "lat_min": 24.0625,
  "lat_max": 49.929,
  "lon_min": -125.020,
  "lon_max": -66.487,
  
  "quant_scale": 100,  // Reverse quantization factor
  "lookup_dtype": "int16",
  "lookup_shape": [42, 389, 879],
  "default_scheme": "yloRd",
  
  "color_schemes": {
    "yloRd": {
      "label": "Orange-Red",
      "cmap": "YlOrRd",
      "gamma": 0.25,
      "floor": 0.35,
      "vmin": 0,
      "vmax": 132.538,
      "legend_stop_values": [...],
      "legend_stop_colors": [...]
    },
    // ... and plasma, viridis, bupu
  }
}
```

---

## Stage 4: Web Visualization (Browser App)

**Main files**:
- `viz/app.js` (18 KB) — JavaScript application logic
- `viz/index.html` — HTML structure
- `viz/style.css` — Styling
- `viz/lib/d3.v7.min.js` — D3 visualization library
- `viz/lib/topojson-client.min.js` — TopoJSON utilities

### How the App Works

#### 4.1 **Data Loading**

```javascript
// 1. Load metadata (all configuration)
const meta = await fetch(`data/meta.json`).then(r => r.json());

// 2. Load binary lookup (all point time-series data)
const lookupBuf = await fetch(`data/ndi_lookup.bin`).then(r => r.arrayBuffer());
const lookup = new Int16Array(lookupBuf);

// 3. Load geographic boundaries
const statesTopo = await fetch(`data/topo/states-10m.json`).then(r => r.json());
const countiesTopo = await fetch(`data/topo/counties-10m.json`).then(r => r.json());
```

#### 4.2 **Main Visualization Layer: PNG Frames**

The largest visual element is a PNG image that tiles the entire map:

```javascript
// Load frame path for current time step and color scheme
const frameUrl = `frames/${colorScheme}/frame_${timeStep}.png`;
imageEl.attr("href", frameUrl);  // Swap to new frame
```

This is **extremely efficient**:
- Browser handles PNG rendering natively (GPU acceleration)
- No per-pixel computation
- Single image swap per time step
- Fast even with frequent updates during animation

#### 4.3 **Geographic Overlays**

Boundaries are rendered as SVG paths on top of the PNG:

```javascript
// States and counties from TopoJSON
const statesGeo = topojson.feature(statesTopo, statesTopo.objects.states);
const countiesGeo = topojson.feature(countiesTopo, countiesTopo.objects.counties);

// Custom projection to align with the PNG coordinate system
const geoProjection = d3.geoTransform({
  point(lonVal, latVal) {
    // Map lon/lat → pixel x/y
    this.stream.point(lonToX(lonVal), latToY(latVal));
  }
});

// Render as SVG paths
zoomLayer.selectAll("path")
  .data(countiesGeo.features)
  .join("path")
  .attr("d", geoPathGen)
  .attr("class", "county-border");
```

#### 4.4 **Interactive Tooltip: Point Lookup**

When the user hovers over a pixel, the app retrieves the time series for that location:

```javascript
function getSeries(latIdx, lonIdx) {
  const series = new Array(n_time);
  const stride = n_lat * n_lon;  // 389 × 879
  
  for (let t = 0; t < n_time; t++) {
    // Extract quantized value from binary lookup
    series[t] = lookup[t * stride + latIdx * n_lon + lonIdx] / quant_scale;
  }
  return series;  // [v0, v1, ..., v41] for all 42 time steps
}
```

**Tooltip display**:
1. Find nearest grid cell to cursor position
2. Extract that cell's time series from binary lookup
3. Render a mini line chart showing NDI_total evolution over time
4. Highlight current time step with a cursor line
5. Display location name (if inside a county) and current value

#### 4.5 **Detail Modal: Full Time Series Chart**

Double-clicking a point opens a larger chart:

```javascript
// Open modal, plot full time-series
function openModal(lonVal, latVal) {
  const { series, locationName, coordsStr } = getPointData(lonVal, latVal);
  modalSeries = series;
  drawModalChart();  // D3 area + line chart, full height
}
```

#### 4.6 **Animation & Time Control**

```javascript
// Slider or play button controls current time step
slider.addEventListener("input", () => setTime(+slider.value));

function setTime(t) {
  currentT = Math.max(0, Math.min(n_time - 1, t));
  imageEl.attr("href", framePaths[currentT]);  // Swap PNG frame
  dateLabel.textContent = timeStrs[currentT];
  
  if (tooltipLonLat) updateTooltipContent(...);  // Refresh tooltip values
  updateModalCurrentMarker();  // Update modal cursor line
}
```

#### 4.7 **Zoom & Pan**

D3 zoom interaction applied to a group containing the PNG and overlays:

```javascript
const zoom = d3.zoom()
  .scaleExtent([1, 40])
  .translateExtent([...])
  .on("zoom", (event) => {
    zoomLayer.attr("transform", event.transform);
  });
```

---

## Data Size Comparison

| Format | Size | Cells/Step | Use Case |
|--------|------|-----------|----------|
| Full NetCDF | 6.4 GB | 21.8M | Raw model output, analysis |
| Kepler.gl CSV | 100 MB | 342K | Desktop mapping tool import |
| Binary lookup | 28 MB | 342K | Point queries (browser) |
| PNG frames (1 scheme) | 2-5 MB × 42 | — | Raster display layer |
| **Total web load** | ~50 MB | — | Complete interactive app |

---

## Coordinate Systems

### Mapping Grids to Pixels

The PNG frames and overlay vectors must align perfectly. The app uses this coordinate mapping:

```
Input: lon/lat coordinates (geographic)
   ↓
Geographic projection (inverse transformation):
   lonToX(lon) → pixel x in [0, VIEW_W]
   latToY(lat) → pixel y in [0, VIEW_H]
   ↓
Output: SVG/canvas coordinates (screen pixels)
```

**Key math**:
```javascript
const VIEW_W = 1400;  // Internal viewBox width
const VIEW_H = VIEW_W * (n_lat / n_lon);  // ~388 pixels (preserving aspect)

const lonToX = (lonVal) => ((lonVal - lonMin) / (lonMax - lonMin)) * VIEW_W;
const latToY = (latVal) => ((latMax - latVal) / (latMax - latMin)) * VIEW_H;
```

This ensures:
- PNG pixels align with lat/lon grid cells
- Geographic overlays (state/county boundaries) appear in correct positions
- Hover queries map screen coordinates → grid indices → data lookup

---

## Color Schemes & Rendering

Each color scheme includes:

1. **Matplotlib colormap** (YlOrRd, Viridis, plasma, BuPu)
2. **Gamma correction** (0.25): Darkens midtones for visibility
3. **Floor value**: Threshold below which very small values collapse to a background color
4. **Value range**: vmin=0 to vmax≈132.5 (configured per scheme)
5. **Legend definition**: 32 color stops and their values for UI display

The PNG frames are pre-rendered with these settings, so switching schemes just changes which frame PNG is loaded—no re-rendering in the browser.

---

## Summary: CSV → Visualization Pipeline

```
maps_output_SC05_07_26_2026.nc (6.4 GB, full resolution)
  ↓
  ├─→ iPython Notebook Exploration
  │    ↓
  │    └─→ maps_output_SC05_07_26_2026.csv (100 MB, downsampled 8×8)
  │         └─→ Kepler.gl import (desktop mapping tool)
  │
  └─→ [Offline Preprocessing]
       ├─→ Binary Quantization & Encoding
       │    └─→ viz/data/ndi_lookup.bin (28 MB, int16 lookup)
       │
       ├─→ PNG Rendering (per time step, per color scheme)
       │    └─→ viz/frames/{scheme}/frame_NN.png (168 files total)
       │
       └─→ Metadata Assembly
            └─→ viz/data/meta.json (31 KB, all config)
                 ↓
            Web App (`app.js`)
             ├─→ Display PNG frames (main visualization)
             ├─→ Overlay geographic boundaries (TopoJSON)
             ├─→ Query binary lookup for point time-series
             ├─→ Render tooltips & detail charts (D3)
             └─→ Enable zoom, pan, animation, color switching
```

---

## Why This Architecture?

1. **Performance**: PNG frames render instantly (native browser/GPU support); no per-pixel computation
2. **Interactivity**: Binary lookup allows sub-millisecond point queries for smooth tooltips
3. **Responsiveness**: Metadata is tiny; app loads and feels snappy
4. **Flexibility**: Color schemes pre-rendered as separate frame sets; user can switch without re-computing
5. **Offline capability**: All data is static files; app runs client-side with no backend
6. **Dual purpose**: CSV export serves Kepler.gl users; web app serves interactive exploration

---

## Notes

- The **stride of 8** (every 8th grid cell) was chosen as a trade-off between spatial detail and file sizes
- The **42 time steps** represent weeks from late June through early December 2026
- **Binary encoding** (int16 with quantization) is 4× smaller than float32 and 100× smaller than CSV
- **PNG rendering** (not vector, not raster-on-demand) is the key to smooth animation and zoom interaction
- The **topoJSON boundaries** (states and counties) are separate static geometry; they don't rely on the model output
