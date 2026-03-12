FROM node:20-slim

# SQLite3のコンパイルに必要なビルドツールをインストール
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# 作業ディレクトリの設定
WORKDIR /app

# パッケージ定義ファイルをコピー
COPY package*.json ./

# 本番環境用の依存関係のみをクリーンインストール
RUN npm ci --only=production

# アプリケーションのソースコードをコピー
COPY . .

# Cloud Run は起動時に PORT 環境変数を渡すため、それに従う
EXPOSE 8080
ENV PORT=8080

# アプリの起動
CMD ["npm", "start"]
