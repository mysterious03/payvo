// transactions.js - Persistent Ledger & Balance State Manager for VoxPay
(function (global) {
    'use strict';

    const BALANCE_KEY = 'swiftpass_balance';
    const TRANSACTIONS_KEY = 'swiftpass_transactions';
    const DEFAULT_BALANCE = 1550.00;

    const DEFAULT_TRANSACTIONS = [
        {
            id: 'TXN_001',
            title: 'FreshMart Supermarket',
            upiId: 'freshmart@icici',
            amount: '499.00',
            type: 'debit',
            time: 'Today, 10:24 AM',
            icon: '🛒'
        },
        {
            id: 'TXN_002',
            title: 'Salary Credit - TechCorp',
            upiId: 'corp@hdfc',
            amount: '75000.00',
            type: 'credit',
            time: 'Yesterday, 6:00 PM',
            icon: '💼'
        },
        {
            id: 'TXN_003',
            title: 'Ramesh Kumar',
            upiId: 'ramesh@upi',
            amount: '250.00',
            type: 'debit',
            time: '2 Sep, 2:15 PM',
            icon: '👤'
        }
    ];

    global.getBalance = function () {
        try {
            const val = localStorage.getItem(BALANCE_KEY);
            if (val !== null && !isNaN(parseFloat(val))) {
                return parseFloat(val);
            }
        } catch (e) {}
        return DEFAULT_BALANCE;
    };

    global.setBalance = function (amount) {
        const num = parseFloat(amount);
        if (!isNaN(num)) {
            try {
                localStorage.setItem(BALANCE_KEY, num.toFixed(2));
            } catch (e) {}
            global.refreshBalanceUI();
        }
    };

    global.deductBalance = function (amount) {
        const num = parseFloat(amount);
        const current = global.getBalance();
        if (isNaN(num) || num <= 0) {
            return { success: false, reason: 'INVALID_AMOUNT' };
        }
        if (current < num) {
            return { success: false, reason: 'INSUFFICIENT_FUNDS' };
        }
        const newBal = parseFloat((current - num).toFixed(2));
        global.setBalance(newBal);
        return { success: true, newBalance: newBal };
    };

    global.addBalance = function (amount) {
        const num = parseFloat(amount);
        if (!isNaN(num) && num > 0) {
            const newBal = parseFloat((global.getBalance() + num).toFixed(2));
            global.setBalance(newBal);
            return { success: true, newBalance: newBal };
        }
        return { success: false };
    };

    global.refreshBalanceUI = function () {
        const bal = global.getBalance();
        const whole = Math.floor(bal);
        const decimals = (bal % 1).toFixed(2).substring(1);

        const balEl = document.querySelector('.wallet-balance');
        if (balEl) {
            balEl.innerHTML = `₹${whole.toLocaleString('en-IN')}<span class="decimals">${decimals}</span>`;
        }

        const availEl = document.querySelector('.balance-avail');
        if (availEl) {
            availEl.textContent = `Available: ₹${bal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        }
    };

    global.getTransactions = function () {
        try {
            const data = localStorage.getItem(TRANSACTIONS_KEY);
            if (data) {
                return JSON.parse(data);
            }
        } catch (e) {}
        return DEFAULT_TRANSACTIONS;
    };

    global.saveTransaction = function (merchantName, upiId, amount, type = 'debit') {
        const txs = global.getTransactions();
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const utr = '4247' + Math.floor(10000000 + Math.random() * 90000000);

        const newTx = {
            id: 'TXN_' + Date.now(),
            utr,
            title: merchantName || 'Payment',
            upiId: upiId || 'upi@id',
            amount: parseFloat(amount).toFixed(2),
            type: type,
            time: `Today, ${timeStr}`,
            icon: type === 'credit' ? '💰' : '💳'
        };

        txs.unshift(newTx);
        try {
            localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(txs.slice(0, 30)));
        } catch (e) {}

        global.renderTransactions();
        return utr;
    };

    global.renderTransactions = function () {
        const listEl = document.getElementById('transactions-list');
        if (!listEl) return;

        const txs = global.getTransactions();
        listEl.innerHTML = '';

        txs.slice(0, 6).forEach(tx => {
            const li = document.createElement('li');
            li.className = 'tx-item';
            const isCredit = tx.type === 'credit';
            const sign = isCredit ? '+' : '-';
            const amtClass = isCredit ? 'credit' : 'debit';

            li.innerHTML = `
                <div class="tx-left">
                    <div class="tx-icon">${tx.icon || (isCredit ? '💰' : '💳')}</div>
                    <div>
                        <p class="tx-title">${tx.title}</p>
                        <p class="tx-time">${tx.time} • ${tx.upiId}</p>
                    </div>
                </div>
                <div class="tx-amount ${amtClass}">${sign}₹${parseFloat(tx.amount).toLocaleString('en-IN')}</div>
            `;
            listEl.appendChild(li);
        });
    };

    // Auto initialize on load
    if (typeof window !== 'undefined') {
        window.addEventListener('DOMContentLoaded', () => {
            global.refreshBalanceUI();
            global.renderTransactions();
        });
    }

})(typeof window !== 'undefined' ? window : global);
