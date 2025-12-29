const API_BASE = "https://sproochmaschinn.lu";

let sessionId = null;
let currentRequestId = null;

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

// 2. OCR with Tesseract.js
async function performOCR() {
    // Capture frame
    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL('image/jpeg');

    // Show loading state
    setLoading(true);

    try {
        // Tesseract.js OCR
        // Note: Using 'deu' or 'fra' as fallback for Lux if 'ltz' isn't available, 
        // but Tesseract 5 supports many languages.
        const result = await Tesseract.recognize(imageData, 'deu+fra', {
            logger: m => console.log(m)
        });

        extractedTextArea.value = result.data.text;
        bottomSheet.classList.remove('hidden');
    } catch (err) {
        console.error("OCR Error:", err);
        alert("Failed to recognize text. Please try again.");
    } finally {
        setLoading(false);
    }
}

// 3. TTS with Sproochmaschinn API
async function getSession() {
    if (sessionId) return sessionId;

    const resp = await fetch(`${API_BASE}/api/session`, { method: 'POST' });
    const data = await resp.json();
    sessionId = data.session_id;
    return sessionId;
}

async function speakText() {
    const text = extractedTextArea.value;
    if (!text) return;

    speakBtn.disabled = true;
    speakBtn.textContent = "Processing...";

    try {
        const sid = await getSession();

        // Request TTS
        const ttsResp = await fetch(`${API_BASE}/api/tts/${sid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, model: 'claude' })
        });
        const ttsData = await ttsResp.json();
        const requestId = ttsData.request_id;

        // Poll for result
        let audioData = null;
        for (let i = 0; i < 30; i++) {
            const resResp = await fetch(`${API_BASE}/api/result/${requestId}`);
            const resData = await resResp.json();

            if (resData.status === 'completed') {
                audioData = resData.result.data;
                break;
            } else if (resData.status === 'error') {
                throw new Error("API Error");
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (audioData) {
            playAudio(audioData);
        }
    } catch (err) {
        console.error("TTS Error:", err);
        alert("Failed to generate speech.");
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

// Start app
initCamera();
getSession(); // Warm up session

// Register Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}
