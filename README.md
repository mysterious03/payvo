<div align="center">

  <!-- HERO LOGO & TITLE -->
  <img src="https://img.shields.io/badge/VoxPay-⚡_SwiftPass-10b981?style=for-the-badge&logo=cashapp&logoColor=white" height="40" alt="VoxPay Logo" />
  
  # ⚡ VoxPay (SwiftPass)
  ### *The World's First Accessibility-First, Privacy-Preserving AI Voice UPI Platform*

  <p align="center">
    <b>Empowering visually impaired, motor-disabled, and elderly individuals to make 100% autonomous, safe, and touchless UPI payments.</b>
  </p>

  <!-- BADGES ROW -->
  <p align="center">
    <a href="https://github.com/mysterious03/payvo"><img src="https://img.shields.io/badge/Privacy-100%25_On--Device-10b981?style=flat-square&logo=shield" alt="On-Device Privacy" /></a>
    <a href="https://github.com/mysterious03/payvo"><img src="https://img.shields.io/badge/AI_Biometrics-ECAPA--TDNN-8b5cf6?style=flat-square&logo=soundcharts" alt="Speaker Biometrics" /></a>
    <a href="https://github.com/mysterious03/payvo"><img src="https://img.shields.io/badge/Vision_AI-COCO--SSD_MobileNet-f59e0b?style=flat-square&logo=tensorflow" alt="Privacy Vision" /></a>
    <a href="https://github.com/mysterious03/payvo"><img src="https://img.shields.io/badge/State_Safety-17_State_Machine-3b82f6?style=flat-square&logo=diagram-next" alt="State Machine" /></a>
    <a href="https://github.com/mysterious03/payvo"><img src="https://img.shields.io/badge/Test_Suite-204_Passed-22c55e?style=flat-square&logo=checkmarx" alt="Tests" /></a>
    <a href="https://github.com/mysterious03/payvo"><img src="https://img.shields.io/badge/License-MIT-gray?style=flat-square" alt="License" /></a>
  </p>

  <p align="center">
    <a href="#-quick-demo--how-it-works"><b>⚡ How It Works</b></a> •
    <a href="#-key-features"><b>✨ Features</b></a> •
    <a href="#-why-voxpay"><b>💡 Why VoxPay?</b></a> •
    <a href="#-architecture--safety"><b>🛡️ Safety Architecture</b></a> •
    <a href="#-quick-start"><b>🚀 Quick Start</b></a> •
    <a href="#-project-structure"><b>📁 Project Map</b></a>
  </p>

</div>

---

## 💡 Why VoxPay? (The Problem We Solve)

<table>
  <tr>
    <th width="50%">❌ Traditional UPI Apps (GPay, PhonePe, Paytm)</th>
    <th width="50%">✅ VoxPay (SwiftPass)</th>
  </tr>
  <tr>
    <td>
      <ul>
        <li>Requires precise screen tapping & sight.</li>
        <li>PIN entry is vulnerable to shoulder-surfing in public.</li>
        <li>Complex multi-screen navigation confuses elderly users.</li>
        <li>Accidental touches can cause irreversible transfers.</li>
        <li>Relies heavily on visual confirmation.</li>
      </ul>
    </td>
    <td>
      <ul>
        <li><b>100% Voice-Guided</b> conversational payment flow.</li>
        <li><b>On-Device Computer Vision</b> warns if someone peeks over your shoulder.</li>
        <li><b>Voice Biometrics (ECAPA-TDNN)</b> ensures only the enrolled owner can pay.</li>
        <li><b>3-Second Safety Undo Window</b> allows instant payment cancellation.</li>
        <li><b>Draw-to-PIN & Tactile Gestures</b> for accessible authentication.</li>
      </ul>
    </td>
  </tr>
</table>

---

## ⚡ Quick Demo — How It Works in 4 Steps

<div align="center">

```
  ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
  │  1. Scan / Say  │ ───►  │  2. Identity    │ ───►  │  3. Safety Undo │ ───►  │  4. Draw-to-PIN │
  │ "Pay 500 to     │       │ Real-Time Voice │       │ 3-Second Grace  │       │ Neural Stroke / │
  │  Ravi Stores"   │       │ Biometrics Check│       │ Cancel Window   │       │ Tactile Auth    │
  └─────────────────┘       └─────────────────┘       └─────────────────┘       └─────────────────┘
           │                         │                         │                         │
      🎤 Voice / QR             👤 ECAPA-TDNN             ⏱️ Undo Timer             ✍️ AI Gesture
```

</div>

1. 🗣️ **Say or Scan**: *"Pay 500 rupees to Ramesh"* or point the camera at any merchant UPI QR.
2. 👤 **Speaker Verification**: VoxPay verifies your acoustic vocal profile in milliseconds on-device.
3. 👁️ **Privacy Shield Active**: The front camera monitors for observers and alerts you if anyone looks over your shoulder.
4. 🔒 **Confirm & Authenticate**: Audible audio feedback reads the details, gives a 3-second undo window, and prompts your PIN/Draw gesture.

---

## ✨ Key Features

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <h3>🎙️ 1. Conversational Voice AI</h3>
      <ul>
        <li>Natural speech understanding powered by the <b>Web Speech API</b>.</li>
        <li>Full speech feedback (TTS) with crystal-clear audible step-by-step instructions.</li>
        <li>Complete hands-free navigation for users with motor disabilities.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>👤 2. Voice Biometrics (ECAPA-TDNN)</h3>
      <ul>
        <li><b>Client-Side Deep Learning</b>: 80 Log-Mel filterbanks + MFCC + Attentive Statistical Pooling (ASP).</li>
        <li><b>192-dim Voice Embeddings</b>: Compares acoustic vocal tract resonances against your profile.</li>
        <li><b>Zero Raw Audio Storage</b>: Microphone audio is never stored or transmitted to any server.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>👁️ 3. Anti-Shoulder-Surfing Privacy Vision</h3>
      <ul>
        <li>On-device <b>TensorFlow.js COCO-SSD</b> person detection.</li>
        <li>Geometric proximity & 3-frame persistence filter to detect eavesdroppers.</li>
        <li>Speaks immediate warning: <i>"Warning: Someone may be looking over your shoulder."</i></li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>⚡ 4. Smart QR & Secure UPI Parser</h3>
      <ul>
        <li>Deterministic <code>upi://pay</code> parser with NPCI spec compliance.</li>
        <li><b>Parameter Pollution Immunity</b> (blocks duplicate injection attacks like <code>am=500&am=5000</code>).</li>
        <li>Protects against malicious external redirects and XSS.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>⏱️ 5. Deterministic Safety Engine</h3>
      <ul>
        <li><b>17 Monotonic States</b>: Guarantees no payment executes without full validation.</li>
        <li><b>3-Second Undo Window</b>: Easily cancel any accidental payment before it commits.</li>
        <li><b>Immutable Ledger</b>: Local transaction storage with live balance tracking.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>✍️ 6. Accessible Draw-to-PIN & Tap-to-PIN</h3>
      <ul>
        <li>Neural stroke classifier lets users draw gestures anywhere on screen to enter their PIN.</li>
        <li>High-contrast tactile numpad with screen-reader friendly <code>aria-live</code> feedback.</li>
      </ul>
    </td>
  </tr>
</table>

---

## 🛡️ Architecture & Safety

<details>
<summary><b>🔍 Click to Expand Technical Architecture Diagram</b></summary>

```
CAMERA HARDWARE                        MICROPHONE HARDWARE
      │                                         │
      ▼                                         ▼
CameraManager (Shared Stream)            Web Speech API + VAD
  ├── Privacy Vision (COCO-SSD)            ├── Voice Commands Router
  └── QR Scanner (jsQR / Barcode)          └── ECAPA-TDNN Speaker Verification
      │                                         │
      └──────────────────┬──────────────────────┘
                         │
                         ▼
             Smart QR & Intent Validator
                         │
                         ▼
         Deterministic Transaction State Machine
     ┌───────────────────────────────────────────────┐
     │ IDLE                                          │
     │   └─► INTENT_RECEIVED                         │
     │         └─► RECIPIENT_RESOLVED                │
     │               └─► AMOUNT_RESOLVED             │
     │                     └─► RISK_CHECK            │
     │                           └─► USER_CONFIRM    │
     │                                 └─► UNDO (3s) │
     │                                       └─► PIN │
     │                                            │  │
     │                                         SUCCESS
     └───────────────────────────────────────────────┘
```
</details>

---

## 🧪 Rigorous Automated Testing (204 Tests)

VoxPay is built with production-grade deterministic reliability. Every layer is covered by standalone unit and calibration test suites:

```bash
# Run all test suites in one command
node test_smart_qr_parser.js ; node test_speaker_verification.js ; node test_privacy_vision.js ; node test_pin.js ; node test_state_machine.js
```

| Test Suite | Focus Area | Assertions | Result |
| :--- | :--- | :---: | :---: |
| **`test_smart_qr_parser.js`** | URI parsing, parameter pollution, XSS, amount bounds | **88** | <span style="color:#22c55e;">**100% PASS**</span> |
| **`test_speaker_verification.js`** | ECAPA-TDNN biometrics, VAD, noise SNR, retry limits | **47** | <span style="color:#22c55e;">**100% PASS**</span> |
| **`test_privacy_vision.js`** | COCO-SSD detection, observer heuristics, frame persistence | **23** | <span style="color:#22c55e;">**100% PASS**</span> |
| **`test_pin.js`** | Neural gesture classifier & PIN state transitions | **12** | <span style="color:#22c55e;">**100% PASS**</span> |
| **`test_state_machine.js`** | 17-state monotonic lifecycle, undo window, tamper resistance | **34** | <span style="color:#22c55e;">**100% PASS**</span> |
| **TOTAL** | **Full System Coverage** | **204** | <span style="color:#22c55e;">**100% PASS**</span> |

---

## 🚀 Quick Start & Local Setup

Get VoxPay running on your machine in under 60 seconds:

```bash
# 1. Clone the repository
git clone https://github.com/mysterious03/payvo.git
cd payvo

# 2. Run the test suite to verify everything is solid
node test_smart_qr_parser.js

# 3. Start a local server (using Python or Node)
npx serve .
# Or: python -m http.server 8000
```

> **Note**: Open `http://localhost:8000` in Google Chrome, Edge, or Safari. When prompted, allow **Camera** and **Microphone** permissions for the AI features to activate!

---

## 📁 Project Map

```text
payvo/
│
├── 🎨 User Interface & Styling
│   ├── index.html                   # Semantic HTML5 single-page application & HUD
│   ├── style.css                    # Futuristic high-contrast dark theme & animations
│   └── app.js                       # Master UI controller and screen routing
│
├── 🧠 AI & Biometrics Layer
│   ├── speaker-verification.js      # ECAPA-TDNN voice identity & VAD feature extractor
│   ├── privacy-vision.js            # TensorFlow.js COCO-SSD shoulder-surfing detector
│   ├── camera-manager.js            # Unified camera stream hardware manager
│   └── pin.js                       # Draw-to-PIN neural gesture recognizer
│
├── 🛡️ Financial Safety & Payments
│   ├── transaction-state-machine.js # Deterministic 17-state payment lifecycle engine
│   ├── smart-qr-parser.js           # Deterministic UPI URI & QR security parser
│   ├── qr-scanner.js                # Camera QR scanning & image upload decoder
│   ├── payment.js                   # Payment screen controller & voice amount flow
│   ├── upi.js                       # Contact carousel & phone/UPI ID transfer logic
│   └── transactions.js              # Immutable local ledger & live balance store
│
└── 🧪 Automated Test Suites
    ├── test_smart_qr_parser.js      # 88 QR security & parsing assertions
    ├── test_speaker_verification.js  # 47 voice biometrics & SNR assertions
    ├── test_privacy_vision.js        # 23 observer detection assertions
    ├── test_pin.js                  # 12 gesture classifier assertions
    └── test_state_machine.js         # 34 financial safety assertions
```

---

## 🌟 Technology Stack

<p align="center">
  <img src="https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/TensorFlow.js-4.22.0-FF6F00?style=for-the-badge&logo=tensorflow&logoColor=white" />
  <img src="https://img.shields.io/badge/Web_Speech_API-Voice_First-4285F4?style=for-the-badge&logo=google&logoColor=white" />
  <img src="https://img.shields.io/badge/HTML5-Semantic-E34F26?style=for-the-badge&logo=html5&logoColor=white" />
  <img src="https://img.shields.io/badge/CSS3-Modern_Flex/Grid-1572B6?style=for-the-badge&logo=css3&logoColor=white" />
  <img src="https://img.shields.io/badge/Web_Audio_API-DSP_&_FFT-10B981?style=for-the-badge&logo=audio-technica&logoColor=white" />
</p>

---

## 🤝 Contributing & Community

We warmly welcome contributions! Whether it's adding multilingual voice prompts, optimizing neural models, or refining accessibility features:

1. **Fork** the repository
2. **Create** your feature branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your changes (`git commit -m 'feat: Add some AmazingFeature'`)
4. **Push** to the branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

<div align="center">
  <sub>Built with ❤️ for accessible, barrier-free digital financial independence.</sub>
</div>
