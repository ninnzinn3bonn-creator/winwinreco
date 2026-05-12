process.env.NODE_ENV = process.env.NODE_ENV || 'test';
// リクエストログを無効化 (テスト実行時のノイズ削減)
process.env.REQUEST_LOG = process.env.REQUEST_LOG || '0';
