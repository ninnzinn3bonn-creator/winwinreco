let state = {
    roomId: null,
    participantId: null,
    displayName: null,
    ws: null,
    mediaRecorder: null,
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
const treeContainer = document.getElementById('topic-tree-container');
const treeContent = document.getElementById('topic-tree-content');
const resizer = document.getElementById('resizer');

// Event Listeners
document.getElementById('btn-create').onclick = createRoom;
document.getElementById('btn-join').onclick = joinRoom;
document.getElementById('btn-end').onclick = endRoom;
document.getElementById('btn-copy-room').onclick = copyRoomId;
document.getElementById('btn-download').onclick = downloadMinutes;
document.getElementById('btn-download-final').onclick = downloadMinutes;
document.getElementById('btn-home').onclick = () => location.reload();

// Meeting Footer Actions
document.getElementById('btn-analyze').onclick = analyzeTopicTree;
document.getElementById('btn-memo').onclick = addMemo;
document.getElementById('btn-save').onclick = downloadMinutes;

// --- AI Engine Config Logic ---
document.getElementById('ai-provider').onchange = (e) => {
    const provider = e.target.value;
    const modelInput = document.getElementById('ai-model');
    state.aiProvider = provider;
    if (provider === 'gemini') {
        modelInput.value = 'gemini-1.5-flash';
    } else if (provider === 'ollama') {
        modelInput.value = 'llama3';
    }
    state.aiModel = modelInput.value;
};

document.getElementById('ai-model').oninput = (e) => {
    state.aiModel = e.target.value;
};

// --- Resizer Logic ---
let isResizing = false;
resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'row-resize';
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const appRect = document.getElementById('app').getBoundingClientRect();
    const headerHeight = document.querySelector('#meeting-screen header').offsetHeight;
    let newHeight = e.clientY - appRect.top - headerHeight;
    const minHeight = 80;
    const maxHeight = appRect.height * 0.6;
    if (newHeight < minHeight) newHeight = minHeight;
    if (newHeight > maxHeight) newHeight = maxHeight;
    treeContainer.style.height = `${newHeight}px`;
});

document.addEventListener('mouseup', () => {
    isResizing = false;
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
    const newUtterances = state.currentUtterances.slice(state.lastAnalyzedIndex + 1);
    if (newUtterances.length === 0 && state.lastAnalyzedIndex !== -1) {
        return alert('新しい発言がありません');
    }
    
    DebugMonitor.log('info', `Starting Topic Tree Analysis... (New: ${newUtterances.length})`);
    const originalHTML = treeContent.innerHTML;
    treeContent.innerHTML = '<span class="placeholder-text">解析中...</span>';

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
        DebugMonitor.log('info', 'Analysis Request Payload', payload);

        const res = await fetch(`/rooms/${state.roomId}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        DebugMonitor.log('info', `Analysis Response Status: ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        if (data.result) {
            DebugMonitor.log('info', 'Analysis Success', { provider: data.provider });
            renderTreeNodes(data.result);
            state.lastProcessedTimestamp = data.latest_timestamp;
        }
        state.lastAnalyzedIndex = state.currentUtterances.length - 1;
    } catch (e) {
        DebugMonitor.log('error', 'Topic Tree Analysis Failed', e.message);
        console.error('Analysis error:', e);
        alert('解析に失敗しました: ' + e.message);
        treeContent.innerHTML = originalHTML;
    }
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
document.getElementById('btn-ai-summary').onclick = () => analyzeMeeting('summary');
document.getElementById('btn-ai-agenda').onclick = () => analyzeMeeting('agenda');
document.getElementById('btn-ai-custom').onclick = () => analyzeMeeting('custom');

async function analyzeMeeting(type) {
    const resultArea = document.getElementById('ai-result');
    const instruction = document.getElementById('ai-instruction').value;
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

async function createRoom() {
    const displayName = document.getElementById('display-name').value;
    if (!displayName) return alert('表示名を入力してください');
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
        }
    };
    state.ws.onclose = (e) => {
        DebugMonitor.log('warn', 'WebSocket Closed', { code: e.code, reason: e.reason, clean: e.wasClean });
        addSystemMessage('接続が切れました。再接続を試みます...');
        setTimeout(initWebSocket, 3000);
    };
    state.ws.onerror = (e) => {
        DebugMonitor.log('error', 'WebSocket Error occurred');
    };
}

async function startRecording() {
    if (state.audioContext) {
        DebugMonitor.log('warn', 'startRecording called but already recording');
        return;
    }
    
    DebugMonitor.log('info', 'Requesting Microphone access...');
    try {
        state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        DebugMonitor.log('info', 'Microphone access GRANTED');
        
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        DebugMonitor.log('info', `AudioContext started. State: ${audioContext.state}, SampleRate: ${audioContext.sampleRate}`);
        
        if (audioContext.state === 'suspended') {
            DebugMonitor.log('info', 'Resuming suspended AudioContext...');
            await audioContext.resume();
        }

        const source = audioContext.createMediaStreamSource(state.stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
            }
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(pcmData.buffer);
            }
        };
        state.audioContext = audioContext;
        DebugMonitor.log('info', 'Audio Processor connected and running');
    } catch (e) { 
        DebugMonitor.log('error', 'Microphone Access FAILED', { name: e.name, message: e.message });
        addSystemMessage(`マイク取得失敗: ${e.name}`); 
    }
}

function stopRecording() {
    if (state.audioContext) { state.audioContext.close(); state.audioContext = null; }
    if (state.stream) { state.stream.getTracks().forEach(track => track.stop()); state.stream = null; }
}

async function endRoom() {
    if (!confirm('終了しますか？')) return;
    await fetch(`/rooms/${state.roomId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_id: 'browser-user' })
    });
}

function addUtterance(msg) {
    state.currentUtterances.push(msg);
    if (!state.speakerColors.has(msg.participant_id)) {
        state.speakerColors.set(msg.participant_id, state.speakerColors.size % 5);
    }
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
