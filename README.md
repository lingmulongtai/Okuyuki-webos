# Okuyuki webOS

Galaxy の写真と動画を、同じ Wi-Fi にある LG webOS テレビで、テレビが出せる最高の画質で見るためのテレビ側アプリです。
写真はスマホに置いたまま、テレビは表示に必要なデータだけを一時的に受け取ります。

Companion: [Okuyuki-android](https://github.com/lingmulongtai/Okuyuki-android) · [Okuyuki-quest](https://github.com/lingmulongtai/Okuyuki-quest)

## いまできること

| アプリ | 内容 | 状態 |
| --- | --- | --- |
| [4K 静止画テスト](docs/STILL4K.md)（`com.okuyuki.still4k`） | 4K の静止画動画が 1080p の画像より精細に見えるか、HDR、切り替え速度、UI の重ね表示をテレビで確かめる | 実機での確認待ち |
| [Okuyuki TV](docs/TV.md)（`com.okuyuki.tv`） | スマホの写真と動画の一覧、写真の 4K 表示、動画の再生、スマホからの表示指示 | スマホ側の対応待ち。PC の写真でモックホストを使って試せます |

仕様は [docs/SPEC.md](docs/SPEC.md)、スマホとの通信は [protocol/README.md](protocol/README.md) にあります。

## 開発

Node.js 20 以上、Python 3.12 以上、ffmpeg（libx265・libx264・libsvtav1 入り）。

```sh
npm ci
npx playwright install chromium
python3 -m pip install -r tools/requirements.txt
npm run still4k:assets     # テスト素材を作る（数分かかります）
npm run check              # 構文チェック
npm run test:still4k       # Playwright で 1920×1080 の画面を確かめる
npm run still4k:package    # dist/ に IPK を作る
```

テレビアプリ（`apps/tv`、Enact と Sandstone）は次のとおりです。詳しくは [docs/TV.md](docs/TV.md) を見てください。

```sh
npm run tv:install         # apps/tv の依存関係
npm run tv:lint
npm run tv:test            # 単体テスト
npm run tv:build           # apps/tv/dist に本番ビルド
npm run test:tv            # モックホストを相手に 1920×1080 の画面を確かめる
npm run tv:package         # dist/ に IPK を作る
npm run mock-host          # スマホの代わりになるモックホスト
```

テレビへのインストール手順は [docs/STILL4K.md](docs/STILL4K.md) を見てください。
