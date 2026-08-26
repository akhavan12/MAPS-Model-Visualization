# MAPS Visualization Automation Guide

This guide explains how to automate updating the visualization when you have a new MAPS NetCDF output file.

---

## Quick Start

### 1. Update Configuration

Edit `automation.md` and set the path to your new NC file:

```bash
# Open automation.md
nano automation.md
```

Change this line:
```
NC_FILE_PATH=/path/to/maps_output_XXXXX.nc
```

to point to your actual file. Example:
```
NC_FILE_PATH=/Users/amirakhavan/Documents/data/maps_output_SC05_07_26_2026.nc
```

### 2. Run the Automation

```bash
./update_visualization.sh
```

This will:
1. ✓ Load and process the NetCDF file
2. ✓ Generate `viz/data/ndi_lookup.bin` (binary lookup table)
3. ✓ Generate `viz/data/meta.json` (metadata + color schemes)
4. ✓ Commit changes to git
5. ✓ Push to GitHub

Done! Your visualization is now updated.

---

## What Each File Does

### `automation.md`
Configuration file specifying which NC file to process. This is the **only file you need to edit** before running automation.

### `update_visualization.sh`
Main automation script. Orchestrates the entire workflow:
- Reads the NC file path from `automation.md`
- Calls Python processing script
- Handles git commit and push

Run with:
```bash
./update_visualization.sh
```

### `process_maps_data.py`
Python script that does the heavy lifting:
- Loads NetCDF file using xarray + dask
- Downsamples data (every 8th grid cell)
- Quantizes values to int16 (saves space)
- Generates binary lookup table (`ndi_lookup.bin`)
- Generates metadata JSON (`meta.json`)

Can also be run manually:
```bash
python3 process_maps_data.py /path/to/file.nc
```

---

## Prerequisites

### Python Packages

Install required dependencies:

```bash
pip install xarray pandas numpy dask
```

Verify installation:
```bash
python3 -c "import xarray, pandas, numpy; print('✓ All packages installed')"
```

### Git Configuration

Ensure git is configured with your credentials:

```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

### GitHub Access

The script will push to GitHub. Ensure:
- You have a GitHub remote configured: `git remote -v`
- You have push permissions to the repository
- SSH key or credentials are set up (for `git push` to work)

Check your remote:
```bash
git remote -v
# Should show: origin https://github.com/username/MAPS-NCDF.git (fetch)
#              origin https://github.com/username/MAPS-NCDF.git (push)
```

---

## Workflow Example

### Scenario: New NC file arrives

```bash
# 1. Copy or note the path to new NC file
# Example: /Users/amirakhavan/data/maps_output_NEW_2026_12_31.nc

# 2. Edit configuration
nano automation.md
# Change: NC_FILE_PATH=/Users/amirakhavan/data/maps_output_NEW_2026_12_31.nc

# 3. Run automation
./update_visualization.sh

# Output:
# === MAPS Visualization Update ===
# Configuration:
#   NC file: /Users/amirakhavan/data/maps_output_NEW_2026_12_31.nc
#   Output dir: viz/data
# 
# Checking dependencies...
# Processing NetCDF data...
# Loading NetCDF: ...
# Downsampling with stride=8...
# Computing statistics...
# Value range: 0.000000 to 185.234567
# Quantizing to int16...
# Generating metadata...
# Generating binary lookup...
# Wrote: viz/data/ndi_lookup.bin (28.5 MB)
# 
# ✓ Processing complete!
#   Grid: 389 lat × 879 lon
#   Time steps: 42
#   Value range: 0.000 to 185.235
# 
# Git status:
#  M viz/data/meta.json
#  M viz/data/ndi_lookup.bin
# 
# Committing changes...
# [main a1b2c3d] Update visualization data from maps_output_NEW_2026_12_31
#  2 files changed, ...
# 
# Pushing to GitHub...
# [main ...] Push successful
# 
# ✓ Pushed to GitHub!
```

### 4. Verify

The visualization will be automatically updated on the live site (if deployed via GitHub Pages or CI/CD).

---

## Troubleshooting

### "NC_FILE_PATH not set in automation.md"

**Solution**: Edit `automation.md` and add the NC file path:
```bash
nano automation.md
```

### "NC file not found"

**Possible causes**:
- File path is wrong or incomplete
- File doesn't exist at that location
- Path uses `~` but needs full path

**Solution**: Use absolute path and verify it exists:
```bash
ls -lh /full/path/to/file.nc
```

### "ModuleNotFoundError: No module named 'xarray'"

**Solution**: Install dependencies:
```bash
pip install xarray pandas numpy dask
```

### "fatal: not a git repository"

**Solution**: Make sure you're in the project directory:
```bash
cd /Users/amirakhavan/Documents/Projects/MAPS-NCDF
```

### "permission denied: ./update_visualization.sh"

**Solution**: Make script executable:
```bash
chmod +x update_visualization.sh
```

### "fatal: 'origin' does not appear to be a 'git' repository"

**Solution**: Ensure git remote is configured:
```bash
git remote add origin https://github.com/username/MAPS-NCDF.git
```

### Processing takes too long or runs out of memory

**Cause**: NC file is very large

**Solutions**:
- Ensure you have at least 16 GB free RAM
- Close other applications
- File will be processed in chunks by dask, but initial load and processing are memory-intensive

---

## Manual Steps (Advanced)

If you need more control, run steps individually:

### Step 1: Process NC file only (no git)

```bash
python3 process_maps_data.py /path/to/file.nc
```

### Step 2: Check what changed

```bash
git status
git diff viz/data/
```

### Step 3: Commit manually

```bash
git add viz/data/
git commit -m "Update visualization data from [file name]"
git push origin main
```

---

## Output Files Explained

After running the automation, two files in `viz/data/` are updated:

### `ndi_lookup.bin` (~28-30 MB)

Binary lookup table for point queries:
- Format: Raw int16 array (row-major)
- Layout: `[time_steps, lat, lon]`
- Quantization: Values × 100 (reversed by dividing by `quant_scale` in app)
- Use: Fast retrieval of NDI values for any location and time step
- Used by: Tooltip hover and detail modal charts

### `meta.json` (~30 KB)

Metadata describing the visualization:
- Grid dimensions (n_lat, n_lon, n_time)
- All latitude/longitude values
- All time step date strings
- Geographic bounds (lat_min, lat_max, lon_min, lon_max)
- Color scheme definitions (colors, legend stops, gamma correction)
- Configuration constants

Used by: Web app (`viz/app.js`) for setup and rendering

---

## Integration with CI/CD (Optional)

For fully automated updates (e.g., triggered by a cron job or webhook):

### GitHub Actions Example

Create `.github/workflows/update-viz.yml`:

```yaml
name: Update Visualization

on:
  workflow_dispatch:  # Manual trigger
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: pip install xarray pandas numpy dask
      
      - name: Extract NC path from automation.md
        id: config
        run: |
          NC_PATH=$(grep "^NC_FILE_PATH=" automation.md | cut -d'=' -f2 | xargs)
          echo "nc_file=$NC_PATH" >> $GITHUB_OUTPUT
      
      - name: Process data
        run: python3 process_maps_data.py ${{ steps.config.outputs.nc_file }}
      
      - name: Commit and push
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add viz/data/
          git commit -m "Auto-update visualization data" || echo "No changes"
          git push
```

---

## Questions?

- **Data flow details**: See `DATA_FLOW_EXPLANATION.md`
- **Visualization architecture**: See `viz/app.js` comments
- **Notebook processing**: See `maps_output_exploration.ipynb`
