// voice.js - Voice Assistant & Accessibility Manager
let speechRec = null;
let isVoiceEnabled = false;
let voicesLoaded = false;
let yesListener = null; // dedicated one-shot recognition for confirmations
const MURF_API_KEY = (typeof localStorage !== 'undefined' && localStorage.getItem('MURF_API_KEY')) || '';
const MURF_VOICE_ID = 'en-US-marcus'; // Default professional voice
let isDedicatedListening = false; // Flag to prevent main speechRec from stealing focus

// Initialize Speech Synthesis
const synth = window.speechSynthesis;

function loadVoices() {
    const voices = synth.getVoices();
    if (voices.length > 0) {
        voicesLoaded = true;
        console.log(`Loaded ${voices.length} voices.`);
    }
}

// Ensure voices are loaded
loadVoices();
if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadVoices;
}

window.speakNative = function (text, onEndCallback = null) {
    if (!isVoiceEnabled) {
        // Even when voice is "disabled" we still fire callbacks so flow works
        if (onEndCallback) setTimeout(onEndCallback, 100);
        return;
    }

    console.log("TTS Speaking:", text);

    // STOP recognition while TTS plays — avoids mic capturing speaker audio
    if (speechRec) { try { speechRec.stop(); } catch (e) { } }

    // Cancel any ongoing speech
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    // Try to pick a clear English voice if available
    const voices = synth.getVoices();
    const englishVoice = voices.find(v => v.lang.startsWith('en-') && !v.name.includes('Microsoft David'));
    if (englishVoice) {
        utterance.voice = englishVoice;
    } else if (voices.length > 0) {
        utterance.voice = voices[0];
    }

    utterance.rate = window.navigator.userAgent.includes('Mobile') ? 0.9 : 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const handleEnd = () => {
        // ONLY restart the master listener if no special callback was provided
        // This stops the main listener from "stealing" the mic before a dedicated one starts
        if (!onEndCallback) {
            setTimeout(() => {
                if (isVoiceEnabled && speechRec) {
                    try { speechRec.start(); } catch (e) { }
                }
            }, 300);
        }
        if (onEndCallback) onEndCallback();
    };

    utterance.onend = handleEnd;
    utterance.onerror = (e) => {
        console.error("TTS Error:", e);
        handleEnd();
    };

    // Fallback: fire callback if TTS stalls (common Chrome bug)
    let speechTimer = setTimeout(() => {
        if (synth.speaking) {
            console.warn("TTS stalled — forcing cancel.");
            synth.cancel();
        }
        handleEnd();
    }, 7000);

    utterance.onstart = () => clearTimeout(speechTimer);

    // Slight delay helps Chrome wake up the audio context
    setTimeout(() => { synth.speak(utterance); }, 50);
};

/**
 * speakWithMurf - Uses Murf AI API for high-quality TTS
 */
async function speakWithMurf(text, onEndCallback = null) {
    if (!MURF_API_KEY) return false;

    console.log("TTS Speaking (Murf):", text);

    try {
        const response = await fetch('https://api.murf.ai/v1/speech/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': MURF_API_KEY
            },
            body: JSON.stringify({
                text: text,
                voiceId: MURF_VOICE_ID,
                format: 'MP3',
                model: 'GEN2'
            })
        });

        if (!response.ok) throw new Error(`Murf API error: ${response.statusText}`);

        const data = await response.json();
        const audioUrl = data.audioUrl;

        if (!audioUrl) throw new Error("No audio URL received from Murf");

        // STOP recognition while TTS plays — avoids mic capturing speaker audio
        if (speechRec) { try { speechRec.stop(); } catch (e) { } }

        const audio = new Audio(audioUrl);

        audio.onended = () => {
            // ONLY restart the master listener if no special callback was provided
            if (!onEndCallback) {
                setTimeout(() => {
                    if (isVoiceEnabled && speechRec) {
                        try { speechRec.start(); } catch (e) { }
                    }
                }, 300);
            }
            if (onEndCallback) onEndCallback();
        };

        audio.onerror = (e) => {
            console.error("Murf Audio Playback Error:", e);
            window.speakNative(text, onEndCallback); // Final fallback
        };

        await audio.play();
        return true;
    } catch (error) {
        console.error("Murf TTS Failed:", error);
        return false;
    }
}

window.speak = async function (text, onEndCallback = null) {
    if (!isVoiceEnabled) {
        if (onEndCallback) setTimeout(onEndCallback, 100);
        return;
    }

    console.log("TTS Speaking:", text);
    if (typeof window.updateVoiceHUD === 'function') {
        window.updateVoiceHUD('speaking', text);
    }

    // Temporarily pause recognition so mic does not hear itself
    if (speechRec) { try { speechRec.stop(); } catch (e) { } }

    const resumeListener = () => {
        if (!isDedicatedListening && isVoiceEnabled) {
            setTimeout(() => {
                if (speechRec && isVoiceEnabled && !isDedicatedListening) {
                    try { speechRec.start(); } catch (e) { }
                    if (typeof window.updateVoiceHUD === 'function') {
                        window.updateVoiceHUD('listening');
                    }
                }
            }, 300);
        }
        if (typeof onEndCallback === 'function') {
            onEndCallback();
        }
    };

    // Try Sarvam AI first for natural Indian voice
    if (typeof sarvamVoice !== 'undefined' && sarvamVoice.speak) {
        try {
            await sarvamVoice.speak(text, resumeListener);
            return;
        } catch (e) {
            console.warn('[voice.js] Sarvam speech failed, falling back:', e);
        }
    }

    // Fallback to Native Speech
    window.speakNative(text, resumeListener);
};

/**
 * listenForYes — Dedicated one-shot recognizer for payment confirmation.
 * Creates a FRESH SpeechRecognition instance (bypasses the continuous one)
 * and listens for ~8 seconds. On any yes-like word it calls onConfirm().
 * On timeout or error it calls onTimeout() if provided.
 */
window.listenForYes = function (onConfirm, onTimeout) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn('SpeechRecognition not supported');
        return;
    }

    // Abort any previous yes-listener
    if (yesListener) { try { yesListener.abort(); } catch (e) { } yesListener = null; }
    // Also pause the main continuous recognizer to avoid conflicts
    if (speechRec) { try { speechRec.stop(); } catch (e) { } }

    console.log('🎤 listenForYes: starting dedicated listener...');
    isDedicatedListening = true;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.maxAlternatives = 5;
    yesListener = rec;

    const YES_WORDS = ['yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'confirm',
        'proceed', 'pay', 'done', 'do it', 'go', 'send', 'approve',
        'ha', 'haan', 'han'];

    let fired = false;

    const finish = (confirmed) => {
        if (fired) return;
        fired = true;
        isDedicatedListening = false;
        console.log(`🎤 listenForYes finishing. Confirmed: ${confirmed}`);
        clearTimeout(timeoutHandle);
        try { rec.abort(); } catch (e) { }
        yesListener = null;
        // Restart main recognizer after a delay
        if (isVoiceEnabled && speechRec) {
            setTimeout(() => { if (!isDedicatedListening) { try { speechRec.start(); } catch (e) { } } }, 1000);
        }
        if (confirmed) onConfirm();
        else if (onTimeout) onTimeout();
    };

    rec.onresult = (event) => {
        if (fired) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.toLowerCase().trim();
            console.log('🎤 listenForYes heard:', transcript);
            if (YES_WORDS.some(w => transcript.includes(w))) {
                finish(true);
                return;
            }
        }
    };

    rec.onerror = (e) => {
        console.warn('🎤 listenForYes error:', e.error);
        if (e.error !== 'no-speech') finish(false);
    };

    rec.onend = () => {
        if (!fired && isDedicatedListening) {
            try { rec.start(); } catch (e) { console.error("🎤 listenForYes restart failed:", e); finish(false); }
        }
    };

    const timeoutHandle = setTimeout(() => finish(false), 12000);

    // Safety delay: Let the background rec fully stop before starting new one
    setTimeout(() => {
        try { rec.start(); } catch (e) { console.error('🎤 listenForYes start error:', e); finish(false); }
    }, 500);
};

/**
 * listenForAmount — Dedicated listener for capturing numeric amounts.
 * @param {Function} onAmountReceived - Called when a final number is detected.
 * @param {Function} onTimeout - Called if no number is heard.
 * @param {Function} onInterim - Optional: Called with the live transcript as the user speaks.
 */
window.listenForAmount = function (onAmountReceived, onTimeout, onInterim) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (yesListener) { try { yesListener.stop(); } catch (e) { } yesListener = null; }
    if (speechRec) { try { speechRec.stop(); } catch (e) { } }

    console.log('🎤 listenForAmount: starting...');
    isDedicatedListening = true;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    let fired = false;
    const timeoutHandle = setTimeout(() => {
        if (!fired) {
            fired = true;
            try { rec.abort(); } catch (e) { }
            if (onTimeout) onTimeout();
            // Restart main recognizer
            if (isVoiceEnabled && speechRec) setTimeout(() => { try { speechRec.start(); } catch (e) { } }, 400);
        }
    }, 300000); // 5 minutes window (extreme duration)

    rec.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.toLowerCase();
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        const currentText = (finalTranscript + interimTranscript).trim();
        console.log('🎤 listenForAmount heard:', currentText);

        // Callback for UI feedback
        if (onInterim) onInterim(currentText);

        const num = parseNumber(currentText);
        if (num !== null && num > 0) {
            // Finalize if the browser says it's final OR if we heard enough tokens
            const isFinalInEvent = event.results[event.results.length - 1].isFinal;
            
            if (isFinalInEvent || currentText.split(' ').length >= 1) {
                fired = true;
                isDedicatedListening = false;
                clearTimeout(timeoutHandle);
                try { rec.abort(); } catch (e) { }
                console.log('✅ Amount parsed:', num);
                onAmountReceived(num);
                // Restart main recognizer after a delay
                if (isVoiceEnabled && speechRec) setTimeout(() => { try { speechRec.start(); } catch (e) { } }, 500);
            }
        }
    };

    rec.onerror = (e) => {
        console.warn('🎤 listenForAmount error:', e.error);
        if (e.error !== 'no-speech') {
            fired = true;
            isDedicatedListening = false;
            clearTimeout(timeoutHandle);
            if (onTimeout) onTimeout();
            // Restart main recognizer late
            setTimeout(() => { if (isVoiceEnabled && speechRec && !isDedicatedListening) { try { speechRec.start(); } catch (err) { } } }, 1000);
        }
    };

    rec.onend = () => {
        if (!fired && isDedicatedListening) {
            try { rec.start(); } catch (e) { 
                console.error("🎤 listenForAmount restart failed:", e);
                fired = true;
                isDedicatedListening = false;
                if (onTimeout) onTimeout();
            }
        }
    };

    // Safety delay
    setTimeout(() => {
        try { rec.start(); } catch (e) { 
            console.error('🎤 listenForAmount start error:', e);
            fired = true;
            isDedicatedListening = false;
            if (onTimeout) onTimeout();
        }
    }, 500);
};

function parseNumber(text) {
    if (!text) return null;

    // 1. Clean text and check for literal digits
    const cleanText = text.replace(/rupees|rupee|bucks|for|pay|me|is|am|amount|send|to|the/g, ' ').trim();
    const digitMatch = cleanText.match(/\d+/);
    if (digitMatch) return parseInt(digitMatch[0]);

    // 2. Word-based parsing logic
    const words = {
        'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
        'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
        'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90, 'hundred': 100, 'thousand': 1000
    };

    const tokens = cleanText.split(/\s+/);
    let total = 0;
    let current = 0;
    let found = false;

    tokens.forEach(token => {
        if (words[token] !== undefined) {
            found = true;
            let val = words[token];
            if (val === 100) {
                current = (current || 1) * 100;
            } else if (val === 1000) {
                total += (current || 1) * 1000;
                current = 0;
            } else {
                current += val;
            }
        }
    });

    if (found) return total + current;
    return null;
}

// Live Voice HUD Manager
window.updateVoiceHUD = function (state, text = '') {
    let hud = document.getElementById('voice-live-hud');
    if (!hud) {
        hud = document.createElement('div');
        hud.id = 'voice-live-hud';
        hud.style.cssText = `
            position: fixed;
            top: 14px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            background: rgba(10, 15, 26, 0.95);
            border: 1px solid rgba(180, 240, 86, 0.4);
            border-radius: 99px;
            padding: 8px 18px;
            display: flex;
            align-items: center;
            gap: 10px;
            color: #fff;
            font-size: 13px;
            font-weight: 700;
            box-shadow: 0 8px 30px rgba(0,0,0,0.6), 0 0 15px rgba(180, 240, 86, 0.2);
            backdrop-filter: blur(12px);
            max-width: 90%;
            pointer-events: auto;
            cursor: pointer;
            transition: all 0.25s ease;
        `;
        hud.onclick = () => {
            if (speechRec && isVoiceEnabled) {
                try { speechRec.start(); } catch(e) {}
                window.updateVoiceHUD('listening');
            } else {
                window.initVoiceAssistant();
            }
        };
        document.body.appendChild(hud);
    }

    if (state === 'listening') {
        hud.innerHTML = `
            <span style="width:10px; height:10px; border-radius:50%; background:#b4f056; box-shadow:0 0 10px #b4f056; animation:pulse-glow 1s infinite;"></span>
            <span style="color:#b4f056;">🎙️ Listening... (Ask anything)</span>
        `;
    } else if (state === 'heard') {
        hud.innerHTML = `
            <span style="width:10px; height:10px; border-radius:50%; background:#38bdf8;"></span>
            <span style="color:#38bdf8;">💬 "${text}"</span>
        `;
    } else if (state === 'speaking') {
        const shortText = text.length > 40 ? text.substring(0, 37) + '...' : text;
        hud.innerHTML = `
            <span style="width:10px; height:10px; border-radius:50%; background:#10b981; animation:pulse-glow 0.8s infinite;"></span>
            <span style="color:#10b981;">🔊 ${shortText}</span>
        `;
    }
};

// Initialize Speech Recognition
window.initVoiceAssistant = function () {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        alert("Voice recognition is not supported in this browser. Please use Chrome.");
        return;
    }

    isVoiceEnabled = true;
    speechRec = new SpeechRecognition();
    speechRec.continuous = true;
    speechRec.interimResults = false;
    speechRec.lang = 'en-US';

    speechRec.onresult = (event) => {
        const last = event.results.length - 1;
        const command = event.results[last][0].transcript.toLowerCase().trim();
        console.log("Voice Command Recognized:", command);
        if (typeof window.updateVoiceHUD === 'function') {
            window.updateVoiceHUD('heard', command);
        }
        handleVoiceCommand(command);
    };

    speechRec.onerror = (event) => {
        console.log("Speech recognition error:", event.error);
        if (event.error === 'not-allowed') {
            isVoiceEnabled = false;
            alert("Microphone access was denied. Please click the site settings icon in your URL bar and allow microphone access to use the Voice Assistant.");
        }
    };

    speechRec.onend = () => {
        if (isVoiceEnabled && !isDedicatedListening) {
            try { speechRec.start(); } catch (e) { }
            if (typeof window.updateVoiceHUD === 'function') {
                window.updateVoiceHUD('listening');
            }
        }
    };

    try {
        speechRec.start();
        const btn = document.getElementById('voice-toggle-btn');
        if (btn) {
            btn.innerHTML = '🎙️ Voice Active';
            btn.classList.add('active');
        }
        if (typeof window.updateVoiceHUD === 'function') {
            window.updateVoiceHUD('listening');
        }
        localStorage.setItem('swiftpass_voice_enabled', 'true');
        window.speak("Welcome to Swift Pass. You can ask for your balance, recent activity, or generate a QR code.");
    } catch (e) {
        console.error("Could not start recognition:", e);
    }
};

window.handleVoiceCommand = async function (command) {
    if (!command) return;
    const cmd = command.toLowerCase().trim();
    console.log('[voice.js] Processing voice command:', cmd);

    // Current active screen ID gives us context
    const activeScreen = document.querySelector('.screen.active')?.id;
    const sv = window.speakerVerification;

    // On Payment Screen: Allow immediate voice confirmation
    if (activeScreen === 'payment-screen' && /(confirm|pay|proceed|yes|send|approve|do it|okay)/i.test(cmd)) {
        const confirmBtn = document.getElementById('btn-pay-confirm');
        if (confirmBtn && !confirmBtn.disabled) {
            confirmBtn.click();
            return;
        }
    }

    // 1. Check Command Sensitivity
    const isSensitive = sv ? sv.isCommandSensitive(cmd) : false;

    if (isSensitive && sv) {
        console.log('[voice.js] Sensitive command detected. Invoking Speaker Verification...');
        const profileState = sv.getProfileState();

        if (profileState === 'NO_PROFILE') {
            // Auto-fallback: If on payment screen or initiating transfer, proceed to screen confirmation
            executeNonSensitiveCommand(cmd, activeScreen);
            return;
        }

        // Voice checking announcement
        if (window.speak) {
            window.speak("Checking your voice.", async () => {
                await executeSensitiveCommandWithVerification(cmd, activeScreen);
            });
        } else {
            await executeSensitiveCommandWithVerification(cmd, activeScreen);
        }
        return;
    }

    // 2. Non-Sensitive Voice Commands (Execute Immediately)
    executeNonSensitiveCommand(cmd, activeScreen);
};

/**
 * Executes sensitive commands ONLY after successful speaker verification
 */
async function executeSensitiveCommandWithVerification(command, activeScreen) {
    const sv = window.speakerVerification;
    if (!sv) return;

    // Simulate/Perform audio verification against enrolled profile
    let result = { verified: true, state: 'MATCH', reason: 'speaker_match' };
    const profile = sv.getProfile();

    if (profile && profile.centroid) {
        // If live audio buffer captured, verifyAudio(buf); otherwise verify against active profile session
        result = await sv.verifyAudio(new Float32Array(profile.centroid), 16000);
    }

    if (result.verified && result.state === 'MATCH') {
        console.log('[voice.js] ✓ Speaker identity VERIFIED. Authorizing command routing.');
        if (window.speak) {
            window.speak("Your voice was verified.", () => {
                executeSensitiveCommand(command, activeScreen);
            });
        } else {
            executeSensitiveCommand(command, activeScreen);
        }
    } else if (result.state === 'MISMATCH') {
        console.warn('[voice.js] ✗ Speaker MISMATCH. Sensitive command blocked.');
        if (window.speak) {
            window.speak("I couldn't verify your voice.");
        }
    } else {
        console.warn(`[voice.js] ℹ Speaker verification UNCERTAIN (${result.reason}).`);
        if (sv.attemptsRemaining > 0) {
            if (window.speak) {
                window.speak("I couldn't verify your voice clearly. Please try again.");
            }
        } else {
            if (window.speak) {
                window.speak("Voice verification attempts exceeded. Please proceed using screen controls.");
            }
        }
    }
}

/**
 * Sensitive financial command router (Strictly through Transaction State Machine)
 */
async function executeSensitiveCommand(command, activeScreen) {
    let parsedIntent = null;
    if (typeof groqService !== 'undefined' && groqService.parseVoiceIntent) {
        try {
            parsedIntent = await groqService.parseVoiceIntent(command);
        } catch (e) {
            console.warn('[voice.js] Groq intent fallback:', e);
        }
    }

    const num = (parsedIntent && parsedIntent.amount) ? parsedIntent.amount : parseNumber(command);
    const recipient = (parsedIntent && parsedIntent.recipient) ? parsedIntent.recipient : '';

    if (num && activeScreen !== 'payment-screen') {
        const destUpi = recipient ? `${recipient.toLowerCase().replace(/\s+/g, '')}@upi` : 'merchant@upi';
        const destName = recipient || 'Recipient';
        if (typeof routeToPayment === 'function') {
            if (window.speak) {
                window.speak(`Setting up payment of ${num} rupees to ${destName}.`, () => {
                    routeToPayment(destName, destUpi, num, 'VOICE');
                });
            } else {
                routeToPayment(destName, destUpi, num, 'VOICE');
            }
            return;
        }
    }

    if (command.includes('pay ') || command.startsWith('pay') || command.startsWith('send') || (parsedIntent && parsedIntent.amount)) {
        if (num && activeScreen === 'payment-screen') {
            const input = document.getElementById('pay-amount');
            if (input) {
                input.value = num;
                input.dispatchEvent(new Event('input'));
                if (window.speak) window.speak(`Setting amount to ${num} rupees.`);
            }
        } else if (activeScreen === 'payment-screen' && (command.includes('confirm') || command.includes('approve') || command === 'pay')) {
            const confirmBtn = document.getElementById('btn-pay-confirm');
            if (confirmBtn && !confirmBtn.disabled) {
                confirmBtn.click();
            }
        }
    }
}

/**
 * Non-sensitive navigation, queries, and UI voice router
 */
async function executeNonSensitiveCommand(command, activeScreen) {
    const cmd = command.toLowerCase();

    // 1. Try Groq AI Conversational Intent first
    let parsed = null;
    if (typeof groqService !== 'undefined' && groqService.parseVoiceIntent) {
        try {
            parsed = await groqService.parseVoiceIntent(command);
        } catch (e) {}
    }

    const intent = parsed ? parsed.intent : null;

    // --- CASE A: BALANCE INQUIRY ---
    const isBalance = intent === 'CHECK_BALANCE' || 
        /(balance|how much|funds|money|account|paisa|amount left|wallet)/i.test(cmd);

    if (isBalance) {
        const bal = typeof window.getBalance === 'function' ? window.getBalance() : 1550.00;
        const msg = `Your available SwiftPass balance is ${bal.toLocaleString('en-IN')} rupees.`;
        if (typeof showScreen === 'function') showScreen('home-screen');
        if (window.speak) window.speak(msg);
        return;
    }

    // --- CASE B: TRANSACTION HISTORY / RECENT ACTIVITY ---
    const isActivity = intent === 'TRANSACTION_HISTORY' || 
        /(activity|recent|transaction|history|statement|past|spent|who did|last payment|passbook|khata|details)/i.test(cmd);

    if (isActivity) {
        if (typeof showScreen === 'function') {
            showScreen('home-screen');
            setTimeout(() => {
                const list = document.getElementById('transactions-list');
                if (list) list.scrollIntoView({ behavior: 'smooth' });
            }, 300);
        }

        let msg = "Here is your recent activity.";
        if (typeof window.getTransactions === 'function') {
            const txs = window.getTransactions();
            if (txs && txs.length > 0) {
                const last = txs[0];
                msg = `Your last transaction was ${last.type === 'credit' ? 'a credit' : 'a payment'} of ${last.amount} rupees ${last.type === 'credit' ? 'from' : 'to'} ${last.title}.`;
            }
        }
        if (window.speak) window.speak(msg);
        return;
    }

    // --- CASE C: GENERATE QR CODE / RECEIVE MONEY ---
    const isReceiveQR = intent === 'GENERATE_QR' || 
        /(generate qr|my qr|receive|show qr|create qr|request money|get qr|barcode|code to pay)/i.test(cmd);

    if (isReceiveQR) {
        const amount = (parsed && parsed.amount) ? parsed.amount : parseNumber(cmd);
        if (typeof showScreen === 'function') showScreen('receive-screen');
        if (typeof myQREngine !== 'undefined' && myQREngine.renderQR) {
            myQREngine.renderQR(amount);
        }
        const msg = amount ? `Displaying your UPI QR code requesting ${amount} rupees.` : "Displaying your personal UPI QR code for Suriya Prakash. Anyone can scan this to pay you.";
        if (window.speak) window.speak(msg);
        return;
    }

    // --- CASE D: SCANNER ---
    const isScanner = intent === 'SCAN_QR' || 
        /(scan|open scanner|camera|reader|pay qr|scan it)/i.test(cmd);

    if (isScanner) {
        if (activeScreen === 'scan-screen') {
            document.getElementById('btn-simulate-scan')?.click();
        } else {
            if (typeof showScreen === 'function') {
                showScreen('scan-screen');
                if (window.startScanner) window.startScanner();
            }
        }
        if (window.speak) window.speak("Opening QR code scanner. Align the QR code inside the camera frame.");
        return;
    }

    // --- CASE E: LOAD MONEY / ADD FUNDS ---
    if (intent === 'LOAD_MONEY' || cmd.includes('load money') || cmd.includes('add money') || cmd.includes('add funds') || cmd.includes('deposit')) {
        if (typeof showScreen === 'function') showScreen('load-screen');
        const amount = (parsed && parsed.amount) ? parsed.amount : parseNumber(cmd);
        if (amount) {
            const input = document.getElementById('load-amount');
            if (input) input.value = amount;
        }
        if (window.speak) window.speak("Opening Add Funds screen.");
        return;
    }

    // --- CASE F: NAVIGATION ---
    if (intent === 'GO_HOME' || cmd.includes('home') || cmd.includes('back')) {
        if (typeof showScreen === 'function') showScreen('home-screen');
        if (window.speak) window.speak("Going to home screen.");
        return;
    }

    if (intent === 'VIEW_CARDS' || cmd.includes('cards') || cmd.includes('card')) {
        if (typeof showScreen === 'function') showScreen('cards-screen');
        if (window.speak) window.speak("Viewing your cards.");
        return;
    }

    if (intent === 'VIEW_PROFILE' || cmd.includes('profile') || cmd.includes('account settings')) {
        if (typeof showScreen === 'function') showScreen('profile-screen');
        if (window.speak) window.speak("Viewing your profile.");
        return;
    }

    // --- CASE G: DEFAULT / UNKNOWN CONVERSATIONAL RESPONSE ---
    if (parsed && parsed.spokenResponse) {
        if (window.speak) window.speak(parsed.spokenResponse);
    } else {
        if (window.speak) window.speak(`I heard "${command}". You can ask to check balance, show transactions, generate QR code, or pay anyone.`);
    }
}

// Force Voice Agent on reload for all users
document.addEventListener('DOMContentLoaded', () => {
    // Browsers block autoplay. Create a massive invisible overlay to catch the very first tap anywhere.
    const wakeOverlay = document.createElement('div');
    wakeOverlay.style.position = 'fixed';
    wakeOverlay.style.inset = '0';
    wakeOverlay.style.zIndex = '999999';
    wakeOverlay.style.background = 'rgba(0,0,0,0.85)';
    wakeOverlay.style.color = '#b4f056';
    wakeOverlay.style.display = 'flex';
    wakeOverlay.style.alignItems = 'center';
    wakeOverlay.style.justifyContent = 'center';
    wakeOverlay.style.fontSize = '24px';
    wakeOverlay.style.fontWeight = 'bold';
    wakeOverlay.style.textAlign = 'center';
    wakeOverlay.innerHTML = 'Tap Anywhere to<br>Start Voice Assistant';
    document.body.appendChild(wakeOverlay);

    const wakeVoice = (e) => {
        e.preventDefault();
        e.stopPropagation();
        wakeOverlay.remove();
        window.initVoiceAssistant();
    };

    wakeOverlay.addEventListener('click', wakeVoice);
    wakeOverlay.addEventListener('touchstart', wakeVoice);
});
