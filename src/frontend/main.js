let state = {
    roomId: null,
    participantId: null,
    displayName: null,
    ws: null,
    mediaRecorder: null,
    stream: null,
    speakerColors: new Map() // participantId -> colorIndex
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

// Event Listeners
document.getElementById('btn-create').onclick = createRoom;
document.getElementById('btn-join').onclick = joinRoom;
document.getElementById('btn-end').onclick = endRoom;
document.getElementById('btn-copy-room').onclick = copyRoomId;
document.getElementById('btn-download').onclick = downloadMinutes;
document.getElementById('btn-download-final').onclick = downloadMinutes;
document.getElementById('btn-home').onclick = () => location.reload();

async function downloadMinutes() {
    if (!state.roomId) return;
    window.location.href = `/rooms/${state.roomId}/download`;
}

function copyRoomId() {
    if (!state.roomId) return;
    navigator.clipboard.writeText(state.roomId).then(() => {
        alert('ルームIDをコピーしました: ' + state.roomId);
    });
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
        
        // Auto join after create
        await joinRoomProcess(room.id, displayName);
    } catch (e) {
        console.error(e);
        alert('ルーム作成に失敗しました');
    }
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
        // startRecording() is called after WS is 'ready' for stability
    } catch (e) {
        console.error(e);
        alert('ルーム参加に失敗しました。IDが正しいか確認してください。');
    }
}

function showMeetingScreen() {
    setupScreen.classList.remove('active');
    meetingScreen.classList.add('active');
    summaryScreen.classList.remove('active');
    roomInfo.innerText = `ルーム: ${state.roomId}`;
    selfInfo.innerText = `参加者: ${state.displayName} (ID: ${state.participantId})`;
}

function showSummaryScreen() {
    meetingScreen.classList.remove('active');
    summaryScreen.classList.add('active');
    summaryInfo.innerText = `ルーム: ${state.roomId} | 参加者: ${state.displayName}`;
    
    // Copy the final log content to summary preview
    summaryLog.innerHTML = timeline.innerHTML;
}

let reconnectAttempts = 0;
function initWebSocket() {
    if (state.ws) {
        state.ws.onclose = null;
        state.ws.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${protocol}//${window.location.host}?participantId=${state.participantId}`);

    state.ws.onopen = () => {
        addSystemMessage('サーバーに接続しました。');
        reconnectAttempts = 0;
        state.ws.send(JSON.stringify({ type: 'hello' }));
    };

    state.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transcript') {
            addUtterance(msg);
        } else if (msg.type === 'ready') {
            console.log('Server is ready for audio');
            if (msg.history && Array.isArray(msg.history)) {
                msg.history.forEach(utterance => addUtterance(utterance));
            }
            startRecording(); // Start recording only after WS is validated and ready
        } else if (msg.type === 'error') {
            addSystemMessage(`エラー: ${msg.message}`);
        } else if (msg.type === 'terminated') {
            stopRecording();
            showSummaryScreen();
        }
    };

    state.ws.onclose = () => {
        addSystemMessage('接続が切れました。再接続を試みます...');
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        setTimeout(initWebSocket, delay);
    };

    state.ws.onerror = (e) => {
        console.error('WS Error:', e);
    };
}

async function startRecording() {
    if (state.audioContext) return; // Already recording

    try {
        state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        
        // Resume context if suspended (common browser requirement)
        if (audioContext.state === 'suspended') {
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
        console.log('Recording started with AudioContext (PCM 16kHz)');
    } catch (e) {
        console.error('Recording error:', e);
        addSystemMessage('マイクの取得に失敗しました。');
    }
}

function stopRecording() {
    if (state.audioContext) {
        state.audioContext.close();
        state.audioContext = null;
    }
    if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
        state.stream = null;
    }
}

async function endRoom() {
    if (!confirm('会議を終了しますか？終了後は他の参加者も録音が停止されます。')) return;
    
    try {
        await fetch(`/rooms/${state.roomId}/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner_id: 'browser-user' })
        });
        
        // WebSocket will receive 'terminated' and showSummaryScreen will be called
    } catch (e) {
        console.error(e);
        alert('終了処理に失敗しました');
    }
}

function addUtterance(msg) {
    if (!state.speakerColors.has(msg.participant_id)) {
        state.speakerColors.set(msg.participant_id, state.speakerColors.size % 5);
    }
    const colorIndex = state.speakerColors.get(msg.participant_id);

    const div = document.createElement('div');
    div.className = `utterance ${msg.participant_id === state.participantId ? 'self' : ''} speaker-${colorIndex}`;
    
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    div.innerHTML = `
        <div class="speaker-name">${msg.display_name}</div>
        <div class="text">${msg.transcript}</div>
        <div class="timestamp">${time}</div>
    `;
    
    timeline.appendChild(div);
    
    // Smooth scroll to bottom
    setTimeout(() => {
        timeline.scrollTo({ top: timeline.scrollHeight, behavior: 'smooth' });
    }, 50);
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'system-message';
    div.innerText = text;
    timeline.appendChild(div);
}
