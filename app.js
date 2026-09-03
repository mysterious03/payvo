// app.js - Main Application State and Screen Routing

const screens = document.querySelectorAll('.screen');
const mainNav = document.getElementById('main-nav');
const navItems = document.querySelectorAll('#main-nav .nav-item[data-target]');

// Define which screens should show the bottom navigation bar
const rootScreens = ['home-screen', 'cards-screen', 'transfers-screen', 'profile-screen'];

// Global Session state for passing mock payment info between files
window.paymentSession = {
    merchantName: '',
    upiId: '',
    amount: ''
};

// Simple Router logic
function showScreen(id) {
    // 1. Hide all screens, show target
    screens.forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');

    // 2. Handle Bottom Nav Visibility
    if (rootScreens.includes(id)) {
        mainNav.style.display = 'flex';

        // Update active class on nav buttons
        navItems.forEach(item => {
            if (item.dataset.target === id) {
                item.classList.add('active');
                item.classList.remove('text-muted');
                // Ensure SVG inherits color correctly, hack for Home icon
                if (id === 'home-screen') {
                    item.querySelector('svg').setAttribute('fill', 'currentColor');
                }
            } else {
                item.classList.remove('active');
                item.classList.add('text-muted');
                // Ensure SVG inherits color correctly, hack for Home icon
                if (item.dataset.target === 'home-screen') {
                    item.querySelector('svg').setAttribute('fill', 'none');
                    item.querySelector('svg').setAttribute('stroke', 'currentColor');
                    item.querySelector('svg').setAttribute('stroke-width', '2');
                }
            }
        });

    } else {
        // Child screens (scan, pay, success) hide the nav
        mainNav.style.display = 'none';
    }

    // 3. Special handling when reaching home
    if (id === 'home-screen') {
        if (typeof renderTransactions === 'function') {
            renderTransactions();
        }
    }
}

// Set up UI Event Listeners on Load
document.addEventListener('DOMContentLoaded', () => {

    // Initial Render — pull balance and transactions from localStorage
    if (typeof renderTransactions === 'function') {
        renderTransactions();
    }
    if (typeof window.refreshBalanceUI === 'function') {
        window.refreshBalanceUI();
    }

    // ========== NAVIGATION WIRING ==========

    // Global Back Button class
    document.querySelectorAll('.back-to-home').forEach(btn => {
        btn.addEventListener('click', () => showScreen('home-screen'));
    });

    // Bottom Nav Links
    navItems.forEach(item => {
        item.addEventListener('click', () => showScreen(item.dataset.target));
    });

    // Top Profile Header logic
    document.getElementById('btn-profile')?.addEventListener('click', () => showScreen('profile-screen'));

    // Wallet Buttons
    document.getElementById('btn-load-money')?.addEventListener('click', () => showScreen('load-screen'));
    document.getElementById('btn-bank-transfer')?.addEventListener('click', () => showScreen('transfers-screen'));

    // Quick Services Buttons
    document.getElementById('btn-service-contact')?.addEventListener('click', () => showScreen('transfers-screen'));
    document.getElementById('btn-service-self')?.addEventListener('click', () => showScreen('transfers-screen'));
    document.getElementById('btn-invite')?.addEventListener('click', () => showScreen('invite-screen'));

    // My QR Code Screen Trigger
    const routeToMyQR = () => {
        showScreen('receive-screen');
        if (typeof myQREngine !== 'undefined' && myQREngine.renderQR) {
            myQREngine.renderQR();
        }
    };
    document.getElementById('btn-service-myqr')?.addEventListener('click', routeToMyQR);

    // Update Custom QR Amount Button
    document.getElementById('btn-set-qr-amount')?.addEventListener('click', () => {
        const amt = document.getElementById('qr-custom-amount')?.value;
        if (typeof myQREngine !== 'undefined' && myQREngine.renderQR) {
            myQREngine.renderQR(amt);
        }
        if (window.speak) {
            window.speak(amt ? `Updated QR code to request ${amt} rupees.` : "Updated QR code for open amount.");
        }
    });

    // ========== SCANNER WIRING ==========
    const routeToScanner = () => {
        showScreen('scan-screen');
        if (window.startScanner) window.startScanner();
    };

    document.getElementById('nav-scan')?.addEventListener('click', routeToScanner);
    document.getElementById('btn-service-scan')?.addEventListener('click', routeToScanner);

    // ========== LOAD MONEY WIRING ==========
    const refreshLoadScreenUI = () => {
        const balEl = document.getElementById('load-current-balance');
        if (balEl && typeof window.getBalance === 'function') {
            balEl.textContent = `₹${window.getBalance().toLocaleString('en-IN')}`;
        }
    };

    document.getElementById('btn-load-money')?.addEventListener('click', () => {
        showScreen('load-screen');
        refreshLoadScreenUI();
    });

    // Quick Amount Chips for Add Funds
    document.querySelectorAll('.quick-amount-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const add = parseInt(btn.dataset.amount || '0', 10);
            const input = document.getElementById('load-amount');
            if (input) {
                const current = parseInt(input.value || '0', 10);
                input.value = current + add;
            }
        });
    });

    // Confirm Add Funds
    document.getElementById('btn-load-confirm')?.addEventListener('click', () => {
        const input = document.getElementById('load-amount');
        const amount = parseFloat(input?.value || '0');
        if (!amount || amount <= 0) {
            alert('Please enter a valid amount to add.');
            return;
        }

        if (typeof mockBank !== 'undefined' && mockBank.topUpWallet) {
            mockBank.topUpWallet(amount);
        }
        if (typeof window.addTransaction === 'function') {
            window.addTransaction({
                title: 'HDFC Bank Top-up',
                subtitle: 'Wallet Load • Immediate',
                amount: amount,
                type: 'credit'
            });
        }
        if (typeof window.refreshBalanceUI === 'function') {
            window.refreshBalanceUI();
        }

        if (input) input.value = '';
        if (window.speak) {
            window.speak(`Successfully added ${amount} rupees to your SwiftPass balance.`);
        }
        showScreen('home-screen');
    });

    // ========== TRANSFERS & QUICK CONTACTS WIRING ==========
    const initQuickContacts = () => {
        const container = document.getElementById('quick-contacts');
        if (!container || container.children.length > 0) return;

        const contacts = [
            { name: 'Ramesh Kumar', upi: 'ramesh@upi', initials: 'RK' },
            { name: 'Priya Sharma', upi: 'priya@okhdfcbank', initials: 'PS' },
            { name: 'FreshMart', upi: 'freshmart@icici', initials: 'FM' },
            { name: 'Store Demo', upi: 'merchant.demo@okaxis', initials: 'SD' }
        ];

        contacts.forEach(c => {
            const chip = document.createElement('div');
            chip.style.cssText = 'display:flex; flex-direction:column; align-items:center; cursor:pointer; min-width:65px;';
            chip.innerHTML = `
                <div style="width:48px; height:48px; border-radius:50%; background:rgba(180,240,86,0.15); border:1px solid #b4f056; color:#b4f056; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:14px; margin-bottom:6px;">${c.initials}</div>
                <span style="font-size:11px; color:#fff; font-weight:600; text-align:center; white-space:nowrap;">${c.name.split(' ')[0]}</span>
            `;
            chip.onclick = () => {
                const upiInput = document.getElementById('pay-upi-id-input');
                if (upiInput) upiInput.value = c.upi;
                const amtInput = document.getElementById('pay-upi-amount');
                if (amtInput) amtInput.focus();
            };
            container.appendChild(chip);
        });
    };

    document.getElementById('btn-bank-transfer')?.addEventListener('click', () => {
        showScreen('transfers-screen');
        initQuickContacts();
    });

    // Pay Phone Button
    document.getElementById('btn-pay-phone')?.addEventListener('click', () => {
        const phone = document.getElementById('pay-phone-input')?.value.trim();
        const amt = parseFloat(document.getElementById('pay-phone-amount')?.value || '0');
        if (!phone || phone.length < 10) {
            alert('Please enter a valid 10-digit mobile number.');
            return;
        }
        if (!amt || amt <= 0) {
            alert('Please enter a valid transfer amount.');
            return;
        }

        // Direct to Payment Flow
        window.paymentSession = {
            merchantName: `Contact (${phone})`,
            upiId: `${phone}@upi`,
            amount: amt.toFixed(2)
        };
        showScreen('payment-screen');
        if (typeof renderPaymentDetails === 'function') {
            renderPaymentDetails();
        }
    });

    // Pay UPI ID Button
    document.getElementById('btn-pay-upi')?.addEventListener('click', () => {
        const upi = document.getElementById('pay-upi-id-input')?.value.trim();
        const amt = parseFloat(document.getElementById('pay-upi-amount')?.value || '0');
        if (!upi || !upi.includes('@')) {
            alert('Please enter a valid UPI ID (e.g. name@bank).');
            return;
        }
        if (!amt || amt <= 0) {
            alert('Please enter a valid transfer amount.');
            return;
        }

        let name = upi.split('@')[0];
        name = name.charAt(0).toUpperCase() + name.slice(1);

        window.paymentSession = {
            merchantName: name,
            upiId: upi,
            amount: amt.toFixed(2)
        };
        showScreen('payment-screen');
        if (typeof renderPaymentDetails === 'function') {
            renderPaymentDetails();
        }
    });

    // ========== PRIVACY VISION CAMERA TRACKER HUD ==========
    const setupPrivacyTrackerHUD = () => {
        let badge = document.getElementById('privacy-live-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'privacy-live-badge';
            badge.style.cssText = `
                position: fixed;
                bottom: 18px;
                right: 18px;
                z-index: 10000;
                background: rgba(10, 15, 26, 0.9);
                border: 1px solid rgba(16, 185, 129, 0.4);
                border-radius: 50px;
                padding: 6px 14px;
                display: flex;
                align-items: center;
                gap: 8px;
                color: #10b981;
                font-size: 11px;
                font-weight: 700;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                backdrop-filter: blur(8px);
                cursor: pointer;
            `;
            badge.title = 'Click to toggle Live Observer Camera Tracker';
            badge.innerHTML = `
                <span style="width:8px; height:8px; border-radius:50%; background:#10b981;"></span>
                <span>🛡️ Privacy Shield: Safe (0 Onlookers)</span>
            `;

            // Toggle camera PIP overlay when clicked
            badge.onclick = () => {
                const canvas = document.getElementById('privacy-debug-canvas');
                if (canvas) {
                    const isVisible = canvas.style.display !== 'none';
                    canvas.style.display = isVisible ? 'none' : 'block';
                    if (!isVisible && typeof privacyVision !== 'undefined' && privacyVision.start) {
                        privacyVision.start({ showDebugCanvas: true });
                    }
                }
            };
            document.body.appendChild(badge);
        }

        // Subscribe to Privacy Vision live status events
        if (typeof privacyVision !== 'undefined' && privacyVision.addListener) {
            privacyVision.addListener((status) => {
                const b = document.getElementById('privacy-live-badge');
                if (!b) return;
                if (status.privacyRisk || status.secondaryPersonDetected || status.personCount > 1) {
                    b.style.borderColor = '#ef4444';
                    b.style.color = '#ef4444';
                    b.innerHTML = `
                        <span style="width:8px; height:8px; border-radius:50%; background:#ef4444; animation:pulse-glow 0.8s infinite;"></span>
                        <span>⚠️ Shoulder Surfer Detected! (${status.personCount} people)</span>
                    `;
                } else {
                    b.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                    b.style.color = '#10b981';
                    b.innerHTML = `
                        <span style="width:8px; height:8px; border-radius:50%; background:#10b981;"></span>
                        <span>🛡️ Privacy Shield: Safe (No onlookers)</span>
                    `;
                }
            });
        }
    };

    setupPrivacyTrackerHUD();

    // Auto-trigger Privacy Vision camera tracker when entering PIN
    const origShowPin = window.showPinScreen;
    window.showPinScreen = function () {
        if (typeof origShowPin === 'function') origShowPin();
        if (typeof privacyVision !== 'undefined' && privacyVision.start) {
            privacyVision.start({ showDebugCanvas: true });
        }
        const canvas = document.getElementById('privacy-debug-canvas');
        if (canvas) canvas.style.display = 'block';
    };

});

