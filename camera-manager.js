// camera-manager.js
// Unified Robust Camera & MediaStream Manager for VoxPay
// Manages shared camera streams across QR Scanner and Privacy Vision with seamless fallback.

(function (global) {
    'use strict';

    class CameraManager {
        constructor() {
            this.activeStream = null;
            this.subscribers = new Set();
            this.activeFacingMode = null;
            this.currentVideoElement = null;
            this.isStarting = false;
        }

        /**
         * Request a camera stream for a consumer (e.g., 'qr_scanner', 'privacy_vision')
         */
        async requestStream({ consumerId, facingMode = 'environment', videoElement = null } = {}) {
            if (!consumerId) throw new Error('consumerId is required to request camera stream');

            this.subscribers.add(consumerId);
            console.log(`[CameraManager] Stream requested by '${consumerId}' (facing: ${facingMode}). Active: ${this.subscribers.size}`);

            // If QR scanner requests environment on a mobile/desktop device:
            // If facing mode changed and previous stream exists, stop previous to switch cameras cleanly
            if (this.activeStream && this.activeStream.active && this.activeFacingMode && this.activeFacingMode !== facingMode) {
                console.log(`[CameraManager] Switching facingMode from ${this.activeFacingMode} to ${facingMode}`);
                this.stopAll();
            }

            // Reuse active stream if available and tracks are live
            if (this.activeStream && this.activeStream.active) {
                const videoTrack = this.activeStream.getVideoTracks()[0];
                if (videoTrack && videoTrack.readyState === 'live') {
                    if (videoElement) {
                        videoElement.srcObject = this.activeStream;
                        videoElement.setAttribute('playsinline', 'true');
                        videoElement.setAttribute('autoplay', 'true');
                        try { await videoElement.play(); } catch (e) { }
                    }
                    return this.activeStream;
                }
            }

            this.isStarting = true;
            this.activeFacingMode = facingMode;

            // Progressive constraint fallback list for maximum device compatibility
            const constraintAttempts = [
                { video: { facingMode: { ideal: facingMode }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
                { video: { facingMode: facingMode }, audio: false },
                { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
                { video: true, audio: false }
            ];

            let stream = null;
            let lastErr = null;

            for (const constraints of constraintAttempts) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia(constraints);
                    if (stream && stream.active) {
                        break;
                    }
                } catch (err) {
                    lastErr = err;
                    console.warn('[CameraManager] Constraint attempt failed:', constraints, err.name);
                }
            }

            this.isStarting = false;

            if (!stream) {
                console.error(`[CameraManager] All camera constraint attempts failed for '${consumerId}':`, lastErr);
                throw lastErr || new Error('Unable to access camera.');
            }

            this.activeStream = stream;

            if (videoElement) {
                videoElement.srcObject = stream;
                videoElement.setAttribute('playsinline', 'true');
                videoElement.setAttribute('autoplay', 'true');
                try {
                    await videoElement.play();
                } catch (e) {
                    console.warn('[CameraManager] video.play() warning:', e);
                }
            }

            return stream;
        }

        /**
         * Release camera stream for a consumer
         */
        releaseStream(consumerId) {
            this.subscribers.delete(consumerId);
            console.log(`[CameraManager] Stream released by '${consumerId}'. Remaining: ${this.subscribers.size}`);

            if (this.subscribers.size === 0) {
                this.stopAll();
            }
        }

        /**
         * Stop all active camera tracks
         */
        stopAll() {
            if (this.activeStream) {
                console.log('[CameraManager] Stopping all camera tracks.');
                try {
                    this.activeStream.getTracks().forEach(track => {
                        try { track.stop(); } catch (e) {}
                    });
                } catch (e) {}
                this.activeStream = null;
                this.activeFacingMode = null;
            }
        }

        isStreamActive() {
            return Boolean(this.activeStream && this.activeStream.active);
        }
    }

    const cameraManager = new CameraManager();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { CameraManager, cameraManager };
    } else {
        global.CameraManager = cameraManager;
        global.cameraManager = cameraManager;
    }

})(typeof window !== 'undefined' ? window : global);
