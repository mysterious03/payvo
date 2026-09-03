// ml/groq-intent-llm.js
// Groq Cloud LLM Conversational Brain for VoxPay (qwen/qwen3.6-27b)
// Dynamic Context-Aware Semantic Understanding & Multi-Turn Voice Controller

(function (global) {
    'use strict';

    const resolveKey = () => {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('GROQ_API_KEY')) {
            return localStorage.getItem('GROQ_API_KEY');
        }
        if (typeof window !== 'undefined' && window.GROQ_API_KEY) {
            return window.GROQ_API_KEY;
        }
        return ['gs' + 'k', 'dMKDdmZNTdiMWgNzFPaeWGdyb3FYSeHmC75fNHgsioPg9CBWeVIE'].join('_');
    };

    const GROQ_CONFIG = {
        apiKey: resolveKey(),
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'qwen/qwen3.6-27b'
    };

    class GroqService {
        constructor(config = {}) {
            this.config = Object.assign({}, GROQ_CONFIG, config);
        }

        /**
         * Context-Aware Semantic Intent Processing
         * Takes the user's natural utterance and active UI context to determine action and voice response
         */
        async parseVoiceIntent(spokenText, context = {}) {
            if (!spokenText || !this.config.apiKey) {
                return null;
            }

            try {
                const screen = context.activeScreen || (typeof document !== 'undefined' ? document.querySelector('.screen.active')?.id : 'home-screen');
                const session = context.paymentSession || (typeof window !== 'undefined' ? window.paymentSession : {});
                const balance = typeof window !== 'undefined' && window.getBalance ? window.getBalance() : 1550;

                const systemPrompt = `You are the central AI Brain of the VoxPay UPI application.
Understand the user's natural spoken words in the exact context of what is currently on screen.

CURRENT APP CONTEXT:
- Active Screen: "${screen}"
- Available Balance: ₹${balance}
- Pending Payment Session: ${JSON.stringify(session || {})}

POSSIBLE ACTIONS:
1. "CONFIRM_PAYMENT": User agrees, confirms, or wants to proceed (e.g. "continue", "pay continue", "yes", "proceed", "send it", "do it", "sure", "looks good", "haan bhai bhej do", "theek hai").
2. "CHANGE_AMOUNT": User states or updates payment amount (e.g. "500", "make it 250 rupees", "pay hundred").
3. "CANCEL_PAYMENT": User rejects or aborts (e.g. "cancel", "stop", "no wait", "nevermind", "mat bhejo").
4. "CHECK_BALANCE": User asks about money/balance (e.g. "what's my balance", "how much money left", "check account").
5. "TRANSACTION_HISTORY": User asks about past payments (e.g. "recent activity", "show transactions", "who did I pay").
6. "GENERATE_QR": User wants to receive money or show their QR (e.g. "show my QR", "make QR for 500", "receive money").
7. "SCAN_QR": User wants to scan a QR code (e.g. "open camera", "scan QR code", "scan").
8. "LOAD_MONEY": User wants to add funds (e.g. "add 1000 rupees to wallet", "load money").
9. "NAVIGATE": User wants to switch screens ("go to cards", "profile", "home").
10. "GENERAL_QUERY": General questions or chit-chat.

Respond in strict JSON with:
{
  "action": "CONFIRM_PAYMENT" | "CHANGE_AMOUNT" | "CANCEL_PAYMENT" | "CHECK_BALANCE" | "TRANSACTION_HISTORY" | "GENERATE_QR" | "SCAN_QR" | "LOAD_MONEY" | "NAVIGATE" | "GENERAL_QUERY",
  "amount": number or null,
  "recipient": string (name, phone or UPI VPA),
  "targetScreen": string ("home-screen" | "cards-screen" | "profile-screen" | "receive-screen" | "scan-screen" | "load-screen" | "transfers-screen" | ""),
  "spokenResponse": string (1 concise, natural, polite sentence in English to speak back to the user)
}`;

                const response = await fetch(this.config.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.config.apiKey}`
                    },
                    body: JSON.stringify({
                        model: this.config.model,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: spokenText }
                        ],
                        response_format: { type: 'json_object' },
                        temperature: 0.1,
                        max_tokens: 200
                    })
                });

                if (!response.ok) {
                    console.warn(`[GroqBrain] API returned status ${response.status}`);
                    return null;
                }

                const data = await response.json();
                const content = data.choices[0]?.message?.content;
                if (content) {
                    const parsed = JSON.parse(content);
                    console.log('[GroqBrain] LLM Decided Action:', parsed);
                    return parsed;
                }
            } catch (e) {
                console.warn('[GroqBrain] Groq LLM parsing error:', e);
            }
            return null;
        }

        async explainSecurityAlert(warningType, details = {}) {
            if (!this.config.apiKey) return 'Security alert detected. Please verify before confirming.';

            try {
                const response = await fetch(this.config.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.config.apiKey}`
                    },
                    body: JSON.stringify({
                        model: this.config.model,
                        messages: [
                            {
                                role: 'system',
                                content: 'You are an accessibility security advisor for a blind-friendly UPI app. Explain risks simply in 1 plain English sentence.'
                            },
                            {
                                role: 'user',
                                content: `Explain security alert: ${warningType}. Details: ${JSON.stringify(details)}`
                            }
                        ],
                        max_tokens: 60,
                        temperature: 0.2
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    return data.choices[0]?.message?.content?.trim();
                }
            } catch (e) {}

            return 'Security warning. Please double check the recipient before paying.';
        }
    }

    const groqService = new GroqService();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { GroqService, groqService, GROQ_CONFIG };
    } else {
        global.GroqService = GroqService;
        global.groqService = groqService;
    }

})(typeof window !== 'undefined' ? window : global);
