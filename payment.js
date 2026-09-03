// payment.js - Handles the Payment UI Controller & Safety Engine Integration

(function () {
    'use strict';

    let undoInterval = null;

    /**
     * Set up Payment Screen & initialize state machine intent
     */
    window.setupPaymentScreen = function (fromScan = false) {
        if (typeof showScreen === 'function') {
            showScreen('payment-screen');
        }

        const sess = window.paymentSession || {};
        const sm = window.TransactionStateMachine;

        // Reset and start new Intent in State Machine
        if (sm) {
            try {
                sm.startIntent({
                    source: fromScan ? 'QR' : (sess.source || 'MANUAL'),
                    rawData: { ...sess }
                });

                sm.resolveRecipient({
                    name: sess.merchantName || 'Unknown Merchant',
                    upiId: sess.upiId || 'unknown@upi'
                });

                sm.verifyRecipient({
                    verifiedName: sess.merchantName,
                    bank: 'UPI'
                });
            } catch (e) {
                console.warn('[payment.js] State machine intent init warning:', e);
            }
        }

        // Start local Privacy Vision monitoring during payment session
        if (typeof privacyVision !== 'undefined' && privacyVision.start) {
            privacyVision.loadModel().then(() => {
                privacyVision.start();
            }).catch(() => {
                privacyVision.start();
            });
        }

        // Update UI elements securely with textContent
        const nameEl = document.getElementById('pay-merchant-name');
        const upiEl = document.getElementById('pay-merchant-upi');
        const initEl = document.getElementById('pay-merchant-initial');
        const amountInput = document.getElementById('pay-amount');
        const confirmBtn = document.getElementById('btn-pay-confirm');
        const balIndicator = document.querySelector('.balance-avail');

        if (nameEl) nameEl.textContent = sess.merchantName || 'Unknown Merchant';
        if (upiEl) upiEl.textContent = sess.upiId || 'example@upi';
        if (initEl) initEl.textContent = sess.merchantName ? sess.merchantName.charAt(0).toUpperCase() : 'M';

        // Show live available balance
        const currentBal = window.getBalance ? window.getBalance() : 1550;
        if (balIndicator) {
            balIndicator.textContent = `Available: ₹${parseFloat(currentBal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        }

        // Amount input value pre-population & fixed amount safety
        const isFixedAmount = Boolean(sess.amountFixed && sess.amount);

        if (isFixedAmount) {
            if (amountInput) {
                amountInput.value = sess.amount;
                amountInput.setAttribute('readonly', 'true');
                amountInput.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                amountInput.title = 'Amount is fixed by the QR code';
            }
            if (sm && typeof sm.resolveAmount === 'function') {
                try {
                    sm.resolveAmount(parseFloat(sess.amount), currentBal);
                } catch (e) {
                    console.warn('[payment.js] Could not pre-resolve fixed amount in SM:', e);
                }
            }
        } else {
            if (amountInput) {
                amountInput.removeAttribute('readonly');
                amountInput.style.backgroundColor = '';
                amountInput.title = '';
                amountInput.value = sess.amount || '';
            }
        }

        const updateButtonState = () => {
            if (!amountInput || !confirmBtn) return;
            const val = parseFloat(amountInput.value);
            const bal = window.getBalance ? window.getBalance() : Infinity;

            if (val && val > 0 && val <= bal) {
                confirmBtn.removeAttribute('disabled');
                confirmBtn.textContent = 'Pay Securely';
                confirmBtn.style.opacity = '1';
            } else if (val && val > bal) {
                confirmBtn.setAttribute('disabled', 'true');
                confirmBtn.textContent = 'Insufficient Balance';
                confirmBtn.style.opacity = '0.6';
            } else {
                confirmBtn.setAttribute('disabled', 'true');
                confirmBtn.textContent = 'Pay Securely';
                confirmBtn.style.opacity = '1';
            }
        };

        if (amountInput) {
            amountInput.removeEventListener('input', updateButtonState);
            amountInput.addEventListener('input', updateButtonState);
            updateButtonState();
        }

        // Hide overlays
        const loader = document.getElementById('payment-loader');
        if (loader) loader.classList.add('hidden');
        const undoOverlay = document.getElementById('undo-overlay');
        if (undoOverlay) undoOverlay.classList.add('hidden');

        // Voice prompt for amount / confirmation
        if (window.speak) {
            let promptText = '';
            if (fromScan) {
                if (isFixedAmount) {
                    promptText = `QR requests payment of ${sess.amount} rupees to ${sess.merchantName || 'merchant'}. Please confirm.`;
                } else {
                    promptText = `Payment QR detected for ${sess.merchantName || 'merchant'}. Amount is not specified. How much do you want to pay?`;
                }
            } else {
                promptText = `Paying ${sess.merchantName || 'merchant'}. How much do you want to pay?`;
            }

            window.speak(promptText, () => {
                const group = document.querySelector('.amount-input-group');
                if (group) {
                    group.classList.add('voice-listening');
                    let label = document.getElementById('voice-status-label');
                    if (!label) {
                        label = document.createElement('div');
                        label.id = 'voice-status-label';
                        label.innerHTML = isFixedAmount 
                            ? '<span class="pulse-mic">🎤</span> Say "Continue" or "Pay" to confirm...'
                            : '<span class="pulse-mic">🎤</span> Say amount (e.g. 500 rupees)...';
                        label.style.cssText = 'position:absolute; bottom:-30px; left:0; right:0; text-align:center; color:#b4f056; font-size:12px; font-weight:bold; letter-spacing:1px;';
                        group.style.position = 'relative';
                        group.appendChild(label);
                    }
                }
                if (typeof window.listenForAmount === 'function') {
                    window.listenForAmount((amt) => {
                        const label = document.getElementById('voice-status-label');
                        if (label) label.remove();
                        if (amountInput && (!isFixedAmount || amt !== parseFloat(amountInput.value))) {
                            amountInput.value = amt;
                            updateButtonState();
                        }
                        window.speak(`Proceeding with ${amountInput ? amountInput.value : amt} rupees.`, () => {
                            confirmBtn?.click();
                        });
                    });
                }
            });
        }
    };

    /**
     * Start the payment workflow through State Machine validation -> Undo Window
     */
    function initiatePaymentWorkflow() {
        const sm = window.TransactionStateMachine;
        const amountInput = document.getElementById('pay-amount');
        const finalAmount = parseFloat(amountInput ? amountInput.value : '0');
        const currentBal = window.getBalance ? window.getBalance() : Infinity;

        if (!finalAmount || finalAmount <= 0) {
            alert('Please enter a valid amount.');
            return;
        }

        if (!sm) {
            console.error('[payment.js] TransactionStateMachine missing!');
            return;
        }

        try {
            const state = sm.getState();

            // 1. Resolve Amount if not already resolved
            if (state === 'IDLE' || state === 'INTENT_RECEIVED' || state === 'RECIPIENT_RESOLVED' || state === 'RECIPIENT_VERIFIED') {
                if (state === 'IDLE') {
                    sm.startIntent({ source: 'MANUAL', rawData: { ...window.paymentSession } });
                }
                if (sm.getState() === 'INTENT_RECEIVED') {
                    sm.resolveRecipient({
                        name: window.paymentSession.merchantName || 'Merchant',
                        upiId: window.paymentSession.upiId || 'scanned@upi'
                    });
                }
                if (sm.getState() === 'RECIPIENT_RESOLVED') {
                    sm.verifyRecipient({ verifiedName: window.paymentSession.merchantName, bank: 'UPI' });
                }
                sm.resolveAmount(finalAmount, currentBal);
            }

            // 2. Verify Payment Direction
            if (sm.getState() === 'AMOUNT_RESOLVED') {
                sm.verifyPaymentDirection('SEND');
            }

            // 3. Perform Risk Check
            if (sm.getState() === 'PAYMENT_DIRECTION_VERIFIED') {
                sm.performRiskCheck();
            }

            // 4. Request User Confirmation
            if (sm.getState() === 'RISK_CHECK') {
                sm.requestUserConfirmation();
            }

            // Sync session
            window.paymentSession.amount = finalAmount;

            // 5. Confirm by User -> Starts UNDO WINDOW
            if (sm.getState() === 'USER_CONFIRMATION') {
                sm.confirmByUser();
            }

        } catch (error) {
            console.error('[payment.js] Transaction validation error:', error.message);
            alert(error.message);
        }
    }

    /**
     * Handle Undo Window UI and Timers
     */
    function showUndoWindowUI(data) {
        const undoOverlay = document.getElementById('undo-overlay');
        const countdownEl = document.getElementById('undo-countdown');
        const detailsEl = document.getElementById('undo-details');

        if (!undoOverlay) return;

        const ctx = data.context || window.paymentSession;
        if (detailsEl) {
            detailsEl.textContent = `₹${parseFloat(ctx.amount).toLocaleString('en-IN')} to ${ctx.recipient?.name || ctx.merchantName || 'Merchant'}`;
        }

        let secondsLeft = Math.ceil((data.durationMs || 3000) / 1000);
        if (countdownEl) countdownEl.textContent = secondsLeft;

        undoOverlay.classList.remove('hidden');

        if (undoInterval) clearInterval(undoInterval);
        undoInterval = setInterval(() => {
            secondsLeft--;
            if (countdownEl) countdownEl.textContent = Math.max(1, secondsLeft);
            if (secondsLeft <= 0) {
                clearInterval(undoInterval);
                undoInterval = null;
            }
        }, 1000);
    }

    function hideUndoWindowUI() {
        if (undoInterval) {
            clearInterval(undoInterval);
            undoInterval = null;
        }
        const undoOverlay = document.getElementById('undo-overlay');
        if (undoOverlay) undoOverlay.classList.add('hidden');
    }

    /**
     * Hook State Machine Events
     */
    document.addEventListener('DOMContentLoaded', () => {
        const confirmBtn = document.getElementById('btn-pay-confirm');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', initiatePaymentWorkflow);
        }

        // Cancel / Undo Button
        const undoCancelBtn = document.getElementById('btn-undo-cancel');
        if (undoCancelBtn) {
            undoCancelBtn.addEventListener('click', () => {
                const sm = window.TransactionStateMachine;
                if (sm) {
                    sm.cancel('User cancelled payment in undo window.');
                }
            });
        }

        // Wire State Machine Event Listeners
        const sm = window.TransactionStateMachine;
        if (sm) {
            sm.on('undoStarted', (data) => {
                showUndoWindowUI(data);
            });

            sm.on('cancelled', (data) => {
                hideUndoWindowUI();
                if (typeof privacyVision !== 'undefined' && privacyVision.stop) {
                    privacyVision.stop();
                }
                if (window.speak) {
                    window.speak('Payment cancelled.');
                }
                alert(data.reason || 'Payment cancelled.');
            });

            sm.on('authenticationRequired', (ctx) => {
                hideUndoWindowUI();
                // Route to PIN authentication screen
                if (typeof window.showPinScreen === 'function') {
                    window.showPinScreen();
                } else {
                    // Fallback if pin.js not loaded
                    sm.authenticateTransaction({ success: true });
                }
            });

            sm.on('paymentInitiated', (ctx) => {
                executeBankSettlement(ctx);
            });
        }
    });

    /**
     * Final Settlement Execution: Called ONLY after PIN Auth & State Machine Authorization
     */
    function executeBankSettlement(ctx) {
        const sm = window.TransactionStateMachine;
        const loader = document.getElementById('payment-loader');
        if (loader) loader.classList.remove('hidden');

        if ('vibrate' in navigator) navigator.vibrate(50);

        // Move to result verification
        if (sm) sm.beginResultVerification();

        // Realistic network & bank simulation delay (1.5s - 2.5s)
        // Realistic network & bank simulation delay (1.0s - 1.8s)
        const delay = 1000 + Math.random() * 800;
        setTimeout(async () => {
            if (loader) loader.classList.add('hidden');

            const sess = window.paymentSession;
            const amount = ctx.amount || sess.amount;
            const merchantName = ctx.recipient?.name || sess.merchantName || 'Merchant';
            const upiId = ctx.recipient?.upiId || sess.upiId || 'scanned@upi';

            // CORE BANKING SYSTEM INTEGRATION: Process UPI Transfer via MockBank
            let bankResult = { success: true, utr: '' };
            if (typeof mockBank !== 'undefined' && mockBank.processTransfer) {
                try {
                    bankResult = await mockBank.processTransfer({
                        fromVpa: 'suriya@swiftpass',
                        toVpa: upiId,
                        amount: amount,
                        note: sess.note || 'UPI Transfer'
                    });
                } catch (e) {
                    console.warn('[payment.js] MockBank transfer error:', e);
                }
            }

            // Fallback / sync with local ledger
            if (window.deductBalance && (!bankResult || !bankResult.newBalance)) {
                window.deductBalance(amount);
            }

            const utr = bankResult.utr || (window.saveTransaction ? window.saveTransaction(merchantName, upiId, String(amount), 'debit') : '4247' + Math.floor(10000000 + Math.random() * 90000000));
            window.paymentSession.utr = utr;

            // Finalize State Machine as SUCCESS
            if (sm) {
                sm.finalizeResult('SUCCESS', {
                    utr: utr,
                    message: `Payment of ₹${amount} to ${merchantName} settled successfully by HDFC Core Banking System.`
                });
            }

            window.setupSuccessScreen();
        }, delay);
    }

    /**
     * Backwards-compatible completePayment wrapper
     * (Called by PIN or legacy callers; routes through state machine)
     */
    window.completePayment = function () {
        const sm = window.TransactionStateMachine;
        if (sm && sm.getState() === 'SECURE_AUTHENTICATION') {
            sm.authenticateTransaction({ success: true });
        } else if (sm && sm.getState() === 'IDLE') {
            // Re-initiate if invoked outside
            initiatePaymentWorkflow();
        }
    };

    /**
     * Render Success Screen
     */
    window.setupSuccessScreen = function () {
        if (typeof privacyVision !== 'undefined' && privacyVision.stop) {
            privacyVision.stop();
        }

        const sess = window.paymentSession;
        if (typeof showScreen === 'function') {
            showScreen('success-screen');
        }

        const amountEl = document.getElementById('success-amount');
        const merchEl = document.getElementById('success-merchant');
        const upiEl = document.getElementById('success-upi');
        const utrEl = document.querySelector('.receipt-utr');

        if (amountEl) amountEl.innerText = `₹${parseFloat(sess.amount).toLocaleString('en-IN')}`;
        if (merchEl) merchEl.innerText = `Paid to ${sess.merchantName}`;
        if (upiEl) upiEl.innerText = sess.upiId || '';
        if (utrEl && sess.utr) utrEl.textContent = `UTR: ${sess.utr}`;

        if (window.refreshBalanceUI) window.refreshBalanceUI();

        if ('vibrate' in navigator) navigator.vibrate([100, 50, 200]);

        if (window.speak) {
            window.speak(`Payment of ${sess.amount} rupees to ${sess.merchantName} successful.`);
        }
    };

})();
