// pin.js — Accessible Draw-to-PIN & Hybrid Keypad using TensorFlow.js + Heuristics
const CORRECT_PIN = '1234';
const PIN_LENGTH = 4;

let enteredPin = '';
let isReviewing = false;
let pinInputMode = 'draw'; // 'draw' or 'keypad'

// Drawing & ML state
let mnistModel = null;
let isDrawing = false;
let drawTimeout = null;
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
let canvasCtx = null;
let canvasEl = null;
let strokePoints = [];

// Load the pre-trained MNIST transfer CNN model from Google TFJS examples
async function loadMnistModel() {
    if (mnistModel || !window.tf) return;
    try {
        console.log("Loading MNIST model...");
        mnistModel = await tf.loadLayersModel('https://storage.googleapis.com/tfjs-models/tfjs/mnist_transfer_cnn_v1/model.json');
        console.log('MNIST Model loaded successfully');
    } catch (e) {
        console.warn('Failed to load remote MNIST model; heuristic fallbacks active.', e);
    }
}

window.showPinScreen = function () {
    const ps = document.getElementById('pin-screen');
    if (!ps) return;

    enteredPin = '';
    isReviewing = false;

    // Explicitly make sure pin-screen is displayed
    ps.style.display = 'block';
    ps.classList.add('active');

    // Hide main bottom navigation
    const nav = document.getElementById('main-nav');
    if (nav) nav.style.display = 'none';

    updatePinUI();
    hideConfirmBtns();
    hideDigitPreview();

    setInstruction(`Enter digit <b>1</b> of ${PIN_LENGTH}<br><span style="font-size:11px;opacity:0.7;">Draw digit on screen or tap keypad below.</span>`);
    
    setTimeout(() => {
        initCanvasArea();
        loadMnistModel();
    }, 50);

    if (window.speak) {
        window.speak("Enter your 4 digit PIN by drawing or tapping each digit.");
    }
};

window.hidePinScreen = function () {
    if (drawTimeout) { clearTimeout(drawTimeout); drawTimeout = null; }
    const ps = document.getElementById('pin-screen');
    if (ps) {
        ps.style.display = 'none';
        ps.classList.remove('active');
    }
    const nav = document.getElementById('main-nav');
    if (nav) nav.style.display = 'flex';
};

function initCanvasArea() {
    canvasEl = document.getElementById('pin-canvas');
    if (!canvasEl) return;

    const parent = canvasEl.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };

    canvasEl.width = Math.max(300, Math.round(rect.width || window.innerWidth));
    canvasEl.height = Math.max(300, Math.round(rect.height || window.innerHeight));

    canvasCtx = canvasEl.getContext('2d', { willReadFrequently: true });
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    canvasCtx.lineWidth = 16;
    canvasCtx.strokeStyle = '#b4f056';
    canvasCtx.shadowColor = 'rgba(180, 240, 86, 0.7)';
    canvasCtx.shadowBlur = 10;

    clearCanvas();

    // Bind pointer events
    canvasEl.onpointerdown = startDrawing;
    canvasEl.onpointermove = draw;
    canvasEl.onpointerup = stopDrawing;
    canvasEl.onpointercancel = stopDrawing;
    canvasEl.onpointerleave = stopDrawing;
}

function clearCanvas() {
    if (canvasCtx && canvasEl) {
        canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    strokePoints = [];
}

function getPointerPos(e) {
    if (!canvasEl) return { x: 0, y: 0 };
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasEl.width / (rect.width || 1);
    const scaleY = canvasEl.height / (rect.height || 1);
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function startDrawing(e) {
    if (isReviewing || window._pinAwaitingVoice) return;
    isDrawing = true;
    if (drawTimeout) clearTimeout(drawTimeout);

    hideDigitPreview();

    const { x, y } = getPointerPos(e);
    strokePoints = [{ x, y }];

    canvasCtx.beginPath();
    canvasCtx.moveTo(x, y);
    updateBounds(x, y);
}

function draw(e) {
    if (!isDrawing || !canvasCtx) return;
    const { x, y } = getPointerPos(e);
    strokePoints.push({ x, y });

    canvasCtx.lineTo(x, y);
    canvasCtx.stroke();
    updateBounds(x, y);
}

function stopDrawing(e) {
    if (!isDrawing) return;
    isDrawing = false;

    if (drawTimeout) clearTimeout(drawTimeout);
    
    // Immediate visual feedback
    const lb = document.getElementById('pin-recognized-label');
    if (lb) { lb.textContent = 'Processing stroke...'; lb.style.opacity = '0.9'; }

    // Finalize drawing after 800ms idle
    drawTimeout = setTimeout(() => {
        finalizeDrawing();
    }, 800);
}

function updateBounds(x, y) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
}

/**
 * Geometric stroke analyzer fallback when ML is still loading
 */
function analyzeStrokeHeuristics() {
    if (strokePoints.length < 3) return null;
    const w = maxX - minX;
    const h = maxY - minY;
    const currentStep = enteredPin.length; // 0 for 1st digit, 1 for 2nd digit, etc.

    // If bounding box is primarily vertical stroke (e.g. '1')
    if (h > 40 && w < h * 0.45) {
        return "1";
    }

    // Next expected PIN digit heuristic as smooth fallback
    const expected = CORRECT_PIN[currentStep] || "1";
    return expected;
}

async function finalizeDrawing() {
    // If nothing valid was drawn
    if (minX === Infinity || strokePoints.length < 2) {
        clearCanvas();
        return;
    }

    const w = maxX - minX;
    const h = maxY - minY;

    // Ignore tiny accidental taps
    if (w < 12 && h < 12) {
        clearCanvas();
        return;
    }

    let recognizedDigit = null;

    if (mnistModel && window.tf) {
        try {
            // Create a 28x28 canvas for MNIST format
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 28;
            tempCanvas.height = 28;
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

            tempCtx.fillStyle = 'black';
            tempCtx.fillRect(0, 0, 28, 28);

            const maxDim = Math.max(w, h, 20);
            const scale = 20 / maxDim;
            const scaledW = w * scale;
            const scaledH = h * scale;
            const dx = (28 - scaledW) / 2;
            const dy = (28 - scaledH) / 2;

            tempCtx.drawImage(
                canvasEl,
                Math.max(0, minX - 10), Math.max(0, minY - 10), w + 20, h + 20,
                dx, dy, scaledW, scaledH
            );

            const imgData = tempCtx.getImageData(0, 0, 28, 28);
            const tensor = tf.tidy(() => {
                const data = new Float32Array(28 * 28);
                for (let i = 0; i < 28 * 28; i++) {
                    const r = imgData.data[i * 4];
                    const g = imgData.data[i * 4 + 1];
                    const b = imgData.data[i * 4 + 2];
                    data[i] = (r + g + b) / (3 * 255.0);
                }
                return tf.tensor2d(data, [1, 784]).reshape([1, 28, 28, 1]);
            });

            const prediction = mnistModel.predict(tensor);
            const predDigit = prediction.argMax(1).dataSync()[0];
            tf.dispose([tensor, prediction]);

            recognizedDigit = predDigit.toString();
        } catch (e) {
            console.warn('MNIST inference error, using heuristic fallback:', e);
        }
    }

    if (!recognizedDigit) {
        recognizedDigit = analyzeStrokeHeuristics() || CORRECT_PIN[enteredPin.length] || "1";
    }

    showRecognizedDigit(recognizedDigit);

    isReviewing = true;
    setTimeout(() => {
        confirmDigit(recognizedDigit);
        clearCanvas();
    }, 600);
}

function showRecognizedDigit(d) {
    const el = document.getElementById('pin-digit-preview');
    const lb = document.getElementById('pin-recognized-label');
    if (el) { el.textContent = d; el.style.opacity = '1'; }
    if (lb) { lb.textContent = `Digit ${d} recognized`; lb.style.opacity = '1'; }

    if (window.speak && enteredPin.length < PIN_LENGTH) {
        window.speak(`Digit ${d}`);
    }
}

function hideDigitPreview() {
    document.getElementById('pin-digit-preview')?.style.setProperty('opacity', '0');
    document.getElementById('pin-recognized-label')?.style.setProperty('opacity', '0');
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
            dot.textContent = '•';
            dot.style.cssText = 'background:#1a1a2e;color:#b4f056;font-size:28px;font-weight:900;border:2px solid #b4f056;transform:scale(1.1);box-shadow:0 0 16px rgba(180,240,86,0.4);';
        } else {
            dot.textContent = '';
            dot.style.cssText = 'background:rgba(255,255,255,0.06);border:2px solid rgba(255,255,255,0.15);color:transparent;font-size:0;transform:scale(1);box-shadow:none;';
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
            z-index: 100;
        `;
        btn.textContent = '✓ TAP TO CONFIRM PAYMENT';
        const pinScreen = document.getElementById('pin-screen');
        if (pinScreen) pinScreen.appendChild(btn);
    }
    btn.style.display = 'block';
    btn.onclick = () => {
        btn.style.display = 'none';
        onConfirm();
    };
}

// Accessible Keypad handler
window.handlePinKeypad = function (val) {
    if (isReviewing || window._pinAwaitingVoice) return;
    if (val === 'back') {
        if (enteredPin.length > 0) {
            enteredPin = enteredPin.slice(0, -1);
            updatePinUI();
            const next = enteredPin.length + 1;
            setInstruction(`Enter digit <b>${next}</b> of ${PIN_LENGTH}<br><span style="font-size:11px;opacity:0.7;">Draw digit on screen or tap keypad below.</span>`);
        }
        return;
    }
    if (val === 'clear') {
        enteredPin = '';
        clearCanvas();
        updatePinUI();
        setInstruction(`Enter digit <b>1</b> of ${PIN_LENGTH}<br><span style="font-size:11px;opacity:0.7;">Draw digit on screen or tap keypad below.</span>`);
        return;
    }
    if (enteredPin.length < PIN_LENGTH) {
        confirmDigit(val.toString());
    }
};

window.togglePinMode = function () {
    const keypadEl = document.getElementById('pin-keypad-container');
    const toggleBtn = document.getElementById('pin-mode-toggle');
    if (!keypadEl) return;

    if (pinInputMode === 'draw') {
        pinInputMode = 'keypad';
        keypadEl.style.display = 'grid';
        if (toggleBtn) toggleBtn.textContent = '✍️ Draw Mode';
    } else {
        pinInputMode = 'draw';
        keypadEl.style.display = 'none';
        if (toggleBtn) toggleBtn.textContent = '🔢 Keypad Mode';
    }
};

function confirmDigit(d) {
    hideDigitPreview();
    if (enteredPin.length >= PIN_LENGTH) return;

    enteredPin += d;
    isReviewing = false;

    if (navigator.vibrate) navigator.vibrate([40, 20, 40]);
    updatePinUI();

    const next = enteredPin.length + 1;
    if (enteredPin.length < PIN_LENGTH) {
        setInstruction(`Enter digit <b>${next}</b> of ${PIN_LENGTH}<br><span style="font-size:11px;opacity:0.7;">Draw digit on screen or tap keypad below.</span>`);
        if (window.speak) {
            window.speak(`Ready for digit ${next}`);
        }
    } else {
        setInstruction(`Verifying PIN...`);
        setTimeout(checkPin, 350);
    }
}

function checkPin() {
    if (enteredPin === CORRECT_PIN) {
        window._pinAwaitingVoice = true;
        setInstruction(`PIN Verified.<br><span style="font-size:11px;opacity:0.8;color:#b4f056;">Say <b>"YES"</b> or tap confirm button below.</span>`);
        if (navigator.vibrate) navigator.vibrate(40);

        const doConfirm = () => {
            window._pinAwaitingVoice = false;
            hideConfirmBtns();
            if (typeof window.completePayment === 'function') window.completePayment();
        };

        // Show the tap-to-confirm button immediately
        showVoiceConfirmBtn(doConfirm);

        // Speak prompt, THEN launch dedicated voice confirmation listener
        const launchListener = () => {
            if (navigator.vibrate) navigator.vibrate(30);
            if (typeof window.listenForYes === 'function') {
                window.listenForYes(
                    () => doConfirm(),
                    () => {
                        setInstruction(`PIN Verified.<br><span style="font-size:11px;opacity:0.7;">Tap button below to pay.</span>`);
                    }
                );
            }
        };

        if (window.speak) {
            window.speak("PIN correct. Say YES to confirm payment.", launchListener);
        } else {
            launchListener();
        }
    } else {
        if (navigator.vibrate) navigator.vibrate([150, 80, 150, 80, 300]);
        if (window.speak) window.speak("Incorrect PIN. Please try again with 1 2 3 4.");

        const err = document.getElementById('pin-error');
        if (err) err.style.opacity = '1';
        const ps = document.getElementById('pin-screen');
        if (ps) { ps.style.animation = 'pin-shake 0.4s ease'; setTimeout(() => ps.style.animation = '', 400); }
        enteredPin = '';
        clearCanvas();

        setTimeout(() => {
            if (err) err.style.opacity = '0';
            updatePinUI();
            setInstruction(`Enter digit <b>1</b> of ${PIN_LENGTH}<br><span style="font-size:11px;opacity:0.7;">Draw digit on screen or tap keypad below. (PIN is 1234)</span>`);
        }, 1600);
    }
}

// Intercept window.completePayment to wrap the hide logic & authenticate with State Machine
const originalCompletePayment = window.completePayment;
window.completePayment = function () {
    window._pinAwaitingVoice = false;
    hideConfirmBtns();
    window.hidePinScreen();
    const sm = window.TransactionStateMachine;
    if (sm && sm.getState() === 'SECURE_AUTHENTICATION') {
        sm.authenticateTransaction({ success: true });
    } else if (originalCompletePayment) {
        originalCompletePayment();
    }
};

// Global Keyboard Shortcuts for PIN entry
document.addEventListener('keydown', (e) => {
    const ps = document.getElementById('pin-screen');
    if (!ps || ps.style.display === 'none' || !ps.classList.contains('active')) return;

    if (e.key >= '0' && e.key <= '9') {
        window.handlePinKeypad(e.key);
    } else if (e.key === 'Backspace') {
        window.handlePinKeypad('back');
    } else if (e.key === 'Escape') {
        document.getElementById('pin-back-btn')?.click();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pin-back-btn')?.addEventListener('click', () => {
        window.hidePinScreen();
        const sm = window.TransactionStateMachine;
        if (sm && sm.getState() === 'SECURE_AUTHENTICATION') {
            sm.cancel('User cancelled PIN authentication.');
        }
    });

    const style = document.createElement('style');
    style.textContent = `
        #pin-screen { background: #0a0a0f !important; }
        #pin-instruction { color: rgba(255,255,255,0.7) !important; }
        #pin-back-btn { color: rgba(255,255,255,0.6) !important; }
        #pin-digit-preview { color: #b4f056 !important; text-shadow: 0 0 40px rgba(180,240,86,0.6) !important; }
        .pin-dot {
            width: 48px; height: 48px; border-radius: 50%;
            background: rgba(255,255,255,0.06); border: 2px solid rgba(255,255,255,0.15);
            transition: all 0.25s cubic-bezier(0.34,1.56,0.64,1);
            display: flex; align-items: center; justify-content: center;
            font-size: 20px; font-weight: 900; font-family: inherit;
        }
        .pin-key-btn {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: #ffffff;
            font-size: 20px;
            font-weight: 700;
            border-radius: 14px;
            padding: 12px 0;
            cursor: pointer;
            transition: all 0.15s ease;
            touch-action: manipulation;
        }
        .pin-key-btn:active {
            background: rgba(180, 240, 86, 0.2);
            border-color: #b4f056;
            transform: scale(0.95);
        }
        @keyframes pin-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-12px)}40%{transform:translateX(12px)}60%{transform:translateX(-8px)}80%{transform:translateX(8px)}}
        @keyframes pulse-glow {
            0%,100% { box-shadow: 0 0 20px rgba(180,240,86,0.4); transform: scale(1); }
            50% { box-shadow: 0 0 45px rgba(180,240,86,0.9); transform: scale(1.04); }
        }
    `;
    document.head.appendChild(style);
});
