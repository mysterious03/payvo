// ============================================================
//  upi.js  —  SwiftPass UPI Transfer Logic
//  Handles: Pay by Phone, Pay by UPI ID, Load Money forms
// ============================================================

// Mock UPI directory for "verification" feel
const KNOWN_UPI_IDS = {
    'ramesh@upi': { name: 'Ramesh Kumar', bank: 'SBI' },
    'kumar@paytm': { name: 'Kumar Raja', bank: 'Paytm Payments Bank' },
    'grocery@upi': { name: 'FreshMart', bank: 'ICICI' },
    'priya@gpay': { name: 'Priya Sharma', bank: 'Google Pay' },
    'shop@phonepe': { name: 'Surya Stores', bank: 'PhonePe' },
};

const KNOWN_PHONES = {
    '9876543210': { name: 'Ramesh Kumar', upi: 'ramesh@upi' },
    '8765432109': { name: 'Priya Sharma', upi: 'priya@gpay' },
    '7654321098': { name: 'Kumar Raja', upi: 'kumar@paytm' },
};

// Quick contacts to display
const QUICK_CONTACTS = [
    { name: 'Ramesh', upi: 'ramesh@upi', initial: 'R', color: '#a78bfa' },
    { name: 'Priya', upi: 'priya@gpay', initial: 'P', color: '#f472b6' },
    { name: 'Kumar', upi: 'kumar@paytm', initial: 'K', color: '#38bdf8' },
    { name: 'FreshMart', upi: 'grocery@upi', initial: 'F', color: '#34d399' },
];

// ============================================================
//  HELPER: Route to payment screen with session pre-filled
// ============================================================
function routeToPayment(merchantName, upiId, amount, source = 'MANUAL') {
    window.paymentSession = { merchantName, upiId, amount: amount || '', source };
    if (typeof window.setupPaymentScreen === 'function') {
        window.setupPaymentScreen();
    }
}

// ============================================================
//  INIT: Wire up all secondary screens when DOM is ready
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

    // ---------------------------------------------------------
    //  QUICK CONTACTS CAROUSEL
    // ---------------------------------------------------------
    const contactsContainer = document.getElementById('quick-contacts');
    if (contactsContainer) {
        QUICK_CONTACTS.forEach(c => {
            const btn = document.createElement('button');
            btn.style.cssText = `display:flex; flex-direction:column; align-items:center; gap:8px; background:none; border:none; cursor:pointer; flex-shrink:0; min-width:60px;`;
            btn.innerHTML = `
                <div style="width:52px; height:52px; background:${c.color}22; border:1px solid ${c.color}44; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.2rem; font-weight:800; color:${c.color};">${c.initial}</div>
                <span style="font-size:11px; font-weight:600; color:rgba(255,255,255,0.55); white-space:nowrap;">${c.name}</span>
            `;
            btn.addEventListener('click', () => {
                document.getElementById('pay-upi-id-input').value = c.upi;
                document.getElementById('pay-upi-amount').focus();
            });
            contactsContainer.appendChild(btn);
        });
    }

    // ---------------------------------------------------------
    //  PAY BY PHONE
    // ---------------------------------------------------------
    const btnPayPhone = document.getElementById('btn-pay-phone');
    if (btnPayPhone) {
        btnPayPhone.addEventListener('click', () => {
            const phone = (document.getElementById('pay-phone-input')?.value || '').trim();
            const amount = document.getElementById('pay-phone-amount')?.value;

            if (!/^\d{10}$/.test(phone)) {
                alert('Please enter a valid 10-digit mobile number.');
                return;
            }
            if (!amount || parseFloat(amount) <= 0) {
                alert('Please enter a valid amount.');
                return;
            }

            // Check balance
            const bal = window.getBalance ? window.getBalance() : Infinity;
            if (parseFloat(amount) > bal) {
                alert(`Insufficient balance. Available: ₹${bal.toLocaleString('en-IN')}`);
                return;
            }

            const known = KNOWN_PHONES[phone];
            const merchantName = known ? known.name : `UPI User (+91${phone})`;
            const upiId = known ? known.upi : `91${phone}@upi`;

            routeToPayment(merchantName, upiId, amount);
        });
    }

    // ---------------------------------------------------------
    //  PAY BY UPI ID — with "verify" behaviour
    // ---------------------------------------------------------
    const btnPayUpi = document.getElementById('btn-pay-upi');
    if (btnPayUpi) {
        btnPayUpi.addEventListener('click', () => {
            const upiInput = document.getElementById('pay-upi-id-input');
            const upiId = (upiInput?.value || '').trim().toLowerCase();
            const amount = document.getElementById('pay-upi-amount')?.value;

            if (!upiId || !upiId.includes('@')) {
                alert('Please enter a valid UPI ID (e.g. name@upi).');
                return;
            }
            if (!amount || parseFloat(amount) <= 0) {
                alert('Please enter a valid amount.');
                return;
            }

            const bal = window.getBalance ? window.getBalance() : Infinity;
            if (parseFloat(amount) > bal) {
                alert(`Insufficient balance. Available: ₹${bal.toLocaleString('en-IN')}`);
                return;
            }

            // Simulate a quick "verifying UPI ID" step
            btnPayUpi.textContent = 'Verifying…';
            btnPayUpi.style.opacity = '0.6';
            btnPayUpi.disabled = true;

            setTimeout(() => {
                btnPayUpi.textContent = 'Verify & Pay →';
                btnPayUpi.style.opacity = '1';
                btnPayUpi.disabled = false;

                const known = KNOWN_UPI_IDS[upiId];
                const merchantName = known ? known.name : upiId.split('@')[0];

                if (known) {
                    // Show a brief verified message, then navigate
                    upiInput.style.borderBottomColor = '#10b981';
                    upiInput.value = `✓ ${upiId} — ${known.name} (${known.bank})`;
                    setTimeout(() => {
                        upiInput.style.borderBottomColor = '';
                        upiInput.value = upiId;
                        routeToPayment(merchantName, upiId, amount);
                    }, 600);
                } else {
                    routeToPayment(merchantName, upiId, amount);
                }
            }, 900);
        });
    }

    // ---------------------------------------------------------
    //  LOAD MONEY SCREEN  — refresh balance display on open
    // ---------------------------------------------------------
    function refreshLoadScreen() {
        const balEl = document.getElementById('load-current-balance');
        if (balEl && window.getBalance) {
            const b = window.getBalance();
            balEl.textContent = `₹${b.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        }
    }

    // Quick-amount buttons on Load screen
    document.querySelectorAll('.quick-amount-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const loadInput = document.getElementById('load-amount');
            if (loadInput) loadInput.value = btn.dataset.amount;
        });
    });

    // Load Money confirm
    const btnLoadConfirm = document.getElementById('btn-load-confirm');
    if (btnLoadConfirm) {
        btnLoadConfirm.addEventListener('click', () => {
            const amount = parseFloat(document.getElementById('load-amount')?.value);
            if (!amount || amount <= 0) {
                alert('Please enter an amount to add.');
                return;
            }
            if (amount > 100000) {
                alert('Maximum single load limit is ₹1,00,000.');
                return;
            }

            btnLoadConfirm.textContent = 'Processing…';
            btnLoadConfirm.disabled = true;

            // Simulate bank transfer delay
            setTimeout(() => {
                if (window.addBalance) window.addBalance(amount);
                if (window.saveTransaction) {
                    window.saveTransaction('Bank Transfer', 'hdfc@upi', String(amount), 'credit');
                }
                if (window.refreshBalanceUI) window.refreshBalanceUI();
                refreshLoadScreen();

                btnLoadConfirm.textContent = `✓ ₹${amount.toLocaleString('en-IN')} Added!`;
                btnLoadConfirm.style.background = 'rgba(16,185,129,0.25)';
                document.getElementById('load-amount').value = '';

                if (window.speak) window.speak(`${amount} rupees added to your SwiftPass wallet.`);

                setTimeout(() => {
                    btnLoadConfirm.textContent = 'Add Money Now ✓';
                    btnLoadConfirm.style.background = 'rgba(16,185,129,0.12)';
                    btnLoadConfirm.disabled = false;
                }, 2000);
            }, 1200);
        });
    }

    // ---------------------------------------------------------
    //  Service buttons on Home: "Pay Phone" → transfers screen
    // ---------------------------------------------------------
    document.getElementById('btn-service-contact')?.addEventListener('click', () => showScreen('transfers-screen'));
    document.getElementById('btn-service-self')?.addEventListener('click', () => {
        // Self transfer: pre-fill own UPI ID
        showScreen('transfers-screen');
        const upiInput = document.getElementById('pay-upi-id-input');
        if (upiInput) upiInput.value = 'suriya@swiftpass.upi';
    });

    // Refresh balance on load screen whenever it becomes active
    // We do this by patching showScreen in app.js after a short wait
    const _origShowScreen = window.showScreen;
    if (typeof _origShowScreen === 'function') {
        window.showScreen = function (id) {
            _origShowScreen(id);
            if (id === 'load-screen') refreshLoadScreen();
        };
    }
});
