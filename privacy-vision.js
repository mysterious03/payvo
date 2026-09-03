// privacy-vision.js
// Local Camera-Based Privacy & Shoulder-Surfing Risk Detection Layer for VoxPay
// Strictly on-device processing. No biometric/face storage. Estimates observer proximity risk.

(function (global) {
    'use strict';

    const PRIVACY_CONFIG = Object.freeze({
        minPersonConfidence: 0.50,
        minProximityAreaRatio: 0.08,      // >= 8% of frame area indicates close proximity
        persistenceFrames: 3,            // Required consistent detections in history buffer
        historyBufferSize: 5,            // Rolling detection window
        warningCooldownMs: 6000,         // Audio alert rate limiting
        inferenceIntervalMs: 250,        // 4 FPS for battery/CPU efficiency
        lowLightThresholdLuma: 25,       // Minimum illumination threshold
        inferenceWidth: 320,             // Scaled input resolution for fast edge inference
        inferenceHeight: 240
    });

    const PRIVACY_STATES = Object.freeze({
        SAFE: 'SAFE',
        POSSIBLE_OBSERVER: 'POSSIBLE_OBSERVER',
        UNCERTAIN: 'UNCERTAIN'
    });

    class PrivacyVision {
        constructor(config = {}) {
            this.config = Object.assign({}, PRIVACY_CONFIG, config);
            this.state = PRIVACY_STATES.SAFE;
            this.status = {
                state: PRIVACY_STATES.SAFE,
                privacyRisk: false,
                reason: 'initialized',
                confidence: 1.0,
                personCount: 0,
                secondaryPersonDetected: false,
                proximityScore: 0.0,
                persistenceScore: 0.0,
                privacyRiskScore: 0.0,
                quality: {
                    isLowLight: false,
                    avgLuma: 128,
                    fps: 0,
                    latencyMs: 0
                }
            };

            this.history = [];
            this.listeners = [];
            this.isRunning = false;
            this.timer = null;
            this.lastWarningTime = 0;
            this.debugMode = false;
            this.detectorModel = null;
            this.modelState = 'MODEL_IDLE'; // 'MODEL_IDLE' | 'MODEL_LOADING' | 'MODEL_READY' | 'MODEL_FAILED'
            this.modelLoadTimeMs = 0;

            // Frame canvas
            this.workCanvas = null;
            this.workCtx = null;
            this.debugCanvas = null;
            this.debugCtx = null;
        }

        /**
         * Initialize work canvases
         */
        _initCanvases() {
            if (typeof document === 'undefined') return;

            if (!this.workCanvas) {
                this.workCanvas = document.createElement('canvas');
                this.workCanvas.width = this.config.inferenceWidth;
                this.workCanvas.height = this.config.inferenceHeight;
                this.workCtx = this.workCanvas.getContext('2d', { willReadFrequently: true });
            }

            this.debugCanvas = document.getElementById('privacy-debug-canvas');
            if (this.debugCanvas) {
                this.debugCtx = this.debugCanvas.getContext('2d');
            }
        }

        /**
         * Load client-side object detection model (COCO-SSD / MobileNet-v2)
         */
        async loadModel() {
            if (this.detectorModel) return this.detectorModel;
            if (this.modelState === 'MODEL_LOADING') return;

            this.modelState = 'MODEL_LOADING';
            const loadStart = Date.now();
            console.log('[PrivacyVision] Loading COCO-SSD person detection model...');

            try {
                if (typeof cocoSsd !== 'undefined' && cocoSsd.load) {
                    this.detectorModel = await cocoSsd.load({ base: 'mobilenet_v2' });
                    this.modelState = 'MODEL_READY';
                    this.modelLoadTimeMs = Date.now() - loadStart;
                    console.log(`[PrivacyVision] COCO-SSD ready (loaded in ${this.modelLoadTimeMs}ms).`);
                    return this.detectorModel;
                } else {
                    console.warn('[PrivacyVision] cocoSsd global is not defined in window.');
                    this.modelState = 'MODEL_FAILED';
                }
            } catch (err) {
                console.error('[PrivacyVision] COCO-SSD failed to load:', err);
                this.modelState = 'MODEL_FAILED';
            }
        }

        /**
         * Start Privacy Monitoring Session
         */
        async start({ videoElement = null } = {}) {
            if (this.isRunning) return;
            this.isRunning = true;
            this._initCanvases();
            this.history = [];

            console.log('[PrivacyVision] Starting privacy monitoring...');
            this._updateStatus({
                state: PRIVACY_STATES.SAFE,
                privacyRisk: false,
                reason: 'monitoring_started',
                confidence: 0.9
            });

            // Request camera via unified CameraManager
            if (typeof CameraManager !== 'undefined' && CameraManager.requestStream) {
                try {
                    await CameraManager.requestStream({
                        consumerId: 'privacy_vision',
                        facingMode: 'user', // Selfie/front camera is optimal for shoulder-surfing
                        videoElement: videoElement || document.getElementById('qr-video')
                    });
                } catch (err) {
                    console.warn('[PrivacyVision] Camera access unavailable:', err);
                    this._updateStatus({
                        state: PRIVACY_STATES.UNCERTAIN,
                        privacyRisk: false,
                        reason: 'camera_permission_denied_or_unavailable',
                        confidence: 0.0
                    });
                }
            }

            // Start detection loop
            this._scheduleNextInference();
        }

        /**
         * Stop Privacy Monitoring Session and release camera
         */
        stop() {
            this.isRunning = false;
            if (this.timer) {
                clearTimeout(this.timer);
                this.timer = null;
            }

            if (typeof CameraManager !== 'undefined' && CameraManager.releaseStream) {
                CameraManager.releaseStream('privacy_vision');
            }

            this.history = [];
            this._updateStatus({
                state: PRIVACY_STATES.SAFE,
                privacyRisk: false,
                reason: 'monitoring_stopped',
                confidence: 1.0
            });

            console.log('[PrivacyVision] Privacy monitoring stopped.');
        }

        /**
         * Main inference loop step
         */
        async _scheduleNextInference() {
            if (!this.isRunning) return;

            const startTime = Date.now();
            try {
                await this._processFrame();
            } catch (err) {
                console.error('[PrivacyVision] Error during frame inference:', err);
            }

            const latency = Date.now() - startTime;
            this.status.quality.latencyMs = latency;
            this.status.quality.fps = latency > 0 ? Math.round(1000 / Math.max(latency, this.config.inferenceIntervalMs)) : 0;

            const nextDelay = Math.max(50, this.config.inferenceIntervalMs - latency);
            if (this.isRunning) {
                this.timer = setTimeout(() => this._scheduleNextInference(), nextDelay);
            }
        }

        /**
         * Frame capture & detection pipeline
         */
        async _processFrame() {
            if (!this.workCanvas || !this.workCtx) return;

            // Check if camera is active
            const video = document.getElementById('qr-video') || (typeof CameraManager !== 'undefined' && CameraManager.currentVideoElement);
            if (!video || video.readyState < 2 || video.paused) {
                this._updateStatus({
                    state: PRIVACY_STATES.UNCERTAIN,
                    privacyRisk: false,
                    reason: 'camera_unavailable_or_paused',
                    confidence: 0.0
                });
                return;
            }

            // 1. Draw video frame to scaled work canvas
            const w = this.workCanvas.width;
            const h = this.workCanvas.height;
            this.workCtx.drawImage(video, 0, 0, w, h);

            // 2. Luminance / Lighting Quality Check
            let lightCheck = { avgLuma: 120, isLowLight: false };
            if (typeof CameraManager !== 'undefined' && CameraManager.checkLightLevel) {
                lightCheck = CameraManager.checkLightLevel(this.workCanvas);
            }
            this.status.quality.avgLuma = lightCheck.avgLuma;
            this.status.quality.isLowLight = lightCheck.isLowLight;

            if (lightCheck.isLowLight) {
                this._updateStatus({
                    state: PRIVACY_STATES.UNCERTAIN,
                    privacyRisk: false,
                    reason: 'camera_low_light',
                    confidence: 0.3
                });
                return;
            }

            // 3. Object / Person Detection
            if (!this.detectorModel || !this.detectorModel.detect) {
                this._updateStatus({
                    state: PRIVACY_STATES.UNCERTAIN,
                    privacyRisk: false,
                    reason: 'model_unavailable',
                    confidence: 0.0
                });
                return;
            }

            const rawPredictions = await this.detectorModel.detect(this.workCanvas);
            const detectedPersons = rawPredictions
                .filter(p => p.class === 'person' && p.score >= this.config.minPersonConfidence)
                .map(p => ({
                    bbox: [p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]], // [x, y, w, h]
                    confidence: p.score
                }));

            // 4. Evaluate Spatial & Temporal Privacy Heuristic
            this.evaluatePrivacy(detectedPersons, { frameWidth: w, frameHeight: h });

            // 5. Draw Debug Overlay if active
            if (this.debugMode && this.debugCanvas && this.debugCtx) {
                this._renderDebugOverlay(detectedPersons, w, h);
            }
        }

        /**
         * Pure Deterministic Evaluation: Separates ML inference from privacy decision logic
         */
        evaluatePrivacy(detectedPersons = [], frameMeta = { frameWidth: 320, frameHeight: 240 }) {
            const fw = frameMeta.frameWidth || 320;
            const fh = frameMeta.frameHeight || 240;
            const frameArea = fw * fh;

            // Handle Camera Quality / Zero Detection
            if (frameMeta.qualityError) {
                return this._updateStatus({
                    state: PRIVACY_STATES.UNCERTAIN,
                    privacyRisk: false,
                    reason: frameMeta.qualityError,
                    confidence: 0.0
                });
            }

            if (detectedPersons.length === 0) {
                this._pushHistory({ secondaryCandidate: false });
                return this._updateStatus({
                    state: PRIVACY_STATES.SAFE,
                    privacyRisk: false,
                    reason: 'no_persons_detected',
                    confidence: 0.95,
                    personCount: 0,
                    secondaryPersonDetected: false,
                    proximityScore: 0.0,
                    persistenceScore: this._calcPersistenceScore(),
                    privacyRiskScore: 0.0
                });
            }

            // Sort persons by bounding box area (largest = primary user in foreground)
            const sorted = detectedPersons
                .map(p => {
                    const [x, y, w, h] = p.bbox;
                    const area = Math.max(0, w * h);
                    const areaRatio = area / frameArea;
                    return {
                        bbox: p.bbox,
                        confidence: p.confidence || 0.8,
                        area,
                        areaRatio
                    };
                })
                .sort((a, b) => b.area - a.area);

            // If only 1 person detected, treat as primary user
            if (sorted.length === 1) {
                this._pushHistory({ secondaryCandidate: false });
                return this._updateStatus({
                    state: PRIVACY_STATES.SAFE,
                    privacyRisk: false,
                    reason: 'primary_user_only',
                    confidence: sorted[0].confidence,
                    personCount: 1,
                    secondaryPersonDetected: false,
                    proximityScore: 0.0,
                    persistenceScore: this._calcPersistenceScore(),
                    privacyRiskScore: 0.05
                });
            }

            // Multiple persons detected: Evaluate secondary persons
            const primary = sorted[0];
            const secondaries = sorted.slice(1);

            let maxSecondaryProximity = 0;
            let candidateFound = false;
            let highestConfidence = 0;

            for (const sec of secondaries) {
                // Proximity metric: ratio of secondary person area to threshold
                const proxScore = Math.min(1.0, sec.areaRatio / this.config.minProximityAreaRatio);
                if (proxScore > maxSecondaryProximity) {
                    maxSecondaryProximity = proxScore;
                }
                if (sec.confidence > highestConfidence) {
                    highestConfidence = sec.confidence;
                }

                if (sec.areaRatio >= this.config.minProximityAreaRatio && sec.confidence >= this.config.minPersonConfidence) {
                    candidateFound = true;
                }
            }

            // Update temporal history
            this._pushHistory({ secondaryCandidate: candidateFound });
            const persistenceScore = this._calcPersistenceScore();
            const persistentCount = this.history.filter(h => h.secondaryCandidate).length;

            // Combined deterministic privacy risk formula:
            // RiskScore = 0.5 * proximityScore + 0.5 * persistenceScore
            const privacyRiskScore = parseFloat((0.5 * maxSecondaryProximity + 0.5 * persistenceScore).toFixed(2));

            // Decision threshold: Candidate must have at least persistenceFrames detections in history window
            if (candidateFound && persistentCount >= this.config.persistenceFrames) {
                return this._updateStatus({
                    state: PRIVACY_STATES.POSSIBLE_OBSERVER,
                    privacyRisk: true,
                    reason: 'possible_secondary_person',
                    confidence: highestConfidence,
                    personCount: sorted.length,
                    secondaryPersonDetected: true,
                    proximityScore: parseFloat(maxSecondaryProximity.toFixed(2)),
                    persistenceScore: parseFloat(persistenceScore.toFixed(2)),
                    privacyRiskScore: privacyRiskScore
                });
            } else {
                return this._updateStatus({
                    state: PRIVACY_STATES.SAFE,
                    privacyRisk: false,
                    reason: candidateFound ? 'secondary_person_transient' : 'secondary_person_distant',
                    confidence: 0.85,
                    personCount: sorted.length,
                    secondaryPersonDetected: candidateFound,
                    proximityScore: parseFloat(maxSecondaryProximity.toFixed(2)),
                    persistenceScore: parseFloat(persistenceScore.toFixed(2)),
                    privacyRiskScore: privacyRiskScore
                });
            }
        }

        _pushHistory(frameResult) {
            this.history.push(frameResult);
            if (this.history.length > this.config.historyBufferSize) {
                this.history.shift();
            }
        }

        _calcPersistenceScore() {
            if (this.history.length === 0) return 0.0;
            const count = this.history.filter(h => h.secondaryCandidate).length;
            return count / this.history.length;
        }

        /**
         * Update internal state and emit events
         */
        _updateStatus(newStatus) {
            const prevState = this.state;
            this.state = newStatus.state;
            this.status = Object.assign(this.status, newStatus);

            // Check if state transitioned to POSSIBLE_OBSERVER (Trigger audio + ARIA)
            if (prevState !== PRIVACY_STATES.POSSIBLE_OBSERVER && this.state === PRIVACY_STATES.POSSIBLE_OBSERVER) {
                this._handleObserverAlert();
            }

            // Update DOM accessible status
            this._updateAccessibleStatusDOM();

            // Notify listeners
            this.listeners.forEach(cb => {
                try { cb(this.getStatus()); } catch (e) { }
            });

            return this.getStatus();
        }

        /**
         * Audio announcement with cooldown
         */
        _handleObserverAlert() {
            const now = Date.now();
            if (now - this.lastWarningTime >= this.config.warningCooldownMs) {
                this.lastWarningTime = now;
                console.warn('[PrivacyVision] ⚠️ Potential observer detected near screen!');

                if (typeof window !== 'undefined' && window.speak) {
                    window.speak('Another person may be nearby. Please check your surroundings before continuing.');
                }
            }
        }

        /**
         * Update accessible DOM status
         */
        _updateAccessibleStatusDOM() {
            if (typeof document === 'undefined') return;
            const el = document.getElementById('privacy-status');
            if (!el) return;

            if (this.state === PRIVACY_STATES.POSSIBLE_OBSERVER) {
                el.textContent = '⚠️ Privacy check: Possible observer nearby';
                el.style.color = '#ffb703';
            } else if (this.state === PRIVACY_STATES.UNCERTAIN) {
                el.textContent = 'ℹ️ Privacy check: Camera visibility uncertain';
                el.style.color = '#94a3b8';
            } else {
                el.textContent = '✓ Privacy check: Space secure';
                el.style.color = '#10b981';
            }
        }

        /**
         * Debug Overlay Rendering
         */
        _renderDebugOverlay(persons, w, h) {
            if (!this.debugCtx) return;
            const ctx = this.debugCtx;
            ctx.clearRect(0, 0, w, h);

            persons.forEach((p, idx) => {
                const [x, y, bw, bh] = p.bbox;
                const isPrimary = idx === 0;
                ctx.strokeStyle = isPrimary ? '#10b981' : '#ff4d4d';
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, bw, bh);

                ctx.fillStyle = isPrimary ? '#10b981' : '#ff4d4d';
                ctx.font = '11px monospace';
                const label = `${isPrimary ? 'Primary' : 'Secondary'} (${Math.round((p.confidence || 0.8) * 100)}%)`;
                ctx.fillText(label, x + 4, y + 14);
            });

            // Status bar
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, h - 22, w, 22);
            ctx.fillStyle = this.state === PRIVACY_STATES.POSSIBLE_OBSERVER ? '#ff4d4d' : '#10b981';
            ctx.font = '10px monospace';
            ctx.fillText(`State: ${this.state} | Risk: ${this.status.privacyRiskScore} | Lat: ${this.status.quality.latencyMs}ms`, 6, h - 7);
        }

        /**
         * Public Status Getter
         */
        getStatus() {
            return JSON.parse(JSON.stringify(this.status));
        }

        /**
         * Register Risk Callback
         */
        onRisk(callback) {
            if (typeof callback === 'function') {
                this.listeners.push(callback);
            }
            return () => {
                this.listeners = this.listeners.filter(cb => cb !== callback);
            };
        }

        setDebug(enabled) {
            this.debugMode = !!enabled;
            const canvas = document.getElementById('privacy-debug-canvas');
            if (canvas) {
                canvas.style.display = this.debugMode ? 'block' : 'none';
            }
        }
    }

    const instance = new PrivacyVision();
    instance.PrivacyVision = PrivacyVision;
    instance.PRIVACY_STATES = PRIVACY_STATES;
    instance.PRIVACY_CONFIG = PRIVACY_CONFIG;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = instance;
    } else {
        global.privacyVision = instance;
        global.PrivacyVision = PrivacyVision;
    }

})(typeof window !== 'undefined' ? window : global);
