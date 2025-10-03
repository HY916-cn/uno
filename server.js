// UNO Online Game - 后端服务器
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// 创建Express应用和HTTP服务器
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 配置静态文件服务
app.use(express.static(path.join(__dirname)));

// 处理所有路径，返回index.html以支持前端路由
app.get('*', (req, res) => {
    // 如果请求的是静态资源文件，让静态文件中间件处理
    if (req.path.includes('.')) {
        return res.status(404).send('File not found');
    }
    
    // 对于所有其他路径（包括房间号），返回index.html
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 管理员密码的SHA256哈希值
const ADMIN_PASSWORD_HASH = '821d04e31082c958f77cb760b79a7b6f600033114b3c13f98a0f2bac85314d5b';

// 日志工具函数
function log(level, category, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}`;
    
    if (level === 'error') {
        console.error(logMessage, data ? JSON.stringify(data, null, 2) : '');
    } else if (level === 'warn') {
        console.warn(logMessage, data ? JSON.stringify(data, null, 2) : '');
    } else {
        console.log(logMessage, data ? JSON.stringify(data, null, 2) : '');
    }
}

// 数据存储（在生产环境中应使用数据库）
const rooms = new Map(); // 房间数据
const players = new Map(); // 玩家数据
const adminTokens = new Set(); // 管理员令牌
const gameHistory = new Map(); // 游戏历史记录

// UNO游戏类
class UnoGame {
    constructor(roomCode, maxPlayers) {
        this.roomCode = roomCode;
        this.maxPlayers = maxPlayers;
        this.players = [];
        this.deck = [];
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.direction = 1; // 1为顺时针，-1为逆时针
        this.gameStarted = false;
        this.gameEnded = false;
        this.lastAction = null;
        this.hasDrawnThisTurn = false; // 当前回合是否已经抽牌
        this.createdAt = new Date();
        // 冠军抢夺战相关属性
        this.championBattle = false; // 是否进入冠军抢夺战
        this.championBattleStartTime = null; // 冠军抢夺战开始时间
        this.zeroCardPlayers = []; // 手牌为0的玩家列表
    }

    // 初始化牌组
    initializeDeck() {
        this.deck = [];
        const colors = ['red', 'yellow', 'green', 'blue'];
        
        // 数字牌 (0-9)
        colors.forEach(color => {
            // 0只有一张
            this.deck.push({ type: 'number', color, value: 0 });
            // 1-9每个数字两张
            for (let i = 1; i <= 9; i++) {
                this.deck.push({ type: 'number', color, value: i });
                this.deck.push({ type: 'number', color, value: i });
            }
        });

        // 功能牌 (每种颜色各1张，降低特殊牌比例)
        colors.forEach(color => {
            this.deck.push({ type: 'skip', color });
            this.deck.push({ type: 'reverse', color });
            this.deck.push({ type: 'draw2', color });
        });

        // 万能牌 (各2张，降低特殊牌比例)
        for (let i = 0; i < 2; i++) {
            this.deck.push({ type: 'wild', color: 'wild' });
            this.deck.push({ type: 'wild_draw4', color: 'wild' });
        }

        // 洗牌
        this.shuffleDeck();
    }

    // 洗牌
    shuffleDeck() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    // 发牌
    dealCards() {
        // 每个玩家发7张牌
        this.players.forEach(player => {
            player.hand = [];
            for (let i = 0; i < 7; i++) {
                player.hand.push(this.deck.pop());
            }
        });

        // 翻开第一张牌作为弃牌堆的起始牌，确保只能是数字牌
        let firstCard;
        do {
            firstCard = this.deck.pop();
            // 如果抽到的不是数字牌，放回牌堆底部并重新洗牌
            if (firstCard.type !== 'number') {
                this.deck.unshift(firstCard);
                this.shuffleDeck();
            }
        } while (firstCard.type !== 'number'); // 第一张牌必须是数字牌

        this.discardPile.push(firstCard);
    }

    // 抽牌
    drawCard(playerId, count = 1) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return null;

        // 检查是否是当前玩家的回合
        if (this.players[this.currentPlayerIndex].id !== playerId) {
            return null;
        }

        // 检查是否已经抽过牌（除非是特殊牌效果强制抽牌）
        if (count === 1 && this.hasDrawnThisTurn) {
            return null;
        }

        const drawnCards = [];
        for (let i = 0; i < count; i++) {
            if (this.deck.length === 0) {
                this.reshuffleDeck();
            }
            if (this.deck.length > 0) {
                const card = this.deck.pop();
                player.hand.push(card);
                drawnCards.push(card);
            }
        }

        // 如果是主动抽牌（count=1），标记已抽牌
        if (count === 1) {
            this.hasDrawnThisTurn = true;
        }

        return drawnCards;
    }

    // 重新洗牌（当抽牌堆用完时）
    reshuffleDeck() {
        if (this.discardPile.length <= 1) return;

        const topCard = this.discardPile.pop();
        this.deck = [...this.discardPile];
        this.discardPile = [topCard];
        this.shuffleDeck();
    }

    // 出牌
    playCard(playerId, cardIndex, chosenColor = null) {
        const player = this.players.find(p => p.id === playerId);
        if (!player || this.currentPlayerIndex !== this.players.indexOf(player)) {
            return { success: false, message: '不是你的回合' };
        }

        const card = player.hand[cardIndex];
        if (!card) {
            return { success: false, message: '无效的卡牌' };
        }

        // 检查是否可以出牌
        if (!this.canPlayCard(card)) {
            return { success: false, message: '无法出这张牌' };
        }

        // 移除手牌
        player.hand.splice(cardIndex, 1);

        // 处理万能牌的颜色选择
        if ((card.type === 'wild' || card.type === 'wild_draw4') && chosenColor) {
            card.chosenColor = chosenColor;
        }

        // 添加到弃牌堆
        this.discardPile.push(card);

        // 检查是否获胜
        if (player.hand.length === 0) {
            // 立即进入冠军争夺战
            this.startChampionBattle(playerId);
            return { success: true, championBattle: true, zeroCardPlayer: player.nickname };
        }

        // 执行卡牌效果
        const effectInfo = this.executeCardEffect(card);

        return { success: true, effectInfo };
    }

    // 检查是否可以出牌
    canPlayCard(card) {
        const topCard = this.discardPile[this.discardPile.length - 1];
        
        // 万能牌总是可以出
        if (card.type === 'wild' || card.type === 'wild_draw4') {
            return true;
        }

        // 检查颜色匹配
        const topColor = topCard.chosenColor || topCard.color;
        if (card.color === topColor) {
            return true;
        }

        // 检查数字匹配（只对数字牌有效）
        if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) {
            return true;
        }

        // 特殊牌只能通过颜色匹配出牌，不能仅凭类型相同出牌
        return false;
    }

    // 执行卡牌效果
    executeCardEffect(card) {
        let effectInfo = null;
        
        switch (card.type) {
            case 'skip':
                // Skip卡：跳过下一个玩家
                this.nextPlayer();
                const skippedPlayer = this.players[this.currentPlayerIndex];
                effectInfo = {
                    type: 'skip',
                    targetPlayer: skippedPlayer.nickname
                };
                this.nextPlayer(); // 再次移动到下下个玩家
                break;
            case 'reverse':
                // Reverse卡：改变游戏方向
                this.direction *= -1;
                effectInfo = {
                    type: 'reverse',
                    isGlobal: true
                };
                if (this.players.length === 2) {
                    // 两人游戏中，反转牌等同于跳过牌
                    this.nextPlayer();
                }
                this.nextPlayer(); // 移动到下一个玩家
                break;
            case 'draw2':
                // Draw2卡：下一个玩家抽2张牌并跳过回合
                this.nextPlayer();
                const draw2Target = this.players[this.currentPlayerIndex];
                effectInfo = {
                    type: 'draw2',
                    targetPlayer: draw2Target.nickname
                };
                this.drawCard(draw2Target.id, 2);
                this.nextPlayer(); // 跳过目标玩家的回合
                break;
            case 'wild':
                // Wild卡：只改变颜色，正常进行到下一个玩家
                effectInfo = {
                    type: 'wild',
                    isGlobal: true,
                    chosenColor: card.chosenColor
                };
                this.nextPlayer(); // 正常移动到下一个玩家
                break;
            case 'wild_draw4':
                // Wild Draw4卡：下一个玩家抽4张牌并跳过回合，改变颜色
                this.nextPlayer();
                const draw4Target = this.players[this.currentPlayerIndex];
                effectInfo = {
                    type: 'wild_draw4',
                    targetPlayer: draw4Target.nickname,
                    chosenColor: card.chosenColor
                };
                this.drawCard(draw4Target.id, 4);
                this.nextPlayer(); // 跳过目标玩家的回合
                break;
            default:
                // 数字牌：正常进行到下一个玩家
                this.nextPlayer();
                break;
        }
        
        return effectInfo;
    }

    // 下一个玩家
    nextPlayer() {
        // 计算下一个玩家的索引
        this.currentPlayerIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
        this.hasDrawnThisTurn = false; // 重置抽牌状态
    }

    // 喊UNO
    callUno(playerId, targetPlayerId = null) {
        // 检查是否处于冠军争夺战状态
        if (this.championBattle) {
            // 冠军争夺战中，谁先按UNO谁就赢
            const caller = this.players.find(p => p.id === playerId);
            this.endGame(playerId);
            return { 
                success: true, 
                message: `${caller.nickname} pressed UNO first and wins the champion battle!`,
                gameEnded: true,
                winner: playerId
            };
        }

        // 非冠军争夺战状态下，UNO按钮不应该可用
        return { 
            success: false, 
            message: 'UNO button is only available during champion battle!' 
        };
    }

    // 跳过回合
    skipTurn(playerId) {
        // 检查是否是当前玩家的回合
        if (this.players[this.currentPlayerIndex].id !== playerId) {
            return { success: false, error: '不是你的回合' };
        }

        // 只有抽过牌后才能跳过回合
        if (!this.hasDrawnThisTurn) {
            return { success: false, error: '必须先抽一张牌' };
        }

        // 切换到下一个玩家
        this.nextPlayer();
        return { success: true };
    }

    // 开始冠军抢夺战
    startChampionBattle(playerId) {
        this.championBattle = true;
        this.championBattleStartTime = new Date();
        this.zeroCardPlayers.push(playerId);
        
        // 暂停正常游戏流程
        this.gameStarted = false;
    }

    // 冠军抢夺战中的UNO按钮点击
    championBattleUno(playerId) {
        if (!this.championBattle) {
            return { success: false, message: '当前不在冠军抢夺战中' };
        }

        // 查找玩家
        const player = this.players.find(p => p.id === playerId);
        if (!player) {
            return { success: false, message: '玩家不存在' };
        }

        // 第一个按UNO的玩家获胜
        this.endGame(playerId);
        return { 
            success: true, 
            gameEnded: true, 
            champion: true,
            message: `玩家 ${player.nickname} 获得冠军！`
        };
    }

    // 结束游戏
    endGame(winnerId) {
        this.gameEnded = true;
        const winner = this.players.find(p => p.id === winnerId);
        
        // 创建结果数组，只包含排名、昵称和剩余牌数
        const results = this.players.map(player => {
            return {
                id: player.id,
                nickname: player.nickname,
                cardsLeft: player.hand.length,
                isWinner: player.id === winnerId
            };
        });

        // 按剩余牌数排序（牌数少的排前面，获胜者永远第一）
        results.sort((a, b) => {
            if (a.isWinner) return -1;
            if (b.isWinner) return 1;
            return a.cardsLeft - b.cardsLeft;
        });

        this.results = results;
        this.endedAt = new Date();

        // 保存游戏历史
        gameHistory.set(this.roomCode, {
            roomCode: this.roomCode,
            players: this.players.map(p => ({ id: p.id, nickname: p.nickname })),
            results: results,
            startedAt: this.createdAt,
            endedAt: this.endedAt,
            duration: this.endedAt - this.createdAt
        });
    }

    // 获取游戏状态
    getGameState(playerId) {
        const player = this.players.find(p => p.id === playerId);
        const currentPlayer = this.players[this.currentPlayerIndex];
        
        return {
            roomCode: this.roomCode,
            players: this.players.map(p => ({
                id: p.id,
                nickname: p.nickname,
                cardCount: p.hand.length,
                isCurrentPlayer: p.id === currentPlayer.id
            })),
            currentPlayer: {
                id: currentPlayer.id,
                nickname: currentPlayer.nickname
            },
            direction: this.direction,
            topCard: this.discardPile[this.discardPile.length - 1],
            deckCount: this.deck.length,
            hand: player ? player.hand : [],
            canCallUno: player ? player.hand.length === 1 : false,
            hasDrawnThisTurn: this.hasDrawnThisTurn,
            gameEnded: this.gameEnded,
            results: this.results,
            // 冠军抢夺战相关信息
            championBattle: this.championBattle,
            zeroCardPlayers: this.zeroCardPlayers.map(playerId => {
                const p = this.players.find(player => player.id === playerId);
                return p ? p.nickname : '';
            }).filter(name => name)
        };
    }

    // 管理员功能：查看所有手牌
    getAllHands() {
        return this.players.map(player => ({
            id: player.id,
            nickname: player.nickname,
            hand: player.hand
        }));
    }

    // 管理员功能：抽取指定牌（作弊模式，不受概率限制）
    adminDrawSpecific(playerId, cardSpec) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return false;

        // 首先尝试在牌堆中查找指定牌
        const cardIndex = this.deck.findIndex(card => {
            if (card.type !== cardSpec.type) return false;
            if (cardSpec.value !== undefined && card.value !== cardSpec.value) return false;
            if (cardSpec.color && card.color !== cardSpec.color) return false;
            return true;
        });

        let card;
        if (cardIndex !== -1) {
            // 如果牌堆中有该牌，直接取出
            card = this.deck.splice(cardIndex, 1)[0];
        } else {
            // 如果牌堆中没有该牌，创建一张新牌（作弊模式特权）
            card = {
                type: cardSpec.type,
                value: cardSpec.value,
                color: cardSpec.color
            };
        }

        player.hand.push(card);
        return true;
    }
}

// 房间管理类
class Room {
    constructor(roomCode, maxPlayers, hostId, hostNickname) {
        this.roomCode = roomCode;
        this.maxPlayers = maxPlayers;
        this.hostId = hostId;
        this.players = [{
            id: hostId,
            nickname: hostNickname,
            ready: false,
            isHost: true,
            socketId: null
        }];
        this.game = null;
        this.createdAt = new Date();
        this.lastActivityAt = new Date(); // 添加最后活动时间
    }

    // 添加玩家
    addPlayer(playerId, nickname, socketId) {
        if (this.players.length >= this.maxPlayers) {
            return { success: false, message: '房间已满' };
        }

        if (this.game && this.game.gameStarted) {
            return { success: false, message: '游戏已开始' };
        }

        this.players.push({
            id: playerId,
            nickname: nickname,
            ready: false,
            isHost: false,
            socketId: socketId
        });

        return { success: true };
    }

    // 移除玩家
    removePlayer(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) return false;

        const player = this.players[playerIndex];
        
        // 如果是房主离开，解散房间
        if (player.isHost) {
            return { hostLeft: true };
        }

        this.players.splice(playerIndex, 1);
        return { success: true };
    }

    // 切换准备状态
    toggleReady(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.ready = !player.ready;
            return true;
        }
        return false;
    }

    // 开始游戏
    startGame() {
        if (this.players.length < 2) {
            return { success: false, message: '至少需要2名玩家' };
        }

        if (!this.players.every(p => p.ready)) {
            return { success: false, message: '所有玩家必须准备就绪' };
        }

        this.game = new UnoGame(this.roomCode, this.maxPlayers);
        this.game.players = this.players.map(p => ({
            id: p.id,
            nickname: p.nickname,
            hand: []
        }));

        this.game.initializeDeck();
        this.game.dealCards();
        this.game.gameStarted = true;

        return { success: true };
    }

    // 更新房间活动时间
    updateActivity() {
        this.lastActivityAt = new Date();
    }

    // 获取房间状态
    getRoomState() {
        return {
            roomCode: this.roomCode,
            maxPlayers: this.maxPlayers,
            players: this.players,
            gameStarted: this.game ? this.game.gameStarted : false
        };
    }
}

// 工具函数
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function generateAdminToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Socket.io连接处理
io.on('connection', (socket) => {
    log('info', 'CONNECTION', `用户连接`, { socketId: socket.id, ip: socket.handshake.address });

    // 管理员登录
    socket.on('adminLogin', (password) => {
        const hashedPassword = hashPassword(password);
        if (hashedPassword === ADMIN_PASSWORD_HASH) {
            const token = generateAdminToken();
            adminTokens.add(token);
            socket.adminToken = token;
            socket.isAdmin = true;
            log('info', 'ADMIN', '管理员登录成功', { socketId: socket.id, ip: socket.handshake.address });
            socket.emit('adminVerified', { valid: true, token });
        } else {
            log('warn', 'ADMIN', '管理员登录失败 - 密码错误', { socketId: socket.id, ip: socket.handshake.address });
            socket.emit('error', { message: '密码错误' });
        }
    });

    // 验证管理员令牌
    socket.on('verifyAdmin', (token) => {
        const isValid = adminTokens.has(token);
        socket.isAdmin = isValid;
        socket.adminToken = isValid ? token : null;
        log('info', 'ADMIN', `管理员令牌验证${isValid ? '成功' : '失败'}`, { socketId: socket.id, tokenValid: isValid });
        socket.emit('adminVerified', { valid: isValid });
    });

    // 管理员退出
    socket.on('adminLogout', () => {
        if (socket.adminToken) {
            adminTokens.delete(socket.adminToken);
            log('info', 'ADMIN', '管理员退出登录', { socketId: socket.id });
        }
        socket.isAdmin = false;
        socket.adminToken = null;
    });

    // 创建房间
    socket.on('createRoom', (data) => {
        const roomCode = generateRoomCode();
        const playerId = uuidv4();
        
        const room = new Room(roomCode, data.maxPlayers, playerId, data.hostNickname);
        room.players[0].socketId = socket.id;
        rooms.set(roomCode, room);
        
        players.set(socket.id, { playerId, roomCode, isAdmin: data.isAdmin || false });
        socket.join(roomCode);
        
        log('info', 'ROOM', '房间创建成功', { 
            roomCode, 
            hostNickname: data.hostNickname, 
            maxPlayers: data.maxPlayers, 
            socketId: socket.id,
            playerId 
        });
        
        socket.emit('roomCreated', {
            roomCode,
            playerId,
            ...room.getRoomState()
        });
    });

    // 加入房间
    socket.on('joinRoom', (data) => {
        const room = rooms.get(data.roomCode);
        if (!room) {
            log('warn', 'ROOM', '加入房间失败 - 房间不存在', { roomCode: data.roomCode, socketId: socket.id });
            socket.emit('error', { message: '房间不存在' });
            return;
        }

        const playerId = uuidv4();
        const result = room.addPlayer(playerId, data.nickname, socket.id);
        
        if (!result.success) {
            log('warn', 'ROOM', '加入房间失败', { 
                roomCode: data.roomCode, 
                nickname: data.nickname, 
                reason: result.message, 
                socketId: socket.id 
            });
            socket.emit('error', { message: result.message });
            return;
        }

        players.set(socket.id, { playerId, roomCode: data.roomCode, isAdmin: data.isAdmin || false });
        socket.join(data.roomCode);
        
        log('info', 'ROOM', '玩家加入房间成功', { 
            roomCode: data.roomCode, 
            nickname: data.nickname, 
            playerId, 
            socketId: socket.id,
            currentPlayers: room.players.length
        });
        
        socket.emit('roomJoined', {
            roomCode: data.roomCode,
            playerId,
            ...room.getRoomState()
        });

        // 更新房间活动时间
        room.updateActivity();

        // 通知房间内其他玩家
        socket.to(data.roomCode).emit('roomUpdated', room.getRoomState());
    });

    // 重新加入房间
    socket.on('rejoinRoom', (data) => {
        const room = rooms.get(data.roomCode);
        if (!room) {
            log('warn', 'ROOM', '重新加入房间失败 - 房间不存在', { roomCode: data.roomCode, playerId: data.playerId, socketId: socket.id });
            socket.emit('error', { message: '房间不存在或已过期' });
            return;
        }

        const player = room.players.find(p => p.id === data.playerId);
        if (!player) {
            log('warn', 'ROOM', '重新加入房间失败 - 玩家不存在', { roomCode: data.roomCode, playerId: data.playerId, socketId: socket.id });
            socket.emit('error', { message: '在房间中未找到玩家' });
            return;
        }

        // 更新socket信息
        player.socketId = socket.id;
        players.set(socket.id, { playerId: data.playerId, roomCode: data.roomCode });
        socket.join(data.roomCode);

        log('info', 'ROOM', '玩家重新加入房间成功', { 
            roomCode: data.roomCode, 
            playerId: data.playerId, 
            nickname: player.nickname,
            socketId: socket.id,
            gameStarted: room.game && room.game.gameStarted
        });

        if (room.game && room.game.gameStarted) {
            socket.emit('gameStarted', room.game.getGameState(data.playerId));
        } else {
            socket.emit('roomJoined', {
                roomCode: data.roomCode,
                playerId: data.playerId,
                ...room.getRoomState()
            });
        }
    });

    // 切换准备状态
    socket.on('toggleReady', () => {
        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room) return;

        room.toggleReady(playerData.playerId);
        room.updateActivity(); // 更新房间活动时间
        io.to(playerData.roomCode).emit('roomUpdated', room.getRoomState());
    });

    // 开始游戏
    socket.on('startGame', () => {
        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room) return;

        // 检查是否为房主
        const player = room.players.find(p => p.id === playerData.playerId);
        if (!player || !player.isHost) {
            log('warn', 'GAME', '开始游戏失败 - 非房主操作', { 
                roomCode: playerData.roomCode, 
                playerId: playerData.playerId, 
                socketId: socket.id 
            });
            socket.emit('error', { message: '只有房主可以开始游戏' });
            return;
        }

        const result = room.startGame();
        if (!result.success) {
            log('warn', 'GAME', '开始游戏失败', { 
                roomCode: playerData.roomCode, 
                reason: result.message, 
                socketId: socket.id 
            });
            socket.emit('error', { message: result.message });
            return;
        }

        log('info', 'GAME', '游戏开始', { 
            roomCode: playerData.roomCode, 
            hostNickname: player.nickname,
            playerCount: room.players.length,
            players: room.players.map(p => ({ id: p.id, nickname: p.nickname }))
        });

        // 通知所有玩家游戏开始
        room.players.forEach(p => {
            const playerSocket = io.sockets.sockets.get(p.socketId);
            if (playerSocket) {
                playerSocket.emit('gameStarted', room.game.getGameState(p.id));
            }
        });
    });

    // 抽牌
    socket.on('drawCard', () => {
        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room || !room.game) return;

        const player = room.players.find(p => p.id === playerData.playerId);
        const drawnCards = room.game.drawCard(playerData.playerId);
        
        if (drawnCards) {
            log('info', 'GAME', '玩家抽牌', { 
                roomCode: playerData.roomCode, 
                playerId: playerData.playerId,
                nickname: player ? player.nickname : 'Unknown',
                cardCount: drawnCards.length,
                currentHandSize: room.game.players.find(p => p.id === playerData.playerId)?.hand.length || 0
            });
            
            // 通知所有玩家游戏状态更新
            room.players.forEach(p => {
                const playerSocket = io.sockets.sockets.get(p.socketId);
                if (playerSocket) {
                    playerSocket.emit('gameUpdated', room.game.getGameState(p.id));
                }
            });
        }
    });

    // 出牌
    socket.on('playCard', (data) => {
        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room || !room.game) return;

        const player = room.players.find(p => p.id === playerData.playerId);
        const gamePlayer = room.game.players.find(p => p.id === playerData.playerId);
        const playedCard = gamePlayer ? gamePlayer.hand[data.cardIndex] : null;
        
        const result = room.game.playCard(playerData.playerId, data.cardIndex, data.chosenColor);
        
        if (!result.success) {
            log('warn', 'GAME', '出牌失败', { 
                roomCode: playerData.roomCode, 
                playerId: playerData.playerId,
                nickname: player ? player.nickname : 'Unknown',
                cardIndex: data.cardIndex,
                reason: result.message
            });
            socket.emit('error', { message: result.message });
            return;
        }

        log('info', 'GAME', '玩家出牌', { 
            roomCode: playerData.roomCode, 
            playerId: playerData.playerId,
            nickname: player ? player.nickname : 'Unknown',
            card: playedCard,
            chosenColor: data.chosenColor,
            remainingCards: gamePlayer ? gamePlayer.hand.length : 0,
            effectType: result.effectInfo ? result.effectInfo.type : null
        });

        // 如果有特效信息，发送通知给所有玩家
        if (result.effectInfo) {
            let notificationMessage = '';
            const effectInfo = result.effectInfo;
            
            switch (effectInfo.type) {
                case 'skip':
                    notificationMessage = `${effectInfo.targetPlayer} 被跳过了回合`;
                    break;
                case 'reverse':
                    notificationMessage = '游戏方向已反转';
                    break;
                case 'draw2':
                    notificationMessage = `${effectInfo.targetPlayer} 抽了2张牌并跳过回合`;
                    break;
                case 'wild':
                    const colorNames = { 'red': '红色', 'blue': '蓝色', 'green': '绿色', 'yellow': '黄色' };
                    notificationMessage = `颜色已改变为${colorNames[effectInfo.chosenColor] || effectInfo.chosenColor}`;
                    break;
                case 'wild_draw4':
                    const colorNames4 = { 'red': '红色', 'blue': '蓝色', 'green': '绿色', 'yellow': '黄色' };
                    notificationMessage = `${effectInfo.targetPlayer} 抽了4张牌并跳过回合，颜色改变为${colorNames4[effectInfo.chosenColor] || effectInfo.chosenColor}`;
                    break;
            }
            
            if (notificationMessage) {
                room.players.forEach(p => {
                    const playerSocket = io.sockets.sockets.get(p.socketId);
                    if (playerSocket) {
                        playerSocket.emit('notification', { 
                            message: notificationMessage, 
                            type: 'info' 
                        });
                    }
                });
            }
        }

        // 检查是否进入冠军抢夺战
        if (result.championBattle) {
            // 通知所有玩家进入冠军抢夺战
            room.players.forEach(p => {
                const playerSocket = io.sockets.sockets.get(p.socketId);
                if (playerSocket) {
                    playerSocket.emit('championBattleStarted', {
                        zeroCardPlayer: result.zeroCardPlayer,
                        message: `${result.zeroCardPlayer} 手牌为0！进入冠军抢夺战！快按UNO按钮！`
                    });
                }
            });
        }

        if (result.gameEnded) {
            // 游戏结束
            room.players.forEach(p => {
                const playerSocket = io.sockets.sockets.get(p.socketId);
                if (playerSocket) {
                    playerSocket.emit('gameEnded', room.game.getGameState(p.id));
                }
            });
        } else {
            // 通知所有玩家游戏状态更新
            room.players.forEach(p => {
                const playerSocket = io.sockets.sockets.get(p.socketId);
                if (playerSocket) {
                    playerSocket.emit('gameUpdated', room.game.getGameState(p.id));
                }
            });
        }
    });

    // 喊UNO
    socket.on('callUno', (targetPlayerId = null) => {
        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room || !room.game) return;

        const player = room.players.find(p => p.id === playerData.playerId);
        const targetPlayer = targetPlayerId ? room.players.find(p => p.id === targetPlayerId) : null;

        // 检查是否在冠军抢夺战中
        if (room.game.championBattle) {
            const result = room.game.championBattleUno(playerData.playerId);
            
            log('info', 'GAME', 'Champion battle UNO called', {
                roomCode: playerData.roomCode,
                playerId: playerData.playerId,
                nickname: player?.nickname,
                gameEnded: result.gameEnded,
                hasMessage: !!result.message
            });
            
            if (result.gameEnded) {
                // 冠军抢夺战结束，游戏结束
                room.players.forEach(p => {
                    const playerSocket = io.sockets.sockets.get(p.socketId);
                    if (playerSocket) {
                        playerSocket.emit('gameEnded', room.game.getGameState(p.id));
                    }
                });
            } else {
                // 发送冠军抢夺战消息
                if (result.message) {
                    room.players.forEach(p => {
                        const playerSocket = io.sockets.sockets.get(p.socketId);
                        if (playerSocket) {
                            playerSocket.emit('gameMessage', result.message);
                        }
                    });
                }
                
                // 通知所有玩家游戏状态更新
                room.players.forEach(p => {
                    const playerSocket = io.sockets.sockets.get(p.socketId);
                    if (playerSocket) {
                        playerSocket.emit('gameUpdated', room.game.getGameState(p.id));
                    }
                });
            }
        } else {
            // 正常游戏中的UNO逻辑
            const result = room.game.callUno(playerData.playerId, targetPlayerId);
            
            log('info', 'GAME', 'UNO called', {
                roomCode: playerData.roomCode,
                playerId: playerData.playerId,
                nickname: player?.nickname,
                targetPlayerId: targetPlayerId,
                targetNickname: targetPlayer?.nickname,
                hasMessage: !!result.message
            });
            
            // 如果有消息，发送给所有玩家
            if (result.message) {
                room.players.forEach(p => {
                    const playerSocket = io.sockets.sockets.get(p.socketId);
                    if (playerSocket) {
                        playerSocket.emit('gameMessage', result.message);
                    }
                });
            }
            
            // 通知所有玩家游戏状态更新
            room.players.forEach(p => {
                const playerSocket = io.sockets.sockets.get(p.socketId);
                if (playerSocket) {
                    playerSocket.emit('gameUpdated', room.game.getGameState(p.id));
                }
            });
        }
    });

    // 跳过回合
    socket.on('skipTurn', () => {
        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room || !room.game) return;

        const player = room.players.find(p => p.id === playerData.playerId);
        const result = room.game.skipTurn(playerData.playerId);
        
        log('info', 'GAME', 'Turn skipped', {
            roomCode: playerData.roomCode,
            playerId: playerData.playerId,
            nickname: player?.nickname,
            success: result
        });
        
        if (result) {
            // 通知所有玩家游戏状态更新
            room.players.forEach(p => {
                const playerSocket = io.sockets.sockets.get(p.socketId);
                if (playerSocket) {
                    playerSocket.emit('gameUpdated', room.game.getGameState(p.id));
                }
            });
        }
    });

    // 催促玩家
    socket.on('urgePlayer', () => {
        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room || !room.game) return;

        // 检查游戏是否已开始
        if (!room.game.gameStarted || room.game.gameEnded) {
            return;
        }

        // 获取催促者的昵称
        const urgerPlayer = room.players.find(p => p.id === playerData.playerId);
        if (!urgerPlayer) return;

        // 获取当前应该出牌的玩家
        const currentPlayer = room.game.players[room.game.currentPlayerIndex];
        if (!currentPlayer) return;

        // 不能催促自己
        if (currentPlayer.id === playerData.playerId) {
            log('warn', 'GAME', 'Player tried to urge themselves', {
                roomCode: playerData.roomCode,
                playerId: playerData.playerId,
                nickname: urgerPlayer.nickname
            });
            return;
        }

        // 找到当前玩家的socket并发送催促事件
        const currentPlayerData = room.players.find(p => p.id === currentPlayer.id);
        if (currentPlayerData) {
            const currentPlayerSocket = io.sockets.sockets.get(currentPlayerData.socketId);
            if (currentPlayerSocket) {
                currentPlayerSocket.emit('playerUrged', {
                    urgerName: urgerPlayer.nickname
                });
                
                log('info', 'GAME', 'Player urged another player', {
                    roomCode: playerData.roomCode,
                    urgerPlayerId: playerData.playerId,
                    urgerNickname: urgerPlayer.nickname,
                    targetPlayerId: currentPlayer.id,
                    targetNickname: currentPlayerData.nickname
                });
            }
        }
    });

    // 离开房间
    socket.on('leaveRoom', () => {
        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room) return;

        const player = room.players.find(p => p.id === playerData.playerId);
        const result = room.removePlayer(playerData.playerId);
        
        if (result.hostLeft) {
            // 房主离开，通知所有玩家并解散房间
            log('info', 'ROOM', 'Host left room, room disbanded', {
                roomCode: playerData.roomCode,
                hostPlayerId: playerData.playerId,
                hostNickname: player?.nickname,
                remainingPlayers: room.players.length
            });
            io.to(playerData.roomCode).emit('hostLeft');
            rooms.delete(playerData.roomCode);
        } else {
            // 通知其他玩家
            log('info', 'ROOM', 'Player left room', {
                roomCode: playerData.roomCode,
                playerId: playerData.playerId,
                nickname: player?.nickname,
                remainingPlayers: room.players.length
            });
            socket.to(playerData.roomCode).emit('roomUpdated', room.getRoomState());
        }

        socket.leave(playerData.roomCode);
        players.delete(socket.id);
    });

    // 管理员功能：查看所有手牌
    socket.on('adminViewHands', () => {
        if (!socket.isAdmin) {
            socket.emit('error', { message: '需要管理员权限' });
            return;
        }

        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room || !room.game) return;

        const allHands = room.game.getAllHands();
        socket.emit('adminHandsData', allHands);
    });

    // 管理员功能：抽取指定牌
    socket.on('adminDrawSpecific', (cardSpec) => {
        if (!socket.isAdmin) {
            log('warn', 'ADMIN', 'Unauthorized admin draw attempt', {
                socketId: socket.id,
                ip: socket.handshake.address,
                cardSpec: cardSpec
            });
            socket.emit('error', { message: '需要管理员权限' });
            return;
        }

        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room || !room.game) return;

        const player = room.players.find(p => p.id === playerData.playerId);
        const success = room.game.adminDrawSpecific(playerData.playerId, cardSpec);
        
        log('info', 'ADMIN', 'Admin draw specific card', {
            roomCode: playerData.roomCode,
            adminPlayerId: playerData.playerId,
            adminNickname: player?.nickname,
            cardSpec: cardSpec,
            success: success
        });
        
        if (success) {
            // 通知所有玩家游戏状态更新
            room.players.forEach(p => {
                const playerSocket = io.sockets.sockets.get(p.socketId);
                if (playerSocket) {
                    playerSocket.emit('gameUpdated', room.game.getGameState(p.id));
                }
            });
        } else {
            socket.emit('error', { message: '牌堆中未找到指定卡牌' });
        }
    });

    // 管理员功能：获取所有活跃游戏
    socket.on('getActiveGames', () => {
        if (!socket.isAdmin) {
            log('warn', 'ADMIN', 'Unauthorized active games request', {
                socketId: socket.id,
                ip: socket.handshake.address
            });
            socket.emit('error', { message: '需要管理员权限' });
            return;
        }

        const activeGames = Array.from(rooms.values()).map(room => ({
            roomCode: room.roomCode,
            playerCount: room.players.length,
            maxPlayers: room.maxPlayers,
            gameStarted: room.game ? room.game.gameStarted : false,
            createdAt: room.createdAt
        }));

        log('info', 'ADMIN', 'Active games data requested', {
            socketId: socket.id,
            gameCount: activeGames.length,
            totalPlayers: activeGames.reduce((sum, game) => sum + game.playerCount, 0)
        });

        socket.emit('activeGamesData', activeGames);
    });

    // 断开连接处理
    socket.on('disconnect', () => {
        const playerData = players.get(socket.id);
        const ip = socket.handshake.address;
        
        // 记录基本断开连接信息
        log('info', 'CONNECTION', 'User disconnected', {
            socketId: socket.id,
            ip: ip,
            hasPlayerData: !!playerData
        });
        
        if (playerData) {
            const room = rooms.get(playerData.roomCode);
            if (room) {
                const player = room.players.find(p => p.id === playerData.playerId);
                if (player) {
                    // 如果游戏正在进行中（不管是否为房主），都终止游戏
                    if (room.game && room.game.gameStarted && !room.game.gameEnded) {
                        // 通知所有玩家有人离开，游戏结束
                        room.players.forEach(p => {
                            if (p.socketId && p.socketId !== socket.id) {
                                const playerSocket = io.sockets.sockets.get(p.socketId);
                                if (playerSocket) {
                                    playerSocket.emit('playerLeft', { 
                                        playerName: player.nickname,
                                        message: `${player.nickname} 离开了游戏，比赛终止`
                                    });
                                }
                            }
                        });
                        
                        // 删除房间
                        rooms.delete(playerData.roomCode);
                        log('warn', 'ROOM', 'Room terminated due to player disconnect during game', {
                            roomCode: playerData.roomCode,
                            playerNickname: player.nickname,
                            playerId: playerData.playerId,
                            isHost: player.isHost
                        });
                    } else {
                        // 游戏未开始，只标记为离线，不删除房间
                        if (player.isHost) {
                            // 房主在准备阶段断连，标记为离线但不删除房间
                            player.socketId = null;
                            log('info', 'ROOM', 'Host disconnected in preparation phase, room preserved', {
                                roomCode: playerData.roomCode,
                                hostNickname: player.nickname,
                                playerId: playerData.playerId
                            });
                            
                            // 通知其他玩家房主已断连
                            room.players.forEach(p => {
                                if (p.socketId && p.socketId !== socket.id) {
                                    const playerSocket = io.sockets.sockets.get(p.socketId);
                                    if (playerSocket) {
                                        playerSocket.emit('roomUpdated', room.getRoomState());
                                    }
                                }
                            });
                        } else {
                            // 非房主在准备阶段离开，移除玩家
                            room.removePlayer(playerData.playerId);
                            log('info', 'ROOM', 'Player left room during preparation phase', {
                                roomCode: playerData.roomCode,
                                playerNickname: player.nickname,
                                playerId: playerData.playerId,
                                remainingPlayers: room.players.length
                            });
                            
                            // 通知其他玩家更新房间状态
                            room.players.forEach(p => {
                                if (p.socketId) {
                                    const playerSocket = io.sockets.sockets.get(p.socketId);
                                    if (playerSocket) {
                                        playerSocket.emit('roomUpdated', room.getRoomState());
                                    }
                                }
                            });
                        }
                    }
                }
            }
        }

        // 清理玩家数据
        players.delete(socket.id);

        // 清理管理员令牌
        if (socket.adminToken) {
            adminTokens.delete(socket.adminToken);
            log('info', 'ADMIN', 'Admin token cleaned on disconnect', {
                socketId: socket.id,
                token: socket.adminToken.substring(0, 8) + '...'
            });
        }
    });

    // Socket错误处理
    socket.on('error', (error) => {
        log('error', 'SOCKET', 'Socket连接错误', {
            socketId: socket.id,
            ip: socket.handshake.address,
            error: error.message,
            stack: error.stack
        });
    });
});

// IO服务器错误处理
io.on('error', (error) => {
    log('error', 'IO', 'Socket.IO服务器错误', {
        error: error.message,
        stack: error.stack
    });
});

// 定期清理过期房间
setInterval(() => {
    const now = new Date();
    const expireTime = 24 * 60 * 60 * 1000; // 24小时
    const inactiveTime = 10 * 60 * 1000; // 10分钟无活动

    for (const [roomCode, room] of rooms.entries()) {
        // 清理超过24小时的房间
        if (now - room.createdAt > expireTime) {
            rooms.delete(roomCode);
            log('info', 'CLEANUP', 'Cleaned up expired room (24h)', {
                roomCode: roomCode,
                createdAt: room.createdAt,
                lastActivityAt: room.lastActivityAt
            });
        }
        // 清理准备阶段超过10分钟无活动的房间
        else if (!room.game || !room.game.gameStarted) {
            if (now - room.lastActivityAt > inactiveTime) {
                // 通知房间内所有玩家房间因无活动被清理
                room.players.forEach(p => {
                    if (p.socketId) {
                        const playerSocket = io.sockets.sockets.get(p.socketId);
                        if (playerSocket) {
                            playerSocket.emit('roomCleaned', { 
                                message: '房间因长时间无活动已被清理'
                            });
                        }
                    }
                });
                
                rooms.delete(roomCode);
                log('info', 'CLEANUP', 'Cleaned up inactive room (10min)', {
                    roomCode: roomCode,
                    createdAt: room.createdAt,
                    lastActivityAt: room.lastActivityAt,
                    playerCount: room.players.length
                });
            }
        }
    }
}, 5 * 60 * 1000); // 每5分钟检查一次

// 启动服务器
// 全局错误处理
process.on('uncaughtException', (error) => {
    log('error', 'PROCESS', '未捕获的异常', {
        error: error.message,
        stack: error.stack
    });
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log('error', 'PROCESS', '未处理的Promise拒绝', {
        reason: reason?.message || reason,
        stack: reason?.stack,
        promise: promise.toString()
    });
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // 支持外部访问

server.listen(PORT, HOST, () => {
    log('info', 'SERVER', '服务器启动成功', { 
        host: HOST, 
        port: PORT, 
        localAccess: `http://localhost:${PORT}`,
        externalAccess: HOST === '0.0.0.0' ? `http://[your-server-ip]:${PORT}` : null
    });
    console.log(`UNO Online Server running on ${HOST}:${PORT}`);
    console.log(`Local access: http://localhost:${PORT}`);
    if (HOST === '0.0.0.0') {
        console.log(`External access: http://[your-server-ip]:${PORT}`);
        console.log(`Note: Make sure firewall allows port ${PORT}`);
    }
}).on('error', (err) => {
    log('error', 'SERVER', '服务器启动失败', { 
        error: err.message, 
        code: err.code, 
        host: HOST, 
        port: PORT 
    });
    console.error('Server failed to start:', err);
    process.exit(1);
});