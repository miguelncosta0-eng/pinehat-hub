window.Hub = window.Hub || {};

/**
 * Draw a line chart on a canvas element.
 * @param {HTMLCanvasElement} canvas
 * @param {Array} datasets - [{ label, data: [{date, value}], color }]
 * @param {Object} options - { timeRange, formatValue, height }
 */
Hub.drawLineChart = function (canvas, datasets, options = {}) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const W = rect.width;
  const H = options.height || 280;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Filter by time range
  const rangeDays = { '7D': 7, '30D': 30, '3M': 90, '6M': 180, '1Y': 365 };
  const days = rangeDays[options.timeRange] || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const filtered = datasets.map((ds) => ({
    ...ds,
    data: ds.data.filter((d) => d.date >= cutoffStr).sort((a, b) => a.date.localeCompare(b.date)),
  }));

  const allValues = filtered.flatMap((ds) => ds.data.map((d) => d.value));
  const allDates = [...new Set(filtered.flatMap((ds) => ds.data.map((d) => d.date)))].sort();

  // Clear
  ctx.clearRect(0, 0, W, H);

  if (allValues.length === 0 || allDates.length === 0) {
    ctx.fillStyle = '#5a5a5f';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sem dados neste intervalo', W / 2, H / 2);
    return;
  }

  // Y scale
  let yMin = Math.min(...allValues);
  let yMax = Math.max(...allValues);
  const yRange = yMax - yMin || 1;
  yMin = Math.max(0, yMin - yRange * 0.1);
  yMax = yMax + yRange * 0.1;
  const yTicks = Hub._niceAxisTicks(yMin, yMax, 5);

  const fmtVal = options.formatValue || Hub._fmtNum;
  const font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  // Grid lines + Y labels
  ctx.strokeStyle = '#252528';
  ctx.lineWidth = 1;
  ctx.font = font;

  yTicks.forEach((tick) => {
    const y = PAD.top + chartH - ((tick - yMin) / (yMax - yMin)) * chartH;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(W - PAD.right, y);
    ctx.stroke();

    ctx.fillStyle = '#5a5a5f';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtVal(tick), PAD.left - 8, y);
  });

  // X labels
  const labelCount = Math.min(allDates.length, 7);
  const labelStep = Math.max(1, Math.floor((allDates.length - 1) / (labelCount - 1 || 1)));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#5a5a5f';

  for (let i = 0; i < allDates.length; i += labelStep) {
    const x = PAD.left + (allDates.length === 1 ? chartW / 2 : (i / (allDates.length - 1)) * chartW);
    const d = new Date(allDates[i] + 'T00:00:00');
    const label = d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
    ctx.fillText(label, x, H - PAD.bottom + 10);
  }

  // Draw datasets
  filtered.forEach((ds) => {
    if (ds.data.length === 0) return;

    const points = ds.data.map((d) => {
      const dateIdx = allDates.indexOf(d.date);
      const x = PAD.left + (allDates.length === 1 ? chartW / 2 : (dateIdx / (allDates.length - 1)) * chartW);
      const y = PAD.top + chartH - ((d.value - yMin) / (yMax - yMin)) * chartH;
      return { x, y, date: d.date, value: d.value };
    });

    // Area fill
    const gradient = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
    gradient.addColorStop(0, ds.color + '33');
    gradient.addColorStop(1, ds.color + '00');

    ctx.beginPath();
    ctx.moveTo(points[0].x, PAD.top + chartH);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, PAD.top + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = ds.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();

    // Points
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = ds.color;
      ctx.fill();
      ctx.strokeStyle = '#0D0D0F';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  });

  // Store data for tooltips
  canvas._chartData = { filtered, allDates, yMin, yMax, PAD, chartW, chartH, fmtVal };

  if (canvas._chartMouseMove) {
    canvas.removeEventListener('mousemove', canvas._chartMouseMove);
    canvas.removeEventListener('mouseleave', canvas._chartMouseLeave);
  }

  canvas._chartMouseMove = function (e) {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const cd = canvas._chartData;

    const xRatio = (mx - cd.PAD.left) / cd.chartW;
    const dateIdx = Math.round(xRatio * (cd.allDates.length - 1));

    if (dateIdx < 0 || dateIdx >= cd.allDates.length) {
      Hub._hideChartTooltip(canvas);
      return;
    }

    const date = cd.allDates[dateIdx];
    const x = cd.PAD.left + (cd.allDates.length === 1 ? cd.chartW / 2 : (dateIdx / (cd.allDates.length - 1)) * cd.chartW);

    const values = cd.filtered.map((ds) => {
      const point = ds.data.find((d) => d.date === date);
      return { label: ds.label, value: point ? cd.fmtVal(point.value) : '--', color: ds.color };
    });

    Hub._showChartTooltip(canvas, x, e.clientY - r.top, date, values);
  };

  canvas._chartMouseLeave = function () {
    Hub._hideChartTooltip(canvas);
  };

  canvas.addEventListener('mousemove', canvas._chartMouseMove);
  canvas.addEventListener('mouseleave', canvas._chartMouseLeave);
};

Hub._niceAxisTicks = function (min, max, count) {
  const range = max - min;
  const roughStep = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;

  let step;
  if (norm <= 1.5) step = 1 * mag;
  else if (norm <= 3) step = 2 * mag;
  else if (norm <= 7) step = 5 * mag;
  else step = 10 * mag;

  const ticks = [];
  let tick = Math.ceil(min / step) * step;
  while (tick <= max) {
    ticks.push(tick);
    tick += step;
  }
  return ticks;
};

Hub._showChartTooltip = function (canvas, x, y, date, values) {
  let tip = canvas.parentElement.querySelector('.chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    canvas.parentElement.appendChild(tip);
  }

  const d = new Date(date + 'T00:00:00');
  const dateStr = d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });

  tip.innerHTML = `
    <div class="chart-tooltip-date">${dateStr}</div>
    ${values.map((v) => `
      <div class="chart-tooltip-row">
        <span class="chart-tooltip-dot" style="background:${v.color}"></span>
        <span>${v.label}:</span>
        <strong>${v.value}</strong>
      </div>
    `).join('')}
  `;

  tip.style.display = 'block';
  const tipW = tip.offsetWidth;
  tip.style.left = Math.min(x + 12, canvas.clientWidth - tipW - 8) + 'px';
  tip.style.top = Math.max(0, y - tip.offsetHeight / 2) + 'px';
};

Hub._hideChartTooltip = function (canvas) {
  const tip = canvas.parentElement?.querySelector('.chart-tooltip');
  if (tip) tip.style.display = 'none';
};
