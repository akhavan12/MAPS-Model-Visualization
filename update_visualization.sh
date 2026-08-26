#!/bin/bash
# Update MAPS visualization data and push to GitHub
#
# Usage:
#   ./update_visualization.sh
#
# Configuration: Edit automation.md to set NC_FILE_PATH

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== MAPS Visualization Update ===${NC}\n"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtual environment if it exists
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

# Read NC file path from automation.md
NC_FILE_PATH=$(grep "^NC_FILE_PATH=" automation.md | cut -d'=' -f2 | xargs)

if [ -z "$NC_FILE_PATH" ]; then
    echo -e "${RED}Error: NC_FILE_PATH not set in automation.md${NC}"
    exit 1
fi

# Expand ~ and environment variables
NC_FILE_PATH=$(eval echo "$NC_FILE_PATH")

if [ ! -f "$NC_FILE_PATH" ]; then
    echo -e "${RED}Error: NC file not found: $NC_FILE_PATH${NC}"
    exit 1
fi

echo -e "${BLUE}Configuration:${NC}"
echo "  NC file: $NC_FILE_PATH"
echo "  Output dir: viz/data"
echo ""

# Check for required Python packages
echo -e "${BLUE}Checking dependencies...${NC}"
python3 -c "import xarray; import pandas; import numpy" 2>/dev/null || {
    echo -e "${RED}Error: Required Python packages missing (xarray, pandas, numpy)${NC}"
    echo "Install with: pip install xarray pandas numpy dask"
    exit 1
}

# Run processing
echo -e "${BLUE}Processing NetCDF data...${NC}"
python3 process_maps_data.py "$NC_FILE_PATH" || {
    echo -e "${RED}Error: Data processing failed${NC}"
    exit 1
}

echo ""

# Check git status
echo -e "${BLUE}Git status:${NC}"
git status --short

echo ""

# Commit changes
if git diff --quiet && git diff --cached --quiet; then
    echo -e "${BLUE}No changes to commit.${NC}"
else
    echo -e "${BLUE}Committing changes...${NC}"

    # Get date and source file name
    SOURCE_FILE=$(basename "$NC_FILE_PATH" .nc)
    COMMIT_MSG="Update visualization data from $SOURCE_FILE"

    git add viz/data/
    git commit -m "$COMMIT_MSG"

    # Push to GitHub
    echo -e "${BLUE}Pushing to GitHub...${NC}"
    git push origin main

    echo -e "${GREEN}✓ Pushed to GitHub!${NC}"
fi

echo ""
echo -e "${GREEN}=== Update Complete ===${NC}"
echo ""
echo "Next steps:"
echo "  1. Visit: https://github.com/$(git config --get remote.origin.url | grep -oP '(?<=github.com:)[^/]+/[^/]+(?=\.git)' || echo 'user/repo')"
echo "  2. Verify the changes were pushed"
echo "  3. Check the live visualization"
