// qr-scanner.js - Zero dependency custom scanner with shared CameraManager integration
let scanInterval = null;
let isScanning = false;

window.startScanner = function () {
    const video = document.getElementById('qr-video');
    const canvas = document.getElementById('qr-canvas');
    const statusEl = document.getElementById('scan-status');

    if (!video || !canvas) return;

    // Voice prompt
    if (window.speak) window.speak("Scanner opened. Say 'scan QR' or 'scan it' to detect merchant.");

    const onStreamReady = (stream) => {
        isScanning = true;
        const checkReady = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                startScanLoop(video, canvas, statusEl);
            } else {
                setTimeout(checkReady, 50);
            }
        };
        video.onloadedmetadata = checkReady;
        checkReady();
    };

    if (typeof CameraManager !== 'undefined' && CameraManager.requestStream) {
        CameraManager.requestStream({
            consumerId: 'qr_scanner',
            facingMode: 'environment',
            videoElement: video
        })
        .then(onStreamReady)
        .catch(err => {
            console.error("Camera error:", err);
            if (statusEl) statusEl.textContent = '❌ Camera blocked. Use Upload below.';
        });
    } else {
        // Direct fallback
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
            .then(stream => {
                video.srcObject = stream;
                video.play();
                onStreamReady(stream);
            })
            .catch(err => {
                console.error("Camera error:", err);
                if (statusEl) statusEl.textContent = '❌ Camera blocked. Use Upload below.';
            });
    }
};

function startScanLoop(video, canvas, statusEl) {
    const ctx = canvas.getContext('2d');
    const useBarcodeDetector = ('BarcodeDetector' in window);
    let detector = null;

    if (useBarcodeDetector) {
        detector = new BarcodeDetector({ formats: ['qr_code'] });
    }

    scanInterval = setInterval(async () => {
        if (!isScanning || video.readyState < 2 || video.paused) return;

        // Draw current video frame onto hidden canvas
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
            if (useBarcodeDetector && detector) {
                // Fastest path: native browser ML
                const barcodes = await detector.detect(canvas);
                if (barcodes.length > 0) {
                    onScanSuccess(barcodes[0].rawValue, statusEl);
                    return;
                }
            }

            // Fallback: jsQR (pure JS decoder, works everywhere)
            if (typeof jsQR !== 'undefined') {
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imgData.data, imgData.width, imgData.height, {
                    inversionAttempts: 'dontInvert'
                });
                if (code && code.data) {
                    onScanSuccess(code.data, statusEl);
                }
            }
        } catch (e) {
            // Silently ignore per-frame errors
        }
    }, 150); // Scan ~6.7 frames per second
}

window.stopScanner = function () {
    isScanning = false;
    if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
    }
    if (typeof CameraManager !== 'undefined' && CameraManager.releaseStream) {
        CameraManager.releaseStream('qr_scanner');
    } else {
        const video = document.getElementById('qr-video');
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(t => t.stop());
            video.srcObject = null;
        }
    }
};

function onScanSuccess(decodedText, statusEl) {
    // For camera-based scans, stop the scanner and release stream
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
            statusEl.textContent = `❌ ${errorMsg}`;
            statusEl.style.color = '#ef4444';
        }
        if (window.speak) {
            window.speak("That QR code is not a valid UPI payment QR.");
        }
        return;
    }

    // 3. Populate Canonical Normalized Payment Session
    const norm = parsed.normalized;
    window.paymentSession = {
        merchantName: norm.recipientName,
        upiId: norm.recipientUpiId,
        amount: norm.amount !== null ? String(norm.amount) : '',
        qrAmount: norm.amount !== null ? String(norm.amount) : '',
        amountFixed: norm.amountFixed,
        currency: norm.currency,
        transactionRef: norm.transactionRef,
        transactionId: norm.transactionId,
        merchantCode: norm.merchantCode,
        note: norm.note,
        warnings: norm.warnings,
        source: 'QR',
        smartQR: parsed
    };

    if (statusEl) {
        statusEl.textContent = `✅ QR Verified: ${norm.recipientName}`;
        statusEl.style.color = '#b4f056';
    }

    // 4. Route to Payment Controller (Never Directly Authenticates)
    if (typeof window.setupPaymentScreen === 'function') {
        window.setupPaymentScreen(true); // pass true to indicate it came from a verified QR scan
    }
}

// ==========================================
// DOMContentLoaded: Wire up buttons
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Dev simulator button — demonstrates the FULL flow:
    // Scan → Payment screen (with fake merchant) → PIN → Success
    const simulateBtn = document.getElementById('btn-simulate-scan');
    if (simulateBtn) {
        simulateBtn.addEventListener('click', () => {
            // Stop camera if running
            if (typeof window.stopScanner === 'function') window.stopScanner();

            // Show 'detected' feedback on the scan status indicator
            const statusEl = document.getElementById('scan-status');
            if (statusEl) {
                statusEl.textContent = '✅ QR Code Detected!';
                statusEl.style.color = '#b4f056';
            }

            // Brief delay so user sees the detection feedback, then go to payment
            setTimeout(() => {
                onScanSuccess(
                    'upi://pay?pa=merchant.demo@okaxis&pn=SwiftPass%20Demo%20Store&am=499',
                    statusEl
                );
            }, 500);
        });
    }

    // Image upload: use jsQR to decode uploaded file
    const fileInput = document.getElementById('qr-upload');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const img = new Image();
            img.onload = () => {
                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = img.width;
                tmpCanvas.height = img.height;
                const ctx = tmpCanvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const imgData = ctx.getImageData(0, 0, img.width, img.height);

                // Try native BarcodeDetector first (async)
                if ('BarcodeDetector' in window) {
                    new BarcodeDetector({ formats: ['qr_code'] }).detect(tmpCanvas)
                        .then(barcodes => {
                            if (barcodes.length > 0) {
                                onScanSuccess(barcodes[0].rawValue);
                            } else if (typeof jsQR !== 'undefined') {
                                tryJsQROnImageData(imgData);
                            } else {
                                alert('No QR code found in the image.');
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
