/**
 * Generates the HTML UI for web pairing
 * Supports both QR Code and Pairing Code methods
 */

export function generatePairingUI() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NOVA-MD - WhatsApp Bot Setup</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
            --bg: #050508;
            --surface: rgba(255,255,255,0.03);
            --border: rgba(255,255,255,0.07);
            --neon: #00ff88;
            --neon2: #00cfff;
            --text: #e8eaf0;
            --muted: rgba(232,234,240,0.4);
            --error: #ff4757;
            --success: #00ff88;
        }

        html { width: 100%; min-height: 100%; }
        body {
            background: var(--bg);
            color: var(--text);
            font-family: 'Syne', sans-serif;
            min-height: 100vh;
            overflow-x: hidden;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            position: relative;
        }

        #bg-canvas {
            position: fixed;
            inset: 0;
            z-index: 0;
            pointer-events: none;
        }

        body::before {
            content: '';
            position: fixed;
            inset: 0;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
            pointer-events: none;
            z-index: 1;
            opacity: 0.6;
        }

        .orb {
            position: fixed;
            border-radius: 50%;
            filter: blur(120px);
            pointer-events: none;
            z-index: 0;
        }
        .orb-1 {
            width: 600px; height: 600px;
            background: radial-gradient(circle, rgba(0,255,136,0.1), transparent 70%);
            top: -200px; left: -200px;
            animation: drift1 18s ease-in-out infinite alternate;
        }
        .orb-2 {
            width: 500px; height: 500px;
            background: radial-gradient(circle, rgba(0,207,255,0.09), transparent 70%);
            bottom: -150px; right: -150px;
            animation: drift2 22s ease-in-out infinite alternate;
        }
        .orb-3 {
            width: 350px; height: 350px;
            background: radial-gradient(circle, rgba(162,89,255,0.07), transparent 70%);
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            animation: drift3 15s ease-in-out infinite alternate;
        }

        @keyframes drift1 { to { transform: translate(100px, 80px); } }
        @keyframes drift2 { to { transform: translate(-80px, -100px); } }
        @keyframes drift3 { to { transform: translate(-50%, -50%) scale(1.4); } }

        .wrapper {
            position: relative;
            z-index: 2;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: clamp(48px, 8vh, 80px) clamp(16px, 4vw, 32px);
            width: 100%;
            max-width: 720px;
        }

        .badge {
            font-family: 'DM Mono', monospace;
            font-size: 11px;
            letter-spacing: 2px;
            color: var(--neon);
            text-transform: uppercase;
            margin-bottom: 12px;
            opacity: 0.8;
        }

        h1 {
            font-size: clamp(2rem, 8vw, 3.5rem);
            font-weight: 800;
            background: linear-gradient(135deg, var(--neon) 0%, var(--neon2) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            line-height: 1.2;
            margin-bottom: 12px;
            letter-spacing: -1px;
        }

        .subtitle {
            font-size: clamp(0.9rem, 3vw, 1.1rem);
            color: var(--muted);
            margin-bottom: 36px;
            text-align: center;
            max-width: 500px;
        }

        .tabs {
            display: flex;
            gap: 12px;
            margin-bottom: 32px;
            background: var(--surface);
            padding: 8px;
            border-radius: 12px;
            border: 1px solid var(--border);
            width: 100%;
            max-width: 400px;
        }

        .tab-btn {
            flex: 1;
            padding: 12px 16px;
            border: none;
            background: transparent;
            color: var(--muted);
            font-family: 'Syne', sans-serif;
            font-weight: 600;
            cursor: pointer;
            border-radius: 8px;
            transition: all 0.3s ease;
            font-size: 0.95rem;
        }

        .tab-btn.active {
            background: linear-gradient(135deg, var(--neon) 0%, var(--neon2) 100%);
            color: var(--bg);
        }

        .tab-content {
            display: none;
            animation: fadeIn 0.3s ease;
        }

        .tab-content.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .qr-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 24px;
            padding: 32px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 16px;
            backdrop-filter: blur(10px);
        }

        #qrCode {
            width: 300px;
            height: 300px;
            padding: 16px;
            background: white;
            border-radius: 12px;
        }

        .qr-instructions {
            text-align: center;
            color: var(--muted);
            font-size: 0.9rem;
            line-height: 1.6;
        }

        .qr-instructions strong {
            color: var(--text);
        }

        .pair-form {
            display: flex;
            flex-direction: column;
            gap: 16px;
            padding: 32px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 16px;
            backdrop-filter: blur(10px);
            width: 100%;
            max-width: 400px;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        label {
            font-size: 0.9rem;
            font-weight: 600;
            color: var(--text);
        }

        input {
            padding: 12px 16px;
            background: rgba(0,0,0,0.3);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--text);
            font-family: 'DM Mono', monospace;
            font-size: 0.95rem;
            transition: all 0.3s ease;
        }

        input:focus {
            outline: none;
            border-color: var(--neon);
            box-shadow: 0 0 10px rgba(0, 255, 136, 0.2);
        }

        input::placeholder {
            color: var(--muted);
        }

        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-family: 'Syne', sans-serif;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.95rem;
        }

        .btn-primary {
            background: linear-gradient(135deg, var(--neon) 0%, var(--neon2) 100%);
            color: var(--bg);
        }

        .btn-primary:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 255, 136, 0.2);
        }

        .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .loading {
            display: none;
            align-items: center;
            gap: 12px;
            color: var(--neon);
            font-size: 0.9rem;
        }

        .loading.active {
            display: flex;
        }

        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--neon);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .status {
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 0.9rem;
            margin-top: 16px;
            display: none;
        }

        .status.active {
            display: block;
        }

        .status.success {
            background: rgba(0, 255, 136, 0.1);
            border: 1px solid var(--neon);
            color: var(--neon);
        }

        .status.error {
            background: rgba(255, 71, 87, 0.1);
            border: 1px solid var(--error);
            color: var(--error);
        }

        .pair-code-display {
            font-size: 2rem;
            font-family: 'DM Mono', monospace;
            font-weight: 700;
            text-align: center;
            color: var(--neon);
            padding: 24px;
            background: rgba(0, 255, 136, 0.05);
            border: 2px solid var(--neon);
            border-radius: 12px;
            margin: 24px 0;
            letter-spacing: 4px;
        }

        .hint {
            color: var(--muted);
            font-size: 0.85rem;
            text-align: center;
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>

    <canvas id="bg-canvas"></canvas>

    <div class="wrapper">
        <div class="badge">⚡ Bot Setup</div>
        <h1>Connect WhatsApp</h1>
        <p class="subtitle">Link your WhatsApp account to start the bot</p>

        <div class="tabs">
            <button class="tab-btn active" onclick="switchTab('qr')">📱 QR Code</button>
            <button class="tab-btn" onclick="switchTab('pair')">🔢 Pairing Code</button>
        </div>

        <!-- QR Tab -->
        <div id="qr" class="tab-content active">
            <div class="qr-container">
                <div id="qrCode"></div>
                <div class="qr-instructions">
                    <strong>Instructions:</strong><br>
                    1. Open WhatsApp on your phone<br>
                    2. Go to Settings > Linked Devices<br>
                    3. Tap "Link a Device"<br>
                    4. Scan the QR code above
                </div>
                <div class="loading" id="qrLoading">
                    <div class="spinner"></div>
                    <span>Generating QR code...</span>
                </div>
                <div class="status" id="qrStatus"></div>
            </div>
        </div>

        <!-- Pair Tab -->
        <div id="pair" class="tab-content">
            <div class="pair-form">
                <div class="form-group">
                    <label for="phoneNumber">Phone Number</label>
                    <input type="tel" id="phoneNumber" placeholder="Ex: 212123456789" />
                    <div class="hint">Include country code without + symbol</div>
                </div>
                <button class="btn btn-primary" onclick="requestPairingCode()">Get Pairing Code</button>
                <div class="loading" id="pairLoading">
                    <div class="spinner"></div>
                    <span>Getting pairing code...</span>
                </div>
                <div id="pairingCodeContainer" style="display: none;">
                    <div class="pair-code-display" id="pairingCode"></div>
                    <div class="qr-instructions">
                        Use this code in WhatsApp Settings > Linked Devices > Link with Phone Number
                    </div>
                </div>
                <div class="status" id="pairStatus"></div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
    <script>
        let currentMode = 'qr';
        let qrSessionId = null;
        let pairSessionId = null;

        function switchTab(tab) {
            // Hide all tabs
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

            // Show selected tab
            document.getElementById(tab).classList.add('active');
            event.target.classList.add('active');
            currentMode = tab;

            if (tab === 'qr' && !qrSessionId) {
                initializeQR();
            }
        }

        async function initializeQR() {
            const loading = document.getElementById('qrLoading');
            const status = document.getElementById('qrStatus');
            const qrContainer = document.getElementById('qrCode');

            loading.classList.add('active');
            status.classList.remove('active');
            qrContainer.innerHTML = '';

            try {
                const response = await fetch('/api/pairing/qr/init', { method: 'GET' });
                const data = await response.json();

                if (!response.ok) throw new Error(data.error || 'Failed to initialize QR session');

                qrSessionId = data.sessionId;
                const qrDataURL = data.qr;

                // Clear and display QR
                qrContainer.innerHTML = '';
                const img = document.createElement('img');
                img.src = qrDataURL;
                img.style.width = '100%';
                img.style.height = '100%';
                qrContainer.appendChild(img);

                loading.classList.remove('active');
                waitForQRCompletion();
            } catch (err) {
                loading.classList.remove('active');
                showStatus('qrStatus', 'error', 'Failed: ' + err.message);
            }
        }

        async function waitForQRCompletion() {
            const status = document.getElementById('qrStatus');

            for (let i = 0; i < 60; i++) {
                try {
                    const response = await fetch(\`/api/pairing/qr/check/\${qrSessionId}\`);
                    const data = await response.json();

                    if (data.completed) {
                        showStatus('qrStatus', 'success', '✅ Connected! Restarting bot...');
                        setTimeout(() => location.reload(), 2000);
                        return;
                    }
                } catch (err) {}

                await new Promise(r => setTimeout(r, 5000));
            }

            showStatus('qrStatus', 'error', 'QR Code timeout. Please try again.');
        }

        async function requestPairingCode() {
            const phone = document.getElementById('phoneNumber').value;
            const loading = document.getElementById('pairLoading');
            const status = document.getElementById('pairStatus');
            const codeContainer = document.getElementById('pairingCodeContainer');

            if (!phone) {
                showStatus('pairStatus', 'error', 'Please enter a phone number');
                return;
            }

            loading.classList.add('active');
            status.classList.remove('active');
            codeContainer.style.display = 'none';

            try {
                const response = await fetch('/api/pairing/pair/init', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone })
                });

                const data = await response.json();

                if (!response.ok) throw new Error(data.error || 'Failed to get pairing code');

                pairSessionId = data.sessionId;
                document.getElementById('pairingCode').textContent = data.code;
                codeContainer.style.display = 'block';
                loading.classList.remove('active');

                waitForPairingCompletion();
            } catch (err) {
                loading.classList.remove('active');
                showStatus('pairStatus', 'error', 'Failed: ' + err.message);
            }
        }

        async function waitForPairingCompletion() {
            const status = document.getElementById('pairStatus');

            for (let i = 0; i < 60; i++) {
                try {
                    const response = await fetch(\`/api/pairing/pair/check/\${pairSessionId}\`);
                    const data = await response.json();

                    if (data.completed) {
                        showStatus('pairStatus', 'success', '✅ Connected! Restarting bot...');
                        setTimeout(() => location.reload(), 2000);
                        return;
                    }
                } catch (err) {}

                await new Promise(r => setTimeout(r, 5000));
            }

            showStatus('pairStatus', 'error', 'Pairing timeout. Please try again.');
        }

        function showStatus(elementId, type, message) {
            const el = document.getElementById(elementId);
            el.className = 'status active ' + type;
            el.textContent = message;
        }

        // Initialize QR on load
        window.addEventListener('load', () => initializeQR());
    </script>
</body>
</html>`;
}
