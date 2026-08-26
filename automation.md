# MAPS Visualization Automation Configuration

**ACTIVE NC FILE PATH:**

```
NC_FILE_PATH=/Users/amirakhavan/Documents/Projects/MAPS-NCDF/maps_output_SC05_07_26_2026.nc
```

---

## How to use:

1. Edit the `NC_FILE_PATH` above to point to your new NC file
2. Run: `./update_visualization.sh`
3. Done! Your visualization is updated and pushed to GitHub

---

## What happens:

✓ Loads the NetCDF file (lazy loading, memory-efficient)  
✓ Extracts and downsamples the `NDI_total` variable (every 8th grid cell)  
✓ Generates `viz/data/ndi_lookup.bin` (binary lookup for point queries)  
✓ Generates `viz/data/meta.json` (metadata + color scheme definitions)  
✓ Commits changes to git  
✓ Pushes to GitHub  

**Time:** ~5-15 minutes depending on file size

---

## Requirements:

- Python 3.7+ with: `xarray`, `pandas`, `numpy`, `dask`
- Git configured
- GitHub push access

See `AUTOMATION_GUIDE.md` for help.
