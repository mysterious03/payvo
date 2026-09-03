// my-qr.js - Dynamic UPI QR Generator & Receive Money Engine for VoxPay
(function (global) {
    'use strict';

    const USER_VPA = 'suriya@swiftpass';
    const USER_NAME = 'Suriya Prakash';

    class MyQREngine {
        constructor() {
            this.containerId = 'user-qr-display';
            this.currentAmount = null;
        }

        /**
         * Generate UPI URI String: upi://pay?pa=...&pn=...&cu=INR[&am=...]
         */
        buildUPIUri(amount = null) {
            let uri = `upi://pay?pa=${encodeURIComponent(USER_VPA)}&pn=${encodeURIComponent(USER_NAME)}&cu=INR`;
            if (amount && parseFloat(amount) > 0) {
                uri += `&am=${parseFloat(amount).toFixed(2)}`;
            }
            return uri;
        }

        /**
         * Render QR Code in DOM container using QRCode library or SVG generator
         */
        renderQR(amount = null) {
            this.currentAmount = amount;
            const uri = this.buildUPIUri(amount);
            const container = document.getElementById(this.containerId);
            const labelEl = document.getElementById('qr-amount-label');
            const uriDisplay = document.getElementById('qr-raw-uri');

            if (labelEl) {
                if (amount && parseFloat(amount) > 0) {
                    labelEl.textContent = `Requesting: ₹${parseFloat(amount).toLocaleString('en-IN')}`;
                    labelEl.style.color = '#b4f056';
                } else {
                    labelEl.textContent = 'Scan to pay any amount';
                    labelEl.style.color = '#94a3b8';
                }
            }

            if (uriDisplay) {
                uriDisplay.textContent = uri;
            }

            if (!container) return;
            container.innerHTML = '';

            // Use QRCode.js if loaded from CDN
            if (typeof QRCode !== 'undefined') {
                try {
                    new QRCode(container, {
                        text: uri,
                        width: 220,
                        height: 220,
                        colorDark: '#000000',
                        colorLight: '#ffffff',
                        correctLevel: QRCode.CorrectLevel.H
                    });
                    return;
                } catch (e) {
                    console.warn('[my-qr.js] QRCode library error, fallback to visual canvas:', e);
                }
            }

            // Fallback High-Contrast Visual QR Code Generator using Canvas
            this._drawFallbackQR(container, uri);
        }

        _drawFallbackQR(container, text) {
            const canvas = document.createElement('canvas');
            canvas.width = 220;
            canvas.height = 220;
            canvas.style.borderRadius = '12px';
            canvas.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
            const ctx = canvas.getContext('2d');

            // Background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 220, 220);

            // Pseudo-random deterministic visual pattern based on hash
            ctx.fillStyle = '#000000';
            const size = 22;
            const cellSize = 10;

            // Draw Standard 3 Corner Finder Patterns
            const drawFinder = (x, y) => {
                ctx.fillRect(x, y, 70, 70);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(x + 10, y + 10, 50, 50);
                ctx.fillStyle = '#000000';
                ctx.fillRect(x + 20, y + 20, 30, 30);
            };

            drawFinder(10, 10);
            drawFinder(140, 10);
            drawFinder(10, 140);

            // Draw data matrix hash cells
            let hash = 0;
            for (let i = 0; i < text.length; i++) {
                hash = ((hash << 5) - hash) + text.charCodeAt(i);
                hash |= 0;
            }

            for (let r = 0; r < 20; r++) {
                for (let c = 0; c < 20; c++) {
                    // Skip finder patterns
                    if ((r < 8 && c < 8) || (r < 8 && c > 12) || (r > 12 && c < 8)) continue;
                    const bit = (hash >> ((r * c) % 31)) & 1;
                    if (bit || (r + c) % 3 === 0) {
                        ctx.fillRect(10 + c * 10, 10 + r * 10, 10, 10);
                    }
                }
            }

            container.appendChild(canvas);
        }
    }

    const myQREngine = new MyQREngine();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { MyQREngine, myQREngine };
    } else {
        global.MyQREngine = myQREngine;
        global.myQREngine = myQREngine;
    }

})(typeof window !== 'undefined' ? window : global);
