# パックマン オンライン

## ローカル起動

```bash
# バックエンド
cd backend
npm install
npm start    # → http://localhost:3001

# フロントエンド
# frontend/index.html をブラウザで直接開くだけ（または Live Server 等）
```

## デプロイ手順

### 1. バックエンド → Render
1. https://render.com でアカウント作成
2. New → Web Service → GitHub連携
3. `backend/` フォルダをルートに指定（または monorepo の場合は Root Directory: `backend`）
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. デプロイ後に表示される URL をコピー（例: `https://pacman-online-backend.onrender.com`）

### 2. フロントエンドの SERVER_URL を更新
`frontend/index.html` の以下の行を Render の URL に書き換える：
```js
: 'https://pacman-online-backend.onrender.com'; // ← ここを変更
```

### 3. フロントエンド → Netlify
1. https://app.netlify.com で New site from Git
2. `frontend/` フォルダを publish directory に指定
3. デプロイ完了

## ゲームの遊び方
- 2〜4人でルームを作って遊ぶ
- 最初に入った人がゲーム開始ボタンを押せる
- ランダムで1人がパックマン、残りがゴーストになる
- パックマン: すべてのエサを食べればWIN
- ゴースト: パックマンに触れればWIN
