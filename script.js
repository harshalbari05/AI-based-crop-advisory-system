// API Key (Filled securely by the environment at runtime, or manually if you download this file)
const url = `/api/analyze`;

lucide.createIcons();

let currentImageBase64 = null;
let currentAnalysis = null;
let chatMessages = [];
let isChatting = false;

let audioObj = null;
let isPlayingAudio = false;
let ttsSummaryText = "";

// Chat Audio State
let activeChatAudio = null;
let activeChatAudioIndex = -1;
// --- Live Weather System ---
async function fetchWeather(lat, lon, cityName = null) {
    try {
        // 1. Get city name if not provided (Reverse Geocoding)
        if (!cityName) {
            try {
                const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
                const geoData = await geoRes.json();
                cityName = geoData.address.city || geoData.address.town || geoData.address.county || "Local Area";
            } catch(e) {
                cityName = "Local Area";
            }
        }

        // 2. Fetch live weather (Open-Meteo API - Free, No Key needed!)
        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day`);
        const weatherData = await weatherRes.json();
        const current = weatherData.current;

        // 3. Match code to description and icon
        const weatherMap = {
            0: { desc: 'Clear sky', icon: current.is_day ? 'sun' : 'moon' },
            1: { desc: 'Mainly clear', icon: current.is_day ? 'sun' : 'moon' },
            2: { desc: 'Partly cloudy', icon: 'cloud-sun' },
            3: { desc: 'Overcast', icon: 'cloud' },
            45: { desc: 'Foggy', icon: 'cloud-fog' },
            48: { desc: 'Rime fog', icon: 'cloud-fog' },
            51: { desc: 'Light Drizzle', icon: 'cloud-drizzle' },
            61: { desc: 'Rain', icon: 'cloud-rain' },
            71: { desc: 'Snow', icon: 'snowflake' },
            95: { desc: 'Thunderstorm', icon: 'cloud-lightning' },
        };
        const weatherInfo = weatherMap[current.weather_code] || { desc: 'Variable', icon: 'cloud' };

        // 4. Inject data into HTML
        document.getElementById('weather-city').innerText = cityName;
        document.getElementById('weather-temp').innerText = `${Math.round(current.temperature_2m)}°C`;
        document.getElementById('weather-desc').innerText = weatherInfo.desc;
        document.getElementById('weather-wind').innerText = Math.round(current.wind_speed_10m);
        document.getElementById('weather-humidity').innerText = current.relative_humidity_2m;
        
        document.getElementById('weather-icon').setAttribute('data-lucide', weatherInfo.icon);
        document.getElementById('weather-bg-icon').setAttribute('data-lucide', weatherInfo.icon);
        lucide.createIcons(); // redraw new icons

    } catch (error) {
        console.error("Weather error:", error);
        document.getElementById('weather-city').innerText = "Offline";
        document.getElementById('weather-desc').innerText = "Check connection";
    }
}

// 1. Function to handle IP Fallback
async function fetchWeatherByIP() {
    try {
        console.log("Attempting IP-based location...");
        const response = await fetch('https://ipapi.co/json/');
        if (!response.ok) throw new Error("IP check blocked or rate-limited");
        
        const data = await response.json();
        if (data.latitude && data.longitude) {
            const cityName = data.city ? `${data.city}, ${data.region_code}` : null;
            fetchWeather(data.latitude, data.longitude, cityName);
        } else {
            throw new Error("IP data incomplete");
        }
    } catch (error) {
        console.error("IP check failed, using default:", error);
        // 3. Ultimate Fallback (Default City)
        fetchWeather(18.5204, 73.8567, "Pune, MH");
    }
}

// 2. Main initialization function
function initWeather() {
    // First try exact GPS
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            // SUCCESS: User allowed exact GPS
            (position) => { 
                console.log("GPS Location found!");
                fetchWeather(position.coords.latitude, position.coords.longitude); 
            },
            // ERROR/DENIED: User blocked it or it timed out -> Trigger IP Fallback
            (error) => { 
                console.log("GPS blocked or timed out. Falling back to IP...");
                fetchWeatherByIP(); 
            },
            { timeout: 6000 } // Give them 6 seconds to click "Allow"
        );
    } else {
        // Browser doesn't support GPS -> Trigger IP Fallback
        fetchWeatherByIP();
    }
}

// --- History & Local Storage Management ---
function loadHistory() {
    const history = JSON.parse(localStorage.getItem('agriSmartHistory') || '[]');
    const dashboardList = document.getElementById('dashboard-recent-list');
    const historyList = document.getElementById('history-full-list');
    const historyEmpty = document.getElementById('history-empty');

    let html = '';
    if (history.length === 0) {
        html = `<div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 text-center text-sm text-gray-500">No recent scans.</div>`;
        historyEmpty.classList.remove('hidden');
        historyList.classList.add('hidden');
    } else {
        historyEmpty.classList.add('hidden');
        historyList.classList.remove('hidden');
        history.forEach(item => {
            const isHealthy = item.status.toLowerCase() === 'healthy';
            const badgeClass = isHealthy ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
            const displayStatus = isHealthy ? 'Healthy' : item.disease;
            
            html += `
                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center">
                    <div class="flex items-center space-x-4">
                        <div class="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                            <i data-lucide="leaf" class="w-6 h-6 text-emerald-500"></i>
                        </div>
                        <div>
                            <h4 class="font-semibold text-gray-800">${item.crop}</h4>
                            <span class="text-xs px-2 py-0.5 rounded-full ${badgeClass}">${displayStatus}</span>
                        </div>
                    </div>
                    <span class="text-xs text-gray-400">${item.date}</span>
                </div>
            `;
        });
    }

    // Update both views
    historyList.innerHTML = html;
    // Dashboard only shows top 2
    dashboardList.innerHTML = history.length === 0 ? html : html.split('</div>\n                        <div').slice(0, 2).join('</div>\n                        <div') + (history.length > 2 ? '</div>' : '');
    
    lucide.createIcons();
}

function saveToHistory(analysis) {
    const history = JSON.parse(localStorage.getItem('agriSmartHistory') || '[]');
    history.unshift({
        crop: analysis.cropName,
        disease: analysis.diseaseName || 'None',
        status: analysis.healthStatus,
        date: new Date().toLocaleDateString()
    });
    // Keep only last 15 to save space
    if(history.length > 15) history.pop();
    localStorage.setItem('agriSmartHistory', JSON.stringify(history));
    loadHistory();
}

// Initialize history on load
document.addEventListener('DOMContentLoaded', () => {
    loadHistory();
    initWeather(); // <-- ADD THIS LINE
});

// --- Fetch with Exponential Backoff & Detailed Errors ---
async function fetchWithRetry(url, options, maxRetries = 5) {
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            const data = await response.json();
            
            if (!response.ok || data.error) {
                const errMsg = data.error?.message || `HTTP ${response.status}: ${response.statusText}`;
                // If it's a hard error like 400 Bad Request or 403 Forbidden, don't retry, fail immediately
                if (response.status === 400 || response.status === 403) {
                    throw new Error(errMsg); 
                }
                throw new Error(errMsg);
            }
            return data;
        } catch (error) {
            console.warn(`Attempt ${i + 1} failed: ${error.message}`);
            if (i === maxRetries - 1 || error.message.includes("API key not valid")) {
                throw error; // Throw final error to the UI
            }
            await new Promise(resolve => setTimeout(resolve, delays[i]));
        }
    }
}

// --- Navigation ---
function switchTab(tabId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(`${tabId}-view`).classList.remove('hidden');
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if(btn.dataset.target === tabId) {
            btn.classList.add('text-emerald-600');
            btn.classList.remove('text-gray-400');
        } else {
            btn.classList.remove('text-emerald-600');
            btn.classList.add('text-gray-400');
        }
    });

    // Stop any playing audio if leaving results screen
    if(tabId !== 'results') {
        stopAllAudio();
    }
}

// --- Image Compression Utility ---
function compressImage(file, maxWidth = 800) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height *= maxWidth / width));
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to highly optimized JPEG
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                resolve({
                    base64Data: dataUrl.split(',')[1],
                    mimeType: 'image/jpeg'
                });
            };
            img.onerror = () => reject(new Error("Failed to read image data"));
        };
        reader.onerror = error => reject(error);
    });
}

// --- File Upload Handling ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('image-upload');
const scanInitial = document.getElementById('scan-initial');
const scanPreviewImg = document.getElementById('scan-preview-img');
const scanCameraOverlay = document.getElementById('scan-camera-overlay');
const scanLoading = document.getElementById('scan-loading');
const scanError = document.getElementById('scan-error');
const scanErrorText = document.getElementById('scan-error-text');

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('bg-emerald-100'); });
dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('bg-emerald-100'); });
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('bg-emerald-100');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
});

async function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        showScanError("Please upload a valid image file.");
        return;
    }

    const previewUrl = URL.createObjectURL(file);
    scanPreviewImg.src = previewUrl;
    
    scanInitial.classList.add('hidden');
    scanPreviewImg.classList.remove('hidden');
    scanCameraOverlay.classList.remove('hidden');
    scanError.classList.add('hidden');

    try {
        // Resize and compress the image before sending to prevent Payload Too Large errors
        const { base64Data, mimeType } = await compressImage(file);
        currentImageBase64 = previewUrl; // Keep original URL for UI display
        analyzeImage(base64Data, mimeType);
    } catch (err) {
        showScanError("Failed to compress image locally: " + err.message);
    }
}

function showScanError(msg) {
    scanLoading.classList.add('hidden');
    scanCameraOverlay.classList.remove('hidden');
    scanErrorText.innerText = msg;
    scanError.classList.remove('hidden');
}

// --- API Integration: Vision Analysis ---
async function analyzeImage(base64Data, mimeType) {
    scanCameraOverlay.classList.add('hidden');
    scanLoading.classList.remove('hidden');
    scanError.classList.add('hidden');
    
    const selectedLanguage = document.getElementById('language-select').value;
    
    const prompt = `
        You are an expert agronomist. Analyze this image of a crop leaf. 
        Provide a diagnosis including the crop name, disease name (if any), health status, and a confidence score.
        Also list symptoms, causes, prevention methods, organic treatments, and chemical treatments.
        IMPORTANT: Translate all text values in your JSON response to ${selectedLanguage}. The JSON keys must remain in English, but the content must be in ${selectedLanguage}.
    `;

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

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: mimeType, data: base64Data } }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema }
    };

    try {
        const url = `/api/analyze`;
        
        const data = await fetchWithRetry(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        // Parse the response specifically looking for the JSON structure
        const resultText = data.candidates[0].content.parts[0].text;
        currentAnalysis = JSON.parse(resultText);
        
        populateResults();
        saveToHistory(currentAnalysis); // Save to local storage
        
        chatMessages = [{
            role: 'system',
            content: `I am your Agri-Assistant. I analyzed the ${currentAnalysis.cropName} leaf and detected ${currentAnalysis.healthStatus.toLowerCase().includes('health') ? 'no diseases' : currentAnalysis.diseaseName}. Do you have any questions? Please respond in ${selectedLanguage}.`
        }];
        
        // Automatically stop old audio if restarting analysis
        stopAllAudio();
        
        renderChat();
        switchTab('results');
        
    } catch (err) {
        console.error("Analysis Detailed Error:", err);
        // Print the exact error so we know what to fix
        showScanError(err.message || "Failed to connect to the Gemini API.");
    } finally {
        scanLoading.classList.add('hidden');
        scanCameraOverlay.classList.remove('hidden');
    }
}

function populateResults() {
    const { cropName, diseaseName, healthStatus, confidenceScore, prevention, treatmentOrganic, treatmentChemical } = currentAnalysis;
    const isHealthy = healthStatus.toLowerCase() === 'healthy';

    document.getElementById('result-hero-img').src = currentImageBase64;
    document.getElementById('result-thumb-img').src = currentImageBase64;
    document.getElementById('result-crop-name').innerText = cropName || "Unknown Crop";
    document.getElementById('result-confidence').innerText = `${confidenceScore || 0}% Confidence`;
    
    const diagEl = document.getElementById('result-diagnosis');
    diagEl.innerText = isHealthy ? 'Healthy Plant' : (diseaseName || "Unknown Issue");
    diagEl.className = `text-xl font-bold ${isHealthy ? 'text-green-600' : 'text-red-600'}`;

    ttsSummaryText = `Analysis complete for ${cropName}. Status is ${healthStatus}. ${!isHealthy ? `Detected disease is ${diseaseName}.` : 'The plant looks healthy.'} ${treatmentOrganic?.length > 0 ? `I recommend: ${treatmentOrganic[0]}.` : ''}`;

    const detailsSection = document.getElementById('unhealthy-details');
    if (isHealthy) {
        detailsSection.classList.add('hidden');
    } else {
        detailsSection.classList.remove('hidden');
        
        const buildList = (containerId, items, iconHtml, emptyMsg) => {
            const ul = document.getElementById(containerId);
            ul.innerHTML = '';
            if (items && items.length > 0) {
                items.forEach(item => {
                    ul.innerHTML += `<li class="flex items-start">${iconHtml}<span>${item}</span></li>`;
                });
            } else {
                ul.innerHTML = `<li class="text-gray-500 text-sm">${emptyMsg}</li>`;
            }
        };

        buildList('list-organic', treatmentOrganic, '<i data-lucide="check-circle" class="w-4 h-4 text-green-500 mr-2 mt-0.5 flex-shrink-0"></i>', 'No organic treatments listed.');
        buildList('list-chemical', treatmentChemical, '<i data-lucide="shield-alert" class="w-4 h-4 text-blue-500 mr-2 mt-0.5 flex-shrink-0"></i>', 'No chemical treatments listed.');
        
        const prevUl = document.getElementById('list-prevention');
        prevUl.innerHTML = '';
        if(prevention) prevention.forEach(p => prevUl.innerHTML += `<li>${p}</li>`);
        
        lucide.createIcons();
    }
}

// --- API Integration: Chat ---
function handleChatKeyPress(e) {
    if(e.key === 'Enter') handleSendMessage();
}

async function handleSendMessage() {
    const inputEl = document.getElementById('chat-input');
    const val = inputEl.value.trim();
    if(!val || isChatting) return;

    chatMessages.push({ role: 'user', content: val });
    inputEl.value = '';
    isChatting = true;
    renderChat();

    const selectedLanguage = document.getElementById('language-select').value;
    const systemContext = `You are an AI agricultural assistant. The user previously uploaded an image of a ${currentAnalysis.cropName} leaf diagnosed with ${currentAnalysis.diseaseName}. User asks: ${val}. Respond thoroughly in ${selectedLanguage}. Use plain formatting easily readable by Text-to-Speech engines.`;

    const payload = { contents: [{ role: "user", parts: [{ text: systemContext }] }] };

    try {
        const url = `/api/analyze`;
        const data = await fetchWithRetry(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const botReply = data.candidates[0].content.parts[0].text;
        chatMessages.push({ role: 'assistant', content: botReply });
    } catch (err) {
        chatMessages.push({ role: 'assistant', content: "Error: " + err.message });
    } finally {
        isChatting = false;
        renderChat();
    }
}

function renderChat() {
    const container = document.getElementById('chat-container');
    let html = '';
    
    chatMessages.forEach((msg, index) => {
        if (msg.role === 'system') return; 
        const isUser = msg.role === 'user';
        
        let formattedContent = '';
        if (isUser) {
            formattedContent = msg.content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
        } else {
            formattedContent = marked.parse(msg.content);
        }
        
        let audioBtnHtml = '';
        if (!isUser) {
            const isPlaying = activeChatAudioIndex === index;
            const iconName = isPlaying ? 'square' : 'volume-2';
            const btnColor = isPlaying ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-gray-50 text-emerald-600 hover:bg-emerald-50 border-gray-200';
            
            audioBtnHtml = `
                <div class="mt-2 pt-2 border-t border-gray-100 flex justify-end">
                    <button onclick="playChatAudio(${index})" class="flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition ${btnColor} border">
                        <i data-lucide="${iconName}" class="w-3.5 h-3.5 fill-current"></i>
                        <span>${isPlaying ? 'Stop Listening' : 'Listen to Advice'}</span>
                    </button>
                </div>
            `;
        }

        // THE FIX: Added style="width: fit-content; word-break: break-word;" directly to the HTML
        html += `
            <div class="flex ${isUser ? 'justify-end' : 'justify-start'} w-full mb-3">
                <div style="width: fit-content; max-width: 85%; word-break: break-word;" 
                        class="px-4 py-2.5 rounded-2xl text-sm shadow-sm ${isUser ? 'bg-emerald-600 text-white rounded-br-none' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none chat-markdown'}">
                    ${formattedContent}
                    ${audioBtnHtml}
                </div>
            </div>
        `;
    });

    if (isChatting) {
        // THE FIX: Added style="width: fit-content;" to the typing dots too!
        html += `
            <div class="flex justify-start w-full mb-3">
                <div style="width: fit-content;" class="bg-white border border-gray-200 px-4 py-3 rounded-2xl rounded-bl-none shadow-sm flex items-center space-x-1">
                    <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
                    <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.4s"></div>
                </div>
            </div>
        `;
    }

    container.innerHTML = html; 
    container.scrollTop = container.scrollHeight;
    document.getElementById('send-chat-btn').disabled = isChatting; 
    lucide.createIcons();
}

// --- API Integration: TTS Audio ---
const pcmToWav = (pcmData, sampleRate) => {
    const numChannels = 1;
    const byteRate = sampleRate * numChannels * 2;
    const blockAlign = numChannels * 2;
    const buffer = new ArrayBuffer(44 + pcmData.length);
    const view = new DataView(buffer);

    const writeString = (view, offset, string) => {
        for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };

    writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + pcmData.length, true);
    writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
    writeString(view, 36, 'data'); view.setUint32(40, pcmData.length, true);

    const pcmBytes = new Uint8Array(pcmData);
    const wavBytes = new Uint8Array(buffer);
    wavBytes.set(pcmBytes, 44);
    return buffer;
};

function stopAllAudio() {
    if (audioObj) { audioObj.pause(); audioObj = null; }
    isPlayingAudio = false; 
    updateTtsUI();
    
    if (activeChatAudio) { activeChatAudio.pause(); activeChatAudio = null; }
    activeChatAudioIndex = -1;
    renderChat(); // Updates the icons inside the chat
}

async function toggleTTS() {
    if (isPlayingAudio) { stopAllAudio(); return; }
    stopAllAudio(); 
    isPlayingAudio = true; 
    document.getElementById('tts-text').innerText = "Loading..."; 
    updateTtsUI();

    try {
        const data = await fetchWithRetry('/api/tts', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ contents: [{ parts: [{ text: ttsSummaryText }] }] })
        });
        
        // Check if we got an error from our backend
        if (data.error) {
            alert("Backend Error: " + data.error);
            stopAllAudio();
            return;
        }

        const audioPart = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        
        if (audioPart) {
            const binaryString = atob(audioPart.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            
            const blob = new Blob([pcmToWav(bytes.buffer, 24000)], { type: 'audio/wav' });
            audioObj = new Audio(URL.createObjectURL(blob));
            
            audioObj.onended = () => { isPlayingAudio = false; updateTtsUI(); }; 
            
            audioObj.play().catch(err => {
                alert("Browser Audio Blocked: " + err.message);
                stopAllAudio();
            });
        } else {
            alert("Google AI did not return an audio file. It returned text instead.");
            stopAllAudio();
        }
    } catch (err) { 
        alert("Network/Fetch Error: " + err.message);
        stopAllAudio(); 
    }
}

async function playChatAudio(index) {
    const msg = chatMessages[index];
    if (!msg) return;

    // Stop if already playing this specific message
    if (activeChatAudioIndex === index) {
        stopAllAudio();
        return;
    }

    // Stop any currently playing audio globally
    stopAllAudio();

    activeChatAudioIndex = index;
    renderChat(); // Re-render to show loading/stop state on the button

    // Clean the text to remove markdown characters so the AI reads it naturally
    const cleanText = msg.content.replace(/[*#_]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1');

    const payload = {
        contents: [{ parts: [{ text: cleanText }] }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
        },
        model: "gemini-2.5-flash-preview-tts"
    };

    try {
        const url = `/api/tts`;
        const data = await fetchWithRetry(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const audioPart = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (audioPart && activeChatAudioIndex === index) { // Ensure user hasn't clicked another play button while loading
            const binaryString = atob(audioPart.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            
            const wavBuffer = pcmToWav(bytes.buffer, 24000); 
            const blob = new Blob([wavBuffer], { type: 'audio/wav' });
            
            activeChatAudio = new Audio(URL.createObjectURL(blob));
            activeChatAudio.onended = () => { activeChatAudioIndex = -1; renderChat(); };
            activeChatAudio.play();
        }
    } catch (err) {
        console.error("Chat TTS Error:", err);
        activeChatAudioIndex = -1;
        renderChat();
    }
}

function updateTtsUI() {
    const btn = document.getElementById('tts-btn');
    const icon = document.getElementById('tts-icon');
    const textEl = document.getElementById('tts-text');

    if(isPlayingAudio) {
        btn.className = "flex items-center space-x-2 px-4 py-2 rounded-full font-medium transition bg-amber-100 text-amber-700";
        icon.setAttribute('data-lucide', 'square');
        textEl.innerText = "Stop Audio";
    } else {
        btn.className = "flex items-center space-x-2 px-4 py-2 rounded-full font-medium transition bg-emerald-100 text-emerald-700 hover:bg-emerald-200";
        icon.setAttribute('data-lucide', 'play');
        textEl.innerText = "Listen";
    }
    lucide.createIcons();
}
// --- App Installation Logic ---
let deferredPrompt;

// Register the Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW setup failed: ', err));
    });
}

// Catch the browser's install signal and show our custom popup instead
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // Stop the default mini-infobar
    deferredPrompt = e;
    const promptEl = document.getElementById('install-prompt');
    promptEl.classList.remove('hidden');
    // Slight delay for a smooth slide-up animation
    setTimeout(() => promptEl.classList.remove('translate-y-40'), 100);
});

function dismissInstall() {
    const promptEl = document.getElementById('install-prompt');
    promptEl.classList.add('translate-y-40');
    setTimeout(() => promptEl.classList.add('hidden'), 500);
}

async function installApp() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt(); // Show the official Google/Apple install dialog
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        console.log('App Installed!');
    }
    deferredPrompt = null;
    dismissInstall();
}