/**
 * Anima CPTEC - Satellite GOES-19 & GOES-16 Image Animator & Processor
 */

document.addEventListener('DOMContentLoaded', () => {
    // State Variables
    let rawImagesList = [];
    let activeImagesList = [];
    let loadedImagesMap = new Map(); // url -> HTMLImageElement
    let currentIndex = 0;
    let isPlaying = false;
    let isReverse = false;
    let fps = 10;
    let animTimer = null;
    let lastFrameTime = 0;
    let stepInterval = 1;

    // Viewport Zoom & Pan State
    let scale = 1;
    let originX = 0;
    let originY = 0;
    let isDragging = false;
    let dragMoved = false;
    let startX = 0, startY = 0;
    let mouseDownX = 0, mouseDownY = 0;

    // DOM Elements
    const canvas = document.getElementById('sat-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const loaderOverlay = document.getElementById('loader-overlay');
    const loaderText = document.getElementById('loader-text');

    // Controls
    const satSelect = document.getElementById('satellite-select');
    const channelSelect = document.getElementById('channel-select');
    const dateStartInput = document.getElementById('date-start');
    const dateEndInput = document.getElementById('date-end');
    const btnFetch = document.getElementById('btn-fetch');
    const stepSelect = document.getElementById('step-select');
    const qaFilterToggle = document.getElementById('qa-filter-toggle');
    const chipButtons = document.querySelectorAll('.btn-chip');

    // Cache Controls
    const cacheSizeBadge = document.getElementById('cache-size-badge');
    const cacheRetentionSelect = document.getElementById('cache-retention-select');
    const btnClearCache = document.getElementById('btn-clear-cache');

    // Processing Controls
    const compModeSelect = document.getElementById('composition-mode');
    const colormapSelect = document.getElementById('colormap-select');
    const brightnessSlider = document.getElementById('slider-brightness');
    const contrastSlider = document.getElementById('slider-contrast');
    const valBrightness = document.getElementById('val-brightness');
    const valContrast = document.getElementById('val-contrast');

    // Playback Controls (Top Toolbar Bar)
    const btnReverse = document.getElementById('btn-reverse');
    const btnPlay = document.getElementById('btn-play');
    const playIcon = document.getElementById('play-icon');
    const playText = document.getElementById('play-text');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const timelineScrubber = document.getElementById('timeline-scrubber');
    const fpsSlider = document.getElementById('fps-slider');
    const fpsDisplay = document.getElementById('fps-display');
    const frameIndexDisplay = document.getElementById('frame-index-display');
    const frameCounterBadge = document.getElementById('frame-counter-badge');
    const btnSnapshotFrame = document.getElementById('btn-snapshot-frame');

    // Metadata Badges
    const metaSat = document.getElementById('meta-satellite');
    const metaProd = document.getElementById('meta-product');
    const metaDir = document.getElementById('meta-dir');
    const metaTime = document.getElementById('meta-timestamp');

    // Zoom Buttons
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnZoomReset = document.getElementById('btn-zoom-reset');
    const btnFullscreen = document.getElementById('btn-fullscreen');

    // Default Date Range: 1 Day Default (Today)
    const today = new Date().toISOString().split('T')[0];
    dateEndInput.value = today;
    dateStartInput.value = today;

    // Initial Cache & Image Fetch
    updateCacheInfo();
    fetchSatelliteImages();

    // Event Listeners
    btnFetch.addEventListener('click', fetchSatelliteImages);
    btnPlay.addEventListener('click', togglePlay);
    btnReverse.addEventListener('click', toggleReverse);
    btnPrev.addEventListener('click', () => stepFrame(-1));
    btnNext.addEventListener('click', () => stepFrame(1));
    btnSnapshotFrame.addEventListener('click', saveDisplayedImage);
    btnClearCache.addEventListener('click', handleClearCache);

    // Quick Range Chip Buttons
    chipButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            chipButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const days = parseInt(btn.dataset.days, 10);
            const refEnd = new Date(dateEndInput.value || new Date());
            const refStart = new Date(refEnd);
            refStart.setDate(refEnd.getDate() - (days - 1));

            dateStartInput.value = refStart.toISOString().split('T')[0];
            fetchSatelliteImages();
        });
    });

    // Step Skipping & QA Filter Toggle Listeners
    stepSelect.addEventListener('change', () => {
        stepInterval = parseInt(stepSelect.value, 10) || 1;
        applyStepSkipping();
    });

    qaFilterToggle.addEventListener('change', () => {
        preloadImages(rawImagesList);
    });

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

    // Zoom Buttons
    btnZoomIn.addEventListener('click', () => adjustZoom(1.3));
    btnZoomOut.addEventListener('click', () => adjustZoom(0.7));
    btnZoomReset.addEventListener('click', resetZoom);
    btnFullscreen.addEventListener('click', toggleFullscreen);

    // Precise Mouse Click / Drag / Touch Events for Click-to-Zoom & Framing
    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragMoved = false;
        mouseDownX = e.clientX;
        mouseDownY = e.clientY;
        startX = e.clientX - originX;
        startY = e.clientY - originY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = Math.abs(e.clientX - mouseDownX);
        const dy = Math.abs(e.clientY - mouseDownY);
        if (dx > 4 || dy > 4) {
            dragMoved = true;
        }
        originX = e.clientX - startX;
        originY = e.clientY - startY;
        renderCurrentFrame();
    });

    window.addEventListener('mouseup', (e) => {
        if (isDragging && !dragMoved && e.target === canvas) {
            handleCanvasClickZoom(e);
        }
        isDragging = false;
    });

    // Touch events for touch-to-zoom
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            mouseDownX = touch.clientX;
            mouseDownY = touch.clientY;
            startX = touch.clientX - originX;
            startY = touch.clientY - originY;
            isDragging = true;
            dragMoved = false;
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (!isDragging || e.touches.length !== 1) return;
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - mouseDownX);
        const dy = Math.abs(touch.clientY - mouseDownY);
        if (dx > 4 || dy > 4) dragMoved = true;
        originX = touch.clientX - startX;
        originY = touch.clientY - startY;
        renderCurrentFrame();
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
        if (isDragging && !dragMoved && e.changedTouches.length === 1) {
            const touch = e.changedTouches[0];
            handleCanvasClickZoom(touch);
        }
        isDragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.18 : 0.82;
        zoomTowardsPoint(e.clientX, e.clientY, factor);
    });

    /**
     * Mouse Click-to-Zoom & Center Framing Algorithm
     * Converts CSS screen coordinates to canvas internal pixel dimensions!
     */
    function handleCanvasClickZoom(e) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        // Scaling factor between rendered CSS size and actual canvas internal resolution
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        // Click position in internal canvas pixels
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;

        // Image coordinates corresponding to click point
        const imgX = (canvasX - originX) / scale;
        const imgY = (canvasY - originY) / scale;

        // Target zoom scale step
        let nextScale = scale < 1.8 ? 2.5 : scale * 1.5;
        if (nextScale > 5.5) nextScale = 1.0;

        let nextOriginX = (canvas.width / 2) - (imgX * nextScale);
        let nextOriginY = (canvas.height / 2) - (imgY * nextScale);

        if (nextScale === 1.0) {
            nextOriginX = 0;
            nextOriginY = 0;
        }

        smoothAnimateZoom(nextScale, nextOriginX, nextOriginY);
    }

    /**
     * Zoom Towards Mouse Cursor on Wheel Scroll
     */
    function zoomTowardsPoint(clientX, clientY, factor) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const canvasX = (clientX - rect.left) * scaleX;
        const canvasY = (clientY - rect.top) * scaleY;

        const imgX = (canvasX - originX) / scale;
        const imgY = (canvasY - originY) / scale;

        let newScale = scale * factor;
        newScale = Math.min(Math.max(0.5, newScale), 6.0);

        originX = canvasX - (imgX * newScale);
        originY = canvasY - (imgY * newScale);
        scale = newScale;

        renderCurrentFrame();
    }

    /**
     * Smoothly Animates Zoom & Pan Framing Transition
     */
    function smoothAnimateZoom(tScale, tOrgX, tOrgY) {
        const startS = scale;
        const startOx = originX;
        const startOy = originY;

        const startTime = performance.now();
        const duration = 260;

        function stepZoom(now) {
            const progress = Math.min((now - startTime) / duration, 1.0);
            const ease = 1 - Math.pow(1 - progress, 3);

            scale = startS + (tScale - startS) * ease;
            originX = startOx + (tOrgX - startOx) * ease;
            originY = startOy + (tOrgY - startOy) * ease;

            renderCurrentFrame();

            if (progress < 1.0) {
                requestAnimationFrame(stepZoom);
            }
        }

        requestAnimationFrame(stepZoom);
    }

    /**
     * Cache Info Status Updater
     */
    async function updateCacheInfo() {
        try {
            const resp = await fetch('/api/cache-info');
            const data = await resp.json();
            if (data.success) {
                cacheSizeBadge.textContent = `${data.sizeMB} MB (${data.fileCount} arquivos)`;
            }
        } catch (e) {
            console.warn('Error reading cache info:', e);
        }
    }

    /**
     * Handle Clear Cache Request
     */
    async function handleClearCache() {
        const days = cacheRetentionSelect.value;
        const confirmMsg = days === '0' ? 
            'Tem certeza que deseja apagar TODO o cache de imagens baixadas?' :
            `Tem certeza que deseja apagar imagens em cache com mais de ${days} dias?`;

        if (!confirm(confirmMsg)) return;

        try {
            const resp = await fetch('/api/clear-cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ days: days === '0' ? 0 : parseInt(days, 10) })
            });
            const data = await resp.json();
            if (data.success) {
                alert(`Cache limpo! Removidos ${data.deletedCount} arquivos (${data.freedMB} MB liberados).`);
                updateCacheInfo();
            }
        } catch (e) {
            alert(`Erro ao limpar cache: ${e.message}`);
        }
    }

    /**
     * Fetch satellite images metadata from Flask Backend across date range
     */
    async function fetchSatelliteImages() {
        showLoader('Buscando acervo CPTEC/INPE (GOES-19 CH13)...');
        pause();

        const satellite = satSelect.value;
        const channel = channelSelect.value;
        const startDate = dateStartInput.value;
        const endDate = dateEndInput.value;

        metaSat.textContent = satellite.toUpperCase();
        metaProd.textContent = channelSelect.options[channelSelect.selectedIndex].text.split('(')[0].trim();

        try {
            const resp = await fetch('/api/fetch-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ satellite, sector: 'ams', channel, startDate, endDate })
            });

            const data = await resp.json();

            if (!data.success || !data.images || data.images.length === 0) {
                showLoader(`Nenhuma imagem encontrada para o período selecionado.`, false);
                frameCounterBadge.textContent = '0 Quadros';
                rawImagesList = [];
                activeImagesList = [];
                return;
            }

            rawImagesList = data.images;
            stepInterval = parseInt(stepSelect.value, 10) || 1;

            await preloadImages(rawImagesList);
            updateCacheInfo();
            hideLoader();

            resetZoom();
            renderCurrentFrame();

        } catch (err) {
            showLoader(`Erro de conexão com o servidor: ${err.message}`, false);
        }
    }

    /**
     * Preloads images asynchronously
     */
    async function preloadImages(list) {
        showLoader(`Inspecionando e carregando ${list.length} quadros de satélite...`);

        const validItems = [];
        const useQA = qaFilterToggle.checked;

        const promises = list.map((item) => {
            return new Promise((resolve) => {
                if (loadedImagesMap.has(item.proxyUrl)) {
                    const img = loadedImagesMap.get(item.proxyUrl);
                    if (!useQA || inspectImageQuality(img).isValid) {
                        validItems.push(item);
                    }
                    resolve();
                    return;
                }

                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.onload = () => {
                    if (img.naturalWidth > 100 && img.naturalHeight > 100) {
                        const qaResult = useQA ? inspectImageQuality(img) : { isValid: true };
                        if (qaResult.isValid) {
                            loadedImagesMap.set(item.proxyUrl, img);
                            validItems.push(item);
                        } else {
                            console.warn(`[QA Protocol Frontend] Rejeitada (${item.filename}): ${qaResult.reason}`);
                        }
                    }
                    loaderText.textContent = `Validando acervo: ${validItems.length} quadros aprovados de ${list.length}`;
                    resolve();
                };
                img.onerror = () => {
                    console.warn(`[QA Protocol Backend/Network] Imagem descartada (${item.filename})`);
                    resolve();
                };
                img.src = item.proxyUrl;
            });
        });

        await Promise.all(promises);

        rawImagesList = validItems.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        applyStepSkipping();
    }

    /**
     * Filter activeImagesList based on stepInterval
     */
    function applyStepSkipping() {
        if (!rawImagesList || rawImagesList.length === 0) return;

        activeImagesList = [];
        for (let i = 0; i < rawImagesList.length; i += stepInterval) {
            activeImagesList.push(rawImagesList[i]);
        }

        if (activeImagesList.length === 0) {
            frameCounterBadge.textContent = '0 Quadros (QA Rejeitou Todas)';
            return;
        }

        currentIndex = isReverse ? activeImagesList.length - 1 : 0;
        timelineScrubber.max = activeImagesList.length - 1;
        timelineScrubber.value = currentIndex;

        const filterStatus = qaFilterToggle.checked ? ' (QA Anti-Pretas Ativo)' : '';
        frameCounterBadge.textContent = `${activeImagesList.length} Quadros Limpos${filterStatus}`;
        renderCurrentFrame();
    }

    /**
     * Inspect Image Quality Protocol
     */
    function inspectImageQuality(img) {
        try {
            const w = img.naturalWidth;
            const h = img.naturalHeight;

            if (h < 350 || (w / h) > 2.2) {
                return { isValid: false, reason: `Apenas barra de cabeçalho (${w}x${h})` };
            }

            const testCanvas = document.createElement('canvas');
            const tw = 100;
            const th = Math.round((h / w) * tw) || 100;
            testCanvas.width = tw;
            testCanvas.height = th;

            const tCtx = testCanvas.getContext('2d');
            tCtx.drawImage(img, 0, 0, tw, th);

            const imgData = tCtx.getImageData(0, 0, tw, th).data;
            const totalPixels = tw * th;

            let darkPixels = 0;
            let bottomDarkPixels = 0;
            let bottomTotal = 0;

            const bottomStart = Math.floor(th * 0.82);

            for (let y = 0; y < th; y++) {
                for (let x = 0; x < tw; x++) {
                    const idx = (y * tw + x) * 4;
                    const r = imgData[idx];
                    const g = imgData[idx + 1];
                    const b = imgData[idx + 2];
                    const maxVal = Math.max(r, g, b);

                    if (maxVal < 25) {
                        darkPixels++;
                        if (y >= bottomStart) bottomDarkPixels++;
                    }
                    if (y >= bottomStart) bottomTotal++;
                }
            }

            const darkRatio = darkPixels / totalPixels;
            const bottomDarkRatio = bottomTotal > 0 ? bottomDarkPixels / bottomTotal : 0;

            if (darkRatio > 0.82) {
                return { isValid: false, reason: `Imagem totalmente escura (${Math.round(darkRatio * 100)}% de pixels pretos)` };
            }

            if (bottomDarkRatio > 0.90 && darkRatio < 0.70) {
                return { isValid: false, reason: `Imagem cortada na parte inferior (${Math.round(bottomDarkRatio * 100)}% de pixels pretos no rodapé)` };
            }

            return { isValid: true };
        } catch (err) {
            return { isValid: true };
        }
    }

    /**
     * Save currently displayed canvas frame as PNG
     */
    function saveDisplayedImage() {
        if (!activeImagesList || activeImagesList.length === 0) return;

        const currentItem = activeImagesList[currentIndex];
        const timestampStr = (currentItem.sortKey || 'frame').replace(/[^0-9]/g, '');
        const filename = `goes19_${channelSelect.value}_${timestampStr}.png`;

        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        a.click();
    }

    /**
     * Toggle Reverse Animation Mode
     */
    function toggleReverse() {
        isReverse = !isReverse;
        if (isReverse) {
            btnReverse.classList.add('active-reverse');
            metaDir.textContent = '◀️ Reversa';
        } else {
            btnReverse.classList.remove('active-reverse');
            metaDir.textContent = '➡️ Normal';
        }
    }

    /**
     * Main Render Function
     */
    function renderCurrentFrame() {
        if (!activeImagesList || activeImagesList.length === 0) return;

        const currentItem = activeImagesList[currentIndex];
        metaTime.textContent = currentItem.timestamp || 'UTC';
        frameIndexDisplay.textContent = `${currentIndex + 1}/${activeImagesList.length}`;
        timelineScrubber.value = currentIndex;

        const img = loadedImagesMap.get(currentItem.proxyUrl);
        if (!img) return;

        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
            canvas.width = img.naturalWidth || 800;
            canvas.height = img.naturalHeight || 600;
        }

        const mode = compModeSelect.value;
        const bVal = brightnessSlider.value / 100;
        const cVal = contrastSlider.value / 100;
        const colormap = colormapSelect.value;

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.translate(originX, originY);
        ctx.scale(scale, scale);

        if (mode === 'sum') {
            renderSumAccumulation(currentIndex, bVal, cVal, colormap);
        } else if (mode === 'max') {
            renderMaxProjection(currentIndex, bVal, cVal, colormap);
        } else {
            applyCanvasFilters(ctx, bVal, cVal, colormap);
            ctx.drawImage(img, 0, 0);
        }

        ctx.restore();
    }

    /**
     * SUM (Pixel Accumulation Mode)
     */
    function renderSumAccumulation(upToIndex, brightness, contrast, colormap) {
        const width = canvas.width;
        const height = canvas.height;

        const sumCanvas = document.createElement('canvas');
        sumCanvas.width = width;
        sumCanvas.height = height;
        const sCtx = sumCanvas.getContext('2d');

        const firstImg = loadedImagesMap.get(activeImagesList[0].proxyUrl);
        if (!firstImg) return;
        sCtx.drawImage(firstImg, 0, 0);

        sCtx.globalCompositeOperation = 'lighter';
        sCtx.globalAlpha = 0.5;

        for (let i = 1; i <= upToIndex; i++) {
            const frameImg = loadedImagesMap.get(activeImagesList[i].proxyUrl);
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
            const frameImg = loadedImagesMap.get(activeImagesList[i].proxyUrl);
            if (frameImg) {
                mCtx.drawImage(frameImg, 0, 0);
            }
        }

        applyCanvasFilters(ctx, brightness, contrast, colormap);
        ctx.drawImage(maxCanvas, 0, 0);
    }

    function applyCanvasFilters(context, bVal, cVal, colormap) {
        let filterStr = `brightness(${bVal}) contrast(${cVal})`;

        if (colormap === 'grayscale') filterStr += ' grayscale(100%)';
        else if (colormap === 'invert') filterStr += ' invert(100%)';
        else if (colormap === 'thermal') filterStr += ' hue-rotate(180deg) saturate(200%)';
        else if (colormap === 'rainbow') filterStr += ' hue-rotate(90deg) saturate(250%)';

        context.filter = filterStr;
    }

    /**
     * Playback Functions
     */
    function togglePlay() {
        if (isPlaying) pause();
        else play();
    }

    function play() {
        if (!activeImagesList || activeImagesList.length === 0) return;
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
            if (isReverse) {
                currentIndex = (currentIndex - 1 + activeImagesList.length) % activeImagesList.length;
            } else {
                currentIndex = (currentIndex + 1) % activeImagesList.length;
            }
            renderCurrentFrame();
            lastFrameTime = now - (delta % interval);
        }

        animTimer = requestAnimationFrame(animLoop);
    }

    function stepFrame(dir) {
        pause();
        const stepDir = isReverse ? -dir : dir;
        currentIndex = (currentIndex + stepDir + activeImagesList.length) % activeImagesList.length;
        renderCurrentFrame();
    }

    /**
     * Zoom Controls
     */
    function adjustZoom(factor) {
        scale *= factor;
        scale = Math.min(Math.max(0.5, scale), 6.0);
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

    // Helper Loader Functions
    function showLoader(msg = 'Carregando...', showSpinner = true) {
        loaderText.textContent = msg;
        loaderOverlay.classList.remove('hidden');
    }

    function hideLoader() {
        loaderOverlay.classList.add('hidden');
    }
});
