FROM node:20-slim

# SQLite3のコンパイルに必要なビルドツールをインストール
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# 作業ディレクトリの設定
WORKDIR /app

# パッケージ定義ファイルをコピー
COPY package*.json ./

# 本番環境用の依存関係のみをインストール
# npm ci は dev/optional 依存の lock ファイル整合性チェックで失敗するケースがあるため
# npm install --omit=dev に変更 (re2 → node-gyp → tinyglobby の picomatch 競合を回避)
RUN npm install --omit=dev

# アプリケーションのソースコードをコピー
COPY . .

# Cloud Run は起動時に PORT 環境変数を渡すため、それに従う
EXPOSE 8080
ENV PORT=8080

# アプリの起動
CMD ["npm", "start"]
