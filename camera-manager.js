// camera-manager.js
// Unified Camera & MediaStream Manager for VoxPay
// Manages shared camera streams across QR Scanner and Privacy Vision to prevent duplicate camera sessions.

(function (global) {
    'use strict';

    class CameraManager {
        constructor() {
            this.activeStream = null;
            this.subscribers = new Set(); // set of consumer IDs
            this.activeFacingMode = 'environment';
            this.currentVideoElement = null;
            this.isStarting = false;
        }

        /**
         * Request a camera stream for a consumer (e.g., 'qr_scanner', 'privacy_vision')
         */
        async requestStream({ consumerId, facingMode = 'environment', videoElement = null } = {}) {
            if (!consumerId) throw new Error('consumerId is required to request camera stream');

            this.subscribers.add(consumerId);
            console.log(`[CameraManager] Stream requested by '${consumerId}'. Active subscribers: ${this.subscribers.size}`);

            if (videoElement) {
                this.currentVideoElement = videoElement;
            }

            // Reuse active stream if available and tracks are live
            if (this.activeStream && this.activeStream.active) {
                const videoTrack = this.activeStream.getVideoTracks()[0];
                if (videoTrack && videoTrack.readyState === 'live') {
                    if (videoElement && videoElement.srcObject !== this.activeStream) {
                        videoElement.srcObject = this.activeStream;
                        try { await videoElement.play(); } catch (e) { }
                    }
                    return this.activeStream;
                }
            }

            // Open new camera stream
            if (this.isStarting) {
                // Wait briefly if concurrent start
                await new Promise(r => setTimeout(r, 200));
                if (this.activeStream && this.activeStream.active) return this.activeStream;
            }

            this.isStarting = true;
            this.activeFacingMode = facingMode;

            try {
                const constraints = {
                    video: {
                        facingMode: { ideal: facingMode },
                        width: { ideal: 640 },
                        height: { ideal: 480 }
                    },
                    audio: false
                };

                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                this.activeStream = stream;
                this.isStarting = false;

                if (videoElement) {
                    videoElement.srcObject = stream;
                    try { await videoElement.play(); } catch (e) { }
                }

                return stream;
            } catch (err) {
                this.isStarting = false;
                console.error(`[CameraManager] Failed to access camera for '${consumerId}':`, err);
                throw err;
            }
        }

        /**
         * Release camera stream for a consumer
         */
        releaseStream(consumerId) {
            this.subscribers.delete(consumerId);
            console.log(`[CameraManager] Stream released by '${consumerId}'. Remaining subscribers: ${this.subscribers.size}`);

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
                this.activeStream.getTracks().forEach(track => {
                    try { track.stop(); } catch (e) { }
                });
                this.activeStream = null;
            }
            if (this.currentVideoElement) {
                this.currentVideoElement.srcObject = null;
                this.currentVideoElement = null;
            }
            this.subscribers.clear();
        }

        /**
         * Helper: Check environmental luminance (dark / low-light detection)
         * Returns average luma [0..255] and whether it is low-light
         */
        checkLightLevel(canvas) {
            if (!canvas || canvas.width === 0 || canvas.height === 0) {
                return { avgLuma: 0, isLowLight: true };
            }

            try {
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                const sampleW = Math.min(32, canvas.width);
                const sampleH = Math.min(32, canvas.height);
                const imgData = ctx.getImageData(0, 0, sampleW, sampleH);
                const data = imgData.data;
                let totalLuma = 0;
                const totalPixels = sampleW * sampleH;

                for (let i = 0; i < data.length; i += 4) {
                    // Standard Rec. 601 Luma formula
                    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                    totalLuma += luma;
                }

                const avgLuma = totalLuma / totalPixels;
                const isLowLight = avgLuma < 25; // Luma < 25 is severely underexposed / dark

                return { avgLuma: Math.round(avgLuma), isLowLight };
            } catch (e) {
                return { avgLuma: 0, isLowLight: true };
            }
        }

        /**
         * Check if camera is currently streaming
         */
        isStreaming() {
            return !!(this.activeStream && this.activeStream.active && this.activeStream.getVideoTracks().some(t => t.readyState === 'live'));
        }
    }

    const instance = new CameraManager();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = instance;
    } else {
        global.CameraManager = instance;
    }

})(typeof window !== 'undefined' ? window : global);
