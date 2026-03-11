// dashboard.js
// Connects to the backend WebSocket for live transaction monitoring from the Edge Engine

let totalTxCount = 0;
let totalPanicCount = 0;

const txTableBody = document.getElementById('tx-body');
const totalTxEl = document.getElementById('total-tx');
const totalPanicEl = document.getElementById('total-panic');

let isLiveMode = true;

function connectWebSocket() {
    const sysStatus = document.querySelector('.system-status');
    sysStatus.innerHTML = `<div class="status-indicator" style="background: #f59e0b;"></div> Connecting to Edge Engine...`;

    const ws = new WebSocket('ws://127.0.0.1:8002/ws/dashboard');

    ws.onopen = () => {
        sysStatus.innerHTML = `<div class="status-indicator" style="background: #10b981;"></div> Edge Target: LIVE STREAM`;
    };

    const processedTxIds = new Set();

    // available globally to be reused by localStorage
    window.handleNewTx = function (tx) {
        const txId = tx.id || tx.timestamp;
        if (processedTxIds.has(txId)) return;
        processedTxIds.add(txId);

        // Remove empty state text when first transaction arrives
        if (totalTxCount === 0 && txTableBody.querySelector('.empty-state')) {
            txTableBody.innerHTML = '';
        }
        insertTransactionRow(tx);
    };

    ws.onmessage = (event) => {
        const tx = JSON.parse(event.data);
        window.handleNewTx(tx);
    };

    ws.onclose = () => {
        sysStatus.innerHTML = `<div class="status-indicator" style="background: #ef4444;"></div> Edge Target: DISCONNECTED (Retrying...)`;
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
    };
}

let lastPollingTxId = null;
setInterval(() => {
    try {
        const txData = localStorage.getItem('latest_tx');
        if (txData) {
            const tx = JSON.parse(txData);
            const txId = tx.id || tx.timestamp;
            if (txId !== lastPollingTxId) {
                lastPollingTxId = txId;
                if (window.handleNewTx) {
                    window.handleNewTx(tx);
                }
            }
        }
    } catch (e) {
        console.error("Local storage fallback error", e);
    }
}, 500);

function insertTransactionRow(tx) {
    totalTxCount++;
    if (tx.panic_detected || tx.risk_score >= 90) totalPanicCount++;

    // Update Stats
    totalTxEl.innerText = totalTxCount;
    totalPanicEl.innerText = totalPanicCount;

    // Create Row Element
    const tr = document.createElement('tr');
    tr.className = 'new-row';

    const timeString = new Date(tx.timestamp).toLocaleTimeString();

    let severityBadge;
    if (tx.risk_score >= 90) {
        severityBadge = `<span class="badge danger" style="background: #dc2626; border-color: #f87171;">BLOCKED: HIGH RISK</span>`;
    } else if (tx.panic_detected) {
        severityBadge = `<span class="badge danger">INTERCEPTED: PANIC SCAM</span>`;
    } else {
        severityBadge = `<span class="badge safe">APPROVED</span>`;
    }

    const interactionSpeedHtml = (tx.panic_detected || tx.risk_score >= 90)
        ? `<span class="metric-high">${tx.behavior.avg_typing_cadence_ms}ms/key (Fast!)</span>`
        : `<span class="metric-normal">${tx.behavior.avg_typing_cadence_ms}ms/key</span>`;

    const amt = tx.amount || Math.floor(Math.random() * 50000) + 1000;

    tr.innerHTML = `
        <td>${timeString}</td>
        <td>₹${Number(amt).toLocaleString()}</td>
        <td>${interactionSpeedHtml}</td>
        <td><strong style="color: ${tx.risk_score >= 90 ? '#dc2626' : (tx.panic_detected ? '#ef4444' : '#f8fafc')}">${Number(tx.risk_score).toFixed(1)}/100</strong></td>
        <td>${severityBadge}</td>
    `;

    // Prepend to top
    if (txTableBody.firstChild) {
        txTableBody.insertBefore(tr, txTableBody.firstChild);
    } else {
        txTableBody.appendChild(tr);
    }
}

// Navigation & Historical Data
document.getElementById('nav-live').addEventListener('click', (e) => {
    e.preventDefault();
    isLiveMode = true;
    document.getElementById('nav-live').classList.add('active');
    document.getElementById('nav-history').classList.remove('active');
    txTableBody.innerHTML = '<tr class="empty-state"><td colspan="5">Awaiting transactions from Edge devices...</td></tr>';
    totalTxCount = 0;
    totalPanicCount = 0;
    totalTxEl.innerText = '0';
    totalPanicEl.innerText = '0';
    processedTxIds.clear();
    lastPollingTxId = null;
});

document.getElementById('nav-history').addEventListener('click', async (e) => {
    e.preventDefault();
    isLiveMode = false;
    document.getElementById('nav-history').classList.add('active');
    document.getElementById('nav-live').classList.remove('active');

    txTableBody.innerHTML = '<tr><td colspan="5">Loading historical data from SQLite...</td></tr>';

    try {
        const response = await fetch('http://127.0.0.1:8002/transactions');
        const result = await response.json();

        if (result.status === 'success') {
            totalTxCount = 0;
            totalPanicCount = 0;
            txTableBody.innerHTML = '';

            if (result.data.length === 0) {
                txTableBody.innerHTML = '<tr class="empty-state"><td colspan="5">No historical transactions found in database.</td></tr>';
            } else {
                
                result.data.reverse().forEach(tx => insertTransactionRow(tx));
            }
        } else {
            txTableBody.innerHTML = `<tr><td colspan="5" style="color:red;">Error loading history: Backend offline</td></tr>`;
        }
    } catch (err) {
        txTableBody.innerHTML = `<tr><td colspan="5" style="color:red;">Backend Edge API Unreachable. Cannot fetch SQLite history.</td></tr>`;
    }
});

// Boot up
window.addEventListener('DOMContentLoaded', connectWebSocket);
