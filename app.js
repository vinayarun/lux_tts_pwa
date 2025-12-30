const API_BASE = "https://sproochmaschinn.lu";
const CORS_PROXY = "https://corsproxy.io/?";

let sessionId = null;
let worker = null;

// DOM Elements
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const scanBtn = document.getElementById('scan-btn');
const scanIcon = document.getElementById('scan-icon');
const loadingSpinner = document.getElementById('loading-spinner');
const scanText = document.getElementById('scan-text');
const bottomSheet = document.getElementById('bottom-sheet');
const extractedTextArea = document.getElementById('extracted-text');
const speakBtn = document.getElementById('speak-btn');
const closeSheetBtn = document.getElementById('close-sheet');
const aboutBtn = document.getElementById('about-btn');
const aboutDialog = document.getElementById('about-dialog');
const closeAboutBtn = document.getElementById('close-about');

// Log Panel Elements
const logPanel = document.getElementById('log-panel');
const logHeader = document.getElementById('log-header');
const logContent = document.getElementById('log-content');
const toggleLogsBtn = document.getElementById('toggle-logs');

// 0. Logger Utility
const Logger = {
    log: (msg, type = 'info') => {
        const entry = document.createElement('div');
        entry.className = `log-entry log-${type}`;
        const time = new Date().toLocaleTimeString();
        entry.textContent = `[${time}] ${msg}`;
        logContent.appendChild(entry);
        logContent.scrollTop = logContent.scrollHeight;
        console.log(`[${type}] ${msg}`);
    },
    info: (msg) => Logger.log(msg, 'info'),
    warn: (msg) => Logger.log(msg, 'warn'),
    error: (msg) => Logger.log(msg, 'error')
};

// Redirect console errors to UI
window.onerror = (msg, url, line) => {
    Logger.error(`Global Error: ${msg} at ${line}`);
};

// 1. Initialize Camera
async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false
        });
        video.srcObject = stream;
    } catch (err) {
        console.error("Camera access denied:", err);
        alert("Please allow camera access to scan books.");
    }
}

// 2. OCR Optimization
async function getWorker() {
    if (worker) return worker;
    Logger.info("Initializing Tesseract worker...");
    worker = await Tesseract.createWorker('deu+fra', 1, {
        logger: m => {
            if (m.status === 'recognizing text') {
                Logger.info(`OCR Progress: ${Math.round(m.progress * 100)}%`);
            }
        },
    });
    Logger.info("Worker ready.");
    return worker;
}

async function performOCR() {
    // Capture and Preprocess frame
    const context = canvas.getContext('2d');

    // Resize for speed (max 1000px width)
    const scale = Math.min(1, 1000 / video.videoWidth);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;

    // Draw and convert to Grayscale
    context.filter = 'grayscale(100%) contrast(120%)';
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL('image/jpeg', 0.8);

    setLoading(true);

    try {
        Logger.info("Starting OCR process...");
        const tWorker = await getWorker();
        Logger.info("Worker acquired, starting recognition...");
        const result = await tWorker.recognize(imageData);

        Logger.info(`OCR Complete. Found ${result.data.text.length} characters.`);
        extractedTextArea.value = result.data.text;
        bottomSheet.classList.remove('hidden');
    } catch (err) {
        Logger.error(`OCR Failed: ${err.message}`);
        alert("Failed to recognize text. Please try again.");
    } finally {
        setLoading(false);
    }
}

// 3. TTS with CORS Proxy
async function getSession() {
    if (sessionId) return sessionId;

    Logger.info("Requesting new session from Sproochmaschinn...");
    const url = `${CORS_PROXY}${encodeURIComponent(API_BASE + "/api/session")}`;
    Logger.info(`Fetch URL: ${url}`);

    try {
        const resp = await fetch(url, { method: 'POST' });
        Logger.info(`Session Response Status: ${resp.status}`);
        const data = await resp.json();
        sessionId = data.session_id;
        Logger.info(`Session created: ${sessionId}`);
        return sessionId;
    } catch (err) {
        Logger.error(`Session creation failed: ${err.message}`);
        throw err;
    }
}

async function speakText() {
    const text = extractedTextArea.value;
    if (!text) return;

    speakBtn.disabled = true;
    speakBtn.textContent = "Processing...";

    try {
        const sid = await getSession();

        Logger.info(`Requesting TTS for session ${sid}...`);
        // Request TTS via Proxy
        const ttsUrl = `${CORS_PROXY}${encodeURIComponent(API_BASE + "/api/tts/" + sid)}`;
        Logger.info(`TTS Request URL: ${ttsUrl}`);

        const ttsResp = await fetch(ttsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, model: 'claude' })
        });

        Logger.info(`TTS Response Status: ${ttsResp.status}`);
        const ttsData = await ttsResp.json();
        const requestId = ttsData.request_id;
        Logger.info(`TTS Request ID: ${requestId}`);

        // Poll for result via Proxy
        let audioData = null;
        Logger.info("Starting result polling...");
        for (let i = 0; i < 30; i++) {
            const resUrl = `${CORS_PROXY}${encodeURIComponent(API_BASE + "/api/result/" + requestId)}`;
            const resResp = await fetch(resUrl);
            const resData = await resResp.json();

            Logger.info(`Poll ${i + 1}: Status = ${resData.status}`);

            if (resData.status === 'completed') {
                audioData = resData.result.data;
                Logger.info("Audio data received successfully.");
                break;
            } else if (resData.status === 'error') {
                Logger.error("API returned error status during polling.");
                throw new Error("API Error");
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (audioData) {
            Logger.info("Playing audio...");
            playAudio(audioData);
        } else {
            Logger.warn("Polling timed out or no audio data returned.");
        }
    } catch (err) {
        Logger.error(`TTS Process Failed: ${err.message}`);
        alert("Failed to generate speech. (CORS or API issue)");
    } finally {
        speakBtn.disabled = false;
        speakBtn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg> Read Aloud`;
    }
}

function playAudio(base64Data) {
    const audioSrc = `data:audio/wav;base64,${base64Data}`;
    const audio = new Audio(audioSrc);
    audio.play();
}

// UI Helpers
function setLoading(isLoading) {
    if (isLoading) {
        scanIcon.classList.add('hidden');
        loadingSpinner.classList.remove('hidden');
        scanText.textContent = "Scanning...";
        scanBtn.disabled = true;
    } else {
        scanIcon.classList.remove('hidden');
        loadingSpinner.classList.add('hidden');
        scanText.textContent = "Scan Page";
        scanBtn.disabled = false;
    }
}

// Event Listeners
scanBtn.addEventListener('click', performOCR);
speakBtn.addEventListener('click', speakText);
closeSheetBtn.addEventListener('click', () => bottomSheet.classList.add('hidden'));
aboutBtn.addEventListener('click', () => aboutDialog.classList.remove('hidden'));
closeAboutBtn.addEventListener('click', () => aboutDialog.classList.add('hidden'));

// Log Panel Toggle
logHeader.addEventListener('click', () => {
    logPanel.classList.toggle('collapsed');
    toggleLogsBtn.textContent = logPanel.classList.contains('collapsed') ? 'Show' : 'Hide';
});

// Start app
initCamera();
getWorker(); // Pre-warm worker
getSession(); // Warm up session

// Register Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}
