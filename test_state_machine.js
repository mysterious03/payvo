// test_state_machine.js
// Unit tests for VoxPay Deterministic Transaction State Machine

const sm = require('./transaction-state-machine.js');
const STATES = sm.STATES;

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
    console.log('--- STARTING TRANSACTION STATE MACHINE TESTS ---');

    // TEST 1: Full Valid Lifecycle
    console.log('\n[Test 1] Full Valid Lifecycle -> SUCCESS');
    sm.reset();
    assert(sm.getState() === STATES.IDLE, 'Initial state is IDLE');

    sm.startIntent({ source: 'QR', rawData: { raw: 'upi://pay?pa=ramesh@upi&pn=Ramesh' } });
    assert(sm.getState() === STATES.INTENT_RECEIVED, 'State is INTENT_RECEIVED');

    sm.resolveRecipient({ name: 'Ramesh Kumar', upiId: 'ramesh@upi', bank: 'SBI' });
    assert(sm.getState() === STATES.RECIPIENT_RESOLVED, 'State is RECIPIENT_RESOLVED');

    sm.verifyRecipient({ verifiedName: 'Ramesh Kumar', bank: 'SBI' });
    assert(sm.getState() === STATES.RECIPIENT_VERIFIED, 'State is RECIPIENT_VERIFIED');

    sm.resolveAmount(500, 1500); // 500 INR with 1500 balance
    assert(sm.getState() === STATES.AMOUNT_RESOLVED, 'State is AMOUNT_RESOLVED');
    assert(sm.getContext().amount === 500, 'Context amount is 500');

    sm.verifyPaymentDirection('SEND');
    assert(sm.getState() === STATES.PAYMENT_DIRECTION_VERIFIED, 'State is PAYMENT_DIRECTION_VERIFIED');

    sm.performRiskCheck();
    assert(sm.getState() === STATES.RISK_CHECK, 'State is RISK_CHECK');

    sm.requestUserConfirmation();
    assert(sm.getState() === STATES.USER_CONFIRMATION, 'State is USER_CONFIRMATION');

    // Confirm -> Enters UNDO_WINDOW
    sm.confirmByUser();
    assert(sm.getState() === STATES.UNDO_WINDOW, 'State is UNDO_WINDOW');

    // Fast-forward undo window expiry
    sm._onUndoWindowExpired();
    assert(sm.getState() === STATES.SECURE_AUTHENTICATION, 'State is SECURE_AUTHENTICATION');

    // Authenticate (PIN success) -> Moves to PAYMENT_INITIATED
    sm.authenticateTransaction({ success: true });
    assert(sm.getState() === STATES.PAYMENT_INITIATED, 'State is PAYMENT_INITIATED');

    // Move to RESULT_VERIFICATION & Finalize as SUCCESS
    sm.beginResultVerification();
    assert(sm.getState() === STATES.RESULT_VERIFICATION, 'State is RESULT_VERIFICATION');

    sm.finalizeResult(STATES.SUCCESS, { utr: 'SP998877665544', message: 'Payment successful' });
    assert(sm.getState() === STATES.SUCCESS, 'State is SUCCESS');
    assert(sm.getContext().utr === 'SP998877665544', 'UTR recorded in context');

    // TEST 2: Invalid Transition: IDLE -> PAYMENT_INITIATED
    console.log('\n[Test 2] Invalid Transition: IDLE -> PAYMENT_INITIATED');
    sm.reset();
    let threw = false;
    try {
        sm.initiatePayment();
    } catch (e) {
        threw = true;
    }
    assert(threw, 'IDLE -> PAYMENT_INITIATED was rejected');

    // TEST 3: Invalid Transition: USER_CONFIRMATION -> PAYMENT_INITIATED
    console.log('\n[Test 3] Invalid Transition: USER_CONFIRMATION -> PAYMENT_INITIATED');
    sm.reset();
    sm.startIntent();
    sm.resolveRecipient({ upiId: 'test@upi' });
    sm.verifyRecipient();
    sm.resolveAmount(100, 1000);
    sm.verifyPaymentDirection('SEND');
    sm.performRiskCheck();
    sm.requestUserConfirmation();
    threw = false;
    try {
        sm.initiatePayment();
    } catch (e) {
        threw = true;
    }
    assert(threw, 'Direct payment initiation from USER_CONFIRMATION rejected');

    // TEST 4: Invalid Transition: UNDO_WINDOW -> PAYMENT_INITIATED without Auth
    console.log('\n[Test 4] Invalid Transition: UNDO_WINDOW -> PAYMENT_INITIATED without Auth');
    sm.confirmByUser();
    threw = false;
    try {
        sm.initiatePayment();
    } catch (e) {
        threw = true;
    }
    assert(threw, 'Direct payment initiation from UNDO_WINDOW rejected');

    // TEST 5: Cancellation during UNDO_WINDOW
    console.log('\n[Test 5] Cancellation during UNDO_WINDOW');
    sm.reset();
    sm.startIntent();
    sm.resolveRecipient({ upiId: 'cancel@upi' });
    sm.verifyRecipient();
    sm.resolveAmount(250, 1000);
    sm.verifyPaymentDirection('SEND');
    sm.performRiskCheck();
    sm.requestUserConfirmation();
    sm.confirmByUser();
    assert(sm.getState() === STATES.UNDO_WINDOW, 'State is UNDO_WINDOW');

    sm.cancel('User clicked undo');
    assert(sm.getState() === STATES.CANCELLED, 'State is CANCELLED');
    assert(sm.getContext().error === 'User clicked undo', 'Cancellation reason saved');
    assert(sm._undoTimer === null, 'Undo timer cleared');

    // TEST 6: Insufficient Balance Check
    console.log('\n[Test 6] Insufficient Balance Authoritative Rejection');
    sm.reset();
    sm.startIntent();
    sm.resolveRecipient({ upiId: 'poor@upi' });
    sm.verifyRecipient();
    threw = false;
    try {
        sm.resolveAmount(2000, 500); // Amount 2000 > Balance 500
    } catch (e) {
        threw = true;
    }
    assert(threw, 'resolveAmount rejected when amount > balance');
    assert(sm.getState() === STATES.FAILED, 'State transitioned to FAILED on balance check failure');

    // TEST 7: Duplicate Execution / Double Confirmation Guard
    console.log('\n[Test 7] Duplicate Confirmation & Execution Protection');
    sm.reset();
    sm.startIntent();
    sm.resolveRecipient({ upiId: 'dup@upi' });
    sm.verifyRecipient();
    sm.resolveAmount(50, 500);
    sm.verifyPaymentDirection('SEND');
    sm.performRiskCheck();
    sm.requestUserConfirmation();

    let undoEventCount = 0;
    const unsub = sm.on('undoStarted', () => { undoEventCount++; });
    sm.confirmByUser();
    sm.confirmByUser(); // Second click should be ignored
    unsub();
    assert(undoEventCount === 1, 'Duplicate confirmByUser() triggered undo event only once');

    // TEST 8: Failure Result States (FAILED, PENDING, UNKNOWN)
    console.log('\n[Test 8] Failure Result States: FAILED, PENDING, UNKNOWN');
    const testTerminalState = (targetResult) => {
        sm.reset();
        sm.startIntent();
        sm.resolveRecipient({ upiId: 'result@upi' });
        sm.verifyRecipient();
        sm.resolveAmount(100, 500);
        sm.verifyPaymentDirection('SEND');
        sm.performRiskCheck();
        sm.requestUserConfirmation();
        sm.confirmByUser();
        sm._onUndoWindowExpired();
        sm.authenticateTransaction({ success: true });
        sm.finalizeResult(targetResult, { message: `Simulated ${targetResult}` });
        assert(sm.getState() === targetResult, `Final state correctly set to ${targetResult}`);
    };

    testTerminalState(STATES.FAILED);
    testTerminalState(STATES.PENDING);
    testTerminalState(STATES.UNKNOWN);

    // TEST 9: Invalid Amount & Limit Rejection
    console.log('\n[Test 9] Invalid Amount & Limit Rejection');
    sm.reset();
    sm.startIntent();
    sm.resolveRecipient({ upiId: 'limit@upi' });
    sm.verifyRecipient();
    
    threw = false;
    try { sm.resolveAmount(-50, 1000); } catch(e) { threw = true; }
    assert(threw, 'Negative amount rejected');

    sm.reset();
    sm.startIntent();
    sm.resolveRecipient({ upiId: 'limit@upi' });
    sm.verifyRecipient();
    threw = false;
    try { sm.resolveAmount(200000, 500000); } catch(e) { threw = true; }
    assert(threw, 'Amount exceeding single limit (> ₹1,00,000) rejected');

    // TEST 10: Cancellation during SECURE_AUTHENTICATION
    console.log('\n[Test 10] Cancellation during SECURE_AUTHENTICATION');
    sm.reset();
    sm.startIntent();
    sm.resolveRecipient({ upiId: 'authcancel@upi' });
    sm.verifyRecipient();
    sm.resolveAmount(100, 500);
    sm.verifyPaymentDirection('SEND');
    sm.performRiskCheck();
    sm.requestUserConfirmation();
    sm.confirmByUser();
    sm._onUndoWindowExpired();
    assert(sm.getState() === STATES.SECURE_AUTHENTICATION, 'State is SECURE_AUTHENTICATION');
    
    sm.cancel('User exited PIN screen');
    assert(sm.getState() === STATES.CANCELLED, 'State safely transitioned to CANCELLED');

    // TEST 11: Attempting to Cancel AFTER Payment Initiated (Must Reject)
    console.log('\n[Test 11] Reject Cancellation after Payment Initiated');
    sm.reset();
    sm.startIntent();
    sm.resolveRecipient({ upiId: 'nocancel@upi' });
    sm.verifyRecipient();
    sm.resolveAmount(100, 500);
    sm.verifyPaymentDirection('SEND');
    sm.performRiskCheck();
    sm.requestUserConfirmation();
    sm.confirmByUser();
    sm._onUndoWindowExpired();
    sm.authenticateTransaction({ success: true });
    assert(sm.getState() === STATES.PAYMENT_INITIATED, 'State is PAYMENT_INITIATED');

    threw = false;
    try { sm.cancel('Late cancel attempt'); } catch(e) { threw = true; }
    assert(threw, 'Cancellation rejected once payment is in-flight (PAYMENT_INITIATED)');

    console.log(`\n========================================`);
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log(`========================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
