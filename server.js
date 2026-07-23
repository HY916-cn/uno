const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
// 限制 WS 单个消息最大 10KB，防止大 payload 攻击
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 10240 });

// HTTP 安全头中间件 (等同于部分 Helmet 功能)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// HTTP 简单内存限流 (防 CC/DDoS 刷新)
const ipRequestCounts = new Map();
setInterval(() => ipRequestCounts.clear(), 60000); // 每分钟清空一次
app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || '0.0.0.0';
    const count = (ipRequestCounts.get(ip) || 0) + 1;
    ipRequestCounts.set(ip, count);
    if (count > 200) { // 限制单 IP 每分钟最多 200 次 HTTP 请求
        return res.status(429).send('Too Many Requests');
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Global state
const rooms = new Map();
const clients = new Map(); // ws -> { id, roomId, name, lastActive: timestamp, afkTimer: timeoutId }

const AFK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function updateClientActivity(ws) {
    const clientData = clients.get(ws);
    if (!clientData || !clientData.roomId) return; // Ignore home screen clients
    clientData.lastActive = Date.now();
    if (clientData.afkTimer) {
        clearTimeout(clientData.afkTimer);
    }
    clientData.afkTimer = setTimeout(() => {
        log(clientData.roomId, 'WARN', `玩家(${clientData.name})因为5分钟未操作，已被踢出房间`);
        sendError(ws, '由于您长时间未操作，已自动离开房间');
        handleDisconnect(ws);
    }, AFK_TIMEOUT_MS);
}

// Logger
function log(roomId, level, message) {
    const ts = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
    console.log(`[${ts}] [${level}] [Room:${roomId || 'SYS'}] ${message}`);
}

function generateId() {
    return crypto.randomBytes(4).toString('hex');
}

function generateRoomId() {
    let id;
    do {
        id = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    } while (rooms.has(id));
    return id;
}

function generateQteWord() {
    return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

// QTE 弹窗需要在所有客户端"同一时刻"出现，否则延迟低的玩家天然占便宜；
// 给一个小缓冲窗口，客户端用 serverTimeOffset 换算成本地时间后再展示，服务端也据此拒绝窗口结束前的提交
const QTE_REVEAL_BUFFER_MS = 350;

// 打字模式下提前把下一轮验证码广播出去，方便玩家提前记住，
// 这样 QTE 真正触发时考验的是反应速度而不是临场读数字/打字的速度
function previewNextQteWord(room) {
    if (room.qteMode !== 'type') return;
    room.qteWord = generateQteWord();
    broadcastEvent(room.id, 'qte_preview', { qteWord: room.qteWord });
}

const BOT_NAMES = [
    "清梦", "令", "数字", "亦丹", 
    "游离电子", "月色", "一笑了之？", 
    "白梦世界", "HY是个Fvv", "AAAAA区歪", "后藤一里", 
    "Faze", "6657", "Falcons", "Tyloo", 
    "Vitality", "Spirit", "Liquid", "MOUZ", 
    "UNO", "fantasy", "Banana", "Yooo", "Pavol", 
    "Gemini", "GPT", "DeepSeek", "千问", "豆包", 
    "Ciallo", "千恋*万花", "爱丽丝", "白子", 
    "DANk1NG", "ZywOo", "m0NESY", "NiKo", 
    "JamYoung", "Jee", "Attacker", "EmiliaQAQ", "z4KR", 
    "donk", "chopper", "Jimpphat", "torzsi", 
    "rain", "Dev1ce", "s1mple",
    "nnnnn", "L1n1", "友利奈绪", "gugu", 
    "chairs", "丛雨", "苏菲托莱特", "259", "advent"
];

function getRandomBotName() {
    return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

const LIGHT_COLORS = ['red', 'yellow', 'blue', 'green'];
const DARK_COLORS = ['pink', 'teal', 'orange', 'purple'];
// 所有合法的可声明颜色（用于校验万能牌变色，防止恶意字符串注入前端渲染）
const VALID_COLORS = [...LIGHT_COLORS, ...DARK_COLORS];

// 原版 UNO：108 张
function createClassicDeck() {
    const deck = [];
    for (const color of LIGHT_COLORS) {
        deck.push({ id: generateId(), color, type: '0' });
        for (let i = 1; i <= 9; i++) {
            deck.push({ id: generateId(), color, type: String(i) });
            deck.push({ id: generateId(), color, type: String(i) });
        }
        for (const type of ['skip', 'reverse', '+2']) {
            deck.push({ id: generateId(), color, type });
            deck.push({ id: generateId(), color, type });
        }
    }
    for (let i = 0; i < 4; i++) {
        deck.push({ id: generateId(), color: 'black', type: 'wild' });
        deck.push({ id: generateId(), color: 'black', type: '+4' });
    }
    return shuffle(deck);
}

// 毫不留情 Show 'Em No Mercy：约 168 张
// 数字牌 76 + 彩色行动牌 48（跳过/反转/+2/+4/清色/全员跳过）+ 万能牌 44
// （行动牌 +4 在本版本为彩色牌；万能牌为反转+4/+6/+10/选色轮盘，牌数近似官方分布）
function createNoMercyDeck() {
    const deck = [];
    for (const color of LIGHT_COLORS) {
        deck.push({ id: generateId(), color, type: '0' });
        for (let i = 1; i <= 9; i++) {
            deck.push({ id: generateId(), color, type: String(i) });
            deck.push({ id: generateId(), color, type: String(i) });
        }
        for (const type of ['skip', 'reverse', '+2', '+4', 'discard-all', 'skip-all']) {
            deck.push({ id: generateId(), color, type });
            deck.push({ id: generateId(), color, type });
        }
    }
    for (const type of ['wild-rev4', 'wild+6', 'wild+10', 'wild-roulette']) {
        for (let i = 0; i < 11; i++) {
            deck.push({ id: generateId(), color: 'black', type });
        }
    }
    return shuffle(deck);
}

// 翻转版 UNO Flip：112 张双面牌，每张牌带 light / dark 两面，color/type 为"当前面"
function createFlipDeck() {
    const makeFaces = (colors, actions, wildTypes) => {
        const normal = [], flips = [], wilds = [];
        for (const color of colors) {
            for (let i = 1; i <= 9; i++) {          // 双面牌无 0，数字 1-9 各两张
                normal.push({ color, type: String(i) });
                normal.push({ color, type: String(i) });
            }
            for (const t of actions) {              // 每色两张的行动牌
                normal.push({ color, type: t });
                normal.push({ color, type: t });
            }
            flips.push({ color, type: 'flip' });    // Flip 牌每色两张
            flips.push({ color, type: 'flip' });
        }
        for (let i = 0; i < 4; i++) {               // 万能牌四张 + 特殊万能牌四张
            wilds.push({ color: 'black', type: 'wild' });
            wilds.push({ color: 'black', type: wildTypes });
        }
        return { normal, flips, wilds };
    };

    const light = makeFaces(LIGHT_COLORS, ['draw-one', 'reverse', 'skip'], 'wild+2');
    const dark = makeFaces(DARK_COLORS, ['draw-five', 'reverse', 'skip-all'], 'wild-drawcolor');

    // 分类内各自打乱后配对：普通面↔普通面、Flip↔Flip、万能↔万能，保证翻面后仍是合理的牌
    shuffle(light.normal); shuffle(dark.normal);
    shuffle(light.flips); shuffle(dark.flips);
    shuffle(light.wilds); shuffle(dark.wilds);

    const deck = [];
    const zip = (la, da) => {
        for (let i = 0; i < la.length; i++) {
            deck.push({ id: generateId(), light: la[i], dark: da[i], color: la[i].color, type: la[i].type });
        }
    };
    zip(light.normal, dark.normal);
    zip(light.flips, dark.flips);
    zip(light.wilds, dark.wilds);
    return shuffle(deck);
}

function createDeck(version) {
    if (version === 'flip') return createFlipDeck();
    if (version === 'nomercy') return createNoMercyDeck();
    return createClassicDeck();
}

// 把某张翻转版牌切换到指定面（light/dark），刷新其对外的 color/type
function applySide(card, side) {
    if (card && card[side]) {
        card.color = card[side].color;
        card.type = card[side].type;
    }
}

// 翻转版翻面：把牌库、弃牌堆、所有玩家手牌统一切到目标面
function applySideAll(room) {
    const side = room.side;
    room.deck.forEach(c => applySide(c, side));
    room.discardPile.forEach(c => applySide(c, side));
    room.players.forEach(p => p.hand.forEach(c => applySide(c, side)));
}

function broadcastRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const stateToSend = {
        id: room.id,
        hidden: room.hidden,
        isBigScreen: room.isBigScreen,
        qteMode: room.qteMode,
        version: room.version,
        side: room.side,
        drawStack: room.drawStack || 0,
        stackValue: room.stackValue || 0,
        pendingDraw: room.pendingDraw || null,
        frozen: !!room.frozen,
        state: room.state,
        switchTargetIndex: room.switchTargetIndex,
        maxPlayers: room.maxPlayers,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            isBot: p.isBot,
            ready: p.ready,
            hasSeenResults: p.hasSeenResults,
            handCount: p.hand.length,
            eliminated: !!p.eliminated,
            connected: p.ws !== null || p.isBot
        })),
        spectators: (room.spectators || []).map(s => ({
            id: s.id,
            name: s.name,
            targetId: s.targetId,
            hasSeenResults: s.hasSeenResults
        })),
        turnIndex: room.turnIndex,
        direction: room.direction,
        currentColor: room.currentColor,
        topCard: room.discardPile[room.discardPile.length - 1] || null,
        deckCount: room.deck.length,
        qteWinner: room.qteWinner,
        results: room.results,
        resultsByElimination: !!room.resultsByElimination
    };

    const wsSet = new Set();
    room.players.forEach(p => {
        if (!p.isBot && p.ws && p.ws.readyState === 1 && !wsSet.has(p.ws)) {
            wsSet.add(p.ws);

            // 被淘汰的真人：转为观战身份，可观看其他未淘汰玩家
            if (!room.isBigScreen && p.eliminated) {
                let watchId = p.specTarget;
                if (!watchId || !room.players.some(x => x.id === watchId && !x.eliminated)) {
                    const cur = room.players[room.turnIndex];
                    watchId = (cur && !cur.eliminated) ? cur.id : (room.players.find(x => !x.eliminated) || {}).id;
                }
                const watch = room.players.find(x => x.id === watchId);
                p.ws.send(JSON.stringify({
                    type: 'room_state', room: stateToSend,
                    myHand: [],
                    myId: p.id,
                    hasDrawnThisTurn: room.hasDrawnThisTurn,
                    isSpectator: true,
                    spectatorTargetId: watchId,
                    eliminatedSelf: true
                }));
                return;
            }

            let targetId = p.id;
            let targetHand = p.hand;

            if (room.isBigScreen) {
                if (room.state === 'ingame') {
                    // 游戏中实时将大屏视角切换至出牌玩家
                    targetId = room.players[room.turnIndex].id;
                    targetHand = room.players[room.turnIndex].hand;
                } else if (room.state === 'switching_turn') {
                    // 切换期间黑屏隐藏牌局
                    targetId = null;
                    targetHand = [];
                } else {
                    targetId = room.players[0].id;
                    targetHand = room.players[0].hand;
                }
            }

            p.ws.send(JSON.stringify({
                type: 'room_state',
                room: stateToSend,
                myHand: targetHand,
                myId: targetId,
                hasDrawnThisTurn: room.hasDrawnThisTurn
            }));
        }
    });

    if (room.spectators) {
        room.spectators.forEach(s => {
            if (s.ws && s.ws.readyState === 1 && !wsSet.has(s.ws)) {
                wsSet.add(s.ws);
                const targetPlayer = room.players.find(p => p.id === s.targetId);
                s.ws.send(JSON.stringify({
                    type: 'room_state',
                    room: stateToSend,
                    myHand: targetPlayer ? targetPlayer.hand : [],
                    myId: s.id,
                    hasDrawnThisTurn: room.hasDrawnThisTurn,
                    isSpectator: true,
                    spectatorTargetId: s.targetId
                }));
            }
        });
    }
}

function sendError(ws, message) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'error', message }));
    }
}

function broadcastChat(roomId, senderName, message, isSpectator = false) {
    const room = rooms.get(roomId);
    if (!room) return;
    const chatMsg = JSON.stringify({ type: 'chat', sender: senderName, message, isSpectator });
    const wsSet = new Set();
    room.players.forEach(p => {
        if (!p.isBot && p.ws && p.ws.readyState === 1 && !wsSet.has(p.ws)) {
            wsSet.add(p.ws);
            p.ws.send(chatMsg);
        }
    });
    if (room.spectators) {
        room.spectators.forEach(s => {
            if (s.ws && s.ws.readyState === 1 && !wsSet.has(s.ws)) {
                wsSet.add(s.ws);
                s.ws.send(chatMsg);
            }
        });
    }
    log(roomId, 'INFO', `[聊天${isSpectator ? '(观战)' : ''}] ${senderName}: ${message}`);
}

function broadcastEvent(roomId, eventType, data) {
    const room = rooms.get(roomId);
    if (!room) return;
    const msg = JSON.stringify({ type: eventType, ...data });
    const wsSet = new Set();
    room.players.forEach(p => {
        if (!p.isBot && p.ws && p.ws.readyState === 1 && !wsSet.has(p.ws)) {
            wsSet.add(p.ws);
            p.ws.send(msg);
        }
    });
    if (room.spectators) {
        room.spectators.forEach(s => {
            if (s.ws && s.ws.readyState === 1 && !wsSet.has(s.ws)) {
                wsSet.add(s.ws);
                s.ws.send(msg);
            }
        });
    }
}

function getNextTurn(room, step = 1) {
    let nextIndex = room.turnIndex;
    const total = room.players.length;
    let moved = 0;
    let guard = 0;
    // 跳过已被"毫不留情规则"淘汰的玩家；guard 防止极端情况下死循环
    while (moved < step && guard < total * (step + 1) + total) {
        nextIndex = (nextIndex + room.direction + total) % total;
        if (!room.players[nextIndex].eliminated) moved++;
        guard++;
    }
    return nextIndex;
}

function advanceTurn(room, step = 1) {
    const nextIndex = getNextTurn(room, step);
    
    if (room.isBigScreen && room.state === 'ingame') {
        room.state = 'switching_turn';
        room.switchTargetIndex = nextIndex;
        broadcastRoom(room.id);
        
        setTimeout(() => {
            // 确保没有中途触发其他阶段 (例如游戏结束)
            if (room.state === 'switching_turn') {
                room.state = 'ingame';
                room.turnIndex = nextIndex;
                room.hasDrawnThisTurn = false;
                broadcastRoom(room.id);
            }
        }, 800); // 大屏模式留出 0.8 秒的平滑切换动画时间 (从1500ms缩短)
    } else {
        room.turnIndex = nextIndex;
        room.hasDrawnThisTurn = false;
        broadcastRoom(room.id);
        checkAITurn(room);
    }
}

function drawCards(room, count) {
    const cards = [];
    for (let i = 0; i < count; i++) {
        if (room.deck.length === 0) {
            if (room.discardPile.length <= 1) {
                log(room.id, 'WARN', '牌堆耗尽，无法再抽牌');
                break; // No more cards at all
            }
            const topCard = room.discardPile.pop();
            room.deck = shuffle(room.discardPile);
            room.discardPile = [topCard];
            log(room.id, 'INFO', '洗牌');
            broadcastEvent(room.id, 'reshuffle', {});
        }
        cards.push(room.deck.pop());
    }
    return cards;
}

function canPlayCard(card, topCard, currentColor) {
    if (card.color === 'black') return true;
    if (card.color === currentColor) return true;
    if (card.type === topCard.type && card.color !== 'black' && topCard.color !== 'black') return true;
    return false;
}

// ===== 版本规则辅助 =====

// 加牌类行动牌的抽牌数值（用于毫不留情的叠加比较）
const DRAW_VALUE = { '+2': 2, '+4': 4, 'wild-rev4': 4, 'wild+6': 6, 'wild+10': 10 };
// 毫不留情中可参与叠加的牌型
const STACKABLE = new Set(['+2', '+4', 'wild-rev4', 'wild+6', 'wild+10']);
// 翻转版中"手上有同色牌就不能打"的万能牌
const RESTRICTED_WILD = new Set(['wild+2', 'wild-drawcolor']);

function getDrawValue(card) { return DRAW_VALUE[card.type] || 0; }

function activeCount(room) { return room.players.filter(p => !p.eliminated).length; }

function isNumberCard(card) { return /^[0-9]$/.test(card.type); }

// 手里是否有与当前颜色相符的牌（供翻转版万能牌限制判断）
function hasColorMatch(room, player) {
    return player.hand.some(c => c.color !== 'black' && c.color === room.currentColor);
}

// 统一的"这张牌现在能不能打"判定（服务端出牌校验 + AI 都用它）
function isPlayable(room, player, card) {
    // 挂起"持续摸牌直到指定色"期间不能出牌，必须先点牌堆摸完
    if (room.pendingDraw) return false;
    // 毫不留情：叠加进行中，只能叠出等值或更高的加牌，且仍需匹配颜色/类型（万能黑牌可任意叠）
    if (room.drawStack > 0) {
        if (!STACKABLE.has(card.type) || getDrawValue(card) < room.stackValue) return false;
        if (card.color === 'black') return true;                    // 万能加牌任意叠
        if (card.color === room.currentColor) return true;          // 同色可叠
        const top = room.discardPile[room.discardPile.length - 1];
        return !!(top && card.type === top.type);                   // 同类型可叠（如 +4 叠 +4）
    }
    const topCard = room.discardPile[room.discardPile.length - 1];
    if (!canPlayCard(card, topCard, room.currentColor)) return false;
    // 翻转版：万能+2 / 万能指定色抽，仅当手里没有与当前颜色相符的牌时才能打
    if (RESTRICTED_WILD.has(card.type) && hasColorMatch(room, player)) return false;
    return true;
}

function applyReverse(room) { room.direction *= -1; }

// 给下家发指定张数的罚牌
function penalizeNext(room, amount) {
    const nextIdx = getNextTurn(room, 1);
    const np = room.players[nextIdx];
    const pen = drawCards(room, amount);
    np.hand.push(...pen);
    const willElim = room.version === 'nomercy' && np.hand.length >= 25; // 这次罚抽将导致其淘汰
    log(room.id, 'INFO', `玩家(${np.name})被罚抽${pen.length}张`);
    if (!np.isBot && np.ws && np.ws.readyState === 1) {
        np.ws.send(JSON.stringify({ type: 'draw_card_result', cards: pen, playerId: np.id }));
    }
    // willEliminate：客户端据此让"被淘汰者本人"跳过抽牌动画（其他人照常播放）
    broadcastEvent(room.id, 'draw_card', { playerId: np.id, count: pen.length, isPenalty: true, simultaneous: pen.length > 1, willEliminate: willElim });
    checkEliminations(room);
}

// 选色轮盘 / 万能指定色抽：当前玩家逐张点牌堆摸牌，直到摸到指定颜色（万能牌 black 不算）为止；
// 摸到后 pendingDraw.satisfied=true，等玩家点"跳过"结束其回合。AI 会自动一张张摸完并跳过。
function resolveUntilDrawOne(room, player) {
    if (!room.pendingDraw) return;
    const c = drawCards(room, 1);
    if (c.length === 0) { // 牌堆彻底空了，直接结束
        room.pendingDraw = null;
        advanceTurn(room, 1);
        return;
    }
    player.hand.push(c[0]);
    if (!player.isBot && player.ws && player.ws.readyState === 1) {
        player.ws.send(JSON.stringify({ type: 'draw_card_result', cards: c, playerId: player.id }));
    }
    broadcastEvent(room.id, 'draw_card', { playerId: player.id, count: 1 });
    if (c[0].color === room.pendingDraw.untilColor) {
        room.pendingDraw.satisfied = true; // 万能牌 color==='black' 永不等于指定色，自然"不算"
        log(room.id, 'INFO', `玩家(${player.name})摸到指定色 ${room.pendingDraw.untilColor}`);
    }
    const ended = checkEliminations(room);
    if (ended || room.state !== 'ingame') return;
    // 摸牌途中被淘汰：立即中断摸牌（真人/AI 一致），清挂起并跳过其回合
    if (player.eliminated) { room.pendingDraw = null; advanceTurn(room, 1); return; }
    broadcastRoom(room.id);
    if (player.isBot) {
        // AI：没摸到继续摸，摸到则跳过
        setTimeout(() => {
            if (room.state !== 'ingame' || room.frozen || !room.pendingDraw) return;
            if (room.players[room.turnIndex].id !== player.id) return;
            if (room.pendingDraw.satisfied) { room.pendingDraw = null; advanceTurn(room, 1); }
            else resolveUntilDrawOne(room, player);
        }, 450);
    }
}

// 打 0：所有未淘汰玩家按当前出牌方向把整手牌传给下一位
function passAllHands(room) {
    const active = room.players.filter(p => !p.eliminated);
    const n = active.length;
    if (n < 2) return;
    const hands = active.map(p => p.hand);
    const newHands = new Array(n);
    for (let i = 0; i < n; i++) {
        const target = ((i + room.direction) % n + n) % n;
        newHands[target] = hands[i];
    }
    for (let i = 0; i < n; i++) active[i].hand = newHands[i];
    log(room.id, 'INFO', `打出 0，全体传手`);
    // 手牌整体替换：通知客户端跳过本帧的"抽牌"动画核算，靠随后的 room_state 广播刷新
    broadcastEvent(room.id, 'hands_reset', {});
    broadcastEvent(room.id, 'hand_pass', { order: active.map(p => p.id), direction: room.direction });
}

// 淘汰动画期间全场冻结：AI 与真人都无法操作，动画结束后恢复
function freezeRoom(room, ms) {
    room.frozen = true;
    if (room.aiTimer) { clearTimeout(room.aiTimer); room.aiTimer = null; }
    broadcastRoom(room.id);
    if (room.freezeTimer) clearTimeout(room.freezeTimer);
    room.freezeTimer = setTimeout(() => {
        room.frozen = false;
        room.freezeTimer = null;
        if (room.state === 'ingame') { broadcastRoom(room.id); checkAITurn(room); }
    }, ms);
}

// 检查是否有玩家手牌达到 25 张需要淘汰；若只剩一人则结束本局
function checkEliminations(room) {
    if (room.version !== 'nomercy') return false;
    for (const p of room.players) {
        if (!p.eliminated && p.hand.length >= 25) {
            p.eliminated = true;
            // 淘汰玩家的手牌直接洗回抽牌堆
            room.deck.push(...p.hand);
            room.deck = shuffle(room.deck);
            p.hand = [];
            const alive = room.players.filter(x => !x.eliminated);
            if (alive.length === 1) {
                // 最后一个被淘汰：不播飞行动画，但玩家框直接显示淘汰徽标，短暂停留后进入胜利
                log(room.id, 'INFO', `玩家(${p.name})被淘汰，只剩(${alive[0].name})，直接获胜`);
                room.frozen = true;
                room.endedByElimination = true; // 淘汰取胜（无最终QTE）
                if (room.freezeTimer) { clearTimeout(room.freezeTimer); room.freezeTimer = null; }
                broadcastEvent(room.id, 'player_eliminated', { playerId: p.id, name: p.name, skipAnim: true });
                broadcastRoom(room.id);
                setTimeout(() => {
                    room.frozen = false;
                    broadcastEvent(room.id, 'qte_win', { winner: alive[0].name });
                    endGame(room);
                }, 1000);
                return true;
            }
            // 非最后淘汰：播放淘汰动画并全场冻结
            log(room.id, 'INFO', `玩家(${p.name})手牌达25张，被淘汰，手牌洗回牌堆`);
            broadcastEvent(room.id, 'player_eliminated', { playerId: p.id, name: p.name });
            freezeRoom(room, 2400);
        }
    }
    return false;
}

// 毫不留情打 7：需要出牌者选择一名玩家交换整手牌
function startSwap(room, player) {
    room.pendingSwap = { byId: player.id };
    if (player.isBot) {
        // AI 直接选手牌最少的对手换手（抢近乎获胜者的小手牌）
        const targets = room.players.filter(p => !p.eliminated && p.id !== player.id);
        targets.sort((a, b) => a.hand.length - b.hand.length);
        if (targets.length) {
            doSwap(room, player.id, targets[0].id);
            return;
        }
        room.pendingSwap = null;
        advanceTurn(room, 1);
        return;
    }
    // 真人：请该玩家选择换手目标
    const targets = room.players.filter(p => !p.eliminated && p.id !== player.id)
        .map(p => ({ id: p.id, name: p.name, handCount: p.hand.length }));
    broadcastRoom(room.id);
    if (player.ws && player.ws.readyState === 1) {
        player.ws.send(JSON.stringify({ type: 'choose_swap_target', targets }));
    }
}

// 执行 7 号换手
function doSwap(room, byId, targetId) {
    const a = room.players.find(p => p.id === byId);
    const b = room.players.find(p => p.id === targetId);
    if (!a || !b || b.eliminated) { room.pendingSwap = null; advanceTurn(room, 1); return; }
    const tmp = a.hand; a.hand = b.hand; b.hand = tmp;
    log(room.id, 'INFO', `玩家(${a.name})与(${b.name})交换手牌`);
    room.pendingSwap = null;
    // 手牌整体替换：通知客户端跳过本帧的"抽牌"动画核算，靠随后 advanceTurn 的 room_state 广播刷新
    broadcastEvent(room.id, 'hands_reset', {});
    broadcastEvent(room.id, 'hand_swap', { aId: byId, bId: targetId });
    advanceTurn(room, 1);
}

function triggerQTE(room, player) {
    room.state = 'qte';
    room.qteTargetPlayerId = player.id;
    // 打字模式：沿用开局/抓捕后预告过的验证码；按钮模式：不使用也不推送随机数（抢先按下即可）
    if (room.qteMode === 'type') {
        if (!room.qteWord) room.qteWord = generateQteWord();
    } else {
        room.qteWord = null;
    }
    room.qteStartTime = Date.now();
    room.qteRevealAt = Date.now() + QTE_REVEAL_BUFFER_MS;
    log(room.id, 'INFO', `玩家(${player.name})手牌为0，触发QTE抢答!${room.qteMode === 'type' ? ' 目标词: UNO-' + room.qteWord : ' 按钮模式'}`);

    broadcastEvent(room.id, 'qte_start', { qteWord: room.qteMode === 'type' ? room.qteWord : undefined, qteMode: room.qteMode, revealAt: room.qteRevealAt });

    // Bots randomly try to catch —— 以人类平均反应(~250ms)为下限直接定义"反应时间"，
    // 再换算成从触发起算的延迟(delay = 缓冲 + 反应)；按钮只需按下比输入打字快；抓捕者略慢给目标先手
    const isButton = room.qteMode === 'button';
    room.players.forEach(p => {
        if (p.isBot) {
            const isTarget = p.id === room.qteTargetPlayerId;
            const r = Math.random();
            let reaction; // 目标反应时间(ms)，参照人类
            if (isButton) {
                if (r < 0.45) reaction = 270 + Math.random() * 200;      // 快 270–470ms（下限 270ms）
                else if (r < 0.82) reaction = 470 + Math.random() * 430; // 中 470–900ms
                else reaction = 900 + Math.random() * 800;               // 慢 900–1700ms
            } else {
                if (r < 0.4) reaction = 900 + Math.random() * 400;       // 快 900–1300ms（含打字，下限 900ms）
                else if (r < 0.82) reaction = 1300 + Math.random() * 800;// 中 1300–2100ms
                else reaction = 2100 + Math.random() * 1000;             // 慢 2100–3100ms
            }
            if (!isTarget) reaction += isButton ? 150 : 300;             // 抓捕者略慢
            const delay = QTE_REVEAL_BUFFER_MS + reaction;               // 换算成延迟

            setTimeout(() => {
                if (room.state === 'qte') {
                    handleQTESubmit(room, p, room.qteMode === 'type' ? `UNO-${room.qteWord}` : '', Date.now());
                }
            }, delay);
        }
    });
}

function handleQTESubmit(room, player, word, clientTime) {
    if (room.state !== 'qte') return;
    if (room.qteRevealAt && Date.now() < room.qteRevealAt) return; // 同步展示窗口结束前的提交一律无效，防止篡改客户端抢跑
    // 打字模式需校验验证码；按钮模式抢先按下即有效，不涉及随机数
    if (room.qteMode === 'type' && word !== `UNO-${room.qteWord}`) return;

    // 记录该玩家在QTE中的最佳反应成绩（成功抢答/抢断他人，取全程最快，从同步弹出时刻起算，ms）
    const _reaction = Math.max(0, Date.now() - room.qteRevealAt);
    if (player.bestReactionMs == null || _reaction < player.bestReactionMs) player.bestReactionMs = _reaction;

    log(room.id, 'INFO', `玩家(${player.name})提交了QTE`);
    
    const targetPlayer = room.players.find(p => p.id === room.qteTargetPlayerId);
    if (!targetPlayer) return;

    if (player.id === targetPlayer.id) {
        // Target player wins
        log(room.id, 'INFO', `玩家(${player.name})QTE成功，游戏结束，获胜!`);
        broadcastEvent(room.id, 'qte_win', { winner: player.name });
        endGame(room);
    } else {
        // Other player catches
        log(room.id, 'INFO', `玩家(${player.name})成功抓到，目标玩家(${targetPlayer.name})被罚两张牌`);
        const penalty = drawCards(room, 2);
        targetPlayer.hand.push(...penalty);
        room.state = 'ingame';
        broadcastEvent(room.id, 'qte_end', { caughtBy: player.name });
        previewNextQteWord(room);

        const pendingCard = room.qtePendingCard;
        room.qtePendingCard = null;
        if (pendingCard) {
            const effect = applyCardEffect(room, pendingCard, targetPlayer);
            if (room.state !== 'ingame') return;      // 补算效果若触发淘汰结束则不再推进
            if (effect.await) { broadcastRoom(room.id); return; } // 等待换手等后续操作
            advanceTurn(room, effect.skip);
        } else {
            advanceTurn(room, 1);
        }
    }
}

function endGame(room) {
    // 被淘汰者一律排在最后（手牌为0，不能因此判为赢家）
    room.results = [...room.players].sort((a, b) => {
        if (!!a.eliminated !== !!b.eliminated) return a.eliminated ? 1 : -1;
        return a.hand.length - b.hand.length;
    }).map(p => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length,
        eliminated: !!p.eliminated,
        reactionMs: (typeof p.bestReactionMs === 'number') ? p.bestReactionMs : null
    }));
    room.resultsByElimination = !!room.endedByElimination; // 结算展示反应时间时用
    room.state = 'lobby';
    room.players.forEach(p => {
        p.hand = [];
        p.eliminated = false;
        if (!p.isBot && !room.isBigScreen) {
            p.ready = false;
            p.hasSeenResults = false;
        } else {
            p.ready = true; // 大屏模式或机器人自动准备
            p.hasSeenResults = room.isBigScreen ? false : true;
        }
    });
    // 回到大厅：房主重新排到第一个玩家框（开局曾打乱顺序）
    if (!room.isBigScreen) {
        const hostIdx = room.players.findIndex(p => p.isHost);
        if (hostIdx > 0) { const h = room.players.splice(hostIdx, 1)[0]; room.players.unshift(h); }
    }
    if (room.spectators) {
        room.spectators.forEach(s => {
            s.hasSeenResults = false;
        });
    }
    log(room.id, 'INFO', '游戏结束，进入结算/大厅阶段');
    broadcastRoom(room.id);
}

function checkAITurn(room) {
    if (room.state !== 'ingame' || room.frozen) return;
    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer.isBot) return;

    if (room.aiTimer) clearTimeout(room.aiTimer);

    // 拟真思考耗时：分档随机——多数很快出手，少数中等，偶尔"沉思"更久，整体更快也更灵活
    const r = Math.random();
    let delay;
    if (r < 0.55) delay = 250 + Math.random() * 450;        // 55% 快手 0.25–0.7s
    else if (r < 0.85) delay = 700 + Math.random() * 700;   // 30% 中速 0.7–1.4s
    else delay = 1400 + Math.random() * 1200;               // 15% 沉思 1.4–2.6s
    room.aiTimer = setTimeout(() => {
        room.aiTimer = null; // 定时器已触发，清空后 urge 才能正确判断"AI是否仍在思考"
        executeAITurn(room, currentPlayer);
    }, delay);
}

// 认罚接下叠加的所有罚牌，回合结束（玩家点击牌堆 / AI 无牌可叠时调用）
function resolveTakeStack(room, player) {
    const amount = room.drawStack;
    room.drawStack = 0;
    room.stackValue = 0;
    const pen = drawCards(room, amount);
    player.hand.push(...pen);
    const willElim = room.version === 'nomercy' && player.hand.length >= 25; // 这次接牌将导致其淘汰
    log(room.id, 'INFO', `玩家(${player.name})接下叠加的${pen.length}张`);
    if (!player.isBot && player.ws && player.ws.readyState === 1) {
        player.ws.send(JSON.stringify({ type: 'draw_card_result', cards: pen, playerId: player.id }));
    }
    broadcastEvent(room.id, 'draw_card', { playerId: player.id, count: pen.length, isPenalty: true, simultaneous: pen.length > 1, willEliminate: willElim });
    const ended = checkEliminations(room);
    if (ended || room.state !== 'ingame') return;
    advanceTurn(room, 1);
}

// 选出手牌中持有最多的颜色作为变色声明；翻转版按当前面调色板
function pickAIColor(room, hand, excludeCardId) {
    const palette = (room.version === 'flip' && room.side === 'dark') ? DARK_COLORS : LIGHT_COLORS;
    const counts = {};
    palette.forEach(c => counts[c] = 0);
    for (const c of hand) {
        if (c.id === excludeCardId) continue;
        if (counts[c.color] !== undefined) counts[c.color]++;
    }
    let best = palette[Math.floor(Math.random() * palette.length)];
    let bestCount = -1;
    for (const color of palette) {
        if (counts[color] > bestCount) { bestCount = counts[color]; best = color; }
    }
    return best;
}

// 出牌优先级：下家快赢时优先攻击性卡牌；否则优先消耗普通/彩色牌，把万能牌留到最后
function pickAICard(room, bot, playableCards) {
    const nextPlayer = room.players[getNextTurn(room, 1)];
    const dangerMode = !!nextPlayer && nextPlayer.id !== bot.id && nextPlayer.hand.length <= 2;
    const ATTACK = new Set(['+2', '+4', 'draw-one', 'draw-five', 'skip', 'skip-all', 'reverse',
        'wild-rev4', 'wild+6', 'wild+10', 'wild-roulette', 'wild+2', 'wild-drawcolor']);

    const rank = (c) => {
        if (dangerMode && ATTACK.has(c.type)) {
            // 危险模式：加牌越多越优先，其次跳过/反转
            const dv = getDrawValue(c);
            if (dv > 0) return 0 - dv / 100;     // 让 +10 排在 +2 之前
            return 1;
        }
        if (c.color !== 'black') return 3;       // 优先消耗彩色牌
        return 5;                                // 黑色万能牌留到最后
    };

    const sorted = [...playableCards].sort((a, b) => rank(a) - rank(b));
    const bestRank = rank(sorted[0]);
    const topChoices = sorted.filter(c => rank(c) === bestRank);
    return topChoices[Math.floor(Math.random() * topChoices.length)];
}

function executeAITurn(room, bot) {
    if (room.state !== 'ingame' || room.frozen) return;
    if (room.players[room.turnIndex].id !== bot.id) return;
    if (room.animating) return; // 上一次出牌的结算动画还没走完，避免被 urge 等重入触发二次判定
    if (room.pendingSwap) return; // 等待换手选择期间不出牌

    // 挂起"逐张摸牌直到指定色"：AI 摸到则跳过，否则摸一张（并自动续摸）
    if (room.pendingDraw) {
        if (room.pendingDraw.satisfied) { room.pendingDraw = null; advanceTurn(room, 1); }
        else resolveUntilDrawOne(room, bot);
        return;
    }

    // 毫不留情叠加进行中：能叠就叠（挑数值最小的合规牌），否则接下叠加的牌
    if (room.drawStack > 0) {
        const qualifying = bot.hand.filter(c => isPlayable(room, bot, c));
        if (qualifying.length > 0) {
            qualifying.sort((a, b) => getDrawValue(a) - getDrawValue(b));
            const c = qualifying[0];
            const color = c.color === 'black' ? pickAIColor(room, bot.hand, c.id) : null;
            playCardLogic(room, bot, c.id, color);
        } else {
            resolveTakeStack(room, bot);
        }
        return;
    }

    let cardToPlay = null;
    let colorToDeclare = null;

    if (!room.hasDrawnThisTurn) {
        const playableCards = bot.hand.filter(c => isPlayable(room, bot, c));
        if (playableCards.length > 0) {
            cardToPlay = pickAICard(room, bot, playableCards);
        }

        if (cardToPlay) {
            if (cardToPlay.color === 'black') {
                colorToDeclare = pickAIColor(room, bot.hand, cardToPlay.id);
            }
            playCardLogic(room, bot, cardToPlay.id, colorToDeclare);
        } else {
            log(room.id, 'INFO', `AI(${bot.name})没有可出的牌，抽牌`);
            const drawnCards = drawCards(room, 1);
            if (drawnCards.length > 0) {
                bot.hand.push(...drawnCards);
                room.hasDrawnThisTurn = true;
                broadcastEvent(room.id, 'draw_card', { playerId: bot.id, count: 1 });
                broadcastRoom(room.id);
                setTimeout(() => { executeAITurn(room, bot); }, 500);
            } else {
                log(room.id, 'INFO', `AI(${bot.name})无牌可抽，跳过`);
                advanceTurn(room, 1);
            }
        }
    } else {
        const lastDrawn = bot.hand[bot.hand.length - 1];
        if (isPlayable(room, bot, lastDrawn)) {
            if (lastDrawn.color === 'black') {
                colorToDeclare = pickAIColor(room, bot.hand, lastDrawn.id);
            }
            playCardLogic(room, bot, lastDrawn.id, colorToDeclare);
        } else {
            log(room.id, 'INFO', `AI(${bot.name})抽牌后仍无牌可出，跳过`);
            advanceTurn(room, 1);
        }
    }
}

// 结算一张牌的功能效果，返回 { skip: n }（按 n 步推进）或 { await: true }（等待玩家额外操作后再推进）
// 单独抽出来是因为 QTE 被抓时也要补算清空手牌的那张功能牌效果，而不能直接丢弃
function applyCardEffect(room, card, player) {
    const type = card.type;

    // 毫不留情：加牌类进入叠加流程，交给下一位决定叠还是认罚（不立即罚抽/跳过）
    if (room.version === 'nomercy' && STACKABLE.has(type)) {
        room.drawStack += getDrawValue(card);
        room.stackValue = getDrawValue(card);
        log(room.id, 'INFO', `叠加罚牌累计 ${room.drawStack} 张`);
        // wild-rev4 的反转：仅2人(或剩2人)时反转等同跳过对方，叠加罚牌回到自己头上（可再叠加甩回对方）
        if (type === 'wild-rev4') {
            if (activeCount(room) === 2) return { skip: 2 };
            applyReverse(room);
        }
        return { skip: 1 };
    }

    switch (type) {
        case 'skip':
            return { skip: 2 };
        case 'reverse':
            if (activeCount(room) === 2) return { skip: 2 }; // 双人反转等同跳过
            applyReverse(room);
            return { skip: 1 };
        case '+2': case '+4':                 // 原版及非叠加情形：立即罚抽并跳过
            penalizeNext(room, getDrawValue(card));
            return { skip: 2 };
        case 'wild+2':                        // 翻转版浅色 万能+2
            penalizeNext(room, 2);
            return { skip: 2 };
        case 'draw-one':                      // 翻转版浅色 抽一张
            penalizeNext(room, 1);
            return { skip: 2 };
        case 'draw-five':                     // 翻转版深色 抽五张
            penalizeNext(room, 5);
            return { skip: 2 };
        case 'skip-all':                      // 全员跳过，回到自己
            return { skip: activeCount(room) };
        case 'discard-all':                   // 清色：同色牌已在出牌时弃掉，无额外推进
            return { skip: 1 };
        case 'wild-roulette':                 // 毫不留情 选色轮盘
        case 'wild-drawcolor':                // 翻转版深色 万能指定色抽
            // 交给下家：轮到其回合并挂起"逐张摸牌直到指定色"，由其点击牌堆完成
            room.pendingDraw = { untilColor: room.currentColor, satisfied: false };
            return { skip: 1 };
        case 'flip': {                        // 翻转版 翻面
            room.side = room.side === 'light' ? 'dark' : 'light';
            applySideAll(room);
            room.currentColor = card.color;   // 翻面后当前颜色取该牌翻面后的颜色
            log(room.id, 'INFO', `翻面 → ${room.side}`);
            broadcastEvent(room.id, 'flip_side', { side: room.side });
            return { skip: 1 };
        }
        case '7':                             // 毫不留情 7 号换手
            if (room.version === 'nomercy') {
                if (room.sevenSwapTarget) {   // 真人已先选好目标：直接换手（doSwap 内部推进回合）
                    const t = room.sevenSwapTarget; room.sevenSwapTarget = null;
                    doSwap(room, player.id, t);
                    return { await: true };
                }
                startSwap(room, player); return { await: true }; // AI / QTE 补算：即时选择
            }
            return { skip: 1 };
        case '0':                             // 毫不留情 0 号全体传手
            if (room.version === 'nomercy') passAllHands(room);
            return { skip: 1 };
        default:
            return { skip: 1 };
    }
}

function playCardLogic(room, player, cardId, declaredColor, isCheat = false, sevenTarget = null) {
    if (room.animating || room.frozen) return; // 结算动画 / 淘汰冻结期间禁止出牌
    if (room.pending7 && !sevenTarget) return; // 正在等待出7选目标：拦截其它出牌，仅放行确定目标后的补出
    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;
    let card = player.hand[cardIndex];

    const playable = isPlayable(room, player, card);

    if (isCheat && !player.isBot) {
        if (room.pendingDraw) return; // 持续摸牌/摸到指定色后不能作弊出牌
        if (!playable) {
            log(room.id, 'INFO', `[作弊] 玩家(${player.name})打出不合法牌，要求选色变为作弊牌`);
            if (player.ws && player.ws.readyState === 1) {
                player.ws.send(JSON.stringify({ type: 'cheat_need_color', cardId: card.id }));
            }
            return;
        }
    } else {
        if (!playable) {
            log(room.id, 'WARN', `玩家(${player.name})出牌不合法`);
            return;
        }
    }

    // 黑色万能牌需声明颜色：只接受合法颜色，拦截被注入到弃牌堆渲染 class 中的恶意字符串
    if (card.color === 'black' && !VALID_COLORS.includes(declaredColor)) {
        log(room.id, 'WARN', `玩家(${player.name})声明了非法颜色，已拦截`);
        return;
    }

    // 毫不留情出 7：真人先选择交换目标，选好后再真正出牌并播放动画
    if (room.version === 'nomercy' && card.type === '7' && !player.isBot && !sevenTarget) {
        room.pending7 = { playerId: player.id, cardId: card.id, declaredColor };
        const targets = room.players.filter(p => !p.eliminated && p.id !== player.id)
            .map(p => ({ id: p.id, name: p.name, handCount: p.hand.length }));
        broadcastRoom(room.id);
        if (player.ws && player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({ type: 'choose_swap_target', targets }));
        }
        return;
    }
    if (sevenTarget) room.sevenSwapTarget = sevenTarget; // 供 applyCardEffect 直接换手，不再二次弹窗

    player.hand.splice(cardIndex, 1);
    room.discardPile.push(card);
    
    let colorMsg = card.color;
    if (card.color === 'black') {
        room.currentColor = declaredColor;
        colorMsg = `变色(${declaredColor})`;
    } else {
        room.currentColor = card.color;
    }

    log(room.id, 'INFO', `玩家(${player.name})打出了 ${colorMsg} 的 ${card.type}`);
    room.animating = true;
    broadcastEvent(room.id, 'play_card', { playerId: player.id, card, declaredColor: room.currentColor });
    // 清色：与出牌同时告知客户端被清掉的同色牌，好让它们一起播放出牌动画
    if (card.type === 'discard-all') {
        const alsoDiscarded = player.hand.filter(c => c.color === card.color);
        if (alsoDiscarded.length) {
            broadcastEvent(room.id, 'discard_all', { playerId: player.id, cards: alsoDiscarded, mainId: card.id });
        }
    }
    broadcastRoom(room.id);

    setTimeout(() => {
        room.animating = false;

        // 毫不留情 清色：把手里所有与该牌同色的牌一并弃掉（可能因此清空手牌）
        if (card.type === 'discard-all') {
            const removed = player.hand.filter(c => c.color === card.color);
            player.hand = player.hand.filter(c => c.color !== card.color);
            if (removed.length) {
                // 被清的同色牌垫在清色牌下方，保持清色牌始终是弃牌堆顶牌（下家以它为底牌出牌）
                if (room.discardPile[room.discardPile.length - 1] === card) room.discardPile.pop();
                room.discardPile.push(...removed, card);
                log(room.id, 'INFO', `清色弃掉${removed.length}张${card.color}，清色牌保持顶牌`);
            }
        }

        if (player.hand.length === 0) {
            if (room.isBigScreen) {
                log(room.id, 'INFO', `大屏模式，玩家(${player.name})手牌为0，直接获胜`);
                broadcastEvent(room.id, 'qte_win', { winner: player.name });
                endGame(room);
            } else {
                room.qtePendingCard = card; // 若之后被抓到，这张牌的功能效果需要在抓到时补算
                triggerQTE(room, player);
            }
            broadcastRoom(room.id);
            return;
        }

        const effect = applyCardEffect(room, card, player);
        if (room.state !== 'ingame') return;                  // 效果触发淘汰结束则不再推进
        if (effect.await) { broadcastRoom(room.id); return; } // 等待换手选择等后续操作
        advanceTurn(room, effect.skip);
    }, 500);
}

function handleDisconnect(ws) {
    const clientData = clients.get(ws);
    if (!clientData) return;
    
    if (clientData.afkTimer) {
        clearTimeout(clientData.afkTimer);
    }

    const room = rooms.get(clientData.roomId);
    const wasSpectator = clientData.isSpectator;

    clientData.roomId = null;
    clientData.isSpectator = false;

    if (!room) return;

    if (room.isBigScreen) {
        log(room.id, 'INFO', '大屏模式房主断开，防僵尸机制启动，房间自动解散');
        if (room.spectators) {
            room.spectators.forEach(s => {
                if (s.ws) sendError(s.ws, '房主已离开，房间自动解散');
            });
        }
        rooms.delete(room.id);
        return;
    }

    if (wasSpectator) {
        const specIndex = room.spectators.findIndex(s => s.id === clientData.id);
        if (specIndex !== -1) {
            log(room.id, 'INFO', `观战者(${room.spectators[specIndex].name})离开房间`);
            room.spectators.splice(specIndex, 1);
            broadcastRoom(room.id);
        }
        return;
    }

    const playerIndex = room.players.findIndex(p => p.id === clientData.id);
    if (playerIndex === -1) return;

    const player = room.players[playerIndex];
    player.ws = null;

    log(room.id, 'INFO', `玩家(${player.name})离开房间`);

    if (room.state === 'lobby') {
        room.players.splice(playerIndex, 1);
        if (room.players.length === 0 || room.players.every(p => p.isBot)) {
            log(room.id, 'INFO', '房间无真人玩家，自动销毁');
            if (room.spectators) {
                room.spectators.forEach(s => {
                    sendError(s.ws, '房间已解散');
                });
            }
            rooms.delete(room.id);
        } else {
            if (player.isHost) {
                const newHost = room.players.find(p => !p.isBot);
                if (newHost) {
                    newHost.isHost = true;
                    // 房主永远排在第一个玩家框（直接换位，无动画）
                    const idx = room.players.indexOf(newHost);
                    if (idx > 0) { room.players.splice(idx, 1); room.players.unshift(newHost); }
                    log(room.id, 'INFO', `房主变更 -> ${newHost.name}`);
                }
            }
            broadcastRoom(room.id);
        }
    } else {
        log(room.id, 'INFO', `游戏进行中，玩家(${player.name})由AI接管`);
        player.isBot = true;
        player.fromDisconnect = true; // 标记为掉线顶替产生的AI（不可被同名玩家中途顶替）
        // 若该玩家正卡在"出7选目标"，清掉挂起状态，交给AI接管后正常出牌
        if (room.pending7 && room.pending7.playerId === player.id) room.pending7 = null;
        if (room.players.every(p => p.isBot)) {
            log(room.id, 'INFO', '房间内全为AI，自动销毁');
            if (room.aiTimer) clearTimeout(room.aiTimer);
            if (room.spectators) {
                room.spectators.forEach(s => {
                    sendError(s.ws, '房间已解散');
                });
            }
            rooms.delete(room.id);
        } else {
            broadcastRoom(room.id);
            if (room.turnIndex === playerIndex) {
                checkAITurn(room);
            }
        }
    }
}

const MAX_WS_CONNECTIONS = 2000;

// 定时清理僵尸连接和冗余房间
const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            handleDisconnect(ws);
            clients.delete(ws);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });

    for (const [roomId, room] of rooms.entries()) {
        const humanCount = room.players.filter(p => !p.isBot).length;
        if (humanCount === 0) {
            log(room.id, 'INFO', '[系统GC] 房间内已无真人玩家，执行自动销毁');
            if (room.aiTimer) clearTimeout(room.aiTimer);
            if (room.spectators) {
                room.spectators.forEach(s => {
                    if (s.ws) sendError(s.ws, '房间已解散');
                });
            }
            rooms.delete(roomId);
        }
    }
}, 30000);

wss.on('close', () => {
    clearInterval(pingInterval);
});

wss.on('connection', (ws, req) => {
    if (wss.clients.size > MAX_WS_CONNECTIONS) {
        ws.close(1013, '服务器连接数已满，请稍后再试');
        return;
    }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    let messageCount = 0;
    const rateLimitInterval = setInterval(() => { messageCount = 0; }, 1000);

    ws.on('message', (message) => {
        messageCount++;
        if (messageCount > 40) {
            log('SYS', 'WARN', `连接被断开：消息发送频率过高 (${req.socket.remoteAddress})`);
            ws.close(1008, '消息发送频率过高');
            return;
        }

        try {
            const data = JSON.parse(message);
            if (!data || typeof data.type !== 'string') return;
            
            const clientData = clients.get(ws) || {};
            if (clientData.id) {
                updateClientActivity(ws);
            }
            
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', serverTime: Date.now() }));
                return;
            }
            
            if (data.type === 'get_public_rooms') {
                const publicRooms = [];
                for (const [roomId, room] of rooms.entries()) {
                    if (!room.hidden) {
                        publicRooms.push({
                            id: room.id,
                            state: room.state,
                            version: room.version,
                            playersCount: room.players.length,
                            maxPlayers: room.maxPlayers
                        });
                    }
                }
                ws.send(JSON.stringify({ type: 'public_rooms_list', rooms: publicRooms }));
                return;
            }

            if (data.type === 'create_room') {
                let isBigScreen = !!data.isBigScreen;
                let maxPlayers = parseInt(data.maxPlayers, 10);
                let bots = parseInt(data.bots, 10);
                
                // 大屏模式后端强制校验
                if (isBigScreen) {
                    bots = 0;
                    data.hidden = true;
                }

                const qteMode = (data.qteMode === 'button' && !isBigScreen) ? 'button' : 'type';
                const version = ['classic', 'flip', 'nomercy'].includes(data.version) ? data.version : 'classic';

                let playerName = (data.name || '神秘玩家').trim().substring(0, 15);
                if (!playerName) playerName = '神秘玩家';
                
                if (isNaN(maxPlayers) || maxPlayers < 2 || maxPlayers > 12) {
                    sendError(ws, '房间总人数不合法 (2-12)');
                    return;
                }
                if (isNaN(bots) || bots < 0 || bots > 11) {
                    sendError(ws, 'AI数不合法 (0-11)');
                    return;
                }
                if (bots >= maxPlayers) {
                    sendError(ws, 'AI数不能大于等于房间总人数');
                    return;
                }

                if (isBigScreen) {
                    playerName = "玩家1"; // 大屏模式强制顺序命名
                }

                const roomId = generateRoomId();
                const clientId = generateId();
                const room = {
                    id: roomId,
                    hidden: !!data.hidden,
                    isBigScreen: isBigScreen,
                    maxPlayers: maxPlayers,
                    qteMode: qteMode,
                    version: version,
                    side: 'light',
                    drawStack: 0,
                    stackValue: 0,
                    pendingSwap: null,
                    pendingDraw: null,
                    state: 'lobby',
                    players: [{
                        id: clientId,
                        ws, 
                        name: playerName,
                        isHost: true,
                        isBot: false,
                        ready: isBigScreen ? true : false,
                        hasSeenResults: true,
                        hand: []
                    }],
                    spectators: [],
                    turnIndex: 0,
                    direction: 1,
                    currentColor: '',
                    deck: [],
                    discardPile: [],
                    aiTimer: null
                };

                if (isBigScreen) {
                    // 大屏模式生成剩余的本地伪玩家，关联同一个 ws
                    for (let i = 1; i < maxPlayers; i++) {
                        room.players.push({
                            id: generateId(),
                            ws: ws,
                            name: `玩家${i + 1}`,
                            isHost: false,
                            isBot: false, // 伪玩家属于真人操控
                            ready: true,
                            hasSeenResults: true,
                            hand: []
                        });
                    }
                } else {
                    for (let i = 0; i < bots; i++) {
                        // 机器人名字不与房内已有玩家/机器人重复
                        let botName = getRandomBotName();
                        let guard = 0;
                        while (room.players.some(p => p.name === botName) && guard < 40) { botName = getRandomBotName(); guard++; }
                        room.players.push({
                            id: generateId(),
                            ws: null,
                            name: botName,
                            isHost: false,
                            isBot: true,
                            ready: true,
                            hasSeenResults: true,
                            hand: []
                        });
                    }
                }

                rooms.set(roomId, room);
                clients.set(ws, { id: clientId, roomId, name: playerName });
                updateClientActivity(ws);
                log(roomId, 'INFO', `房间创建成功，房主: ${playerName}，大屏: ${isBigScreen ? '是' : '否'}，总人数限制: ${maxPlayers}，AI数: ${bots}，抢答方式: ${qteMode}`);
                broadcastRoom(roomId);
            }
            else if (data.type === 'join_room') {
                let playerName = (data.name || '神秘玩家').trim().substring(0, 15);
                if (!playerName) playerName = '神秘玩家';
                const roomId = (data.roomId || '').trim();
                
                if (!roomId) {
                    sendError(ws, '房间号为空');
                    return;
                }

                const room = rooms.get(roomId);
                if (!room) {
                    sendError(ws, '房间不存在');
                    return;
                }

                if (room.isBigScreen) {
                    sendError(ws, '此房间为大屏模式，无法通过网络加入');
                    return;
                }

                const sameNamePlayer = room.players.find(p => p.name === playerName);
                const sameNameSpec = room.spectators && room.spectators.some(s => s.name === playerName);
                // 仅"掉线顶替产生的AI"可被同名玩家在任何阶段顶替（即断线重连夺回座位）；其他AI一律不可顶替
                const takeable = sameNamePlayer && sameNamePlayer.isBot && sameNamePlayer.fromDisconnect;

                if (sameNameSpec || (sameNamePlayer && !takeable)) {
                    sendError(ws, '房间内已有相同昵称的玩家，请更换昵称');
                    return;
                }

                if (takeable) {
                    // 顶替该AI：沿用其座位与id，真人接管
                    if (room.aiTimer) { clearTimeout(room.aiTimer); room.aiTimer = null; }
                    sameNamePlayer.ws = ws;
                    sameNamePlayer.isBot = false;
                    sameNamePlayer.fromDisconnect = false;
                    if (room.state === 'lobby') sameNamePlayer.ready = false;
                    clients.set(ws, { id: sameNamePlayer.id, roomId: room.id, name: playerName });
                    updateClientActivity(ws);
                    log(room.id, 'INFO', `玩家(${playerName})顶替了同名AI的座位`);
                    broadcastRoom(room.id);
                    if (room.state === 'ingame') checkAITurn(room); // 若轮到别的AI则继续
                    return;
                }

                const clientId = generateId();

                if (room.state !== 'lobby') {
                    room.spectators.push({
                        id: clientId,
                        ws,
                        name: playerName,
                        targetId: room.players[0].id,
                        hasSeenResults: true
                    });
                    clients.set(ws, { id: clientId, roomId: room.id, name: playerName, isSpectator: true });
                    updateClientActivity(ws);
                    log(room.id, 'INFO', `观战者(${playerName})加入房间`);
                    broadcastRoom(room.id);
                    return;
                }

                if (room.players.length >= room.maxPlayers) {
                    sendError(ws, '房间已满');
                    return;
                }

                room.players.push({
                    id: clientId,
                    ws,
                    name: playerName,
                    isHost: false,
                    isBot: false,
                    ready: false,
                    hasSeenResults: true,
                    hand: []
                });

                clients.set(ws, { id: clientId, roomId: room.id, name: playerName });
                updateClientActivity(ws);
                log(room.id, 'INFO', `玩家(${playerName})加入房间`);
                broadcastRoom(room.id);
            }
            else if (data.type === 'leave_room') {
                handleDisconnect(ws);
            }
            else if (data.type === 'kick_player') {
                if (typeof data.targetId !== 'string') return;
                const room = rooms.get(clientData.roomId);
                if (!room) return;
                const player = room.players.find(p => p.id === clientData.id);
                if (!player || !player.isHost) {
                    sendError(ws, '无权踢人');
                    return;
                }
                const targetIdx = room.players.findIndex(p => p.id === data.targetId);
                if (targetIdx !== -1) {
                    const target = room.players[targetIdx];
                    log(room.id, 'INFO', `房主踢出了${target.isBot ? 'AI' : '玩家'}(${target.name})`);
                    if (!target.isBot && target.ws) {
                        target.ws.send(JSON.stringify({ type: 'kicked', reason: '你已被房主踢出房间' }));
                        try { target.ws.close(); } catch (e) {}
                    } else if (target.isBot) {
                        room.players.splice(targetIdx, 1);
                        broadcastRoom(room.id);
                    }
                }
            }
            else if (data.type === 'ready') {
                const room = rooms.get(clientData.roomId);
                if (!room) return;
                const player = room.players.find(p => p.id === clientData.id);
                if (player) {
                    player.ready = !!data.state;
                    log(room.id, 'INFO', `玩家(${player.name})状态变为: ${player.ready ? '已准备' : '未准备'}`);
                    broadcastRoom(room.id);
                }
            }
            else if (data.type === 'add_bot') {
                // 房主在等待页面为空位一键添加AI
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'lobby' || room.isBigScreen) return;
                const host = room.players.find(p => p.id === clientData.id);
                if (!host || !host.isHost) { sendError(ws, '只有房主可以添加AI'); return; }
                if (room.players.length >= room.maxPlayers) { sendError(ws, '房间已满'); return; }
                let botName = getRandomBotName();
                let guard = 0;
                while (room.players.some(p => p.name === botName) && guard < 30) { botName = getRandomBotName(); guard++; }
                room.players.push({
                    id: generateId(), ws: null, name: botName, isHost: false, isBot: true,
                    ready: true, hasSeenResults: true, hand: []
                });
                log(room.id, 'INFO', `房主添加了AI(${botName})`);
                broadcastRoom(room.id);
            }
            else if (data.type === 'update_room_settings') {
                // 房主在等待页面修改 UNO抢答方式 / 游戏版本
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'lobby' || room.isBigScreen) return;
                const host = room.players.find(p => p.id === clientData.id);
                if (!host || !host.isHost) { sendError(ws, '只有房主可以修改房间设置'); return; }
                if (data.qteMode === 'type' || data.qteMode === 'button') room.qteMode = data.qteMode;
                if (['classic', 'flip', 'nomercy'].includes(data.version)) room.version = data.version;
                log(room.id, 'INFO', `房主修改房间设置 -> 版本:${room.version} 抢答:${room.qteMode}`);
                broadcastRoom(room.id);
            }
            else if (data.type === 'start_game') {
                const room = rooms.get(clientData.roomId);
                if (!room) return;
                const player = room.players.find(p => p.id === clientData.id);
                if (!player || !player.isHost) {
                    sendError(ws, '只有房主可以开始游戏');
                    return;
                }
                if (room.players.length < 2) {
                    sendError(ws, '至少需要2名玩家');
                    return;
                }
                if (!room.players.every(p => p.ready)) {
                    sendError(ws, '有玩家未准备');
                    return;
                }

                log(room.id, 'INFO', `游戏开始（版本：${room.version}）`);
                room.state = 'ingame';
                // 开局打乱玩家座位顺序（大屏模式的伪玩家保持固定编号，不打乱）
                if (!room.isBigScreen) shuffle(room.players);
                room.deck = createDeck(room.version);
                room.discardPile = [];
                room.direction = 1;
                room.hasDrawnThisTurn = false;
                // 重置各版本对局状态
                room.side = 'light';
                room.drawStack = 0;
                room.stackValue = 0;
                room.pendingSwap = null;
                room.pendingDraw = null;
                room.pending7 = null;
                room.sevenSwapTarget = null;
                room.frozen = false;
                if (room.freezeTimer) { clearTimeout(room.freezeTimer); room.freezeTimer = null; }
                room.endedByElimination = false;
                room.players.forEach(p => { p.eliminated = false; p.bestReactionMs = null; });

                room.players.forEach(p => {
                    const dealt = drawCards(room, 7);
                    p.hand = dealt;
                    if (!p.isBot && p.ws && p.ws.readyState === 1) {
                        p.ws.send(JSON.stringify({ type: 'draw_card_result', cards: dealt, playerId: p.id }));
                    }
                });

                // 首牌必须是数字牌（原版仅规避 +4，其余版本按规则重翻至数字牌）
                let firstCard;
                do {
                    firstCard = drawCards(room, 1)[0];
                    const reject = room.version === 'classic' ? (firstCard.type === '+4') : !isNumberCard(firstCard);
                    if (reject) {
                        room.deck.push(firstCard);
                        room.deck = shuffle(room.deck);
                        firstCard = null;
                    }
                } while (!firstCard);

                room.discardPile.push(firstCard);
                room.currentColor = firstCard.color === 'black' ? 'red' : firstCard.color;
                
                room.turnIndex = Math.floor(Math.random() * room.players.length);
                log(room.id, 'INFO', `首牌: ${firstCard.color} ${firstCard.type}，起始玩家: ${room.players[room.turnIndex].name}`);

                if (!room.isBigScreen) previewNextQteWord(room); // 大屏模式手牌清零直接获胜，不会触发QTE，无需预告

                broadcastRoom(room.id);
                
                room.players.forEach(p => {
                    broadcastEvent(room.id, 'draw_card', { playerId: p.id, count: 7, simultaneous: true, isDeal: true });
                });

                // 发牌动画已缩短，首个 AI 回合的等待也相应缩短
                setTimeout(() => {
                    checkAITurn(room);
                }, 900);
            }
            else if (data.type === 'play_card') {
                if (typeof data.cardId !== 'string' || typeof data.declaredColor !== 'string') return;
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame') return;
                const player = room.players[room.turnIndex];
                
                if (room.isBigScreen) {
                    if (player.ws !== ws) return; // 校验大屏房主权限
                } else {
                    if (player.id !== clientData.id) {
                        sendError(ws, '还没轮到你');
                        return;
                    }
                }
                playCardLogic(room, player, data.cardId, data.declaredColor, !!data.cheat);
            }
            else if (data.type === 'play_cheat_card') {
                if (typeof data.cardId !== 'string' || typeof data.declaredColor !== 'string') return;
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame' || room.frozen) return;
                if (room.pendingDraw) return; // 持续摸牌/摸到指定色后不能作弊出牌
                const player = room.players[room.turnIndex];

                if (room.isBigScreen) {
                    if (player.ws !== ws) return;
                } else {
                    if (player.id !== clientData.id) return;
                }

                if (!VALID_COLORS.includes(data.declaredColor)) return;

                const cardIndex = player.hand.findIndex(c => c.id === data.cardId);
                if (cardIndex !== -1) {
                    let card = player.hand[cardIndex];
                    // 毫不留情版作弊牌为 万能+10（可在叠加过程中打出）；其余版本为超级 +4
                    const cheatType = room.version === 'nomercy' ? 'wild+10' : '+4';
                    log(room.id, 'INFO', `[作弊成功] 玩家(${player.name})将手中 ${card.color} ${card.type} 变为了 ${cheatType}，颜色 ${data.declaredColor}`);
                    card.color = 'black';
                    card.type = cheatType;
                    playCardLogic(room, player, data.cardId, data.declaredColor, false);
                }
            }
            else if (data.type === 'draw_card') {
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame' || room.animating || room.frozen) return;
                const player = room.players[room.turnIndex];
                
                if (room.isBigScreen) {
                    if (player.ws !== ws) return;
                } else {
                    if (player.id !== clientData.id) return;
                }
                
                // 点击牌堆的三种含义：逐张持续摸牌 / 接下叠加 / 普通摸一张
                if (room.pendingDraw) {
                    if (!room.pendingDraw.satisfied) resolveUntilDrawOne(room, player); // 已摸到指定色则忽略，等其点跳过
                    return;
                }
                if (room.drawStack > 0) {
                    resolveTakeStack(room, player);
                    return;
                }
                if (room.hasDrawnThisTurn) {
                    sendError(ws, '本回合已抽过牌');
                    return;
                }

                const drawnCards = drawCards(room, 1);
                if (drawnCards.length > 0) {
                    player.hand.push(...drawnCards);
                    room.hasDrawnThisTurn = true;
                    log(room.id, 'INFO', `玩家(${player.name})抽了一张牌`);
                    if (ws && ws.readyState === 1) {
                        ws.send(JSON.stringify({ type: 'draw_card_result', cards: drawnCards, playerId: player.id }));
                    }
                    broadcastRoom(room.id);
                    broadcastEvent(room.id, 'draw_card', { playerId: player.id, count: 1 });
                } else {
                    sendError(ws, '牌堆已空，请点击跳过');
                }
            }
            else if (data.type === 'skip_turn') {
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame' || room.frozen) return;
                const player = room.players[room.turnIndex];
                
                if (room.isBigScreen) {
                    if (player.ws !== ws) return;
                } else {
                    if (player.id !== clientData.id) return;
                }
                
                if (room.drawStack > 0) {
                    sendError(ws, '请点击牌堆接下叠加的牌');
                    return;
                }
                // 逐张摸牌：摸到指定色后可点跳过结束回合；未摸到则不能跳过
                if (room.pendingDraw) {
                    if (!room.pendingDraw.satisfied) { sendError(ws, '请点击牌堆继续摸牌，直到摸到指定颜色'); return; }
                    room.pendingDraw = null;
                    log(room.id, 'INFO', `玩家(${player.name})摸到指定色后跳过回合`);
                    advanceTurn(room, 1);
                    return;
                }
                if (!room.hasDrawnThisTurn) {
                    sendError(ws, '必须先抽牌才能跳过');
                    return;
                }
                log(room.id, 'INFO', `玩家(${player.name})跳过回合`);
                advanceTurn(room, 1);
            }
            else if (data.type === 'swap_hands') {
                // 毫不留情 7 号换手：选择目标
                if (typeof data.targetId !== 'string') return;
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame' || room.frozen) return;

                // 情况A：出 7 的"先选目标"——选好后再真正出牌并播放动画
                if (room.pending7) {
                    const p7 = room.pending7;
                    const byPlayer = room.players.find(p => p.id === p7.playerId);
                    if (!byPlayer) { room.pending7 = null; return; }
                    if (room.isBigScreen ? byPlayer.ws !== ws : byPlayer.id !== clientData.id) return;
                    const target = room.players.find(p => p.id === data.targetId);
                    if (!target || target.eliminated || target.id === byPlayer.id) return;
                    room.pending7 = null;
                    playCardLogic(room, byPlayer, p7.cardId, p7.declaredColor, false, data.targetId);
                    return;
                }

                // 情况B：出牌后才提示的换手（AI / QTE 补算路径）
                if (!room.pendingSwap) return;
                const byPlayer = room.players.find(p => p.id === room.pendingSwap.byId);
                if (!byPlayer) return;
                if (room.isBigScreen ? byPlayer.ws !== ws : byPlayer.id !== clientData.id) return;
                const target = room.players.find(p => p.id === data.targetId);
                if (!target || target.eliminated || target.id === byPlayer.id) return;
                doSwap(room, byPlayer.id, data.targetId);
            }
            else if (data.type === 'cancel_seven') {
                // 点空白关闭换手弹窗
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame') return;
                if (room.pending7 && room.pending7.playerId === clientData.id) {
                    room.pending7 = null; // 取消出 7：牌留在手里，仍是该玩家回合
                    broadcastRoom(room.id);
                } else if (room.pendingSwap && room.pendingSwap.byId === clientData.id) {
                    // 已出牌无法真正取消：自动选一个合法目标完成换手
                    const t = room.players.find(p => !p.eliminated && p.id !== clientData.id);
                    if (t) doSwap(room, clientData.id, t.id);
                }
            }
            else if (data.type === 'urge') {
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame' || room.isBigScreen) return; // 大屏模式禁用催促
                const currentPlayer = room.players[room.turnIndex];
                if (currentPlayer.id === clientData.id) return;

                log(room.id, 'INFO', `玩家(${clientData.name})催促了(${currentPlayer.name})`);
                
                if (currentPlayer.isBot) {
                    if (room.aiTimer) {
                        clearTimeout(room.aiTimer);
                        log(room.id, 'INFO', `打断AI思考，立即执行`);
                        executeAITurn(room, currentPlayer);
                    }
                } else if (currentPlayer.ws && currentPlayer.ws.readyState === 1) {
                    currentPlayer.ws.send(JSON.stringify({ type: 'urged' }));
                }
            }
            else if (data.type === 'qte_submit') {
                const room = rooms.get(clientData.roomId);
                if (!room || room.isBigScreen) return; // 大屏模式禁用QTE抢答
                // 输入模式必须带验证码字符串；按钮模式抢先按下即可（无 word）
                if (room.qteMode === 'type' && typeof data.word !== 'string') return;
                const player = room.players.find(p => p.id === clientData.id);
                if (player) {
                    handleQTESubmit(room, player, typeof data.word === 'string' ? data.word : '', Date.now());
                }
            }
            else if (data.type === 'change_spectator_target') {
                if (typeof data.targetId !== 'string') return;
                const room = rooms.get(clientData.roomId);
                if (!room) return;
                const target = room.players.find(p => p.id === data.targetId && !p.eliminated);
                if (!target) return;
                if (clientData.isSpectator) {
                    const spec = room.spectators.find(s => s.id === clientData.id);
                    if (spec) { spec.targetId = data.targetId; broadcastRoom(room.id); }
                } else {
                    // 被淘汰玩家也可切换观看目标
                    const me = room.players.find(p => p.id === clientData.id);
                    if (me && me.eliminated) { me.specTarget = data.targetId; broadcastRoom(room.id); }
                }
            }
            else if (data.type === 'chat') {
                if (typeof data.message !== 'string') return;
                let safeMsg = data.message.trim().substring(0, 200); 
                if (!safeMsg) return;
                const room = rooms.get(clientData.roomId);
                if (!room || room.isBigScreen) return; // 大屏禁用聊天
                broadcastChat(room.id, clientData.name, safeMsg, clientData.isSpectator);
            }
            else if (data.type === 'cheat_activated') {
                const room = rooms.get(clientData.roomId);
                let playerName = (clientData.name || data.name || '未知玩家').trim().substring(0, 15);
                if (!playerName) playerName = '未知玩家';
                
                if (room) {
                    log(room.id, 'WARN', `玩家(${playerName}) 激活了全局作弊模式`);
                } else {
                    log('lobby', 'WARN', `玩家(${playerName}) 在大厅激活了全局作弊模式`);
                }
            }
            else if (data.type === 'return_lobby') {
                const room = rooms.get(clientData.roomId);
                if (!room) return;

                if (clientData.isSpectator) {
                    if (room.players.length < room.maxPlayers) {
                        const specIndex = room.spectators.findIndex(s => s.id === clientData.id);
                        if (specIndex !== -1) {
                            const spec = room.spectators[specIndex];
                            room.spectators.splice(specIndex, 1);
                            room.players.push({
                                id: spec.id,
                                ws: spec.ws,
                                name: spec.name,
                                isHost: false,
                                isBot: false,
                                ready: false,
                                hasSeenResults: true,
                                hand: []
                            });
                            clientData.isSpectator = false;
                            log(room.id, 'INFO', `观战者(${spec.name})转为正式玩家`);
                            broadcastRoom(room.id);
                        }
                    } else {
                        const spec = room.spectators.find(s => s.id === clientData.id);
                        if (spec) {
                            spec.hasSeenResults = true;
                            sendError(ws, '房间已满，您仍处于观战模式');
                            broadcastRoom(room.id);
                        }
                    }
                    return;
                }

                const player = room.players.find(p => p.id === clientData.id);
                if (player) {
                    player.hasSeenResults = true;
                    if (room.isBigScreen) {
                        // 大屏模式房主一旦点击继续，全部本地虚拟玩家视为已阅读
                        room.players.forEach(p => p.hasSeenResults = true);
                    }
                    broadcastRoom(room.id);
                }
            }
        } catch (err) {
            console.error('WS Error:', err);
        }
    });

    ws.on('close', () => {
        clearInterval(rateLimitInterval);
        handleDisconnect(ws);
        clients.delete(ws); 
    });
});

app.get('/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    if (/^\d{3}$/.test(roomId)) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).send('Not Found');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[SYS] 服务器已启动，监听端口: ${PORT}`);
});
