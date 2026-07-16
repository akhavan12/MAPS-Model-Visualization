(async function () {
  const ASSET_V = "2"; // bump when frames/meta/topo data change, to bust browser cache
  const VIEW_W = 1400; // internal SVG coordinate width (view-space, before zoom)
  let VIEW_H;

  const svg = d3.select("#map");
  const mapWrap = document.getElementById("map-wrap");
  const dateLabel = document.getElementById("date-label");
  const tooltip = d3.select("#tooltip");
  const legendEl = document.getElementById("legend");
  const playBtn = document.getElementById("play-btn");
  const resetZoomBtn = document.getElementById("reset-zoom-btn");
  const slider = document.getElementById("time-slider");
  const timeIdxLabel = document.getElementById("time-index-label");
  const speedSelect = document.getElementById("speed-select");

  // ---- load metadata + lookup binary + boundaries ----
  const meta = await fetch(`data/meta.json?v=${ASSET_V}`).then((r) => r.json());
  const lookupBuf = await fetch(`data/ndi_lookup.bin?v=${ASSET_V}`).then((r) => r.arrayBuffer());
  const lookup = new Int16Array(lookupBuf); // (time, lat, lon) row-major, lat ascending, lon ascending
  const [statesTopo, countiesTopo] = await Promise.all([
    fetch(`data/topo/states-10m.json?v=${ASSET_V}`).then((r) => r.json()),
    fetch(`data/topo/counties-10m.json?v=${ASSET_V}`).then((r) => r.json()),
  ]);

  const { n_time, n_lat, n_lon, lat, lon, time: timeStrs, quant_scale, color } = meta;

  VIEW_H = VIEW_W * (n_lat / n_lon);

  svg.attr("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`).attr("preserveAspectRatio", "xMidYMid meet");

  const zoomLayer = svg.append("g").attr("class", "zoom-layer");

  const lonMin = meta.lon_min,
    lonMax = meta.lon_max,
    latMin = meta.lat_min,
    latMax = meta.lat_max;

  // pixel (view-space) <-> lon/lat mapping
  const xToLon = (px) => lonMin + (px / VIEW_W) * (lonMax - lonMin);
  const yToLat = (py) => latMax - (py / VIEW_H) * (latMax - latMin);
  const lonToX = (lonVal) => ((lonVal - lonMin) / (lonMax - lonMin)) * VIEW_W;
  const latToY = (latVal) => ((latMax - latVal) / (latMax - latMin)) * VIEW_H;

  // ---- frame image layer ----
  const framePaths = d3.range(n_time).map(
    (t) => `frames/frame_${String(t).padStart(2, "0")}.png?v=${ASSET_V}`
  );

  // preload all frames so playback doesn't flicker/stall
  framePaths.forEach((p) => {
    const img = new Image();
    img.src = p;
  });

  const imageEl = zoomLayer
    .append("image")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", VIEW_W)
    .attr("height", VIEW_H)
    .attr("preserveAspectRatio", "none")
    .attr("href", framePaths[0]);

  // ---- state / county boundaries, aligned to the same lon/lat -> pixel mapping as the raster ----
  const geoProjection = d3.geoTransform({
    point(px, py) {
      this.stream.point(lonToX(px), latToY(py));
    },
  });
  const geoPathGen = d3.geoPath(geoProjection);

  const statesGeo = topojson.feature(statesTopo, statesTopo.objects.states);
  const countiesGeo = topojson.feature(countiesTopo, countiesTopo.objects.counties);

  const countiesLayer = zoomLayer.append("g").attr("class", "boundary-layer counties-layer");
  countiesLayer
    .selectAll("path")
    .data(countiesGeo.features)
    .join("path")
    .attr("d", geoPathGen)
    .attr("class", "county-border");

  const statesLayer = zoomLayer.append("g").attr("class", "boundary-layer states-layer");
  statesLayer
    .selectAll("path")
    .data(statesGeo.features)
    .join("path")
    .attr("d", geoPathGen)
    .attr("class", "state-border");

  // ---- location name lookup (point-in-county-polygon, bbox-prefiltered) ----
  const stateNameByFips = new Map(statesGeo.features.map((f) => [f.id, f.properties.name]));
  const countyBBoxes = countiesGeo.features.map((f) => d3.geoBounds(f));

  function findLocationName(lonVal, latVal) {
    for (let i = 0; i < countiesGeo.features.length; i++) {
      const [[bx0, by0], [bx1, by1]] = countyBBoxes[i];
      if (lonVal < bx0 || lonVal > bx1 || latVal < by0 || latVal > by1) continue;
      const f = countiesGeo.features[i];
      if (d3.geoContains(f, [lonVal, latVal])) {
        const stateName = stateNameByFips.get(f.id.slice(0, 2));
        return `${f.properties.name} County${stateName ? ", " + stateName : ""}`;
      }
    }
    return null;
  }

  const countyToggle = document.getElementById("county-toggle");
  const COUNTY_MIN_ZOOM = 3;

  function updateCountyVisibility(k) {
    const show = countyToggle.checked && k >= COUNTY_MIN_ZOOM;
    countiesLayer.style("display", show ? null : "none");
  }
  updateCountyVisibility(1);
  countyToggle.addEventListener("change", () => updateCountyVisibility(d3.zoomTransform(svg.node()).k));

  // transparent hit-rect for consistent mouse events across the whole view
  const hitRect = zoomLayer
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", VIEW_W)
    .attr("height", VIEW_H)
    .attr("fill", "transparent");

  // ---- zoom / pan ----
  const zoom = d3
    .zoom()
    .scaleExtent([1, 40])
    .translateExtent([
      [0, 0],
      [VIEW_W, VIEW_H],
    ])
    .on("zoom", (event) => {
      zoomLayer.attr("transform", event.transform);
      updateCountyVisibility(event.transform.k);
    });

  svg.call(zoom);
  svg.on("dblclick.zoom", null); // free up double-click for opening the detail modal instead of zoom

  resetZoomBtn.addEventListener("click", () => {
    svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
  });

  // ---- legend ----
  {
    const stops = color.legend_stop_colors;
    const gradientCss = `linear-gradient(to right, ${stops
      .map((c, i) => `${c} ${(100 * i) / (stops.length - 1)}%`)
      .join(", ")})`;

    legendEl.innerHTML = `
      <div class="legend-title">NDI_total (new daily infections)</div>
      <div class="legend-gradient" style="background:${gradientCss}"></div>
      <div class="legend-ticks">
        <span>0</span>
        <span>${(color.vmax / 4).toFixed(1)}</span>
        <span>${(color.vmax / 2).toFixed(1)}</span>
        <span>${color.vmax.toFixed(1)}</span>
      </div>
    `;
  }

  // ---- time state / slider / playback ----
  slider.max = n_time - 1;
  let currentT = 0;
  let playing = false;
  let timer = null;
  let tooltipLonLat = null;
  let tooltipPixel = null;

  // modal state hoisted here (not at its usage site) so setTime(0) below can safely
  // reference it before the modal section further down has run its `let` declarations
  let modalW = 0,
    modalH = 0,
    modalChartW = 0,
    modalChartH = 0;
  let modalSeries = null;
  let modalXScale = null;
  let modalYScale = null;
  let modalOpen = false;

  function setTime(t, { fromSlider = false } = {}) {
    currentT = Math.max(0, Math.min(n_time - 1, t));
    imageEl.attr("href", framePaths[currentT]);
    dateLabel.textContent = timeStrs[currentT];
    timeIdxLabel.textContent = `step ${currentT + 1} / ${n_time}`;
    if (!fromSlider) slider.value = currentT;
    if (tooltipLonLat) updateTooltipContent(tooltipLonLat.lon, tooltipLonLat.lat, tooltipPixel);
    updateModalCurrentMarker();
  }

  slider.addEventListener("input", () => setTime(+slider.value, { fromSlider: true }));

  function startPlaying() {
    playing = true;
    playBtn.textContent = "⏸";
    const speed = () => +speedSelect.value;
    clearInterval(timer);
    timer = setInterval(() => {
      let next = currentT + 1;
      if (next >= n_time) next = 0;
      setTime(next);
    }, speed());
  }

  function stopPlaying() {
    playing = false;
    playBtn.textContent = "▶";
    clearInterval(timer);
  }

  playBtn.addEventListener("click", () => (playing ? stopPlaying() : startPlaying()));
  speedSelect.addEventListener("change", () => {
    if (playing) startPlaying();
  });

  setTime(0);

  // ---- tooltip: lookup + line chart ----
  const TT_W = 240,
    TT_H = 110,
    TT_MARGIN = { top: 8, right: 8, bottom: 16, left: 30 };

  tooltip.html(`
    <div class="tt-title"></div>
    <div class="tt-coords"></div>
    <div class="tt-sub"></div>
    <svg class="tt-chart" width="${TT_W}" height="${TT_H}"></svg>
  `);
  const ttChart = tooltip.select("svg.tt-chart");
  const ttG = ttChart.append("g").attr("transform", `translate(${TT_MARGIN.left},${TT_MARGIN.top})`);
  const chartW = TT_W - TT_MARGIN.left - TT_MARGIN.right;
  const chartH = TT_H - TT_MARGIN.top - TT_MARGIN.bottom;

  const xAxisG = ttG.append("g").attr("class", "tt-chart-axis").attr("transform", `translate(0,${chartH})`);
  const yAxisG = ttG.append("g").attr("class", "tt-chart-axis");
  const linePath = ttG.append("path").attr("class", "tt-line");
  const cursorLine = ttG.append("line").attr("class", "tt-cursor");
  const cursorDot = ttG.append("circle").attr("class", "tt-dot").attr("r", 2.5);

  const xScaleChart = d3.scaleLinear().domain([0, n_time - 1]).range([0, chartW]);

  function nearestIndex(value, minV, maxV, n) {
    const frac = (value - minV) / (maxV - minV);
    return Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
  }

  function getSeries(latIdx, lonIdx) {
    const series = new Array(n_time);
    const stride = n_lat * n_lon;
    for (let t = 0; t < n_time; t++) {
      series[t] = lookup[t * stride + latIdx * n_lon + lonIdx] / quant_scale;
    }
    return series;
  }

  function getPointData(lonVal, latVal) {
    const lonIdx = nearestIndex(lonVal, lonMin, lonMax, n_lon);
    const latIdx = nearestIndex(latVal, latMin, latMax, n_lat);
    const series = getSeries(latIdx, lonIdx);
    const locationName = findLocationName(lonVal, latVal);
    const coordsStr = `${latVal.toFixed(2)}°N, ${lonVal.toFixed(2)}°E`;
    return { lonIdx, latIdx, series, locationName, coordsStr };
  }

  function updateTooltipContent(lonVal, latVal, pixel) {
    const { series, locationName, coordsStr } = getPointData(lonVal, latVal);
    const currentVal = series[currentT];

    tooltip.select(".tt-title").text(locationName || coordsStr);
    tooltip.select(".tt-coords").text(locationName ? coordsStr : "");
    tooltip
      .select(".tt-sub")
      .html(`${timeStrs[currentT]} · <span class="tt-value">${currentVal.toFixed(3)}</span>`);

    const yMax = Math.max(1e-6, d3.max(series));
    const yScaleChart = d3.scaleLinear().domain([0, yMax]).range([chartH, 0]).nice();

    const line = d3
      .line()
      .x((d, i) => xScaleChart(i))
      .y((d) => yScaleChart(d));

    linePath.datum(series).attr("d", line);

    xAxisG.call(
      d3
        .axisBottom(xScaleChart)
        .ticks(4)
        .tickFormat((i) => timeStrs[i] ? timeStrs[Math.round(i)].slice(5) : "")
    );
    yAxisG.call(d3.axisLeft(yScaleChart).ticks(3));

    cursorLine
      .attr("x1", xScaleChart(currentT))
      .attr("x2", xScaleChart(currentT))
      .attr("y1", 0)
      .attr("y2", chartH);
    cursorDot.attr("cx", xScaleChart(currentT)).attr("cy", yScaleChart(currentVal));

    // position tooltip near cursor, staying inside map-wrap
    const wrapRect = mapWrap.getBoundingClientRect();
    let left = pixel.clientX - wrapRect.left + 16;
    let top = pixel.clientY - wrapRect.top + 16;
    const ttRect = { w: TT_W + 24, h: TT_H + 74 };
    if (left + ttRect.w > wrapRect.width) left = pixel.clientX - wrapRect.left - ttRect.w - 12;
    if (top + ttRect.h > wrapRect.height) top = pixel.clientY - wrapRect.top - ttRect.h - 12;
    tooltip.style("left", `${left}px`).style("top", `${top}px`);
  }

  function handlePointer(event) {
    const [mx, my] = d3.pointer(event, zoomLayer.node());
    if (mx < 0 || my < 0 || mx > VIEW_W || my > VIEW_H) {
      tooltip.classed("hidden", true);
      tooltipLonLat = null;
      return;
    }
    const lonVal = xToLon(mx);
    const latVal = yToLat(my);
    tooltipLonLat = { lon: lonVal, lat: latVal };
    tooltipPixel = { clientX: event.clientX, clientY: event.clientY };
    tooltip.classed("hidden", false);
    updateTooltipContent(lonVal, latVal, tooltipPixel);
  }

  svg.on("mousemove", handlePointer);
  svg.on("mouseleave", () => {
    tooltip.classed("hidden", true);
    tooltipLonLat = null;
  });

  // ---- expanded detail modal (double-click a point to open) ----
  const modal = d3.select("#detail-modal");
  const modalChart = d3.select("#modal-chart");
  const modalCloseBtn = document.getElementById("modal-close-btn");

  const MODAL_MARGIN = { top: 12, right: 16, bottom: 26, left: 44 };

  const modalG = modalChart.append("g");
  const modalXAxisG = modalG.append("g").attr("class", "modal-axis");
  const modalYAxisG = modalG.append("g").attr("class", "modal-axis");
  const modalArea = modalG.append("path").attr("class", "modal-area");
  const modalLine = modalG.append("path").attr("class", "modal-line");
  const modalCurrentMarker = modalG.append("line").attr("class", "modal-current-marker");
  const modalHoverMarker = modalG.append("line").attr("class", "modal-hover-marker").style("display", "none");
  const modalHoverDot = modalG.append("circle").attr("class", "modal-hover-dot").attr("r", 3.5).style("display", "none");
  const modalHoverLabelBg = modalG.append("rect").attr("class", "modal-hover-label-bg").style("display", "none");
  const modalHoverLabel = modalG.append("text").attr("class", "modal-hover-label").style("display", "none");
  const modalOverlay = modalG.append("rect").attr("fill", "transparent");

  function measureModal() {
    const rect = modalChart.node().getBoundingClientRect();
    modalW = rect.width;
    modalH = rect.height;
    modalChartW = modalW - MODAL_MARGIN.left - MODAL_MARGIN.right;
    modalChartH = modalH - MODAL_MARGIN.top - MODAL_MARGIN.bottom;
    modalChart.attr("viewBox", `0 0 ${modalW} ${modalH}`);
    modalG.attr("transform", `translate(${MODAL_MARGIN.left},${MODAL_MARGIN.top})`);
  }

  function drawModalChart() {
    if (!modalSeries) return;
    measureModal();

    modalXScale = d3.scaleLinear().domain([0, n_time - 1]).range([0, modalChartW]);
    const yMax = Math.max(1e-6, d3.max(modalSeries));
    modalYScale = d3.scaleLinear().domain([0, yMax]).range([modalChartH, 0]).nice();

    const line = d3
      .line()
      .x((d, i) => modalXScale(i))
      .y((d) => modalYScale(d));
    const area = d3
      .area()
      .x((d, i) => modalXScale(i))
      .y0(modalChartH)
      .y1((d) => modalYScale(d));

    modalLine.datum(modalSeries).attr("d", line);
    modalArea.datum(modalSeries).attr("d", area);

    modalXAxisG
      .attr("transform", `translate(0,${modalChartH})`)
      .call(
        d3
          .axisBottom(modalXScale)
          .ticks(7)
          .tickFormat((i) => (timeStrs[Math.round(i)] ? timeStrs[Math.round(i)] : ""))
      );
    modalYAxisG.call(d3.axisLeft(modalYScale).ticks(5));

    modalOverlay.attr("width", modalChartW).attr("height", modalChartH);

    updateModalCurrentMarker();
  }

  function updateModalCurrentMarker() {
    if (!modalOpen || !modalXScale) return;
    const x = modalXScale(currentT);
    modalCurrentMarker.attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", modalChartH);
  }

  function openModal(lonVal, latVal) {
    const { series, locationName, coordsStr } = getPointData(lonVal, latVal);
    modalSeries = series;
    d3.select(".modal-title").text(locationName || coordsStr);
    d3.select(".modal-coords").text(locationName ? coordsStr : "");
    modal.classed("hidden", false);
    modalOpen = true;
    drawModalChart();
  }

  function closeModal() {
    modalOpen = false;
    modal.classed("hidden", true);
  }

  modalCloseBtn.addEventListener("click", closeModal);
  modal.on("click", (event) => {
    if (event.target.id === "detail-modal") closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalOpen) closeModal();
  });
  window.addEventListener("resize", () => {
    if (modalOpen) drawModalChart();
  });

  modalOverlay
    .on("mousemove", (event) => {
      if (!modalSeries || !modalXScale) return;
      const [mx] = d3.pointer(event, modalOverlay.node());
      const idx = Math.max(0, Math.min(n_time - 1, Math.round(modalXScale.invert(mx))));
      const val = modalSeries[idx];
      const x = modalXScale(idx);
      const y = modalYScale(val);

      modalHoverMarker.attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", modalChartH).style("display", null);
      modalHoverDot.attr("cx", x).attr("cy", y).style("display", null);

      const labelText = `${timeStrs[idx]} · ${val.toFixed(3)}`;
      modalHoverLabel.text(labelText).style("display", null);
      const bbox = modalHoverLabel.node().getBBox();
      const padX = 5,
        padY = 3;
      let labelX = x + 8;
      if (labelX + bbox.width + padX * 2 > modalChartW) labelX = x - bbox.width - padX * 2 - 8;
      const labelY = Math.max(0, y - bbox.height - padY);

      modalHoverLabel.attr("x", labelX + padX).attr("y", labelY + bbox.height);
      modalHoverLabelBg
        .attr("x", labelX)
        .attr("y", labelY)
        .attr("width", bbox.width + padX * 2)
        .attr("height", bbox.height + padY * 2)
        .attr("rx", 4)
        .style("display", null);
    })
    .on("mouseleave", () => {
      modalHoverMarker.style("display", "none");
      modalHoverDot.style("display", "none");
      modalHoverLabel.style("display", "none");
      modalHoverLabelBg.style("display", "none");
    });

  function handleDoubleClick(event) {
    const [mx, my] = d3.pointer(event, zoomLayer.node());
    if (mx < 0 || my < 0 || mx > VIEW_W || my > VIEW_H) return;
    openModal(xToLon(mx), yToLat(my));
  }

  svg.on("dblclick", handleDoubleClick);
})();
