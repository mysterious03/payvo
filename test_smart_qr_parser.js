// test_smart_qr_parser.js
// Test Suite for Deterministic Smart QR & Secure UPI URI Parser

const assert = require('assert');
const SmartQRParser = require('./smart-qr-parser.js');
const { parseSmartUPIQR, QR_CONFIG, ERROR_CODES, WARNING_CODES } = SmartQRParser;

let passed = 0;
let total = 0;

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

function runTestSuite() {
    console.log('===============================================================');
    console.log('VOXPAY SMART QR & SECURE UPI URI PARSER TEST SUITE');
    console.log('===============================================================\n');

    // -------------------------------------------------------------------------
    // TEST 1: Valid Fixed Amount UPI QR Code
    // -------------------------------------------------------------------------
    console.log('[Test 1] Valid Fixed Amount UPI QR Code');
    const validFixedQR = 'upi://pay?pa=merchant@upi&pn=Test%20Merchant&am=500&cu=INR&tn=Dinner%20Payment&tr=TX123456';
    const res1 = parseSmartUPIQR(validFixedQR);

    runAssert(res1.valid === true, 'Valid fixed QR parsed successfully');
    runAssert(res1.type === 'upi_payment', 'Type is "upi_payment"');
    runAssert(res1.recipient.upiId === 'merchant@upi', `Recipient UPI ID is "merchant@upi" (actual: ${res1.recipient.upiId})`);
    runAssert(res1.recipient.name === 'Test Merchant', `Recipient name is "Test Merchant" (actual: ${res1.recipient.name})`);
    runAssert(res1.amount.value === 500, `Amount value is 500 (actual: ${res1.amount.value})`);
    runAssert(res1.amount.currency === 'INR', `Currency is "INR" (actual: ${res1.amount.currency})`);
    runAssert(res1.amount.fixed === true, 'Amount is fixed (fixed = true)');
    runAssert(res1.transaction.note === 'Dinner Payment', `Transaction note decoded: "${res1.transaction.note}"`);
    runAssert(res1.transaction.transactionRef === 'TX123456', `Transaction ref decoded: "${res1.transaction.transactionRef}"`);
    runAssert(res1.normalized !== null, 'Normalized payload generated');
    runAssert(res1.normalized.source === 'QR', 'Source is "QR"');

    // -------------------------------------------------------------------------
    // TEST 2: Valid Open Amount UPI QR Code (User enters amount)
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] Valid Open Amount UPI QR Code');
    const validOpenQR = 'upi://pay?pa=merchant@upi&pn=Test%20Merchant&cu=INR';
    const res2 = parseSmartUPIQR(validOpenQR);

    runAssert(res2.valid === true, 'Open amount QR parsed as valid');
    runAssert(res2.amount.fixed === false, 'Amount is not fixed (amount.fixed = false)');
    runAssert(res2.amount.value === null, 'Amount value is null');
    runAssert(res2.normalized.amount === null, 'Normalized amount is null');
    runAssert(res2.normalized.amountFixed === false, 'Normalized amountFixed is false');

    // -------------------------------------------------------------------------
    // TEST 3: Invalid URI Schemes (Strict Rejection of Non-UPI Schemes)
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] Invalid URI Schemes & Malformed Inputs');
    const invalidSchemes = [
        'https://example.com/pay',
        'http://phishing.site/upi',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'data:text/html,<script>alert(1)</script>',
        'intent://pay?pa=merchant@upi',
        'random text string without scheme',
        ''
    ];

    for (const badScheme of invalidSchemes) {
        const res = parseSmartUPIQR(badScheme);
        runAssert(res.valid === false, `Rejected invalid scheme / input: "${badScheme.substring(0, 30)}"`);
        runAssert(res.validation.validScheme === false || res.validation.errors.length > 0, 'Error recorded');
    }

    // -------------------------------------------------------------------------
    // TEST 4: Invalid Amount Validation
    // -------------------------------------------------------------------------
    console.log('\n[Test 4] Invalid Amount Validation (Zero, Negative, Non-numeric, Extreme)');
    const invalidAmounts = [
        'upi://pay?pa=merchant@upi&am=0',
        'upi://pay?pa=merchant@upi&am=-500',
        'upi://pay?pa=merchant@upi&am=abc',
        'upi://pay?pa=merchant@upi&am=NaN',
        'upi://pay?pa=merchant@upi&am=Infinity',
        'upi://pay?pa=merchant@upi&am=999999999999999999999',
        'upi://pay?pa=merchant@upi&am=10.555', // > 2 decimal places
        'upi://pay?pa=merchant@upi&am=1e5'     // scientific notation
    ];

    for (const badAmQR of invalidAmounts) {
        const res = parseSmartUPIQR(badAmQR);
        runAssert(res.valid === false, `Rejected invalid amount QR: "${badAmQR.split('&am=')[1]}"`);
        runAssert(res.validation.errors.some(e => e.code === ERROR_CODES.INVALID_AMOUNT), 'Recorded INVALID_AMOUNT error');
    }

    // -------------------------------------------------------------------------
    // TEST 5: Duplicate Critical Parameter Attack Detection
    // -------------------------------------------------------------------------
    console.log('\n[Test 5] Duplicate Parameter Pollution Detection');
    const dupAmountQR = 'upi://pay?pa=merchant@upi&am=500&am=1000';
    const resDupAm = parseSmartUPIQR(dupAmountQR);
    runAssert(resDupAm.valid === false, 'Rejected duplicate "am" parameter attack');
    runAssert(resDupAm.validation.errors.some(e => e.code === ERROR_CODES.DUPLICATE_PARAMETER), 'Recorded DUPLICATE_PARAMETER error for am');

    const dupPaQR = 'upi://pay?pa=merchant1@upi&pa=merchant2@upi&am=500';
    const resDupPa = parseSmartUPIQR(dupPaQR);
    runAssert(resDupPa.valid === false, 'Rejected duplicate "pa" recipient parameter attack');
    runAssert(resDupPa.validation.errors.some(e => e.code === ERROR_CODES.DUPLICATE_PARAMETER), 'Recorded DUPLICATE_PARAMETER error for pa');

    // -------------------------------------------------------------------------
    // TEST 6: URL Encoding Handling & Special Characters
    // -------------------------------------------------------------------------
    console.log('\n[Test 6] URL Encoded Data Handling');
    const encodedQR = 'upi://pay?pa=merchant%40okaxis&pn=Ravi%20Store%20%26%20Sons&am=250.50&cu=INR';
    const resEnc = parseSmartUPIQR(encodedQR);
    runAssert(resEnc.valid === true, 'URL encoded QR parsed successfully');
    runAssert(resEnc.recipient.upiId === 'merchant@okaxis', `Decoded "merchant%40okaxis" -> "${resEnc.recipient.upiId}"`);
    runAssert(resEnc.recipient.name === 'Ravi Store & Sons', `Decoded "Ravi%20Store%20%26%20Sons" -> "${resEnc.recipient.name}"`);
    runAssert(resEnc.amount.value === 250.5, `Normalized amount: ${resEnc.amount.value}`);

    // -------------------------------------------------------------------------
    // TEST 7: External URL Detection (Security Invariant: Never Auto-Navigate)
    // -------------------------------------------------------------------------
    console.log('\n[Test 7] External URL Detection & Navigation Blocking');
    const urlQR = 'upi://pay?pa=merchant@upi&pn=Store&am=100&url=https%3A%2F%2Fmalicious-site.com%2Fsteal';
    const resUrl = parseSmartUPIQR(urlQR);
    runAssert(resUrl.valid === true, 'QR is valid for payment');
    runAssert(resUrl.validation.warnings.some(w => w.code === WARNING_CODES.EXTERNAL_URL), 'Recorded EXTERNAL_URL warning');
    runAssert(resUrl.transaction.url === 'https://malicious-site.com/steal', 'URL extracted for diagnostic logging');

    // -------------------------------------------------------------------------
    // TEST 8: XSS / HTML Script Injection Immunity
    // -------------------------------------------------------------------------
    console.log('\n[Test 8] XSS / HTML Script Injection Immunity');
    const xssQR = 'upi://pay?pa=merchant@upi&pn=%3Cscript%3Ealert(1)%3C%2Fscript%3EBakery&am=100';
    const resXss = parseSmartUPIQR(xssQR);
    runAssert(resXss.valid === true, 'Parsed payload safely');
    runAssert(!resXss.recipient.name.includes('<script>'), `Script tag stripped from merchant name (actual: "${resXss.recipient.name}")`);
    runAssert(!resXss.recipient.name.includes('<') && !resXss.recipient.name.includes('>'), 'HTML angle brackets completely stripped');

    // -------------------------------------------------------------------------
    // TEST 9: Currency Validation (INR Supported, Foreign Currency Rejected)
    // -------------------------------------------------------------------------
    console.log('\n[Test 9] Currency Validation');
    const inrQR = 'upi://pay?pa=merchant@upi&am=100&cu=INR';
    const resInr = parseSmartUPIQR(inrQR);
    runAssert(resInr.valid === true && resInr.amount.currency === 'INR', 'INR currency accepted');

    const inrLowerQR = 'upi://pay?pa=merchant@upi&am=100&cu=inr';
    const resInrLower = parseSmartUPIQR(inrLowerQR);
    runAssert(resInrLower.valid === true && resInrLower.amount.currency === 'INR', 'Case-insensitive "inr" normalized to "INR"');

    const usdQR = 'upi://pay?pa=merchant@upi&am=100&cu=USD';
    const resUsd = parseSmartUPIQR(usdQR);
    runAssert(resUsd.valid === false, 'Rejected non-INR currency "USD"');
    runAssert(resUsd.validation.errors.some(e => e.code === ERROR_CODES.INVALID_CURRENCY), 'Recorded INVALID_CURRENCY error');

    // -------------------------------------------------------------------------
    // TEST 10: Oversized Payload & Long Field Sanitization
    // -------------------------------------------------------------------------
    console.log('\n[Test 10] Oversized Payload & Long Field Sanitization');
    const hugePayload = 'upi://pay?pa=merchant@upi&am=100&note=' + 'A'.repeat(2500);
    const resHuge = parseSmartUPIQR(hugePayload);
    runAssert(resHuge.valid === false, 'Rejected payload exceeding 2048 bytes');
    runAssert(resHuge.validation.errors.some(e => e.code === ERROR_CODES.OVERSIZED_PAYLOAD), 'Recorded OVERSIZED_PAYLOAD error');

    const longNameQR = 'upi://pay?pa=merchant@upi&pn=' + 'MerchantName'.repeat(20) + '&am=100';
    const resLongName = parseSmartUPIQR(longNameQR);
    runAssert(resLongName.valid === true, 'Valid QR with long name');
    runAssert(resLongName.recipient.name.length <= QR_CONFIG.maxNameLength, `Truncated long name to <= ${QR_CONFIG.maxNameLength} chars (actual: ${resLongName.recipient.name.length})`);
    runAssert(resLongName.validation.warnings.some(w => w.code === WARNING_CODES.LONG_MERCHANT_NAME), 'Recorded LONG_MERCHANT_NAME warning');

    // -------------------------------------------------------------------------
    // TEST 11: Invalid / Missing UPI ID (pa)
    // -------------------------------------------------------------------------
    console.log('\n[Test 11] Invalid / Missing UPI ID Validation');
    const missingPaQR = 'upi://pay?pn=Store&am=100';
    const resMissingPa = parseSmartUPIQR(missingPaQR);
    runAssert(resMissingPa.valid === false, 'Rejected missing "pa"');
    runAssert(resMissingPa.validation.errors.some(e => e.code === ERROR_CODES.MISSING_RECIPIENT), 'Recorded MISSING_RECIPIENT error');

    const noAtQR = 'upi://pay?pa=invalidmerchantaddress&am=100';
    const resNoAt = parseSmartUPIQR(noAtQR);
    runAssert(resNoAt.valid === false, 'Rejected UPI ID missing "@"');
    runAssert(resNoAt.validation.errors.some(e => e.code === ERROR_CODES.INVALID_UPI_ID), 'Recorded INVALID_UPI_ID error');

    const spacePaQR = 'upi://pay?pa=merchant%20name@upi&am=100';
    const resSpacePa = parseSmartUPIQR(spacePaQR);
    runAssert(resSpacePa.valid === false, 'Rejected UPI ID containing spaces');
    runAssert(resSpacePa.validation.errors.some(e => e.code === ERROR_CODES.INVALID_UPI_ID), 'Recorded INVALID_UPI_ID error');

    // -------------------------------------------------------------------------
    // TEST 12: Normalization Invariants & Canonical Representation
    // -------------------------------------------------------------------------
    console.log('\n[Test 12] Normalization Invariants & Canonical Representation');
    const testNormQR = 'upi://pay?pa=freshmart@icici&pn=FreshMart%20Supermarket&am=1250.00&cu=INR&tr=REF98765&tid=TID5544&mc=5411&tn=Groceries';
    const resNorm = parseSmartUPIQR(testNormQR);

    runAssert(resNorm.valid === true, 'Parsed canonical test QR');
    const n = resNorm.normalized;
    runAssert(n.recipientUpiId === 'freshmart@icici', 'Canonical recipientUpiId matches');
    runAssert(n.recipientName === 'FreshMart Supermarket', 'Canonical recipientName matches');
    runAssert(n.amount === 1250, 'Canonical amount is normalized numeric');
    runAssert(n.amountFixed === true, 'Canonical amountFixed is true');
    runAssert(n.currency === 'INR', 'Canonical currency is INR');
    runAssert(n.transactionRef === 'REF98765', 'Canonical transactionRef matches');
    runAssert(n.transactionId === 'TID5544', 'Canonical transactionId matches');
    runAssert(n.merchantCode === '5411', 'Canonical merchantCode matches');
    runAssert(n.note === 'Groceries', 'Canonical note matches');
    runAssert(n.source === 'QR', 'Canonical source is "QR"');

    console.log('\n===============================================================');
    console.log(`TOTAL SMART QR PARSER TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
    console.log('===============================================================\n');

    if (passed !== total) {
        process.exit(1);
    }
}

runTestSuite();
