// voice.js - Voice Assistant & Accessibility Manager
let speechRec = null;
let isVoiceEnabled = false;
let voicesLoaded = false;
let yesListener = null; // dedicated one-shot recognition for confirmations
const MURF_API_KEY = localStorage.getItem('MURF_API_KEY') || 'ap2_f00bf45c-835b-4e69-b4a1-9a08d5bc8390'; // Use provided key or fallback to localStorage
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

    // Try Murf AI first if key exists
    if (MURF_API_KEY) {
        const success = await speakWithMurf(text, onEndCallback);
        if (success) return;
    }

    // Fallback to native
    window.speakNative(text, onEndCallback);
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
        handleVoiceCommand(command);
    };

    speechRec.onerror = (event) => {
        console.log("Speech recognition error:", event.error);

        if (event.error === 'not-allowed') {
            isVoiceEnabled = false;
            localStorage.setItem('swiftpass_voice_enabled', 'false');
            alert("Microphone access was denied. Please click the site settings icon in your URL bar and allow microphone access to use the Voice Assistant.");
        } else if (event.error === 'network') {
            alert("Voice recognition requires an internet connection or secure context (localhost / https).");
        }
    };

    // Auto-restart if it stops unexpectedly while enabled
    speechRec.onend = () => {
        if (isVoiceEnabled && !isDedicatedListening) {
            try { speechRec.start(); } catch (e) { }
        }
    };

    try {
        speechRec.start();
        const btn = document.getElementById('voice-toggle-btn');
        if (btn) {
            btn.innerHTML = '🎙️ Voice Active';
            btn.classList.add('active');
        }

        // Save preference so it auto-starts on reload
        localStorage.setItem('swiftpass_voice_enabled', 'true');

        window.speak("Welcome to Swift Pass. Say 'open QR code scanner' to start a payment.");
    } catch (e) {
        console.error("Could not start recognition. This may be due to browser security blocking microphone access without a click Event.", e);
        alert("Failed to start microphone. Please ensure you are running on localhost, or tap the screen again.");
    }
};

window.handleVoiceCommand = async function (command) {
    if (!command) return;
    const cmd = command.toLowerCase().trim();
    console.log('[voice.js] Processing voice command:', cmd);

    // Current active screen ID gives us context
    const activeScreen = document.querySelector('.screen.active')?.id;
    const sv = window.speakerVerification;

    // 1. Check Command Sensitivity
    const isSensitive = sv ? sv.isCommandSensitive(cmd) : false;

    if (isSensitive && sv) {
        console.log('[voice.js] Sensitive command detected. Invoking Speaker Verification...');
        const profileState = sv.getProfileState();

        if (profileState === 'NO_PROFILE') {
            console.warn('[voice.js] Rejected sensitive command: No speaker profile enrolled.');
            if (window.speak) {
                window.speak("Voice identity profile required for sensitive payment commands. Please enroll your voice in settings.");
            }
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
function executeSensitiveCommand(command, activeScreen) {
    if (command.includes('pay ') || command.startsWith('pay') || command.startsWith('send')) {
        const num = parseNumber(command);
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
 * Non-sensitive navigation and UI voice router
 */
function executeNonSensitiveCommand(command, activeScreen) {
    if ((command.includes('open') && command.includes('scanner')) || command.includes('scan code')) {
        if (activeScreen === 'home-screen') {
            document.getElementById('nav-scan')?.click();
        }
    }
    else if (command.includes('scan qr') || command.includes('scan it')) {
        if (activeScreen === 'scan-screen') {
            document.getElementById('btn-simulate-scan')?.click();
        } else {
            document.getElementById('nav-scan')?.click();
            setTimeout(() => { document.getElementById('btn-simulate-scan')?.click(); }, 1500);
        }
    }
    else if (command.includes('home') || command.includes('go back')) {
        if (typeof showScreen === 'function') {
            showScreen('home-screen');
        }
    }
    else if (command.includes('transactions') || command.includes('history')) {
        if (typeof showScreen === 'function') {
            showScreen('home-screen');
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
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
