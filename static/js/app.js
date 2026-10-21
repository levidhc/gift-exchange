// ==========================================================================
// 禮物心機猜猜樂 (Gift Guess & Swap) - Main Frontend Application
// ==========================================================================

const EMOJI_AVATARS = ['🎅', '🎄', '🎁', '⛄', '🦌', '🧦', '🍪', '🔔', '⭐', '🛷', '🦊', '🐱'];

const AppState = {
    mode: null, // 'online' | 'pass_and_play'
    role: null, // 'host' | 'player'
    roomCode: null,
    playerId: null,
    playerName: '',
    playerAvatar: '🎁',
    ws: null,
    joinUrl: '',
    drawingStudio: null,
    selectedGuessIndex: null,
    
    // Pass and Play local game state
    localGame: {
        players: [], // array of { id, name, avatar, wish, hint, art, targetId, options, guessIndex, isCorrect, pickedArtistName }
        currentPlayerIndex: 0,
        stage: 'setup' // 'setup' | 'draw_shield' | 'drawing' | 'guess_shield' | 'guessing' | 'results'
    }
};

// UI Element Helpers
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function showView(viewId) {
    $$('.view-section').forEach(el => el.classList.remove('active'));
    const target = $(viewId);
    if (target) {
        target.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function showToast(message, duration = 3000) {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function triggerConfetti() {
    if (typeof confetti === 'function') {
        confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 }
        });
        setTimeout(() => {
            confetti({
                particleCount: 50,
                angle: 60,
                spread: 55,
                origin: { x: 0 }
            });
            confetti({
                particleCount: 50,
                angle: 120,
                spread: 55,
                origin: { x: 1 }
            });
        }, 200);
    }
}

// ==========================================================================
// Initialization & Mode Selection
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    // Sound toggle button
    const btnMute = $('btn-sound-toggle');
    if (btnMute) {
        btnMute.innerText = window.sound.isMuted ? '🔇' : '🔊';
        btnMute.addEventListener('click', () => {
            const muted = window.sound.toggleMute();
            btnMute.innerText = muted ? '🔇' : '🔊';
            showToast(muted ? '音效已靜音' : '音效已開啟');
        });
    }

    // Rule modal
    $('btn-rules').addEventListener('click', () => {
        $('modal-rules').classList.add('open');
        if (window.sound) window.sound.playClick();
    });
    $('btn-close-rules').addEventListener('click', () => {
        $('modal-rules').classList.remove('open');
    });

    // Zoom modal close
    $('btn-close-zoom').addEventListener('click', () => {
        $('modal-zoom').classList.remove('open');
    });

    // Accordion toggle in art phase
    $('btn-toggle-hints').addEventListener('click', () => {
        const content = $('hints-content');
        content.classList.toggle('open');
        $('btn-toggle-hints').innerText = content.classList.contains('open') ? '💡 收起創意靈感' : '💡 點此查看創意範例靈感庫';
    });

    // Initialize Canvas Studio
    AppState.drawingStudio = new DrawingStudio('art-canvas', 'canvas-card-wrapper');
    setupCanvasControls();

    // Check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const hostFromUrl = urlParams.get('host') || (urlParams.get('role') === 'host' ? urlParams.get('room') : null);
    const roomFromUrl = urlParams.get('room');

    if (hostFromUrl) {
        // Direct reconnect as host from URL: ?host=EV94 or ?room=EV94&role=host
        connectWebSocket('host', hostFromUrl.toUpperCase());
    } else if (roomFromUrl) {
        openJoinModal(roomFromUrl.toUpperCase(), 'player');
    } else {
        showView('view-home');
        // Check if there is a previously saved host room
        const savedHostRoom = localStorage.getItem('host_room_code');
        if (savedHostRoom) {
            const banner = $('banner-resume-host');
            if (banner) {
                banner.style.display = 'flex';
                $('resume-host-code').innerText = savedHostRoom;
                $('btn-resume-host-action').onclick = () => {
                    connectWebSocket('host', savedHostRoom);
                };
            }
        }
    }

    setupHomeButtons();
    setupPassAndPlayUI();
}

// Open Zoom Modal
function openZoomModal(imageSrc, caption = '') {
    $('modal-zoom-img').src = imageSrc;
    $('modal-zoom-caption').innerText = caption;
    $('modal-zoom').classList.add('open');
    if (window.sound) window.sound.playClick();
}

// ==========================================================================
// Home & Join Modal Setup
// ==========================================================================

let activeJoinTab = 'player'; // 'player' | 'host'

function setupHomeButtons() {
    // 1. Create Room (Host)
    $('btn-mode-create').addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.sound) window.sound.playClick();
        startOnlineGameAsHost();
    });

    // 1.2 Reconnect to Existing Room as Host
    const btnReconnectHost = $('btn-mode-reconnect-host');
    if (btnReconnectHost) {
        btnReconnectHost.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.sound) window.sound.playClick();
            openJoinModal('', 'host');
        });
    }

    // 2. Join Room (Player)
    $('btn-mode-join').addEventListener('click', () => {
        if (window.sound) window.sound.playClick();
        openJoinModal('', 'player');
    });

    // 3. Pass & Play Mode
    $('btn-mode-pass').addEventListener('click', () => {
        if (window.sound) window.sound.playClick();
        startPassAndPlay();
    });

    // Join Modal Tab Toggles
    const tabPlayer = $('tab-join-player');
    const tabHost = $('tab-join-host');

    if (tabPlayer && tabHost) {
        tabPlayer.addEventListener('click', () => switchJoinTab('player'));
        tabHost.addEventListener('click', () => switchJoinTab('host'));
    }

    // Join Form actions
    $('btn-cancel-join').addEventListener('click', () => {
        $('modal-join').classList.remove('open');
    });

    $('btn-submit-join').addEventListener('click', () => {
        submitJoinRoom();
    });
}

function switchJoinTab(tab) {
    activeJoinTab = tab;
    const tabPlayer = $('tab-join-player');
    const tabHost = $('tab-join-host');
    const playerFields = $('join-player-specific-fields');
    const hostHint = $('join-host-hint');
    const title = $('modal-join-title');
    const btnSubmit = $('btn-submit-join');

    if (tab === 'host') {
        tabHost.style.background = 'var(--festive-gold)';
        tabHost.style.color = '#1a1a2e';
        tabHost.style.fontWeight = '700';

        tabPlayer.style.background = 'transparent';
        tabPlayer.style.color = 'var(--text-muted)';
        tabPlayer.style.fontWeight = 'normal';

        if (title) title.innerText = '👑 重返主持房間';
        if (playerFields) playerFields.style.display = 'none';
        if (hostHint) hostHint.style.display = 'block';
        if (btnSubmit) btnSubmit.innerText = '以主持人身分進入 ➔';
    } else {
        tabPlayer.style.background = 'var(--primary-red)';
        tabPlayer.style.color = '#fff';
        tabPlayer.style.fontWeight = '700';

        tabHost.style.background = 'transparent';
        tabHost.style.color = 'var(--text-muted)';
        tabHost.style.fontWeight = 'normal';

        if (title) title.innerText = '📱 加入遊戲房間';
        if (playerFields) playerFields.style.display = 'block';
        if (hostHint) hostHint.style.display = 'none';
        if (btnSubmit) btnSubmit.innerText = '進入房間 ➔';
    }

    if (window.sound) window.sound.playClick();
}

function openJoinModal(prefilledCode = '', initialTab = 'player') {
    $('input-join-room').value = prefilledCode;
    $('input-join-name').value = localStorage.getItem('player_name') || '';

    // Render avatar selection
    const grid = $('avatar-selector-grid');
    grid.innerHTML = '';
    const savedAvatar = localStorage.getItem('player_avatar') || EMOJI_AVATARS[0];
    AppState.playerAvatar = savedAvatar;

    EMOJI_AVATARS.forEach(emoji => {
        const div = document.createElement('div');
        div.className = `avatar-option ${emoji === savedAvatar ? 'selected' : ''}`;
        div.innerText = emoji;
        div.addEventListener('click', () => {
            $$('.avatar-option').forEach(el => el.classList.remove('selected'));
            div.classList.add('selected');
            AppState.playerAvatar = emoji;
            if (window.sound) window.sound.playClick();
        });
        grid.appendChild(div);
    });

    switchJoinTab(initialTab);
    $('modal-join').classList.add('open');
}

function submitJoinRoom() {
    const code = $('input-join-room').value.trim().toUpperCase();

    if (!code) {
        showToast('請輸入 4 碼房間代碼！');
        return;
    }

    if (activeJoinTab === 'host') {
        // Reconnect as Host
        AppState.roomCode = code;
        AppState.role = 'host';
        AppState.mode = 'online';
        $('modal-join').classList.remove('open');
        connectWebSocket('host', code);
    } else {
        // Join as Player
        const name = $('input-join-name').value.trim();
        if (!name) {
            showToast('請輸入你的暱稱！');
            return;
        }

        localStorage.setItem('player_name', name);
        localStorage.setItem('player_avatar', AppState.playerAvatar);

        AppState.playerName = name;
        AppState.roomCode = code;
        AppState.role = 'player';
        AppState.mode = 'online';

        $('modal-join').classList.remove('open');
        connectWebSocket('player', code, name, AppState.playerAvatar);
    }
}

// ==========================================================================
// Online Multiplayer: Host Flow
// ==========================================================================

function startOnlineGameAsHost() {
    AppState.mode = 'online';
    AppState.role = 'host';
    connectWebSocket('host');
}

function renderHostLobby(roomCode, joinUrl) {
    AppState.roomCode = roomCode;

    // Use current browser origin if on a public domain (e.g. onrender.com)
    let actualJoinUrl = `${window.location.origin}/?room=${roomCode}`;
    if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && joinUrl) {
        actualJoinUrl = joinUrl;
    }

    AppState.joinUrl = actualJoinUrl;

    $('host-room-code').innerText = roomCode;
    $('host-join-url-input').value = actualJoinUrl;
    $('badge-room-code').innerText = `房間：${roomCode}`;
    $('header-room-badge').style.display = 'inline-flex';

    // Generate QR Code
    const qrContainer = $('host-qrcode-box');
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
        text: actualJoinUrl,
        width: 170,
        height: 170,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });

    // Copy link button
    $('btn-copy-join-link').onclick = () => {
        navigator.clipboard.writeText(actualJoinUrl).then(() => {
            showToast('已複製加入連結！📋');
        });
    };

    // Host Start Art Phase button
    $('btn-host-start-art').onclick = () => {
        if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
            AppState.ws.send(JSON.stringify({
                action: 'start_art_phase',
                room: AppState.roomCode
            }));
            if (window.sound) window.sound.playChime();
        }
    };

    showView('view-host-lobby');
}

function updateHostPlayerList(players) {
    const listContainer = $('host-player-chips');
    listContainer.innerHTML = '';

    const countSpan = $('host-player-count');
    const submittedCount = players.filter(p => p.isArtSubmitted).length;
    const guessedCount = players.filter(p => p.isGuessSubmitted).length;
    countSpan.innerText = `目前 ${players.length} 人加入 (已交畫作: ${submittedCount}/${players.length})`;

    const guessingCountText = $('host-guessing-count-text');
    if (guessingCountText) {
        guessingCountText.innerText = `${guessedCount} / ${players.length} 人已完成猜題`;
    }

    players.forEach(p => {
        const chip = document.createElement('div');
        chip.className = `player-chip ${p.isArtSubmitted ? 'submitted' : ''}`;
        let statusText = '加入中';
        if (p.isGuessSubmitted) {
            statusText = p.guessedCorrectly ? '🎯 猜中目標' : '💨 猜錯目標';
        } else if (p.isArtSubmitted) {
            statusText = '✓ 畫作已提交';
        }
        chip.innerHTML = `
            <div class="p-avatar">${p.avatar}</div>
            <div class="p-info">
                <div class="p-name">${p.name}</div>
                <div class="p-status">${statusText}</div>
            </div>
        `;
        listContainer.appendChild(chip);
    });

    // If host is viewing lobby, toggle start matching button if all or enough players submitted
    const btnStartMatching = $('btn-host-start-matching');
    if (btnStartMatching) {
        if (players.length >= 2 && submittedCount >= 2) {
            btnStartMatching.disabled = false;
            btnStartMatching.innerText = `🚀 開始抽籤配對與猜題 (${submittedCount}/${players.length} 人已完成)`;
        } else {
            btnStartMatching.disabled = true;
            btnStartMatching.innerText = `等待玩家提交畫作 (${submittedCount}/${players.length})`;
        }

        btnStartMatching.onclick = () => {
            if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
                AppState.ws.send(JSON.stringify({
                    action: 'start_matching',
                    room: AppState.roomCode
                }));
                if (window.sound) window.sound.playShuffle();
            }
        };
    }
}

// ==========================================================================
// WebSocket Connection & Event Dispatcher
// ==========================================================================

function connectWebSocket(role, roomCode = '', name = '', avatar = '') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    AppState.ws = ws;

    ws.onopen = () => {
        console.log('WebSocket connected.');
        if (role === 'host') {
            if (roomCode) {
                // Reconnect to existing room as host
                ws.send(JSON.stringify({
                    action: 'join_room',
                    room: roomCode,
                    role: 'host'
                }));
            } else {
                ws.send(JSON.stringify({ action: 'create_room' }));
            }
        } else {
            const savedPlayerId = sessionStorage.getItem('player_id');
            ws.send(JSON.stringify({
                action: 'join_room',
                room: roomCode,
                role: 'player',
                name: name,
                avatar: avatar,
                playerId: savedPlayerId
            }));
        }
    };

    ws.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            console.error('Invalid WS message', e);
            return;
        }

        handleServerEvent(data);
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        showToast('網路連線發生錯誤，請重新整理！');
    };

    ws.onclose = () => {
        console.log('WebSocket closed.');
    };
}

function handleServerEvent(data) {
    const ev = data.event;
    console.log('Server Event:', ev, data);

    if (ev === 'room_created') {
        localStorage.setItem('host_room_code', data.room);
        sessionStorage.setItem('host_room_code', data.room);
        renderHostLobby(data.room, data.joinUrl);
        if (window.sound) window.sound.playChime();
    }
    else if (ev === 'room_joined_as_host') {
        AppState.role = 'host';
        AppState.mode = 'online';
        AppState.roomCode = data.room;
        localStorage.setItem('host_room_code', data.room);
        sessionStorage.setItem('host_room_code', data.room);

        renderHostLobby(data.room, data.joinUrl);
        updateHostPlayerList(data.players);

        if (data.phase === 'art') {
            $('host-art-progress-panel').style.display = 'block';
        } else if (data.phase === 'guessing') {
            $('host-art-progress-panel').style.display = 'none';
            $('btn-host-start-art').style.display = 'none';
            $('host-guessing-progress-panel').style.display = 'block';
            $('btn-host-show-results-main').onclick = () => {
                if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
                    AppState.ws.send(JSON.stringify({
                        action: 'show_results',
                        room: AppState.roomCode
                    }));
                }
            };
        }
        showToast(`已成功以主持人身分返回房間 [${data.room}]！👑`);
        if (window.sound) window.sound.playChime();
    }
    else if (ev === 'room_joined') {
        AppState.playerId = data.playerId;
        sessionStorage.setItem('player_id', data.playerId);
        sessionStorage.setItem('room_code', data.room);
        AppState.roomCode = data.room;

        $('badge-room-code').innerText = `房間：${data.room}`;
        $('header-room-badge').style.display = 'inline-flex';

        $('player-lobby-avatar').innerText = data.avatar;
        $('player-lobby-name').innerText = data.name;

        if (data.phase === 'art' && !data.isArtSubmitted) {
            enterArtStudioView();
        } else if (data.phase === 'art' && data.isArtSubmitted) {
            showView('view-art-waiting');
        } else if (data.phase === 'guessing') {
            // Handled when options arrive
        } else {
            showView('view-player-lobby');
        }

        if (window.sound) window.sound.playChime();
        showToast(`成功加入房間 [${data.room}]！🎉`);
    }
    else if (ev === 'player_list_updated') {
        if (AppState.role === 'host') {
            updateHostPlayerList(data.players);
        }
    }
    else if (ev === 'phase_changed') {
        if (data.phase === 'art') {
            if (AppState.role === 'player') {
                enterArtStudioView();
            } else if (AppState.role === 'host') {
                // Host shows live submissions progress
                $('host-art-progress-panel').style.display = 'block';
                showToast('作畫階段開始！請玩家們在手機上創作線索圖 🎨');
            }
        } else if (data.phase === 'guessing') {
            if (AppState.role === 'host') {
                $('host-art-progress-panel').style.display = 'none';
                $('btn-host-start-art').style.display = 'none';
                $('host-guessing-progress-panel').style.display = 'block';
                $('btn-host-show-results-main').onclick = () => {
                    if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
                        AppState.ws.send(JSON.stringify({
                            action: 'show_results',
                            room: AppState.roomCode
                        }));
                    }
                };
            }
        }
    }
    else if (ev === 'art_submitted_ack') {
        showToast('畫作已成功送出！請等待其他玩家 🎁');
        showView('view-art-waiting');
        if (window.sound) window.sound.playChime();
    }
    else if (ev === 'start_guessing_phase') {
        renderGuessingView(data.targetName, data.targetAvatar, data.options);
    }
    else if (ev === 'guess_result') {
        renderGuessResultBanner(data);
    }
    else if (ev === 'final_results') {
        renderFinalShowcase(data);
    }
    else if (ev === 'game_reset') {
        showToast('遊戲已重置，準備開始新的一局！');
        if (AppState.role === 'host') {
            showView('view-host-lobby');
        } else {
            showView('view-player-lobby');
        }
    }
    else if (ev === 'error') {
        showToast(`⚠️ ${data.message}`);
    }
}

// ==========================================================================
// Canvas Studio Controls & Art Submission
// ==========================================================================

function setupCanvasControls() {
    // Color Swatches
    const colors = [
        '#1e1e24', '#f43f5e', '#fbbf24', '#10b981', '#06b6d4', 
        '#8b5cf6', '#ec4899', '#f97316', '#3b82f6', '#84cc16', 
        '#ffffff', '#78350f'
    ];
    const swatchContainer = $('color-swatches');
    swatchContainer.innerHTML = '';

    colors.forEach(col => {
        const dot = document.createElement('div');
        dot.className = `color-swatch ${col === '#1e1e24' ? 'active' : ''}`;
        dot.style.backgroundColor = col;
        dot.addEventListener('click', () => {
            $$('.color-swatch').forEach(el => el.classList.remove('active'));
            dot.classList.add('active');
            AppState.drawingStudio.setColor(col);
            $('btn-tool-eraser').classList.remove('active');
        });
        swatchContainer.appendChild(dot);
    });

    // Custom color input
    const colorPicker = $('custom-color-picker');
    colorPicker.addEventListener('input', (e) => {
        $$('.color-swatch').forEach(el => el.classList.remove('active'));
        AppState.drawingStudio.setColor(e.target.value);
        $('btn-tool-eraser').classList.remove('active');
    });

    // Brush Sizes
    const sizes = [
        { label: '4px', size: 4, dot: '8px' },
        { label: '8px', size: 8, dot: '14px' },
        { label: '16px', size: 16, dot: '20px' },
        { label: '26px', size: 26, dot: '28px' }
    ];
    const sizeContainer = $('brush-sizes-wrap');
    sizeContainer.innerHTML = '';
    sizes.forEach((s, idx) => {
        const dot = document.createElement('div');
        dot.className = `size-dot ${idx === 1 ? 'active' : ''}`;
        dot.style.width = s.dot;
        dot.style.height = s.dot;
        dot.title = s.label;
        dot.addEventListener('click', () => {
            $$('.size-dot').forEach(el => el.classList.remove('active'));
            dot.classList.add('active');
            AppState.drawingStudio.setBrushSize(s.size);
        });
        sizeContainer.appendChild(dot);
    });

    // Eraser
    $('btn-tool-eraser').addEventListener('click', () => {
        const isEraser = $('btn-tool-eraser').classList.toggle('active');
        AppState.drawingStudio.toggleEraser(isEraser);
    });

    // Neon brush
    $('btn-tool-neon').addEventListener('click', () => {
        const isNeon = $('btn-tool-neon').classList.toggle('active');
        AppState.drawingStudio.toggleNeon(isNeon);
    });

    // Undo
    $('btn-tool-undo').addEventListener('click', () => {
        AppState.drawingStudio.undo();
    });

    // Clear
    $('btn-tool-clear').addEventListener('click', () => {
        if (confirm('確定要清除畫布重畫嗎？')) {
            AppState.drawingStudio.clearCanvas(true);
        }
    });

    // Image file upload
    const fileInput = $('image-file-input');
    $('btn-upload-image').addEventListener('click', () => fileInput.click());
    $('dropzone-box').addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files[0]) {
            try {
                await AppState.drawingStudio.loadImageFile(e.target.files[0]);
                showToast('圖片已載入畫布！你可以繼續用畫筆加上裝飾或線索');
            } catch (err) {
                showToast(`載入失敗: ${err.message}`);
            }
        }
    });

    // Drag and drop onto canvas
    const dropzone = $('dropzone-box');
    ['dragenter', 'dragover'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--festive-gold)';
        });
    });
    ['dragleave', 'drop'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'rgba(255,255,255,0.2)';
        });
    });
    dropzone.addEventListener('drop', async (e) => {
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            try {
                await AppState.drawingStudio.loadImageFile(e.dataTransfer.files[0]);
                showToast('圖片已載入畫布！');
            } catch (err) {
                showToast(`載入失敗: ${err.message}`);
            }
        }
    });

    // Submit Art & Clue Button
    $('btn-submit-art-clue').addEventListener('click', () => {
        handleArtSubmission();
    });
}

function enterArtStudioView() {
    AppState.drawingStudio.clearCanvas(false);
    $('input-art-wish').value = '';
    $('input-art-hint').value = '';
    showView('view-art-studio');
}

function handleArtSubmission() {
    const wish = $('input-art-wish').value.trim();
    const hint = $('input-art-hint').value.trim();

    if (!wish) {
        showToast('請填寫你真正想要收到的禮物！🎁');
        $('input-art-wish').focus();
        return;
    }

    if (AppState.drawingStudio.isCanvasEmpty()) {
        showToast('請在畫布上畫畫，或上傳一張謎題圖片！🎨');
        return;
    }

    const compressedArtData = AppState.drawingStudio.getCompressedDataUrl();

    if (AppState.mode === 'online') {
        if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
            AppState.ws.send(JSON.stringify({
                action: 'submit_art',
                room: AppState.roomCode,
                art: compressedArtData,
                wish: wish,
                hint: hint
            }));
        }
    } else if (AppState.mode === 'pass_and_play') {
        handlePassAndPlayArtSubmit(compressedArtData, wish, hint);
    }
}

// ==========================================================================
// Guessing Phase: 3-Image Selection UI
// ==========================================================================

function renderGuessingView(targetName, targetAvatar, options) {
    $('target-avatar-display').innerText = targetAvatar || '🎯';
    $('target-name-display').innerText = targetName;
    $('target-name-desc').innerText = `請從以下 3 張線索圖中，找出哪一張是【${targetName}】畫的！`;

    AppState.selectedGuessIndex = null;
    const btnSubmit = $('btn-confirm-guess');
    btnSubmit.disabled = true;
    btnSubmit.innerText = `請選擇一張圖片`;

    const cardsContainer = $('three-cards-container');
    cardsContainer.innerHTML = '';

    options.forEach((opt, idx) => {
        const card = document.createElement('div');
        card.className = 'guess-card';
        card.setAttribute('data-index', idx);
        
        card.innerHTML = `
            <div class="guess-card-header">
                <span class="guess-card-num">選項 ${String.fromCharCode(65 + idx)}</span>
                <button class="btn-zoom" type="button" data-zoom-idx="${idx}">🔍 放大檢視</button>
            </div>
            <div class="guess-card-img-wrap">
                <img src="${opt.art}" alt="線索選項 ${idx + 1}" loading="lazy" />
            </div>
            <div class="guess-card-footer">
                <span class="select-indicator">點擊選定此張</span>
            </div>
        `;

        // Click to select
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-zoom')) return;
            $$('.guess-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            AppState.selectedGuessIndex = idx;
            btnSubmit.disabled = false;
            btnSubmit.innerText = `確定！這張就是【${targetName}】畫的 🎯`;
            if (window.sound) window.sound.playClick();
        });

        // Zoom button
        card.querySelector('.btn-zoom').addEventListener('click', (e) => {
            e.stopPropagation();
            openZoomModal(opt.art, `選項 ${String.fromCharCode(65 + idx)} 放大檢視`);
        });

        cardsContainer.appendChild(card);
    });

    // Submit guess
    btnSubmit.onclick = () => {
        if (AppState.selectedGuessIndex === null) return;

        if (AppState.mode === 'online') {
            if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
                AppState.ws.send(JSON.stringify({
                    action: 'submit_guess',
                    room: AppState.roomCode,
                    guessIndex: AppState.selectedGuessIndex
                }));
            }
        } else if (AppState.mode === 'pass_and_play') {
            handlePassAndPlayGuessSubmit(AppState.selectedGuessIndex);
        }
    };

    // Hide any previous result banner
    $('guess-result-banner').style.display = 'none';
    showView('view-guessing');
    if (window.sound) window.sound.playShuffle();
}

function renderGuessResultBanner(result) {
    const banner = $('guess-result-banner');
    banner.style.display = 'block';
    banner.className = `result-banner ${result.isCorrect ? 'correct' : 'wrong'}`;

    if (result.isCorrect) {
        banner.innerHTML = `
            <div class="result-icon">🎉</div>
            <h3>太神了！猜對了！</h3>
            <p>這張果然就是【${result.targetName}】畫的線索！</p>
            <div class="wish-reveal-box">
                <div class="label">🎁 ${result.targetName} 真正想要收到的禮物是：</div>
                <div class="val">${result.targetWish}</div>
                ${result.targetHint ? `<div class="label" style="margin-top:8px;">💭 線索創作補充：</div><div style="color:#f1f5f9;font-style:italic;">「${result.targetHint}」</div>` : ''}
            </div>
            <p style="margin-top: 18px; color: var(--text-muted); font-size: 0.85rem;">太棒了！趕快記下心願，準備給他驚喜吧 🎁</p>
        `;
        if (window.sound) window.sound.playCorrect();
        triggerConfetti();
    } else {
        banner.innerHTML = `
            <div class="result-icon">😅</div>
            <h3>哎呀！猜錯了～</h3>
            <p>你選的那張其實是【${result.pickedArtistName}】畫的！</p>
            <div class="wish-reveal-box">
                <div class="label">🎁 不過沒關係！${result.targetName} 真正的禮物願望是：</div>
                <div class="val">${result.targetWish}</div>
                ${result.targetHint ? `<div class="label" style="margin-top:8px;">💭 線索創作補充：</div><div style="color:#f1f5f9;font-style:italic;">「${result.targetHint}」</div>` : ''}
            </div>
            <p style="margin-top: 18px; color: var(--text-muted); font-size: 0.85rem;">依然可以照著心願清單去準備最棒的禮物！🎁</p>
        `;
        if (window.sound) window.sound.playWrong();
    }

    // Scroll to feedback
    banner.scrollIntoView({ behavior: 'smooth' });

    // If host view, also provide trigger button for final showcase
    if (AppState.role === 'host') {
        const btnShowResults = $('btn-host-trigger-results');
        if (btnShowResults) {
            btnShowResults.style.display = 'inline-block';
            btnShowResults.onclick = () => {
                if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
                    AppState.ws.send(JSON.stringify({
                        action: 'show_results',
                        room: AppState.roomCode
                    }));
                }
            };
        }
    }
}

// ==========================================================================
// Final Results & Showcase
// ==========================================================================

function renderFinalShowcase(data) {
    if (window.sound) window.sound.playPartyCheer();
    triggerConfetti();

    // 1. Exchange Ring Chain
    const chainContainer = $('exchange-ring-chain');
    chainContainer.innerHTML = '';
    (data.exchangeRing || []).forEach((item, idx) => {
        const chip = document.createElement('div');
        chip.className = 'chain-item';
        chip.innerHTML = `
            <span>${item.giverAvatar} ${item.giverName}</span>
            <span class="chain-arrow">🎁 ➔</span>
            <span>${item.receiverAvatar} ${item.receiverName}</span>
            <span style="font-size:0.75rem; margin-left:4px;" title="${item.guessedCorrectly ? '成功猜對' : '猜錯'}">
                ${item.guessedCorrectly ? '🎯' : '💨'}
            </span>
        `;
        chainContainer.appendChild(chip);
    });

    // 2. Detective Honor Roll
    const detectivesList = $('correct-detectives-list');
    detectivesList.innerHTML = '';
    const detectives = data.correctDetectives || [];
    if (detectives.length > 0) {
        detectives.forEach(name => {
            const badge = document.createElement('span');
            badge.className = 'hero-tag';
            badge.style.margin = '4px';
            badge.innerText = `🕵️‍♂️ ${name}`;
            detectivesList.appendChild(badge);
        });
    } else {
        detectivesList.innerHTML = '<span style="color:var(--text-muted);">大家都畫得太深奧了！這次無人猜中～ 🎨</span>';
    }

    // 3. Art Gallery Grid
    const galleryContainer = $('gallery-cards-grid');
    galleryContainer.innerHTML = '';
    (data.gallery || []).forEach(item => {
        const card = document.createElement('div');
        card.className = 'gallery-card';
        card.innerHTML = `
            <div class="gallery-art" title="點擊放大">
                <img src="${item.art}" alt="${item.artistName}的畫作" loading="lazy" />
            </div>
            <div class="gallery-details">
                <div class="gallery-author">
                    <span style="font-size:1.4rem;">${item.artistAvatar}</span>
                    <span class="author-name">${item.artistName}</span>
                    <span class="tag">作者</span>
                </div>
                <div class="gallery-wish">
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:2px;">真正的禮物願望：</div>
                    <strong style="color:var(--festive-gold); font-size:1rem;">${item.wish}</strong>
                    ${item.hint ? `<div style="font-size:0.75rem; margin-top:4px; color:#cbd5e1;">「${item.hint}」</div>` : ''}
                </div>
                <div class="gallery-guesser">
                    由 <strong>${item.guesserAvatar} ${item.guesserName}</strong> 抽到 (${item.guessedCorrectly ? '🎯 猜對' : '💨 猜錯'})
                </div>
            </div>
        `;
        card.querySelector('.gallery-art').addEventListener('click', () => {
            openZoomModal(item.art, `${item.artistName} 的畫作「${item.wish}」`);
        });
        galleryContainer.appendChild(card);
    });

    // Play again button
    $('btn-play-again').onclick = () => {
        if (AppState.mode === 'online') {
            if (AppState.role === 'host') {
                if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
                    AppState.ws.send(JSON.stringify({
                        action: 'reset_game',
                        room: AppState.roomCode
                    }));
                }
            } else {
                showToast('等待主持人重新開局...');
            }
        } else if (AppState.mode === 'pass_and_play') {
            startPassAndPlay();
        }
    };

    showView('view-results');
}

// ==========================================================================
// Pass & Play Mode (單機輪流模式 - 聚會免網路一機通玩)
// ==========================================================================

function setupPassAndPlayUI() {
    // Add player input
    $('btn-add-local-player').addEventListener('click', () => {
        const input = $('input-local-player-name');
        const name = input.value.trim();
        if (!name) return;

        const pList = AppState.localGame.players;
        if (pList.some(p => p.name === name)) {
            showToast('暱稱不能重複喔！');
            return;
        }

        const avatar = EMOJI_AVATARS[pList.length % EMOJI_AVATARS.length];
        pList.push({
            id: `lp_${Date.now()}_${Math.random()}`,
            name: name,
            avatar: avatar,
            wish: '',
            hint: '',
            art: null,
            targetId: null,
            options: null,
            guessIndex: null,
            isCorrect: null,
            pickedArtistName: null
        });

        input.value = '';
        renderLocalPlayersRoster();
        if (window.sound) window.sound.playClick();
    });

    $('input-local-player-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            $('btn-add-local-player').click();
        }
    });

    // Start local game
    $('btn-start-local-drawing').addEventListener('click', () => {
        if (AppState.localGame.players.length < 2) {
            showToast('至少需要 2 位玩家參加（推薦 3 人以上更有趣）！');
            return;
        }
        AppState.localGame.currentPlayerIndex = 0;
        showLocalTurnShield('drawing');
    });

    // Shield ready button
    $('btn-turn-shield-ready').addEventListener('click', () => {
        const g = AppState.localGame;
        const currentP = g.players[g.currentPlayerIndex];
        if (g.stage === 'draw_shield') {
            g.stage = 'drawing';
            enterArtStudioView();
            $('art-studio-title').innerText = `🎨【${currentP.name}】的創作時光`;
        } else if (g.stage === 'guess_shield') {
            g.stage = 'guessing';
            const targetP = g.players.find(p => p.id === currentP.targetId);
            renderGuessingView(targetP.name, targetP.avatar, currentP.options);
        }
    });
}

function startPassAndPlay() {
    AppState.mode = 'pass_and_play';
    AppState.role = 'host';
    AppState.localGame.players = [];
    AppState.localGame.currentPlayerIndex = 0;
    AppState.localGame.stage = 'setup';

    renderLocalPlayersRoster();
    showView('view-pass-setup');
}

function renderLocalPlayersRoster() {
    const list = $('local-players-roster');
    list.innerHTML = '';
    const players = AppState.localGame.players;

    players.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'player-chip';
        item.innerHTML = `
            <div class="p-avatar">${p.avatar}</div>
            <div class="p-info">
                <div class="p-name">${p.name}</div>
            </div>
            <button style="background:none; border:none; color:#f43f5e; cursor:pointer;" title="刪除">✕</button>
        `;
        item.querySelector('button').onclick = () => {
            AppState.localGame.players.splice(idx, 1);
            renderLocalPlayersRoster();
        };
        list.appendChild(item);
    });

    $('btn-start-local-drawing').disabled = players.length < 2;
    $('btn-start-local-drawing').innerText = players.length >= 2 
        ? `開始輪流創作線索圖 (${players.length} 人)` 
        : `請至少加入 2 位玩家 (目前 ${players.length} 人)`;
}

function showLocalTurnShield(stage) {
    const g = AppState.localGame;
    const currentP = g.players[g.currentPlayerIndex];

    $('shield-player-avatar').innerText = currentP.avatar;
    $('shield-player-name').innerText = currentP.name;

    if (stage === 'drawing') {
        g.stage = 'draw_shield';
        $('shield-title').innerText = `請將螢幕交給【${currentP.name}】`;
        $('shield-desc').innerText = `其他人請轉過身或閉上眼睛，不要偷看 ${currentP.name} 的願望與畫作喔！🤫`;
    } else if (stage === 'guessing') {
        g.stage = 'guess_shield';
        $('shield-title').innerText = `請將螢幕交給【${currentP.name}】`;
        $('shield-desc').innerText = `其他人請閉眼！現在是 ${currentP.name} 的專屬猜題時間 🎯`;
    }

    showView('view-turn-shield');
    if (window.sound) window.sound.playChime();
}

function handlePassAndPlayArtSubmit(artData, wish, hint) {
    const g = AppState.localGame;
    const currentP = g.players[g.currentPlayerIndex];
    currentP.art = artData;
    currentP.wish = wish;
    currentP.hint = hint;

    g.currentPlayerIndex++;
    if (g.currentPlayerIndex < g.players.length) {
        showLocalTurnShield('drawing');
    } else {
        // All finished drawing! Run derangement matching
        executeLocalMatching();
    }
}

function executeLocalMatching() {
    const g = AppState.localGame;
    const players = g.players;
    const n = players.length;

    // Shuffle into a single derangement cycle
    const shuffled = [...players];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    for (let i = 0; i < n; i++) {
        const giver = shuffled[i];
        const receiver = shuffled[(i + 1) % n];
        giver.targetId = receiver.id;
    }

    // Generate 3 choices for each player
    const builtInDecoys = [
        {
            art: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='%231a1a2e'/><circle cx='200' cy='180' r='90' fill='%23ffccd5'/><path d='M110 180 C110 320 290 320 290 180 Z' fill='%23ffffff'/><circle cx='170' cy='160' r='12' fill='%23222222'/><circle cx='230' cy='160' r='12' fill='%23222222'/><text x='200' y='360' font-family='sans-serif' font-size='20' font-weight='bold' fill='%23ffd166' text-anchor='middle'>聖誕老人：煙囪太窄！</text></svg>",
            artistName: "神秘聖誕老人 🎅",
            wish: "不怕踩雪的大紅靴",
            hint: "紅通通的外套"
        },
        {
            art: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='%230f2027'/><circle cx='200' cy='250' r='85' fill='%23e0fbfc'/><circle cx='200' cy='140' r='60' fill='%23ffffff'/><polygon points='200,140 250,150 200,156' fill='%23f77f00'/><text x='200' y='365' font-family='sans-serif' font-size='20' font-weight='bold' fill='%23a8dadc' text-anchor='middle'>融化中雪人：好熱！</text></svg>",
            artistName: "雪人先生 ⛄",
            wish: "超低溫保鮮冰箱",
            hint: "胡蘿蔔鼻子"
        }
    ];

    players.forEach(giver => {
        const target = players.find(p => p.id === giver.targetId);
        const correctChoice = {
            art: target.art,
            artistName: target.name,
            wish: target.wish,
            hint: target.hint,
            isTarget: true
        };

        const otherPlayers = players.filter(p => p.id !== target.id);
        let distractors = [];

        if (otherPlayers.length >= 2) {
            // Pick 2 random
            const pool = [...otherPlayers].sort(() => 0.5 - Math.random());
            distractors = pool.slice(0, 2).map(p => ({
                art: p.art,
                artistName: p.name,
                wish: p.wish,
                hint: p.hint,
                isTarget: false
            }));
        } else if (otherPlayers.length === 1) {
            distractors = [
                {
                    art: otherPlayers[0].art,
                    artistName: otherPlayers[0].name,
                    wish: otherPlayers[0].wish,
                    hint: otherPlayers[0].hint,
                    isTarget: false
                },
                { ...builtInDecoys[0], isTarget: false }
            ];
        } else {
            distractors = builtInDecoys.map(d => ({ ...d, isTarget: false }));
        }

        const choices = [correctChoice, distractors[0], distractors[1]].sort(() => 0.5 - Math.random());
        giver.localChoices = choices;
        giver.options = choices.map((c, idx) => ({ index: idx, art: c.art }));
    });

    // Start guessing round
    g.currentPlayerIndex = 0;
    showLocalTurnShield('guessing');
}

function handlePassAndPlayGuessSubmit(selectedIdx) {
    const g = AppState.localGame;
    const currentP = g.players[g.currentPlayerIndex];
    const picked = currentP.localChoices[selectedIdx];
    const target = g.players.find(p => p.id === currentP.targetId);

    const isCorrect = picked.isTarget;
    currentP.guessIndex = selectedIdx;
    currentP.isCorrect = isCorrect;
    currentP.pickedArtistName = picked.artistName;

    // Show instant result
    renderGuessResultBanner({
        isCorrect: isCorrect,
        targetName: target.name,
        targetWish: target.wish,
        targetHint: target.hint,
        pickedArtistName: picked.artistName
    });

    // Add "Next Person" button inside banner
    const banner = $('guess-result-banner');
    const btnNext = document.createElement('button');
    btnNext.className = 'btn btn-gold btn-lg';
    btnNext.style.marginTop = '20px';

    const isLast = (g.currentPlayerIndex === g.players.length - 1);
    btnNext.innerText = isLast ? '🏆 查看全場大揭曉！' : '換下一位玩家猜題 ➔';

    btnNext.onclick = () => {
        g.currentPlayerIndex++;
        if (g.currentPlayerIndex < g.players.length) {
            showLocalTurnShield('guessing');
        } else {
            // Show final results
            showLocalFinalResults();
        }
    };
    banner.appendChild(btnNext);
}

function showLocalFinalResults() {
    const g = AppState.localGame;
    const players = g.players;

    const exchangeRing = players.map(p => {
        const target = players.find(t => t.id === p.targetId);
        return {
            giverName: p.name,
            giverAvatar: p.avatar,
            receiverName: target.name,
            receiverAvatar: target.avatar,
            receiverWish: target.wish,
            receiverHint: target.hint,
            receiverArt: target.art,
            guessedCorrectly: p.isCorrect
        };
    });

    const gallery = players.map(p => {
        const guesser = players.find(g => g.targetId === p.id);
        return {
            artistName: p.name,
            artistAvatar: p.avatar,
            art: p.art,
            wish: p.wish,
            hint: p.hint,
            guesserName: guesser ? guesser.name : '無',
            guesserAvatar: guesser ? guesser.avatar : '🎁',
            guessedCorrectly: guesser ? guesser.isCorrect : false
        };
    });

    const correctDetectives = players.filter(p => p.isCorrect).map(p => p.name);

    renderFinalShowcase({
        exchangeRing: exchangeRing,
        gallery: gallery,
        correctDetectives: correctDetectives
    });
}
