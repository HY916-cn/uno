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

const BOT_NAMES = [
    "清梦", "令", "数字", "亦丹", 
    "游离电子", "羽然永远开心", "月色", "一笑了之？", 
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

function createDeck() {
    const deck = [];
    const colors = ['red', 'yellow', 'blue', 'green'];
    for (const color of colors) {
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

function broadcastRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const stateToSend = {
        id: room.id,
        hidden: room.hidden,
        state: room.state,
        maxPlayers: room.maxPlayers,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            isBot: p.isBot,
            ready: p.ready,
            hasSeenResults: p.hasSeenResults,
            handCount: p.hand.length,
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
        results: room.results
    };

    room.players.forEach(p => {
        if (!p.isBot && p.ws && p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({
                type: 'room_state',
                room: stateToSend,
                myHand: p.hand,
                myId: p.id,
                hasDrawnThisTurn: room.hasDrawnThisTurn
            }));
        }
    });

    if (room.spectators) {
        room.spectators.forEach(s => {
            if (s.ws && s.ws.readyState === 1) {
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
    room.players.forEach(p => {
        if (!p.isBot && p.ws && p.ws.readyState === 1) {
            p.ws.send(chatMsg);
        }
    });
    if (room.spectators) {
        room.spectators.forEach(s => {
            if (s.ws && s.ws.readyState === 1) {
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
    room.players.forEach(p => {
        if (!p.isBot && p.ws && p.ws.readyState === 1) {
            p.ws.send(msg);
        }
    });
    if (room.spectators) {
        room.spectators.forEach(s => {
            if (s.ws && s.ws.readyState === 1) {
                s.ws.send(msg);
            }
        });
    }
}

function getNextTurn(room, step = 1) {
    let nextIndex = room.turnIndex;
    const total = room.players.length;
    for (let i = 0; i < step; i++) {
        nextIndex = (nextIndex + room.direction + total) % total;
    }
    return nextIndex;
}

function advanceTurn(room, step = 1) {
    room.turnIndex = getNextTurn(room, step);
    room.hasDrawnThisTurn = false;
    broadcastRoom(room.id);
    checkAITurn(room);
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

function triggerQTE(room, player) {
    room.state = 'qte';
    room.qteTargetPlayerId = player.id;
    room.qteWord = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    room.qteStartTime = Date.now();
    log(room.id, 'INFO', `玩家(${player.name})手牌为0，触发QTE抢答! 目标词: UNO-${room.qteWord}`);
    
    broadcastEvent(room.id, 'qte_start', { qteWord: room.qteWord });

    // Bots randomly try to catch
    room.players.forEach(p => {
        if (p.isBot) {
            // 给每个机器人一个独立的随机反应时间
            // 目标玩家(0手牌的机器人)应该比其他抓人的机器人稍微快一点点(比如2秒~4秒)
            // 抓人的机器人反应稍微慢一点点(比如2.5秒~5秒)，这样0手牌的机器人才有机会赢
            let delay;
            if (p.id === room.qteTargetPlayerId) {
                delay = 2000 + Math.random() * 2000; 
            } else {
                delay = 2500 + Math.random() * 2500;
            }
            
            setTimeout(() => {
                if (room.state === 'qte') {
                    handleQTESubmit(room, p, `UNO-${room.qteWord}`, Date.now());
                }
            }, delay);
        }
    });
}

function handleQTESubmit(room, player, word, clientTime) {
    if (room.state !== 'qte') return;
    const targetWord = `UNO-${room.qteWord}`;
    if (word !== targetWord) return;

    log(room.id, 'INFO', `玩家(${player.name})提交了QTE`);
    
    const targetPlayer = room.players.find(p => p.id === room.qteTargetPlayerId);
    
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
        advanceTurn(room, 1);
    }
}

function endGame(room) {
    room.results = [...room.players].sort((a, b) => a.hand.length - b.hand.length).map(p => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length
    }));
    room.state = 'lobby';
    room.players.forEach(p => {
        p.hand = [];
        if (!p.isBot) {
            p.ready = false;
            p.hasSeenResults = false;
        } else {
            p.ready = true;
            p.hasSeenResults = true;
        }
    });
    if (room.spectators) {
        room.spectators.forEach(s => {
            s.hasSeenResults = false;
        });
    }
    log(room.id, 'INFO', '游戏结束，进入结算/大厅阶段');
    broadcastRoom(room.id);
}

function checkAITurn(room) {
    if (room.state !== 'ingame') return;
    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer.isBot) return;

    if (room.aiTimer) clearTimeout(room.aiTimer);

    const delay = 1000 + Math.random() * 1000; // AI出牌变快，在1秒到2秒之间
    room.aiTimer = setTimeout(() => {
        executeAITurn(room, currentPlayer);
    }, delay);
}

function executeAITurn(room, bot) {
    if (room.state !== 'ingame') return;
    if (room.players[room.turnIndex].id !== bot.id) return;

    const topCard = room.discardPile[room.discardPile.length - 1];
    const currentColor = room.currentColor;

    let cardToPlay = null;
    let colorToDeclare = null;

    if (!room.hasDrawnThisTurn) {
        // Try to find a playable card
        const playableCards = bot.hand.filter(c => canPlayCard(c, topCard, currentColor));
        if (playableCards.length > 0) {
            cardToPlay = playableCards[Math.floor(Math.random() * playableCards.length)];
        }
        
        if (cardToPlay) {
            if (cardToPlay.color === 'black') {
                const colors = ['red', 'yellow', 'blue', 'green'];
                colorToDeclare = colors[Math.floor(Math.random() * colors.length)];
            }
            playCardLogic(room, bot, cardToPlay.id, colorToDeclare);
        } else {
            // Draw card
            log(room.id, 'INFO', `AI(${bot.name})没有可出的牌，抽牌`);
            const drawnCards = drawCards(room, 1);
            if (drawnCards.length > 0) {
                bot.hand.push(...drawnCards);
                room.hasDrawnThisTurn = true;
                broadcastEvent(room.id, 'draw_card', { playerId: bot.id, count: 1 });
                broadcastRoom(room.id);
                // Check if can play the drawn card immediately
                setTimeout(() => { executeAITurn(room, bot); }, 500);
            } else {
                // Deck empty, skip
                log(room.id, 'INFO', `AI(${bot.name})无牌可抽，跳过`);
                advanceTurn(room, 1);
            }
        }
    } else {
        // Has drawn, try to play the drawn card, else skip
        const lastDrawn = bot.hand[bot.hand.length - 1];
        if (canPlayCard(lastDrawn, topCard, currentColor)) {
            if (lastDrawn.color === 'black') {
                const colors = ['red', 'yellow', 'blue', 'green'];
                colorToDeclare = colors[Math.floor(Math.random() * colors.length)];
            }
            playCardLogic(room, bot, lastDrawn.id, colorToDeclare);
        } else {
            log(room.id, 'INFO', `AI(${bot.name})抽牌后仍无牌可出，跳过`);
            advanceTurn(room, 1);
        }
    }
}

function playCardLogic(room, player, cardId, declaredColor, isCheat = false) {
    if (room.animating) return; // Prevent actions during animation
    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;
    let card = player.hand[cardIndex];

    const topCard = room.discardPile[room.discardPile.length - 1];
    
    // Check if the card is playable normally
    const isPlayable = canPlayCard(card, topCard, room.currentColor);

    if (isCheat && !player.isBot) {
        if (!isPlayable) {
            log(room.id, 'INFO', `[作弊] 玩家(${player.name})打出不合法牌，强行要求变色为 +4 牌`);
            // Tell the client to show the color picker because they are cheating with an unplayable card
            if (player.ws && player.ws.readyState === 1) {
                player.ws.send(JSON.stringify({ type: 'cheat_need_color', cardId: card.id }));
            }
            return;
        }
        // If it IS playable, just proceed to play it normally.
    } else {
        if (!isPlayable) {
            log(room.id, 'WARN', `玩家(${player.name})出牌不合法`);
            return;
        }
    }

    // Normal play or finalized cheat play proceeds here
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
    broadcastRoom(room.id); // Send updated hand size but don't advance turn yet

    setTimeout(() => {
        room.animating = false;

        if (player.hand.length === 0) {
            triggerQTE(room, player);
            broadcastRoom(room.id);
            return;
        }

        let skipCount = 1;

        if (card.type === 'skip') {
            skipCount = 2;
            log(room.id, 'INFO', `触发跳过回合`);
        } else if (card.type === 'reverse') {
            if (room.players.length === 2) {
                skipCount = 2;
                log(room.id, 'INFO', `双人游戏反转等同于跳过`);
            } else {
                room.direction *= -1;
                log(room.id, 'INFO', `触发出牌顺序反转`);
            }
        } else if (card.type === '+2') {
            const nextIdx = getNextTurn(room, 1);
            const nextPlayer = room.players[nextIdx];
            const penalty = drawCards(room, 2);
            nextPlayer.hand.push(...penalty);
            log(room.id, 'INFO', `玩家(${nextPlayer.name})被罚抽2张`);
            if (!nextPlayer.isBot && nextPlayer.ws && nextPlayer.ws.readyState === 1) {
                nextPlayer.ws.send(JSON.stringify({ type: 'draw_card_result', cards: penalty }));
            }
            broadcastEvent(room.id, 'draw_card', { playerId: nextPlayer.id, count: 2, isPenalty: true });
            skipCount = 2;
        } else if (card.type === '+4') {
            const nextIdx = getNextTurn(room, 1);
            const nextPlayer = room.players[nextIdx];
            const penalty = drawCards(room, 4);
            nextPlayer.hand.push(...penalty);
            log(room.id, 'INFO', `玩家(${nextPlayer.name})被罚抽4张`);
            if (!nextPlayer.isBot && nextPlayer.ws && nextPlayer.ws.readyState === 1) {
                nextPlayer.ws.send(JSON.stringify({ type: 'draw_card_result', cards: penalty }));
            }
            broadcastEvent(room.id, 'draw_card', { playerId: nextPlayer.id, count: 4, isPenalty: true });
            skipCount = 2;
        }

        advanceTurn(room, skipCount);
    }, 500); // Wait 500ms for play card animation to finish
}

function handleDisconnect(ws) {
    const clientData = clients.get(ws);
    if (!clientData) return;
    
    if (clientData.afkTimer) {
        clearTimeout(clientData.afkTimer);
    }

    const room = rooms.get(clientData.roomId);
    
    // We only clear the roomId so the client is effectively "kicked" to home screen
    // but the websocket remains open.
    if (clients.has(ws)) {
        clients.get(ws).roomId = null;
        clients.get(ws).isSpectator = false;
    }

    if (!room) return;

    if (clientData.isSpectator) {
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
                    log(room.id, 'INFO', `房主变更 -> ${newHost.name}`);
                }
            }
            broadcastRoom(room.id);
        }
    } else {
        // In game, replace with bot
        log(room.id, 'INFO', `游戏进行中，玩家(${player.name})由AI接管`);
        player.isBot = true;
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

    // 房间垃圾回收 (GC): 清理没有真人玩家的冗余房间
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
        // 限制每个连接每秒最多发送 40 条消息，防止恶意发包消耗服务器 CPU
        messageCount++;
        if (messageCount > 40) {
            log('SYS', 'WARN', `连接被断开：消息发送频率过高 (${req.socket.remoteAddress})`);
            ws.close(1008, '消息发送频率过高');
            return;
        }

        try {
            const data = JSON.parse(message);
            if (!data || typeof data.type !== 'string') return; // Type safety for event type
            
            const clientData = clients.get(ws) || {};
            if (clientData.id) {
                updateClientActivity(ws); // reset AFK timer on any valid incoming message
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
                            playersCount: room.players.length,
                            maxPlayers: room.maxPlayers
                        });
                    }
                }
                ws.send(JSON.stringify({ type: 'public_rooms_list', rooms: publicRooms }));
                return;
            }

            if (data.type === 'create_room') {
                let playerName = (data.name || '神秘玩家').trim().substring(0, 15);
                if (!playerName) playerName = '神秘玩家';
                
                let maxPlayers = parseInt(data.maxPlayers, 10);
                let bots = parseInt(data.bots, 10);
                
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

                const roomId = generateRoomId();
                const clientId = generateId();
                const room = {
                    id: roomId,
                    hidden: !!data.hidden,
                    maxPlayers: maxPlayers,
                    state: 'lobby',
                    players: [{
                        id: clientId,
                        ws, 
                        name: playerName,
                        isHost: true,
                        isBot: false,
                        ready: false,
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

                for (let i = 0; i < bots; i++) {
                    room.players.push({
                        id: generateId(),
                        ws: null,
                        name: getRandomBotName(),
                        isHost: false,
                        isBot: true,
                        ready: true,
                        hasSeenResults: true,
                        hand: []
                    });
                }

                rooms.set(roomId, room);
                clients.set(ws, { id: clientId, roomId, name: playerName });
                updateClientActivity(ws); // Start AFK tracking
                log(roomId, 'INFO', `房间创建成功，房主: ${playerName}，总人数限制: ${maxPlayers}，AI数: ${bots}`);
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

                const clientId = generateId();

                if (room.state !== 'lobby') {
                    // Join as spectator
                    room.spectators.push({
                        id: clientId,
                        ws,
                        name: playerName,
                        targetId: room.players[0].id, // Default target
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
                updateClientActivity(ws); // Start AFK tracking
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
                        sendError(target.ws, '你已被房主踢出房间');
                        target.ws.close();
                    } else if (target.isBot) {
                        // Kick bot out of lobby
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

                log(room.id, 'INFO', '游戏开始');
                room.state = 'ingame';
                room.deck = createDeck();
                room.discardPile = [];
                room.direction = 1;
                room.hasDrawnThisTurn = false;

                // Deal 7 cards to each
                room.players.forEach(p => {
                    const dealt = drawCards(room, 7);
                    p.hand = dealt;
                    if (!p.isBot && p.ws && p.ws.readyState === 1) {
                        p.ws.send(JSON.stringify({ type: 'draw_card_result', cards: dealt }));
                    }
                });

                // First card
                let firstCard;
                do {
                    firstCard = drawCards(room, 1)[0];
                    if (firstCard.type === '+4') {
                        room.deck.push(firstCard);
                        room.deck = shuffle(room.deck);
                        firstCard = null;
                    }
                } while (!firstCard);

                room.discardPile.push(firstCard);
                room.currentColor = firstCard.color === 'black' ? 'red' : firstCard.color; // If wild, default to red
                
                room.turnIndex = Math.floor(Math.random() * room.players.length);
                log(room.id, 'INFO', `首牌: ${firstCard.color} ${firstCard.type}，起始玩家: ${room.players[room.turnIndex].name}`);

                // Broadcast room state
                broadcastRoom(room.id);
                
                // Broadcast dealing animation to all
                room.players.forEach(p => {
                    broadcastEvent(room.id, 'draw_card', { playerId: p.id, count: 7 });
                });

                // 首发牌动画大概需要 7 * 200ms = 1400ms，外加 400ms 的飞行时间。总计约 1.8 秒。
                // 我们增加 2 秒的延迟，让AI在首轮发牌动画结束后再出牌。
                setTimeout(() => {
                    checkAITurn(room);
                }, 2000);
            }
            else if (data.type === 'play_card') {
                if (typeof data.cardId !== 'string' || typeof data.declaredColor !== 'string') return;
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame') return;
                const player = room.players[room.turnIndex];
                if (player.id !== clientData.id) {
                    sendError(ws, '还没轮到你');
                    return;
                }
                playCardLogic(room, player, data.cardId, data.declaredColor, !!data.cheat);
            }
            else if (data.type === 'play_cheat_card') {
                if (typeof data.cardId !== 'string' || typeof data.declaredColor !== 'string') return;
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame') return;
                const player = room.players[room.turnIndex];
                if (player.id !== clientData.id) return;
                
                const validColors = ['red', 'yellow', 'blue', 'green'];
                if (!validColors.includes(data.declaredColor)) return;
                
                // Directly mutate the card into a +4 black card
                const cardIndex = player.hand.findIndex(c => c.id === data.cardId);
                if (cardIndex !== -1) {
                    let card = player.hand[cardIndex];
                    log(room.id, 'INFO', `[作弊成功] 玩家(${player.name})将手中 ${card.color} ${card.type} 变为了超级+4！并选择了颜色 ${data.declaredColor}`);
                    card.color = 'black';
                    card.type = '+4';
                    
                    // Now process it normally without cheat flag since it's already a valid +4
                    playCardLogic(room, player, data.cardId, data.declaredColor, false);
                }
            }
            else if (data.type === 'draw_card') {
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame' || room.animating) return;
                const player = room.players[room.turnIndex];
                if (player.id !== clientData.id) return;
                if (room.hasDrawnThisTurn) {
                    sendError(ws, '本回合已抽过牌');
                    return;
                }

                const drawnCards = drawCards(room, 1);
                if (drawnCards.length > 0) {
                    player.hand.push(...drawnCards);
                    room.hasDrawnThisTurn = true;
                    log(room.id, 'INFO', `玩家(${player.name})抽了一张牌`);
                    // We must send draw_card_result BEFORE room_state and draw_card
                    if (ws && ws.readyState === 1) {
                        ws.send(JSON.stringify({ type: 'draw_card_result', cards: drawnCards }));
                    }
                    broadcastRoom(room.id); // Sends new room_state with updated hand
                    // Now broadcast the animation trigger
                    broadcastEvent(room.id, 'draw_card', { playerId: player.id, count: 1 });
                } else {
                    sendError(ws, '牌堆已空，请点击跳过');
                }
            }
            else if (data.type === 'skip_turn') {
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame') return;
                const player = room.players[room.turnIndex];
                if (player.id !== clientData.id) return;
                if (!room.hasDrawnThisTurn) {
                    sendError(ws, '必须先抽牌才能跳过');
                    return;
                }
                log(room.id, 'INFO', `玩家(${player.name})跳过回合`);
                advanceTurn(room, 1);
            }
            else if (data.type === 'urge') {
                const room = rooms.get(clientData.roomId);
                if (!room || room.state !== 'ingame') return;
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
                if (typeof data.word !== 'string') return;
                const room = rooms.get(clientData.roomId);
                if (!room) return;
                const player = room.players.find(p => p.id === clientData.id);
                if (player) {
                    handleQTESubmit(room, player, data.word, Date.now());
                }
            }
            else if (data.type === 'change_spectator_target') {
                if (typeof data.targetId !== 'string') return;
                const room = rooms.get(clientData.roomId);
                if (!room || !clientData.isSpectator) return;
                const spec = room.spectators.find(s => s.id === clientData.id);
                if (spec && room.players.find(p => p.id === data.targetId)) {
                    spec.targetId = data.targetId;
                    broadcastRoom(room.id); // Re-broadcast to update their specific view
                }
            }
            else if (data.type === 'chat') {
                if (typeof data.message !== 'string') return;
                let safeMsg = data.message.trim().substring(0, 200); // truncate super long msgs
                if (!safeMsg) return;
                const room = rooms.get(clientData.roomId);
                if (!room) return;
                broadcastChat(room.id, clientData.name, safeMsg, clientData.isSpectator);
            }
            else if (data.type === 'cheat_activated') {
                const room = rooms.get(clientData.roomId);
                let playerName = (clientData.name || data.name || '未知玩家').trim().substring(0, 15);
                if (!playerName) playerName = '未知玩家';
                
                // Get IP address from WebSocket
                
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
                        // Upgrade to player
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
                        // Still spectator, but wants to return to lobby
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
        clients.delete(ws); // Fully delete when WS actually closes
    });
});

// Provide wildcard route for direct join links
app.get('/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    if (/^\d{3}$/.test(roomId)) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).send('Not Found');
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`[SYS] 服务器已启动，监听端口: ${PORT}`);
});
