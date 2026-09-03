// qr-scanner.js - Zero dependency custom scanner with exclusive camera arbitration
let scanInterval = null;
let isScanning = false;
window.isScannerActive = false;

window.startScanner = function () {
    window.isScannerActive = true;
    const video = document.getElementById('qr-video');
    const canvas = document.getElementById('qr-canvas');
    const statusEl = document.getElementById('scan-status');

    if (!video || !canvas) return;

    // 1. Yield camera from Privacy Vision to prevent hardware stream clashes
    if (typeof privacyVision !== 'undefined' && privacyVision.stop) {
        privacyVision.stop();
    }
    if (typeof CameraManager !== 'undefined' && CameraManager.stopAll) {
        CameraManager.stopAll();
    }

    video.muted = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('autoplay', 'true');

    if (statusEl) {
        statusEl.textContent = '🔍 Scanning QR code...';
        statusEl.style.color = '#b4f056';
    }

    // Auto-show test sample QR immediately for easy 1-tap testing
    if (typeof window.displayTestQR === 'function') {
        window.displayTestQR('upi://pay?pa=freshmart@icici&pn=FreshMart%20Store&am=499.00&cu=INR&tn=Groceries', 'FreshMart ₹499');
    }

    // Voice prompt
    if (window.speak) window.speak("Scanner opened. Align QR code inside the frame or tap a sample below.");

    const onStreamReady = (stream) => {
        isScanning = true;
        video.srcObject = stream;
        video.play().catch(e => console.warn('Video play catch:', e));

        let attempts = 0;
        const checkReady = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                startScanLoop(video, canvas, statusEl);
            } else if (attempts < 15) {
                attempts++;
                setTimeout(checkReady, 100);
            } else {
                canvas.width = 640;
                canvas.height = 480;
                startScanLoop(video, canvas, statusEl);
            }
        };
        video.onloadedmetadata = checkReady;
        checkReady();
    };

    // Camera Acquisition with Progressive Fallback
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
                console.warn('[qr-scanner.js] getUserMedia attempt failed:', constraints, e.name);
            }
        }

        console.warn('[qr-scanner.js] No live webcam available. Using visual interactive sample mode.');
        if (statusEl) {
            statusEl.textContent = '📷 Tap sample QR below to test scan';
            statusEl.style.color = '#b4f056';
        }
    };

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        tryGetUserMedia();
    }
};

function startScanLoop(video, canvas, statusEl) {
    const ctx = canvas.getContext('2d');
    const useBarcodeDetector = ('BarcodeDetector' in window);
    let detector = null;

    if (useBarcodeDetector) {
        try {
            detector = new BarcodeDetector({ formats: ['qr_code'] });
        } catch (e) {
            detector = null;
        }
    }

    if (scanInterval) clearInterval(scanInterval);

    scanInterval = setInterval(async () => {
        if (!isScanning || !window.isScannerActive || video.readyState < 2 || video.paused) return;

        // Draw current video frame onto hidden canvas
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
            if (useBarcodeDetector && detector) {
                const barcodes = await detector.detect(canvas);
                if (barcodes.length > 0 && barcodes[0].rawValue) {
                    onScanSuccess(barcodes[0].rawValue, statusEl);
                    return;
                }
            }

            // High Precision Fallback: jsQR with full contrast & inversion attempts
            if (typeof jsQR !== 'undefined') {
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imgData.data, imgData.width, imgData.height, {
                    inversionAttempts: 'attemptBoth'
                });
                if (code && code.data) {
                    onScanSuccess(code.data, statusEl);
                }
            }
        } catch (e) {
            // Silently ignore per-frame errors
        }
    }, 90);
}

window.stopScanner = function () {
    isScanning = false;
    window.isScannerActive = false;

    if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
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
        if (statusEl) {
            statusEl.textContent = '❌ QR Parser Module Error';
            statusEl.style.color = '#ef4444';
        }
        if (window.speak) window.speak("QR scanner error. Parser not available.");
        return;
    }

    // 2. Reject Malformed / Suspicious / Non-UPI QRs
    if (!parsed.valid) {
        const errorMsg = parsed.validation.errors[0]?.message || 'Invalid UPI QR code';
        console.warn('[qr-scanner.js] QR Rejected:', parsed.validation.errors);
        
        if (statusEl) {
            statusEl.textContent = `⚠️ Security Warning: ${errorMsg}`;
            statusEl.style.color = '#ef4444';
        }

        if (window.speak) {
            window.speak(`Warning. Scanned QR code failed security verification. ${errorMsg}`);
        }
        return;
    }

    // 3. Risk Flag Warning Interception
    if (parsed.riskFlags && parsed.riskFlags.length > 0) {
        console.warn('[qr-scanner.js] Risk flags detected on QR:', parsed.riskFlags);
        if (window.speak) {
            window.speak(`Security notice: ${parsed.riskFlags[0].message}`);
        }
    }

    // 4. Start Formal Transaction State Machine
    const sm = window.TransactionStateMachine;
    if (sm) {
        try {
            sm.startIntent({
                source: 'QR_SCAN',
                rawData: parsed
            });
            sm.resolveRecipient({
                name: parsed.merchantName,
                upiId: parsed.upiId,
                verifiedName: parsed.verifiedName || parsed.merchantName,
                bank: parsed.bankCode || 'UPI'
            });
            sm.verifyRecipient({
                verifiedName: parsed.verifiedName || parsed.merchantName,
                bank: parsed.bankCode || 'UPI'
            });
        } catch (e) {
            console.error('[qr-scanner.js] State Machine initialization failed:', e);
        }
    }

    // 5. Store active session
    window.paymentSession = {
        merchantName: parsed.merchantName || 'Merchant',
        upiId: parsed.upiId,
        amount: parsed.amount ? parsed.amount.toFixed(2) : '',
        amountFixed: parsed.amountFixed || Boolean(parsed.amount),
        source: 'QR_SCAN',
        rawUri: parsed.rawUri
    };

    // 6. Provide tactile and audio feedback
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);

    if (statusEl) {
        statusEl.textContent = `✓ Scanned: ${parsed.merchantName || parsed.upiId}`;
        statusEl.style.color = '#10b981';
    }

    // 7. Transition smoothly to Payment Screen
    setTimeout(() => {
        if (typeof showScreen === 'function') {
            showScreen('payment-screen');
        }
        if (typeof window.setupPaymentScreen === 'function') {
            window.setupPaymentScreen(true);
        }
    }, 300);
}

// Dev bypass button
document.addEventListener('DOMContentLoaded', () => {
    const simBtn = document.getElementById('btn-simulate-scan');
    if (simBtn) {
        simBtn.addEventListener('click', () => {
            onScanSuccess('upi://pay?pa=freshmart@icici&pn=FreshMart%20Store&am=499.00&cu=INR&tn=Groceries');
        });
    }

    // ML QR Image Upload Input
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

                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                if ('BarcodeDetector' in window) {
                    const detector = new BarcodeDetector({ formats: ['qr_code'] });
                    detector.detect(canvas)
                        .then(barcodes => {
                            if (barcodes.length > 0 && barcodes[0].rawValue) {
                                onScanSuccess(barcodes[0].rawValue);
                            } else {
                                tryJsQROnImageData(imgData);
                            }
                        })
                        .catch(() => tryJsQROnImageData(imgData));
                } else {
                    tryJsQROnImageData(imgData);
                }
                fileInput.value = '';
            };
            img.src = URL.createObjectURL(file);
        });
    }
});

function tryJsQROnImageData(imgData) {
    if (typeof jsQR === 'undefined') {
        alert('QR decoder not loaded. Please try again.');
        return;
    }
    const code = jsQR(imgData.data, imgData.width, imgData.height);
    if (code && code.data) {
        onScanSuccess(code.data);
    } else {
        alert('Could not detect a QR code in that image. Try a clearer photo.');
    }
}

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
        titleEl.textContent = `Point camera or tap QR to scan & pay ${title}`;
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

    // Clicking the QR simulates scanning it directly
    holder.onclick = () => {
        if (typeof window.stopScanner === 'function') window.stopScanner();
        const statusEl = document.getElementById('scan-status');
        if (statusEl) {
            statusEl.textContent = '✅ Scanned ' + title;
            statusEl.style.color = '#b4f056';
        }
        setTimeout(() => {
            onScanSuccess(upiUri, statusEl);
        }, 300);
    };
};
