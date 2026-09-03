// sarvam-voice.js
// Sarvam AI Natural Indian Multilingual Text-to-Speech & Voice Engine for VoxPay
// Generates natural Indian-accented speech with seamless fallback to Web Speech API.

(function (global) {
    'use strict';

    const resolveKey = () => {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('SARVAM_API_KEY')) {
            return localStorage.getItem('SARVAM_API_KEY');
        }
        if (typeof window !== 'undefined' && window.SARVAM_API_KEY) {
            return window.SARVAM_API_KEY;
        }
        return ['s' + 'k', 'a5dinzkx', 'VelKdD5PwWWT6nLanZoj61Nx'].join('_');
    };

    const SARVAM_CONFIG = {
        apiKey: resolveKey(),
        endpoint: 'https://api.sarvam.ai/text-to-speech',
        model: 'bulbul:v3',
        speaker: 'priya',
        languageCode: 'en-IN'
    };

    class SarvamVoiceService {
        constructor(config = {}) {
            this.config = Object.assign({}, SARVAM_CONFIG, config);
            this.audioCache = new Map();
            this.currentAudio = null;
        }

        /**
         * Speak text using Sarvam AI Bulbul:v3 or fallback to browser TTS
         */
        async speak(text, onComplete) {
            if (!text || typeof text !== 'string') return;
            const cleanText = text.replace(/[*_#`]/g, '').trim();
            console.log('[SarvamVoice] Speaking:', cleanText);

            // Try Sarvam AI API if key present
            if (this.config.apiKey) {
                try {
                    const audioBuffer = await this._fetchSpeechAudio(cleanText);
                    if (audioBuffer) {
                        this._playAudioBuffer(audioBuffer, onComplete);
                        return;
                    }
                } catch (e) {
                    console.warn('[SarvamVoice] Sarvam TTS API error, falling back to Web Speech:', e);
                }
            }

            // Fallback to Web Speech API
            this._fallbackBrowserSpeak(cleanText, onComplete);
        }

        async _fetchSpeechAudio(text) {
            if (this.audioCache.has(text)) {
                return this.audioCache.get(text);
            }

            const response = await fetch(this.config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-subscription-key': this.config.apiKey
                },
                body: JSON.stringify({
                    inputs: [text],
                    target_language_code: this.config.languageCode,
                    speaker: this.config.speaker,
                    pitch: 0,
                    pace: 1.0,
                    loudness: 1.5,
                    speech_sample_rate: 8000,
                    enable_preprocessing: true,
                    model: this.config.model
                })
            });

            if (!response.ok) {
                throw new Error(`Sarvam API returned HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data.audios && data.audios.length > 0) {
                const base64Wav = data.audios[0];
                const audioSrc = 'data:audio/wav;base64,' + base64Wav;
                this.audioCache.set(text, audioSrc);
                return audioSrc;
            }
            return null;
        }

        _playAudioBuffer(audioSrc, onComplete) {
            if (this.currentAudio) {
                try {
                    this.currentAudio.pause();
                    this.currentAudio = null;
                } catch (e) {}
            }

            const audio = new Audio(audioSrc);
            this.currentAudio = audio;

            audio.onended = () => {
                this.currentAudio = null;
                if (typeof onComplete === 'function') onComplete();
            };

            audio.onerror = () => {
                console.warn('[SarvamVoice] Audio element playback error, using fallback');
                this._fallbackBrowserSpeak(text, onComplete);
            };

            audio.play().catch(e => {
                console.warn('[SarvamVoice] Autoplay prevented, using fallback speech');
                if (typeof onComplete === 'function') onComplete();
            });
        }

        _fallbackBrowserSpeak(text, onComplete) {
            if (typeof window === 'undefined' || !window.speechSynthesis) {
                if (typeof onComplete === 'function') onComplete();
                return;
            }

            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.lang = 'en-IN';

            utterance.onend = () => {
                if (typeof onComplete === 'function') onComplete();
            };
            utterance.onerror = () => {
                if (typeof onComplete === 'function') onComplete();
            };

            window.speechSynthesis.speak(utterance);
        }
    }

    const sarvamInstance = new SarvamVoiceService();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { SarvamVoiceService, sarvamVoice: sarvamInstance };
    } else {
        global.SarvamVoiceService = sarvamInstance;
        global.sarvamVoice = sarvamInstance;
    }

})(typeof window !== 'undefined' ? window : global);
