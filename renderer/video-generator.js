// ═══════════════════════════════════════════════════════════
// Video Generator — B-Roll + Remotion Motion Graphics
// ═══════════════════════════════════════════════════════════

Hub.renderVideoGenerator = async function () {
  const panel = document.getElementById('panel-video-generator');
  if (!panel) return;

  const vg = Hub.state.videoGenerator || {};
  const series = await window.api.getSeries();
  const settings = Hub.state.settings || {};

  panel.innerHTML = `
    <div class="section-header"><h2>Video Generator</h2></div>
    <div class="section-content" style="padding:24px;max-width:700px;margin:0 auto;">

      <div class="form-group">
        <label class="form-label">Voiceover (áudio)</label>
        <div style="display:flex;gap:8px;">
          <input class="input" id="vgVoiceover" value="${Hub._escHtml(vg.voiceoverPath || '')}" placeholder="Nenhum ficheiro selecionado" readonly style="flex:1;">
          <button class="btn btn-secondary" id="vgChooseVoiceover">Escolher</button>
        </div>
      </div>

      <div class="form-group" style="margin-top:16px;">
        <label class="form-label">Séries (fontes de vídeo)</label>
        <div id="vgSeriesTags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
          ${(vg.seriesIds || []).map(id => {
            const s = series.find(x => x.id === id);
            return s ? `<span class="tag" style="background:var(--accent);color:white;padding:4px 10px;border-radius:12px;font-size:12px;">${Hub._escHtml(s.name)} (${s.episodes?.length || 0} ep.) <span class="vg-remove-series" data-id="${id}" style="cursor:pointer;margin-left:4px;">✕</span></span>` : '';
          }).join('')}
        </div>
        <div style="display:flex;gap:8px;">
          <select class="input" id="vgSeriesSelect" style="flex:1;">
            <option value="">-- Adicionar série --</option>
            ${series.filter(s => !(vg.seriesIds || []).includes(s.id)).map(s =>
              `<option value="${s.id}">${Hub._escHtml(s.name)} (${s.episodes?.length || 0} episódios)</option>`
            ).join('')}
          </select>
          <button class="btn btn-secondary" id="vgAddSeries">Adicionar</button>
        </div>
      </div>

      <div style="display:flex;gap:16px;margin-top:16px;">
        <div class="form-group" style="flex:1;">
          <label class="form-label">Clip (seg)</label>
          <input class="input" id="vgClipDuration" type="number" value="${vg.clipDuration || 5}" min="2" max="15">
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label">Saltar início (seg)</label>
          <input class="input" id="vgSkipStart" type="number" value="${vg.skipStart || 30}" min="0">
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label">Saltar fim (seg)</label>
          <input class="input" id="vgSkipEnd" type="number" value="${vg.skipEnd || 20}" min="0">
        </div>
      </div>

      <div class="form-group" style="margin-top:16px;">
        <label class="form-label">Motion Graphics a cada (min)</label>
        <input class="input" id="vgMgInterval" type="number" value="${vg.mgInterval || 5}" min="1" max="30" style="width:100px;">
        <span style="color:var(--text-secondary);font-size:12px;margin-left:8px;">minutos</span>
      </div>

      <div class="form-group" style="margin-top:16px;">
        <label class="form-label">Pasta de saída</label>
        <div style="display:flex;gap:8px;">
          <input class="input" id="vgOutputFolder" value="${Hub._escHtml(vg.outputFolder || settings.defaultOutputFolder || '')}" placeholder="Automático" style="flex:1;" readonly>
          <button class="btn btn-secondary" id="vgChooseOutput">Escolher</button>
        </div>
      </div>

      <hr style="border-color:#ffffff10;margin:24px 0;">

      <button class="btn btn-primary" id="vgGenerate" style="width:100%;padding:14px;font-size:16px;"
        ${vg.generating ? 'disabled' : ''}>
        ${vg.generating ? '<span class="spinner"></span> A gerar...' : '🎬 Gerar Vídeo'}
      </button>

      ${vg.generating ? `
        <div style="margin-top:16px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span id="vgProgressDetail" style="font-size:12px;color:var(--text-secondary);">${vg.progressDetail || 'A preparar...'}</span>
            <span id="vgProgressPercent" style="font-size:12px;color:var(--accent);">${vg.progressPercent || 0}%</span>
          </div>
          <div style="height:6px;background:#ffffff10;border-radius:3px;overflow:hidden;">
            <div id="vgProgressFill" style="height:100%;background:var(--accent);border-radius:3px;width:${vg.progressPercent || 0}%;transition:width 0.3s;"></div>
          </div>
          <button class="btn btn-danger btn-small" id="vgCancel" style="margin-top:12px;">Cancelar</button>
        </div>
      ` : ''}

      ${vg.lastOutput ? `
        <div style="margin-top:16px;padding:12px;background:#ffffff08;border-radius:8px;border:1px solid #ffffff15;">
          <span style="color:#10b981;font-weight:600;">✓ Último vídeo gerado:</span>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;word-break:break-all;">${Hub._escHtml(vg.lastOutput)}</div>
        </div>
      ` : ''}
    </div>
  `;

  // Event listeners
  panel.querySelector('#vgChooseVoiceover')?.addEventListener('click', async () => {
    const filePath = await window.api.selectAudioFile();
    if (filePath) {
      if (!Hub.state.videoGenerator) Hub.state.videoGenerator = {};
      Hub.state.videoGenerator.voiceoverPath = filePath;
      document.getElementById('vgVoiceover').value = filePath;
    }
  });

  panel.querySelector('#vgAddSeries')?.addEventListener('click', () => {
    const select = document.getElementById('vgSeriesSelect');
    const id = select?.value;
    if (!id) return;
    if (!Hub.state.videoGenerator) Hub.state.videoGenerator = {};
    if (!Hub.state.videoGenerator.seriesIds) Hub.state.videoGenerator.seriesIds = [];
    if (!Hub.state.videoGenerator.seriesIds.includes(id)) {
      Hub.state.videoGenerator.seriesIds.push(id);
      Hub.renderVideoGenerator();
    }
  });

  panel.querySelectorAll('.vg-remove-series').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (Hub.state.videoGenerator?.seriesIds) {
        Hub.state.videoGenerator.seriesIds = Hub.state.videoGenerator.seriesIds.filter(x => x !== id);
        Hub.renderVideoGenerator();
      }
    });
  });

  panel.querySelector('#vgChooseOutput')?.addEventListener('click', async () => {
    const folder = await window.api.selectOutputFolder();
    if (folder) {
      if (!Hub.state.videoGenerator) Hub.state.videoGenerator = {};
      Hub.state.videoGenerator.outputFolder = folder;
      document.getElementById('vgOutputFolder').value = folder;
    }
  });

  panel.querySelector('#vgCancel')?.addEventListener('click', async () => {
    await window.api.videoGeneratorCancel();
    Hub.state.videoGenerator.generating = false;
    Hub.renderVideoGenerator();
  });

  panel.querySelector('#vgGenerate')?.addEventListener('click', async () => {
    const vg = Hub.state.videoGenerator || {};
    const voiceoverPath = document.getElementById('vgVoiceover')?.value;
    const outputFolder = document.getElementById('vgOutputFolder')?.value || require?.('os')?.tmpdir?.() || 'C:\\Users\\marre\\Downloads';
    const clipDuration = parseInt(document.getElementById('vgClipDuration')?.value) || 5;
    const skipStart = parseInt(document.getElementById('vgSkipStart')?.value) || 30;
    const skipEnd = parseInt(document.getElementById('vgSkipEnd')?.value) || 20;
    const mgInterval = (parseInt(document.getElementById('vgMgInterval')?.value) || 5) * 60;

    if (!voiceoverPath) { Hub.showToast('Seleciona um ficheiro de áudio', 'error'); return; }
    if (!vg.seriesIds?.length) { Hub.showToast('Adiciona pelo menos uma série', 'error'); return; }

    Hub.state.videoGenerator = {
      ...Hub.state.videoGenerator,
      voiceoverPath, outputFolder, clipDuration, skipStart, skipEnd, mgInterval,
      generating: true, progressPercent: 0, progressDetail: 'A preparar...',
    };
    Hub.renderVideoGenerator();

    const result = await window.api.videoGeneratorGenerate({
      voiceoverPath, seriesIds: vg.seriesIds, outputFolder,
      clipDuration, skipStart, skipEnd, mgInterval,
    });

    Hub.state.videoGenerator.generating = false;
    if (result.success) {
      Hub.state.videoGenerator.lastOutput = result.outputFile;
      Hub.showToast(`Vídeo gerado! ${result.totalClips} clips, ${result.motionGraphics} motion graphics`);
    } else {
      Hub.showToast(result.error || 'Erro ao gerar vídeo', 'error');
    }
    Hub.renderVideoGenerator();
  });
};

// Progress listener
window.api.onVideoGeneratorProgress((data) => {
  if (!Hub.state.videoGenerator) Hub.state.videoGenerator = {};
  Hub.state.videoGenerator.progressPercent = data.percent || 0;
  Hub.state.videoGenerator.progressDetail = data.detail || data.phase || '';

  const detail = document.getElementById('vgProgressDetail');
  const percent = document.getElementById('vgProgressPercent');
  const fill = document.getElementById('vgProgressFill');

  if (detail) detail.textContent = data.detail || data.phase || '';
  if (percent) percent.textContent = `${data.percent || 0}%`;
  if (fill) fill.style.width = `${data.percent || 0}%`;

  // Update gen-bar
  const bar = document.getElementById('genBar');
  const barPhase = document.getElementById('genBarPhase');
  const barFill = document.getElementById('genBarFill');
  const barPct = document.getElementById('genBarPercent');
  if (bar) {
    bar.classList.add('visible');
    if (barPhase) barPhase.textContent = data.detail || data.phase || '';
    if (barFill) barFill.style.width = `${data.percent || 0}%`;
    if (barPct) barPct.textContent = `${data.percent || 0}%`;

    if (data.phase === 'done') {
      setTimeout(() => bar.classList.remove('visible'), 4000);
    }
  }
});
