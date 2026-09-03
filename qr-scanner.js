// qr-scanner.js - 60 FPS Continuous QR Scanner with Local jsQR Engine & Camera Arbitration
let isScanning = false;
let scanAnimationId = null;
let scanStartTime = Date.now();
window.isScannerActive = false;

window.startScanner = function () {
    window.isScannerActive = true;
    const video = document.getElementById('qr-video');
    const canvas = document.getElementById('qr-canvas');
    const statusEl = document.getElementById('scan-status');

    if (!video || !canvas) return;

    // 1. Yield camera from Privacy Vision
    if (typeof privacyVision !== 'undefined' && privacyVision.stop) {
        privacyVision.stop();
    }

    video.muted = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('autoplay', 'true');

    if (statusEl) {
        statusEl.textContent = '🔍 Align QR code inside the frame';
        statusEl.style.color = '#b4f056';
    }

    // Auto-show test sample QR immediately for easy 1-tap testing
    if (typeof window.displayTestQR === 'function') {
        window.displayTestQR('upi://pay?pa=freshmart@icici&pn=FreshMart%20Store&am=499.00&cu=INR&tn=Groceries', 'FreshMart ₹499');
    }

    if (window.speak) window.speak("Scanner opened. Align QR code inside the frame.");

    const onStreamReady = (stream) => {
        isScanning = true;
        video.srcObject = stream;
        video.play().catch(e => console.warn('Video play error:', e));
        start60FpsScanLoop(video, canvas, statusEl);
    };

    // Camera Acquisition with Progressive Fallbacks
    const tryGetUserMedia = async () => {
        const attempts = [
            { video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
            { video: { facingMode: 'environment' }, audio: false },
            { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
            { video: true, audio: false }
        ];

        for (const constraints of attempts) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                if (stream && stream.active) {
                    onStreamReady(stream);
                    return;
                }
            } catch (e) {
                console.warn('[qr-scanner.js] Camera attempt note:', e.name);
            }
        }

        // If camera unavailable, still run interactive canvas loop
        isScanning = true;
        start60FpsScanLoop(video, canvas, statusEl);
    };

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        tryGetUserMedia();
    } else {
        isScanning = true;
        start60FpsScanLoop(video, canvas, statusEl);
    }
};

/**
 * 60 FPS Scan & Visual Laser Animation Loop
 */
function start60FpsScanLoop(video, canvas, statusEl) {
    const ctx = canvas.getContext('2d');
    const useBarcodeDetector = ('BarcodeDetector' in window);
    let detector = null;

    if (useBarcodeDetector) {
        try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; }
    }

    canvas.style.display = 'block';
    let frameCount = 0;

    const loop = async () => {
        if (!isScanning || !window.isScannerActive) return;

        const cw = canvas.parentElement ? canvas.parentElement.clientWidth : 320;
        const ch = canvas.parentElement ? canvas.parentElement.clientHeight : 320;
        canvas.width = cw;
        canvas.height = ch;

        // 1. Draw live camera frame if ready
        if (video && video.readyState >= 2 && video.videoWidth > 0) {
            ctx.drawImage(video, 0, 0, cw, ch);
        } else {
            // High-tech scanning grid background if camera connecting
            ctx.fillStyle = '#0a0e1a';
            ctx.fillRect(0, 0, cw, ch);
            ctx.strokeStyle = 'rgba(180, 240, 86, 0.1)';
            ctx.lineWidth = 1;
            for (let x = 0; x < cw; x += 25) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke(); }
            for (let y = 0; y < ch; y += 25) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke(); }
        }

        // 2. Render Animated Neon Green Laser Sweep
        const now = Date.now();
        const laserY = ((now % 2200) / 2200) * ch;
        const grad = ctx.createLinearGradient(0, laserY - 15, 0, laserY + 15);
        grad.addColorStop(0, 'rgba(180, 240, 86, 0)');
        grad.addColorStop(0.5, 'rgba(180, 240, 86, 0.85)');
        grad.addColorStop(1, 'rgba(180, 240, 86, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, laserY - 15, cw, 30);

        ctx.strokeStyle = '#b4f056';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, laserY);
        ctx.lineTo(cw, laserY);
        ctx.stroke();

        // 3. Scan QR Code every 3 frames (~20 scans/sec)
        frameCount++;
        if (frameCount % 3 === 0 && typeof jsQR !== 'undefined') {
            try {
                const imgData = ctx.getImageData(0, 0, cw, ch);
                const code = jsQR(imgData.data, imgData.width, imgData.height, {
                    inversionAttempts: 'attemptBoth'
                });

                if (code && code.data && code.data.trim()) {
                    // Draw highlight around detected QR
                    if (code.location) {
                        ctx.strokeStyle = '#10b981';
                        ctx.lineWidth = 4;
                        ctx.beginPath();
                        ctx.moveTo(code.location.topLeftCorner.x, code.location.topLeftCorner.y);
                        ctx.lineTo(code.location.topRightCorner.x, code.location.topRightCorner.y);
                        ctx.lineTo(code.location.bottomRightCorner.x, code.location.bottomRightCorner.y);
                        ctx.lineTo(code.location.bottomLeftCorner.x, code.location.bottomLeftCorner.y);
                        ctx.closePath();
                        ctx.stroke();
                    }

                    onScanSuccess(code.data, statusEl);
                    return;
                }
            } catch (e) {}
        }

        scanAnimationId = requestAnimationFrame(loop);
    };

    if (scanAnimationId) cancelAnimationFrame(scanAnimationId);
    scanAnimationId = requestAnimationFrame(loop);
}

window.stopScanner = function () {
    isScanning = false;
    window.isScannerActive = false;

    if (scanAnimationId) {
        cancelAnimationFrame(scanAnimationId);
        scanAnimationId = null;
    }

    const video = document.getElementById('qr-video');
    if (video && video.srcObject) {
        try {
            video.srcObject.getTracks().forEach(t => t.stop());
        } catch (e) {}
        video.srcObject = null;
    }

    // Resume Privacy Vision after scanner closed
    setTimeout(() => {
        if (!window.isScannerActive && typeof privacyVision !== 'undefined' && privacyVision.start) {
            privacyVision.start({ showDebugCanvas: true });
        }
    }, 400);
};

function onScanSuccess(decodedText, statusEl) {
    window.stopScanner();

    // 1. Run Deterministic Smart QR Parser & Security Validation
    let parsed;
    if (typeof parseSmartUPIQR === 'function') {
        parsed = parseSmartUPIQR(decodedText);
    } else if (typeof SmartQRParser !== 'undefined' && SmartQRParser.parseSmartUPIQR) {
        parsed = SmartQRParser.parseSmartUPIQR(decodedText);
    } else {
        console.error('[qr-scanner.js] SmartQRParser module is missing.');
        return;
    }

    // 2. Reject Malformed / Suspicious / Non-UPI QRs
    if (!parsed.valid) {
        const errorMsg = parsed.validation.errors[0]?.message || 'Invalid UPI QR code';
        if (statusEl) {
            statusEl.textContent = `⚠️ Security Warning: ${errorMsg}`;
            statusEl.style.color = '#ef4444';
        }
        if (window.speak) window.speak(`Warning. Scanned QR code failed security verification.`);
        return;
    }

    // 3. Store active session
    window.paymentSession = {
        merchantName: parsed.merchantName || 'Merchant',
        upiId: parsed.upiId,
        amount: parsed.amount ? parsed.amount.toFixed(2) : '',
        amountFixed: parsed.amountFixed || Boolean(parsed.amount),
        source: 'QR_SCAN',
        rawUri: parsed.rawUri
    };

    // 4. Provide tactile and audio feedback
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);

    if (statusEl) {
        statusEl.textContent = `✓ Scanned: ${parsed.merchantName || parsed.upiId}`;
        statusEl.style.color = '#10b981';
    }

    // 5. Transition smoothly to Payment Screen
    setTimeout(() => {
        if (typeof showScreen === 'function') {
            showScreen('payment-screen');
        }
        if (typeof window.setupPaymentScreen === 'function') {
            window.setupPaymentScreen(true);
        }
    }, 250);
}

// Dev bypass & Upload handling
document.addEventListener('DOMContentLoaded', () => {
    const simBtn = document.getElementById('btn-simulate-scan');
    if (simBtn) {
        simBtn.addEventListener('click', () => {
            onScanSuccess('upi://pay?pa=freshmart@icici&pn=FreshMart%20Store&am=499.00&cu=INR&tn=Groceries');
        });
    }

    const fileInput = document.getElementById('qr-upload');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                if (typeof jsQR !== 'undefined') {
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'attemptBoth' });
                    if (code && code.data) {
                        onScanSuccess(code.data);
                        return;
                    }
                }
                alert('Could not detect a QR code in that image. Try a clearer photo.');
            };
            img.src = URL.createObjectURL(file);
        });
    }
});

/**
 * Display dynamic test scannable QR in Scanner Screen
 */
window.displayTestQR = function (upiUri, title) {
    const modal = document.getElementById('sample-qr-modal');
    const holder = document.getElementById('sample-qr-canvas-holder');
    const titleEl = document.getElementById('sample-qr-title');

    if (!modal || !holder) return;
    modal.style.display = 'flex';
    holder.innerHTML = '';

    if (titleEl) {
        titleEl.textContent = `Tap QR to instant scan & pay ${title}`;
    }

    if (typeof myQREngine !== 'undefined' && myQREngine.generateMatrix) {
        const matrix = myQREngine.generateMatrix(upiUri);
        const canvas = document.createElement('canvas');
        canvas.width = 158;
        canvas.height = 158;
        const ctx = canvas.getContext('2d');
        const size = matrix.length;
        const cell = 158 / size;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 158, 158);
        ctx.fillStyle = '#000000';

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (matrix[r][c]) {
                    ctx.fillRect(c * cell, r * cell, Math.ceil(cell), Math.ceil(cell));
                }
            }
        }
        canvas.style.borderRadius = '8px';
        canvas.style.cursor = 'pointer';
        holder.appendChild(canvas);
    }

    holder.onclick = () => {
        if (typeof window.stopScanner === 'function') window.stopScanner();
        const statusEl = document.getElementById('scan-status');
        if (statusEl) {
            statusEl.textContent = '✅ Scanned ' + title;
            statusEl.style.color = '#b4f056';
        }
        setTimeout(() => {
            onScanSuccess(upiUri, statusEl);
        }, 200);
    };
};
