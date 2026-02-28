export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Securely pull your secret key from Vercel Environment Variables
    const API_KEY = process.env.GEMINI_API_KEY; 

    if (!API_KEY) {
        return res.status(500).json({ error: 'Server misconfiguration: Missing API Key' });
    }

    const payload = req.body;

    // We add the JSON schema rules here on the backend so the frontend doesn't have to carry them
    const schema = {
        type: "OBJECT",
        properties: {
            cropName: { type: "STRING" },
            diseaseName: { type: "STRING" },
            healthStatus: { type: "STRING", description: "Healthy, Mildly Infected, Severely Infected" },
            confidenceScore: { type: "INTEGER", description: "0-100" },
            symptoms: { type: "ARRAY", items: { type: "STRING" } },
            causes: { type: "ARRAY", items: { type: "STRING" } },
            prevention: { type: "ARRAY", items: { type: "STRING" } },
            treatmentOrganic: { type: "ARRAY", items: { type: "STRING" } },
            treatmentChemical: { type: "ARRAY", items: { type: "STRING" } }
        }
    };

    // If it's an image upload, attach the schema. If it's just a chat message, don't.
    if (payload.contents[0].parts.some(part => part.inlineData)) {
        payload.generationConfig = {
            responseMimeType: "application/json",
            responseSchema: schema
        };
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        // Pass the Google response back to our frontend
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}