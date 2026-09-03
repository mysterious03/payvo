// mock-bank.js
// Mock NPCI Core Banking System (CBS) & UPI Payment Gateway for VoxPay (SwiftPass)
// Simulates real bank accounts, NPCI VPA directory resolution, ledger debits/credits, and 12-digit UTR generation.

(function (global) {
    'use strict';

    // =========================================================================
    // 1. BANK DIRECTORY & ACCOUNTS STORE
    // =========================================================================

    const DEFAULT_ACCOUNTS = {
        'suriya@swiftpass': {
            accountNumber: '10048219033',
            ifsc: 'HDFC0001004',
            name: 'Suriya Prakash',
            phone: '9876501234',
            bankName: 'HDFC Bank',
            vpa: 'suriya@swiftpass',
            balance: 1550.00,
            dailyLimit: 100000.00,
            todaySpent: 0.00,
            status: 'ACTIVE'
        },
        'ramesh@upi': {
            accountNumber: '501002345678',
            ifsc: 'SBIN0000456',
            name: 'Ramesh Kumar',
            phone: '9876543210',
            bankName: 'State Bank of India',
            vpa: 'ramesh@upi',
            balance: 12450.00,
            status: 'ACTIVE'
        },
        'kumar@paytm': {
            accountNumber: '919876543210',
            ifsc: 'PYTM0123456',
            name: 'Kumar Raja',
            phone: '7654321098',
            bankName: 'Paytm Payments Bank',
            vpa: 'kumar@paytm',
            balance: 4500.00,
            status: 'ACTIVE'
        },
        'priya@gpay': {
            accountNumber: '402008765432',
            ifsc: 'HDFC0000240',
            name: 'Priya Sharma',
            phone: '8765432109',
            bankName: 'HDFC Bank',
            vpa: 'priya@gpay',
            balance: 8900.00,
            status: 'ACTIVE'
        },
        'freshmart@icici': {
            accountNumber: '001105009988',
            ifsc: 'ICIC0000011',
            name: 'FreshMart Supermarket',
            phone: '9900112233',
            bankName: 'ICICI Bank',
            vpa: 'freshmart@icici',
            balance: 55200.00,
            status: 'ACTIVE'
        },
        'grocery@upi': {
            accountNumber: '001105009988',
            ifsc: 'ICIC0000011',
            name: 'FreshMart Grocery',
            phone: '9900112233',
            bankName: 'ICICI Bank',
            vpa: 'grocery@upi',
            balance: 55200.00,
            status: 'ACTIVE'
        },
        'merchant.demo@okaxis': {
            accountNumber: '998877665544',
            ifsc: 'UTIB0000999',
            name: 'SwiftPass Demo Store',
            phone: '9811223344',
            bankName: 'Axis Bank',
            vpa: 'merchant.demo@okaxis',
            balance: 18400.00,
            status: 'ACTIVE'
        }
    };

    class MockBank {
        constructor() {
            this.storageKey = 'voxpay_mock_cbs_v1';
            this.ledgerKey = 'voxpay_mock_bank_ledger_v1';
            this._loadAccounts();
        }

        _loadAccounts() {
            try {
                if (typeof localStorage !== 'undefined') {
                    const saved = localStorage.getItem(this.storageKey);
                    if (saved) {
                        this.accounts = JSON.parse(saved);
                        return;
                    }
                }
            } catch (e) {
                console.warn('[MockBank] Local storage load error, using in-memory accounts');
            }
            this.accounts = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
            this._saveAccounts();
        }

        _saveAccounts() {
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(this.storageKey, JSON.stringify(this.accounts));
                }
            } catch (e) {
                console.warn('[MockBank] Local storage save error:', e);
            }
        }

        /**
         * Generate 12-digit standard NPCI UTR (Unique Transaction Reference)
         * Format: YearDigit + JulianDay(3) + Hour(2) + Sequence(6) -> 12 digits
         */
        generateUtr() {
            const now = new Date();
            const yearDigit = String(now.getFullYear()).slice(-1);
            const start = new Date(now.getFullYear(), 0, 0);
            const diff = now - start;
            const oneDay = 1000 * 60 * 60 * 24;
            const julianDay = String(Math.floor(diff / oneDay)).padStart(3, '0');
            const hour = String(now.getHours()).padStart(2, '0');
            const seq = String(Math.floor(100000 + Math.random() * 900000));
            return `${yearDigit}${julianDay}${hour}${seq}`;
        }

        /**
         * Lookup & Verify VPA / UPI ID in the NPCI Directory
         */
        async verifyVpa(vpa) {
            if (!vpa || typeof vpa !== 'string') {
                return { valid: false, reason: 'INVALID_VPA_FORMAT' };
            }
            const cleanVpa = vpa.toLowerCase().trim();

            // Simulate NPCI Directory Lookup delay (80ms)
            await new Promise(r => setTimeout(r, 80));

            const account = this.accounts[cleanVpa];
            if (account) {
                return {
                    valid: true,
                    vpa: account.vpa,
                    name: account.name,
                    bankName: account.bankName,
                    ifsc: account.ifsc,
                    verified: true
                };
            }

            // If unknown, generate synthetic verified account dynamically
            const parts = cleanVpa.split('@');
            if (parts.length === 2 && parts[0].length >= 2 && parts[1].length >= 2) {
                const syntheticName = parts[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return {
                    valid: true,
                    vpa: cleanVpa,
                    name: syntheticName,
                    bankName: parts[1].toUpperCase() + ' Bank',
                    ifsc: parts[1].slice(0, 4).toUpperCase() + '0001234',
                    verified: true
                };
            }

            return { valid: false, reason: 'VPA_NOT_FOUND' };
        }

        /**
         * Get Primary User Balance
         */
        getBalance(vpa = 'suriya@swiftpass') {
            const acc = this.accounts[vpa.toLowerCase()];
            return acc ? acc.balance : 1550.00;
        }

        /**
         * Load Money into Account
         */
        loadMoney(amount, vpa = 'suriya@swiftpass') {
            const num = parseFloat(amount);
            if (isNaN(num) || num <= 0) {
                return { success: false, reason: 'INVALID_AMOUNT' };
            }
            const cleanVpa = vpa.toLowerCase();
            if (!this.accounts[cleanVpa]) {
                this._loadAccounts();
            }
            this.accounts[cleanVpa].balance += num;
            this._saveAccounts();

            const utr = this.generateUtr();
            this._logTransaction({
                utr,
                type: 'CREDIT',
                sender: 'Linked Bank Account',
                recipient: this.accounts[cleanVpa].name,
                vpa: cleanVpa,
                amount: num,
                balanceAfter: this.accounts[cleanVpa].balance,
                status: 'SUCCESS',
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                utr,
                newBalance: this.accounts[cleanVpa].balance
            };
        }

        /**
         * Settle UPI Transfer (Debits Payer, Credits Payee, Logs UTR)
         */
        async processTransfer({ fromVpa = 'suriya@swiftpass', toVpa, amount, note = '', pin = '1234' }) {
            const payerVpa = fromVpa.toLowerCase();
            const payeeVpa = (toVpa || '').toLowerCase();
            const numAmount = parseFloat(amount);

            if (isNaN(numAmount) || numAmount <= 0) {
                return { success: false, reason: 'INVALID_AMOUNT', message: 'Payment amount must be greater than zero.' };
            }

            const payer = this.accounts[payerVpa];
            if (!payer) {
                return { success: false, reason: 'PAYER_ACCOUNT_NOT_FOUND', message: 'Source account not found.' };
            }

            if (payer.balance < numAmount) {
                return {
                    success: false,
                    reason: 'INSUFFICIENT_FUNDS',
                    message: `Insufficient funds. Available: ₹${payer.balance.toFixed(2)}, Requested: ₹${numAmount.toFixed(2)}`
                };
            }

            if (payer.todaySpent + numAmount > payer.dailyLimit) {
                return {
                    success: false,
                    reason: 'DAILY_LIMIT_EXCEEDED',
                    message: `Daily transaction limit of ₹${payer.dailyLimit.toLocaleString('en-IN')} exceeded.`
                };
            }

            // Simulate banking network settlement (150ms)
            await new Promise(r => setTimeout(r, 150));

            // Execute Debit
            payer.balance = parseFloat((payer.balance - numAmount).toFixed(2));
            payer.todaySpent = parseFloat((payer.todaySpent + numAmount).toFixed(2));

            // Execute Credit if payee in database
            if (this.accounts[payeeVpa]) {
                this.accounts[payeeVpa].balance = parseFloat((this.accounts[payeeVpa].balance + numAmount).toFixed(2));
            }

            this._saveAccounts();

            const utr = this.generateUtr();
            const payeeInfo = await this.verifyVpa(payeeVpa);

            const txRecord = {
                utr,
                type: 'DEBIT',
                direction: 'SEND',
                sender: payer.name,
                senderVpa: payerVpa,
                recipient: payeeInfo.name || 'Merchant',
                recipientVpa: payeeVpa,
                amount: numAmount,
                currency: 'INR',
                note: note || 'UPI Payment',
                balanceAfter: payer.balance,
                status: 'SUCCESS',
                timestamp: new Date().toISOString()
            };

            this._logTransaction(txRecord);

            return {
                success: true,
                utr,
                transactionId: 'TXN_' + Date.now(),
                amount: numAmount,
                recipient: payeeInfo.name,
                recipientVpa: payeeVpa,
                newBalance: payer.balance,
                timestamp: txRecord.timestamp,
                status: 'SUCCESS'
            };
        }

        _logTransaction(tx) {
            try {
                if (typeof localStorage !== 'undefined') {
                    let history = [];
                    const existing = localStorage.getItem(this.ledgerKey);
                    if (existing) {
                        try { history = JSON.parse(existing); } catch(e) {}
                    }
                    history.unshift(tx);
                    if (history.length > 50) history = history.slice(0, 50);
                    localStorage.setItem(this.ledgerKey, JSON.stringify(history));
                }
            } catch (e) {
                console.warn('[MockBank] Error writing to ledger:', e);
            }
        }

        getLedger() {
            try {
                if (typeof localStorage !== 'undefined') {
                    const existing = localStorage.getItem(this.ledgerKey);
                    if (existing) return JSON.parse(existing);
                }
            } catch (e) {}
            return [];
        }
    }

    // Export singleton
    const mockBankInstance = new MockBank();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { MockBank, mockBank: mockBankInstance };
    } else {
        global.MockBank = mockBankInstance;
        global.mockBank = mockBankInstance;
    }

})(typeof window !== 'undefined' ? window : global);
