"use strict";

const demoInitialMode = new URLSearchParams(location.search).get("mode") || "grid";

const state = {
  tracks: [],
  filteredTracks: [],
  newAudioFiles: [],
  source: "new",
  currentNewAudioId: "",
  analysisPollTimer: null,
  detail: null,
  mode: "beat",
  windowSeconds: 12,
  raf: null,
  lastWindowStart: -1,
};

const el = {};
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  [
    "dataStatus", "trackHeading", "trackCount", "trackSearch", "trackSelect", "playerHeading", "trackMeta",
    "audioPlayer", "currentTime", "durationTime", "overview", "overviewProgress", "overviewWindow",
    "overviewCursor", "windowControls", "modeTabs", "timeline", "timeGrid", "playhead", "beatView",
    "segmentView", "gridView", "referenceBeats", "predictionBeats", "referenceSegments", "predictionSegments",
    "eightCountBlocks", "gridSections", "gridModeTab", "gridLegend",
    "windowRange", "timelineNote", "metricCards", "windowStats", "toast", "sourceTabs",
    "datasetPicker", "newAudioPicker", "newAudioSelect", "refreshNewAudioButton", "analyzeButton",
    "analysisProgress", "newAudioStatus", "analysisStepLabel", "referenceLegend", "predictionLegend",
    "matchedLegend", "mismatchLegend", "referenceBeatCode", "referenceBeatCaption",
    "predictionBeatCode", "predictionBeatCaption", "referenceSegmentCode", "referenceSegmentCaption",
    "predictionSegmentCode", "predictionSegmentCaption", "fullMetricsHeading", "metricScope",
    "windowStatsHeading", "windowScope", "windowDisclaimer",
  ].forEach((id) => { el[id] = $(id); });

  bindEvents();
  restoreViewState();
  loadNewAudioFiles();
});

function bindEvents() {
  el.trackSearch.addEventListener("input", filterTracks);
  el.trackSelect.addEventListener("change", () => loadSelectedTrack());
  el.trackSelect.addEventListener("dblclick", () => loadSelectedTrack(true));
  el.trackSelect.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadSelectedTrack(true);
  });
  el.sourceTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-source]");
    if (button) setSource(button.dataset.source);
  });
  el.newAudioSelect.addEventListener("change", () => {
    state.currentNewAudioId = el.newAudioSelect.value;
    updateNewAudioControls();
    updateUrl();
    loadNewAudioResult(state.currentNewAudioId);
  });
  el.refreshNewAudioButton.addEventListener("click", () => loadNewAudioFiles(true));
  el.analyzeButton.addEventListener("click", analyzeSelectedNewAudio);

  el.modeTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    setMode(button.dataset.mode);
  });

  el.windowControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-window]");
    if (!button) return;
    state.windowSeconds = Number(button.dataset.window);
    [...el.windowControls.querySelectorAll("button")].forEach((item) => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    state.lastWindowStart = -1;
    updateUrl();
    render();
  });

  el.audioPlayer.addEventListener("loadedmetadata", () => {
    el.durationTime.textContent = formatTime(duration());
    render(true);
  });
  el.audioPlayer.addEventListener("durationchange", () => render(true));
  el.audioPlayer.addEventListener("timeupdate", () => {
    updateContinuousUI();
    render();
  });
  el.audioPlayer.addEventListener("play", startAnimation);
  el.audioPlayer.addEventListener("pause", stopAnimation);
  el.audioPlayer.addEventListener("ended", stopAnimation);
  el.audioPlayer.addEventListener("error", () => showToast("音频载入失败，请检查文件是否可用。", true));

  el.overview.addEventListener("click", seekFromOverview);
  el.overview.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      seekBy(event.key === "ArrowLeft" ? -5 : 5);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, select, button") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      seekBy(event.key === "ArrowLeft" ? -5 : 5);
    } else if (event.code === "Space") {
      event.preventDefault();
      if (el.audioPlayer.paused) el.audioPlayer.play().catch(() => {});
      else el.audioPlayer.pause();
    }
  });
}

async function loadTracks() {}

async function loadNewAudioFiles(announce = false) {
  state.newAudioFiles = window.FITGEN_DEMO.files;
  renderNewAudioOptions();
  const requested = new URLSearchParams(location.search).get("audio");
  if (requested && state.newAudioFiles.some(item => item.id === requested)) el.newAudioSelect.value = requested;
  updateNewAudioControls();
  updateSourceHeading();
  if (announce) showToast("已载入 4 首本地音乐");
  const selected = selectedNewAudio();
  if (selected) await loadNewAudioResult(selected.id);
}

function renderNewAudioOptions() {
  const previous = el.newAudioSelect.value;
  el.newAudioSelect.replaceChildren();
  if (!state.newAudioFiles.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "目录中暂无 WAV 文件";
    el.newAudioSelect.append(option);
    return;
  }
  state.newAudioFiles.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    const status = { idle: "待分析", queued: "排队中", running: "分析中", ready: "已完成", error: "失败" }[item.status] || item.status;
    option.textContent = `${item.name}  ·  ${status}`;
    el.newAudioSelect.append(option);
  });
  if (state.newAudioFiles.some((item) => item.id === previous)) el.newAudioSelect.value = previous;
}

function selectedNewAudio() {
  return state.newAudioFiles.find((item) => item.id === el.newAudioSelect.value);
}

function updateNewAudioControls() {
  const item = selectedNewAudio();
  if (item) state.currentNewAudioId = item.id;
  const busy = item && ["queued", "running"].includes(item.status);
  const rawProgress = Number(item?.progress_percent);
  const hasProgress = busy && Number.isFinite(rawProgress);
  const progress = hasProgress ? clamp(rawProgress, 0, 100) : 0;
  el.analyzeButton.disabled = !item || busy;
  el.analyzeButton.textContent = item?.status === "ready" ? "查看分析结果" : item?.status === "error" ? "重新分析" : "开始分析";
  el.analysisProgress.classList.toggle("hidden", !busy);
  el.analysisProgress.classList.toggle("determinate", hasProgress);
  el.analysisProgress.style.setProperty("--analysis-progress", `${progress}%`);
  el.analysisProgress.setAttribute("aria-hidden", String(!busy));
  if (hasProgress) el.analysisProgress.setAttribute("aria-valuenow", String(Math.round(progress)));
  else el.analysisProgress.removeAttribute("aria-valuenow");
  if (!item) setNewAudioStatus("目录中暂无 WAV 文件");
  else {
    const elapsed = Number(item.elapsed_seconds);
    const timing = Number.isFinite(elapsed)
      ? ` · ${item.status === "ready" ? "总用时" : "已用时"} ${formatElapsed(elapsed)}`
      : "";
    setNewAudioStatus(`${item.message || item.status}${timing}`, item.status === "ready" ? "ready" : item.status === "error" ? "error" : "");
  }
}

function setNewAudioStatus(message, type = "") {
  el.newAudioStatus.textContent = message;
  el.newAudioStatus.className = `new-audio-status ${type}`.trim();
}

function setSource(source, update = true) {
  if (!new Set(["dataset", "new"]).has(source)) source = "dataset";
  const changed = state.source !== source;
  state.source = source;
  if (changed) clearDetail();
  [...el.sourceTabs.querySelectorAll("[data-source]")].forEach((button) => {
    const selected = button.dataset.source === source;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  el.datasetPicker.classList.toggle("hidden", source !== "dataset");
  el.newAudioPicker.classList.toggle("hidden", source !== "new");
  if (source !== "new") stopNewAudioPolling();
  updateSourceHeading();
  configureDetailContext();
  if (update) updateUrl();
  if (source === "dataset" && !state.detail && el.trackSelect.value) loadSelectedTrack();
  updateNewAudioControls();
  const selected = selectedNewAudio();
  if (source === "new" && selected && ["queued", "running"].includes(selected.status)) {
    pollNewAudio(selected.id);
  }
}

function updateSourceHeading() {
  if (state.source === "new") {
    el.trackHeading.textContent = "选择 Demo 音乐";
    el.trackCount.textContent = `${state.newAudioFiles.length} 首音乐`;
  } else {
    el.trackHeading.textContent = "曲目";
    el.trackCount.textContent = `${state.filteredTracks.length} / ${state.tracks.length} 首`;
  }
}

async function analyzeSelectedNewAudio() {
  const item = selectedNewAudio();
  if (item) await loadNewAudioResult(item.id, true);
}

function replaceNewAudioItem(item) {
  const index = state.newAudioFiles.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) state.newAudioFiles[index] = { ...state.newAudioFiles[index], ...item };
  else state.newAudioFiles.push(item);
  renderNewAudioOptions();
  el.newAudioSelect.value = item.id;
}

function pollNewAudio() {}

function stopNewAudioPolling() {
  clearTimeout(state.analysisPollTimer);
  state.analysisPollTimer = null;
}

function normalizeTrack(item) {
  if (typeof item === "string" || typeof item === "number") {
    const id = String(item);
    return { id, title: id, artist: "" };
  }
  const id = String(item.id ?? item.track_id ?? item.slug ?? "");
  return {
    ...item,
    id,
    title: String(item.title ?? item.name ?? item.track_name ?? id),
    artist: String(item.artist ?? item.performer ?? ""),
  };
}

function filterTracks() {
  const query = el.trackSearch.value.trim().toLocaleLowerCase();
  state.filteredTracks = query
    ? state.tracks.filter((track) => `${track.id} ${track.title} ${track.artist}`.toLocaleLowerCase().includes(query))
    : state.tracks;
  renderTrackOptions();
}

function renderTrackOptions() {
  const previous = el.trackSelect.value;
  el.trackSelect.replaceChildren();
  state.filteredTracks.forEach((track) => {
    const option = document.createElement("option");
    option.value = track.id;
    option.textContent = track.artist ? `${track.title} — ${track.artist}  ·  ${track.id}` : `${track.title}  ·  ${track.id}`;
    option.title = option.textContent;
    el.trackSelect.append(option);
  });
  if (state.filteredTracks.some((track) => track.id === previous)) el.trackSelect.value = previous;
  else if (state.filteredTracks.length) el.trackSelect.selectedIndex = 0;
  updateSourceHeading();
}

async function loadSelectedTrack() {}

async function loadNewAudioResult(fileId, announce = false) {
  const payload = window.FITGEN_DEMO.details[fileId];
  if (!payload) { showToast("本地分析结果不存在", true); return; }
  const requestedMode = state.detail ? state.mode : demoInitialMode;
  state.currentNewAudioId = fileId;
  applyDetail(payload, "new:" + fileId, announce);
  setMode(["beat", "downbeat", "segment", "grid"].includes(requestedMode) ? requestedMode : "grid");
  setNewAudioStatus("音乐和分析结果已载入，可播放并切换观察维度", "ready");
}

function applyDetail(payload, requestedId, announce = false) {
  state.detail = normalizeDetail(payload, requestedId);
  state.lastWindowStart = -1;
  stopAnimation();
  configureDetailContext();

  const track = state.detail.track;
  el.playerHeading.textContent = track.title || track.id;
  el.trackMeta.textContent = [track.artist, track.source_id || track.id].filter(Boolean).join(" · ") || "Harmonix Set";
  FitGenMedia.attach(el.audioPlayer, state.detail.audio_url);
  renderMetrics();
  render(true);
  updateUrl();
  setStatus("分析数据已就绪", "ready");
  if (announce) showToast(`已载入：${track.title || track.id}`);
}

function clearDetail() {
  stopAnimation();
  state.detail = null;
  state.lastWindowStart = -1;
  el.audioPlayer.removeAttribute("src");
  el.audioPlayer.load();
  el.playerHeading.textContent = "尚未选择曲目";
  el.trackMeta.textContent = state.source === "new" ? "请选择 WAV 并开始分析" : "请从上方列表选择一首歌";
  el.metricCards.innerHTML = '<p class="empty-copy">载入曲目后显示</p>';
  el.windowStats.innerHTML = '<p class="empty-copy">载入曲目后显示</p>';
  [el.referenceBeats, el.predictionBeats, el.referenceSegments, el.predictionSegments, el.eightCountBlocks, el.gridSections]
    .forEach((node) => node.replaceChildren());
  document.body.classList.remove("no-reference");
}

function configureDetailContext() {
  const hasReference = state.detail
    ? state.detail.has_reference !== false
    : state.source !== "new";
  document.body.classList.toggle("no-reference", !hasReference);
  el.analysisStepLabel.textContent = hasReference ? "03 / 对比分析" : "03 / 音乐分析结果";
  el.referenceLegend.classList.toggle("hidden", !hasReference);
  el.matchedLegend.classList.toggle("hidden", !hasReference);
  el.mismatchLegend.classList.toggle("hidden", !hasReference);
  el.predictionLegend.lastChild.textContent = hasReference ? "模型预测（虚线）" : "All-In-One 分析结果";
  for (const code of [el.referenceBeatCode, el.referenceSegmentCode]) code.textContent = hasReference ? "REF" : "—";
  for (const caption of [el.referenceBeatCaption, el.referenceSegmentCaption]) caption.textContent = hasReference ? "参考标注" : "无参考";
  for (const code of [el.predictionBeatCode, el.predictionSegmentCode]) code.textContent = hasReference ? "PRED" : "AIO";
  for (const caption of [el.predictionBeatCaption, el.predictionSegmentCaption]) caption.textContent = hasReference ? "模型预测" : "分析结果";
  el.fullMetricsHeading.textContent = hasReference ? "全曲评测指标" : "全曲分析摘要";
  el.metricScope.textContent = hasReference ? "后端评测结果" : "All-In-One 输出";
  el.windowStatsHeading.textContent = hasReference ? "当前时间窗统计" : "当前时间窗分析";
  el.windowScope.textContent = hasReference ? "仅供定位" : "无参考标签";
  el.windowDisclaimer.textContent = hasReference
    ? "窗口统计只描述当前可见片段，不等同于全曲 F1。"
    : "这四首音乐没有人工参考标签，此处展示已保存的分析结果。";
  const hasGrid = !hasReference && Boolean(state.detail?.prediction?.eight_count_grid?.length);
  el.gridModeTab.classList.toggle("hidden", !hasGrid);
  el.gridLegend.classList.toggle("hidden", !hasGrid || state.mode !== "grid");
  if (!hasGrid && state.mode === "grid") setMode("beat");
}

function normalizeDetail(payload, requestedId) {
  const track = normalizeTrack(payload.track || { id: requestedId });
  const normalizeEvents = (events) => (Array.isArray(events) ? events : [])
    .map((event) => ({
      ...event,
      time: Number(event.time),
      position: event.position ?? event.beat_position ?? "–",
      downbeat: Boolean(event.downbeat) || Number(event.position ?? event.beat_position) === 1,
    }))
    .filter((event) => Number.isFinite(event.time))
    .sort((a, b) => a.time - b.time);
  const normalizeSegments = (segments) => (Array.isArray(segments) ? segments : [])
    .map((segment) => ({ ...segment, start: Number(segment.start), end: Number(segment.end), label: String(segment.label ?? "unknown") }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
  const normalizeSections = (sections) => (Array.isArray(sections) ? sections : [])
    .map((section) => ({
      ...section,
      start: Number(section.start_time_sec),
      end: Number(section.end_time_sec),
      label: String(section.section_label ?? "unknown"),
    }))
    .filter((section) => Number.isFinite(section.start) && Number.isFinite(section.end) && section.end > section.start)
    .sort((a, b) => a.start - b.start);
  const normalizeGrid = (blocks) => (Array.isArray(blocks) ? blocks : [])
    .map((block) => ({
      ...block,
      start: Number(block.start_time_sec),
      end: Number(block.end_time_sec),
      start_frame_id: Number(block.start_frame_id),
      end_frame_id: Number(block.end_frame_id),
      beat_count: Number(block.beat_count) || 0,
      quality_flags: Array.isArray(block.quality_flags) ? block.quality_flags.map(String) : [],
    }))
    .filter((block) => Number.isFinite(block.start) && Number.isFinite(block.end) && block.end > block.start)
    .sort((a, b) => a.start - b.start);

  return {
    ...payload,
    track,
    audio_url: payload.audio_url || "",
    has_reference: payload.has_reference !== false,
    metrics: payload.metrics || {},
    reference: {
      beats: normalizeEvents(payload.reference?.beats),
      segments: normalizeSegments(payload.reference?.segments),
    },
    prediction: {
      beats: normalizeEvents(payload.prediction?.beats),
      segments: normalizeSegments(payload.prediction?.segments),
      sections: normalizeSections(payload.prediction?.sections),
      eight_count_grid: normalizeGrid(payload.prediction?.eight_count_grid),
      grid_diagnostics: payload.prediction?.grid_diagnostics || { summary: {}, warnings: [] },
    },
  };
}

function setMode(mode) {
  if (!new Set(["beat", "downbeat", "segment", "grid"]).has(mode)) return;
  if (mode === "grid" && (!state.detail || state.detail.has_reference !== false || !state.detail.prediction?.eight_count_grid?.length)) return;
  state.mode = mode;
  [...el.modeTabs.querySelectorAll("[data-mode]")].forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  el.beatView.classList.toggle("hidden", mode === "segment" || mode === "grid");
  el.segmentView.classList.toggle("hidden", mode !== "segment");
  el.gridView.classList.toggle("hidden", mode !== "grid");
  el.gridLegend.classList.toggle("hidden", mode !== "grid");
  el.timeline.classList.toggle("downbeat-mode", mode === "downbeat");
  renderMetrics();
  state.lastWindowStart = -1;
  updateUrl();
  render();
}

function render(force = false) {
  updateContinuousUI();
  if (!state.detail) return;
  const range = visibleRange();
  if (!force && Math.abs(range.start - state.lastWindowStart) < 0.025) {
    if (state.mode === "segment") {
      renderSegments(range);
      renderWindowStats(range);
    } else if (state.mode === "grid") {
      renderEightCountGrid(range);
      renderWindowStats(range);
    }
    return;
  }
  state.lastWindowStart = range.start;
  renderTimeGrid(range);
  if (state.mode === "segment") renderSegments(range);
  else if (state.mode === "grid") renderEightCountGrid(range);
  else renderBeats(range);
  renderWindowStats(range);
}

function updateContinuousUI() {
  const current = Number.isFinite(el.audioPlayer.currentTime) ? el.audioPlayer.currentTime : 0;
  const total = duration();
  el.currentTime.textContent = formatTime(current);
  el.durationTime.textContent = formatTime(total);
  const progress = total ? clamp(current / total, 0, 1) : 0;
  el.overviewProgress.style.width = `${progress * 100}%`;
  el.overviewCursor.style.left = `${progress * 100}%`;
  el.overview.setAttribute("aria-valuenow", String(Math.round(progress * 100)));

  const range = visibleRange();
  const windowLeft = total ? range.start / total : 0;
  const windowWidth = total ? Math.min((range.end - range.start) / total, 1) : 1;
  el.overviewWindow.style.left = `${windowLeft * 100}%`;
  el.overviewWindow.style.width = `${windowWidth * 100}%`;
  const timelineRect = el.timeline.getBoundingClientRect();
  const gridRect = el.timeGrid.getBoundingClientRect();
  const playheadOffset = gridRect.left - timelineRect.left
    + clamp((current - range.start) / Math.max(range.end - range.start, 0.001), 0, 1) * gridRect.width;
  el.playhead.style.left = `${playheadOffset}px`;
  el.windowRange.textContent = `${formatTime(range.start)} — ${formatTime(range.end)}`;
}

function renderTimeGrid(range) {
  el.timeGrid.replaceChildren();
  const count = state.windowSeconds <= 6 ? 6 : state.windowSeconds <= 12 ? 6 : 8;
  for (let index = 0; index <= count; index += 1) {
    const line = document.createElement("div");
    line.className = "grid-line";
    line.style.left = `${(index / count) * 100}%`;
    const label = document.createElement("span");
    label.textContent = formatTime(range.start + (index / count) * (range.end - range.start), false);
    line.append(label);
    el.timeGrid.append(line);
  }
}

function renderBeats(range) {
  const visibleReference = visibleEvents(state.detail.reference.beats, range);
  const visiblePrediction = visibleEvents(state.detail.prediction.beats, range);
  if (state.detail.has_reference === false) {
    renderBeatLane(el.referenceBeats, [], range, new Map(), "reference");
    renderBeatLane(el.predictionBeats, visiblePrediction, range, new Map(), "prediction");
    return;
  }
  const onlyDownbeats = state.mode === "downbeat";
  const comparisonRef = onlyDownbeats ? visibleReference.filter((item) => item.downbeat) : visibleReference;
  const comparisonPred = onlyDownbeats ? visiblePrediction.filter((item) => item.downbeat) : visiblePrediction;
  const tolerance = 0.07;
  const matches = matchEvents(comparisonRef, comparisonPred, tolerance);
  const refStatus = new Map();
  const predStatus = new Map();
  comparisonRef.forEach((event) => refStatus.set(event, "missed"));
  comparisonPred.forEach((event) => predStatus.set(event, "extra"));
  matches.forEach(([reference, prediction]) => {
    refStatus.set(reference, "matched");
    predStatus.set(prediction, "matched");
  });
  renderBeatLane(el.referenceBeats, visibleReference, range, refStatus, "reference");
  renderBeatLane(el.predictionBeats, visiblePrediction, range, predStatus, "prediction");
}

function renderBeatLane(container, events, range, statusMap, kind) {
  container.replaceChildren();
  const fragment = document.createDocumentFragment();
  events.forEach((event) => {
    const marker = document.createElement("div");
    const status = statusMap.get(event) || "context";
    marker.className = `beat-event ${event.downbeat ? "downbeat" : ""} ${status}`;
    marker.style.left = `${positionInRange(event.time, range)}%`;
    marker.title = `${kind === "reference" ? "参考" : "预测"} ${event.downbeat ? "Downbeat" : "Beat"} · ${formatTime(event.time)} · beat_position ${event.position}`;
    const position = document.createElement("span");
    position.className = "beat-position";
    position.textContent = String(event.position);
    marker.append(position);
    fragment.append(marker);
  });
  container.append(fragment);
}

function renderSegments(range) {
  renderSegmentLane(el.referenceSegments, visibleSegments(state.detail.reference.segments, range), range);
  renderSegmentLane(el.predictionSegments, visibleSegments(state.detail.prediction.segments, range), range);
}

function renderSegmentLane(container, segments, range) {
  container.replaceChildren();
  const current = el.audioPlayer.currentTime || 0;
  segments.forEach((segment) => {
    const start = Math.max(segment.start, range.start);
    const end = Math.min(segment.end, range.end);
    const block = document.createElement("div");
    block.className = `segment-block ${current >= segment.start && current < segment.end ? "active" : ""}`;
    block.style.left = `${positionInRange(start, range)}%`;
    block.style.width = `${Math.max(positionInRange(end, range) - positionInRange(start, range), 0)}%`;
    block.style.setProperty("--segment-hue", String(labelHue(segment.label)));
    block.textContent = segment.label;
    block.title = `${segment.label} · ${formatTime(segment.start)} — ${formatTime(segment.end)}`;
    container.append(block);
  });
}

function renderEightCountGrid(range) {
  const blocks = visibleSegments(state.detail.prediction.eight_count_grid, range);
  const sections = visibleSegments(state.detail.prediction.sections, range);
  const beatsByIndex = new Map(state.detail.prediction.beats.map((beat) => [Number(beat.beat_index), beat]));
  el.eightCountBlocks.replaceChildren();
  blocks.forEach((item) => {
    const start = Math.max(item.start, range.start);
    const end = Math.min(item.end, range.end);
    const block = document.createElement("button");
    block.type = "button";
    block.className = `eight-count-block ${item.block_type}`;
    block.style.left = `${positionInRange(start, range)}%`;
    block.style.width = `${Math.max(positionInRange(end, range) - positionInRange(start, range), 0)}%`;
    const typeLabel = item.block_type === "full"
      ? "完整八拍"
      : item.block_type === "gap"
        ? "Gap"
        : item.block_type === "partial_head" ? "头部 Partial" : "尾部 Partial";
    block.title = `${typeLabel} · ${formatTime(item.start)} — ${formatTime(item.end)} · ${item.quality_flags.join(", ") || "结构正常"}`;
    block.addEventListener("click", () => {
      const fps = Number(state.detail.analysis?.activation_fps) || 30;
      const frameTime = Number.isFinite(item.start_frame_id) ? item.start_frame_id / fps : item.start;
      el.audioPlayer.currentTime = clamp(frameTime, 0, duration());
      updateContinuousUI();
      render(true);
    });

    if (item.block_type === "full") {
      const counts = document.createElement("span");
      counts.className = "eight-count-numbers";
      for (let count = 1; count <= 8; count += 1) {
        const beat = beatsByIndex.get(Number(item.start_beat_index) + count - 1);
        if (!beat) continue;
        const marker = document.createElement("i");
        marker.textContent = String(count);
        marker.className = count === 1 || count === 5 ? "grid-downbeat" : "";
        marker.style.left = `${clamp((beat.time - item.start) / Math.max(item.end - item.start, 0.001), 0, 1) * 100}%`;
        counts.append(marker);
      }
      block.append(counts);
    } else {
      const label = document.createElement("span");
      label.className = "eight-count-label";
      label.textContent = item.block_type === "gap" ? "GAP" : `${item.beat_count} 个真实 Beat`;
      block.append(label);
    }
    el.eightCountBlocks.append(block);
  });

  el.gridSections.replaceChildren();
  sections.forEach((section) => {
    const start = Math.max(section.start, range.start);
    const end = Math.min(section.end, range.end);
    const block = document.createElement("button");
    block.type = "button";
    block.className = "grid-section-block";
    block.style.left = `${positionInRange(start, range)}%`;
    block.style.width = `${Math.max(positionInRange(end, range) - positionInRange(start, range), 0)}%`;
    block.textContent = section.label;
    block.title = `${section.label} · 有效边界 ${formatTime(section.start)} — ${formatTime(section.end)}`;
    block.addEventListener("click", () => { el.audioPlayer.currentTime = section.start; });
    el.gridSections.append(block);
  });
}

function renderWindowStats(range) {
  if (!state.detail) return;
  if (state.detail.has_reference === false) {
    if (state.mode === "grid") {
      const visible = visibleSegments(state.detail.prediction.eight_count_grid, range);
      const active = activeSegment(state.detail.prediction.eight_count_grid);
      const summary = state.detail.prediction.grid_diagnostics?.summary || {};
      el.windowStats.replaceChildren(
        statChip(String(visible.length), "可见八拍块", ""),
        statChip(active?.block_type || "–", "当前块类型", active?.block_type === "full" ? "ok" : ""),
        statChip(String(summary.full_block_count ?? 0), "全曲完整八拍", "ok"),
      );
      return;
    }
    if (state.mode === "segment") {
      const visible = visibleSegments(state.detail.prediction.segments, range);
      const active = activeSegment(state.detail.prediction.segments);
      el.windowStats.replaceChildren(
        statChip(String(visible.length), "可见段落", ""),
        statChip(active?.label || "–", "当前标签", active ? "ok" : ""),
        statChip(String(state.detail.prediction.segments.length), "全曲段落", ""),
      );
      return;
    }
    const visible = visibleEvents(state.detail.prediction.beats, range);
    const visibleDownbeats = visible.filter((item) => item.downbeat);
    const allDownbeats = state.detail.prediction.beats.filter((item) => item.downbeat);
    const onlyDownbeats = state.mode === "downbeat";
    el.windowStats.replaceChildren(
      statChip(String(onlyDownbeats ? visibleDownbeats.length : visible.length), onlyDownbeats ? "可见 Downbeat" : "可见 Beat", "ok"),
      statChip(String(visibleDownbeats.length), "窗内 Downbeat", ""),
      statChip(String(onlyDownbeats ? allDownbeats.length : state.detail.prediction.beats.length), onlyDownbeats ? "全曲 Downbeat" : "全曲 Beat", ""),
    );
    return;
  }
  if (state.mode === "segment") {
    const ref = visibleSegments(state.detail.reference.segments, range);
    const pred = visibleSegments(state.detail.prediction.segments, range);
    const activeRef = activeSegment(state.detail.reference.segments);
    const activePred = activeSegment(state.detail.prediction.segments);
    el.windowStats.replaceChildren(
      statChip(String(ref.length), "参考段落", ""),
      statChip(String(pred.length), "预测段落", ""),
      statChip(activeRef && activePred && activeRef.label === activePred.label ? "一致" : "不同", "当前标签", activeRef && activePred && activeRef.label === activePred.label ? "ok" : "bad"),
    );
    return;
  }

  const onlyDownbeats = state.mode === "downbeat";
  const ref = visibleEvents(state.detail.reference.beats.filter((item) => !onlyDownbeats || item.downbeat), range);
  const pred = visibleEvents(state.detail.prediction.beats.filter((item) => !onlyDownbeats || item.downbeat), range);
  const matches = matchEvents(ref, pred, 0.07);
  el.windowStats.replaceChildren(
    statChip(String(matches.length), "匹配", "ok"),
    statChip(String(Math.max(ref.length - matches.length, 0)), "参考遗漏", "bad"),
    statChip(String(Math.max(pred.length - matches.length, 0)), "预测额外", "bad"),
  );
}

function renderMetrics() {
  if (!state.detail) return;
  const flat = flattenMetrics(state.detail.metrics);
  let entries = Object.entries(flat).filter(([key, value]) => {
    const normalized = key.toLowerCase().replaceAll(".", "_");
    const isDisplayValue = typeof value === "number" || typeof value === "string";
    if (!isDisplayValue) return false;
    if (state.mode === "beat") return normalized.startsWith("beat_") && !normalized.startsWith("downbeat_");
    if (state.mode === "downbeat") return normalized.startsWith("downbeat_");
    if (state.mode === "grid") return normalized.startsWith("grid_");
    return normalized.startsWith("segment_") || normalized.startsWith("frame_label_");
  });
  entries = entries.slice(0, 6);
  el.metricCards.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-copy";
    empty.textContent = "此曲目暂无可展示的全曲指标。";
    el.metricCards.append(empty);
    return;
  }
  entries.forEach(([key, value]) => {
    const card = document.createElement("article");
    card.className = "metric-card";
    const label = document.createElement("span");
    label.className = "metric-label";
    label.textContent = prettyMetricName(key);
    label.title = key;
    const strong = document.createElement("strong");
    strong.textContent = formatMetric(value, key);
    card.append(label, strong);
    el.metricCards.append(card);
  });
}

function matchEvents(reference, prediction, tolerance) {
  const matches = [];
  const used = new Set();
  reference.forEach((ref) => {
    let bestIndex = -1;
    let bestDistance = Infinity;
    prediction.forEach((pred, index) => {
      const distance = Math.abs(ref.time - pred.time);
      if (!used.has(index) && distance <= tolerance && distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    });
    if (bestIndex >= 0) {
      used.add(bestIndex);
      matches.push([ref, prediction[bestIndex]]);
    }
  });
  return matches;
}

function visibleEvents(events, range) {
  return events.filter((event) => event.time >= range.start && event.time <= range.end);
}

function visibleSegments(segments, range) {
  return segments.filter((segment) => segment.end > range.start && segment.start < range.end);
}

function activeSegment(segments) {
  const current = el.audioPlayer.currentTime || 0;
  return segments.find((segment) => current >= segment.start && current < segment.end);
}

function visibleRange() {
  const current = Number.isFinite(el.audioPlayer.currentTime) ? el.audioPlayer.currentTime : 0;
  const total = duration();
  const length = total > 0 ? Math.min(state.windowSeconds, total) : state.windowSeconds;
  const start = total > 0 ? clamp(current - length / 2, 0, Math.max(total - length, 0)) : Math.max(current - length / 2, 0);
  return { start, end: start + length };
}

function seekFromOverview(event) {
  if (!duration()) return;
  const rect = el.overview.getBoundingClientRect();
  el.audioPlayer.currentTime = clamp((event.clientX - rect.left) / rect.width, 0, 1) * duration();
  state.lastWindowStart = -1;
  render(true);
}

function seekBy(seconds) {
  if (!state.detail) return;
  el.audioPlayer.currentTime = clamp((el.audioPlayer.currentTime || 0) + seconds, 0, duration() || Infinity);
  state.lastWindowStart = -1;
  render(true);
}

function startAnimation() {
  stopAnimation();
  const tick = () => {
    updateContinuousUI();
    render();
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}

function stopAnimation() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = null;
  render(true);
}

function restoreViewState() {
  const params = new URLSearchParams(location.search);
  state.currentNewAudioId = params.get("audio") || "";
  setSource("new", false);
  const mode = params.get("mode");
  const windowSeconds = Number(params.get("window"));
  if (["beat", "downbeat", "segment", "grid"].includes(mode)) setMode(mode);
  if ([6, 12, 24].includes(windowSeconds)) {
    const button = el.windowControls.querySelector(`[data-window="${windowSeconds}"]`);
    button?.click();
  } else if (matchMedia("(max-width: 780px)").matches) {
    el.windowControls.querySelector('[data-window="6"]')?.click();
  }
}

function updateUrl() {
  const params = new URLSearchParams(location.search);
  if (state.source === "new") {
    params.set("source", "new");
    params.delete("track");
    const fileId = selectedNewAudio()?.id || state.currentNewAudioId;
    if (fileId) params.set("audio", fileId);
    else params.delete("audio");
  } else {
    params.delete("source");
    params.delete("audio");
    if (state.detail?.track?.id) params.set("track", state.detail.track.id);
  }
  params.set("mode", state.mode);
  params.set("window", String(state.windowSeconds));
  try { history.replaceState(null, "", `${location.pathname}?${params}`); } catch (_) { /* 本地文件打开时仍可正常播放和查看。 */ }
}

function setStatus(message, type = "") {
  el.dataStatus.className = `status-pill ${type}`.trim();
  el.dataStatus.querySelector("span:last-child").textContent = message;
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.className = `toast show${isError ? " error" : ""}`;
  toastTimer = setTimeout(() => { el.toast.className = "toast"; }, 3200);
}

function statChip(value, label, className) {
  const chip = document.createElement("div");
  chip.className = `stat-chip ${className}`.trim();
  const strong = document.createElement("strong");
  strong.textContent = value;
  const span = document.createElement("span");
  span.textContent = label;
  chip.append(strong, span);
  return chip;
}

function flattenMetrics(value, prefix = "", result = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    Object.entries(value).forEach(([key, nested]) => flattenMetrics(nested, prefix ? `${prefix}.${key}` : key, result));
  } else if (prefix) result[prefix] = value;
  return result;
}

function prettyMetricName(key) {
  const normalized = key.toLowerCase().replaceAll(".", "_");
  const names = {
    beat_f1: "Beat F1",
    beat_fmeasure: "Beat F1",
    beat_precision: "Beat Precision",
    beat_recall: "Beat Recall",
    beat_bpm: "BPM",
    beat_count: "Beat 数量",
    beat_duration_seconds: "音频时长（秒）",
    beat_cmlt: "Beat CMLt",
    beat_amlt: "Beat AMLt",
    downbeat_f1: "Downbeat F1",
    downbeat_fmeasure: "Downbeat F1",
    downbeat_precision: "Downbeat Precision",
    downbeat_recall: "Downbeat Recall",
    downbeat_cmlt: "Downbeat CMLt",
    downbeat_amlt: "Downbeat AMLt",
    downbeat_count: "Downbeat 数量",
    segment_boundary_f1: "段落边界 F1",
    segment_boundary_f1_0_5: "边界 F1 (±0.5s)",
    segment_boundary_precision_0_5: "边界 Precision (±0.5s)",
    segment_boundary_recall_0_5: "边界 Recall (±0.5s)",
    segment_pairwise_f1: "标签 Pairwise F1",
    segment_pairwise_precision: "标签 Pairwise Precision",
    segment_pairwise_recall: "标签 Pairwise Recall",
    segment_nce_f1: "标签 NCE F1",
    segment_frame_accuracy: "逐帧标签准确率",
    segment_count: "段落数量",
    segment_duration_seconds: "音频时长（秒）",
    frame_label_accuracy: "逐帧标签准确率",
  };
  const mappedKey = Object.keys(names)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => normalized === candidate || normalized.endsWith(`_${candidate}`));
  return mappedKey
    ? names[mappedKey]
    : normalized.replaceAll("_", " ").replace(/\bf1\b/i, "F1");
}

function formatMetric(value, key) {
  if (typeof value !== "number") return String(value);
  const normalized = key.toLowerCase();
  if (normalized.includes("accuracy") || normalized.includes("percent")) {
    return `${value <= 1 ? value * 100 : value.toFixed(1)}%`;
  }
  return Math.abs(value) < 100 ? value.toFixed(3) : value.toFixed(1);
}

function duration() {
  return Number.isFinite(el.audioPlayer.duration) ? el.audioPlayer.duration : Number(state.detail?.track?.duration || 0);
}

function formatTime(seconds, milliseconds = true) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const minutes = Math.floor(seconds / 60);
  const whole = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}${milliseconds ? `.${String(millis).padStart(3, "0")}` : ""}`;
}

function formatElapsed(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function positionInRange(time, range) {
  return clamp((time - range.start) / Math.max(range.end - range.start, 0.001), 0, 1) * 100;
}

function labelHue(label) {
  let hash = 0;
  for (const character of String(label)) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 320;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
