<div align="center">

# ⚡ VoxPay (SwiftPass)
### *Next-Generation Accessibility-First & Privacy-Preserving UPI Platform*

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg?style=for-the-badge&logo=github)](https://github.com/mysterious03/payvo)
[![Privacy First](https://img.shields.io/badge/Privacy-100%25%20On--Device-10b981.svg?style=for-the-badge&logo=shield)](https://github.com/mysterious03/payvo)
[![Deterministic Engine](https://img.shields.io/badge/State%20Machine-17%20States-blueviolet.svg?style=for-the-badge)](https://github.com/mysterious03/payvo)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

<p align="center">
  <b>Empowering visually impaired, motor-disabled, and elderly users with a truly autonomous, secure, and intuitive UPI payment experience.</b><br>
  <i>Zero touch required. Zero cloud exposure. Uncompromised financial safety.</i>
</p>

---

</div>

## 🌟 Executive Summary

**VoxPay** (formerly SwiftPass) is an accessibility-first Progressive Web Application (PWA) re-imagining Unified Payments Interface (UPI) interactions. Traditional financial applications depend heavily on visual acuity, fine motor precision, and vulnerable PIN entry in public spaces. VoxPay solves this through a synergy of **deterministic state safety**, **on-device computer vision**, **voice biometrics**, and **accessible multimodal interfaces**.

---

## 🏛️ System Architecture

```text
                               ┌──────────────────────────────────────────────┐
                               │             Hardware Input Layers            │
                               │  [Camera Stream]        [Microphone Stream]  │
                               └───────┬───────────────────────────┬──────────┘
                                       │                           │
                                       ▼                           ▼
                        ┌──────────────────────────────┐  ┌──────────────────────────────┐
                        │        CameraManager         │  │    Web Speech API + TTS      │
                        │   (Unified Resource Pool)    │  │  (Conversational Guidance)   │
                        └───────┬──────────────┬───────┘  └──────────────┬───────────────┘
                                │              │                         │
                 ┌──────────────┘              └──────────────┐          │
                 ▼                                            ▼          ▼
  ┌──────────────────────────────┐             ┌──────────────────────────────┐
  │   On-Device Privacy Vision   │             │   Authorized-Speaker Layer   │
  │     (COCO-SSD MobileNet)     │             │    (ECAPA-TDNN Biometrics)   │
  │  • Observer Bounding Boxes   │             │  • 80 Log-Mel + MFCC + TDNN  │
  │  • Spatial Proximity Filters │             │  • VAD & SNR Quality Gating  │
  │  • Anti-Shoulder-Surfing     │             │  • Zero Raw Audio Storage    │
  └──────────────┬───────────────┘             └──────────────┬───────────────┘
                 │                                            │
                 │     ┌──────────────────────────────┐       │
                 └────►│    Smart QR & URI Parser     │◄──────┘
                       │   (Deterministic Validator)  │
                       │  • Scheme & Payload Gating   │
                       │  • Duplicate Param Immunity  │
                       │  • XSS & URL Neutralization  │
                       └──────────────┬───────────────┘
                                      │
                                      ▼
                       ┌──────────────────────────────┐
                       │  Transaction State Machine   │
                       │     (Deterministic Core)     │
                       │  • 17 Monotonic States       │
                       │  • 3-Second Undo Window      │
                       │  • Draw-to-PIN & Ledger Lock │
                       └──────────────────────────────┘
```

---

## 🚀 Key Feature Pillars

### 1. 🛡️ On-Device Real-Time Privacy Vision (Anti-Shoulder-Surfing)
* **Neural Architecture**: Runs TensorFlow.js COCO-SSD MobileNet-v2 directly in the browser with zero cloud telemetry.
* **Proximity & Geometric Filtering**: Differentiates between the authorized user and secondary observers using bounding box area ($>3.5\%$ frame area), aspect ratio, and Euclidean centroid offsets.
* **Temporal Hysteresis**: 3-frame persistence filter eliminates transient false triggers.
* **Accessible Cues**: Immediate audible speech warnings (`"Warning: Someone may be looking over your shoulder"`) and non-intrusive `aria-live` status regions.
* **Camera Lifecycle**: Built upon `CameraManager` to dynamically share, mute, and release camera tracks without resource contention.

### 2. 👤 Authorized-Speaker Voice Identity Layer (ECAPA-TDNN)
* **Acoustic Front-End**: In-place Radix-2 512-point FFT, Pre-Emphasis ($y[n] = x[n] - 0.97 x[n-1]$), Hamming windowing, and 80 Log-Mel triangular filterbanks (20 Hz–8000 Hz).
* **Deep Embedding Extractor**: 40-channel MFCCs, Multi-scale Dilated Convolutions, Squeeze-and-Excitation (SE) channel attention, and Attentive Statistical Pooling (ASP) outputting a unit L2-normalized 192-dimensional vector.
* **Robust VAD & SNR Gating**: Energy quantile noise floor tracking. Clips under 800ms or $<6.0$ dB SNR are gracefully evaluated as `UNCERTAIN` (`low_audio_quality`), never falsely rejected as impostors.
* **Strict Privacy Guarantee**: Zero raw audio recordings are stored in memory or persistent storage. Profile centroids are stored purely as mathematical biometric vectors.

### 3. ⚡ Smart QR & Secure UPI URI Parser
* **Deterministic Parsing**: Validates NPCI UPI Intent specifications (`upi://pay`) without untrusted regular expressions or AI hallucinations.
* **Parameter Pollution Immunity**: Rejects malicious duplicate critical query parameters (e.g. `am=500&am=5000` or `pa=x@upi&pa=y@upi`).
* **Fixed vs. Open Amount Modes**: Explicitly isolates fixed merchant QR amounts from open-amount dynamic QR codes, preventing silent client-side tampering.
* **XSS & HTML Neutralization**: Strips HTML tags and control sequences, rendering metadata exclusively via secure DOM properties (`textContent`).

### 4. 🔒 Deterministic Transaction Safety Engine
* **17-State Lifecycle State Machine**: Enforces strict linear progression:
  $$\text{IDLE} \to \text{INTENT\_RECEIVED} \to \text{RECIPIENT\_RESOLVED} \to \text{RECIPIENT\_VERIFIED} \to \text{AMOUNT\_RESOLVED} \to \text{PAYMENT\_DIRECTION\_VERIFIED} \to \text{RISK\_CHECK} \to \text{USER\_CONFIRMATION} \to \text{UNDO\_WINDOW} \to \text{SECURE\_AUTHENTICATION} \to \text{PAYMENT\_INITIATED} \to \text{RESULT\_VERIFICATION} \to \text{SUCCESS}$$
* **Fail-Closed Security**: In-flight transactions cannot be mutated or cancelled once authentication passes to `PAYMENT_INITIATED`.
* **3-Second Universal Undo Window**: Provides a dedicated grace period allowing users to cancel unintended payments before ledger commits.

### 5. ✍️ Draw-to-PIN & Accessible Authentication
* **Tactile Stroke Classifier**: Machine learning stroke pattern recognizer enabling users to authenticate by drawing gestures or digits on any touch surface.
* **Accessible Fallbacks**: High-contrast, large-target Tap-to-PIN layout for users with varying mobility profiles.

---

## 📊 Security & Design Invariants

| Security Rule | Guarantee | Enforcement Mechanism |
| :--- | :--- | :--- |
| **No Auto-Payment** | Scanning a QR or matching a voice command **NEVER** directly triggers payment. | Explicit state transition through `USER_CONFIRMATION` + `UNDO_WINDOW` + PIN. |
| **No Raw Audio Storage** | Microphone buffers are transiently analyzed in memory and immediately discarded. | `SpeakerProfileStore` stores only 192-dim L2 unit vectors. |
| **No External Navigation** | QR codes containing `url=https://...` cannot trigger browser redirects. | Parameter extracted purely as diagnostic warning; navigation is strictly blocked. |
| **Fail-Closed Verification**| Unenrolled users or degraded signals cannot silently authorize transactions. | Speaker verification requires $\ge 3$ enrolled samples; un-enrolled states reject sensitive commands. |
| **No Floating-Point Drift**| Transaction amounts are normalized and validated to 2 decimal places ($₹0.01 - ₹1,00,000$). | Fixed string-to-numeric normalization and bounded NPCI limit checks. |

---

## 🧪 Comprehensive Test Suites

VoxPay includes comprehensive standalone verification test suites covering all safety layers:

```bash
# 1. Deterministic Smart QR & URI Security Parser (88 tests)
node test_smart_qr_parser.js

# 2. ECAPA-TDNN Speaker Verification & VAD Suite (47 tests)
node test_speaker_verification.js

# 3. Privacy Vision & Neural Observer Detection Suite (23 tests)
node test_privacy_vision.js

# 4. Neural Draw-to-PIN Classifier Suite
node test_pin.js

# 5. Deterministic Transaction State Machine Suite (34 tests)
node test_state_machine.js
```

### Test Suite Summary
```text
========================================================================
 Test Suite                      Total Assertions   Passed   Status
========================================================================
 test_smart_qr_parser.js                88            88     100% PASS
 test_speaker_verification.js          47            47     100% PASS
 test_privacy_vision.js                23            23     100% PASS
 test_pin.js                           12            12     100% PASS
 test_state_machine.js                 34            34     100% PASS
========================================================================
 TOTAL VERIFIED ASSERTIONS             204           204     100% PASS
========================================================================
```

---

## 🛠️ Local Development & Quick Start

### Prerequisites
* Any modern web browser with Web Audio API, Web Speech API, and WebGL support (Chrome, Edge, Safari, Firefox).
* Node.js (v16+) for running the test runner.

### Running Locally
```bash
# 1. Clone the repository
git clone https://github.com/mysterious03/payvo.git
cd payvo

# 2. Run test suites to verify integrity
node test_smart_qr_parser.js
node test_state_machine.js

# 3. Launch with any static web server
npx serve .
# Or using Python 3
python -m http.server 8000
```
4. Open `http://localhost:8000` or `http://localhost:3000` in your browser.
5. Grant camera and microphone permissions when prompted to enable voice assistant and QR scanning features.

---

## 📁 Repository Structure

```text
payvo/
├── index.html                   # Core semantic PWA document & HUD
├── style.css                    # Futuristic dark aesthetic & high-contrast tokens
├── app.js                       # Primary UI router & screen controller
├── camera-manager.js            # Unified camera stream hardware manager
├── privacy-vision.js            # Real-time on-device COCO-SSD privacy detector
├── smart-qr-parser.js           # Deterministic UPI URI & QR security validator
├── qr-scanner.js                # Optical QR scanner & barcode integration
├── speaker-verification.js      # Client-side ECAPA-TDNN voice biometrics
├── voice.js                     # Speech recognition & conversational TTS engine
├── pin.js                       # Draw-to-PIN & Tap-to-PIN authentication engine
├── payment.js                   # Payment screen lifecycle & session controller
├── upi.js                       # Contact directory & phone/UPI ID transfer flows
├── transactions.js              # Immutable local transaction ledger & balance store
├── transaction-state-machine.js # Deterministic 17-state transaction safety engine
└── test_*.js                    # Unit, regression, and security calibration suites
```

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
Distributed freely to advance accessibility and privacy in digital financial infrastructure.
