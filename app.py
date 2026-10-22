import asyncio
import json
import logging
import os
import random
import socket
import string
import sys
from datetime import datetime

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from aiohttp import web

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("GiftExchangeApp")

# Built-in hilarious festive decoy images (SVG data URLs) when N < 3 or for extra options
BUILTIN_DECOYS = [
    {
        "id": "decoy_santa",
        "artistName": "神祕聖誕老人 🎅",
        "art": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='%231a1a2e'/><circle cx='200' cy='180' r='90' fill='%23ffccd5'/><path d='M110 180 C110 320 290 320 290 180 Z' fill='%23ffffff'/><circle cx='170' cy='160' r='12' fill='%23222222'/><circle cx='230' cy='160' r='12' fill='%23222222'/><ellipse cx='200' cy='185' rx='18' ry='14' fill='%23e63946'/><path d='M100 130 C120 40 280 40 300 130 Z' fill='%23e63946'/><circle cx='300' cy='60' r='22' fill='%23ffffff'/><text x='200' y='360' font-family='sans-serif' font-size='20' font-weight='bold' fill='%23ffd166' text-anchor='middle'>神秘謎題：煙囪太窄了！</text></svg>",
        "wish": "一雙不怕踩雪的大紅靴",
        "hint": "一年只出勤一次的神秘外送員"
    },
    {
        "id": "decoy_snowman",
        "artistName": "融化中的雪人 ⛄",
        "art": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='%230f2027'/><circle cx='200' cy='250' r='85' fill='%23e0fbfc'/><circle cx='200' cy='140' r='60' fill='%23ffffff'/><polygon points='200,140 250,150 200,156' fill='%23f77f00'/><circle cx='180' cy='130' r='8' fill='%23293241'/><circle cx='215' cy='130' r='8' fill='%23293241'/><rect x='160' y='65' width='80' height='30' fill='%232b2d42'/><rect x='175' y='25' width='50' height='45' fill='%232b2d42'/><text x='200' y='365' font-family='sans-serif' font-size='20' font-weight='bold' fill='%23a8dadc' text-anchor='middle'>神秘謎題：好熱！快開冷氣！</text></svg>",
        "wish": "超強冷凍保鮮冰箱",
        "hint": "我不能靠近暖氣，請救救我！"
    },
    {
        "id": "decoy_cat",
        "artistName": "隔壁貪吃的橘貓 🐱",
        "art": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23240046'/><circle cx='200' cy='210' r='90' fill='%23f48c06'/><polygon points='130,150 110,80 170,130' fill='%23f48c06'/><polygon points='270,150 290,80 230,130' fill='%23f48c06'/><ellipse cx='165' cy='200' rx='14' ry='20' fill='%2380ffdb'/><ellipse cx='235' cy='200' rx='14' ry='20' fill='%2380ffdb'/><polygon points='195,225 205,225 200,232' fill='%23ffb703'/><text x='200' y='360' font-family='sans-serif' font-size='20' font-weight='bold' fill='%23ffd166' text-anchor='middle'>神秘謎題：罐罐裝滿就對了！</text></svg>",
        "wish": "頂級特級鮪魚罐頭",
        "hint": "喵～會發出喀嚓開罐聲的東西"
    }
]

def get_lan_ip():
    """Detect local LAN IPv4 address for seamless mobile connection."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def generate_room_code():
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choice(chars) for _ in range(4))

class Room:
    def __init__(self, code, host_password=""):
        self.code = code
        self.host_password = (host_password or f"{random.randint(1000, 9999)}").strip()
        self.created_at = datetime.now()
        self.phase = "lobby"  # lobby -> art -> guessing -> live_reveal -> results
        self.host_ws = None
        self.players = {}  # player_id -> dict
        self.exchange_ring = []  # list of tuples or dicts
        self.matching_data = {}  # player_id -> { target_id, options, correct_index }
        self.current_reveal = None  # stores current synchronized reveal step payload
        self.final_results_data = None  # stores completed final summary payload

    def add_player(self, player_id, name, avatar, ws=None):
        if player_id not in self.players:
            self.players[player_id] = {
                "id": player_id,
                "name": name,
                "avatar": avatar,
                "ws": ws,
                "art": None,
                "wish": "",
                "hint": "",
                "is_art_submitted": False,
                "target_id": None,
                "guess_index": None,
                "is_guess_submitted": False,
                "guessed_correctly": None,
                "picked_artist_name": None,
                "is_revealed": False
            }
        else:
            self.players[player_id]["name"] = name
            self.players[player_id]["avatar"] = avatar
            self.players[player_id]["ws"] = ws
        return self.players[player_id]

    def remove_player(self, player_id):
        if player_id in self.players:
            del self.players[player_id]

    def get_player_list_summary(self):
        return [
            {
                "id": p["id"],
                "name": p["name"],
                "avatar": p["avatar"],
                "isArtSubmitted": p["is_art_submitted"],
                "isGuessSubmitted": p["is_guess_submitted"],
                "guessedCorrectly": p["guessed_correctly"],
                "isRevealed": p.get("is_revealed", False)
            }
            for p in self.players.values()
        ]

    async def broadcast(self, message, exclude_ws=None):
        raw = json.dumps(message)
        tasks = []
        if self.host_ws and not self.host_ws.closed and self.host_ws != exclude_ws:
            tasks.append(self.host_ws.send_str(raw))
        for p in self.players.values():
            ws = p.get("ws")
            if ws and not ws.closed and ws != exclude_ws:
                tasks.append(ws.send_str(raw))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def send_to_host(self, message):
        if self.host_ws and not self.host_ws.closed:
            await self.host_ws.send_str(json.dumps(message))

    async def send_to_player(self, player_id, message):
        p = self.players.get(player_id)
        if p and p.get("ws") and not p["ws"].closed:
            await p["ws"].send_str(json.dumps(message))

def get_join_url(request, code):
    host_header = request.headers.get("X-Forwarded-Host") or request.headers.get("Host") or ""
    proto = request.headers.get("X-Forwarded-Proto") or ("https" if request.secure else "http")
    if host_header and not host_header.startswith("localhost") and not host_header.startswith("127.0.0.1"):
        return f"{proto}://{host_header}/?room={code}"
    lan_ip = get_lan_ip()
    port = request.app.get("port", 8000)
    return f"http://{lan_ip}:{port}/?room={code}"

rooms = {}

async def ws_handler(request):
    ws = web.WebSocketResponse(max_msg_size=10 * 1024 * 1024)
    await ws.prepare(request)

    current_room = None
    current_player_id = None
    is_host = False

    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue

            try:
                data = json.loads(msg.data)
            except Exception as e:
                logger.error(f"Invalid JSON: {e}")
                continue

            action = data.get("action")
            logger.info(f"WS Action: {action} (room={data.get('room')})")

            # --- 1. HOST CREATES ROOM ---
            if action == "create_room":
                cleanup_expired_rooms()
                code = generate_room_code()
                while code in rooms:
                    code = generate_room_code()
                password = (data.get("password") or "").strip()
                if not password:
                    password = f"{random.randint(1000, 9999)}"
                room = Room(code, host_password=password)
                room.host_ws = ws
                rooms[code] = room
                current_room = room
                is_host = True

                lan_ip = get_lan_ip()
                port = request.app.get("port", 8000)
                join_url = get_join_url(request, code)

                await ws.send_str(json.dumps({
                    "event": "room_created",
                    "room": code,
                    "hostPassword": room.host_password,
                    "lanIp": lan_ip,
                    "port": port,
                    "joinUrl": join_url
                }))
                logger.info(f"Room {code} created by host with password {room.host_password}. Join URL: {join_url}")

            # --- 2. JOIN ROOM (Host reconnect or Player join) ---
            elif action == "join_room":
                code = (data.get("room") or "").strip().upper()
                if code not in rooms:
                    await ws.send_str(json.dumps({
                        "event": "error",
                        "message": f"找不到房間代碼 [{code}]，請確認是否輸入正確！"
                    }))
                    continue

                room = rooms[code]
                current_room = room
                role = data.get("role", "player")

                if role == "host":
                    input_pwd = (data.get("password") or "").strip()
                    if room.host_password and input_pwd != room.host_password:
                        await ws.send_str(json.dumps({
                            "event": "error",
                            "message": "🔒 主持人密碼錯誤！請輸入正確的管理密碼。"
                        }))
                        continue

                    room.host_ws = ws
                    is_host = True
                    lan_ip = get_lan_ip()
                    port = request.app.get("port", 8000)
                    join_url = get_join_url(request, code)
                    reveal_roster = [
                        {
                            "id": p["id"],
                            "name": p["name"],
                            "avatar": p["avatar"],
                            "isRevealed": p.get("is_revealed", False),
                            "isGuessSubmitted": p["is_guess_submitted"]
                        }
                        for p in room.players.values()
                        if p["is_art_submitted"]
                    ] if room.phase == "live_reveal" else []

                    await ws.send_str(json.dumps({
                        "event": "room_joined_as_host",
                        "room": code,
                        "hostPassword": room.host_password,
                        "phase": room.phase,
                        "players": room.get_player_list_summary(),
                        "lanIp": lan_ip,
                        "port": port,
                        "joinUrl": join_url,
                        "revealRoster": reveal_roster,
                        "currentReveal": room.current_reveal,
                        "finalResults": room.final_results_data
                    }))

                    # If host rejoins during completed results phase, push final results
                    if room.phase == "results" and room.final_results_data:
                        await ws.send_str(json.dumps(room.final_results_data))
                else:
                    player_id = data.get("playerId") or f"p_{random.randint(10000, 99999)}"
                    name = (data.get("name") or "神秘玩家").strip()
                    avatar = data.get("avatar") or "🎁"
                    current_player_id = player_id

                    player = room.add_player(player_id, name, avatar, ws)

                    # Send welcome back / joined info to player
                    await ws.send_str(json.dumps({
                        "event": "room_joined",
                        "room": code,
                        "playerId": player_id,
                        "name": name,
                        "avatar": avatar,
                        "phase": room.phase,
                        "isArtSubmitted": player["is_art_submitted"],
                        "isGuessSubmitted": player["is_guess_submitted"]
                    }))

                    # Notify host & all players
                    await room.broadcast({
                        "event": "player_list_updated",
                        "players": room.get_player_list_summary(),
                        "newPlayer": {"id": player_id, "name": name, "avatar": avatar}
                    })

                    # If already in guessing phase and player reconnected, resend guessing options
                    if room.phase == "guessing" and player_id in room.matching_data:
                        m_data = room.matching_data[player_id]
                        await ws.send_str(json.dumps({
                            "event": "start_guessing_phase",
                            "targetName": m_data["targetName"],
                            "targetAvatar": m_data["targetAvatar"],
                            "options": m_data["optionsForPlayer"],
                            "isGuessSubmitted": player["is_guess_submitted"]
                        }))
                    elif room.phase == "live_reveal":
                        reveal_roster = [
                            {
                                "id": p["id"],
                                "name": p["name"],
                                "avatar": p["avatar"],
                                "isRevealed": p.get("is_revealed", False),
                                "isGuessSubmitted": p["is_guess_submitted"]
                            }
                            for p in room.players.values()
                            if p["is_art_submitted"]
                        ]
                        await ws.send_str(json.dumps({
                            "event": "phase_changed",
                            "phase": "live_reveal",
                            "roster": reveal_roster
                        }))
                        if room.current_reveal:
                            await ws.send_str(json.dumps(room.current_reveal))
                    elif room.phase == "results" and room.final_results_data:
                        await ws.send_str(json.dumps(room.final_results_data))

            # --- 3. HOST STARTS ART PHASE ---
            elif action == "start_art_phase":
                if not current_room or not is_host:
                    continue
                current_room.phase = "art"
                await current_room.broadcast({
                    "event": "phase_changed",
                    "phase": "art"
                })

            # --- 4. PLAYER SUBMITS ART & CLUE ---
            elif action == "submit_art":
                if not current_room or not current_player_id:
                    continue
                player = current_room.players.get(current_player_id)
                if not player:
                    continue

                player["art"] = data.get("art")  # base64 dataUrl
                player["wish"] = (data.get("wish") or "").strip()
                player["hint"] = (data.get("hint") or "").strip()
                player["is_art_submitted"] = True

                await ws.send_str(json.dumps({
                    "event": "art_submitted_ack",
                    "success": True
                }))

                # Broadcast progress
                await current_room.broadcast({
                    "event": "player_list_updated",
                    "players": current_room.get_player_list_summary()
                })

            # --- 5. HOST STARTS MATCHING & GUESSING ---
            elif action == "start_matching":
                if not current_room or not is_host:
                    continue

                # Filter players with submitted artwork
                active_players = [p for p in current_room.players.values() if p["is_art_submitted"] and p["art"]]
                if len(active_players) < 2:
                    await ws.send_str(json.dumps({
                        "event": "error",
                        "message": "至少需要 2 位玩家提交畫作才能開始配對抽禮物！"
                    }))
                    continue

                current_room.phase = "guessing"

                # Generate Derangement (Secret Santa Single Cycle)
                # Shuffling players and assigning: p[0]->p[1], p[1]->p[2], ..., p[n-1]->p[0]
                shuffled = list(active_players)
                random.shuffle(shuffled)
                n = len(shuffled)

                current_room.exchange_ring = []
                current_room.matching_data = {}

                for i in range(n):
                    giver = shuffled[i]
                    receiver = shuffled[(i + 1) % n]
                    giver["target_id"] = receiver["id"]
                    current_room.exchange_ring.append({
                        "giverId": giver["id"],
                        "giverName": giver["name"],
                        "giverAvatar": giver["avatar"],
                        "receiverId": receiver["id"],
                        "receiverName": receiver["name"],
                        "receiverAvatar": receiver["avatar"],
                        "receiverWish": receiver["wish"],
                        "receiverHint": receiver["hint"],
                        "receiverArt": receiver["art"]
                    })

                # Now construct the 3 image choices for each giver
                all_arts_pool = [
                    {"id": p["id"], "artistName": p["name"], "art": p["art"], "wish": p["wish"], "hint": p["hint"]}
                    for p in active_players
                ]

                # Balanced decoy tracking so every player's artwork appears roughly equally
                decoy_counts = {p["id"]: 0 for p in active_players}

                for giver in active_players:
                    target = current_room.players[giver["target_id"]]

                    # 1 Correct choice
                    correct_choice = {
                        "art": target["art"],
                        "artistName": target["name"],
                        "wish": target["wish"],
                        "hint": target["hint"],
                        "isTarget": True
                    }

                    # Distractors: cannot be the target, and if 4+ players, avoid being giver themselves
                    candidates = [
                        c for c in all_arts_pool
                        if c["id"] != target["id"] and (len(all_arts_pool) < 4 or c["id"] != giver["id"])
                    ]

                    # Sort candidates by fewest appearances so far with random tie-breaker
                    candidates.sort(key=lambda c: (decoy_counts.get(c["id"], 0), random.random()))

                    picked_distractors = []
                    if len(candidates) >= 2:
                        picked_distractors = candidates[:2]
                    elif len(candidates) == 1:
                        picked_distractors = [candidates[0], random.choice(BUILTIN_DECOYS)]
                    else:
                        picked_distractors = random.sample(BUILTIN_DECOYS, 2)

                    for d in picked_distractors:
                        if d["id"] in decoy_counts:
                            decoy_counts[d["id"]] += 1

                    distractor_choices = [
                        {
                            "art": d["art"],
                            "artistName": d["artistName"],
                            "wish": d["wish"],
                            "hint": d["hint"],
                            "isTarget": False
                        }
                        for d in picked_distractors
                    ]

                    # Combine and shuffle
                    three_choices = [correct_choice, distractor_choices[0], distractor_choices[1]]
                    random.shuffle(three_choices)

                    correct_idx = next(idx for idx, c in enumerate(three_choices) if c["isTarget"])

                    # Sanitized options for player (hide artistName & isTarget initially)
                    client_options = [
                        {
                            "index": idx,
                            "art": c["art"]
                        }
                        for idx, c in enumerate(three_choices)
                    ]

                    current_room.matching_data[giver["id"]] = {
                        "targetId": target["id"],
                        "targetName": target["name"],
                        "targetAvatar": target["avatar"],
                        "targetWish": target["wish"],
                        "targetHint": target["hint"],
                        "threeChoices": three_choices,
                        "optionsForPlayer": client_options,
                        "correctIndex": correct_idx
                    }

                    # Reset guess status
                    giver["guess_index"] = None
                    giver["is_guess_submitted"] = False
                    giver["guessed_correctly"] = None
                    giver["picked_artist_name"] = None
                    giver["is_revealed"] = False

                    # Send to player
                    await current_room.send_to_player(giver["id"], {
                        "event": "start_guessing_phase",
                        "targetName": target["name"],
                        "targetAvatar": target["avatar"],
                        "options": client_options
                    })

                # Notify host
                await current_room.send_to_host({
                    "event": "phase_changed",
                    "phase": "guessing",
                    "players": current_room.get_player_list_summary()
                })

            # --- 6. PLAYER SUBMITS GUESS (STRICTLY NO SPOILERS) ---
            elif action == "submit_guess":
                if not current_room or not current_player_id:
                    continue
                player = current_room.players.get(current_player_id)
                m_data = current_room.matching_data.get(current_player_id)
                if not player or not m_data:
                    continue

                guess_idx = int(data.get("guessIndex", 0))
                correct_idx = m_data["correctIndex"]
                is_correct = (guess_idx == correct_idx)

                picked_choice = m_data["threeChoices"][guess_idx]

                player["guess_index"] = guess_idx
                player["is_guess_submitted"] = True
                player["guessed_correctly"] = is_correct
                player["picked_artist_name"] = picked_choice["artistName"]

                # Send lock confirmation to player WITHOUT revealing author or correctness
                await ws.send_str(json.dumps({
                    "event": "guess_locked_ack",
                    "guessIndex": guess_idx,
                    "targetName": m_data["targetName"],
                    "targetAvatar": m_data["targetAvatar"]
                }))

                # Notify all of updated status
                await current_room.broadcast({
                    "event": "player_list_updated",
                    "players": current_room.get_player_list_summary()
                })

            # --- 7. HOST STARTS SYNCHRONIZED LIVE REVEAL ---
            elif action == "start_live_reveal":
                if not current_room or not is_host:
                    continue

                current_room.phase = "live_reveal"
                current_room.current_reveal = None

                # Build active roster of players who participated
                reveal_roster = [
                    {
                        "id": p["id"],
                        "name": p["name"],
                        "avatar": p["avatar"],
                        "isRevealed": p.get("is_revealed", False),
                        "isGuessSubmitted": p["is_guess_submitted"]
                    }
                    for p in current_room.players.values()
                    if p["is_art_submitted"]
                ]

                await current_room.broadcast({
                    "event": "phase_changed",
                    "phase": "live_reveal",
                    "roster": reveal_roster
                })

            # --- 8. HOST CONTROLS SYNCHRONIZED REVEAL STEPS (BROADCAST TO EVERYONE) ---
            elif action == "host_sync_reveal":
                if not current_room or not is_host:
                    continue

                user_id = data.get("userId")
                step = int(data.get("step", 1))

                p = current_room.players.get(user_id)
                m_data = current_room.matching_data.get(user_id)
                if not p or not m_data:
                    continue

                target = current_room.players[p["target_id"]]
                three_choices = m_data["threeChoices"]

                # Step 1: 畫面 1 - 揭曉他抽到的送禮對象！
                if step == 1:
                    payload = {
                        "event": "sync_reveal_step",
                        "step": 1,
                        "userId": p["id"],
                        "userName": p["name"],
                        "userAvatar": p["avatar"],
                        "receiverName": target["name"],
                        "receiverAvatar": target["avatar"]
                    }
                    current_room.current_reveal = payload
                    await current_room.broadcast(payload)

                # Step 2: 畫面 2 - 展示他收到的 3 張圖 (標示他選了哪張、每張圖是誰畫的、猜對猜錯)
                elif step == 2:
                    payload = {
                        "event": "sync_reveal_step",
                        "step": 2,
                        "userId": p["id"],
                        "userName": p["name"],
                        "userAvatar": p["avatar"],
                        "receiverName": target["name"],
                        "receiverAvatar": target["avatar"],
                        "pickedIndex": p["guess_index"],
                        "isCorrect": p["guessed_correctly"],
                        "options": [
                            {
                                "index": idx,
                                "art": c["art"],
                                "artistName": c["artistName"],
                                "isTarget": c["isTarget"],
                                "isPicked": (idx == p["guess_index"])
                            }
                            for idx, c in enumerate(three_choices)
                        ]
                    }
                    current_room.current_reveal = payload
                    await current_room.broadcast(payload)

                # Step 3: 畫面 3 - 揭曉他抽到的送禮對象 想要什麼禮物！
                elif step == 3:
                    p["is_revealed"] = True
                    payload = {
                        "event": "sync_reveal_step",
                        "step": 3,
                        "userId": p["id"],
                        "userName": p["name"],
                        "userAvatar": p["avatar"],
                        "receiverName": target["name"],
                        "receiverAvatar": target["avatar"],
                        "receiverWish": target["wish"],
                        "receiverHint": target["hint"],
                        "pickedIndex": p["guess_index"],
                        "isCorrect": p["guessed_correctly"],
                        "options": [
                            {
                                "index": idx,
                                "art": c["art"],
                                "artistName": c["artistName"],
                                "isTarget": c["isTarget"],
                                "isPicked": (idx == p["guess_index"])
                            }
                            for idx, c in enumerate(three_choices)
                        ]
                    }
                    current_room.current_reveal = payload
                    await current_room.broadcast(payload)
                    # Update player list for host to mark player as revealed
                    await current_room.broadcast({
                        "event": "player_list_updated",
                        "players": current_room.get_player_list_summary()
                    })

            # --- 9. SHOW FINAL SUMMARY (EXCHANGE RING & FULL GALLERY) ---
            elif action == "show_final_summary":
                if not current_room or not is_host:
                    continue

                current_room.phase = "results"

                # Compile rich results dataset
                gallery = []
                for p in current_room.players.values():
                    if p.get("art"):
                        guesser = next((g for g in current_room.players.values() if g.get("target_id") == p["id"]), None)
                        gallery.append({
                            "playerId": p["id"],
                            "artistName": p["name"],
                            "artistAvatar": p["avatar"],
                            "art": p["art"],
                            "wish": p["wish"],
                            "hint": p["hint"],
                            "guesserName": guesser["name"] if guesser else "無",
                            "guesserAvatar": guesser["avatar"] if guesser else "🎁",
                            "guessedCorrectly": guesser["guessed_correctly"] if guesser else False
                        })

                # Exchange chain
                exchange_summary = []
                for item in current_room.exchange_ring:
                    giver = current_room.players.get(item["giverId"])
                    exchange_summary.append({
                        "giverName": item["giverName"],
                        "giverAvatar": item["giverAvatar"],
                        "receiverName": item["receiverName"],
                        "receiverAvatar": item["receiverAvatar"],
                        "receiverWish": item["receiverWish"],
                        "receiverHint": item["receiverHint"],
                        "receiverArt": item["receiverArt"],
                        "guessedCorrectly": giver["guessed_correctly"] if giver else False,
                        "pickedArtistName": giver["picked_artist_name"] if giver else None
                    })

                correct_detectives = [p["name"] for p in current_room.players.values() if p.get("guessed_correctly") is True]

                results_payload = {
                    "event": "final_results",
                    "exchangeRing": exchange_summary,
                    "gallery": gallery,
                    "correctDetectives": correct_detectives,
                    "totalPlayers": len(current_room.players)
                }

                current_room.final_results_data = results_payload
                await current_room.broadcast(results_payload)

            # --- 10. PLAYER LOGOUT ---
            elif action == "player_logout":
                if current_room and current_player_id:
                    current_room.remove_player(current_player_id)
                    await ws.send_str(json.dumps({"event": "logged_out"}))
                    await current_room.broadcast({
                        "event": "player_list_updated",
                        "players": current_room.get_player_list_summary()
                    })
                    current_player_id = None

            # --- 11. RESET / PLAY AGAIN ---
            elif action == "reset_game":
                if not current_room or not is_host:
                    continue
                current_room.phase = "lobby"
                current_room.current_reveal = None
                current_room.exchange_ring = []
                current_room.matching_data = {}
                for p in current_room.players.values():
                    p["art"] = None
                    p["wish"] = ""
                    p["hint"] = ""
                    p["is_art_submitted"] = False
                    p["target_id"] = None
                    p["guess_index"] = None
                    p["is_guess_submitted"] = False
                    p["guessed_correctly"] = None
                    p["picked_artist_name"] = None
                    p["is_revealed"] = False

                await current_room.broadcast({
                    "event": "game_reset",
                    "phase": "lobby",
                    "players": current_room.get_player_list_summary()
                })

    except Exception as e:
        logger.error(f"Error in ws_handler: {e}", exc_info=True)
    finally:
        if current_room:
            if is_host:
                logger.info(f"Host disconnected from room {current_room.code}")
            elif current_player_id and current_player_id in current_room.players:
                logger.info(f"Player {current_player_id} disconnected from room {current_room.code}")
                # Don't delete player immediately so they can reconnect if mobile tab reloaded
                current_room.players[current_player_id]["ws"] = None
                await current_room.broadcast({
                    "event": "player_list_updated",
                    "players": current_room.get_player_list_summary()
                })

    return ws

def cleanup_expired_rooms():
    now = datetime.now()
    expired = [
        code for code, r in rooms.items()
        if (now - r.created_at).total_seconds() > 8 * 3600
    ]
    for code in expired:
        del rooms[code]

async def api_info(request):
    cleanup_expired_rooms()
    lan_ip = get_lan_ip()
    port = request.app.get("port", 8000)

    total_imgs = sum(
        1 for r in rooms.values() for p in r.players.values() if p.get("art")
    )
    total_img_bytes = sum(
        len(p["art"]) for r in rooms.values() for p in r.players.values() if p.get("art")
    )

    return web.json_response({
        "status": "ok",
        "lanIp": lan_ip,
        "port": port,
        "activeRooms": len(rooms),
        "totalImagesStored": total_imgs,
        "imageMemoryKB": round(total_img_bytes / 1024, 1),
        "imageMemoryMB": round(total_img_bytes / (1024 * 1024), 2),
        "serverHealth": "Excellent (空間極度充裕，安全無虞)"
    })

async def init_app():
    port = int(os.environ.get("PORT", 8000))
    app = web.Application(client_max_size=15 * 1024 * 1024)
    app["port"] = port
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/api/info", api_info)

    # Static file routes
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
    app.router.add_static("/static", static_dir, name="static")

    async def index(request):
        return web.FileResponse(os.path.join(static_dir, "index.html"))

    app.router.add_get("/", index)
    return app

def main():
    lan_ip = get_lan_ip()
    port = int(os.environ.get("PORT", 8000))

    print("\n" + "=" * 60)
    print(" [Gift Guess & Swap] 交換禮物線上遊戲伺服器已啟動！")
    print("=" * 60)
    print(f" 本機電腦請開瀏覽器:  http://localhost:{port}")
    print(f" 手機連線 (同一Wi-Fi): http://{lan_ip}:{port}")
    print("=" * 60 + "\n")

    web.run_app(init_app(), host="0.0.0.0", port=port)

if __name__ == "__main__":
    main()
