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
// --- ADVANCED HISTORY FEATURE (INDEXEDDB) ---

let diagnosisHistory = [];
let db; // The database connection

// 1. Initialize the Database
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('AgriSmartDB', 1);
        
        request.onerror = (event) => {
            console.error("Database error:", event.target.error);
            reject("Error opening database");
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        
        // This runs the very first time the app is opened to create the "table"
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains('diagnoses')) {
                database.createObjectStore('diagnoses', { keyPath: 'id' });
            }
        };
    });
}

// 2. Load past history when app starts
async function loadHistory() {
    try {
        if (!db) await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['diagnoses'], 'readonly');
            const store = transaction.objectStore('diagnoses');
            const request = store.getAll();
            
            request.onsuccess = () => {
                // Sort so the newest items are at the top
                diagnosisHistory = request.result.sort((a, b) => b.id - a.id);
                renderHistory();
                resolve();
            };
        });
    } catch (error) {
        console.error("Failed to load history:", error);
    }
}

// 3. Save new diagnosis to the permanent database
async function saveToHistory(imageSrc, diagnosisText) {
    try {
        if (!db) await initDB();
        
        const newItem = {
            id: Date.now(),
            date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
            image: imageSrc,
            text: diagnosisText
        };
        
        const transaction = db.transaction(['diagnoses'], 'readwrite');
        const store = transaction.objectStore('diagnoses');
        store.add(newItem);
        
        // Update the screen instantly
        diagnosisHistory.unshift(newItem);
        renderHistory();
        
    } catch (error) {
        console.error("Failed to save to history:", error);
    }
}

// 4. UI Functions (Open, Close, Render)
function openHistory() {
    const modal = document.getElementById('history-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('translate-y-full'), 10);
}

function closeHistory() {
    const modal = document.getElementById('history-modal');
    modal.classList.add('translate-y-full');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function renderHistory() {
    const container = document.getElementById('history-list');
    
    if (diagnosisHistory.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 mt-10">
                <i data-lucide="leaf" class="w-12 h-12 mx-auto mb-3 opacity-20"></i>
                <p>No past diagnoses yet.</p>
                <p class="text-xs mt-2 opacity-60">Scans will be saved securely on your device.</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    container.innerHTML = diagnosisHistory.map(item => `
        <div class="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex space-x-3 items-center">
            <img src="${item.image}" class="w-16 h-16 rounded-xl object-cover border border-gray-100">
            <div class="flex-1">
                <p class="text-xs text-gray-400 mb-1">${item.date}</p>
                <p class="text-sm font-medium text-gray-800 line-clamp-2">${item.text.substring(0, 75)}...</p>
            </div>
        </div>
    `).join('');
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// 5. Start the database when the script loads
window.addEventListener('DOMContentLoaded', () => {
    initDB().then(() => loadHistory());
});


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
        // This sends the image picture and the disease name to your new IndexedDB!
        saveToHistory(currentImageBase64, currentAnalysis.diseaseName || 'Healthy Plant');
        
        // START THE BACKGROUND AUDIO FETCH INSTANTLY
        
        chatMessages = [{
            role: 'system',
            content: `I am your Agri-Assistant. I analyzed the ${currentAnalysis.cropName} leaf and detected ${currentAnalysis.healthStatus.toLowerCase().includes('health') ? 'no diseases' : currentAnalysis.diseaseName}. Do you have any questions? Please respond in ${selectedLanguage}.`
        }];
        
        // Automatically stop old audio if restarting analysis
        stopAllAudio();
    
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


// --- API Integration: TTS Audio ---


function stopAllAudio() {
    if (audioObj) { audioObj.pause(); audioObj = null; }
    isPlayingAudio = false; 
    updateTtsUI();
    
    if (activeChatAudio) { activeChatAudio.pause(); activeChatAudio = null; }
    activeChatAudioIndex = -1;
}
// --- FULL SCREEN CHAT & VOICE TYPING LOGIC ---

// 1. Open/Close Modal
function openFullScreenChat() {
    const modal = document.getElementById('full-chat-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('translate-y-full'), 10);
    renderFullChat();
}

function closeFullScreenChat() {
    const modal = document.getElementById('full-chat-modal');
    modal.classList.add('translate-y-full');
    setTimeout(() => modal.classList.add('hidden'), 300);
    if(isRecording) toggleVoiceTyping(); // Stop mic if open
}

// 2. Voice Typing (Speech to Text)
let isRecording = false;
let recognition = null;

// Initialize native browser speech recognition
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-IN'; // You can change this to 'hi-IN' for Hindi, etc.

    recognition.onstart = () => {
        isRecording = true;
        document.getElementById('mic-btn').classList.replace('bg-emerald-50', 'bg-red-100');
        document.getElementById('mic-btn').classList.replace('text-emerald-600', 'text-red-600');
        document.getElementById('mic-status').innerText = "Listening...";
        document.getElementById('mic-icon').setAttribute('data-lucide', 'mic-off');
        lucide.createIcons();
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                document.getElementById('full-chat-input').value += event.results[i][0].transcript + ' ';
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
    };

    recognition.onerror = (event) => { console.error("Speech error", event.error); toggleVoiceTyping(); };
    recognition.onend = () => { if(isRecording) toggleVoiceTyping(); };
}



// 4. Send Message & Render Logic (Replace your old chat functions with these)
async function sendFullChatMessage() {
    const input = document.getElementById('full-chat-input');
    const text = input.value.trim();
    if (!text || isChatting) return;

    input.value = '';
    chatMessages.push({ role: "user", content: text });
    isChatting = true;
    renderFullChat();

    try {
        // Send to your existing /api/chat endpoint
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: chatMessages })
        });
        const data = await response.json();
        const reply = data.candidates[0].content.parts[0].text;
        
        chatMessages.push({ role: "model", content: reply });
        
        // --- THE MAGIC: Trigger Auto-Play Audio immediately! ---
        playNativeAudio(reply);

    } catch (error) {
        chatMessages.push({ role: "model", content: "Sorry, I had trouble connecting. Please try again." });
    }
    
    isChatting = false;
    renderFullChat();
}

function renderFullChat() {
    const container = document.getElementById('full-chat-container');
    let html = '';
    
    chatMessages.forEach((msg, index) => {
        if (msg.role === 'system') return; 
        const isUser = msg.role === 'user';
        
        let formattedContent = isUser ? msg.content : marked.parse(msg.content);

        html += `
            <div class="flex ${isUser ? 'justify-end' : 'justify-start'} w-full mb-4">
                <div style="width: fit-content; max-width: 85%; word-break: break-word;" 
                     class="px-4 py-3 shadow-sm text-[15px] ${isUser ? 'bg-emerald-600 text-white rounded-2xl rounded-br-none' : 'bg-white border border-gray-200 text-gray-800 rounded-2xl rounded-bl-none chat-markdown'}">
                    ${formattedContent}
                </div>
            </div>
        `;
    });

    if (isChatting) {
        html += `
            <div class="flex justify-start w-full mb-4">
                <div style="width: fit-content;" class="bg-white border border-gray-200 px-5 py-4 rounded-2xl rounded-bl-none shadow-sm flex items-center space-x-1.5">
                    <div class="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-bounce"></div>
                    <div class="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
                    <div class="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-bounce" style="animation-delay: 0.4s"></div>
                </div>
            </div>
        `;
    }

    container.innerHTML = html; 
    container.scrollTop = container.scrollHeight;
    document.getElementById('full-send-btn').disabled = isChatting; 
    lucide.createIcons();
}

// --- AUDIO PRELOADING LOGIC ---
let preloadedAudioObj = null;

//  NATIVE VOICE & MIC ENGINE ---
let currentLang = 'en-IN'; 

function updateLanguage() {
    currentLang = document.getElementById('chat-language').value;
    if (recognition) recognition.lang = currentLang; 
}

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = currentLang; 

    recognition.onstart = () => {
        isRecording = true;
        document.getElementById('mic-btn').classList.replace('bg-emerald-50', 'bg-red-100');
        document.getElementById('mic-btn').classList.replace('text-emerald-600', 'text-red-600');
        document.getElementById('mic-status').innerText = "Listening...";
        document.getElementById('mic-icon').setAttribute('data-lucide', 'mic-off');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                document.getElementById('full-chat-input').value += event.results[i][0].transcript + ' ';
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
    };

    recognition.onerror = () => toggleVoiceTyping();
    recognition.onend = () => { if(isRecording) toggleVoiceTyping(); };
}

function toggleVoiceTyping() {
    if (!recognition) return alert("Voice typing is not supported in this browser.");
    
    if (isRecording) {
        recognition.stop();
        isRecording = false;
        document.getElementById('mic-btn').classList.replace('bg-red-100', 'bg-emerald-50');
        document.getElementById('mic-btn').classList.replace('text-red-600', 'text-emerald-600');
        document.getElementById('mic-status').innerText = "Tap to Speak";
        document.getElementById('mic-icon').setAttribute('data-lucide', 'mic');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } else {
        document.getElementById('full-chat-input').value = ''; 
        recognition.start();
    }
}


function playNativeAudio(textToSpeak) {
    if (!textToSpeak || textToSpeak.trim() === "") return;
    window.speechSynthesis.cancel(); 
    
    const speech = new SpeechSynthesisUtterance(textToSpeak);
    speech.lang = currentLang; 
    speech.rate = 0.9;         

    speech.onstart = () => { isPlayingAudio = true; };
    speech.onend = () => { isPlayingAudio = false; };
    speech.onerror = () => { isPlayingAudio = false; };

    window.speechSynthesis.speak(speech);
}

function toggleTTS() {
    if (isPlayingAudio) {
        window.speechSynthesis.cancel();
        isPlayingAudio = false;
        return;
    }
    if (!ttsSummaryText || ttsSummaryText.trim() === "") return alert("Please wait for the diagnosis.");
    playNativeAudio(ttsSummaryText);
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