const admin = require('firebase-admin');

let _db = null;

function getDb() {
    if (_db) return _db;
    if (!admin.apps.length) {
        admin.initializeApp({
            projectId: process.env.GOOGLE_CLOUD_PROJECT
        });
    }
    _db = admin.firestore();
    return _db;
}

function fromTimestamp(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
    if (ts instanceof Date) return ts.toISOString();
    return ts;
}

function toTimestamp(value) {
    if (value == null) return null;
    if (typeof value === 'string') return admin.firestore.Timestamp.fromDate(new Date(value));
    if (value instanceof Date) return admin.firestore.Timestamp.fromDate(value);
    return value;
}

const serverTs = () => admin.firestore.FieldValue.serverTimestamp();

module.exports = { getDb, fromTimestamp, toTimestamp, serverTs, admin };
