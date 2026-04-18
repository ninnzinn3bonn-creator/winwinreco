(function initUtilsNamespace() {
    function generateLocalUserId() {
        if (window.crypto?.randomUUID) {
            return window.crypto.randomUUID();
        }
        return `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function getJoinUrl(roomId) {
        const url = new URL(window.location.origin + window.location.pathname);
        url.searchParams.set('room', roomId);
        return url.toString();
    }

    function isSecureContextForMedia() {
        return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    }

    function isMobileViewport() {
        return window.matchMedia('(max-width: 1023px)').matches;
    }

    function clampThresholdPair(minValue, maxValue) {
        const safeMin = Math.max(0.01, Math.min(0.4, minValue));
        const safeMax = Math.max(safeMin + 0.05, Math.min(1, maxValue));
        return { min: safeMin, max: safeMax };
    }

    function getPreferredAudioConstraints(preset = {}) {
        const constraints = preset.constraints || {};
        return {
            audio: {
                echoCancellation: constraints.echoCancellation ?? false,
                noiseSuppression: constraints.noiseSuppression ?? false,
                autoGainControl: constraints.autoGainControl ?? false,
                channelCount: constraints.channelCount ?? 1,
                sampleRate: constraints.sampleRate ?? 16000
            }
        };
    }

    function resampleToTargetRate(inputData, sourceRate, targetRate) {
        if (!inputData || !inputData.length || sourceRate === targetRate) {
            return inputData;
        }

        const ratio = sourceRate / targetRate;
        const outputLength = Math.max(1, Math.round(inputData.length / ratio));
        const output = new Float32Array(outputLength);

        let outputIndex = 0;
        let inputIndex = 0;
        while (outputIndex < outputLength) {
            const nextInputIndex = Math.min(inputData.length, Math.round((outputIndex + 1) * ratio));
            let sum = 0;
            let count = 0;
            for (let i = inputIndex; i < nextInputIndex; i += 1) {
                sum += inputData[i];
                count += 1;
            }
            output[outputIndex] = count ? (sum / count) : inputData[Math.min(inputIndex, inputData.length - 1)];
            outputIndex += 1;
            inputIndex = nextInputIndex;
        }

        return output;
    }

    function formatTime(value) {
        return new Date(value).toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function highlightText(text, query) {
        if (!query) return escapeHtml(text);
        const pattern = new RegExp(`(${escapeRegExp(query)})`, 'ig');
        return escapeHtml(text).replace(pattern, '<mark>$1</mark>');
    }

    function shortenText(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return `${text.slice(0, maxLength - 1)}…`;
    }

    function downloadTextFile(filename, content) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    window.AppUtils = {
        generateLocalUserId,
        getJoinUrl,
        isSecureContextForMedia,
        isMobileViewport,
        clampThresholdPair,
        getPreferredAudioConstraints,
        resampleToTargetRate,
        formatTime,
        escapeHtml,
        escapeRegExp,
        highlightText,
        shortenText,
        downloadTextFile
    };
})();
