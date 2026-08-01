/**
 * Anima CPTEC - Satellite GOES-16 & GOES-19 Image Animator & Processor
 */

document.addEventListener('DOMContentLoaded', () => {
    // State Variables
    let imagesList = [];
    let loadedImagesMap = new Map(); // url -> HTMLImageElement
    let currentIndex = 0;
    let isPlaying = false;
    let fps = 10;
    let animTimer = null;
    let lastFrameTime = 0;

    // Viewport Zoom & Pan State
    let scale = 1;
    let originX = 0;
    let originY = 0;
    let isDragging = false;
    let startX = 0, startY = 0;

    // Recording State
    let mediaRecorder = null;
    let recordedChunks = [];
    let isRecordingLive = false;

    // DOM Elements
    const canvas = document.getElementById('sat-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const loaderOverlay = document.getElementById('loader-overlay');
    const loaderText = document.getElementById('loader-text');

    // Controls
    const satSelect = document.getElementById('satellite-select');
    const sectorSelect = document.getElementById('sector-select');
    const channelSelect = document.getElementById('channel-select');
    const dateInput = document.getElementById('date-input');
    const btnFetch = document.getElementById('btn-fetch');

    // Processing Controls
    const compModeSelect = document.getElementById('composition-mode');
    const colormapSelect = document.getElementById('colormap-select');
    const brightnessSlider = document.getElementById('slider-brightness');
    const contrastSlider = document.getElementById('slider-contrast');
    const valBrightness = document.getElementById('val-brightness');
    const valContrast = document.getElementById('val-contrast');

    // Playback Controls
    const btnPlay = document.getElementById('btn-play');
    const playIcon = document.getElementById('play-icon');
    const playText = document.getElementById('play-text');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const timelineScrubber = document.getElementById('timeline-scrubber');
    const fpsSlider = document.getElementById('fps-slider');
    const fpsDisplay = document.getElementById('fps-display');
    const frameIndexDisplay = document.getElementById('frame-index-display');
    const timeStartLabel = document.getElementById('time-start');
    const timeEndLabel = document.getElementById('time-end');
    const frameCounterBadge = document.getElementById('frame-counter-badge');

    // Metadata Badges
    const metaSat = document.getElementById('meta-satellite');
    const metaProd = document.getElementById('meta-product');
    const metaTime = document.getElementById('meta-timestamp');

    // Export Buttons
    const btnRecordLive = document.getElementById('btn-record-live');
    const recordLiveText = document.getElementById('record-live-text');
    const btnExportMp4 = document.getElementById('btn-export-mp4');
    const btnExportGif = document.getElementById('btn-export-gif');
    const btnSnapshot = document.getElementById('btn-snapshot');

    // Zoom Buttons
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnZoomReset = document.getElementById('btn-zoom-reset');
    const btnFullscreen = document.getElementById('btn-fullscreen');

    // Set Default Date to Today (YYYY-MM-DD)
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;

    // Initial Fetch
    fetchSatelliteImages();

    // Event Listeners
    btnFetch.addEventListener('click', fetchSatelliteImages);
    btnPlay.addEventListener('click', togglePlay);
    btnPrev.addEventListener('click', () => stepFrame(-1));
    btnNext.addEventListener('click', () => stepFrame(1));

    timelineScrubber.addEventListener('input', (e) => {
        currentIndex = parseInt(e.target.value, 10);
        renderCurrentFrame();
    });

    fpsSlider.addEventListener('input', (e) => {
        fps = parseInt(e.target.value, 10);
        fpsDisplay.textContent = `${fps} FPS`;
    });

    brightnessSlider.addEventListener('input', (e) => {
        valBrightness.textContent = `${e.target.value}%`;
        renderCurrentFrame();
    });

    contrastSlider.addEventListener('input', (e) => {
        valContrast.textContent = `${e.target.value}%`;
        renderCurrentFrame();
    });

    compModeSelect.addEventListener('change', renderCurrentFrame);
    colormapSelect.addEventListener('change', renderCurrentFrame);

    // Zoom & Pan Event Listeners
    btnZoomIn.addEventListener('click', () => adjustZoom(1.2));
    btnZoomOut.addEventListener('click', () => adjustZoom(0.8));
    btnZoomReset.addEventListener('click', resetZoom);
    btnFullscreen.addEventListener('click', toggleFullscreen);

    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - originX;
        startY = e.clientY - originY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        originX = e.clientX - startX;
        originY = e.clientY - startY;
        renderCurrentFrame();
    });

    window.addEventListener('mouseup', () => { isDragging = false; });
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        adjustZoom(factor);
    });

    // Recording & Exports
    btnRecordLive.addEventListener('click', toggleLiveRecording);
    btnExportMp4.addEventListener('click', exportServerMp4);
    btnExportGif.addEventListener('click', exportServerGif);
    btnSnapshot.addEventListener('click', takeSnapshot);

    /**
     * Fetch satellite images metadata from Flask Backend
     */
    async function fetchSatelliteImages() {
        showLoader('Buscando acervo do CPTEC/INPE...');
        pause();

        const satellite = satSelect.value;
        const sector = sectorSelect.value;
        const channel = channelSelect.value;
        const date = dateInput.value;

        // Update Header Badges
        metaSat.textContent = satellite.toUpperCase();
        metaProd.textContent = channelSelect.options[channelSelect.selectedIndex].text.split('(')[0].trim();

        try {
            const resp = await fetch('/api/fetch-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ satellite, sector, channel, date })
            });

            const data = await resp.json();

            if (!data.success || !data.images || data.images.length === 0) {
                showLoader(`Nenhuma imagem encontrada para ${date}. Tente outra data.`, false);
                frameCounterBadge.textContent = '0 Quadros';
                return;
            }

            imagesList = data.images;
            currentIndex = 0;
            timelineScrubber.max = imagesList.length - 1;
            timelineScrubber.value = 0;
            frameCounterBadge.textContent = `${imagesList.length} Quadros`;

            timeStartLabel.textContent = imagesList[0].timestamp.split(' ')[1] || '00:00';
            timeEndLabel.textContent = imagesList[imagesList.length - 1].timestamp.split(' ')[1] || '23:50';

            // Preload images into memory
            await preloadImages(imagesList);
            hideLoader();
            renderCurrentFrame();

        } catch (err) {
            showLoader(`Erro de conexão com o servidor: ${err.message}`, false);
        }
    }

    /**
     * Preloads images asynchronously
     */
    async function preloadImages(list) {
        showLoader(`Carregando e preparando ${list.length} quadros de satélite...`);

        const promises = list.map((item, idx) => {
            return new Promise((resolve) => {
                if (loadedImagesMap.has(item.proxyUrl)) {
                    resolve();
                    return;
                }
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.onload = () => {
                    loadedImagesMap.set(item.proxyUrl, img);
                    loaderText.textContent = `Carregando quadros: ${loadedImagesMap.size} / ${list.length}`;
                    resolve();
                };
                img.onerror = () => {
                    resolve(); // Resolve anyway to prevent blocking
                };
                img.src = item.proxyUrl;
            });
        });

        await Promise.all(promises);
    }

    /**
     * Main Animation & Render Function
     */
    function renderCurrentFrame() {
        if (!imagesList || imagesList.length === 0) return;

        const currentItem = imagesList[currentIndex];
        metaTime.textContent = currentItem.timestamp || 'UTC';
        frameIndexDisplay.textContent = `${currentIndex + 1} / ${imagesList.length}`;
        timelineScrubber.value = currentIndex;

        const img = loadedImagesMap.get(currentItem.proxyUrl);
        if (!img) return;

        // Resize Canvas to Match Image Native Dimensions
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
            canvas.width = img.naturalWidth || 800;
            canvas.height = img.naturalHeight || 600;
        }

        const mode = compModeSelect.value;
        const bVal = brightnessSlider.value / 100;
        const cVal = contrastSlider.value / 100;
        const colormap = colormapSelect.value;

        // Apply CSS Filters & Zoom Transforms
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.translate(originX, originY);
        ctx.scale(scale, scale);

        if (mode === 'sum') {
            renderSumAccumulation(currentIndex, bVal, cVal, colormap);
        } else if (mode === 'max') {
            renderMaxProjection(currentIndex, bVal, cVal, colormap);
        } else {
            // Normal Frame Rendering with Filters
            applyCanvasFilters(ctx, bVal, cVal, colormap);
            ctx.drawImage(img, 0, 0);
        }

        ctx.restore();
    }

    /**
     * SUM (Pixel Accumulation Mode)
     * Sums pixel intensities across all frames up to currentIndex to reveal storm trails!
     */
    function renderSumAccumulation(upToIndex, brightness, contrast, colormap) {
        const width = canvas.width;
        const height = canvas.height;

        const sumCanvas = document.createElement('canvas');
        sumCanvas.width = width;
        sumCanvas.height = height;
        const sCtx = sumCanvas.getContext('2d');

        // Draw first frame
        const firstImg = loadedImagesMap.get(imagesList[0].proxyUrl);
        if (!firstImg) return;
        sCtx.drawImage(firstImg, 0, 0);

        // Blend subsequent frames with lighter blend mode for accumulation sum
        sCtx.globalCompositeOperation = 'lighter';
        sCtx.globalAlpha = 0.5;

        for (let i = 1; i <= upToIndex; i++) {
            const frameImg = loadedImagesMap.get(imagesList[i].proxyUrl);
            if (frameImg) {
                sCtx.drawImage(frameImg, 0, 0);
            }
        }

        applyCanvasFilters(ctx, brightness, contrast, colormap);
        ctx.drawImage(sumCanvas, 0, 0);
    }

    /**
     * Maximum Intensity Projection (MIP)
     */
    function renderMaxProjection(upToIndex, brightness, contrast, colormap) {
        const width = canvas.width;
        const height = canvas.height;

        const maxCanvas = document.createElement('canvas');
        maxCanvas.width = width;
        maxCanvas.height = height;
        const mCtx = maxCanvas.getContext('2d');

        mCtx.globalCompositeOperation = 'lighten';

        for (let i = 0; i <= upToIndex; i++) {
            const frameImg = loadedImagesMap.get(imagesList[i].proxyUrl);
            if (frameImg) {
                mCtx.drawImage(frameImg, 0, 0);
            }
        }

        applyCanvasFilters(ctx, brightness, contrast, colormap);
        ctx.drawImage(maxCanvas, 0, 0);
    }

    /**
     * Applies Brightness, Contrast & Colormap Filters
     */
    function applyCanvasFilters(context, bVal, cVal, colormap) {
        let filterStr = `brightness(${bVal}) contrast(${cVal})`;

        if (colormap === 'grayscale') {
            filterStr += ' grayscale(100%)';
        } else if (colormap === 'invert') {
            filterStr += ' invert(100%)';
        } else if (colormap === 'thermal') {
            filterStr += ' hue-rotate(180deg) saturate(200%)';
        } else if (colormap === 'rainbow') {
            filterStr += ' hue-rotate(90deg) saturate(250%)';
        }

        context.filter = filterStr;
    }

    /**
     * Playback Loop Handler
     */
    function togglePlay() {
        if (isPlaying) {
            pause();
        } else {
            play();
        }
    }

    function play() {
        if (!imagesList || imagesList.length === 0) return;
        isPlaying = true;
        playIcon.textContent = '⏸';
        playText.textContent = 'Pausar';
        lastFrameTime = performance.now();
        animLoop();
    }

    function pause() {
        isPlaying = false;
        playIcon.textContent = '▶';
        playText.textContent = 'Tocar';
        if (animTimer) cancelAnimationFrame(animTimer);
    }

    function animLoop(now) {
        if (!isPlaying) return;

        const interval = 1000 / fps;
        const delta = now - lastFrameTime;

        if (delta >= interval) {
            currentIndex = (currentIndex + 1) % imagesList.length;
            renderCurrentFrame();
            lastFrameTime = now - (delta % interval);
        }

        animTimer = requestAnimationFrame(animLoop);
    }

    function stepFrame(dir) {
        pause();
        currentIndex = (currentIndex + dir + imagesList.length) % imagesList.length;
        renderCurrentFrame();
    }

    /**
     * Zoom & Pan Functions
     */
    function adjustZoom(factor) {
        scale *= factor;
        scale = Math.min(Math.max(0.5, scale), 5.0);
        renderCurrentFrame();
    }

    function resetZoom() {
        scale = 1;
        originX = 0;
        originY = 0;
        renderCurrentFrame();
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            canvasWrapper.requestFullscreen().catch(err => alert(err.message));
        } else {
            document.exitFullscreen();
        }
    }

    /**
     * Live Canvas Video Recorder (MediaRecorder WebM/MP4)
     */
    function toggleLiveRecording() {
        if (isRecordingLive) {
            stopLiveRecording();
        } else {
            startLiveRecording();
        }
    }

    function startLiveRecording() {
        try {
            const stream = canvas.captureStream(fps);
            recordedChunks = [];

            const options = { mimeType: 'video/webm;codecs=vp9' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                delete options.mimeType;
            }

            mediaRecorder = new MediaRecorder(stream, options);

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `goes_animation_${new Date().getTime()}.webm`;
                a.click();
                URL.revokeObjectURL(url);
            };

            mediaRecorder.start();
            isRecordingLive = true;
            btnRecordLive.classList.add('recording');
            recordLiveText.textContent = 'Parar Gravação';
            play(); // Auto play when recording starts
        } catch (e) {
            alert(`Gravação não suportada no navegador: ${e.message}`);
        }
    }

    function stopLiveRecording() {
        if (mediaRecorder && isRecordingLive) {
            mediaRecorder.stop();
            isRecordingLive = false;
            btnRecordLive.classList.remove('recording');
            recordLiveText.textContent = 'Gravar Vídeo ao Vivo';
        }
    }

    /**
     * Server-side MP4 Export
     */
    async function exportServerMp4() {
        if (!imagesList || imagesList.length === 0) return;
        showLoader('Gerando vídeo MP4 no servidor...');

        try {
            const rawUrls = imagesList.map(item => item.rawUrl);
            const resp = await fetch('/api/export-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    urls: rawUrls,
                    fps: fps,
                    sumMode: compModeSelect.value === 'sum'
                })
            });

            if (!resp.ok) throw new Error('Falha na geração do MP4');

            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `goes16_animacao_${new Date().getTime()}.mp4`;
            a.click();
            URL.revokeObjectURL(url);
            hideLoader();
        } catch (e) {
            alert(`Erro ao exportar MP4: ${e.message}`);
            hideLoader();
        }
    }

    /**
     * Server-side GIF Export
     */
    async function exportServerGif() {
        if (!imagesList || imagesList.length === 0) return;
        showLoader('Gerando GIF animado no servidor...');

        try {
            const rawUrls = imagesList.map(item => item.rawUrl);
            const resp = await fetch('/api/export-gif', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    urls: rawUrls,
                    fps: fps
                })
            });

            if (!resp.ok) throw new Error('Falha na geração do GIF');

            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `goes16_animacao_${new Date().getTime()}.gif`;
            a.click();
            URL.revokeObjectURL(url);
            hideLoader();
        } catch (e) {
            alert(`Erro ao exportar GIF: ${e.message}`);
            hideLoader();
        }
    }

    /**
     * Canvas Snapshot Download
     */
    function takeSnapshot() {
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `goes_snapshot_${imagesList[currentIndex]?.filename || 'frame'}.png`;
        a.click();
    }

    // Helper Loader Functions
    function showLoader(msg = 'Carregando...', showSpinner = true) {
        loaderText.textContent = msg;
        loaderOverlay.classList.remove('hidden');
    }

    function hideLoader() {
        loaderOverlay.classList.add('hidden');
    }
});
