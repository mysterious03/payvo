// smart-qr-parser.js
// Deterministic Smart QR & Secure UPI URI Parser for VoxPay (SwiftPass)
// Parses, validates, sanitizes, and normalizes UPI QR codes without external AI or network calls.
// Reference: NPCI UPI Linking Specifications / UPI Intent Protocol

(function (global) {
    'use strict';

    // =========================================================================
    // 1. CONSTANTS & SECURITY CONFIGURATION
    // =========================================================================

    const QR_CONFIG = Object.freeze({
        supportedScheme: 'upi',
        supportedPath: 'pay',
        supportedCurrency: 'INR',
        maxPayloadLength: 2048,
        maxNameLength: 100,
        maxNoteLength: 120,
        maxTransactionLimit: 100000, // Standard NPCI UPI single transaction ceiling (₹1,00,000)
        minTransactionAmount: 0.01
    });

    const ERROR_CODES = Object.freeze({
        INVALID_SCHEME: 'INVALID_SCHEME',
        MISSING_RECIPIENT: 'MISSING_RECIPIENT',
        INVALID_UPI_ID: 'INVALID_UPI_ID',
        INVALID_AMOUNT: 'INVALID_AMOUNT',
        INVALID_CURRENCY: 'INVALID_CURRENCY',
        DUPLICATE_PARAMETER: 'DUPLICATE_PARAMETER',
        OVERSIZED_PAYLOAD: 'OVERSIZED_PAYLOAD',
        MALFORMED_URI: 'MALFORMED_URI'
    });

    const WARNING_CODES = Object.freeze({
        EXTERNAL_URL: 'EXTERNAL_URL',
        UNEXPECTED_PARAMETER: 'UNEXPECTED_PARAMETER',
        LONG_MERCHANT_NAME: 'LONG_MERCHANT_NAME',
        SUSPICIOUS_PAYLOAD: 'SUSPICIOUS_PAYLOAD'
    });

    // =========================================================================
    // 2. SANITIZATION & STRING HELPERS
    // =========================================================================

    /**
     * Escape and sanitize strings against HTML/script injection
     */
    function sanitizeText(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .replace(/[<>]/g, '')           // Strip raw brackets to prevent HTML injection
            .replace(/[\x00-\x1F\x7F]/g, '') // Strip control characters
            .trim();
    }

    /**
     * Safe URL decoding handling partial or malformed encoding
     */
    function safeDecodeURIComponent(str) {
        if (!str) return '';
        try {
            return decodeURIComponent(str.replace(/\+/g, ' '));
        } catch (e) {
            // Fallback for unescaped '%' or malformed sequences
            return unescape(str.replace(/\+/g, ' '));
        }
    }

    // =========================================================================
    // 3. CORE DETERMINISTIC PARSER
    // =========================================================================

    /**
     * Parses and validates a raw UPI QR string deterministically.
     * @param {string} rawValue - Raw decoded string from QR scanner
     * @returns {Object} Structured validation & normalized payment object
     */
    function parseSmartUPIQR(rawValue) {
        const result = {
            valid: false,
            type: 'upi_payment',
            raw: rawValue || '',
            recipient: {
                upiId: '',
                name: ''
            },
            amount: {
                value: null,
                currency: QR_CONFIG.supportedCurrency,
                fixed: false
            },
            transaction: {
                transactionRef: '',
                transactionId: '',
                note: '',
                merchantCode: '',
                url: ''
            },
            validation: {
                validScheme: false,
                validRecipient: false,
                validAmount: true, // true until an invalid amount is specified
                validCurrency: true,
                suspiciousFields: [],
                warnings: [],
                errors: []
            },
            normalized: null
        };

        // 1. Basic Type & Size Validation
        if (!rawValue || typeof rawValue !== 'string') {
            result.validation.errors.push({
                code: ERROR_CODES.MALFORMED_URI,
                severity: 'ERROR',
                message: 'QR code payload is empty or not text.'
            });
            return result;
        }

        const cleanRaw = rawValue.trim();
        result.raw = cleanRaw;

        if (cleanRaw.length > QR_CONFIG.maxPayloadLength) {
            result.validation.errors.push({
                code: ERROR_CODES.OVERSIZED_PAYLOAD,
                severity: 'ERROR',
                message: `QR code payload exceeds maximum allowable length of ${QR_CONFIG.maxPayloadLength} characters.`
            });
            return result;
        }

        // 2. Scheme Validation (Must strictly be upi://pay)
        // Handle variations like upi://pay? or upi://pay/
        const schemePrefix = 'upi://pay';
        const isUpiScheme = cleanRaw.toLowerCase().startsWith(schemePrefix);

        if (!isUpiScheme) {
            result.validation.errors.push({
                code: ERROR_CODES.INVALID_SCHEME,
                severity: 'ERROR',
                message: 'QR code is not a valid UPI payment QR (unsupported URI scheme).'
            });
            return result;
        }

        result.validation.validScheme = true;

        // 3. Extract Query String & Detect Duplicate Parameters
        const questionIdx = cleanRaw.indexOf('?');
        const queryString = questionIdx !== -1 ? cleanRaw.substring(questionIdx + 1) : '';

        // Split query pairs on raw '&'
        const queryPairs = queryString.split('&');
        const paramMap = {};
        const paramOccurrences = {};
        const rawParamKeys = [];

        for (const pair of queryPairs) {
            if (!pair) continue;
            const eqIdx = pair.indexOf('=');
            let rawKey = '';
            let rawVal = '';

            if (eqIdx !== -1) {
                rawKey = pair.substring(0, eqIdx).trim();
                rawVal = pair.substring(eqIdx + 1);
            } else {
                rawKey = pair.trim();
                rawVal = '';
            }

            const key = rawKey.toLowerCase();
            if (!key) continue;

            rawParamKeys.push(key);
            paramOccurrences[key] = (paramOccurrences[key] || 0) + 1;

            // Save first occurrence value safely decoded
            if (paramMap[key] === undefined) {
                paramMap[key] = safeDecodeURIComponent(rawVal);
            }
        }

        // Critical duplicate parameter security check (e.g. am=500&am=5000 or pa=a@upi&pa=b@upi)
        const criticalKeys = ['pa', 'am', 'cu', 'pn', 'tr', 'tid'];
        for (const critKey of criticalKeys) {
            if (paramOccurrences[critKey] > 1) {
                result.validation.errors.push({
                    code: ERROR_CODES.DUPLICATE_PARAMETER,
                    severity: 'ERROR',
                    message: `Security violation: Duplicate critical parameter '${critKey}' detected in QR payload.`
                });
                return result; // Fail fast on parameter pollution attack
            }
        }

        // 4. Validate UPI ID (pa - Payee Address)
        const rawPa = paramMap['pa'];
        if (!rawPa) {
            result.validation.errors.push({
                code: ERROR_CODES.MISSING_RECIPIENT,
                severity: 'ERROR',
                message: 'QR code does not contain a recipient UPI ID (missing "pa" parameter).'
            });
            return result;
        }

        const cleanPa = rawPa.trim();
        // UPI ID format: username@bank (strict syntactic format validation)
        // Typically 3 to 100 chars, exactly one @, valid username/handle chars
        const upiIdRegex = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z0-9.\-_]{2,32}$/;

        if (!upiIdRegex.test(cleanPa) || cleanPa.includes(' ') || cleanPa.length < 5 || cleanPa.length > 100) {
            result.validation.errors.push({
                code: ERROR_CODES.INVALID_UPI_ID,
                severity: 'ERROR',
                message: `The recipient UPI ID "${cleanPa}" is invalid or malformed.`
            });
            return result;
        }

        result.recipient.upiId = cleanPa;
        result.validation.validRecipient = true;

        // 5. Validate Merchant / Payee Name (pn - Payee Name)
        const rawPn = paramMap['pn'] || '';
        let sanitizedName = sanitizeText(rawPn);

        if (!sanitizedName) {
            // Fallback to username part of UPI ID if name missing
            sanitizedName = cleanPa.split('@')[0] || 'UPI Merchant';
        } else if (sanitizedName.length > QR_CONFIG.maxNameLength) {
            result.validation.warnings.push({
                code: WARNING_CODES.LONG_MERCHANT_NAME,
                severity: 'WARNING',
                message: `Payee name exceeds ${QR_CONFIG.maxNameLength} characters and was truncated for security.`
            });
            sanitizedName = sanitizedName.substring(0, QR_CONFIG.maxNameLength);
        }

        result.recipient.name = sanitizedName;

        // 6. Validate Amount (am - Amount)
        const rawAm = paramMap['am'];
        if (rawAm !== undefined && rawAm !== '') {
            const cleanAmStr = rawAm.trim();
            // Strictest numeric format check: positive float with at most 2 decimal places, no scientific notation
            const numericRegex = /^\d+(\.\d{1,2})?$/;

            if (!numericRegex.test(cleanAmStr)) {
                result.validation.validAmount = false;
                result.validation.errors.push({
                    code: ERROR_CODES.INVALID_AMOUNT,
                    severity: 'ERROR',
                    message: `Invalid amount "${cleanAmStr}". Amount must be a positive numeric value with at most 2 decimal places.`
                });
                return result;
            }

            const parsedAmount = parseFloat(cleanAmStr);

            if (isNaN(parsedAmount) || !isFinite(parsedAmount) || parsedAmount < QR_CONFIG.minTransactionAmount || parsedAmount > QR_CONFIG.maxTransactionLimit) {
                result.validation.validAmount = false;
                result.validation.errors.push({
                    code: ERROR_CODES.INVALID_AMOUNT,
                    severity: 'ERROR',
                    message: `Transaction amount ₹${cleanAmStr} is out of allowable bounds (₹${QR_CONFIG.minTransactionAmount} - ₹${QR_CONFIG.maxTransactionLimit.toLocaleString('en-IN')}).`
                });
                return result;
            }

            // Valid Fixed Amount
            result.amount.value = parseFloat(parsedAmount.toFixed(2));
            result.amount.fixed = true;
        } else {
            // Open Amount QR (User specifies amount during transaction)
            result.amount.value = null;
            result.amount.fixed = false;
        }

        // 7. Validate Currency (cu - Currency)
        const rawCu = paramMap['cu'];
        if (rawCu !== undefined && rawCu !== '') {
            const cleanCu = rawCu.trim().toUpperCase();
            if (cleanCu !== QR_CONFIG.supportedCurrency) {
                result.validation.validCurrency = false;
                result.validation.errors.push({
                    code: ERROR_CODES.INVALID_CURRENCY,
                    severity: 'ERROR',
                    message: `Unsupported currency "${cleanCu}". Only "${QR_CONFIG.supportedCurrency}" transactions are permitted.`
                });
                return result;
            }
            result.amount.currency = cleanCu;
        } else {
            result.amount.currency = QR_CONFIG.supportedCurrency;
        }

        // 8. Extract Optional Transaction Metadata
        result.transaction.transactionRef = sanitizeText(paramMap['tr'] || '');
        result.transaction.transactionId = sanitizeText(paramMap['tid'] || '');
        result.transaction.merchantCode = sanitizeText(paramMap['mc'] || '');

        const rawNote = sanitizeText(paramMap['tn'] || '');
        result.transaction.note = rawNote.length > QR_CONFIG.maxNoteLength ? rawNote.substring(0, QR_CONFIG.maxNoteLength) : rawNote;

        // 9. Detect Suspicious Fields (e.g. url, redirect, script)
        const knownKeys = ['pa', 'pn', 'am', 'cu', 'tn', 'tr', 'tid', 'mc', 'mode', 'sign', 'orgid', 'mid', 'msid', 'mtid'];

        if (paramMap['url']) {
            result.transaction.url = paramMap['url'];
            result.validation.suspiciousFields.push('url');
            result.validation.warnings.push({
                code: WARNING_CODES.EXTERNAL_URL,
                severity: 'WARNING',
                message: `QR code contains an external web address (${paramMap['url']}). Automatic navigation is strictly blocked.`
            });
        }

        for (const k of rawParamKeys) {
            if (!knownKeys.includes(k) && k !== 'url') {
                result.validation.suspiciousFields.push(k);
                result.validation.warnings.push({
                    code: WARNING_CODES.UNEXPECTED_PARAMETER,
                    severity: 'INFO',
                    message: `Non-standard parameter '${k}' detected in QR code.`
                });
            }
        }

        // 10. Construct Normalized Output Object
        result.valid = true;
        result.normalized = {
            recipientUpiId: result.recipient.upiId,
            recipientName: result.recipient.name,
            amount: result.amount.value,
            amountFixed: result.amount.fixed,
            currency: result.amount.currency,
            transactionRef: result.transaction.transactionRef,
            transactionId: result.transaction.transactionId,
            merchantCode: result.transaction.merchantCode,
            note: result.transaction.note,
            warnings: result.validation.warnings.map(w => w.message),
            source: 'QR',
            parsedAt: new Date().toISOString()
        };

        return result;
    }

    // =========================================================================
    // 4. EXPORTS
    // =========================================================================

    const SmartQRParser = {
        parseSmartUPIQR,
        QR_CONFIG,
        ERROR_CODES,
        WARNING_CODES,
        sanitizeText
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SmartQRParser;
    } else {
        global.SmartQRParser = SmartQRParser;
        global.parseSmartUPIQR = parseSmartUPIQR;
    }

})(typeof window !== 'undefined' ? window : global);
