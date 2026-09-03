// test_privacy_vision.js
// Unit test suite for VoxPay Privacy Vision & Shoulder-Surfing Detection Layer

const privacyVision = require('./privacy-vision.js');
const { PRIVACY_STATES, PRIVACY_CONFIG } = privacyVision;

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

async function runTests() {
    console.log('--- STARTING PRIVACY VISION & SHOULDER-SURFING TESTS ---\n');

    const frameMeta = { frameWidth: 320, frameHeight: 240 };
    const frameArea = 320 * 240; // 76,800 px

    // TEST 1: Only primary user visible -> SAFE
    console.log('[Test 1] Only Primary User Visible');
    privacyVision.history = [];
    const primaryPerson = {
        bbox: [60, 20, 200, 200], // Large foreground subject (40,000 px, 52% of frame)
        confidence: 0.92
    };
    const res1 = privacyVision.evaluatePrivacy([primaryPerson], frameMeta);
    assert(res1.state === PRIVACY_STATES.SAFE, `State is SAFE (actual: ${res1.state})`);
    assert(res1.reason === 'primary_user_only', `Reason is 'primary_user_only' (actual: ${res1.reason})`);
    assert(!res1.privacyRisk, 'privacyRisk is false');

    // TEST 2: Second person far in background -> SAFE / Distant
    console.log('\n[Test 2] Second Person Far in Background');
    privacyVision.history = [];
    const tinyBackgroundPerson = {
        bbox: [260, 10, 30, 40], // 1,200 px (1.5% of frame, well below 8% threshold)
        confidence: 0.65
    };
    const res2 = privacyVision.evaluatePrivacy([primaryPerson, tinyBackgroundPerson], frameMeta);
    assert(res2.state === PRIVACY_STATES.SAFE, `State is SAFE (actual: ${res2.state})`);
    assert(res2.reason === 'secondary_person_distant', `Reason is 'secondary_person_distant' (actual: ${res2.reason})`);
    assert(!res2.privacyRisk, 'privacyRisk is false');

    // TEST 3: Second person approaches user -> POSSIBLE_OBSERVER (after persistence threshold)
    console.log('\n[Test 3] Second Person Approaches User (Persistent Proximity)');
    privacyVision.history = [];
    const nearbySecondaryPerson = {
        bbox: [180, 40, 120, 150], // 18,000 px (23.4% of frame, > 8% proximity threshold)
        confidence: 0.88
    };

    // Frame 1: Detected, but not yet persistent across threshold
    const frame1 = privacyVision.evaluatePrivacy([primaryPerson, nearbySecondaryPerson], frameMeta);
    assert(frame1.state === PRIVACY_STATES.SAFE, `Frame 1: State is still SAFE prior to persistence (actual: ${frame1.state})`);

    // Frame 2 & 3: Persistent detection
    privacyVision.evaluatePrivacy([primaryPerson, nearbySecondaryPerson], frameMeta);
    const frame3 = privacyVision.evaluatePrivacy([primaryPerson, nearbySecondaryPerson], frameMeta);
    assert(frame3.state === PRIVACY_STATES.POSSIBLE_OBSERVER, `Frame 3: State elevated to POSSIBLE_OBSERVER (actual: ${frame3.state})`);
    assert(frame3.privacyRisk === true, 'privacyRisk is true');
    assert(frame3.reason === 'possible_secondary_person', `Reason is 'possible_secondary_person' (actual: ${frame3.reason})`);
    assert(frame3.persistenceScore >= 0.6, `Persistence score >= 0.6 (actual: ${frame3.persistenceScore})`);
    assert(frame3.proximityScore > 0.8, `Proximity score is high (actual: ${frame3.proximityScore})`);

    // TEST 4: Person walks quickly across camera -> No persistent warning
    console.log('\n[Test 4] Person Walks Quickly Across Camera (Transient)');
    privacyVision.history = [];
    // 1 transient frame
    privacyVision.evaluatePrivacy([primaryPerson, nearbySecondaryPerson], frameMeta);
    // followed by empty frames
    privacyVision.evaluatePrivacy([primaryPerson], frameMeta);
    privacyVision.evaluatePrivacy([primaryPerson], frameMeta);
    const res4 = privacyVision.evaluatePrivacy([primaryPerson], frameMeta);
    assert(res4.state === PRIVACY_STATES.SAFE, `State returned to SAFE (actual: ${res4.state})`);
    assert(!res4.privacyRisk, 'privacyRisk is false for fast passerby');

    // TEST 5: False / Partial detection on single frame -> Temporal filter suppresses warning
    console.log('\n[Test 5] Single-Frame False Positive Suppression');
    privacyVision.history = [];
    // Only 1 frame with secondary detection
    const res5 = privacyVision.evaluatePrivacy([primaryPerson, nearbySecondaryPerson], frameMeta);
    assert(res5.state === PRIVACY_STATES.SAFE, `Single frame did not trigger immediate warning (actual: ${res5.state})`);
    assert(res5.reason === 'secondary_person_transient', `Reason is 'secondary_person_transient' (actual: ${res5.reason})`);

    // TEST 6: Camera permission denied -> UNCERTAIN
    console.log('\n[Test 6] Camera Permission Denied');
    const res6 = privacyVision.evaluatePrivacy([], { qualityError: 'camera_permission_denied_or_unavailable' });
    assert(res6.state === PRIVACY_STATES.UNCERTAIN, `State is UNCERTAIN (actual: ${res6.state})`);
    assert(res6.reason === 'camera_permission_denied_or_unavailable', 'Reason records permission denied');
    assert(res6.confidence === 0.0, 'Confidence is 0.0');

    // TEST 7: Very dark camera (low light quality) -> UNCERTAIN
    console.log('\n[Test 7] Low-Light / Severely Underexposed Environment');
    const res7 = privacyVision.evaluatePrivacy([], { qualityError: 'camera_low_light' });
    assert(res7.state === PRIVACY_STATES.UNCERTAIN, `State is UNCERTAIN (actual: ${res7.state})`);
    assert(res7.reason === 'camera_low_light', 'Reason records camera_low_light');

    // TEST 8: Camera unavailable / paused -> UNCERTAIN (Never silently reports SAFE)
    console.log('\n[Test 8] Camera Unavailable or Paused');
    const res8 = privacyVision.evaluatePrivacy([], { qualityError: 'camera_unavailable_or_paused' });
    assert(res8.state === PRIVACY_STATES.UNCERTAIN, `State is UNCERTAIN (actual: ${res8.state})`);
    assert(res8.reason === 'camera_unavailable_or_paused', 'Reason records camera_unavailable_or_paused');

    console.log(`\n========================================`);
    console.log(`TOTAL PRIVACY TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log(`========================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
