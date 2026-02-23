document.addEventListener("DOMContentLoaded", () => {
    // --- UI Elements ---
    const btnStart = document.getElementById("btn-start");
    const btnStop = document.getElementById("btn-stop");
    const statusBadge = document.getElementById("status-badge");

    // Inputs
    const targetUrlInput = document.getElementById("target_url");
    const usersInput = document.getElementById("users");
    const spawnRateInput = document.getElementById("spawn_rate");

    // Chaos Sliders
    const sliders = {
        latency_ms: { el: document.getElementById("latency_ms"), val: document.getElementById("latency_val") },
        latency_jitter_ms: { el: document.getElementById("latency_jitter_ms"), val: document.getElementById("jitter_val") },
        packet_loss_percent: { el: document.getElementById("packet_loss_percent"), val: document.getElementById("packet_loss_val") },
        rate_limit_percent: { el: document.getElementById("rate_limit_percent"), val: document.getElementById("rate_limit_val") },
        slowdown_multiplier: { el: document.getElementById("slowdown_multiplier"), val: document.getElementById("slowdown_val") },
    };

    // Stat Displays
    const statRps = document.getElementById("stat-rps");
    const statFails = document.getElementById("stat-fails");
    const statLatency = document.getElementById("stat-latency");
    const statUsers = document.getElementById("stat-users");

    // --- Chart Setup (Chart.js) ---
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'JetBrains Mono', monospace";
    
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        scales: {
            x: { 
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: { display: false } // Hide time labels for cleaner look
            },
            y: { 
                grid: { color: 'rgba(255,255,255,0.05)' },
                beginAtZero: true
            }
        },
        plugins: { legend: { position: 'top', labels: { color: '#f8fafc' } } }
    };

    const rpsCtx = document.getElementById('rpsChart').getContext('2d');
    const rpsChart = new Chart(rpsCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Requests / Sec (200 OK)',
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56,189,248,0.1)',
                    borderWidth: 2,
                    data: [],
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Failures / Sec (5xx/4xx)',
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244,63,94,0.1)',
                    borderWidth: 2,
                    data: [],
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: commonOptions
    });

    const latencyCtx = document.getElementById('latencyChart').getContext('2d');
    const latencyChart = new Chart(latencyCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Avg Latency (ms)',
                borderColor: '#fb923c',
                backgroundColor: 'rgba(251,146,60,0.1)',
                borderWidth: 2,
                data: [],
                fill: true,
                tension: 0.4
            }]
        },
        options: commonOptions
    });

    const MAX_DATA_POINTS = 60; // Keep last 60 seconds

    function updateCharts(timeStr, rps, fails, latency) {
        // Update RPS Chart
        rpsChart.data.labels.push(timeStr);
        rpsChart.data.datasets[0].data.push(rps);
        rpsChart.data.datasets[1].data.push(fails);
        
        if (rpsChart.data.labels.length > MAX_DATA_POINTS) {
            rpsChart.data.labels.shift();
            rpsChart.data.datasets[0].data.shift();
            rpsChart.data.datasets[1].data.shift();
        }
        rpsChart.update();

        // Update Latency Chart
        latencyChart.data.labels.push(timeStr);
        latencyChart.data.datasets[0].data.push(latency);
        
        if (latencyChart.data.labels.length > MAX_DATA_POINTS) {
            latencyChart.data.labels.shift();
            latencyChart.data.datasets[0].data.shift();
        }
        latencyChart.update();
    }

    // --- Backend Communication ---
    let ws = null;

    function connectWebSocket() {
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            // Update UI widgets
            statRps.textContent = data.total_rps.toFixed(1);
            statFails.textContent = data.total_failures.toFixed(1);
            statLatency.textContent = data.avg_response_time.toFixed(0) + ' ms';
            statUsers.textContent = data.user_count;

            // Update Charts
            const now = new Date();
            const timeStr = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
            updateCharts(timeStr, data.total_rps, data.total_failures, data.avg_response_time);
        };

        ws.onclose = () => {
            console.log("WebSocket Disconnected. Reconnecting in 3s...");
            setTimeout(connectWebSocket, 3000);
        };
    }

    connectWebSocket();

    // --- Event Listeners ---
    
    // Live Chaos Updates
    async function updateChaosConfig() {
        const payload = {
            latency_ms: parseInt(sliders.latency_ms.el.value),
            latency_jitter_ms: parseInt(sliders.latency_jitter_ms.el.value),
            packet_loss_percent: parseFloat(sliders.packet_loss_percent.el.value),
            rate_limit_percent: parseFloat(sliders.rate_limit_percent.el.value),
            slowdown_multiplier: parseFloat(sliders.slowdown_multiplier.el.value)
        };

        try {
            await fetch('/api/chaos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.error("Failed to update chaos config", e);
        }
    }

    // Bind slider inputs to display value & send to backend
    Object.keys(sliders).forEach(key => {
        const s = sliders[key];
        s.el.addEventListener('input', () => {
            let displayVal = s.el.value;
            if (key.includes('percent')) displayVal += '%';
            if (key.includes('multiplier')) displayVal += 'x';
            s.val.textContent = displayVal;
            updateChaosConfig();
        });
    });

    // Start / Stop Handling
    btnStart.addEventListener("click", async () => {
        const payload = {
            target_url: targetUrlInput.value || "https://jsonplaceholder.typicode.com/posts",
            users: parseInt(usersInput.value) || 10,
            spawn_rate: parseInt(spawnRateInput.value) || 2
        };

        const res = await fetch('/api/load/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            btnStart.disabled = true;
            btnStop.disabled = false;
            statusBadge.textContent = "Status: LOAD TESTING";
            statusBadge.className = "badge active";
        }
    });

    btnStop.addEventListener("click", async () => {
        const res = await fetch('/api/load/stop', { method: 'POST' });
        
        if (res.ok) {
            btnStart.disabled = false;
            btnStop.disabled = true;
            statusBadge.textContent = "Status: IDLE";
            statusBadge.className = "badge idle";
            
            // Reset active stats
            statRps.textContent = "0";
            statFails.textContent = "0";
            statLatency.textContent = "0 ms";
            statUsers.textContent = "0";
        }
    });

    // Send initial chaos config just to be safe
    updateChaosConfig();
});
