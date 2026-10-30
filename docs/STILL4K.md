# 4K 静止画テスト（試作 1）

仕様書 11 章の試作 1 です。テレビアプリ本体を作り込む前に、LG C5 で次の 5 点を確かめます。

1. 4K の静止画動画（動画の再生面）が、1080p の画像（グラフィック面）より精細に見えるか
2. HDR10 と HLG の静止画で、テレビが HDR 表示に切り替わるか
3. 写真の切り替えにかかる時間と、黒い画面が挟まるか（`<video>` 1 つと 2 つ）
4. 動画の上に UI（文字、半透明の帯、アニメーション）が重なって見えるか
5. テレビが再生できる形式

テスト素材はすべて合成画像なので、個人の写真はパッケージに入りません。

## 用意するもの

- LG C5 と、同じネットワークにつながった Windows PC
- PC に [Node.js](https://nodejs.org/ja) の LTS 版
- [LG Developer](https://webostv.developer.lge.com/) のアカウント（無料）

## 1. テレビを開発者モードにする（初回だけ）

1. テレビの LG Content Store で **Developer Mode** を検索してインストールします。
2. Developer Mode アプリを開き、LG Developer の ID とパスワードでサインインします。
3. **Dev Mode Status** をオンにすると、テレビが再起動します。
4. もう一度 Developer Mode アプリを開き、**Key Server** をオンにします。画面左下の 6 文字のパスフレーズを控えます（大文字と小文字を区別します）。
5. テレビの IP アドレスを、テレビの設定のネットワークの画面で確認します。

開発者モードには期限があります。Developer Mode アプリの **Remain Session** に残り時間が出るので、切れる前に **EXTEND** を押してください。切れると、入れたテストアプリは消えます。

## 2. PC とテレビをつなぐ（初回だけ）

PowerShell で次を実行します。`<テレビのIP>` は上で確認したアドレスに置き換えます。

```powershell
npm install -g @webos-tools/cli
ares-setup-device -a c5 -i "username=prisoner" -i "host=<テレビのIP>" -i "port=9922" -i "default=true"
ares-novacom --device c5 --getkey
ares-device --system-info --device c5
```

`--getkey` ではパスフレーズを聞かれるので、テレビに出ている 6 文字を入れます。最後のコマンドでテレビの型番と webOS の版が出れば接続できています。
「このシステムではスクリプトの実行が無効になっている」と出たら、コマンド名の後ろに `.cmd` を付けてください（例: `ares-setup-device.cmd`）。

## 3. IPK を入手する

GitHub のこのリポジトリの **Actions** で、最新の **webOS checks** の実行を開き、Artifacts の **okuyuki-still4k-ipk** をダウンロードして展開します。
自分でビルドする場合は [README](../README.md) の「開発」の手順で `npm run still4k:package` まで実行すると、`dist/` にできます。

## 4. インストールと起動

```powershell
ares-install --device c5 .\com.okuyuki.still4k_0.1.0_all.ipk
ares-launch --device c5 com.okuyuki.still4k
```

テレビのアプリ一覧の **Okuyuki 4K Test** からも開けます。十字キーで選んで決定ボタンで開き、テスト中は「戻る」でメニューに戻ります。

## 5. テストの見方

画面右下の情報（読み込み時間など）は決定ボタンで消せます。結果はスマホで画面を撮っておくと確実です。

| テスト | やること | 合格の目安 |
| --- | --- | --- |
| 1. 解像度 | 左右で 8 種類を切り替えます。最初の 2 つ（PNG と AVIF）は画像、残りは 4K の静止画動画です。左上の「1 px」の 3 つの四角を近くで見比べます。上下で動画の出し方（再生してすぐ一時停止、最初のフレームだけ、ループ）を変えられます。 | 動画のときだけ細い縞がくっきり見え、画像のときは灰色に見える。どの出し方でも静止画が表示される |
| 2. HDR | HDR10、HLG、比較用の SDR を切り替えます。表示中にリモコンの設定ボタンから映像モードを開きます。 | HDR10 と HLG のときに映像モードが HDR 用の表記に変わる。明るさの段階が滑らかに見える |
| 3. 切り替え（video 1 つ） | 自動で 6 枚を順に出した後、左右で切り替えます。 | 3 秒以内に切り替わる。黒い画面が挟まるかを記録 |
| 4. 切り替え（video 2 つ） | 右キーで次へ進みます。裏で次の写真を準備しています。 | 0.5 秒以内に切り替わり、黒い画面が挟まらない |
| 5. UI の重ね表示 | 写真の上に半透明の帯と文字が出ます。 | 帯と文字が写真の上に見え、青いバーが滑らかに動く |
| 6. 再生できる形式 | 一覧を CH+ / CH- でスクロールします。 | 記録するだけ |
| 7. 自分の写真 | 下の「6. 自分の写真で試す」を見てください。 | 決定ボタンで 1080p 画像と 4K 動画を切り替え、精細さの違いが分かる |
| 8. 結果 | 計測した結果をすべて JSON で表示します。PC でサーバーを動かしていれば「PC に送る」で保存できます。 | 保存された `results-*.json` を共有する |

## 6. 自分の写真で試す

PC に Python 3.12 以上と ffmpeg が必要です（ffmpeg は `winget install Gyan.FFmpeg` で入ります）。このリポジトリのフォルダで次を実行します。

```powershell
python -m pip install -r tools/requirements.txt pillow-heif
python tools/still4k/convert.py still4k-photos "C:\Users\<名前>\Pictures\テスト用"
node tools/still4k/serve.mjs still4k-photos
```

`convert.py` は、フォルダ内の写真を 4K の静止画動画と 1080p の JPEG に変換します（HEIC も読めます）。`serve.mjs` が表示する `http://...:8787` を、テストアプリの「7. 自分の写真で試す」に入力して「読み込む」を押します。Windows のファイアウォールの確認が出たら、プライベート ネットワークでの通信を許可してください。
`still4k-photos` は Git の管理外なので、写真がコミットされることはありません。
