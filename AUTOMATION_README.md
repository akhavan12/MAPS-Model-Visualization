# Automation Setup Summary

You now have a complete automated workflow for updating your MAPS visualization with new data. Here's what was created:

---

## Files Created

### Configuration & Scripts

| File | Purpose |
|------|---------|
| **`automation.md`** | Configuration file—edit this to set your NC file path |
| **`update_visualization.sh`** | Main automation script—run this to update everything |
| **`process_maps_data.py`** | Python processor that does the data work |
| **`AUTOMATION_GUIDE.md`** | Detailed guide with examples and troubleshooting |
| **`DATA_FLOW_EXPLANATION.md`** | Deep dive into how data flows (educational) |

---

## Quick Start (2 minutes)

### 1. Set up once (first time only)

```bash
# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install xarray pandas numpy dask netcdf4 h5netcdf

# Make script executable (should already be done)
chmod +x update_visualization.sh

# Verify git is configured
git config --list | grep user
# If not set:
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

### 2. Every time you have new data

```bash
# Edit automation.md with your NC file path
nano automation.md
# Change: NC_FILE_PATH=/path/to/your/new/file.nc

# Run the automation
./update_visualization.sh
```

Done! Your visualization is updated and pushed to GitHub.

---

## File Descriptions

### `automation.md`
**What it is:** Configuration file  
**What to edit:** The `NC_FILE_PATH` variable  
**When:** Every time before running the script  
**Example:**
```
NC_FILE_PATH=/Users/amirakhavan/Documents/data/maps_output_SC05_07_26_2026.nc
```

### `update_visualization.sh`
**What it is:** Main automation orchestrator (bash script)  
**What it does:**
1. Reads NC file path from `automation.md`
2. Calls `process_maps_data.py`
3. Commits changes to git
4. Pushes to GitHub

**How to run:**
```bash
./update_visualization.sh
```

### `process_maps_data.py`
**What it is:** Data processing engine (Python)  
**What it does:**
- Loads NetCDF file with xarray + dask
- Downsamples grid (stride=8)
- Quantizes values to int16
- Generates binary lookup table (`viz/data/ndi_lookup.bin`)
- Generates metadata JSON (`viz/data/meta.json`)

**Can be run standalone:**
```bash
python3 process_maps_data.py /path/to/file.nc
```

### `AUTOMATION_GUIDE.md`
**What it is:** Comprehensive guide  
**Contains:**
- Step-by-step instructions
- Workflow examples
- Troubleshooting section
- Advanced usage options
- CI/CD integration examples

### `DATA_FLOW_EXPLANATION.md`
**What it is:** Educational documentation  
**Contains:**
- How data flows from NC → CSV → web app
- What each file does
- Architecture decisions and why

---

## What Gets Updated

When you run the automation, these files change:

```
viz/data/
├── ndi_lookup.bin      ← Updated (binary lookup table)
├── meta.json           ← Updated (metadata + color schemes)
└── topo/               ← No change (static geography)
```

Both updated files are committed and pushed to GitHub.

---

## Typical Output

```
=== MAPS Visualization Update ===

Configuration:
  NC file: /Users/amirakhavan/data/maps_output_2026_12_31.nc
  Output dir: viz/data

Checking dependencies...
Processing NetCDF data...
Loading NetCDF: /Users/amirakhavan/data/maps_output_2026_12_31.nc
Downsampling with stride=8...
Computing statistics...
Value range: 0.000000 to 185.234567
Quantizing to int16...
Generating metadata...
Generating binary lookup...
Wrote: viz/data/ndi_lookup.bin (28.5 MB)

✓ Processing complete!
  Grid: 389 lat × 879 lon
  Time steps: 42
  Value range: 0.000 to 185.235

Git status:
 M viz/data/meta.json
 M viz/data/ndi_lookup.bin

Committing changes...
[main a1b2c3d] Update visualization data from maps_output_2026_12_31
 2 files changed, 1234 insertions(+), 1234 deletions(-)

Pushing to GitHub...
[main ...] Push successful

✓ Pushed to GitHub!

Next steps:
  1. Visit: https://github.com/username/MAPS-NCDF
  2. Verify the changes were pushed
  3. Check the live visualization
```

---

## Troubleshooting Quick Links

| Problem | Solution |
|---------|----------|
| `NC_FILE_PATH not set` | Edit `automation.md` and add the path |
| `ModuleNotFoundError` | Run `pip install xarray pandas numpy dask` |
| `permission denied` | Run `chmod +x update_visualization.sh` |
| `git: not a git repository` | Make sure you're in the project directory |
| Processing is slow | Normal for large files; ~5-15 min depending on size |

See `AUTOMATION_GUIDE.md` for more detailed troubleshooting.

---

## Next Steps

1. **First run:**
   - Edit `automation.md` with your NC file path
   - Run `./update_visualization.sh`
   - Verify changes appear on GitHub

2. **Automate further (optional):**
   - Set up GitHub Actions (see `AUTOMATION_GUIDE.md`)
   - Schedule automated daily/weekly updates
   - Trigger from external pipeline

3. **Learn more:**
   - Read `DATA_FLOW_EXPLANATION.md` to understand the architecture
   - Review `AUTOMATION_GUIDE.md` for advanced options

---

## Support

- **How to use?** → See `AUTOMATION_GUIDE.md`
- **How does it work?** → See `DATA_FLOW_EXPLANATION.md`
- **Specific error?** → Check troubleshooting in `AUTOMATION_GUIDE.md`
