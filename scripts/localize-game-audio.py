"""Maintain the shared game-audio English / Traditional Chinese catalog."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAIRS = {
    "Audio is not available in this browser. You can keep playing silently.": "此瀏覽器無法播放遊戲聲音，仍可繼續靜音遊玩。",
    "Sound effects volume": "音效音量",
    "Background music": "背景音樂",
    "Music volume": "音樂音量",
    "Go · last 5 seconds reminder": "圍棋 · 最後 5 秒提示音",
    "Retry audio": "重試載入聲音",
    "Tap the sound button or game area to resume audio.": "點一下聲音按鈕或遊戲區域以恢復聲音。",
    "Music could not load. Retry audio; you can keep playing.": "音樂無法載入。可繼續遊玩，或重試載入聲音。",
    "Some sounds could not load. Basic sounds remain available.": "部分音效無法載入，仍可使用基本提示音。",
    "Audio credits": "聲音素材致謝",
    "Game audio uses CC0 recordings and music, edited and hosted by KenSei Workshop. Music and sound preferences stay on this device.": "遊戲採用 CC0 錄音與音樂，由 KenSei Workshop 編輯並於本站提供。音效和音樂偏好只保存在此裝置。",
    "Audio sources and processing manifest": "聲音來源與處理清單",
    "CC0 license": "CC0 授權",
    "Game sound effects default to 35% and background music to 12%, after you start, continue or Ready. Previously muted settings stay muted. Audio files come from this site; games do not connect to external sound libraries. Go countdown reminders use the existing match clock. Sound settings stay on this device and do not enter game saves, rankings or account records.": "開始、繼續或按下 Ready 後，遊戲音效預設為 35%，背景音樂為 12%。原有靜音設定會保留。聲音檔案由本站提供，遊戲不會連線至外部音效庫。圍棋讀秒提示沿用既有對局時鐘。聲音設定只保存在此裝置，不會進入存檔、排行榜或帳號紀錄。",
}
catalog = {
    "m_"
    + hashlib.sha256(" ".join(en.split()).encode()).hexdigest()[:12]: {
        "en": en,
        "zh-Hant": zh,
    }
    for en, zh in PAIRS.items()
}
(ROOT / "src/i18n/catalog/game-audio.json").write_text(
    json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(f"Updated {len(catalog)} game-audio locale keys.")
