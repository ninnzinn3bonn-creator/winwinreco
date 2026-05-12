const DebugMonitor = {
    logs: [],
    pingInterval: null,

    init() {
        this.cacheDOM();
        this.bindEvents();
        this.startMonitoring();
        this.log('info', 'Debug Monitor Initialized');
    },

    cacheDOM() {
        this.monitorEl = document.getElementById('debug-monitor');
        this.logViewEl = document.getElementById('debug-log-view');
        this.micStatusEl = document.getElementById('debug-mic-status');
        this.pingEl = document.getElementById('debug-ping');
        this.errorCountEl = document.getElementById('debug-error-count');
    },

    bindEvents() {
        document.getElementById('btn-debug-float').addEventListener('click', () => this.toggle());
        document.getElementById('btn-debug-toggle').addEventListener('click', () => this.toggle());
        document.getElementById('btn-debug-clear').addEventListener('click', () => this.clearLogs());
        document.getElementById('btn-debug-copy').addEventListener('click', () => this.copyLogs());
        document.getElementById('btn-debug-download').addEventListener('click', () => this.downloadLogs());

        // Override console functions to capture all logs
        const originalLog = console.log;
        console.log = (...args) => {
            this.log('info', args.join(' '));
            originalLog.apply(console, args);
        };

        const originalWarn = console.warn;
        console.warn = (...args) => {
            this.log('warn', args.join(' '));
            originalWarn.apply(console, args);
        };

        const originalError = console.error;
        console.error = (...args) => {
            this.log('error', args.join(' '));
            originalError.apply(console, args);
        };

        // Window errors
        window.addEventListener('error', (e) => {
            this.log('error', `Global Error: ${e.message}`, { file: e.filename, line: e.lineno });
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
        const entry = { 
            time: new Date().toLocaleTimeString('ja-JP', { hour12: false }), 
            level, 
            message, 
            details 
        };
        this.logs.push(entry);
        
        // UI Reflection
        if (this.logViewEl) {
            const div = document.createElement('div');
            div.className = `debug-log-entry ${level}`;
            
            let detailsHtml = '';
            if (details) {
                const detailsStr = typeof details === 'object' ? JSON.stringify(details) : details;
                detailsHtml = `<span class="details">${detailsStr}</span>`;
            }

            div.innerHTML = `<span class="time">[${entry.time}]</span> <span class="msg">${message}</span>${detailsHtml}`;
            this.logViewEl.appendChild(div);
            
            // Keep scroll at bottom
            this.logViewEl.scrollTop = this.logViewEl.scrollHeight;
        }

        if (level === 'error') {
            const errCount = this.logs.filter(l => l.level === 'error').length;
            if (this.errorCountEl) this.errorCountEl.innerText = errCount;
        }
    },

    clearLogs() {
        this.logs = [];
        if (this.logViewEl) this.logViewEl.innerHTML = '';
        if (this.errorCountEl) this.errorCountEl.innerText = '0';
        this.log('info', 'Logs cleared');
    },

    async startMonitoring() {
        // Monitor Microphone Status
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const result = await navigator.permissions.query({ name: 'microphone' });
                this.updateMicStatus(result.state);
                result.onchange = () => {
                    this.updateMicStatus(result.state);
                    this.log('info', `Mic permission changed: ${result.state}`);
                };
            } catch (e) {
                this.updateMicStatus('unknown');
            }
        } else {
            this.updateMicStatus('unsupported');
        }

        // Monitor Network Ping
        this.pingInterval = setInterval(async () => {
            const start = performance.now();
            try {
                const res = await fetch('/api/status', { method: 'HEAD', cache: 'no-store' });
                const latency = performance.now() - start;
                if (this.pingEl) this.pingEl.innerText = Math.round(latency);
                if (!res.ok) this.log('warn', `Ping status not OK: ${res.status}`);
            } catch (e) {
                if (this.pingEl) this.pingEl.innerText = 'ERR';
                this.log('error', 'Ping failed (Network/CORS?)', e.message);
            }
        }, 10000);
    },

    updateMicStatus(status) {
        if (!this.micStatusEl) return;
        this.micStatusEl.innerText = status;
        if (status === 'granted') this.micStatusEl.style.color = '#4ade80';
        else if (status === 'denied') this.micStatusEl.style.color = '#f87171';
        else this.micStatusEl.style.color = '#fbbf24';
    },

    copyLogs() {
        const data = JSON.stringify(this.logs, null, 2);
        navigator.clipboard.writeText(data)
            .then(() => window.AppToast?.success('コピーしました'))
            .catch(err => window.AppToast?.error('コピー失敗', { detail: String(err) }));
    },

    downloadLogs() {
        const data = JSON.stringify(this.logs, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `debug-${new Date().getTime()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    DebugMonitor.init();
    window.DebugMonitor = DebugMonitor;
});
