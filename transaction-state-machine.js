// transaction-state-machine.js
// VoxPay Deterministic Transaction Safety Engine
// Central authority for payment lifecycle, validation, confirmation, undo window, and settlement.

(function (global) {
    'use strict';

    // 1. STATE DEFINITIONS
    const STATES = Object.freeze({
        IDLE: 'IDLE',
        INTENT_RECEIVED: 'INTENT_RECEIVED',
        RECIPIENT_RESOLVED: 'RECIPIENT_RESOLVED',
        RECIPIENT_VERIFIED: 'RECIPIENT_VERIFIED',
        AMOUNT_RESOLVED: 'AMOUNT_RESOLVED',
        PAYMENT_DIRECTION_VERIFIED: 'PAYMENT_DIRECTION_VERIFIED',
        RISK_CHECK: 'RISK_CHECK',
        USER_CONFIRMATION: 'USER_CONFIRMATION',
        UNDO_WINDOW: 'UNDO_WINDOW',
        SECURE_AUTHENTICATION: 'SECURE_AUTHENTICATION',
        PAYMENT_INITIATED: 'PAYMENT_INITIATED',
        RESULT_VERIFICATION: 'RESULT_VERIFICATION',
        SUCCESS: 'SUCCESS',
        FAILED: 'FAILED',
        PENDING: 'PENDING',
        UNKNOWN: 'UNKNOWN',
        CANCELLED: 'CANCELLED'
    });

    // 2. VALID STATE TRANSITION MAP
    const VALID_TRANSITIONS = Object.freeze({
        [STATES.IDLE]: [STATES.INTENT_RECEIVED],
        [STATES.INTENT_RECEIVED]: [STATES.RECIPIENT_RESOLVED, STATES.CANCELLED, STATES.FAILED],
        [STATES.RECIPIENT_RESOLVED]: [STATES.RECIPIENT_VERIFIED, STATES.CANCELLED, STATES.FAILED],
        [STATES.RECIPIENT_VERIFIED]: [STATES.AMOUNT_RESOLVED, STATES.CANCELLED, STATES.FAILED],
        [STATES.AMOUNT_RESOLVED]: [STATES.PAYMENT_DIRECTION_VERIFIED, STATES.CANCELLED, STATES.FAILED],
        [STATES.PAYMENT_DIRECTION_VERIFIED]: [STATES.RISK_CHECK, STATES.CANCELLED, STATES.FAILED],
        [STATES.RISK_CHECK]: [STATES.USER_CONFIRMATION, STATES.CANCELLED, STATES.FAILED],
        [STATES.USER_CONFIRMATION]: [STATES.UNDO_WINDOW, STATES.CANCELLED, STATES.FAILED],
        [STATES.UNDO_WINDOW]: [STATES.SECURE_AUTHENTICATION, STATES.CANCELLED],
        [STATES.SECURE_AUTHENTICATION]: [STATES.PAYMENT_INITIATED, STATES.CANCELLED, STATES.FAILED],
        [STATES.PAYMENT_INITIATED]: [STATES.RESULT_VERIFICATION, STATES.FAILED],
        [STATES.RESULT_VERIFICATION]: [STATES.SUCCESS, STATES.FAILED, STATES.PENDING, STATES.UNKNOWN],
        [STATES.SUCCESS]: [STATES.IDLE],
        [STATES.FAILED]: [STATES.IDLE],
        [STATES.PENDING]: [STATES.IDLE],
        [STATES.UNKNOWN]: [STATES.IDLE],
        [STATES.CANCELLED]: [STATES.IDLE]
    });

    // 3. EVENT EMITTER SYSTEM
    class EventEmitter {
        constructor() {
            this._listeners = {};
        }

        on(event, callback) {
            if (!this._listeners[event]) {
                this._listeners[event] = [];
            }
            this._listeners[event].push(callback);
            return () => this.off(event, callback);
        }

        off(event, callback) {
            if (!this._listeners[event]) return;
            this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
        }

        emit(event, data) {
            if (!this._listeners[event]) return;
            const listeners = [...this._listeners[event]];
            listeners.forEach(cb => {
                try {
                    cb(data);
                } catch (e) {
                    console.error(`[TransactionStateMachine] Event listener error on '${event}':`, e);
                }
            });
        }
    }

    // 4. TRANSACTION STATE MACHINE CLASS
    class TransactionStateMachine extends EventEmitter {
        constructor(options = {}) {
            super();
            this.options = Object.assign({
                undoDurationMs: 3000,
                maxSingleTransactionLimit: 100000,
                defaultAccount: 'SwiftPass Wallet (HDFC ••••4821)'
            }, options);

            this.state = STATES.IDLE;
            this.context = null;
            this._undoTimer = null;
            this._executionLock = false;
        }

        /**
         * Generate unique transaction ID
         */
        _generateTxId() {
            return 'TXN_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
        }

        /**
         * Get Current State
         */
        getState() {
            return this.state;
        }

        /**
         * Get Current Context Clone (to avoid external direct mutation)
         */
        getContext() {
            return this.context ? JSON.parse(JSON.stringify(this.context)) : null;
        }

        /**
         * Authoritative state transition validator & updater
         */
        _transition(nextState, metadata = {}) {
            const allowedNext = VALID_TRANSITIONS[this.state] || [];
            if (!allowedNext.includes(nextState)) {
                const errorMsg = `Invalid state transition: Cannot transition from '${this.state}' to '${nextState}'`;
                console.error(`[TransactionStateMachine] ${errorMsg}`);
                this.emit('error', {
                    error: errorMsg,
                    fromState: this.state,
                    toState: nextState,
                    context: this.getContext()
                });
                throw new Error(errorMsg);
            }

            const prevState = this.state;
            this.state = nextState;

            if (this.context) {
                this.context.status = nextState;
                this.context.updatedAt = Date.now();
                Object.assign(this.context, metadata);
            }

            console.log(`[TransactionStateMachine] Transition: ${prevState} -> ${nextState}`, this.context);

            this.emit('stateChanged', {
                from: prevState,
                to: nextState,
                context: this.getContext()
            });

            return this.state;
        }

        /**
         * 1. Start a New Transaction Intent
         */
        startIntent({ source = 'MANUAL', rawData = {} } = {}) {
            if (this.state !== STATES.IDLE) {
                // If a transaction is already active or terminal, reset cleanly if not currently executing
                if (this._isTerminal(this.state)) {
                    this.reset();
                } else {
                    throw new Error(`Cannot start new intent while a transaction is in progress (${this.state})`);
                }
            }

            this.context = {
                transactionId: this._generateTxId(),
                recipient: {
                    name: '',
                    upiId: '',
                    phone: '',
                    bank: ''
                },
                amount: 0,
                currency: 'INR',
                direction: 'SEND', // 'SEND' or 'REQUEST'
                source: source,   // 'QR' | 'PHONE' | 'UPI_ID' | 'CONTACT' | 'VOICE' | 'MANUAL'
                account: this.options.defaultAccount,
                recipientVerified: false,
                amountVerified: false,
                directionVerified: false,
                riskCheckPassed: false,
                userConfirmed: false,
                undoCompleted: false,
                authenticationCompleted: false,
                status: STATES.IDLE,
                error: null,
                utr: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                rawData: rawData
            };

            this._transition(STATES.INTENT_RECEIVED);
            return this.getContext();
        }

        /**
         * 2. Resolve Recipient
         */
        resolveRecipient({ name, upiId, phone = '', bank = '' }) {
            if (this.state !== STATES.INTENT_RECEIVED) {
                throw new Error(`Cannot resolve recipient in state '${this.state}'`);
            }

            if (!name && !upiId && !phone) {
                this.fail('Recipient identifier (name, UPI ID, or phone) is required.');
                throw new Error('Recipient details are missing.');
            }

            const cleanUpi = (upiId || '').trim().toLowerCase();
            const cleanName = (name || cleanUpi.split('@')[0] || (phone ? `+91${phone}` : 'Recipient')).trim();

            this.context.recipient = {
                name: cleanName,
                upiId: cleanUpi,
                phone: phone ? phone.trim() : '',
                bank: bank ? bank.trim() : ''
            };

            this._transition(STATES.RECIPIENT_RESOLVED);
            return this.getContext();
        }

        /**
         * 3. Verify Recipient
         */
        verifyRecipient(verificationDetails = {}) {
            if (this.state !== STATES.RECIPIENT_RESOLVED) {
                throw new Error(`Cannot verify recipient in state '${this.state}'`);
            }

            const rec = this.context.recipient;
            if (!rec.upiId && !rec.phone) {
                this.fail('Recipient UPI ID or phone number is invalid.');
                throw new Error('Invalid recipient.');
            }

            this.context.recipientVerified = true;
            if (verificationDetails.verifiedName) {
                this.context.recipient.name = verificationDetails.verifiedName;
            }
            if (verificationDetails.bank) {
                this.context.recipient.bank = verificationDetails.bank;
            }

            this._transition(STATES.RECIPIENT_VERIFIED);
            return this.getContext();
        }

        /**
         * 4. Resolve and Validate Amount
         */
        resolveAmount(amount, currentBalance = Infinity) {
            if (this.state !== STATES.RECIPIENT_VERIFIED) {
                throw new Error(`Cannot resolve amount in state '${this.state}'`);
            }

            const parsed = parseFloat(amount);
            if (isNaN(parsed) || parsed <= 0) {
                this.fail('Amount must be a positive number greater than 0.');
                throw new Error('Invalid payment amount.');
            }

            if (parsed > this.options.maxSingleTransactionLimit) {
                this.fail(`Amount exceeds single transaction limit of ₹${this.options.maxSingleTransactionLimit.toLocaleString('en-IN')}`);
                throw new Error('Amount exceeds maximum transaction limit.');
            }

            // Authoritative balance check
            if (parsed > currentBalance) {
                this.fail(`Insufficient balance. Current balance is ₹${currentBalance.toLocaleString('en-IN')}`);
                throw new Error('Insufficient balance.');
            }

            this.context.amount = parsed;
            this.context.amountVerified = true;

            this._transition(STATES.AMOUNT_RESOLVED);
            return this.getContext();
        }

        /**
         * 5. Verify Payment Direction
         */
        verifyPaymentDirection(direction = 'SEND') {
            if (this.state !== STATES.AMOUNT_RESOLVED) {
                throw new Error(`Cannot verify direction in state '${this.state}'`);
            }

            if (direction !== 'SEND' && direction !== 'REQUEST') {
                this.fail('Payment direction must be either SEND or REQUEST.');
                throw new Error('Invalid payment direction.');
            }

            this.context.direction = direction;
            this.context.directionVerified = true;

            this._transition(STATES.PAYMENT_DIRECTION_VERIFIED);
            return this.getContext();
        }

        /**
         * 6. Perform Risk & Safety Check
         */
        performRiskCheck() {
            if (this.state !== STATES.PAYMENT_DIRECTION_VERIFIED) {
                throw new Error(`Cannot perform risk check in state '${this.state}'`);
            }

            // Deterministic safety rules
            const ctx = this.context;
            let riskPassed = true;
            let riskReason = null;

            if (ctx.amount <= 0 || !ctx.recipientVerified || !ctx.directionVerified) {
                riskPassed = false;
                riskReason = 'Incomplete verification preconditions.';
            }

            if (!riskPassed) {
                this.fail(`Risk check failed: ${riskReason}`);
                throw new Error(`Risk check rejected transaction: ${riskReason}`);
            }

            this.context.riskCheckPassed = true;
            this._transition(STATES.RISK_CHECK);
            return this.getContext();
        }

        /**
         * 7. Prepare for User Confirmation
         */
        requestUserConfirmation() {
            if (this.state !== STATES.RISK_CHECK) {
                throw new Error(`Cannot request user confirmation in state '${this.state}'`);
            }

            this._transition(STATES.USER_CONFIRMATION);
            this.emit('confirmationRequested', this.getContext());
            return this.getContext();
        }

        /**
         * 8. Confirm by User -> Starts Undo Window
         */
        confirmByUser() {
            if (this.state === STATES.UNDO_WINDOW || this._executionLock) {
                console.warn('[TransactionStateMachine] Duplicate confirmation ignored due to active undo window / execution lock.');
                return this.getContext();
            }

            if (this.state !== STATES.USER_CONFIRMATION) {
                throw new Error(`User confirmation cannot be given in state '${this.state}'`);
            }

            this._executionLock = true;
            this.context.userConfirmed = true;

            this._transition(STATES.UNDO_WINDOW);
            this.emit('undoStarted', {
                durationMs: this.options.undoDurationMs,
                context: this.getContext()
            });

            // Start 3-second undo countdown timer
            if (this._undoTimer) {
                clearTimeout(this._undoTimer);
            }

            this._undoTimer = setTimeout(() => {
                this._undoTimer = null;
                this._onUndoWindowExpired();
            }, this.options.undoDurationMs);

            return this.getContext();
        }

        /**
         * Cancel / Undo during Undo Window or anytime prior to initiation
         */
        cancel(reason = 'User cancelled transaction') {
            if (this._isTerminal(this.state)) {
                console.warn(`[TransactionStateMachine] Cannot cancel terminal transaction (${this.state})`);
                return this.getContext();
            }

            if (this.state === STATES.PAYMENT_INITIATED || this.state === STATES.RESULT_VERIFICATION) {
                throw new Error(`Cannot cancel transaction after payment has been initiated (${this.state})`);
            }

            if (this._undoTimer) {
                clearTimeout(this._undoTimer);
                this._undoTimer = null;
            }

            this._executionLock = false;
            if (this.context) {
                this.context.error = reason;
            }

            this._transition(STATES.CANCELLED, { cancelReason: reason });
            this.emit('cancelled', {
                reason,
                context: this.getContext()
            });

            return this.getContext();
        }

        /**
         * Internal: Undo window elapsed -> Move to SECURE_AUTHENTICATION
         */
        _onUndoWindowExpired() {
            if (this.state !== STATES.UNDO_WINDOW) return;

            this.context.undoCompleted = true;
            this._transition(STATES.SECURE_AUTHENTICATION);
            this.emit('authenticationRequired', this.getContext());
        }

        /**
         * 9. Authenticate Transaction (Callback from PIN / Auth module)
         */
        authenticateTransaction(authResult = {}) {
            if (this.state !== STATES.SECURE_AUTHENTICATION) {
                throw new Error(`Cannot authenticate transaction in state '${this.state}'`);
            }

            if (!authResult.success) {
                const failMsg = authResult.reason || 'Authentication failed';
                this.fail(failMsg);
                throw new Error(failMsg);
            }

            this.context.authenticationCompleted = true;
            this.emit('authenticated', this.getContext());

            // Advance to payment initiation
            return this.initiatePayment();
        }

        /**
         * 10. Initiate Payment (Authority to dispatch bank settlement)
         */
        initiatePayment() {
            if (this.state !== STATES.SECURE_AUTHENTICATION) {
                throw new Error(`Cannot initiate payment directly from state '${this.state}'. Authentication required.`);
            }

            if (!this.context.userConfirmed || !this.context.undoCompleted || !this.context.authenticationCompleted) {
                throw new Error('Safety invariants violated: Confirmation, Undo Window, and Authentication are mandatory.');
            }

            this._transition(STATES.PAYMENT_INITIATED);
            this.emit('paymentInitiated', this.getContext());

            return this.getContext();
        }

        /**
         * 11. Move to Result Verification
         */
        beginResultVerification() {
            if (this.state !== STATES.PAYMENT_INITIATED) {
                throw new Error(`Cannot begin result verification in state '${this.state}'`);
            }

            this._transition(STATES.RESULT_VERIFICATION);
            return this.getContext();
        }

        /**
         * 12. Finalize Result (SUCCESS, FAILED, PENDING, UNKNOWN)
         */
        finalizeResult(resultType, { utr = null, message = '' } = {}) {
            if (this.state !== STATES.RESULT_VERIFICATION && this.state !== STATES.PAYMENT_INITIATED) {
                throw new Error(`Cannot finalize result from state '${this.state}'`);
            }

            const validResults = [STATES.SUCCESS, STATES.FAILED, STATES.PENDING, STATES.UNKNOWN];
            if (!validResults.includes(resultType)) {
                throw new Error(`Invalid final result type: '${resultType}'`);
            }

            if (this.state === STATES.PAYMENT_INITIATED) {
                this.beginResultVerification();
            }

            this._executionLock = false;
            this.context.utr = utr;
            this.context.resultMessage = message;

            this._transition(resultType, { utr, resultMessage: message });
            this.emit('result', {
                status: resultType,
                utr,
                message,
                context: this.getContext()
            });

            return this.getContext();
        }

        /**
         * Mark transaction as FAILED from any non-terminal state
         */
        fail(reason = 'Transaction failed') {
            if (this._isTerminal(this.state)) {
                return this.getContext();
            }

            if (this._undoTimer) {
                clearTimeout(this._undoTimer);
                this._undoTimer = null;
            }

            this._executionLock = false;
            if (this.context) {
                this.context.error = reason;
            }

            this._transition(STATES.FAILED, { error: reason });
            this.emit('failed', {
                reason,
                context: this.getContext()
            });

            return this.getContext();
        }

        /**
         * Reset state machine back to IDLE
         */
        reset() {
            if (this._undoTimer) {
                clearTimeout(this._undoTimer);
                this._undoTimer = null;
            }
            this._executionLock = false;
            this.state = STATES.IDLE;
            this.context = null;
            this.emit('reset');
        }

        _isTerminal(state) {
            return [STATES.SUCCESS, STATES.FAILED, STATES.PENDING, STATES.UNKNOWN, STATES.CANCELLED].includes(state);
        }
    }

    // Export Singleton instance & Class
    const instance = new TransactionStateMachine();
    instance.TransactionStateMachine = TransactionStateMachine;
    instance.STATES = STATES;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = instance;
    } else {
        global.TransactionStateMachine = instance;
    }

})(typeof window !== 'undefined' ? window : global);
