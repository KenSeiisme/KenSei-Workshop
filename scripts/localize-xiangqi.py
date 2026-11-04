"""Maintain explicit Xiangqi English / Traditional Chinese messages."""

import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
tree = ast.parse((ROOT / "scripts/localize-chess.py").read_text(encoding="utf-8"))
base = next(
    ast.literal_eval(node.value)
    for node in tree.body
    if isinstance(node, ast.Assign)
    and any(
        isinstance(target, ast.Name) and target.id == "PAIRS" for target in node.targets
    )
)
PAIRS = {}
for en, zh in base.items():
    updated = (
        en.replace("Chess", "Xiangqi")
        .replace("chess", "xiangqi")
        .replace("Stockfish", "Fairy-Stockfish")
        .replace("White", "Red")
    )
    if updated != en:
        PAIRS[updated] = (
            zh.replace("西洋棋", "中國象棋")
            .replace("白方", "紅方")
            .replace("Stockfish", "Fairy-Stockfish")
        )
PAIRS.update(
    {
        "Xiangqi": "中國象棋",
        "Authors": "作者",
        "Choose a supported Xiangqi time control.": "請選擇支援的象棋用時。",
        "Invalid Xiangqi action.": "象棋操作無效。",
        "Invalid Xiangqi move.": "象棋著手無效。",
        "Invalid Xiangqi save action.": "象棋存檔的操作紀錄無效。",
        "Invalid standard Xiangqi configuration.": "標準象棋對局設定無效。",
        "This Xiangqi game has ended.": "這局象棋已結束。",
        "Unknown Xiangqi action.": "無法識別的象棋操作。",
        "Online clocks continue in the background. A continuous 120-second disconnection forfeits unless time expires first. Both disconnected: interrupted. Draw offers keep the clock running.": "線上時鐘在背景繼續運行。連續斷線一百二十秒判負，若時間先用完則先判超時；雙方均斷線則記為中斷。提議和棋不會暫停時鐘。",
        "Xiangqi rules and adjudication are independently implemented Workshop code.": "象棋規則與裁定由 Workshop 獨立實作。",
        "Online Xiangqi and public records": "線上象棋與公開戰績",
        "Xiangqi uses the same private match service. The server checks WXF moves, repetition, clocks and outcomes. Standard online human games publish wins, losses, draws and completed games by time control. Private games, imported records and computer practice do not enter public statistics. Fairy-Stockfish runs locally without sending positions to an AI service. Only Xiangqi pages and engine resources enable cross-origin isolation for the local engine.": "象棋沿用私有對局服務，由伺服器核對 WXF 著手、循環、時鐘與結果。標準線上真人局按用時公開勝、負、和及完局數；私人對局、匯入棋譜與人機練習不計入。Fairy-Stockfish 在本機運行，不會把局面傳給 AI 服務。只有象棋頁及引擎資源啟用本機引擎所需的跨來源隔離。",
        "Chess uses the same private server-verified match service as Go. Match members can read the position, moves, clocks and outcome. Standard online human games publish completed games, wins, losses, draws and win rate by time control. Local games, Stockfish practice and imported positions remain private. Stockfish runs on this device without sending positions to an external AI service. Unresolved and interrupted matches do not enter public statistics. Go, Chess, Xiangqi, Pong and shared Whiteboard share a two-active-room limit.": "西洋棋沿用圍棋的私有伺服器驗證服務，成員可讀取局面、著手、時鐘與結果。標準線上真人局按用時公開完局、勝負和與勝率。本機、Stockfish 練習和匯入局面維持私有，引擎不傳送局面至外部 AI。未決及中斷對局不計戰績。圍棋、西洋棋、象棋、Pong 與共享白板共用兩個活躍房間上限。",
        "Red": "紅方",
        "Chariot": "車",
        "Horse": "馬",
        "Elephant": "象／相",
        "Advisor": "士／仕",
        "Cannon": "炮／砲",
        "General": "將／帥",
        "Soldier": "兵／卒",
        "A familiar board. A new challenge.": "熟悉的棋盤，全新的較量。",
        "A familiar board. A new challenge. WXF rules, five computer levels and verified online matches.": "熟悉的棋盤，全新的較量。支援 WXF 規則、五級人機與伺服器驗證的線上對戰。",
        "WXF 2018 · 9 × 10": "WXF 2018 · 九路十行",
        "WXF 2018 · 9 × 10 · {0}": "WXF 2018 · 九路十行 · {0}",
        "Piece labels": "棋子標示",
        "Chinese characters": "漢字",
        "Letters": "字母",
        "Download ICCS": "下載 ICCS 棋譜",
        "Download JSON": "下載 JSON",
        "ICCS, JSON or FEN": "ICCS、JSON 或 FEN",
        "No legal move · loss": "無子可動 · 判負",
        "Neither side has attacking pieces": "雙方均無進攻棋子",
        "Natural move limit · 100 qualifying plies": "自然限著 · 一百個有效著手",
        "Lawful repetition": "合法循環和棋",
        "Refused to vary perpetual check": "長將警告後拒絕變著",
        "Refused to vary perpetual chase": "長捉警告後拒絕變著",
        "Result declared in imported record": "匯入棋譜所記載的結果",
        "{0} must vary this repetition. Repeating the prohibited move loses the game.": "{0}必須改變此循環；再重複犯例著手將判負。",
        "Loading Fairy-Stockfish…": "正在載入 Fairy-Stockfish…",
        "Fairy-Stockfish ready": "Fairy-Stockfish 已就緒",
        "The Xiangqi engine timed out. Retry or choose another mode.": "象棋引擎逾時，請重試或改用其他模式。",
        "This browser cannot run the Xiangqi engine here. Use local two players or online play.": "此瀏覽器目前無法執行象棋引擎，仍可使用本機雙人或線上對戰。",
        "Fairy-Stockfish could not load. Retry or choose another mode.": "無法載入 Fairy-Stockfish，請重試或改用其他模式。",
        "The Xiangqi engine returned an invalid move.": "象棋引擎傳回無效著手。",
        "Invalid Xiangqi engine move.": "象棋引擎著手格式無效。",
        "Invalid Xiangqi FEN.": "象棋 FEN 局面格式無效。",
        "Invalid Xiangqi FEN piece.": "象棋 FEN 含無效棋子。",
        "Xiangqi FEN requires nine files per rank.": "象棋 FEN 每行必須有九路。",
        "Xiangqi has no castling or en passant rights.": "象棋不使用王車易位或吃過路兵欄位。",
        "Invalid Xiangqi FEN counters.": "象棋 FEN 的著手計數無效。",
        "Invalid Xiangqi piece identity.": "象棋棋子識別資料無效。",
        "Select a Xiangqi piece.": "請先選擇象棋棋子。",
        "Invalid Xiangqi FEN piece count.": "象棋 FEN 的棋子數量無效。",
        "The general must remain inside its palace.": "將帥必須位於己方九宮內。",
        "Invalid advisor position.": "士／仕的位置無效。",
        "Invalid elephant position.": "象／相的位置無效。",
        "Invalid soldier position.": "兵／卒的位置無效。",
        "The side that just moved cannot remain in check.": "剛走完的一方不能仍處於被將軍狀態。",
        "Use WXF 2018 on the standard 9 × 10 board.": "請使用標準九路十行棋盤與 WXF 2018 規則。",
        "Xiangqi record limit reached. Export the record.": "象棋紀錄已達上限，請匯出棋譜。",
        "Invalid Xiangqi record.": "象棋棋譜無效。",
        "Invalid Xiangqi result.": "象棋結果無效。",
        "Invalid Xiangqi save or size over 256 KB.": "象棋存檔無效或超過 256KB。",
        "Invalid saved Xiangqi clock.": "存檔中的象棋時鐘無效。",
        "Import one Xiangqi record up to 256 KB.": "請匯入一份不超過 256KB 的象棋棋譜。",
        "Use an ICCS a0-i9 Xiangqi text record.": "請使用 a0–i9 座標的 ICCS 象棋文字棋譜。",
        "Invalid ICCS move in record.": "棋譜中含無效 ICCS 著手。",
        "World Xiangqi Rules 2018": "世界象棋規則 2018",
        "Import an ICCS text record, KenSei JSON record or FEN position. Imported games remain private. FEN has no previous repetition or checking history; those counters start here.": "可匯入 ICCS 文字棋譜、KenSei JSON 或 FEN 局面。匯入對局維持私人；FEN 不含先前循環與將軍歷史，相關計數從匯入後開始。",
        "Red moves first on the standard 9 × 10 board. Protect your general; checkmate and having no legal move both lose. Select a piece and destination, drag, or use the board arrow keys and Enter. On touch screens, confirm your preview.": "標準棋盤為九路十行，紅方先行。請保護將帥：被將死或無子可動均判負。可點選棋子與落點、拖動，或在棋盤使用方向鍵及 Enter；觸控裝置須確認預覽落點。",
        "WXF 2018 rules apply. Horse legs, elephant eyes, cannon screens, river and palace restrictions are enforced. Online play has no undo, hints or single-player pause.": "採用 WXF 2018 規則，檢查蹩馬腿、塞象眼、炮架、過河及九宮限制。線上對局不提供悔棋、提示或單方暫停。",
        "This site follows the Chinese original: after the same position returns three times, the responsible player is warned to vary. Repeating that prohibited transition loses. Lawful repetition draws after four returns. This digital referee policy is fixed for rules v1.": "本站以中文原文為準：同一局面返回三次後，警告責任方變著；再重複該犯例著手判負。合法循環返回四次判和。此數位裁判口徑固定於規則 v1。",
        "The natural move limit is 100 qualifying plies without a capture; pawn moves do not reset it. Only a player's first ten checks count toward that player's verification total. The automatic referee verifies either player's eligible count. Checkmate and repetition forfeits take priority.": "無吃子的自然限著為一百個有效著手，兵卒移動不重置。每方只有前十次將軍計入其審核計數，由自動裁判驗證任一方是否符合；將死及循環犯例判負優先。",
        "Private progress saves on this device first; signed-in saves sync to your account. Imported records never become ranked. Fairy-Stockfish runs on this device; its five levels are not official ratings.": "私人進度先儲存在此裝置，登入後同步至帳號。匯入棋譜不參加公開戰績。Fairy-Stockfish 在此裝置執行，五級難度不代表官方段位。",
    }
)
catalog = {
    "m_"
    + hashlib.sha256(" ".join(en.split()).encode()).hexdigest()[:12]: {
        "en": en,
        "zh-Hant": zh,
    }
    for en, zh in PAIRS.items()
}
(ROOT / "src/i18n/catalog/xiangqi.json").write_text(
    json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
path = ROOT / "src/i18n/content.json"
content = json.loads(path.read_text(encoding="utf-8"))
content["games/xiangqi"] = {
    "name": {"en": "Xiangqi", "zh-Hant": "中國象棋"},
    "description": {
        "en": "A familiar board. A new challenge. WXF rules, five computer levels and verified online matches.",
        "zh-Hant": "熟悉的棋盤，全新的較量。支援 WXF 規則、五級人機與伺服器驗證的線上對戰。",
    },
    "aliases": [
        "xiangqi",
        "Chinese chess",
        "象棋",
        "中國象棋",
        "中国象棋",
        "中国象棋对战",
        "中國象棋對戰",
    ],
}
path.write_text(
    json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(f"Updated {len(catalog)} Xiangqi locale entries.")
