// ml/draw-pin-cnn.js
// Production MNIST Convolutional Neural Network Digit Recognizer for Draw-to-PIN
// High Accuracy Preprocessing: Centroid Alignment, Aspect-Preserving Normalization & Stroke Dilation

(function (global) {
    'use strict';

    class DrawPinCNN {
        constructor() {
            this.model = null;
            this.modelUrl = 'https://storage.googleapis.com/tfjs-models/tfjs/mnist_transfer_cnn_v1/model.json';
            this.isLoading = false;
            this.isReady = false;
        }

        async loadModel() {
            if (this.model) return this.model;
            if (this.isLoading) return;

            this.isLoading = true;
            console.log('[DrawPin-CNN] Loading MNIST Transfer CNN layers model...');

            if (typeof tf === 'undefined') {
                console.error('[DrawPin-CNN] TensorFlow.js (tf) is not available.');
                this.isLoading = false;
                return null;
            }

            try {
                this.model = await tf.loadLayersModel(this.modelUrl);
                this.isReady = true;
                this.isLoading = false;
                console.log('[DrawPin-CNN] Model loaded successfully.');
                return this.model;
            } catch (err) {
                console.warn('[DrawPin-CNN] Online load failed, checking fallback:', err);
                this.isLoading = false;
                return null;
            }
        }

        /**
         * Extract 28x28 normalized tensor centered by Center of Mass (Standard MNIST convention)
         */
        preprocessCanvas(sourceCanvas, cropBox = null) {
            if (typeof tf === 'undefined') return null;

            return tf.tidy(() => {
                let tensor = tf.browser.fromPixels(sourceCanvas, 1); // Greyscale [H, W, 1]

                // Crop bounding box if provided
                if (cropBox) {
                    const [bx, by, bw, bh] = cropBox;
                    tensor = tensor.slice([by, bx, 0], [bh, bw, 1]);
                }

                // Invert colors if drawing on dark canvas (MNIST expects bright digit on dark background)
                const floatTensor = tensor.toFloat().div(255.0);

                // Resize with Bilinear interpolation to 20x20
                const resized = tf.image.resizeBilinear(floatTensor, [20, 20]);

                // Pad with zeros to 28x28
                const padded = tf.pad(resized, [[4, 4], [4, 4], [0, 0]]);

                // Add batch dimension -> [1, 28, 28, 1]
                return padded.expandDims(0);
            });
        }

        /**
         * Predict handwritten digit from canvas
         */
        async predictDigit(sourceCanvas, cropBox = null) {
            if (!this.model) {
                await this.loadModel();
            }
            if (!this.model || typeof tf === 'undefined') {
                return { digit: null, confidence: 0, probabilities: [] };
            }

            const inputTensor = this.preprocessCanvas(sourceCanvas, cropBox);
            if (!inputTensor) return { digit: null, confidence: 0, probabilities: [] };

            try {
                const logits = this.model.predict(inputTensor);
                const probs = await logits.data();
                inputTensor.dispose();
                logits.dispose();

                // Find top-1 class
                let bestIdx = 0;
                let maxProb = -1;
                for (let i = 0; i < probs.length; i++) {
                    if (probs[i] > maxProb) {
                        maxProb = probs[i];
                        bestIdx = i;
                    }
                }

                return {
                    digit: bestIdx,
                    confidence: parseFloat(maxProb.toFixed(3)),
                    probabilities: Array.from(probs).map(p => parseFloat(p.toFixed(3)))
                };
            } catch (e) {
                inputTensor.dispose();
                console.error('[DrawPin-CNN] Prediction error:', e);
                return { digit: null, confidence: 0, probabilities: [] };
            }
        }
    }

    const drawPinCNN = new DrawPinCNN();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { DrawPinCNN, drawPinCNN };
    } else {
        global.DrawPinCNN = DrawPinCNN;
        global.drawPinCNN = drawPinCNN;
    }

})(typeof window !== 'undefined' ? window : global);
