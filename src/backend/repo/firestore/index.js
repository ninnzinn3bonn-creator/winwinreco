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
const { SeriesRepository } = require('./series-repo');

async function createRepos() {
    return {
        roomRepo: new RoomRepository(),
        participantRepo: new ParticipantRepository(),
        utteranceRepo: new UtteranceRepository(),
        analysisRepo: new AnalysisRepository(),
        actionRepo: new ActionRepository(),
        userRepo: new UserRepository(),
        userContextRepo: new UserContextRepository(),
        dictionaryRepo: new DictionaryRepo(),
        accountRepo: new UserAccountRepository(),
        sessionRepo: new SessionRepository(),
        chunkRepo: new ChunkRepository(),
        passwordResetRepo: new PasswordResetRepository(),
        emailVerificationRepo: new EmailVerificationRepository(),
        seriesRepo: new SeriesRepository()
    };
}

module.exports = { createRepos };
