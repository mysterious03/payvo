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

    // ========== SCANNER WIRING ==========
    const routeToScanner = () => {
        showScreen('scan-screen');
        if (window.startScanner) window.startScanner();
    };

    document.getElementById('nav-scan')?.addEventListener('click', routeToScanner);
    document.getElementById('btn-service-scan')?.addEventListener('click', routeToScanner);

    // ========== SCAN SCREEN BACK BUTTON ==========
    // Stop the camera when leaving the scan screen
    const scanBackBtn = document.getElementById('btn-scan-back');
    if (scanBackBtn) {
        scanBackBtn.addEventListener('click', () => {
            if (typeof window.stopScanner === 'function') window.stopScanner();
            showScreen('home-screen');
        });
    }

    // Also stop camera when going back from payment screen
    const payBackBtn = document.getElementById('btn-pay-back');
    if (payBackBtn) {
        payBackBtn.addEventListener('click', () => {
            if (typeof privacyVision !== 'undefined' && privacyVision.stop) {
                privacyVision.stop();
            }
            const sm = window.TransactionStateMachine;
            if (sm && sm.getState() !== 'IDLE' && sm.getState() !== 'COMPLETED' && sm.getState() !== 'CANCELLED') {
                try { sm.cancel('User left payment screen'); } catch (e) { }
            }
            showScreen('home-screen');
        });
    }

});
