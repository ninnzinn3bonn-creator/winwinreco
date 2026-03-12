const DebugMonitor = {
    logs: [],
    pingInterval: null,

    init() {
        this.cacheDOM();
        this.bindEvents();
        this.startMonitoring();
    },

    cacheDOM() {
        this.monitorEl = document.getElementById('debug-monitor');
        this.floatBtn = document.getElementById('btn-debug-float');
        this.micStatusEl = document.getElementById('debug-mic-status');
        this.pingEl = document.getElementById('debug-ping');
        this.errorCountEl = document.getElementById('debug-error-count');
    },

    bindEvents() {
        document.getElementById('btn-debug-float').addEventListener('click', () => this.toggle());
        document.getElementById('btn-debug-toggle').addEventListener('click', () => this.toggle());
        document.getElementById('btn-debug-copy').addEventListener('click', () => this.copyLogs());
        document.getElementById('btn-debug-download').addEventListener('click', () => this.downloadLogs());

        // Override console.error to capture frontend errors
        const originalError = console.error;
        console.error = (...args) => {
            this.log('error', args.join(' '));
            originalError.apply(console, args);
        };

        // Window errors
        window.addEventListener('error', (e) => {
            this.log('error', `Global Error: ${e.message} at ${e.filename}:${e.lineno}`);
        });

        // Unhandled promise rejections
        window.addEventListener('unhandledrejection', (e) => {
            this.log('error', `Unhandled Promise: ${e.reason}`);
        });
    },

    toggle() {
        this.monitorEl.classList.toggle('hidden');
    },

    log(level, message, details = null) {
        const entry = { time: new Date().toISOString(), level, message, details };
        this.logs.push(entry);
        
        if (level === 'error') {
            this.errorCountEl.innerText = this.logs.filter(l => l.level === 'error').length;
        }
    },

    async startMonitoring() {
        // Monitor Microphone Status (if supported by browser)
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const result = await navigator.permissions.query({ name: 'microphone' });
                this.updateMicStatus(result.state);
                
                result.onchange = () => {
                    this.updateMicStatus(result.state);
                    this.log('info', `Microphone permission changed to: ${result.state}`);
                };
            } catch (e) {
                this.updateMicStatus('unknown');
                this.log('warn', 'Permissions API not fully supported for microphone query');
            }
        } else {
            this.updateMicStatus('unsupported');
        }

        // Monitor Network Ping
        this.pingInterval = setInterval(async () => {
            const start = performance.now();
            try {
                await fetch('/api/status', { method: 'HEAD', cache: 'no-store' });
                const latency = performance.now() - start;
                this.pingEl.innerText = Math.round(latency);
            } catch (e) {
                this.pingEl.innerText = 'ERR';
                this.log('error', 'Ping failed', e.message);
            }
        }, 5000);
    },

    updateMicStatus(status) {
        this.micStatusEl.innerText = status;
        if (status === 'granted') this.micStatusEl.style.color = '#4ade80';
        else if (status === 'denied') this.micStatusEl.style.color = '#f87171';
        else this.micStatusEl.style.color = '#fbbf24';
    },

    copyLogs() {
        const data = JSON.stringify(this.logs, null, 2);
        navigator.clipboard.writeText(data)
            .then(() => alert('デバッグログをクリップボードにコピーしました'))
            .catch(err => alert('コピーに失敗しました: ' + err));
    },

    downloadLogs() {
        const data = JSON.stringify(this.logs, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meeting-debug-${new Date().getTime()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    DebugMonitor.init();
    window.DebugMonitor = DebugMonitor; // Expose globally to let other scripts log custom events
});
