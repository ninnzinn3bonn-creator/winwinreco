let state = {
    roomId: null,
    participantId: null,
    displayName: null,
    ws: null,
    stream: null,
    speakerColors: new Map(), // participantId -> colorIndex
    lastAnalyzedIndex: -1,
    lastProcessedTimestamp: null,
    currentUtterances: [],
    aiProvider: 'gemini',
    aiModel: 'gemini-2.5-flash'
};

// UI Elements
const setupScreen = document.getElementById('setup-screen');
const meetingScreen = document.getElementById('meeting-screen');
const summaryScreen = document.getElementById('summary-screen');
const timeline = document.getElementById('timeline');
const summaryLog = document.getElementById('summary-log');
const roomInfo = document.getElementById('room-info');
const summaryInfo = document.getElementById('summary-info');
const selfInfo = document.getElementById('self-info');
const sidePanel = document.querySelector('.side-panel');
const treeContainer = document.getElementById('topic-tree-container');
const treeContent = document.getElementById('topic-tree-content');
const resizerH = document.getElementById('resizer');
const resizerV = document.getElementById('resizer-v');

// Event Listeners
document.getElementById('btn-create').onclick = createRoom;
document.getElementById('btn-join').onclick = joinRoom;
document.getElementById('btn-end').onclick = endRoom;
document.getElementById('btn-copy-room').onclick = copyRoomId;
document.getElementById('btn-download').onclick = downloadMinutes;
document.getElementById('btn-download-final').onclick = downloadMinutes;
document.getElementById('btn-home').onclick = () => location.reload();

// Meeting Footer Actions
document.getElementById('btn-memo').onclick = addMemo;
document.getElementById('btn-save').onclick = downloadMinutes;

// Quick AI (In-Meeting)
document.getElementById('btn-quick-tree').onclick = analyzeTopicTree;
document.getElementById('btn-quick-summary').onclick = () => analyzeMeeting('summary', 'quick');
document.getElementById('btn-quick-todo').onclick = () => analyzeMeeting('todo', 'quick');

// AI Summary Screen Actions
document.getElementById('tab-log').onclick = () => switchTab('log');
document.getElementById('tab-ai').onclick = () => switchTab('ai');
document.getElementById('btn-ai-tree').onclick = () => analyzeMeeting('topic_tree', 'full');
document.getElementById('btn-ai-summary').onclick = () => analyzeMeeting('summary', 'full');
document.getElementById('btn-ai-todo').onclick = () => analyzeMeeting('todo', 'full');
document.getElementById('btn-ai-custom').onclick = () => analyzeMeeting('custom', 'full');

// --- AI Engine Config Logic ---
document.getElementById('ai-provider').onchange = (e) => {
    const provider = e.target.value;
    const modelInput = document.getElementById('ai-model');
    state.aiProvider = provider;
    if (provider === 'gemini') {
        modelInput.value = 'gemini-2.5-flash';
    } else if (provider === 'ollama') {
        modelInput.value = 'gpt-oss:20b';
    }
    state.aiModel = modelInput.value;
};

document.getElementById('ai-model').oninput = (e) => {
    state.aiModel = e.target.value;
};

// --- Resizer Logic ---
let isResizingH = false;
let isResizingV = false;

// Horizontal Resizer (for Mobile height)
resizerH.addEventListener('mousedown', (e) => {
    isResizingH = true;
    document.body.style.cursor = 'row-resize';
});

// Vertical Resizer (for PC width)
resizerV.addEventListener('mousedown', (e) => {
    isResizingV = true;
    document.body.style.cursor = 'col-resize';
});

document.addEventListener('mousemove', (e) => {
    if (isResizingH) {
        const appRect = document.getElementById('app').getBoundingClientRect();
        const headerHeight = document.querySelector('#meeting-screen header').offsetHeight;
        let newHeight = e.clientY - appRect.top - headerHeight;
        const minHeight = 100;
        const maxHeight = appRect.height * 0.7;
        if (newHeight < minHeight) newHeight = minHeight;
        if (newHeight > maxHeight) newHeight = maxHeight;
        sidePanel.style.height = `${newHeight}px`;
    }
    
    if (isResizingV) {
        const appRect = document.getElementById('app').getBoundingClientRect();
        let newWidth = e.clientX - appRect.left;
        const minWidth = 200;
        const maxWidth = appRect.width * 0.6;
        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > maxWidth) newWidth = maxWidth;
        sidePanel.style.width = `${newWidth}px`;
    }
});

document.addEventListener('mouseup', () => {
    isResizingH = false;
    isResizingV = false;
    document.body.style.cursor = 'default';
});

// --- Memo Logic ---
function addMemo() {
    const memo = prompt('メモを入力してください:');
    if (memo) {
        addSystemMessage(`📝 メモ: ${memo}`);
    }
}

// --- Topic Tree Analysis Logic ---
async function analyzeTopicTree() {
    if (!state.roomId) return alert('ルームIDがありません');
    if (document.getElementById('btn-quick-tree').classList.contains('analyzing')) return;

    const snapshotIndex = state.currentUtterances.length - 1;
    const newUtterances = state.currentUtterances.slice(state.lastAnalyzedIndex + 1, snapshotIndex + 1);
    
    if (newUtterances.length === 0 && state.lastAnalyzedIndex !== -1) {
        return alert('新しい発言がありません');
    }
    
    // Broadcast analysis start to lock buttons for everyone
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'topic_analyzing', participant_id: state.participantId }));
    }

    setAnalyzingState(true);
    DebugMonitor.log('info', `Starting Topic Tree Analysis... (New: ${newUtterances.length}, Up to: ${snapshotIndex})`);
    
    // Capture current tree text
    const currentTreeText = Array.from(treeContent.querySelectorAll('.topic-node'))
        .map(node => {
            const level = parseInt(node.dataset.level);
            const text = node.querySelector('span:last-child').innerText;
            return '  '.repeat(level) + (level > 0 ? '└ ' : '') + text;
        }).join('\n');

    try {
        const payload = { 
            type: 'topic_tree',
            last_timestamp: state.lastProcessedTimestamp,
            current_tree: currentTreeText,
            instruction: state.lastProcessedTimestamp ? 'これは差分解析です。既存のツリーに新しい議論を統合してください。' : '',
            ai_config: {
                provider: state.aiProvider,
                model: state.aiModel
            }
        };

        const res = await fetch(`/rooms/${state.roomId}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (res.status === 429) {
            throw new Error('AIの利用制限（クォータ）を超えました。30秒ほど待つか、設定で「Ollama (ローカル)」に切り替えてください。');
        }
        
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        if (data.result) {
            DebugMonitor.log('info', 'Analysis Success. Broadcasting results...');
            const updateMsg = {
                type: 'topic_update',
                result: data.result,
                latest_timestamp: data.latest_timestamp,
                last_analyzed_index: snapshotIndex,
                provider: data.provider
            };
            
            applyTopicUpdate(updateMsg);

            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify(updateMsg));
            }
        }
    } catch (e) {
        DebugMonitor.log('error', 'Topic Tree Analysis Failed', e.message);
        alert('解析に失敗しました: ' + e.message);
        setAnalyzingState(false);
    }
}

function setAnalyzingState(isAnalyzing) {
    const btn = document.getElementById('btn-quick-tree');
    const container = document.getElementById('topic-tree-container');
    const indicator = document.querySelector('.recording-indicator');
    
    if (isAnalyzing) {
        btn.classList.add('analyzing');
        btn.innerText = '解析中...';
        container.classList.add('loading');
        
        // Reflect the "unfixable specification" in the UI
        if (indicator) indicator.classList.add('paused');
        addSystemMessage('トピック解析中のため、文字起こしを一時停止しています...');
        
        // Stop recording to avoid resource conflict during heavy AI task
        // We still keep the stream/context, just stop the processor data flow
        if (state.processor) {
            state.processor.disconnect();
            state.processor.onaudioprocess = null;
            state.processor = null;
        }
    } else {
        btn.classList.remove('analyzing');
        btn.innerText = 'トピック';
        container.classList.remove('loading');
        
        if (indicator) indicator.classList.remove('paused');
        addSystemMessage('文字起こしを再開しました。');
        
        // Resume recording
        startRecording();
    }
}

function applyTopicUpdate(data) {
    DebugMonitor.log('info', 'Applying Topic Tree Update', { provider: data.provider });
    renderTreeNodes(data.result);
    state.lastProcessedTimestamp = data.latest_timestamp;
    state.lastAnalyzedIndex = data.last_analyzed_index;
    setAnalyzingState(false);
}

function renderTreeNodes(text) {
    treeContent.innerHTML = '';
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const nodeData = lines.map(line => {
        const leadingSpaces = line.search(/\S/);
        let level = Math.floor(leadingSpaces / 2);
        if (line.includes('├') || line.includes('└')) level = Math.max(level, 1);
        const cleanText = line.replace(/[└├│\-|]/g, '').trim();
        return { text: cleanText, level: Math.min(level, 3) };
    });

    nodeData.forEach((data, index) => {
        const node = document.createElement('span');
        node.className = `topic-node level-${data.level}`;
        node.dataset.index = index;
        node.dataset.level = data.level;
        const hasChildren = nodeData[index + 1] && nodeData[index + 1].level > data.level;
        if (hasChildren) {
            node.classList.add('collapsible');
            const stateIcon = document.createElement('span');
            stateIcon.className = 'state-icon';
            stateIcon.innerText = '▼ ';
            node.appendChild(stateIcon);
        } else if (data.level > 0) {
            const icon = document.createElement('span');
            icon.className = 'node-icon';
            icon.innerText = '↳ ';
            node.appendChild(icon);
        }
        const textSpan = document.createElement('span');
        textSpan.innerText = data.text;
        node.appendChild(textSpan);
        node.onclick = () => toggleNode(node, index, data.level);
        treeContent.appendChild(node);
    });
    if (treeContent.children.length === 0) {
        treeContent.innerHTML = '<span class="placeholder-text">解析結果が空でした</span>';
    }
}

function toggleNode(clickedNode, index, level) {
    if (!clickedNode.classList.contains('collapsible')) return;
    const isCollapsing = !clickedNode.classList.contains('collapsed');
    clickedNode.classList.toggle('collapsed');
    const stateIcon = clickedNode.querySelector('.state-icon');
    if (stateIcon) stateIcon.innerText = isCollapsing ? '▶ ' : '▼ ';
    const allNodes = Array.from(treeContent.querySelectorAll('.topic-node'));
    for (let i = index + 1; i < allNodes.length; i++) {
        const nextNode = allNodes[i];
        const nextLevel = parseInt(nextNode.dataset.level);
        if (nextLevel <= level) break;
        if (isCollapsing) { nextNode.classList.add('node-hidden'); }
        else {
            nextNode.classList.remove('node-hidden');
            if (nextNode.classList.contains('collapsible')) {
                nextNode.classList.remove('collapsed');
                const subIcon = nextNode.querySelector('.state-icon');
                if (subIcon) subIcon.innerText = '▼ ';
            }
        }
    }
}

// --- UI Core Logic ---
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById(`panel-${tab}`).classList.add('active');
}

document.getElementById('tab-log').onclick = () => switchTab('log');
document.getElementById('tab-ai').onclick = () => switchTab('ai');
document.getElementById('btn-ai-tree').onclick = () => analyzeMeeting('topic_tree', 'full');
document.getElementById('btn-ai-summary').onclick = () => analyzeMeeting('summary', 'full');
document.getElementById('btn-ai-todo').onclick = () => analyzeMeeting('todo', 'full');
document.getElementById('btn-ai-custom').onclick = () => analyzeMeeting('custom', 'full');

async function analyzeMeeting(type, target = 'full') {
    const resultArea = target === 'quick' 
        ? document.getElementById('quick-ai-result') 
        : document.getElementById('ai-result');
    
    const instruction = target === 'full' 
        ? document.getElementById('ai-instruction').value 
        : '';

    resultArea.innerText = 'AIが解析中...';
    try {
        const res = await fetch(`/rooms/${state.roomId}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                type, 
                instruction,
                ai_config: {
                    provider: state.aiProvider,
                    model: state.aiModel
                }
            })
        });
        const data = await res.json();
        resultArea.innerHTML = `<div class="ai-provider-badge">解析エンジン: ${data.provider}</div>` + 
                             `<div class="ai-text">${data.result.replace(/\n/g, '<br>')}</div>`;
        resultArea.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { resultArea.innerText = '失敗: ' + e.message; }
}

async function downloadMinutes() {
    if (!state.roomId) return;
    window.location.href = `/rooms/${state.roomId}/download`;
}

function copyRoomId() {
    if (!state.roomId) return;
    navigator.clipboard.writeText(state.roomId).then(() => alert('ルームIDをコピーしました'));
}

// --- Audio Preparation (Crucial for Mobile) ---
async function prepareAudio() {
    DebugMonitor.log('info', 'prepareAudio: Requesting permission on user gesture');
    try {
        if (!state.stream) {
            state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            DebugMonitor.log('info', 'prepareAudio: Stream acquired');
        }
        if (!state.audioContext) {
            state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            DebugMonitor.log('info', `prepareAudio: AudioContext created. State: ${state.audioContext.state}`);
        }
        if (state.audioContext.state === 'suspended') {
            await state.audioContext.resume();
            DebugMonitor.log('info', 'prepareAudio: AudioContext resumed');
        }
        return true;
    } catch (e) {
        DebugMonitor.log('error', 'prepareAudio: Failed', { name: e.name, message: e.message });
        alert('マイクの許可が必要です。ブラウザの設定を確認してください。\n' + e.message);
        return false;
    }
}

async function createRoom() {
    const displayName = document.getElementById('display-name').value;
    if (!displayName) return alert('表示名を入力してください');
    if (!await prepareAudio()) return;
    try {
        const res = await fetch('/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner_id: 'browser-user' })
        });
        const room = await res.json();
        await joinRoomProcess(room.id, displayName);
    } catch (e) { alert('ルーム作成に失敗しました'); }
}

async function joinRoom() {
    const displayName = document.getElementById('display-name').value;
    const roomId = document.getElementById('room-id').value;
    if (!displayName || !roomId) return alert('表示名とルームIDを入力してください');
    if (!await prepareAudio()) return;
    await joinRoomProcess(roomId, displayName);
}

async function joinRoomProcess(roomId, displayName) {
    try {
        const res = await fetch(`/rooms/${roomId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display_name: displayName, location_id: 'web-browser' })
        });
        if (!res.ok) throw new Error('Join failed');
        const participant = await res.json();
        state.roomId = roomId;
        state.participantId = participant.id;
        state.displayName = displayName;
        showMeetingScreen();
        initWebSocket();
    } catch (e) { alert('ルーム参加に失敗しました'); }
}

function showMeetingScreen() {
    setupScreen.classList.remove('active');
    meetingScreen.classList.add('active');
    summaryScreen.classList.remove('active');
    roomInfo.innerText = `ルーム: ${state.roomId}`;
    selfInfo.innerText = `参加者: ${state.displayName}`;
}

function showSummaryScreen() {
    meetingScreen.classList.remove('active');
    summaryScreen.classList.add('active');
    summaryInfo.innerText = `ルーム: ${state.roomId}`;
    switchTab('log');
    summaryLog.innerHTML = timeline.innerHTML;
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?participantId=${state.participantId}`;
    DebugMonitor.log('info', `Connecting to WebSocket: ${wsUrl}`);
    state.ws = new WebSocket(wsUrl);
    state.ws.onopen = () => {
        DebugMonitor.log('info', 'WebSocket Connected');
        addSystemMessage('サーバーに接続しました。');
        state.ws.send(JSON.stringify({ type: 'hello' }));
    };
    state.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transcript') addUtterance(msg);
        else if (msg.type === 'ready') {
            DebugMonitor.log('info', 'Server ready for audio transmission');
            if (msg.history) msg.history.forEach(u => addUtterance(u));
            startRecording();
        } else if (msg.type === 'terminated') {
            DebugMonitor.log('info', 'Meeting terminated by server');
            stopRecording();
            showSummaryScreen();
        } else if (msg.type === 'topic_analyzing') {
            DebugMonitor.log('info', 'Another participant started analysis');
            setAnalyzingState(true);
            // DO NOT clear treeContent here, just let the state handle the overlay
        } else if (msg.type === 'topic_update') {
            applyTopicUpdate(msg);
        }
    };
    state.ws.onclose = (e) => {
        DebugMonitor.log('warn', 'WebSocket Closed', { code: e.code, reason: e.reason, clean: e.wasClean });
        addSystemMessage('接続が切れました。再接続を試みます...');
        setTimeout(initWebSocket, 3000);
    };
    state.ws.onerror = (e) => { DebugMonitor.log('error', 'WebSocket Error occurred'); };
}

async function startRecording() {
    if (state.audioContext && state.audioContext.state === 'running' && state.stream && state.processor) {
        DebugMonitor.log('info', 'startRecording: Already recording, skipping');
        return;
    }

    try {
        if (!state.stream) state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!state.audioContext) state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        if (state.audioContext.state === 'suspended') await state.audioContext.resume();
    } catch (e) {
        DebugMonitor.log('error', 'startRecording: FAILED', { name: e.name, message: e.message });
        addSystemMessage(`マイク取得失敗: ${e.name}`);
        return;
    }

    try {
        // Clean up existing processor if any
        if (state.processor) {
            state.processor.onaudioprocess = null;
            state.processor.disconnect();
        }

        const source = state.audioContext.createMediaStreamSource(state.stream);
        const processor = state.audioContext.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(state.audioContext.destination);
        processor.onaudioprocess = (e) => {
            // Watchdog: Update last process time
            state.lastAudioProcessTime = Date.now();

            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
            }
            if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(pcmData.buffer);
        };
        state.processor = processor;
        DebugMonitor.log('info', 'Audio Processor connected and running');
        
        // Start Watchdog monitor
        if (!state.watchdogInterval) {
            state.watchdogInterval = setInterval(() => {
                if (state.roomId && state.ws && state.ws.readyState === WebSocket.OPEN) {
                    const silenceTime = Date.now() - (state.lastAudioProcessTime || 0);
                    if (silenceTime > 2000) { // 2 seconds of silence/freeze
                        DebugMonitor.log('warn', `Watchdog: Audio pipeline frozen for ${silenceTime}ms. Restarting...`);
                        startRecording();
                    }
                }
            }, 1000);
        }
    } catch (e) { DebugMonitor.log('error', 'startRecording: Node connection FAILED', e.message); }
}

function stopRecording() {
    if (state.audioContext) { state.audioContext.close(); state.audioContext = null; }
    if (state.stream) { state.stream.getTracks().forEach(track => track.stop()); state.stream = null; }
}

async function endRoom() {
    if (!confirm('終了しますか？')) return;
    try {
        const res = await fetch(`/rooms/${state.roomId}/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner_id: 'browser-user' })
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'サーバーエラーが発生しました');
        }
        DebugMonitor.log('info', 'Room ended successfully via API');
        stopRecording();
        showSummaryScreen();
    } catch (e) {
        DebugMonitor.log('error', 'Failed to end room', e.message);
        alert('終了処理に失敗しました: ' + e.message);
    }
}

function addUtterance(msg) {
    state.currentUtterances.push(msg);
    if (!state.speakerColors.has(msg.participant_id)) state.speakerColors.set(msg.participant_id, state.speakerColors.size % 5);
    const colorIndex = state.speakerColors.get(msg.participant_id);
    const div = document.createElement('div');
    div.className = `utterance ${msg.participant_id === state.participantId ? 'self' : ''} speaker-${colorIndex}`;
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<div class="speaker-name">${msg.display_name}</div><div class="text">${msg.transcript}</div><div class="timestamp">${time}</div>`;
    timeline.appendChild(div);
    timeline.scrollTo({ top: timeline.scrollHeight, behavior: 'smooth' });
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'system-message';
    div.innerText = text;
    timeline.appendChild(div);
}

async function checkApiStatus() {
    const container = document.getElementById('api-status-container');
    if (!container) return;
    try {
        const res = await fetch('/api/status');
        const status = await res.json();
        const sttColor = status.google_stt ? 'green' : 'red';
        const aiColor = status.gemini_ai ? 'green' : 'red';
        container.innerHTML = `
            <div style="font-size: 0.9em; padding: 10px; background: #f8f9fa; border-radius: 4px; border: 1px solid #ddd; margin-bottom: 20px;">
                <div>音声認識: <span style="color: ${sttColor}; font-weight: bold;">${status.google_stt ? 'OK' : '未設定'}</span></div>
                <div>AI解析: <span style="color: ${aiColor}; font-weight: bold;">${status.gemini_ai ? 'OK' : '未設定'}</span></div>
            </div>`;
    } catch(e) { container.innerHTML = '<p>(ステータス取得失敗)</p>'; }
}
document.addEventListener('DOMContentLoaded', checkApiStatus);
