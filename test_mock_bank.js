// test_mock_bank.js
// Unit & Integration Test Suite for Mock NPCI Core Banking System

const assert = require('assert');
const { MockBank, mockBank } = require('./mock-bank.js');

let total = 0;
let passed = 0;

function runAssert(condition, message) {
    total++;
    try {
        assert(condition, message);
        console.log(`  ✓ PASS: ${message}`);
        passed++;
    } catch (e) {
        console.error(`  ✗ FAIL: ${message} (${e.message})`);
    }
}

async function runTestSuite() {
    console.log('===============================================================');
    console.log('VOXPAY MOCK CORE BANKING SYSTEM (CBS) & UPI GATEWAY TEST SUITE');
    console.log('===============================================================\n');

    const bank = new MockBank();

    // -------------------------------------------------------------------------
    // TEST 1: Initial User Balance & Accounts
    // -------------------------------------------------------------------------
    console.log('[Test 1] Initial Balance & Account Directory');
    const initBal = bank.getBalance('suriya@swiftpass');
    runAssert(initBal === 1550.00, `Initial balance is ₹1550 (actual: ₹${initBal})`);

    // -------------------------------------------------------------------------
    // TEST 2: VPA Directory Resolution
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] VPA Directory Resolution (NPCI VPA Lookup)');
    const vpaRamesh = await bank.verifyVpa('ramesh@upi');
    runAssert(vpaRamesh.valid === true, 'Resolved ramesh@upi');
    runAssert(vpaRamesh.name === 'Ramesh Kumar', `Resolved name: "${vpaRamesh.name}"`);
    runAssert(vpaRamesh.bankName === 'State Bank of India', `Resolved bank: "${vpaRamesh.bankName}"`);

    const vpaPriya = await bank.verifyVpa('priya@gpay');
    runAssert(vpaPriya.valid === true && vpaPriya.name === 'Priya Sharma', 'Resolved priya@gpay to Priya Sharma');

    const vpaSynthetic = await bank.verifyVpa('arun.kumar@hdfcbank');
    runAssert(vpaSynthetic.valid === true, 'Resolved external dynamic VPA arun.kumar@hdfcbank');

    // -------------------------------------------------------------------------
    // TEST 3: Standard NPCI 12-Digit UTR Generation
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] Standard NPCI 12-Digit UTR Generation');
    const utr1 = bank.generateUtr();
    const utr2 = bank.generateUtr();
    runAssert(utr1.length === 12, `UTR length is exactly 12 digits (actual: "${utr1}")`);
    runAssert(/^\d{12}$/.test(utr1), 'UTR consists exclusively of 12 numeric digits');
    runAssert(utr1 !== utr2, 'Generated unique consecutive UTRs');

    // -------------------------------------------------------------------------
    // TEST 4: Money Transfer Settlement (Debits & Credits)
    // -------------------------------------------------------------------------
    console.log('\n[Test 4] Money Transfer Settlement & Atomic Balance Update');
    const startBal = bank.getBalance('suriya@swiftpass');
    const transferRes = await bank.processTransfer({
        fromVpa: 'suriya@swiftpass',
        toVpa: 'ramesh@upi',
        amount: 250.00,
        note: 'Dinner split'
    });

    runAssert(transferRes.success === true, 'Transfer succeeded');
    runAssert(transferRes.utr.length === 12, `12-digit UTR generated: ${transferRes.utr}`);
    runAssert(transferRes.newBalance === (startBal - 250.00), `Balance debited correctly to ₹${transferRes.newBalance}`);
    runAssert(bank.getBalance('suriya@swiftpass') === (startBal - 250.00), 'Persistent balance store updated');

    // -------------------------------------------------------------------------
    // TEST 5: Insufficient Funds Rejection
    // -------------------------------------------------------------------------
    console.log('\n[Test 5] Insufficient Funds Rejection');
    const failRes = await bank.processTransfer({
        fromVpa: 'suriya@swiftpass',
        toVpa: 'ramesh@upi',
        amount: 999999.00
    });

    runAssert(failRes.success === false, 'Large transfer rejected');
    runAssert(failRes.reason === 'INSUFFICIENT_FUNDS', `Reason is INSUFFICIENT_FUNDS (actual: ${failRes.reason})`);

    // -------------------------------------------------------------------------
    // TEST 6: Load Money Flow
    // -------------------------------------------------------------------------
    console.log('\n[Test 6] Load Money from Linked Bank Account');
    const balBefore = bank.getBalance('suriya@swiftpass');
    const loadRes = bank.loadMoney(500.00, 'suriya@swiftpass');
    runAssert(loadRes.success === true, 'Money loaded successfully');
    runAssert(loadRes.newBalance === (balBefore + 500.00), `New balance is ₹${loadRes.newBalance}`);

    // -------------------------------------------------------------------------
    // TEST 7: Immutable Bank Ledger Entries
    // -------------------------------------------------------------------------
    console.log('\n[Test 7] Immutable Bank Ledger Verification');
    const ledger = bank.getLedger();
    runAssert(Array.isArray(ledger), 'Ledger returns array of transaction records');

    console.log('\n===============================================================');
    console.log(`TOTAL MOCK BANK TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
    console.log('===============================================================\n');

    if (passed !== total) process.exit(1);
}

runTestSuite();
