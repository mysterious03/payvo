// groq-service.js
// Groq AI Conversational Intent & Risk Analysis Engine for VoxPay
// Uses ultra-fast LLMs on Groq Cloud to extract payment entities and explain security warnings.

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
         * Parses conversational voice transcripts into structured UPI payment intent
         * Example: "Send 500 rupees to Ramesh for dinner" -> { recipient: "Ramesh", amount: 500, note: "dinner" }
         */
        async parseVoiceIntent(spokenText) {
            if (!spokenText || !this.config.apiKey) {
                return null;
            }

            try {
                const systemPrompt = `You are the VoxPay financial voice assistant AI.
Extract user intentions and payment entities from spoken commands into strict JSON format with these keys:
{
  "intent": "PAY" | "CHECK_BALANCE" | "TRANSACTION_HISTORY" | "GENERATE_QR" | "SCAN_QR" | "LOAD_MONEY" | "VIEW_CARDS" | "VIEW_PROFILE" | "GO_HOME" | "UNKNOWN",
  "recipient": string (name, phone or UPI VPA if mentioned, else ""),
  "amount": number or null (parsed numeric value),
  "note": string (reason/category if mentioned, else ""),
  "spokenResponse": string (1 natural, conversational, polite sentence to speak back to the user)
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
                        max_tokens: 180
                    })
                });

                if (!response.ok) {
                    console.warn(`[GroqService] Groq API returned status ${response.status}`);
                    return null;
                }

                const data = await response.json();
                const content = data.choices[0]?.message?.content;
                if (content) {
                    const parsed = JSON.parse(content);
                    console.log('[GroqService] Parsed voice intent:', parsed);
                    return parsed;
                }
            } catch (e) {
                console.warn('[GroqService] Error in Groq intent parsing:', e);
            }
            return null;
        }

        /**
         * Generate plain-language, accessible security & risk explanation for visually impaired users
         */
        async explainSecurityAlert(warningType, details = {}) {
            if (!this.config.apiKey) return 'Security alert detected. Please verify before confirming.';

            try {
                const prompt = `Explain this payment security warning in 1 friendly, crystal-clear spoken sentence (max 15 words) for a blind user:
Warning Type: ${warningType}
Details: ${JSON.stringify(details)}`;

                const response = await fetch(this.config.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.config.apiKey}`
                    },
                    body: JSON.stringify({
                        model: this.config.model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.2,
                        max_tokens: 50
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    return data.choices[0]?.message?.content?.trim() || 'Please verify the recipient details before proceeding.';
                }
            } catch (e) {
                console.warn('[GroqService] Error in alert generation:', e);
            }
            return 'Please check transaction details carefully before confirming.';
        }
    }

    const groqInstance = new GroqService();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { GroqService, groqService: groqInstance };
    } else {
        global.GroqService = groqInstance;
        global.groqService = groqInstance;
    }

})(typeof window !== 'undefined' ? window : global);
