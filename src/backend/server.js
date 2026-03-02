require('dotenv').config();
const http = require('http');
const { createApp, setupWebSocket } = require('./app');
const { RoomRepository } = require('./repo/room-repo');
const { ParticipantRepository } = require('./repo/participant-repo');
const { UtteranceRepository } = require('./repo/utterance-repo');
const { initDB } = require('./repo/db');
const { AudioProcessor } = require('./services/audio-processor');
const { STTService } = require('./services/stt-service');

async function start() {
    const dbPath = process.env.DB_PATH || './db/meeting.db';
    const db = await initDB(dbPath);
    
    const repos = {
        roomRepo: new RoomRepository(db),
        participantRepo: new ParticipantRepository(db),
        utteranceRepo: new UtteranceRepository(db)
    };

    const audioProcessor = new AudioProcessor({ chunkLimit: 10 }); 
    const sttService = new STTService();

    // Create a dummy wss first to pass into app
    const app = createApp(repos);
    const server = http.createServer(app);
    
    // setupWebSocket returns the wss instance
    const wss = setupWebSocket(server, { ...repos, audioProcessor, sttService });
    
    // Update app with the actual wss instance for API handlers
    repos.wss = wss;

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

start().catch(console.error);
