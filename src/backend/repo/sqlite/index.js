const { initDB } = require('./db');
const { RoomRepository } = require('./room-repo');
const { ParticipantRepository } = require('./participant-repo');
const { UtteranceRepository } = require('./utterance-repo');
const { AnalysisRepository } = require('./analysis-repo');
const { ActionRepository } = require('./action-repo');
const { UserRepository } = require('./user-repo');
const { UserContextRepository } = require('./user-context-repo');
const { DictionaryRepo } = require('./dictionary-repo');
const { UserAccountRepository } = require('./user-account-repo');
const { SessionRepository } = require('./session-repo');
const { ChunkRepository } = require('./chunk-repo');
const { PasswordResetRepository } = require('./password-reset-repo');
const { EmailVerificationRepository } = require('./email-verification-repo');

async function createRepos() {
    const dbPath = process.env.DB_PATH || './db/meeting.db';
    const db = await initDB(dbPath);
    return {
        roomRepo: new RoomRepository(db),
        participantRepo: new ParticipantRepository(db),
        utteranceRepo: new UtteranceRepository(db),
        analysisRepo: new AnalysisRepository(db),
        actionRepo: new ActionRepository(db),
        userRepo: new UserRepository(db),
        userContextRepo: new UserContextRepository(db),
        dictionaryRepo: new DictionaryRepo(db),
        accountRepo: new UserAccountRepository(db),
        sessionRepo: new SessionRepository(db),
        chunkRepo: new ChunkRepository(db),
        passwordResetRepo: new PasswordResetRepository(db),
        emailVerificationRepo: new EmailVerificationRepository(db),
        _raw: db   // shutdown 時の db.close() 用
    };
}

module.exports = { createRepos };
