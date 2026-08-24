#!/usr/bin/env python3
"""
Process MAPS NetCDF output to generate visualization data.

Generates:
- viz/data/meta.json: Metadata (grid info, time steps, color schemes)
- viz/data/ndi_lookup.bin: Binary lookup table for point queries
- maps_output_XXXXX.csv: Kepler.gl CSV export (optional)

Usage:
    python process_maps_data.py /path/to/maps_output.nc [--csv]
"""

import sys
import json
import argparse
from pathlib import Path
import numpy as np
import xarray as xr
import pandas as pd

# Color scheme definitions (from current meta.json)
COLOR_SCHEMES = {
    "yloRd": {
        "label": "Orange-Red",
        "cmap": "YlOrRd",
        "gamma": 0.25,
        "floor": 0.35,
        "vmin": 0,
    },
    "bupu": {
        "label": "Blue-Purple",
        "cmap": "BuPu",
        "gamma": 0.25,
        "floor": 0.35,
        "vmin": 0,
    },
    "viridis": {
        "label": "Viridis",
        "cmap": "viridis",
        "gamma": 0.25,
        "floor": 0.0,
        "vmin": 0,
    },
    "plasma": {
        "label": "Plasma",
        "cmap": "plasma",
        "gamma": 0.25,
        "floor": 0.0,
        "vmin": 0,
    },
}

# Legend color stops (fixed: 32 stops, same across schemes)
LEGEND_COLORS = {
    "yloRd": ["#feba55", "#fc4f2a", "#f23924", "#eb2b21", "#e61f1d", "#e0181d", "#da141e", "#d51020", "#d00d21", "#cd0b22", "#c80723", "#c40524", "#c20325", "#be0126", "#bb0026", "#b60026", "#b20026", "#ae0026", "#aa0026", "#a60026", "#a20026", "#9f0026", "#9b0026", "#990026", "#950026", "#910026", "#8f0026", "#8b0026", "#8a0026", "#880026", "#840026", "#820026", "#800026"],
    "bupu": ["#a5c1dc", "#8c6cb1", "#8a5aa9", "#894fa3", "#88459f", "#873d9a", "#863595", "#852f91", "#85288d", "#84248a", "#831d85", "#821982", "#821580", "#81117d", "#800f7b", "#7b0d76", "#770c73", "#740b70", "#710a6d", "#6e096a", "#6a0867", "#670864", "#640761", "#62065f", "#5f055c", "#5c0459", "#5a0457", "#570354", "#550253", "#540251", "#50014e", "#4f004d", "#4d004b"],
    "viridis": ["#440154", "#287d8e", "#21918c", "#1e9d89", "#22a785", "#28ae80", "#32b67a", "#3dbc74", "#48c16e", "#52c569", "#5cc863", "#67cc5c", "#70cf57", "#7ad151", "#84d44b", "#8bd646", "#95d840", "#9dd93b", "#a5db36", "#addc30", "#b5de2b", "#bddf26", "#c5e021", "#cae11f", "#d2e21b", "#d8e219", "#dfe318", "#e5e419", "#eae51a", "#efe51c", "#f4e61e", "#f8e621", "#fde725"],
    "plasma": ["#0d0887", "#b6308b", "#cc4778", "#d7566c", "#e06363", "#e66c5c", "#eb7655", "#f07f4f", "#f3874a", "#f68d45", "#f89441", "#fa9b3d", "#fba139", "#fca636", "#fdac33", "#fdb130", "#feb72d", "#fbb2b", "#fec029", "#fdc527", "#fdca26", "#fcce25", "#fbd324", "#fbd724", "#f9dc24", "#f8df25", "#f7e425", "#f6e826", "#f5eb27", "#f3ee27", "#f2f227", "#f1f525", "#f0f921"],
}


def load_netcdf(nc_path, variable="NDI_total"):
    """Load NetCDF and return the requested variable."""
    print(f"Loading NetCDF: {nc_path} ({variable})")
    ds = xr.open_dataset(nc_path, chunks={"time": 1, "lat": 1024, "lon": 1024})

    if variable not in ds:
        raise ValueError(f"{variable} variable not found in NetCDF file")

    return ds


def downsample_and_quantize(ds, variable="NDI_total", stride=8, quant_scale=100):
    """
    Downsample data and quantize to int16.

    Returns:
        - downsampled data (n_time, n_lat, n_lon)
        - lat/lon coordinates
        - time strings
        - value range (min, max)
    """
    print(f"Downsampling variable '{variable}' with stride={stride}...")

    # Subsample grid
    sub = ds.isel(lat=slice(None, None, stride), lon=slice(None, None, stride))
    n_time, n_lat, n_lon = sub[variable].shape

    # Load and compute stats
    print("Computing statistics...")
    var_data = sub[variable].load()

    vmin = float(var_data.min())
    vmax = float(var_data.max())
    print(f"Value range: {vmin:.6f} to {vmax:.6f}")

    # Quantize: multiply by scale and convert to int16
    print("Quantizing to int16...")
    quantized = (var_data.values * quant_scale).astype(np.int16)

    # Extract coordinates
    lat = sub.lat.values.tolist()
    lon = sub.lon.values.tolist()
    time = pd.to_datetime(sub.time.values).strftime("%Y-%m-%d").tolist()

    return {
        "data": quantized,
        "lat": lat,
        "lon": lon,
        "time": time,
        "vmin": vmin,
        "vmax": vmax,
        "n_time": n_time,
        "n_lat": n_lat,
        "n_lon": n_lon,
    }


def generate_legend_stops(vmax, n_stops=32):
    """Generate legend stop values from 0 to vmax."""
    return np.linspace(0, vmax, n_stops).tolist()


def generate_metadata(data_info, output_dir, variable="NDI_total"):
    """Generate and save meta.json."""
    print("Generating metadata...")

    vmax = data_info["vmax"]

    # Build color scheme definitions
    color_schemes = {}
    for scheme_id, scheme_config in COLOR_SCHEMES.items():
        legend_stops = generate_legend_stops(vmax)

        color_schemes[scheme_id] = {
            "label": scheme_config["label"],
            "cmap": scheme_config["cmap"],
            "gamma": scheme_config["gamma"],
            "floor": scheme_config["floor"],
            "vmin": scheme_config["vmin"],
            "vmax": vmax,
            "legend_stop_values": legend_stops,
            "legend_stop_colors": LEGEND_COLORS[scheme_id],
        }

    # Build metadata
    metadata = {
        "variable": variable,
        "long_name": variable,
        "stride": 8,
        "n_time": data_info["n_time"],
        "n_lat": data_info["n_lat"],
        "n_lon": data_info["n_lon"],
        "lat": data_info["lat"],
        "lon": data_info["lon"],
        "time": data_info["time"],
        "lat_min": min(data_info["lat"]),
        "lat_max": max(data_info["lat"]),
        "lon_min": min(data_info["lon"]),
        "lon_max": max(data_info["lon"]),
        "quant_scale": 100,
        "lookup_dtype": "int16",
        "lookup_shape": [data_info["n_time"], data_info["n_lat"], data_info["n_lon"]],
        "default_scheme": "yloRd",
        "color_schemes": color_schemes,
    }

    # Write to file
    meta_path = output_dir / "meta.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f)

    print(f"Wrote: {meta_path}")
    return metadata


def generate_binary_lookup(data_info, output_dir, variable="NDI_total"):
    """Generate and save the lookup binary."""
    print("Generating binary lookup...")

    quantized = data_info["data"]
    n_time, n_lat, n_lon = quantized.shape

    # Flatten to row-major order: (time, lat, lon) → 1D
    lookup_array = quantized.reshape(-1).astype(np.int16)

    # Keep the original NDI_total filename for backwards compatibility
    lookup_name = "ndi" if variable == "NDI_total" else variable.lower()
    lookup_path = output_dir / f"{lookup_name}_lookup.bin"
    lookup_array.tofile(lookup_path)

    file_size_mb = lookup_path.stat().st_size / (1024 * 1024)
    print(f"Wrote: {lookup_path} ({file_size_mb:.1f} MB)")


def export_kepler_csv(ds, output_path, stride=8):
    """Export downsampled data as Kepler.gl CSV."""
    print("Exporting Kepler.gl CSV...")

    sub = ds.isel(lat=slice(None, None, stride), lon=slice(None, None, stride))

    # Load and reshape to long format
    kepler_df = sub[["S", "I_total", "D", "NDI_total"]].to_dataframe().reset_index()

    # Filter out all-zero rows
    nonzero_mask = (
        (kepler_df["S"] != 0)
        | (kepler_df["I_total"] != 0)
        | (kepler_df["D"] != 0)
        | (kepler_df["NDI_total"] != 0)
    )
    kepler_df = kepler_df[nonzero_mask].copy()

    # Round for file size reduction
    kepler_df["lat"] = kepler_df["lat"].round(4)
    kepler_df["lon"] = kepler_df["lon"].round(4)
    for col in ["S", "I_total", "D", "NDI_total"]:
        kepler_df[col] = kepler_df[col].round(3)
    kepler_df["time"] = kepler_df["time"].dt.strftime("%Y-%m-%d")

    # Write CSV
    kepler_df.to_csv(output_path, index=False)
    file_size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Wrote: {output_path} ({file_size_mb:.1f} MB)")


def main():
    parser = argparse.ArgumentParser(description="Process MAPS NetCDF to visualization data")
    parser.add_argument("nc_file", help="Path to MAPS NetCDF file")
    parser.add_argument("--csv", action="store_true", help="Also export Kepler.gl CSV")
    parser.add_argument("--output-dir", default="viz/data", help="Output directory for viz data")
    parser.add_argument("--variable", default="NDI_total", help="Variable to process")

    args = parser.parse_args()

    # Validate inputs
    nc_path = Path(args.nc_file)
    if not nc_path.exists():
        print(f"Error: {nc_path} not found", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Process
    try:
        ds = load_netcdf(nc_path, variable=args.variable)
        data_info = downsample_and_quantize(ds, variable=args.variable, stride=8, quant_scale=100)
        generate_metadata(data_info, output_dir, variable=args.variable)
        generate_binary_lookup(data_info, output_dir, variable=args.variable)

        if args.csv:
            csv_path = nc_path.parent / (nc_path.stem + ".csv")
            export_kepler_csv(ds, csv_path)

        print("\n✓ Processing complete!")
        print(f"  Grid: {data_info['n_lat']} lat × {data_info['n_lon']} lon")
        print(f"  Time steps: {data_info['n_time']}")
        print(f"  Value range: {data_info['vmin']:.3f} to {data_info['vmax']:.3f}")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
