// API Key (Filled securely by the environment at runtime, or manually if you download this file)
const url = `/api/analyze`;

lucide.createIcons();

let currentImageBase64 = null;
// --- User Mode State ---
let userMode = 'farmer'; // Defaults to Farmer

function setUserMode(mode) {
    userMode = mode;
    const slider = document.getElementById('toggle-slider');
    const btnFarmer = document.getElementById('btn-farmer');
    const btnGardener = document.getElementById('btn-gardener');

    if (mode === 'farmer') {
        slider.style.transform = 'translateX(0)';
        btnFarmer.classList.replace('text-gray-500', 'text-emerald-700');
        btnGardener.classList.replace('text-emerald-700', 'text-gray-500');
    } else {
        slider.style.transform = 'translateX(100%)';
        btnFarmer.classList.replace('text-emerald-700', 'text-gray-500');
        btnGardener.classList.replace('text-gray-500', 'text-emerald-700');
    }
}
let currentAnalysis = null;
let chatMessages = [];
let isChatting = false;

let isPlayingAudio = false;
let ttsSummaryText = "";


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
// 3. Save full diagnosis to the permanent database
async function saveToHistory(imageSrc, analysisData) {
    try {
        if (!db) await initDB();
        
        const newItem = {
            id: Date.now(),
            date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
            image: imageSrc,
            text: analysisData.diseaseName || 'Healthy Plant',
            analysisData: analysisData // ⚡ FIX: Saves the entire AI JSON object!
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

// NEW: Function to re-load an entire historical scan
window.viewHistoryItem = function(id) {
    const item = diagnosisHistory.find(i => i.id === id);
    // Safety check: Make sure it's a new scan that actually has the full data saved
    if (item && item.analysisData) {
        currentImageBase64 = item.image;
        currentAnalysis = item.analysisData;
        populateResults(); // Re-build the HTML with the saved data
        closeHistory();    // Close the history modal
        switchTab('results'); // Jump to the results screen
    } else {
        alert("This is an old scan that didn't save the full details. Please scan again!");
    }
};

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
    const historyModalList = document.getElementById('history-list');
    const dashboardList = document.getElementById('dashboard-recent-list');
    
    // IF EMPTY: Show empty states
    if (diagnosisHistory.length === 0) {
        if (historyModalList) {
            historyModalList.innerHTML = `
                <div class="text-center text-gray-500 mt-10">
                    <i data-lucide="leaf" class="w-12 h-12 mx-auto mb-3 opacity-20"></i>
                    <p>No past diagnoses yet.</p>
                    <p class="text-xs mt-2 opacity-60">Scans will be saved securely on your device.</p>
                </div>
            `;
        }
        if (dashboardList) {
            dashboardList.innerHTML = `<p class="text-sm text-gray-500 text-center py-4 bg-white rounded-xl border border-gray-100">No recent scans.</p>`;
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    // 1. Render FULL list for the History Modal (NOW CLICKABLE!)
    if (historyModalList) {
        historyModalList.innerHTML = diagnosisHistory.map(item => `
            <div onclick="viewHistoryItem(${item.id})" class="cursor-pointer bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex space-x-3 items-center hover:bg-emerald-50 transition active:scale-[0.98]">
                <img src="${item.image}" class="w-16 h-16 rounded-xl object-cover border border-gray-100 flex-shrink-0">
                <div class="flex-1">
                    <p class="text-xs text-gray-400 mb-1">${item.date}</p>
                    <p class="text-sm font-bold text-gray-800 line-clamp-2">${item.text}</p>
                </div>
                <i data-lucide="chevron-right" class="w-5 h-5 text-emerald-600 opacity-60"></i>
            </div>
        `).join('');
    }

    // 2. Render ONLY TOP 3 for the Dashboard (NOW CLICKABLE!)
    if (dashboardList) {
        dashboardList.innerHTML = diagnosisHistory.slice(0, 3).map(item => `
            <div onclick="viewHistoryItem(${item.id})" class="cursor-pointer bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex space-x-3 items-center hover:bg-emerald-50 transition active:scale-[0.98]">
                <img src="${item.image}" class="w-12 h-12 rounded-lg object-cover border border-gray-100 flex-shrink-0">
                <div class="flex-1">
                    <p class="text-[10px] text-gray-400 mb-0.5">${item.date}</p>
                    <p class="text-sm font-bold text-gray-800 line-clamp-1">${item.text}</p>
                </div>
                <i data-lucide="chevron-right" class="w-4 h-4 text-emerald-500 opacity-60"></i>
            </div>
        `).join('');
    }
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Initialize history on load
document.addEventListener('DOMContentLoaded', () => {
    loadHistory();
    initWeather(); 
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

    // Hide the initial upload icon and show loading states
    scanInitial.classList.add('hidden');
    scanPreviewImg.classList.remove('hidden');
    scanCameraOverlay.classList.remove('hidden');
    scanError.classList.add('hidden');

    try {
        // Resize and compress the image
        const { base64Data, mimeType } = await compressImage(file);
        
        // ⚡ FIX: Build a permanent Base64 URL instead of a temporary Blob!
        const permanentImageString = `data:${mimeType};base64,${base64Data}`;
        
        // Save the permanent string to your global variable so it goes to the database
        currentImageBase64 = permanentImageString; 
        
        // Show it on the screen
        scanPreviewImg.src = currentImageBase64; 
        
        // Send the raw data to the AI
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
    
    const selectedLanguage = document.getElementById('chat-language').value;
    
    // 1. Give the AI context based on the toggle switch!
    const modeContext = userMode === 'farmer' 
        ? "You are advising a commercial farmer. Focus on large-scale crop management, agricultural treatments, and commercial pesticides if necessary." 
        : "You are advising a home gardener. Focus on houseplants, home gardens, small-scale organic remedies, and ignore large-scale agricultural chemicals.";
    
    const prompt = `
        You are an expert botanist and agronomist. Analyze this image. 
        ${modeContext}
        Provide a diagnosis including the plant/crop name, disease name (if any), health status, and a confidence score.
        List symptoms, causes, prevention, organic treatments, chemical treatments (if appropriate), and general care tips.
        CRITICAL SPEED RULE: Be highly concise. Keep all lists to a maximum of 2 bullet points.
        IMPORTANT: Translate all text values in your JSON response to ${selectedLanguage}.
    `;

    // 2. Updated Schema to include Care Tips
    const schema = {
        type: "OBJECT",
        properties: {
            cropName: { type: "STRING" }, // Kept as cropName to avoid breaking your HTML bindings
            diseaseName: { type: "STRING" },
            healthStatus: { type: "STRING", description: "Healthy, Mildly Infected, Severely Infected" },
            confidenceScore: { type: "INTEGER", description: "0-100" },
            symptoms: { type: "ARRAY", items: { type: "STRING" } },
            causes: { type: "ARRAY", items: { type: "STRING" } },
            prevention: { type: "ARRAY", items: { type: "STRING" } },
            treatmentOrganic: { type: "ARRAY", items: { type: "STRING" } },
            treatmentChemical: { type: "ARRAY", items: { type: "STRING" } },
            careTips: { type: "ARRAY", items: { type: "STRING", description: "Sunlight, watering, and soil advice" } }
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
        saveToHistory(currentImageBase64, currentAnalysis);        
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
        // Render the new Care Tips for Gardeners!
        const careContainer = document.getElementById('care-tips-container');
        const careUl = document.getElementById('list-care-tips');
        
        if (currentAnalysis.careTips && currentAnalysis.careTips.length > 0) {
            careContainer.classList.remove('hidden');
            careUl.innerHTML = '';
            currentAnalysis.careTips.forEach(tip => {
                careUl.innerHTML += `<li class="flex items-start"><i data-lucide="sun" class="w-4 h-4 text-amber-500 mr-2 mt-0.5 flex-shrink-0"></i><span>${tip}</span></li>`;
            });
        } else {
            careContainer.classList.add('hidden');
        }

        buildList('list-organic', treatmentOrganic, '<i data-lucide="check-circle" class="w-4 h-4 text-green-500 mr-2 mt-0.5 flex-shrink-0"></i>', 'No organic treatments listed.');
        buildList('list-chemical', treatmentChemical, '<i data-lucide="shield-alert" class="w-4 h-4 text-blue-500 mr-2 mt-0.5 flex-shrink-0"></i>', 'No chemical treatments listed.');
        
        const prevUl = document.getElementById('list-prevention');
        prevUl.innerHTML = '';
        if(prevention) prevention.forEach(p => prevUl.innerHTML += `<li>${p}</li>`);
        
        lucide.createIcons();
    }
}


// --- API Integration: TTS Audio ---


function stopAllAudio() {
    // Instantly stops the native browser voice
    window.speechSynthesis.cancel(); 
    isPlayingAudio = false; 
    activeChatAudioIndex = -1;
    
    // Update the UI buttons
    if (typeof updateTtsUI !== 'undefined') updateTtsUI();
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


async function sendFullChatMessage() {
    const input = document.getElementById('full-chat-input');
    const text = input.value.trim();
    if (!text || isChatting) return;

    // 1. Show the user's message in the chat UI instantly
    input.value = '';
    chatMessages.push({ role: "user", content: text });
    isChatting = true;
    renderFullChat();

    // 2. Build the Smart Context (Language + Farmer/Gardener Mode)
    const selectedLanguage = document.getElementById('chat-language').value;
    const userRole = userMode === 'farmer' ? 'commercial farmer' : 'home gardener';
    
    // Safely get the plant name in case they haven't scanned anything yet
    const cropName = currentAnalysis?.cropName || currentAnalysis?.plantName || "plant";
    const diseaseName = currentAnalysis?.diseaseName || "an unknown condition";

    // ⚡ FIX: Added "CRITICAL SPEED RULE" to force 1-2 sentence answers!
    const systemContext = `You are an AI agricultural assistant advising a ${userRole}. Image context: ${cropName} with ${diseaseName}. User asks: ${text}. 
    CRITICAL SPEED RULE: Respond extremely concisely in 1 to 2 short sentences in ${selectedLanguage}. Keep it brief, conversational, and directly answer the question.`;

    try {
        // 3. Send the highly specific prompt to your Gemini API
        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                contents: [{ role: "user", parts: [{ text: systemContext }] }] 
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || data.error) {
            throw new Error(data.error?.message || "Failed to get AI response");
        }

        const reply = data.candidates[0].content.parts[0].text;
        
        // 4. Save the AI's reply to the chat
        chatMessages.push({ role: "model", content: reply });

    } catch (error) {
        console.error("Chat Error:", error);
        chatMessages.push({ role: "model", content: "Sorry, I had trouble connecting. Please try again." });
    } finally {
        // 5. Turn off the typing animation and re-render the chat
        isChatting = false;
        renderFullChat();
    }
}

function renderFullChat(autoScroll = true) {
    const container = document.getElementById('full-chat-container');
    let html = '';
    
    // 1. Find the index of YOUR last sent message
    let lastUserIndex = -1;
    for (let i = chatMessages.length - 1; i >= 0; i--) {
        if (chatMessages[i].role === 'user') {
            lastUserIndex = i;
            break;
        }
    }
    
    chatMessages.forEach((msg, index) => {
        if (msg.role === 'system') return; 
        const isUser = msg.role === 'user';
        let formattedContent = isUser ? msg.content : marked.parse(msg.content);

        // 2. Build the "Listen" button for AI replies
        let audioBtnHtml = '';
        if (!isUser) {
            const isPlaying = (activeChatAudioIndex === index);
            audioBtnHtml = `
                <div class="mt-2 pt-2 border-t border-gray-200/60 flex justify-end">
                    <button onclick="playChatAudio(${index})" class="flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition ${isPlaying ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'} border border-transparent">
                        <i data-lucide="${isPlaying ? 'square' : 'volume-2'}" class="w-3.5 h-3.5 fill-current"></i>
                        <span>${isPlaying ? 'Stop' : 'Listen'}</span>
                    </button>
                </div>
            `;
        }

        // 3. Mark YOUR sent message with a special ID
        let idAttr = (index === lastUserIndex) ? 'id="latest-user-msg"' : '';

        html += `
            <div ${idAttr} class="flex ${isUser ? 'justify-end' : 'justify-start'} w-full mb-4">
                <div style="width: fit-content; max-width: 85%; word-break: break-word;" 
                     class="px-4 py-3 shadow-sm text-[15px] ${isUser ? 'bg-emerald-600 text-white rounded-2xl rounded-br-none' : 'bg-white border border-gray-200 text-gray-800 rounded-2xl rounded-bl-none chat-markdown'}">
                    ${formattedContent}
                    ${audioBtnHtml}
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
    document.getElementById('full-send-btn').disabled = isChatting; 
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // 4. SCROLL LOGIC: Lock the screen to the top of your message!
    if (autoScroll) {
        const lastUserMsgEl = document.getElementById('latest-user-msg');
        if (lastUserMsgEl) {
            // 'block: start' forces your message to sit exactly at the top of the view
            lastUserMsgEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            container.scrollTop = container.scrollHeight; 
        }
    }
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

function playChatAudio(index) {
    const msg = chatMessages[index];
    if (!msg) return;

    // Stop if clicking the same message that is already playing
    if (activeChatAudioIndex === index && isPlayingAudio) {
        stopAllAudio();
        renderFullChat(false); // Update UI without jumping the scroll
        return;
    }

    // Stop any currently playing audio globally
    stopAllAudio();

    activeChatAudioIndex = index;

    // Clean the markdown text so the AI reads it naturally
    const cleanText = msg.content.replace(/[*#_]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1');
    const speech = new SpeechSynthesisUtterance(cleanText);
    
    // Use the language from your dropdown
    const langDropdown = document.getElementById('chat-language');
    speech.lang = langDropdown ? langDropdown.value : 'en-IN';
    speech.rate = 0.9;

    speech.onstart = () => { 
        isPlayingAudio = true; 
        renderFullChat(false); // Show the "Stop" button
    };
    speech.onend = () => { 
        isPlayingAudio = false; 
        activeChatAudioIndex = -1; 
        renderFullChat(false); // Show the "Listen" button again
    };
    speech.onerror = () => { 
        isPlayingAudio = false; 
        activeChatAudioIndex = -1; 
        renderFullChat(false); 
    };

    window.speechSynthesis.speak(speech);
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