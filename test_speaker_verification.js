// test_speaker_verification.js
// Comprehensive Unit & Calibration Test Suite for VoxPay Speaker Verification (ECAPA-TDNN)

const speakerVerification = require('./speaker-verification.js');
const { SpeakerVerification, SPEAKER_CONFIG, PROFILE_STATES, VERIFICATION_OUTCOMES } = speakerVerification;

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        failed++;
    }
}

/**
 * Synthetic Synthetic Audio Generators for Reproducible Testing
 */
function generateSyntheticVoice(f0 = 140, durationSec = 2.0, sampleRate = 16000, formants = [700, 1200, 2600]) {
    const numSamples = Math.floor(durationSec * sampleRate);
    const buffer = new Float32Array(numSamples);
    const twoPi = 2.0 * Math.PI;

    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        // Pitch pulse train (harmonic source) with slight vibrato
        const vibrato = 1.0 + 0.015 * Math.sin(twoPi * 5.0 * t);
        const pitchF0 = f0 * vibrato;
        let source = 0.0;
        for (let h = 1; h <= 15; h++) {
            const harmonicFreq = pitchF0 * h;
            if (harmonicFreq < 7500) {
                // Spectral tilt decay (-6 dB/octave)
                const amp = 1.0 / Math.pow(h, 0.85);
                source += amp * Math.sin(twoPi * harmonicFreq * t);
            }
        }

        // Formant resonance acoustic filterbank
        let formantFilter = 0.0;
        for (let fIdx = 0; fIdx < formants.length; fIdx++) {
            const fc = formants[fIdx];
            const bw = 80 + fIdx * 40; // Formant bandwidth
            const phase = (i % Math.floor(sampleRate / pitchF0)) / (sampleRate / pitchF0);
            formantFilter += Math.sin(twoPi * fc * t) * Math.exp(-bw * 0.005 * phase);
        }

        // Temporal trapezoidal envelope (100ms fade in/out)
        const fadeLen = Math.floor(0.1 * sampleRate);
        let env = 1.0;
        if (i < fadeLen) env = i / fadeLen;
        else if (i > numSamples - fadeLen) env = (numSamples - i) / fadeLen;

        buffer[i] = (0.5 * source + 0.5 * formantFilter) * env * 0.25;
    }
    return buffer;
}

function addGaussianNoise(cleanSignal, targetSnrDb) {
    const noisy = new Float32Array(cleanSignal.length);
    let signalPower = 0.0;
    for (let i = 0; i < cleanSignal.length; i++) {
        signalPower += cleanSignal[i] * cleanSignal[i];
    }
    signalPower /= cleanSignal.length;

    const noisePower = signalPower / Math.pow(10, targetSnrDb / 10.0);
    const noiseStd = Math.sqrt(noisePower);

    // Box-Muller transform for Gaussian noise
    for (let i = 0; i < cleanSignal.length; i += 2) {
        const u1 = Math.max(1e-9, Math.random());
        const u2 = Math.random();
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

        noisy[i] = cleanSignal[i] + z0 * noiseStd;
        if (i + 1 < cleanSignal.length) {
            noisy[i + 1] = cleanSignal[i + 1] + z1 * noiseStd;
        }
    }
    return noisy;
}

async function runTests() {
    console.log('===============================================================');
    console.log('VOXPAY AUTHORIZED-SPEAKER VERIFICATION TEST SUITE (ECAPA-TDNN)');
    console.log('===============================================================\n');

    const service = new SpeakerVerification({ threshold: 0.72 });
    service.clearProfile();

    // -------------------------------------------------------------------------
    // TEST 1: Initial State & Command Sensitivity Classification
    // -------------------------------------------------------------------------
    console.log('[Test 1] Initial Profile State & Command Sensitivity Classification');
    assert(service.getProfileState() === PROFILE_STATES.NO_PROFILE, `Initial state is NO_PROFILE (actual: ${service.getProfileState()})`);

    // Non-sensitive commands (must NOT require speaker verification)
    assert(service.isCommandSensitive('open scanner') === false, "'open scanner' is non-sensitive");
    assert(service.isCommandSensitive('scan qr') === false, "'scan qr' is non-sensitive");
    assert(service.isCommandSensitive('show transactions') === false, "'show transactions' is non-sensitive");
    assert(service.isCommandSensitive('check balance') === false, "'check balance' is non-sensitive");
    assert(service.isCommandSensitive('open home') === false, "'open home' is non-sensitive");

    // Sensitive commands (financial transactions that MUST require speaker verification)
    assert(service.isCommandSensitive('pay 500') === true, "'pay 500' is sensitive");
    assert(service.isCommandSensitive('pay 1000 rupees to ramesh') === true, "'pay 1000 rupees to ramesh' is sensitive");
    assert(service.isCommandSensitive('send 200') === true, "'send 200' is sensitive");
    assert(service.isCommandSensitive('confirm payment') === true, "'confirm payment' is sensitive");
    assert(service.isCommandSensitive('approve payment') === true, "'approve payment' is sensitive");

    // -------------------------------------------------------------------------
    // TEST 2: Voice Activity Detection (VAD) & Quality Checks
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] Voice Activity Detection (VAD) & Quality Checks');
    const speech1 = generateSyntheticVoice(130, 2.0); // 2000ms speech
    const vadGood = service.vad.analyze(speech1);
    assert(vadGood.usable === true, 'Continuous speech passes VAD');
    assert(vadGood.speechDurationMs >= 1200, `Detected speech duration is sufficient: ${vadGood.speechDurationMs}ms`);
    assert(vadGood.snrDb >= 12.0, `Detected SNR is high: ${vadGood.snrDb}dB`);

    // Short noise burst (< 800ms)
    const shortBurst = new Float32Array(16000 * 0.3); // 300ms
    for (let i = 0; i < shortBurst.length; i++) shortBurst[i] = (Math.random() - 0.5) * 0.05;
    const vadShort = service.vad.analyze(shortBurst);
    assert(vadShort.usable === false, 'Short audio burst (<800ms) rejected by VAD');
    assert(vadShort.reason === 'insufficient_speech', `Reason is 'insufficient_speech' (actual: ${vadShort.reason})`);

    // Pure Silence
    const silence = new Float32Array(16000 * 1.5);
    const vadSilence = service.vad.analyze(silence);
    assert(vadSilence.usable === false, 'Pure silence rejected by VAD');

    // -------------------------------------------------------------------------
    // TEST 3: ECAPA-TDNN Feature Extraction & Embedding Properties
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] ECAPA-TDNN Feature Extraction & Embedding Properties');
    const emb1 = service.extractor.extractEmbedding(speech1);
    assert(emb1.length === 192, `Embedding dimension is 192 (actual: ${emb1.length})`);

    // L2-Norm check
    let norm = 0.0;
    for (let i = 0; i < emb1.length; i++) norm += emb1[i] * emb1[i];
    norm = Math.sqrt(norm);
    assert(Math.abs(norm - 1.0) < 1e-4, `Embedding is unit L2-normalized (norm = ${norm.toFixed(4)})`);

    // Self-similarity check
    const selfSim = service.cosineSimilarity(emb1, emb1);
    assert(Math.abs(selfSim - 1.0) < 1e-4, `Self-similarity is 1.0 (actual: ${selfSim})`);

    // -------------------------------------------------------------------------
    // TEST 4: Multi-Sample Enrollment Flow
    // -------------------------------------------------------------------------
    console.log('\n[Test 4] Multi-Sample Speaker Enrollment Flow');
    const userVoiceSamples = [
        generateSyntheticVoice(140, 2.0, 16000, [720, 1220, 2600]),
        generateSyntheticVoice(142, 2.2, 16000, [715, 1210, 2620]),
        generateSyntheticVoice(138, 2.5, 16000, [725, 1230, 2590]),
        generateSyntheticVoice(141, 2.1, 16000, [718, 1215, 2610])
    ];

    const enrollRes = await service.enrollSpeaker({
        speakerId: 'suriya_prakash',
        samples: userVoiceSamples
    });

    assert(enrollRes.success === true, 'Enrollment completed successfully');
    assert(service.getProfileState() === PROFILE_STATES.READY, `Profile state transitioned to READY (actual: ${service.getProfileState()})`);

    const profile = service.getProfile();
    assert(profile.embeddings.length === 4, `Enrolled 4 embeddings (actual: ${profile.embeddings.length})`);
    assert(profile.centroid.length === 192, 'Centroid embedding computed and saved');
    assert(profile.model === 'ECAPA-TDNN', 'Model identity is ECAPA-TDNN');
    assert(profile.storageSecurity.includes('DEVELOPMENT_ONLY'), 'Profile storage explicitly tagged DEVELOPMENT ONLY');
    assert(profile.rawAudio === undefined, 'Raw microphone audio is NOT saved in profile');

    // -------------------------------------------------------------------------
    // TEST 5: Genuine Speaker Verification (MATCH)
    // -------------------------------------------------------------------------
    console.log('\n[Test 5] Genuine Speaker Verification (MATCH)');
    const genuineTestVoice = generateSyntheticVoice(140, 2.2, 16000, [720, 1218, 2605]);
    const matchRes = await service.verifyAudio(genuineTestVoice);

    assert(matchRes.verified === true, 'Genuine speaker verified as true');
    assert(matchRes.state === VERIFICATION_OUTCOMES.MATCH, `State is MATCH (actual: ${matchRes.state})`);
    assert(matchRes.reason === 'speaker_match', `Reason is 'speaker_match' (actual: ${matchRes.reason})`);
    assert(matchRes.score >= service.config.threshold, `Similarity score (${matchRes.score}) exceeds threshold (${service.config.threshold})`);

    // -------------------------------------------------------------------------
    // TEST 6: Impostor Speaker Verification (MISMATCH)
    // -------------------------------------------------------------------------
    console.log('\n[Test 6] Impostor Speaker Verification (MISMATCH)');
    const impostorVoice = generateSyntheticVoice(240, 2.2, 16000, [320, 2150, 3300]); // Completely different pitch & formant resonance
    const mismatchRes = await service.verifyAudio(impostorVoice);

    assert(mismatchRes.verified === false, 'Impostor speaker rejected (verified = false)');
    assert(mismatchRes.state === VERIFICATION_OUTCOMES.MISMATCH, `State is MISMATCH (actual: ${mismatchRes.state})`);
    assert(mismatchRes.reason === 'speaker_mismatch', `Reason is 'speaker_mismatch' (actual: ${mismatchRes.reason})`);
    assert(mismatchRes.score < service.config.threshold, `Impostor score (${mismatchRes.score}) is below threshold (${service.config.threshold})`);

    // -------------------------------------------------------------------------
    // TEST 7: Noise Robustness across SNR Levels (Clean, 20dB, 15dB, 10dB, 5dB)
    // -------------------------------------------------------------------------
    console.log('\n[Test 7] Noise Robustness Across SNR Levels');
    
    // 20 dB SNR (Light office noise) -> Should MATCH
    const noisy20dB = addGaussianNoise(genuineTestVoice, 20);
    const res20dB = await service.verifyAudio(noisy20dB);
    assert(res20dB.verified === true && res20dB.state === VERIFICATION_OUTCOMES.MATCH,
        `20 dB SNR: Verified MATCH (score: ${res20dB.score}, state: ${res20dB.state})`);

    // 15 dB SNR (Moderate room noise) -> MATCH or UNCERTAIN (never false reject)
    const noisy15dB = addGaussianNoise(genuineTestVoice, 15);
    const res15dB = await service.verifyAudio(noisy15dB);
    assert(res15dB.state === VERIFICATION_OUTCOMES.MATCH || res15dB.state === VERIFICATION_OUTCOMES.UNCERTAIN,
        `15 dB SNR: Handled gracefully (state: ${res15dB.state}, score: ${res15dB.score})`);

    // 10 dB SNR (Noisy street / cafe) -> MATCH or UNCERTAIN (never false reject)
    const noisy10dB = addGaussianNoise(genuineTestVoice, 10);
    const res10dB = await service.verifyAudio(noisy10dB);
    assert(res10dB.state === VERIFICATION_OUTCOMES.MATCH || res10dB.state === VERIFICATION_OUTCOMES.UNCERTAIN,
        `10 dB SNR: Handled gracefully without crash (state: ${res10dB.state}, score: ${res10dB.score})`);

    // 5 dB SNR (Severe background noise) -> Must be UNCERTAIN (low_audio_quality), NOT MISMATCH
    const noisy5dB = addGaussianNoise(genuineTestVoice, 5);
    const res5dB = await service.verifyAudio(noisy5dB);
    assert(res5dB.state === VERIFICATION_OUTCOMES.UNCERTAIN,
        `5 dB SNR: Correctly evaluated as UNCERTAIN (actual: ${res5dB.state})`);
    assert(res5dB.reason === 'low_audio_quality' || res5dB.reason === 'borderline_noisy_audio',
        `Reason records audio quality degradation: '${res5dB.reason}' (NOT speaker_mismatch)`);

    // -------------------------------------------------------------------------
    // TEST 8: Bounded Retry Limit & Lockout
    // -------------------------------------------------------------------------
    console.log('\n[Test 8] Bounded Retry Policy (Max 3 Attempts)');
    service.resetAttempts();
    assert(service.attemptsRemaining === 3, 'Initial retry attempts is 3');

    // Attempt 1: Impostor
    await service.verifyAudio(impostorVoice);
    assert(service.attemptsRemaining === 2, 'Attempt 1 failed: 2 attempts remaining');

    // Attempt 2: Severe noise
    await service.verifyAudio(noisy5dB);
    assert(service.attemptsRemaining === 1, 'Attempt 2 failed: 1 attempt remaining');

    // Attempt 3: Impostor
    await service.verifyAudio(impostorVoice);
    assert(service.attemptsRemaining === 0, 'Attempt 3 failed: 0 attempts remaining');

    // -------------------------------------------------------------------------
    // TEST 9: Verification Without Profile -> Safe Fail-Closed
    // -------------------------------------------------------------------------
    console.log('\n[Test 9] Verification Without Profile (Fail-Closed)');
    const unconfiguredService = new SpeakerVerification({ storageKey: 'unconfigured_test_key' });
    unconfiguredService.clearProfile();
    const noProfileRes = await unconfiguredService.verifyAudio(genuineTestVoice);
    assert(noProfileRes.verified === false, 'Unenrolled verification is false');
    assert(noProfileRes.reason === 'no_profile', "Reason is 'no_profile'");
    assert(noProfileRes.state === VERIFICATION_OUTCOMES.UNCERTAIN, 'State is UNCERTAIN (does not silently authenticate)');

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log(`\n===============================================================`);
    console.log(`TOTAL SPEAKER VERIFICATION TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log(`===============================================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
