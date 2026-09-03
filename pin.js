// pin.js — Accessible Draw-to-PIN using TensorFlow.js
const CORRECT_PIN = '1234';
const PIN_LENGTH = 4;

let enteredPin = '';
let isReviewing = false;

// Drawing & ML state
let mnistModel = null;
let isDrawing = false;
let drawTimeout = null;
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
let canvasCtx = null;
let canvasEl = null;

// Load the pre-trained MNIST transfer CNN model from Google TFJS examples
// Note: This model is trained on digits 0, 1, 2, 3, 4.
async function loadMnistModel() {
    if (mnistModel || !window.tf) return;
    try {
        console.log("Loading MNIST model...");
        mnistModel = await tf.loadLayersModel('https://storage.googleapis.com/tfjs-models/tfjs/mnist_transfer_cnn_v1/model.json');
        console.log('MNIST Model loaded successfully');
    } catch (e) {
        console.error('Failed to load MNIST model', e);
    }
}

window.showPinScreen = function () {
    const ps = document.getElementById('pin-screen');
    if (!ps) return;

    enteredPin = '';
    if (typeof showScreen === 'function') {
        showScreen('pin-screen');
    } else {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        ps.classList.add('active');
    }
    const nav = document.getElementById('main-nav');
    if (nav) nav.style.display = 'none';

    updatePinUI();
    hideConfirmBtns();
    hideDigitPreview();

    setInstruction(`Enter digit <b>1</b> of ${PIN_LENGTH}<br><span style="font-size:11px;opacity:0.6;">Draw the number anywhere on screen. Wait 1s to confirm.</span>`);
    initCanvasArea();
    loadMnistModel();

    if (window.speak) {
        window.speak("Enter your 4 digit PIN by drawing each digit on screen.");
    }
};

function initCanvasArea() {
    canvasEl = document.getElementById('pin-canvas');
    if (!canvasEl) return;

    // Resize canvas to match screen
    canvasEl.width = window.innerWidth;
    canvasEl.height = window.innerHeight;

    // Clean up old listeners to prevent duplicates
    canvasEl.replaceWith(canvasEl.cloneNode(true));
    canvasEl = document.getElementById('pin-canvas');
    
    canvasCtx = canvasEl.getContext('2d', { willReadFrequently: true });
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    canvasCtx.lineWidth = 18; // Thick stroke for better ML recognition
    canvasCtx.strokeStyle = '#b4f056';

    clearCanvas();

    // Use pointer events to capture both mouse clicks and touch events instantly
    canvasEl.addEventListener('pointerdown', startDrawing);
    canvasEl.addEventListener('pointermove', draw);
    canvasEl.addEventListener('pointerup', stopDrawing);
    canvasEl.addEventListener('pointerout', stopDrawing);
}

function clearCanvas() {
    if (canvasCtx && canvasEl) {
        canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
}

function startDrawing(e) {
    if (isReviewing || window._pinAwaitingVoice) return;
    isDrawing = true;
    if (drawTimeout) clearTimeout(drawTimeout);

    hideDigitPreview();

    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    canvasCtx.beginPath();
    canvasCtx.moveTo(x, y);
    updateBounds(x, y);
}

function draw(e) {
    if (!isDrawing) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    canvasCtx.lineTo(x, y);
    canvasCtx.stroke();
    updateBounds(x, y);
}

function stopDrawing(e) {
    if (!isDrawing) return;
    isDrawing = false;

    if (drawTimeout) clearTimeout(drawTimeout);
    
    // Provide immediate visual feedback for counting/processing
    const lb = document.getElementById('pin-recognized-label');
    if (lb) { lb.textContent = 'Processing drawing...'; lb.style.opacity = '0.8'; }

    // Wait 1.0 seconds after the last stroke to assume the user is done drawing the digit
    drawTimeout = setTimeout(() => {
        finalizeDrawing();
    }, 1000);
}

function updateBounds(x, y) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
}

async function finalizeDrawing() {
    if (!mnistModel) {
        // Fallback if model failed to load
        showRecognizedDigit("1");
        isReviewing = true;
        setTimeout(() => {
            confirmDigit("1");
            clearCanvas();
        }, 800);
        return;
    }

    // If nothing was drawn or bounds invalid
    if (minX === Infinity) return;

    // Crop the drawing
    const w = maxX - minX;
    const h = maxY - minY;

    // Ensure we don't have extremely tiny accidental touches
    if (w < 10 && h < 10) {
        clearCanvas();
        return;
    }

    // Create a 28x28 canvas for MNIST format
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 28;
    tempCanvas.height = 28;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

    // MNIST expects a black background with white strokes
    tempCtx.fillStyle = 'black';
    tempCtx.fillRect(0, 0, 28, 28);

    // Fit the drawn bounding box into a 20x20 area centered in the 28x28 canvas
    const maxDim = Math.max(w, h);
    const scale = 20 / maxDim;

    const scaledW = w * scale;
    const scaledH = h * scale;
    const dx = (28 - scaledW) / 2;
    const dy = (28 - scaledH) / 2;

    // Draw the cropped section onto the temp 28x28 canvas
    tempCtx.drawImage(
        canvasEl,
        minX - 10, minY - 10, w + 20, h + 20, // add a little padding from original bounds
        dx, dy, scaledW, scaledH
    );

    // Get image data
    const imgData = tempCtx.getImageData(0, 0, 28, 28);

    // Convert to Tensor
    const tensor = tf.tidy(() => {
        const data = new Float32Array(28 * 28);
        for (let i = 0; i < 28 * 28; i++) {
            const r = imgData.data[i * 4];
            const g = imgData.data[i * 4 + 1];
            const b = imgData.data[i * 4 + 2];
            // Convert to grayscale brightness (white strokes on black)
            const brightness = (r + g + b) / (3 * 255.0);
            data[i] = brightness;
        }
        return tf.tensor2d(data, [1, 784]).reshape([1, 28, 28, 1]);
    });

    // Predict
    const prediction = mnistModel.predict(tensor);
    const digit = prediction.argMax(1).dataSync()[0];

    tf.dispose([tensor, prediction]);

    showRecognizedDigit(digit.toString());

    // Auto confirm after a brief moment
    isReviewing = true;
    setTimeout(() => {
        confirmDigit(digit.toString());
        clearCanvas();
    }, 800);
}

function showRecognizedDigit(d) {
    const el = document.getElementById('pin-digit-preview');
    const lb = document.getElementById('pin-recognized-label');
    if (el) { el.textContent = d; el.style.opacity = '1'; }
    if (lb) { lb.textContent = 'Recognized digit'; lb.style.opacity = '1'; }

    if (window.speak && enteredPin.length < PIN_LENGTH) {
        window.speak(`Digit ${enteredPin.length + 1} recognized as ${d}.`);
    }
}

function hideDigitPreview() {
    document.getElementById('pin-digit-preview')?.style.setProperty('opacity', '0');
    document.getElementById('pin-recognized-label')?.style.setProperty('opacity', '0');
}

function hidePinScreen() {
    if (drawTimeout) { clearTimeout(drawTimeout); drawTimeout = null; }
    document.getElementById('pin-screen').style.display = 'none';
    document.getElementById('main-nav').style.display = 'flex';
}

function setInstruction(html) {
    const el = document.getElementById('pin-instruction');
    if (el) el.innerHTML = html;
}

function updatePinUI() {
    for (let i = 0; i < PIN_LENGTH; i++) {
        const dot = document.getElementById(`dot-${i}`);
        if (!dot) continue;
        if (i < enteredPin.length) {
            dot.textContent = '•'; // Don't show actual PIN to bystanders
            dot.style.cssText = 'background:#1a1a2e;color:#b4f056;font-size:24px;font-weight:900;transform:scale(1.1);box-shadow:0 0 14px rgba(26,26,46,0.4);';
        } else {
            dot.textContent = '';
            dot.style.cssText = 'background:rgba(26,26,46,0.1);color:transparent;font-size:0;transform:scale(1);box-shadow:none;';
        }
    }
}

function hideConfirmBtns() {
    const rb = document.getElementById('pin-redraw-btn');
    if (rb) rb.style.display = 'none';
    const cb = document.getElementById('pin-voice-confirm-btn');
    if (cb) cb.style.display = 'none';
}

function showVoiceConfirmBtn(onConfirm) {
    let btn = document.getElementById('pin-voice-confirm-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'pin-voice-confirm-btn';
        btn.style.cssText = `
            margin: 20px auto 0; display: block;
            padding: 16px 36px; border-radius: 50px;
            background: linear-gradient(135deg, #b4f056, #56f0b4);
            color: #0a0a0f; font-size: 16px; font-weight: 800;
            border: none; cursor: pointer; letter-spacing: 1px;
            box-shadow: 0 0 30px rgba(180,240,86,0.5);
            animation: pulse-glow 1.2s ease-in-out infinite;
        `;
        btn.textContent = '✓ TAP TO CONFIRM PAYMENT';
        // Insert after the pin dots area
        const pinScreen = document.getElementById('pin-screen');
        if (pinScreen) pinScreen.appendChild(btn);
    }
    btn.style.display = 'block';
    btn.onclick = () => {
        btn.style.display = 'none';
        onConfirm();
    };
}

function confirmDigit(d) {
    hideDigitPreview();
    enteredPin += d;
    isReviewing = false;

    if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
    updatePinUI();

    const next = enteredPin.length + 1;
    const instructionText = enteredPin.length < PIN_LENGTH ? 
        `Enter digit <b>${next}</b> of ${PIN_LENGTH}<br><span style="font-size:11px;opacity:0.6;">Draw the number anywhere on screen. Wait 1s to confirm.</span>` : '';
    setInstruction(instructionText);
    
    if (window.speak && enteredPin.length < PIN_LENGTH) {
        window.speak(`Ready for digit ${next} of ${PIN_LENGTH}`);
    }

    if (enteredPin.length >= PIN_LENGTH) setTimeout(checkPin, 400);
}

function checkPin() {
    if (enteredPin === CORRECT_PIN) {
        window._pinAwaitingVoice = true;
        setInstruction(`PIN correct.<br><span style="font-size:11px;opacity:0.6;">Say <b>"YES"</b> or tap the button below.</span>`);
        if (navigator.vibrate) navigator.vibrate(30);

        const doConfirm = () => {
            window._pinAwaitingVoice = false;
            hideConfirmBtns();
            if (typeof window.completePayment === 'function') window.completePayment();
        };

        // Show the tap-to-confirm button immediately as fallback
        showVoiceConfirmBtn(doConfirm);

        // Speak prompt, THEN launch dedicated yes-listener
        const launchListener = () => {
            if (navigator.vibrate) navigator.vibrate(30);
            console.log('🎤 Launching listenForYes...');
            if (typeof window.listenForYes === 'function') {
                window.listenForYes(
                    () => doConfirm(),          // onConfirm
                    () => {                      // onTimeout — button stays visible
                        console.log('⏰ Voice timeout — button still available');
                        setInstruction(`PIN correct.<br><span style="font-size:11px;opacity:0.6;">Tap the button below to pay.</span>`);
                    }
                );
            }
        };

        if (window.speak) {
            window.speak("PIN correct. Say YES to confirm payment.", launchListener);
        } else {
            // No TTS — launch listener immediately
            launchListener();
        }
    } else {
        if (navigator.vibrate) navigator.vibrate([150, 80, 150, 80, 300]);
        if (window.speak) window.speak("Incorrect PIN. Please try again.");

        const err = document.getElementById('pin-error');
        if (err) err.style.opacity = '1';
        const ps = document.getElementById('pin-screen');
        if (ps) { ps.style.animation = 'pin-shake 0.4s ease'; setTimeout(() => ps.style.animation = '', 400); }
        enteredPin = '';
        clearCanvas();

        setTimeout(() => {
            if (err) err.style.opacity = '0';
            updatePinUI();
            setInstruction(`Enter digit <b>1</b> of ${PIN_LENGTH}<br><span style="font-size:11px;opacity:0.6;">Draw the number anywhere on screen. Wait 1s to confirm.</span>`);
        }, 1800);
    }
}

// Intercept window.completePayment to wrap the hide logic & authenticate with State Machine
const originalCompletePayment = window.completePayment;
window.completePayment = function () {
    window._pinAwaitingVoice = false;
    hideConfirmBtns();
    hidePinScreen();
    const sm = window.TransactionStateMachine;
    if (sm && sm.getState() === 'SECURE_AUTHENTICATION') {
        sm.authenticateTransaction({ success: true });
    } else if (originalCompletePayment) {
        originalCompletePayment();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pin-back-btn')?.addEventListener('click', () => {
        hidePinScreen();
        const sm = window.TransactionStateMachine;
        if (sm && sm.getState() === 'SECURE_AUTHENTICATION') {
            sm.cancel('User cancelled PIN authentication.');
        }
    });

    const style = document.createElement('style');
    style.textContent = `
        #pin-screen { background: #0a0a0f !important; }
        #pin-instruction { color: rgba(255,255,255,0.7) !important; }
        #pin-back-btn { color: rgba(255,255,255,0.4) !important; }
        #pin-digit-preview { color: #b4f056 !important; text-shadow: 0 0 40px rgba(180,240,86,0.6) !important; }
        .pin-dot {
            width:48px;height:48px;border-radius:50%;
            background:rgba(26,26,46,0.1);border:2px solid rgba(255,255,255,0.1);
            transition:all 0.25s cubic-bezier(0.34,1.56,0.64,1);
            display:flex;align-items:center;justify-content:center;
            font-size:20px;font-weight:900;font-family:inherit;
        }
        @keyframes pin-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-12px)}40%{transform:translateX(12px)}60%{transform:translateX(-8px)}80%{transform:translateX(8px)}}
        @keyframes pulse-glow {
            0%,100% { box-shadow: 0 0 20px rgba(180,240,86,0.4); transform: scale(1); }
            50% { box-shadow: 0 0 45px rgba(180,240,86,0.9); transform: scale(1.04); }
        }
    `;
    document.head.appendChild(style);
});
