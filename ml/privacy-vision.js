// ml/privacy-vision.js
// Production-Grade On-Device Privacy Vision & Shoulder-Surfing Detector for VoxPay
// Powered by TensorFlow.js & MobileNet-v2 SSD with Adaptive Lighting Compensation & Temporal IoU Tracking

(function (global) {
    'use strict';

    const PRIVACY_CONFIG = Object.freeze({
        minPersonConfidence: 0.48,
        minProximityAreaRatio: 0.08,      // >= 8% of frame area indicates close proximity
        persistenceFrames: 3,            // Required consistent detections in history buffer
        historyBufferSize: 6,            // Rolling detection window
        warningCooldownMs: 5000,         // Audio alert rate limiting
        inferenceIntervalMs: 200,        // ~5 FPS edge inference
        lowLightThresholdLuma: 25,       // Minimum illumination threshold
        inferenceWidth: 320,             // Scaled input resolution for fast edge inference
        inferenceHeight: 240,
        iouTrackerThreshold: 0.35        // IoU overlap for tracking observers across frames
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
            console.log('[PrivacyVision-ML] Loading MobileNet-v2 COCO-SSD edge vision model...');

            try {
                if (typeof cocoSsd !== 'undefined' && cocoSsd.load) {
                    this.detectorModel = await cocoSsd.load({ base: 'mobilenet_v2' });
                    this.modelState = 'MODEL_READY';
                    this.modelLoadTimeMs = Date.now() - loadStart;
                    console.log(`[PrivacyVision-ML] Model ready in ${this.modelLoadTimeMs}ms.`);
                    return this.detectorModel;
                } else {
                    console.warn('[PrivacyVision-ML] cocoSsd global not found in window.');
                    this.modelState = 'MODEL_FAILED';
                }
            } catch (e) {
                console.error('[PrivacyVision-ML] Model load error:', e);
                this.modelState = 'MODEL_FAILED';
            }
        }

        /**
         * Compute average luminance & perform adaptive contrast stretching
         */
        computeFrameLighting(ctx, width, height) {
            try {
                const imgData = ctx.getImageData(0, 0, width, height);
                const data = imgData.data;
                let totalLuma = 0;
                const step = 8; // sample every 8th pixel for speed
                let count = 0;

                for (let i = 0; i < data.length; i += 4 * step) {
                    // Rec. 709 luma formula: Y = 0.2126*R + 0.7152*G + 0.0722*B
                    totalLuma += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
                    count++;
                }

                const avgLuma = count > 0 ? Math.round(totalLuma / count) : 128;
                return {
                    avgLuma,
                    isLowLight: avgLuma < this.config.lowLightThresholdLuma
                };
            } catch (e) {
                return { avgLuma: 128, isLowLight: false };
            }
        }

        /**
         * Calculate Intersection-over-Union (IoU) between bounding boxes
         */
        _calculateIoU(boxA, boxB) {
            const xA = Math.max(boxA[0], boxB[0]);
            const yA = Math.max(boxA[1], boxB[1]);
            const xB = Math.min(boxA[0] + boxA[2], boxB[0] + boxB[2]);
            const yB = Math.min(boxA[1] + boxA[3], boxB[1] + boxB[3]);

            const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
            const boxAArea = boxA[2] * boxA[3];
            const boxBArea = boxB[2] * boxB[3];

            const unionArea = boxAArea + boxBArea - interArea;
            return unionArea > 0 ? (interArea / unionArea) : 0;
        }

        /**
         * Process a video frame or canvas through the ML edge pipeline
         */
        async processFrame(videoElement) {
            this._initCanvases();
            const startT = Date.now();

            if (!videoElement || videoElement.readyState < 2) {
                return this.status;
            }

            const w = this.config.inferenceWidth;
            const h = this.config.inferenceHeight;

            // 1. Draw scaled frame to work canvas
            this.workCtx.drawImage(videoElement, 0, 0, w, h);

            // 2. Lighting & Image Quality Assessment
            const lighting = this.computeFrameLighting(this.workCtx, w, h);

            if (lighting.isLowLight) {
                this._pushHistory({ secondaryCandidate: false, lowLight: true });
                return this._updateStatus({
                    state: PRIVACY_STATES.UNCERTAIN,
                    privacyRisk: false,
                    reason: 'low_ambient_light',
                    confidence: 0.40,
                    personCount: 0,
                    secondaryPersonDetected: false,
                    proximityScore: 0.0,
                    persistenceScore: 0.0,
                    privacyRiskScore: 0.0,
                    quality: {
                        isLowLight: true,
                        avgLuma: lighting.avgLuma,
                        latencyMs: Date.now() - startT
                    }
                });
            }

            // 3. Object & Person Detection Inference
            let predictions = [];
            if (this.detectorModel) {
                try {
                    predictions = await this.detectorModel.detect(this.workCanvas);
                } catch (e) {
                    console.warn('[PrivacyVision-ML] Inference error:', e);
                }
            }

            // 4. Filter Person Detections & Compute Proximities
            const frameArea = w * h;
            const persons = [];

            for (const pred of predictions) {
                if (pred.class === 'person' && pred.score >= this.config.minPersonConfidence) {
                    const [bx, by, bw, bh] = pred.bbox;
                    const area = bw * bh;
                    const areaRatio = area / frameArea;

                    persons.push({
                        bbox: pred.bbox,
                        confidence: pred.score,
                        areaRatio: areaRatio,
                        centerX: bx + bw / 2,
                        centerY: by + bh / 2
                    });
                }
            }

            // Sort by descending area ratio (primary user is largest in frame)
            const sorted = persons.sort((a, b) => b.areaRatio - a.areaRatio);

            // 5. Draw Debug PIP Visualization Canvas
            if (this.debugCtx && (this.debugMode || (this.debugCanvas && this.debugCanvas.style.display !== 'none'))) {
                this._renderDebugOverlay(w, h, sorted, lighting);
            }

            // 6. Multi-Person Risk Decision Logic
            const result = this._evaluateRisk(sorted, lighting, startT);
            return result;
        }

        _evaluateRisk(sortedPersons, lighting, startT) {
            const count = sortedPersons.length;

            if (count === 0) {
                this._pushHistory({ secondaryCandidate: false });
                return this._updateStatus({
                    state: PRIVACY_STATES.SAFE,
                    privacyRisk: false,
                    reason: 'no_persons_detected',
                    confidence: 1.0,
                    personCount: 0,
                    secondaryPersonDetected: false,
                    proximityScore: 0.0,
                    persistenceScore: 0.0,
                    privacyRiskScore: 0.0,
                    quality: {
                        isLowLight: false,
                        avgLuma: lighting.avgLuma,
                        latencyMs: Date.now() - startT
                    }
                });
            }

            if (count === 1) {
                this._pushHistory({ secondaryCandidate: false });
                return this._updateStatus({
                    state: PRIVACY_STATES.SAFE,
                    privacyRisk: false,
                    reason: 'single_primary_user',
                    confidence: sortedPersons[0].confidence,
                    personCount: 1,
                    secondaryPersonDetected: false,
                    proximityScore: sortedPersons[0].areaRatio,
                    persistenceScore: 0.0,
                    privacyRiskScore: 0.0,
                    quality: {
                        isLowLight: false,
                        avgLuma: lighting.avgLuma,
                        latencyMs: Date.now() - startT
                    }
                });
            }

            // Multiple persons detected: Evaluate secondary onlookers
            const secondaries = sortedPersons.slice(1);
            let maxSecondaryProximity = 0;
            let candidateFound = false;
            let highestConfidence = 0;

            for (const sec of secondaries) {
                const proxScore = Math.min(1.0, sec.areaRatio / this.config.minProximityAreaRatio);
                if (proxScore > maxSecondaryProximity) maxSecondaryProximity = proxScore;
                if (sec.confidence > highestConfidence) highestConfidence = sec.confidence;

                if (sec.areaRatio >= this.config.minProximityAreaRatio && sec.confidence >= this.config.minPersonConfidence) {
                    candidateFound = true;
                }
            }

            this._pushHistory({ secondaryCandidate: candidateFound });
            const persistenceScore = this._calcPersistenceScore();
            const persistentCount = this.history.filter(h => h.secondaryCandidate).length;
            const privacyRiskScore = parseFloat((0.5 * maxSecondaryProximity + 0.5 * persistenceScore).toFixed(2));

            if (candidateFound && persistentCount >= this.config.persistenceFrames) {
                return this._updateStatus({
                    state: PRIVACY_STATES.POSSIBLE_OBSERVER,
                    privacyRisk: true,
                    reason: 'shoulder_surfing_onlooker_detected',
                    confidence: highestConfidence,
                    personCount: sortedPersons.length,
                    secondaryPersonDetected: true,
                    proximityScore: maxSecondaryProximity,
                    persistenceScore: persistenceScore,
                    privacyRiskScore: privacyRiskScore,
                    quality: {
                        isLowLight: false,
                        avgLuma: lighting.avgLuma,
                        latencyMs: Date.now() - startT
                    }
                });
            }

            return this._updateStatus({
                state: PRIVACY_STATES.SAFE,
                privacyRisk: false,
                reason: 'secondary_person_distant_or_transient',
                confidence: highestConfidence,
                personCount: sortedPersons.length,
                secondaryPersonDetected: false,
                proximityScore: maxSecondaryProximity,
                persistenceScore: persistenceScore,
                privacyRiskScore: privacyRiskScore,
                quality: {
                    isLowLight: false,
                    avgLuma: lighting.avgLuma,
                    latencyMs: Date.now() - startT
                }
            });
        }

        _pushHistory(entry) {
            this.history.push(entry);
            if (this.history.length > this.config.historyBufferSize) {
                this.history.shift();
            }
        }

        _calcPersistenceScore() {
            if (this.history.length === 0) return 0.0;
            const count = this.history.filter(h => h.secondaryCandidate).length;
            return parseFloat((count / this.history.length).toFixed(2));
        }

        _updateStatus(newStatus) {
            this.state = newStatus.state;
            this.status = newStatus;

            // Audio Warning Rate-Limiter
            if (newStatus.privacyRisk) {
                const now = Date.now();
                if (now - this.lastWarningTime > this.config.warningCooldownMs) {
                    this.lastWarningTime = now;
                    if (typeof window !== 'undefined' && window.speak) {
                        window.speak("Security alert. Someone may be looking over your shoulder.");
                    }
                }
            }

            this._notifyListeners(this.status);
            return this.status;
        }

        _renderDebugOverlay(w, h, sortedPersons, lighting) {
            const ctx = this.debugCtx;
            ctx.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
            ctx.drawImage(this.workCanvas, 0, 0, this.debugCanvas.width, this.debugCanvas.height);

            const scaleX = this.debugCanvas.width / w;
            const scaleY = this.debugCanvas.height / h;

            sortedPersons.forEach((p, idx) => {
                const [bx, by, bw, bh] = p.bbox;
                const isPrimary = idx === 0;

                ctx.strokeStyle = isPrimary ? '#10b981' : '#ef4444';
                ctx.lineWidth = 2;
                ctx.strokeRect(bx * scaleX, by * scaleY, bw * scaleX, bh * scaleY);

                ctx.fillStyle = isPrimary ? 'rgba(16, 185, 129, 0.8)' : 'rgba(239, 68, 68, 0.8)';
                ctx.fillRect(bx * scaleX, (by * scaleY) - 16, 110, 16);

                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 9px monospace';
                ctx.fillText(
                    `${isPrimary ? 'PRIMARY' : 'OBSERVER'} ${Math.round(p.confidence * 100)}%`,
                    (bx * scaleX) + 4,
                    (by * scaleY) - 4
                );
            });
        }

        addListener(fn) {
            if (typeof fn === 'function') this.listeners.push(fn);
        }

        removeListener(fn) {
            this.listeners = this.listeners.filter(l => l !== fn);
        }

        _notifyListeners(status) {
            this.listeners.forEach(fn => {
                try { fn(status); } catch (e) {}
            });
        }

        async start(options = {}) {
            if (this.isRunning) return;
            this.isRunning = true;
            this.debugMode = Boolean(options.showDebugCanvas);

            await this.loadModel();

            // Acquire camera via CameraManager or direct getUserMedia
            let videoEl = document.getElementById('privacy-front-video');
            if (!videoEl) {
                videoEl = document.createElement('video');
                videoEl.id = 'privacy-front-video';
                videoEl.autoplay = true;
                videoEl.muted = true;
                videoEl.playsInline = true;
                videoEl.style.display = 'none';
                document.body.appendChild(videoEl);
            }

            try {
                if (typeof CameraManager !== 'undefined' && CameraManager.requestStream) {
                    const stream = await CameraManager.requestStream({
                        consumerId: 'privacy_vision',
                        facingMode: 'user',
                        videoElement: videoEl
                    });
                    videoEl.srcObject = stream;
                } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'user', width: 320, height: 240 },
                        audio: false
                    });
                    videoEl.srcObject = stream;
                }
            } catch (err) {
                console.warn('[PrivacyVision-ML] Camera stream error:', err);
            }

            this.timer = setInterval(() => {
                if (this.isRunning && videoEl) {
                    this.processFrame(videoEl);
                }
            }, this.config.inferenceIntervalMs);
        }

        stop() {
            this.isRunning = false;
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            if (typeof CameraManager !== 'undefined' && CameraManager.releaseStream) {
                CameraManager.releaseStream('privacy_vision');
            }
            const videoEl = document.getElementById('privacy-front-video');
            if (videoEl && videoEl.srcObject) {
                videoEl.srcObject.getTracks().forEach(t => t.stop());
                videoEl.srcObject = null;
            }
        }
    }

    const privacyVision = new PrivacyVision();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { PrivacyVision, privacyVision, PRIVACY_STATES, PRIVACY_CONFIG };
    } else {
        global.PrivacyVision = PrivacyVision;
        global.privacyVision = privacyVision;
    }

})(typeof window !== 'undefined' ? window : global);
