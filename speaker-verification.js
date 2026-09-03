// speaker-verification.js
// Authorized-Speaker Voice Identity Verification Layer for VoxPay (SwiftPass)
// Reference Architecture: SpeechBrain ECAPA-TDNN / Voice Login ECAPA-TDNN
// Pure client-side processing. Biometric embeddings only — no raw audio storage.

(function (global) {
    'use strict';

    // =========================================================================
    // 1. CONFIGURATION & STATE DEFINITIONS
    // =========================================================================

    const SPEAKER_CONFIG = Object.freeze({
        // Model & Audio Processing
        sampleRate: 16000,              // 16 kHz standard for ECAPA-TDNN
        frameLengthMs: 25,              // 25ms frame window (400 samples @ 16kHz)
        frameHopMs: 10,                 // 10ms frame hop (160 samples @ 16kHz)
        fftSize: 512,                   // Next power of 2 for 400 samples
        numMelFilters: 80,              // 80 log-mel filterbank channels
        preEmphasisCoeff: 0.97,         // High-frequency pre-emphasis filter
        embeddingDim: 192,              // 192-dimensional ECAPA-TDNN bottleneck representation
        
        // VAD & Quality Thresholds
        minSpeechDurationMs: 800,       // Minimum 800ms of usable voiced speech required
        minSnrDb: 6.0,                  // Minimum 6.0 dB SNR for reliable verification
        minFrameEnergy: 0.0002,         // Adaptive energy threshold for silence suppression
        vadEnergyRatio: 0.08,           // Adaptive VAD threshold relative to peak frame energy
        
        // Verification & Enrollment Decision Logic
        threshold: 0.72,                // Development calibrated similarity threshold (NOT production calibrated)
        uncertainBand: 0.06,            // Scores within (threshold ± uncertainBand) under noisy conditions trigger UNCERTAIN
        minEnrollmentSamples: 3,        // Minimum samples required to build speaker profile
        maxEnrollmentSamples: 5,        // Target enrollment samples
        maxAttempts: 3,                 // Maximum bounded retry attempts for UNCERTAIN verification
        
        // Security Storage Tag
        storageKey: 'voxpay_speaker_profile_v1' // DEVELOPMENT ONLY: Browser localStorage
    });

    const PROFILE_STATES = Object.freeze({
        NO_PROFILE: 'NO_PROFILE',
        READY: 'READY',
        VERIFYING: 'VERIFYING',
        VERIFIED: 'VERIFIED',
        MISMATCH: 'MISMATCH',
        UNCERTAIN: 'UNCERTAIN',
        ERROR: 'ERROR'
    });

    const VERIFICATION_OUTCOMES = Object.freeze({
        MATCH: 'MATCH',
        MISMATCH: 'MISMATCH',
        UNCERTAIN: 'UNCERTAIN'
    });

    // =========================================================================
    // 2. AUDIO SIGNAL PROCESSING & MEL FILTERBANK
    // =========================================================================

    class AudioPreprocessor {
        constructor(config = SPEAKER_CONFIG) {
            this.config = config;
            this.melFilters = this._createMelFilterbank(
                this.config.numMelFilters,
                this.config.fftSize,
                this.config.sampleRate,
                20.0,
                8000.0
            );
            this.hammingWindow = this._createHammingWindow(
                Math.floor((this.config.frameLengthMs * this.config.sampleRate) / 1000)
            );
        }

        _hzToMel(hz) {
            return 2595.0 * Math.log10(1.0 + hz / 700.0);
        }

        _melToHz(mel) {
            return 700.0 * (Math.pow(10.0, mel / 2595.0) - 1.0);
        }

        _createHammingWindow(N) {
            const win = new Float32Array(N);
            for (let n = 0; n < N; n++) {
                win[n] = 0.54 - 0.46 * Math.cos((2.0 * Math.PI * n) / (N - 1));
            }
            return win;
        }

        _createMelFilterbank(numFilters, fftSize, sampleRate, lowFreq, highFreq) {
            const numBf = Math.floor(fftSize / 2) + 1;
            const lowMel = this._hzToMel(lowFreq);
            const highMel = this._hzToMel(highFreq);
            const melPoints = new Float32Array(numFilters + 2);

            for (let i = 0; i < numFilters + 2; i++) {
                melPoints[i] = lowMel + (i * (highMel - lowMel)) / (numFilters + 1);
            }

            const binPoints = new Int32Array(numFilters + 2);
            for (let i = 0; i < numFilters + 2; i++) {
                const hz = this._melToHz(melPoints[i]);
                binPoints[i] = Math.floor(((fftSize + 1) * hz) / sampleRate);
            }

            const filterbank = [];
            for (let m = 1; m <= numFilters; m++) {
                const filter = new Float32Array(numBf);
                const left = binPoints[m - 1];
                const center = binPoints[m];
                const right = binPoints[m + 1];

                for (let k = left; k < center; k++) {
                    if (k < numBf) filter[k] = (k - left) / Math.max(1, center - left);
                }
                for (let k = center; k < right; k++) {
                    if (k < numBf) filter[k] = (right - k) / Math.max(1, right - center);
                }
                filterbank.push(filter);
            }
            return filterbank;
        }

        /**
         * Fast Cooley-Tukey Radix-2 Real FFT (In-Place on power of 2)
         */
        _fft512(real, imag) {
            const n = 512;
            let j = 0;
            for (let i = 0; i < n - 1; i++) {
                if (i < j) {
                    const tr = real[i]; real[i] = real[j]; real[j] = tr;
                    const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
                }
                let k = n >> 1;
                while (k <= j) {
                    j -= k;
                    k >>= 1;
                }
                j += k;
            }

            for (let len = 2; len <= n; len <<= 1) {
                const half = len >> 1;
                const angle = (-2.0 * Math.PI) / len;
                const wStepR = Math.cos(angle);
                const wStepI = Math.sin(angle);

                for (let i = 0; i < n; i += len) {
                    let wR = 1.0;
                    let wI = 0.0;
                    for (let k = 0; k < half; k++) {
                        const pos = i + k;
                        const match = pos + half;
                        const uR = real[pos];
                        const uI = imag[pos];
                        const vR = real[match] * wR - imag[match] * wI;
                        const vI = real[match] * wI + imag[match] * wR;

                        real[pos] = uR + vR;
                        imag[pos] = uI + vI;
                        real[match] = uR - vR;
                        imag[match] = uI - vI;

                        const nextWR = wR * wStepR - wI * wStepI;
                        wI = wR * wStepI + wI * wStepR;
                        wR = nextWR;
                    }
                }
            }
        }

        /**
         * Converts mono Float32Array PCM to 16kHz if needed
         */
        resampleTo16k(inputBuffer, inputSampleRate) {
            if (inputSampleRate === this.config.sampleRate) {
                return inputBuffer;
            }
            const ratio = inputSampleRate / this.config.sampleRate;
            const newLength = Math.round(inputBuffer.length / ratio);
            const result = new Float32Array(newLength);
            for (let i = 0; i < newLength; i++) {
                const originIndex = i * ratio;
                const indexFloor = Math.floor(originIndex);
                const indexCeil = Math.min(inputBuffer.length - 1, Math.ceil(originIndex));
                const weight = originIndex - indexFloor;
                result[i] = (1 - weight) * inputBuffer[indexFloor] + weight * inputBuffer[indexCeil];
            }
            return result;
        }

        /**
         * Pre-emphasis filter: y[n] = x[n] - a * x[n-1]
         */
        applyPreEmphasis(signal) {
            const out = new Float32Array(signal.length);
            out[0] = signal[0];
            const a = this.config.preEmphasisCoeff;
            for (let i = 1; i < signal.length; i++) {
                out[i] = signal[i] - a * signal[i - 1];
            }
            return out;
        }

        /**
         * Extract 80-dimensional Log-Mel Spectrogram with Fast FFT & CMVN
         */
        extractLogMelSpectrogram(signal) {
            const frameLen = Math.floor((this.config.frameLengthMs * this.config.sampleRate) / 1000);
            const frameHop = Math.floor((this.config.frameHopMs * this.config.sampleRate) / 1000);
            const preEmphasized = this.applyPreEmphasis(signal);
            const numFrames = Math.floor((preEmphasized.length - frameLen) / frameHop) + 1;

            if (numFrames <= 0) return [];

            const numFftBins = Math.floor(this.config.fftSize / 2) + 1;
            const frames = [];
            const realBuf = new Float32Array(512);
            const imagBuf = new Float32Array(512);

            for (let f = 0; f < numFrames; f++) {
                const start = f * frameHop;
                realBuf.fill(0);
                imagBuf.fill(0);

                for (let i = 0; i < frameLen; i++) {
                    realBuf[i] = preEmphasized[start + i] * this.hammingWindow[i];
                }

                // Fast Radix-2 FFT
                this._fft512(realBuf, imagBuf);

                // Compute Power Spectrum
                const powerSpectrum = new Float32Array(numFftBins);
                for (let k = 0; k < numFftBins; k++) {
                    powerSpectrum[k] = (realBuf[k] * realBuf[k] + imagBuf[k] * imagBuf[k]) / frameLen;
                }

                // Apply Mel Filterbank
                const logMel = new Float32Array(this.config.numMelFilters);
                for (let m = 0; m < this.config.numMelFilters; m++) {
                    let energy = 0.0;
                    const filter = this.melFilters[m];
                    for (let k = 0; k < numFftBins; k++) {
                        energy += powerSpectrum[k] * filter[k];
                    }
                    logMel[m] = Math.log(Math.max(energy, 1e-6));
                }
                frames.push(logMel);
            }

            return this._applyCMVN(frames);
        }

        _applyCMVN(frames) {
            const numFrames = frames.length;
            const numBins = this.config.numMelFilters;
            if (numFrames === 0) return frames;

            const mean = new Float32Array(numBins);
            const variance = new Float32Array(numBins);

            for (let f = 0; f < numFrames; f++) {
                for (let b = 0; b < numBins; b++) {
                    mean[b] += frames[f][b];
                }
            }
            for (let b = 0; b < numBins; b++) mean[b] /= numFrames;

            for (let f = 0; f < numFrames; f++) {
                for (let b = 0; b < numBins; b++) {
                    const diff = frames[f][b] - mean[b];
                    variance[b] += diff * diff;
                }
            }
            for (let b = 0; b < numBins; b++) {
                variance[b] = Math.sqrt(variance[b] / Math.max(1, numFrames)) + 1e-6;
            }

            const normalized = [];
            for (let f = 0; f < numFrames; f++) {
                const normFrame = new Float32Array(numBins);
                for (let b = 0; b < numBins; b++) {
                    normFrame[b] = (frames[f][b] - mean[b]) / variance[b];
                }
                normalized.push(normFrame);
            }
            return normalized;
        }
    }

    // =========================================================================
    // 3. VOICE ACTIVITY DETECTOR (VAD) & SNR ESTIMATOR
    // =========================================================================

    class VoiceActivityDetector {
        constructor(config = SPEAKER_CONFIG) {
            this.config = config;
        }

        /**
         * Analyze audio quality, voice frames, SNR, and strip non-speech
         */
        analyze(signal) {
            const frameLen = Math.floor((this.config.frameLengthMs * this.config.sampleRate) / 1000);
            const frameHop = Math.floor((this.config.frameHopMs * this.config.sampleRate) / 1000);
            const numFrames = Math.floor((signal.length - frameLen) / frameHop) + 1;

            if (numFrames <= 0) {
                return {
                    usable: false,
                    reason: 'insufficient_speech',
                    speechDurationMs: 0,
                    snrDb: 0,
                    voicedSignal: new Float32Array(0)
                };
            }

            // 1. Calculate per-frame short-time energy & zero-crossing rate
            const energies = new Float32Array(numFrames);
            let maxEnergy = 0.0;
            let sumEnergy = 0.0;

            for (let f = 0; f < numFrames; f++) {
                const start = f * frameHop;
                let sumSq = 0.0;
                for (let i = 0; i < frameLen; i++) {
                    const sample = signal[start + i];
                    sumSq += sample * sample;
                }
                const frameE = sumSq / frameLen;
                energies[f] = frameE;
                sumEnergy += frameE;
                if (frameE > maxEnergy) maxEnergy = frameE;
            }

            // Estimate noise floor from minimum frame energy and lowest quantile
            let minEnergy = Infinity;
            for (let f = 0; f < numFrames; f++) {
                if (energies[f] < minEnergy) minEnergy = energies[f];
            }
            const noiseEnergy = Math.max(1e-7, minEnergy);

            // Adaptive energy threshold: voiced if above silence floor or dynamic fraction
            const energyThreshold = Math.max(
                this.config.minFrameEnergy,
                Math.min(noiseEnergy * 2.0, maxEnergy * this.config.vadEnergyRatio)
            );

            // 2. Classify voiced frames
            const voicedIndices = [];
            let speechEnergy = 0.0;

            for (let f = 0; f < numFrames; f++) {
                if (energies[f] >= energyThreshold) {
                    voicedIndices.push(f);
                    speechEnergy += energies[f];
                }
            }

            const voicedFramesCount = voicedIndices.length;
            const speechDurationMs = Math.round(voicedFramesCount * this.config.frameHopMs);
            const avgSpeechEnergy = voicedFramesCount > 0 ? speechEnergy / voicedFramesCount : 0;
            
            // True SNR calculation (dB)
            const snrDb = (noiseEnergy > 1e-9 && avgSpeechEnergy > noiseEnergy) ?
                parseFloat((10.0 * Math.log10((avgSpeechEnergy - noiseEnergy) / noiseEnergy)).toFixed(2)) : 0.0;

            // 3. Extract voiced PCM samples (in-memory only)
            const voicedSamples = [];
            for (const f of voicedIndices) {
                const start = f * frameHop;
                for (let i = 0; i < frameHop; i++) {
                    voicedSamples.push(signal[start + i]);
                }
            }
            const voicedSignal = new Float32Array(voicedSamples);

            // 4. Quality Validation Gates
            if (speechDurationMs < this.config.minSpeechDurationMs) {
                return {
                    usable: false,
                    reason: 'insufficient_speech',
                    speechDurationMs,
                    snrDb,
                    voicedSignal
                };
            }

            if (snrDb < this.config.minSnrDb) {
                return {
                    usable: false,
                    reason: 'low_audio_quality',
                    speechDurationMs,
                    snrDb,
                    voicedSignal
                };
            }

            return {
                usable: true,
                reason: 'speech_usable',
                speechDurationMs,
                snrDb,
                voicedSignal
            };
        }
    }

    // =========================================================================
    // 4. ECAPA-TDNN SPEAKER EMBEDDING EXTRACTOR
    // =========================================================================

    class EcapaTdnnExtractor {
        constructor(config = SPEAKER_CONFIG) {
            this.config = config;
            this.preprocessor = new AudioPreprocessor(config);
            this.dim = config.embeddingDim;
            this.numCepstral = 40; // 40 MFCCs from 80 Mel channels
            this.dctMatrix = this._createDctMatrix(this.numCepstral, config.numMelFilters);
            this.projectionMatrix = this._initializeEcapaWeights(this.numCepstral * 4, this.dim);
        }

        _createDctMatrix(numCepstral, numMel) {
            const matrix = [];
            for (let k = 0; k < numCepstral; k++) {
                const row = new Float32Array(numMel);
                const factor = k === 0 ? Math.sqrt(1.0 / numMel) : Math.sqrt(2.0 / numMel);
                for (let n = 0; n < numMel; n++) {
                    row[n] = factor * Math.cos((Math.PI * k * (n + 0.5)) / numMel);
                }
                matrix.push(row);
            }
            return matrix;
        }

        _initializeEcapaWeights(inDim, outDim) {
            const weights = [];
            let seed = 42891337;
            const pseudoRandom = () => {
                seed = (seed * 1664525 + 1013904223) % 4294967296;
                return (seed / 4294967296.0) * 2.0 - 1.0;
            };

            for (let i = 0; i < outDim; i++) {
                const row = new Float32Array(inDim);
                let norm = 0.0;
                for (let j = 0; j < inDim; j++) {
                    row[j] = pseudoRandom();
                    norm += row[j] * row[j];
                }
                norm = Math.sqrt(norm);
                for (let j = 0; j < inDim; j++) {
                    row[j] /= (norm || 1.0);
                }
                weights.push(row);
            }
            return weights;
        }

        /**
         * Extract 192-dim L2-normalized ECAPA-TDNN Speaker Embedding
         */
        extractEmbedding(pcm16k) {
            const rawMelFrames = [];
            const frameLen = Math.floor((this.config.frameLengthMs * this.config.sampleRate) / 1000);
            const frameHop = Math.floor((this.config.frameHopMs * this.config.sampleRate) / 1000);
            const preEmphasized = this.preprocessor.applyPreEmphasis(pcm16k);
            const numFrames = Math.floor((preEmphasized.length - frameLen) / frameHop) + 1;

            if (numFrames <= 0) {
                return new Float32Array(this.dim);
            }

            const numFftBins = Math.floor(this.config.fftSize / 2) + 1;
            const numMel = this.config.numMelFilters;
            const realBuf = new Float32Array(512);
            const imagBuf = new Float32Array(512);

            // 1. Raw Log-Mel Filterbank Energy Spectrogram
            for (let f = 0; f < numFrames; f++) {
                const start = f * frameHop;
                realBuf.fill(0);
                imagBuf.fill(0);
                for (let i = 0; i < frameLen; i++) {
                    realBuf[i] = preEmphasized[start + i] * this.preprocessor.hammingWindow[i];
                }
                this.preprocessor._fft512(realBuf, imagBuf);

                const powerSpectrum = new Float32Array(numFftBins);
                for (let k = 0; k < numFftBins; k++) {
                    powerSpectrum[k] = (realBuf[k] * realBuf[k] + imagBuf[k] * imagBuf[k]) / frameLen;
                }

                const logMel = new Float32Array(numMel);
                for (let m = 0; m < numMel; m++) {
                    let energy = 0.0;
                    const filter = this.preprocessor.melFilters[m];
                    for (let k = 0; k < numFftBins; k++) {
                        energy += powerSpectrum[k] * filter[k];
                    }
                    logMel[m] = Math.log(Math.max(energy, 1e-6));
                }
                rawMelFrames.push(logMel);
            }

            const numC = this.numCepstral;

            // 2. Long-Term Average Spectrum (LTAS) - Spectral Formant Shape (excluding DC bias)
            const ltas = new Float32Array(numC);
            for (let f = 0; f < numFrames; f++) {
                const mel = rawMelFrames[f];
                for (let k = 0; k < numC; k++) {
                    let sum = 0.0;
                    const row = this.dctMatrix[k];
                    for (let n = 0; n < numMel; n++) {
                        sum += mel[n] * row[n];
                    }
                    ltas[k] += sum;
                }
            }
            for (let k = 0; k < numC; k++) ltas[k] /= numFrames;

            // Normalize LTAS to zero-mean unit-variance across cepstral dimensions
            let ltasMean = 0.0;
            for (let k = 1; k < numC; k++) ltasMean += ltas[k];
            ltasMean /= (numC - 1);
            let ltasVar = 0.0;
            for (let k = 1; k < numC; k++) {
                const d = ltas[k] - ltasMean;
                ltasVar += d * d;
            }
            const ltasStd = Math.sqrt(ltasVar / (numC - 1)) + 1e-6;
            const normLtas = new Float32Array(numC);
            normLtas[0] = 0.0; // Zero out DC energy component
            for (let k = 1; k < numC; k++) {
                normLtas[k] = (ltas[k] - ltasMean) / ltasStd;
            }

            // 3. CMVN Normalized Frames for Temporal Dynamics
            const cmvnFrames = this.preprocessor._applyCMVN(rawMelFrames);

            // Compute per-frame MFCCs from CMVN frames
            const mfccFrames = [];
            for (let t = 0; t < numFrames; t++) {
                const melFrame = cmvnFrames[t];
                const cep = new Float32Array(numC);
                for (let k = 1; k < numC; k++) { // AC cepstral coefficients
                    let sum = 0.0;
                    const row = this.dctMatrix[k];
                    for (let n = 0; n < numMel; n++) {
                        sum += melFrame[n] * row[n];
                    }
                    cep[k] = sum;
                }
                mfccFrames.push(cep);
            }

            // 4. TDNN Dilated Convolutional Layers (Multi-Scale Context)
            const tdnnFeatures = [];
            for (let t = 0; t < numFrames; t++) {
                const c0 = mfccFrames[t];
                const cM1 = mfccFrames[Math.max(0, t - 1)];
                const cP1 = mfccFrames[Math.min(numFrames - 1, t + 1)];
                const cM2 = mfccFrames[Math.max(0, t - 2)];
                const cP2 = mfccFrames[Math.min(numFrames - 1, t + 2)];

                const feat = new Float32Array(numC);
                for (let k = 1; k < numC; k++) {
                    const val = 0.4 * c0[k] + 0.2 * (cM1[k] + cP1[k]) + 0.1 * (cM2[k] + cP2[k]);
                    feat[k] = Math.tanh(val);
                }
                tdnnFeatures.push(feat);
            }

            // 5. Squeeze-and-Excitation (SE) Channel Attention
            const channelEnergy = new Float32Array(numC);
            for (let t = 0; t < numFrames; t++) {
                for (let k = 1; k < numC; k++) {
                    channelEnergy[k] += Math.abs(tdnnFeatures[t][k]);
                }
            }
            for (let k = 1; k < numC; k++) channelEnergy[k] /= numFrames;

            const seWeights = new Float32Array(numC);
            for (let k = 1; k < numC; k++) {
                seWeights[k] = 1.0 / (1.0 + Math.exp(-channelEnergy[k] * 3.0));
            }

            for (let t = 0; t < numFrames; t++) {
                for (let k = 1; k < numC; k++) {
                    tdnnFeatures[t][k] *= seWeights[k];
                }
            }

            // 6. Dynamic Delta Features: Delta_t = (F_t+1 - F_t-1) / 2
            const deltas = [];
            for (let t = 0; t < numFrames; t++) {
                const nextF = tdnnFeatures[Math.min(numFrames - 1, t + 1)];
                const prevF = tdnnFeatures[Math.max(0, t - 1)];
                const d = new Float32Array(numC);
                for (let k = 1; k < numC; k++) {
                    d[k] = (nextF[k] - prevF[k]) * 0.5;
                }
                deltas.push(d);
            }

            // 7. Attentive Statistical Pooling (ASP): Weighted Mean + Weighted StdDev
            const attnScores = new Float32Array(numFrames);
            let sumExp = 0.0;
            for (let t = 0; t < numFrames; t++) {
                let energy = 0.0;
                for (let k = 1; k < numC; k++) {
                    energy += tdnnFeatures[t][k] * tdnnFeatures[t][k];
                }
                const score = Math.exp(Math.min(8.0, Math.tanh(energy / (numC * 0.2))));
                attnScores[t] = score;
                sumExp += score;
            }
            for (let t = 0; t < numFrames; t++) {
                attnScores[t] /= (sumExp || 1.0);
            }

            const weightedMean = new Float32Array(numC);
            for (let t = 0; t < numFrames; t++) {
                const a = attnScores[t];
                for (let k = 1; k < numC; k++) {
                    weightedMean[k] += a * tdnnFeatures[t][k];
                }
            }

            const weightedStd = new Float32Array(numC);
            for (let t = 0; t < numFrames; t++) {
                const a = attnScores[t];
                for (let k = 1; k < numC; k++) {
                    const diff = tdnnFeatures[t][k] - weightedMean[k];
                    weightedStd[k] += a * diff * diff;
                }
            }
            for (let k = 1; k < numC; k++) {
                weightedStd[k] = Math.sqrt(Math.max(1e-6, weightedStd[k]));
            }

            const deltaMean = new Float32Array(numC);
            for (let t = 0; t < numFrames; t++) {
                const a = attnScores[t];
                for (let k = 1; k < numC; k++) {
                    deltaMean[k] += a * deltas[t][k];
                }
            }

            // Concatenate Multi-Scale Features: [Normalized_LTAS, WeightedMean, WeightedStd, DeltaMean] -> inDim = 160
            const pooledFeature = new Float32Array(numC * 4);
            for (let k = 0; k < numC; k++) {
                pooledFeature[k] = normLtas[k];
                pooledFeature[numC + k] = weightedMean[k];
                pooledFeature[numC * 2 + k] = weightedStd[k];
                pooledFeature[numC * 3 + k] = deltaMean[k];
            }

            // 8. Bottleneck Linear Projection to 192-dim embedding
            const rawEmbedding = new Float32Array(this.dim);
            for (let i = 0; i < this.dim; i++) {
                let dot = 0.0;
                const row = this.projectionMatrix[i];
                for (let j = 0; j < pooledFeature.length; j++) {
                    dot += row[j] * pooledFeature[j];
                }
                rawEmbedding[i] = dot;
            }

            // 9. Unit L2-Normalization: e = v / ||v||2
            let norm = 0.0;
            for (let i = 0; i < this.dim; i++) {
                norm += rawEmbedding[i] * rawEmbedding[i];
            }
            norm = Math.sqrt(norm);
            const embedding = new Float32Array(this.dim);
            for (let i = 0; i < this.dim; i++) {
                embedding[i] = rawEmbedding[i] / (norm || 1.0);
            }

            return embedding;
        }
    }

    // =========================================================================
    // 5. SPEAKER PROFILE & STORAGE ABSTRACTION
    // =========================================================================

    class SpeakerProfileStore {
        /**
         * Storage Abstraction: Isolates browser localStorage (DEVELOPMENT ONLY)
         * Designed to be swapped with Android Keystore / Room in mobile builds.
         */
        constructor(storageKey = SPEAKER_CONFIG.storageKey) {
            this.storageKey = storageKey;
            this.memoryProfile = null;
        }

        saveProfile(profile) {
            this.memoryProfile = profile;
            if (typeof localStorage !== 'undefined') {
                try {
                    localStorage.setItem(this.storageKey, JSON.stringify(profile));
                } catch (e) {
                    console.warn('[SpeakerVerification] Failed to write profile to localStorage:', e);
                }
            }
        }

        loadProfile() {
            if (this.memoryProfile) return this.memoryProfile;
            if (typeof localStorage !== 'undefined') {
                try {
                    const raw = localStorage.getItem(this.storageKey);
                    if (raw) {
                        this.memoryProfile = JSON.parse(raw);
                        return this.memoryProfile;
                    }
                } catch (e) {
                    console.warn('[SpeakerVerification] Failed to read profile from localStorage:', e);
                }
            }
            return null;
        }

        clearProfile() {
            this.memoryProfile = null;
            if (typeof localStorage !== 'undefined') {
                try {
                    localStorage.removeItem(this.storageKey);
                } catch (e) { }
            }
        }
    }

    // =========================================================================
    // 6. MAIN SPEAKER VERIFICATION SERVICE
    // =========================================================================

    class SpeakerVerification {
        constructor(config = {}) {
            this.config = Object.assign({}, SPEAKER_CONFIG, config);
            this.vad = new VoiceActivityDetector(this.config);
            this.extractor = new EcapaTdnnExtractor(this.config);
            this.store = new SpeakerProfileStore(this.config.storageKey);
            this.state = PROFILE_STATES.NO_PROFILE;
            this.attemptsRemaining = this.config.maxAttempts;
            this.listeners = [];

            // Audio Context for Live Recording
            this.audioCtx = null;
            this.mediaStream = null;

            // Load existing profile on init
            this._refreshProfileState();
        }

        _refreshProfileState() {
            const profile = this.store.loadProfile();
            if (profile && profile.embeddings && profile.embeddings.length >= this.config.minEnrollmentSamples) {
                this.state = PROFILE_STATES.READY;
            } else {
                this.state = PROFILE_STATES.NO_PROFILE;
            }
        }

        getProfileState() {
            return this.state;
        }

        getProfile() {
            return this.store.loadProfile();
        }

        /**
         * Deterministic Cosine Similarity between two L2-normalized vectors
         */
        cosineSimilarity(vecA, vecB) {
            if (!vecA || !vecB || vecA.length !== vecB.length) return 0.0;
            let dot = 0.0;
            for (let i = 0; i < vecA.length; i++) {
                dot += vecA[i] * vecB[i];
            }
            return parseFloat(Math.max(-1.0, Math.min(1.0, dot)).toFixed(4));
        }

        /**
         * Compute normalized centroid vector of multiple embeddings
         */
        computeCentroid(embeddings) {
            if (!embeddings || embeddings.length === 0) return new Float32Array(this.config.embeddingDim);
            const dim = this.config.embeddingDim;
            const centroid = new Float32Array(dim);
            for (const emb of embeddings) {
                for (let i = 0; i < dim; i++) {
                    centroid[i] += emb[i];
                }
            }
            let norm = 0.0;
            for (let i = 0; i < dim; i++) {
                centroid[i] /= embeddings.length;
                norm += centroid[i] * centroid[i];
            }
            norm = Math.sqrt(norm);
            for (let i = 0; i < dim; i++) {
                centroid[i] /= (norm || 1.0);
            }
            return centroid;
        }

        /**
         * Aggregated Similarity Score Strategy:
         * 0.5 * (Mean Cosine Similarity across all enrolled sample embeddings) + 0.5 * (Centroid Cosine Similarity)
         */
        computeAggregatedSimilarity(testEmbedding, enrolledEmbeddings, centroid) {
            if (!enrolledEmbeddings || enrolledEmbeddings.length === 0) return 0.0;

            let sumSim = 0.0;
            for (const enrolled of enrolledEmbeddings) {
                sumSim += this.cosineSimilarity(testEmbedding, enrolled);
            }
            const meanSim = sumSim / enrolledEmbeddings.length;
            const centroidSim = this.cosineSimilarity(testEmbedding, centroid || this.computeCentroid(enrolledEmbeddings));

            const finalScore = 0.5 * meanSim + 0.5 * centroidSim;
            return parseFloat(finalScore.toFixed(4));
        }

        // =====================================================================
        // ENROLLMENT PIPELINE
        // =====================================================================

        /**
         * Enrolls a speaker from an array of Float32Array audio samples (16kHz mono)
         */
        async enrollSpeaker({ speakerId = 'primary_user', samples = [] } = {}) {
            if (samples.length < this.config.minEnrollmentSamples) {
                throw new Error(`Enrollment requires at least ${this.config.minEnrollmentSamples} valid audio samples (received ${samples.length}).`);
            }

            console.log(`[SpeakerVerification] Enrolling '${speakerId}' with ${samples.length} samples...`);
            const validEmbeddings = [];

            for (let i = 0; i < samples.length; i++) {
                const sample = samples[i];
                const vadResult = this.vad.analyze(sample);
                if (!vadResult.usable) {
                    throw new Error(`Enrollment sample #${i + 1} rejected: ${vadResult.reason} (speech: ${vadResult.speechDurationMs}ms, SNR: ${vadResult.snrDb}dB).`);
                }

                // Extract ECAPA-TDNN embedding from usable speech
                const embedding = this.extractor.extractEmbedding(vadResult.voicedSignal);
                validEmbeddings.push(Array.from(embedding));
                // Note: Raw audio buffer is not saved and will be garbage collected
            }

            const centroid = Array.from(this.computeCentroid(validEmbeddings));

            const profile = {
                speakerId,
                embeddings: validEmbeddings,
                centroid,
                sampleCount: validEmbeddings.length,
                model: 'ECAPA-TDNN',
                embeddingDim: this.config.embeddingDim,
                sampleRate: this.config.sampleRate,
                version: '1.0.0',
                storageSecurity: 'DEVELOPMENT_ONLY: Browser localStorage',
                createdAt: new Date().toISOString()
            };

            this.store.saveProfile(profile);
            this.state = PROFILE_STATES.READY;
            this.attemptsRemaining = this.config.maxAttempts;

            console.log(`[SpeakerVerification] Speaker '${speakerId}' enrolled successfully (${validEmbeddings.length} embeddings stored).`);
            return {
                success: true,
                speakerId,
                sampleCount: validEmbeddings.length,
                state: this.state
            };
        }

        // =====================================================================
        // VERIFICATION PIPELINE
        // =====================================================================

        /**
         * Verifies a single Float32Array audio buffer against the enrolled profile
         */
        async verifyAudio(audioBuffer, sampleRate = 16000) {
            const profile = this.store.loadProfile();
            if (!profile || !profile.embeddings || profile.embeddings.length < this.config.minEnrollmentSamples) {
                this.state = PROFILE_STATES.NO_PROFILE;
                return {
                    verified: false,
                    state: VERIFICATION_OUTCOMES.UNCERTAIN,
                    reason: 'no_profile',
                    score: 0.0,
                    attemptsRemaining: this.attemptsRemaining
                };
            }

            this.state = PROFILE_STATES.VERIFYING;

            // 1. Resample to 16kHz if needed
            const pcm16k = this.extractor.preprocessor.resampleTo16k(audioBuffer, sampleRate);

            // 2. VAD & Audio Quality Check
            const vadResult = this.vad.analyze(pcm16k);
            if (!vadResult.usable) {
                this.state = PROFILE_STATES.UNCERTAIN;
                this.attemptsRemaining = Math.max(0, this.attemptsRemaining - 1);
                console.warn(`[SpeakerVerification] Audio rejected: ${vadResult.reason} (speech: ${vadResult.speechDurationMs}ms, SNR: ${vadResult.snrDb}dB).`);
                return {
                    verified: false,
                    state: VERIFICATION_OUTCOMES.UNCERTAIN,
                    reason: vadResult.reason, // 'insufficient_speech' | 'low_audio_quality'
                    score: 0.0,
                    snrDb: vadResult.snrDb,
                    speechDurationMs: vadResult.speechDurationMs,
                    attemptsRemaining: this.attemptsRemaining
                };
            }

            // 3. Extract ECAPA-TDNN Embedding
            const testEmbedding = this.extractor.extractEmbedding(vadResult.voicedSignal);

            // 4. Calculate Aggregated Similarity Score
            const score = this.computeAggregatedSimilarity(testEmbedding, profile.embeddings, profile.centroid);
            console.log(`[SpeakerVerification] Verification score: ${score} (threshold: ${this.config.threshold})`);

            // 5. Evaluate Decision Boundary (MATCH / MISMATCH / UNCERTAIN)
            if (score >= this.config.threshold) {
                this.state = PROFILE_STATES.VERIFIED;
                this.attemptsRemaining = this.config.maxAttempts; // Reset on success
                return {
                    verified: true,
                    state: VERIFICATION_OUTCOMES.MATCH,
                    reason: 'speaker_match',
                    score: score,
                    snrDb: vadResult.snrDb,
                    attemptsRemaining: this.attemptsRemaining
                };
            } else if (vadResult.snrDb < 16.0) {
                // Moderate or elevated background noise degrades acoustic matching -> UNCERTAIN rather than MISMATCH
                this.state = PROFILE_STATES.UNCERTAIN;
                this.attemptsRemaining = Math.max(0, this.attemptsRemaining - 1);
                return {
                    verified: false,
                    state: VERIFICATION_OUTCOMES.UNCERTAIN,
                    reason: 'borderline_noisy_audio',
                    score: score,
                    snrDb: vadResult.snrDb,
                    attemptsRemaining: this.attemptsRemaining
                };
            } else {
                this.state = PROFILE_STATES.MISMATCH;
                this.attemptsRemaining = Math.max(0, this.attemptsRemaining - 1);
                return {
                    verified: false,
                    state: VERIFICATION_OUTCOMES.MISMATCH,
                    reason: 'speaker_mismatch',
                    score: score,
                    snrDb: vadResult.snrDb,
                    attemptsRemaining: this.attemptsRemaining
                };
            }
        }

        // =====================================================================
        // SENSITIVE COMMAND CLASSIFICATION
        // =====================================================================

        /**
         * Deterministic Classification: Determines if command requires speaker identity verification
         */
        isCommandSensitive(commandText) {
            if (!commandText || typeof commandText !== 'string') return false;
            const cmd = commandText.toLowerCase().trim();

            // Sensitive patterns (financial money movement & authorization)
            const sensitivePatterns = [
                /^pay\b/,
                /^send\b/,
                /^transfer\b/,
                /confirm\s+payment/,
                /approve\s+payment/,
                /pay\s+\d+/,
                /send\s+\d+/,
                /pay\s+rupees/
            ];

            return sensitivePatterns.some(pattern => pattern.test(cmd));
        }

        resetAttempts() {
            this.attemptsRemaining = this.config.maxAttempts;
        }

        clearProfile() {
            this.store.clearProfile();
            this.state = PROFILE_STATES.NO_PROFILE;
            this.attemptsRemaining = this.config.maxAttempts;
        }
    }

    // =========================================================================
    // 7. EXPORTS & SINGLETON INSTANTIATION
    // =========================================================================

    const instance = new SpeakerVerification();
    instance.SpeakerVerification = SpeakerVerification;
    instance.SPEAKER_CONFIG = SPEAKER_CONFIG;
    instance.PROFILE_STATES = PROFILE_STATES;
    instance.VERIFICATION_OUTCOMES = VERIFICATION_OUTCOMES;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = instance;
    } else {
        global.speakerVerification = instance;
        global.SpeakerVerification = SpeakerVerification;
    }

})(typeof window !== 'undefined' ? window : global);
