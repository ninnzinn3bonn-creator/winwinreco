/**
 * account-delete.js — アカウント完全削除 (cascade)
 *
 * 削除順:
 *  1. ホストした全ルームを deleteCascade (utterances / participants / analyses / actions / chunks / room)
 *  2. sessionRepo.destroyAllForAccount でセッション全消去
 *  3. userRepo.deleteById で users 行を削除 (存在すれば)
 *  4. accountRepo.deleteById で user_accounts 行を削除
 */

'use strict';

/**
 * @param {object} repos  { accountRepo, userRepo, roomRepo, sessionRepo }
 * @param {string} accountId
 * @returns {Promise<void>}
 */
async function deleteAccountCascade(repos, accountId) {
    const { accountRepo, userRepo, roomRepo, sessionRepo } = repos;

    // 1. ホストした全ルームを削除
    if (roomRepo) {
        const ownRooms = await roomRepo.findRoomsForAccount(accountId, { limit: 1000 });
        const owned = ownRooms.filter((r) => r.owner_account_id === accountId);
        for (const room of owned) {
            await roomRepo.deleteCascade(room.id);
        }
    }

    // 2. 全セッション削除
    if (sessionRepo) {
        await sessionRepo.destroyAllForAccount(accountId);
    }

    // 3. users 行を削除 (存在しない場合はスキップ)
    if (userRepo && typeof userRepo.deleteById === 'function') {
        await userRepo.deleteById(accountId);
    }

    // 4. user_accounts 行を削除
    if (accountRepo && typeof accountRepo.deleteById === 'function') {
        await accountRepo.deleteById(accountId);
    }
}

module.exports = { deleteAccountCascade };
