export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.GEMINI_API_KEY;
    // CRITICAL: We MUST use the dedicated TTS model URL
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: req.body.contents,
                generationConfig: {
                    responseModalities: ["AUDIO"], // Force audio output
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Aoede" // You can also try "Kore" or "Zephyr"
                            }
                        }
                    }
                }
            })
        });

        const data = await response.json();
        res.status(200).json(data);
    } catch (error) {
        console.error("TTS API Error:", error);
        res.status(500).json({ error: error.message });
    }
}