// tracker.js
// Client-side Behavioral Biometrics Tracker

const trackerState = {
    startTime: null,
    clickCount: 0,
    keystrokesCount: 0,
    backspaceCount: 0,
    lastKeystrokeTime: null,
    typingIntervals: [],
    mouseMovements: 0,
    hesitationTime: 0, // Time between finishing input and clicking pay
    pinEntryCompleteTime: null,
    isComplete: false
};

// UI Elements
const amountInput = document.getElementById('amount');
const pinInput = document.getElementById('pin');
const payBtn = document.getElementById('pay-btn');
const debugMetrics = document.getElementById('debug-metrics');
const modal = document.getElementById('fraud-modal');
const cancelBtn = document.getElementById('cancel-btn');
const proceedBtn = document.getElementById('proceed-btn');
const failedModal = document.getElementById('failed-modal');
const closeFailedBtn = document.getElementById('close-failed-btn');


function initTracking() {
    if (!trackerState.startTime) {
        trackerState.startTime = Date.now();
        updateDebugPanel();
    }
}

// Track clicks
document.addEventListener('click', (e) => {
    initTracking();
    trackerState.clickCount++;
    updateDebugPanel();
});

// Track mouse movements 
let mouseTimeout;
document.addEventListener('mousemove', () => {
    if (!mouseTimeout) {
        trackerState.mouseMovements++;
        mouseTimeout = setTimeout(() => { mouseTimeout = null; }, 100);
    }
});

// Track Keystrokes 
function handleKeystroke(e) {
    initTracking();
    trackerState.keystrokesCount++;

    if (e.key === 'Backspace') {
        trackerState.backspaceCount++;
    }

    const now = Date.now();
    if (trackerState.lastKeystrokeTime) {
        trackerState.typingIntervals.push(now - trackerState.lastKeystrokeTime);
    }
    trackerState.lastKeystrokeTime = now;

    // PIN length tracking moved to 'input' event to capture updated value

    updateDebugPanel();
}

amountInput.addEventListener('keydown', handleKeystroke);
pinInput.addEventListener('keydown', handleKeystroke);


pinInput.addEventListener('input', (e) => {
    if (e.target.value.length === 4) {
        trackerState.pinEntryCompleteTime = Date.now();
    } else {
        trackerState.pinEntryCompleteTime = null;
    }
    updateDebugPanel();
});

// Calculate final payload
function getBehavioralPayload() {
    const endTime = Date.now();
    const timeToSubmit = trackerState.startTime ? (endTime - trackerState.startTime) : 0;

    // Average typing speed (ms per keystroke)
    const avgTypingCadence = trackerState.typingIntervals.length > 0
        ? trackerState.typingIntervals.reduce((a, b) => a + b) / trackerState.typingIntervals.length
        : 0;

    // Hesitation
    let hesitation = 0;
    if (trackerState.pinEntryCompleteTime) {
        hesitation = endTime - trackerState.pinEntryCompleteTime;
    } else {
        hesitation = timeToSubmit; 
    }

    return {
        time_to_submit_ms: timeToSubmit,
        click_count: trackerState.clickCount,
        keystroke_count: trackerState.keystrokesCount,
        backspace_count: trackerState.backspaceCount,
        avg_typing_cadence_ms: Math.round(avgTypingCadence),
        hesitation_ms: hesitation,
        mouse_movements: trackerState.mouseMovements,
        device_fingerprint: {
            user_agent: navigator.userAgent,
            platform: navigator.platform || navigator.userAgentData?.platform || 'Unknown',
            screen_resolution: `${window.screen.width}x${window.screen.height}`,
            language: navigator.language
        }
    };
}

function updateDebugPanel() {
    if (trackerState.isComplete) return;
    const payload = getBehavioralPayload();
    debugMetrics.innerText = JSON.stringify(payload, null, 2);
}

// Update debug roughly every 500ms
setInterval(() => {
    if (trackerState.startTime && !trackerState.isComplete) {
        updateDebugPanel();
    }
}, 500);

// Form Submission handling
document.getElementById('payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    trackerState.isComplete = true; // Stop tracking live

    const payload = getBehavioralPayload();
    updateDebugPanel();

    const btnText = payBtn.querySelector('span');
    const btnLoader = document.getElementById('btn-loader');

    // UI state
    btnText.style.opacity = '0';
    btnLoader.classList.remove('hidden');
    payBtn.disabled = true;

    // Simulate E2E Encryption Step
    console.log("[SECURITY] Encrypting biometric payload with public key before transmission...");
    debugMetrics.innerText = "[ENCRYPTING PAYLOAD]\n" + debugMetrics.innerText;

    // Simulate slight encryption overhead
    await new Promise(r => setTimeout(r, 150));

    try {
        
        let response;
        try {
            response = await fetch('http://127.0.0.1:8002/evaluate_risk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            response = await response.json();
        } catch (err) {
            console.warn("Backend not reachable. Falling back to mock heuristic model.");
           
            const isHighRisk = (payload.time_to_submit_ms < 4000) || (payload.hesitation_ms < 200);
            const isPanic = (payload.time_to_submit_ms < 6000) ||
                (payload.avg_typing_cadence_ms < 150) ||
                (payload.hesitation_ms < 500);

            let calculatedRiskScore = 25;
            if (isHighRisk) {
                calculatedRiskScore = 95;
            } else if (isPanic) {
                calculatedRiskScore = 88;
            }

            response = {
                risk_score: calculatedRiskScore,
                panic_detected: isPanic,
                inference_time_ms: 12.4
            };
        }

        // Handle response
        console.log("Evaluation Response:", response);

        // Local fallback broadcast for Dashboard
        const txEvent = {
            id: response.id || (Date.now() + Math.random()),
            timestamp: Date.now(),
            risk_score: response.risk_score,
            panic_detected: response.panic_detected,
            behavior: payload,
            device: payload.device_fingerprint,
            amount: amountInput.value
        };
        localStorage.setItem('latest_tx', JSON.stringify(txEvent));

        btnText.style.opacity = '1';
        btnLoader.classList.add('hidden');
        payBtn.disabled = false;

       

        if (response.risk_score >= 90) {
            if (failedModal) {
                failedModal.classList.remove('hidden');
                const riskScoreSpan = document.getElementById('failed-risk-score');
                if (riskScoreSpan) riskScoreSpan.innerText = response.risk_score.toFixed(2);
            } else {
                alert(`Transaction Blocked! Risk Score: ${response.risk_score.toFixed(2)}`);
                resetForm();
            }
        } else if (response.panic_detected) {
            modal.classList.remove('hidden');
            startCooldownTimer();
        } else {
            alert(`Payment Successful! Risk Score: ${response.risk_score.toFixed(2)}`);
            resetForm();
        }

    } catch (err) {
        console.error(err);
        alert("An error occurred.");
        btnText.style.opacity = '1';
        btnLoader.classList.add('hidden');
        payBtn.disabled = false;
    }
});

function resetForm() {
    amountInput.value = '';
    pinInput.value = '';
    trackerState.startTime = null;
    trackerState.clickCount = 0;
    trackerState.keystrokesCount = 0;
    trackerState.backspaceCount = 0;
    trackerState.lastKeystrokeTime = null;
    trackerState.typingIntervals = [];
    trackerState.mouseMovements = 0;
    trackerState.hesitationTime = 0;
    trackerState.pinEntryCompleteTime = null;
    trackerState.isComplete = false;

    // reset timer UI
    proceedBtn.disabled = true;
    proceedBtn.innerHTML = `Wait <span id="cooldown-timer">10</span>s`;
    if (timerInterval) clearInterval(timerInterval);

    updateDebugPanel();
}

let timerInterval;
function startCooldownTimer() {
    let timeLeft = 10;
    proceedBtn.disabled = true;
    proceedBtn.innerHTML = `Wait <span id="cooldown-timer">${timeLeft}</span>s`;

    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            proceedBtn.disabled = false;
            proceedBtn.innerHTML = `Proceed Anyway`;
        } else {
            proceedBtn.innerHTML = `Wait <span id="cooldown-timer">${timeLeft}</span>s`;
        }
    }, 1000);
}

cancelBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    resetForm();
});

proceedBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    alert("Payment Sent. (Bypassed Warning)");
    resetForm();
});

if (closeFailedBtn) {
    closeFailedBtn.addEventListener('click', () => {
        failedModal.classList.add('hidden');
        resetForm();
    });
}
