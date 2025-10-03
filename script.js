// UNO Online Game - 前端JavaScript
// 全局变量
let socket;
let currentLanguage = 'zh';
let isAdmin = false;
let adminToken = null;
let currentRoom = null;
let currentPlayer = null;
let gameState = null;

// 催促功能相关变量
let urgeCooldownTimer = null;
let urgeRemainingTime = 0;

// 多语言支持
const translations = {
    zh: {
        // 基础界面
        'Admin Login': '管理员登录',
        'Logout': '退出管理',
        'Admin Mode': '管理员模式',
        'Create Room': '创建房间',
        'Join Room': '加入房间',
        'Game Rules': '游戏规则',
        'Admin Panel': '管理面板',
        'Back': '返回',
        'Loading...': '加载中...',
        
        // 房间相关
        'Players:': '房间人数:',
        'Your Nickname:': '您的昵称:',
        'Room Code:': '房间码:',
        'Room': '房间',
        'Players': '玩家列表',
        'Ready': '准备',
        'Start Game': '开始游戏',
        'Leave Room': '离开房间',
        
        // 游戏相关
        'Current Player:': '当前玩家:',
        'Direction:': '方向:',
        'Cards Left:': '牌堆剩余:',
        'Your Cards': '您的手牌',
        'Draw Card': '抽牌',
        'UNO!': 'UNO!',
        'Game Over': '游戏结束',
        'Back to Home': '返回首页',
        
        // 管理员
        'Admin Cheat Panel': '管理员作弊面板',
        'View All Hands': '查看所有手牌',
        'Draw Specific Card': '抽取指定牌',
        'Active Games': '正在进行的游戏',
        
        // 提示信息
        'Please enter nickname': '请输入昵称',
        'Please enter room code': '请输入房间码',
        'Please enter admin password': '请输入管理员密码',
        'Invalid password': '密码错误',
        'Admin login successful': '管理员登录成功',
        'Room created successfully': '房间创建成功',
        'Joined room successfully': '加入房间成功',
        'Room not found': '房间不存在',
        'Room is full': '房间已满',
        'Game already started': '游戏已开始',
        'Host left, game terminated': '房主已退出，游戏终止',
        'Player left, game terminated': '玩家 {player} 已退出，游戏终止',
        'Connection lost': '连接断开',
        'Reconnected': '重新连接成功',
        'All Players Hands': '所有玩家手牌',
        'No active games': '暂无活跃游戏',
        'players': '玩家',
        'In Progress': '进行中',
        'Waiting': '等待中',
        'Created': '创建时间',
        'Choose Color': '选择颜色',
        'Card Type': '卡牌类型',
        'Number': '数字',
        'Color': '颜色',
        'Draw Card': '抽牌',
        'Final Results': '最终结果',
        'points': '分',
        'cards': '张牌',
        'Cannot play this card': '无法出这张牌',
        'Invalid card': '无效的卡牌',
        'Card not found in deck': '牌堆中未找到指定卡牌',
        'Not Ready': '未准备',
        'Cancel Ready': '取消准备',
        'Reconnecting...': '重新连接中...',
        'Invalid player count': '人数设置无效',
        'Room code copied': '房间码已复制',
        'Copy failed': '复制失败',
        'Manual Copy': '手动复制',
        'Please manually copy the room code:': '请手动复制房间码：',
        'Close': '关闭',
        'You': '您',
        'Not your turn': '还没轮到您',
        "It's your turn!": '轮到您出牌了！',
        'Skip Turn': '跳过回合',
        'Now it\'s your turn': '现在轮到你出牌',
        'You are skipped!': '你被禁止出牌了！',
        'Direction reversed!': '顺序倒转！',
        'Draw 2 cards!': '抽2张牌！',
        'Draw 4 cards!': '抽4张牌！',
        'Color changed!': '颜色改变！',
        'All players': '所有玩家',
        'Next player': '下一位玩家',
        'Champion Battle!': '冠军抢夺战！',
        'Champion Battle Started': '冠军抢夺战开始',
        'Quick! Press UNO button!': '快！按UNO按钮！',
        'Champion Battle in Progress': '冠军抢夺战进行中',
        'Zero card players:': '手牌为0的玩家：',
        'UNO button is only available during Champion Battle': 'UNO按钮仅在冠军争夺战中可用',
        'Click to win!': '点击获胜！',
        'Urge': '催',
        'is urging you': '正在催你',
        'Urge cooldown': '催促冷却中',
        'Joining room from URL...': '正在从URL加入房间...',
        'Room not found or game already started': '房间不存在或游戏已开始',
        'Redirecting to home page...': '正在返回首页...',
        'Share': '分享',
        'Share room link': '分享房间链接',
        'Room link copied': '房间链接已复制',
        'Share failed': '分享失败',
        'Manual Share': '手动分享',
        'Please manually copy the room link:': '请手动复制房间链接：',
        'Room code auto-filled from URL': '已从链接自动填写房间号',
        'Room cleaned due to inactivity': '房间因长时间无活动被清理',
        'Complete Rankings': '完整排名',
        'Rank': '名次',
        'Nickname': '昵称',
        'Cards Left': '剩余手牌'
    },
    en: {
        // 基础界面
        'Admin Login': 'Admin Login',
        'Logout': 'Logout',
        'Admin Mode': 'Admin Mode',
        'Create Room': 'Create Room',
        'Join Room': 'Join Room',
        'Game Rules': 'Game Rules',
        'Admin Panel': 'Admin Panel',
        'Back': 'Back',
        'Loading...': 'Loading...',
        
        // 房间相关
        'Players:': 'Players:',
        'Your Nickname:': 'Your Nickname:',
        'Room Code:': 'Room Code:',
        'Room': 'Room',
        'Players': 'Players',
        'Ready': 'Ready',
        'Start Game': 'Start Game',
        'Leave Room': 'Leave Room',
        
        // 游戏相关
        'Current Player:': 'Current Player:',
        'Direction:': 'Direction:',
        'Cards Left:': 'Cards Left:',
        'Your Cards': 'Your Cards',
        'Draw Card': 'Draw Card',
        'UNO!': 'UNO!',
        'Game Over': 'Game Over',
        'Back to Home': 'Back to Home',
        
        // 管理员
        'Admin Cheat Panel': 'Admin Cheat Panel',
        'View All Hands': 'View All Hands',
        'Draw Specific Card': 'Draw Specific Card',
        'Active Games': 'Active Games',
        
        // 提示信息
        'Please enter nickname': 'Please enter nickname',
        'Please enter room code': 'Please enter room code',
        'Please enter admin password': 'Please enter admin password',
        'Invalid password': 'Invalid password',
        'Admin login successful': 'Admin login successful',
        'Room created successfully': 'Room created successfully',
        'Joined room successfully': 'Joined room successfully',
        'Room not found': 'Room not found',
        'Room is full': 'Room is full',
        'Game already started': 'Game already started',
        'Host left, game terminated': 'Host left, game terminated',
        'Player left, game terminated': 'Player {player} left, game terminated',
        'Connection lost': 'Connection lost',
        'Reconnected': 'Reconnected',
        'All Players Hands': 'All Players Hands',
        'No active games': 'No active games',
        'players': 'players',
        'In Progress': 'In Progress',
        'Waiting': 'Waiting',
        'Created': 'Created',
        'Choose Color': 'Choose Color',
        'Card Type': 'Card Type',
        'Number': 'Number',
        'Color': 'Color',
        'Draw Card': 'Draw Card',
        'Final Results': 'Final Results',
        'points': 'points',
        'cards': 'cards',
        'Cannot play this card': 'Cannot play this card',
        'Invalid card': 'Invalid card',
        'Card not found in deck': 'Card not found in deck',
        'Not Ready': 'Not Ready',
        'Cancel Ready': 'Cancel Ready',
        'Reconnecting...': 'Reconnecting...',
        'Invalid player count': 'Invalid player count',
        'Room code copied': 'Room code copied',
        'Copy failed': 'Copy failed',
        'Manual Copy': 'Manual Copy',
        'Please manually copy the room code:': 'Please manually copy the room code:',
        'Close': 'Close',
        'You': 'You',
        'Not your turn': 'Not your turn',
        "It's your turn!": "It's your turn!",
        'Skip Turn': 'Skip Turn',
        'Now it\'s your turn': 'Now it\'s your turn',
        'You are skipped!': 'You are skipped!',
        'Direction reversed!': 'Direction reversed!',
        'Draw 2 cards!': 'Draw 2 cards!',
        'Draw 4 cards!': 'Draw 4 cards!',
        'Color changed!': 'Color changed!',
        'All players': 'All players',
        'Next player': 'Next player',
        'Champion Battle!': 'Champion Battle!',
        'Champion Battle Started': 'Champion Battle Started',
        'Quick! Press UNO button!': 'Quick! Press UNO button!',
        'Champion Battle in Progress': 'Champion Battle in Progress',
        'Zero card players:': 'Zero card players:',
        'UNO button is only available during Champion Battle': 'UNO button is only available during Champion Battle',
        'Click to win!': 'Click to win!',
        'Urge': 'Urge',
        'is urging you': 'is urging you',
        'Urge cooldown': 'Urge cooldown',
        'Joining room from URL...': 'Joining room from URL...',
        'Room not found or game already started': 'Room not found or game already started',
        'Redirecting to home page...': 'Redirecting to home page...',
        'Share': 'Share',
        'Share room link': 'Share room link',
        'Room link copied': 'Room link copied',
        'Share failed': 'Share failed',
        'Manual Share': 'Manual Share',
        'Please manually copy the room link:': 'Please manually copy the room link:',
        'Room code auto-filled from URL': 'Room code auto-filled from URL',
        'Room cleaned due to inactivity': 'Room cleaned due to inactivity',
        'Complete Rankings': 'Complete Rankings',
        'Rank': 'Rank',
        'Nickname': 'Nickname',
        'Cards Left': 'Cards Left'
    }
};

// 游戏规则内容
const gameRules = {
    zh: `
        <h4>UNO游戏规则</h4>
        <h4>游戏目标</h4>
        <p>成为第一个打完所有手牌的玩家。</p>
        
        <h4>游戏准备</h4>
        <ul>
            <li>每位玩家发7张牌</li>
            <li>剩余牌作为抽牌堆</li>
            <li>翻开一张<strong>数字牌</strong>作为弃牌堆的起始牌（不会是功能牌）</li>
        </ul>
        
        <h4>游戏流程</h4>
        <ul>
            <li>玩家轮流出牌，必须与弃牌堆顶牌颜色或数字相同</li>
            <li>如果无法出牌，必须从抽牌堆抽一张牌</li>
            <li>抽到的牌如果可以出，可以立即打出</li>
            <li>当有玩家手牌为0时，自动进入冠军争夺战</li>
        </ul>
        
        <h4>特殊牌</h4>
        <ul>
            <li><strong>⊘ 跳过牌(Skip):</strong> 下一位玩家跳过回合</li>
            <li><strong>⟲ 反转牌(Reverse):</strong> 改变游戏方向</li>
            <li><strong>+2 加二牌:</strong> 下一位玩家抽2张牌并跳过回合</li>
            <li><strong>🌈 变色牌(Wild):</strong> 可以改变颜色</li>
            <li><strong>+4 加四变色牌:</strong> 下一位玩家抽4张牌，跳过回合，并改变颜色</li>
        </ul>
        
        <h4>🎯 冠军争夺战机制</h4>
        <ul>
            <li><strong>触发条件：</strong>当有玩家手牌为0时，自动进入冠军争夺战</li>
            <li><strong>UNO按钮：</strong>只在冠军争夺战阶段显示，平时隐藏</li>
            <li><strong>竞争规则：</strong>所有手牌为0的玩家需要快速点击"UNO!"按钮</li>
            <li><strong>获胜判定：</strong>最先点击UNO按钮的玩家获得冠军</li>
            <li><strong>视觉提示：</strong>冠军争夺战期间会有特殊的动画和提示</li>
        </ul>
        
        <h4>⚖️ 游戏平衡</h4>
        <ul>
            <li><strong>特殊牌数量：</strong>功能牌和万能牌数量已优化，减少过度随机性</li>
            <li><strong>牌堆构成：</strong>数字牌占主导地位，特殊牌比例约17.4%</li>
            <li><strong>房主保护：</strong>房主断开连接时游戏会自动结束，避免僵尸房间</li>
        </ul>
    `,
    en: `
        <h4>UNO Game Rules</h4>
        <h4>Objective</h4>
        <p>Be the first player to play all your cards.</p>
        
        <h4>Setup</h4>
        <ul>
            <li>Each player is dealt 7 cards</li>
            <li>Remaining cards form the draw pile</li>
            <li>A <strong>number card</strong> is flipped to start the discard pile (never an action card)</li>
        </ul>
        
        <h4>Gameplay</h4>
        <ul>
            <li>Players take turns playing cards that match the top card by color or number</li>
            <li>If unable to play, draw a card from the draw pile</li>
            <li>If the drawn card can be played, it may be played immediately</li>
            <li>When any player reaches 0 cards, Champion Battle begins automatically</li>
        </ul>
        
        <h4>Special Cards</h4>
        <ul>
            <li><strong>⊘ Skip:</strong> Next player loses their turn</li>
            <li><strong>⟲ Reverse:</strong> Changes direction of play</li>
            <li><strong>+2 Draw Two:</strong> Next player draws 2 cards and loses their turn</li>
            <li><strong>🌈 Wild:</strong> Can change the color</li>
            <li><strong>+4 Wild Draw Four:</strong> Next player draws 4 cards, loses turn, and color changes</li>
        </ul>
        
        <h4>🎯 Champion Battle Mechanism</h4>
        <ul>
            <li><strong>Trigger Condition:</strong> When any player reaches 0 cards, Champion Battle begins</li>
            <li><strong>UNO Button:</strong> Only appears during Champion Battle phase, hidden during normal play</li>
            <li><strong>Competition Rules:</strong> All players with 0 cards must quickly click "UNO!" button</li>
            <li><strong>Victory Condition:</strong> First player to click UNO button becomes the champion</li>
            <li><strong>Visual Feedback:</strong> Special animations and notifications during Champion Battle</li>
        </ul>
        
        <h4>⚖️ Game Balance</h4>
        <ul>
            <li><strong>Special Card Count:</strong> Action and wild cards optimized to reduce excessive randomness</li>
            <li><strong>Deck Composition:</strong> Number cards dominate, special cards comprise ~17.4%</li>
            <li><strong>Host Protection:</strong> Game ends automatically if host disconnects, preventing zombie rooms</li>
        </ul>
    `
};

// 初始化函数
function init() {
    // 检查管理员登录状态
    checkAdminStatus();
    
    // 初始化Socket连接
    initSocket();
    
    // 绑定事件监听器
    bindEventListeners();
    
    // 设置语言
    setLanguage(currentLanguage);
    
    // 检查URL是否包含房间号
    checkUrlForRoomCode();
    
    // 检查是否有保存的游戏状态
    checkGameState();
}

// 检查管理员状态
function checkAdminStatus() {
    adminToken = localStorage.getItem('adminToken');
    if (adminToken) {
        isAdmin = true;
        updateAdminUI();
    }
}

// 初始化Socket连接
function initSocket() {
    socket = io();
    
    // 连接事件
    socket.on('connect', () => {
        console.log('Connected to server');
        hideLoading();
        
        // 如果有管理员token，验证它
        if (adminToken) {
            socket.emit('verifyAdmin', adminToken);
        }
        
        // 如果有保存的房间信息，尝试重新连接
        const savedRoom = localStorage.getItem('currentRoom');
        const savedPlayer = localStorage.getItem('currentPlayer');
        if (savedRoom && savedPlayer) {
            socket.emit('rejoinRoom', {
                roomCode: savedRoom,
                playerId: savedPlayer
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        showNotification(t('Connection lost'), 'error');
    });
    
    socket.on('reconnect', () => {
        showNotification(t('Reconnected'), 'success');
    });
    
    // 管理员相关事件
    socket.on('adminVerified', (data) => {
        hideLoading(); // 隐藏加载动画
        isAdmin = data.valid;
        if (isAdmin) {
            if (data.token) {
                adminToken = data.token;
                localStorage.setItem('adminToken', adminToken);
            }
            updateAdminUI();
            showNotification(t('Admin login successful'), 'success');
        } else {
            localStorage.removeItem('adminToken');
            adminToken = null;
            updateAdminUI();
            showNotification(t('Invalid password'), 'error');
        }
    });

    // 管理员查看手牌数据
    socket.on('adminHandsData', (handsData) => {
        showAdminHandsModal(handsData);
    });

    // 活跃游戏数据
    socket.on('activeGamesData', (gamesData) => {
        updateActiveGamesList(gamesData);
    });
    
    // 房间相关事件
    socket.on('roomCreated', (data) => {
        hideLoading(); // 隐藏加载动画
        currentRoom = data.roomCode;
        currentPlayer = data.playerId;
        localStorage.setItem('currentRoom', currentRoom);
        localStorage.setItem('currentPlayer', currentPlayer);
        showPage('room-page');
        updateRoomUI(data);
        showNotification(t('Room created successfully'), 'success');
    });
    
    socket.on('roomJoined', (data) => {
        hideLoading(); // 隐藏加载动画
        currentRoom = data.roomCode;
        currentPlayer = data.playerId;
        localStorage.setItem('currentRoom', currentRoom);
        localStorage.setItem('currentPlayer', currentPlayer);
        showPage('room-page');
        updateRoomUI(data);
        showNotification(t('Joined room successfully'), 'success');
    });
    
    socket.on('roomUpdated', (data) => {
        updateRoomUI(data);
    });
    
    socket.on('gameStarted', (data) => {
        gameState = data;
        showPage('game-page');
        updateGameUI(data);
    });
    
    socket.on('gameUpdated', (data) => {
        gameState = data;
        updateGameUI(data);
    });
    
    socket.on('gameMessage', (message) => {
        showNotification(message, 'info');
    });
    
    // 监听通知消息
    socket.on('notification', (data) => {
        showNotification(data.message, data.type || 'info');
    });
    
    socket.on('gameEnded', (data) => {
        showPage('game-end-page');
        updateGameEndUI(data);
        // 清除保存的游戏状态
        localStorage.removeItem('currentRoom');
        localStorage.removeItem('currentPlayer');
    });

    // 冠军抢夺战开始
    socket.on('championBattleStarted', (data) => {
        showChampionBattleNotification(data);
    });
    
    socket.on('hostLeft', () => {
        showNotification(t('Host left, game terminated'), 'error');
        setTimeout(() => {
            showPage('home-page');
            localStorage.removeItem('currentRoom');
            localStorage.removeItem('currentPlayer');
        }, 3000);
    });

    // 处理玩家在游戏中断开连接的事件
    socket.on('playerLeft', (data) => {
        showNotification(t('Player left, game terminated').replace('{player}', data.playerName), 'error');
        setTimeout(() => {
            showPage('home-page');
            localStorage.removeItem('currentRoom');
            localStorage.removeItem('currentPlayer');
        }, 3000);
    });
    
    // 催促事件监听
    socket.on('playerUrged', (data) => {
        // 播放音效
        const audio = new Audio('/sound.ogg');
        audio.volume = 0.3; // 30%音量
        audio.play().catch(err => console.log('音效播放失败:', err));
        
        // 显示催促通知
        showNotification(`${data.urgerName} ${t('is urging you')}`, 'warning');
    });
    
    // 房间被清理事件
    socket.on('roomCleaned', (data) => {
        showNotification(t('Room cleaned due to inactivity'), 'warning');
        setTimeout(() => {
            showPage('home-page');
            localStorage.removeItem('currentRoom');
            localStorage.removeItem('currentPlayer');
        }, 3000);
    });
    
    // 错误处理
    socket.on('error', (data) => {
        showNotification(t(data.message), 'error');
        hideLoading();
    });
}

// 绑定事件监听器
function bindEventListeners() {
    // 语言切换
    document.getElementById('lang-zh').addEventListener('click', () => setLanguage('zh'));
    document.getElementById('lang-en').addEventListener('click', () => setLanguage('en'));
    
    // 管理员登录/退出
    document.getElementById('admin-login-btn').addEventListener('click', showAdminLogin);
    document.getElementById('admin-logout-btn').addEventListener('click', adminLogout);
    
    // 主菜单按钮
    document.getElementById('create-room-btn').addEventListener('click', () => showPage('create-room-page'));
    document.getElementById('join-room-btn').addEventListener('click', () => showPage('join-room-page'));
    document.getElementById('rules-btn').addEventListener('click', showRules);
    document.getElementById('admin-panel-btn').addEventListener('click', () => showPage('admin-panel-page'));
    
    // 创建房间
    document.getElementById('confirm-create-btn').addEventListener('click', createRoom);
    document.getElementById('back-from-create-btn').addEventListener('click', () => showPage('home-page'));
    
    // 人数选择加减按钮
    document.getElementById('decrease-players').addEventListener('click', () => {
        const input = document.getElementById('player-count');
        const currentValue = parseInt(input.value);
        if (currentValue > 2) {
            input.value = currentValue - 1;
            // 添加点击动画效果
            input.style.transform = 'scale(1.1)';
            setTimeout(() => {
                input.style.transform = 'scale(1)';
            }, 150);
        }
    });
    
    document.getElementById('increase-players').addEventListener('click', () => {
        const input = document.getElementById('player-count');
        const currentValue = parseInt(input.value);
        if (currentValue < 10) {
            input.value = currentValue + 1;
            // 添加点击动画效果
            input.style.transform = 'scale(1.1)';
            setTimeout(() => {
                input.style.transform = 'scale(1)';
            }, 150);
        }
    });
    
    // 加入房间
    document.getElementById('confirm-join-btn').addEventListener('click', joinRoom);
    document.getElementById('back-from-join-btn').addEventListener('click', () => showPage('home-page'));
    
    // 房间控制
    document.getElementById('ready-btn').addEventListener('click', toggleReady);
    document.getElementById('start-game-btn').addEventListener('click', startGame);
    document.getElementById('leave-room-btn').addEventListener('click', leaveRoom);
    document.getElementById('copy-room-code-btn').addEventListener('click', copyRoomCode);
    document.getElementById('share-room-btn').addEventListener('click', shareRoomLink);
    
    // 游戏控制
    document.getElementById('draw-card-btn').addEventListener('click', drawCard);
    document.getElementById('uno-btn').addEventListener('click', callUno);
    document.getElementById('skip-turn-btn').addEventListener('click', skipTurn);
    document.getElementById('urge-btn').addEventListener('click', urgePlayer);
    
    // 管理员作弊功能
    document.getElementById('view-all-hands').addEventListener('click', viewAllHands);
    document.getElementById('draw-specific-card').addEventListener('click', drawSpecificCard);
    
    // 游戏结束
    document.getElementById('back-to-home-btn').addEventListener('click', () => showPage('home-page'));
    
    // 返回按钮
    document.getElementById('back-from-admin-btn').addEventListener('click', () => showPage('home-page'));
    document.getElementById('back-from-rules-btn').addEventListener('click', () => showPage('home-page'));
    
    // 模态框关闭
    document.querySelector('.close').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('modal')) {
            closeModal();
        }
    });
    
    // 键盘事件
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

// 语言设置
function setLanguage(lang) {
    currentLanguage = lang;
    
    // 更新语言按钮状态
    document.querySelectorAll('.lang-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`lang-${lang}`).classList.add('active');
    
    // 更新所有文本
    document.querySelectorAll('[data-zh]').forEach(element => {
        const key = element.getAttribute(`data-${lang}`);
        if (key) {
            // 如果是菜单按钮，只更新btn-text部分
            if (element.classList.contains('menu-btn')) {
                const btnText = element.querySelector('.btn-text');
                if (btnText) {
                    btnText.textContent = key;
                }
            } else {
                element.textContent = key;
            }
        }
    });
    
    // 更新title属性
    document.querySelectorAll('[data-zh-title]').forEach(element => {
        if (lang === 'zh') {
            element.title = element.getAttribute('data-zh-title');
        } else {
            element.title = element.getAttribute('data-en-title');
        }
    });
    
    // 更新规则内容
    if (document.getElementById('rules-content').innerHTML) {
        document.getElementById('rules-content').innerHTML = gameRules[lang];
    }
    
    // 更新HTML语言属性
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}

// 翻译函数
function t(key) {
    return translations[currentLanguage][key] || key;
}

// 页面显示控制
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
}

// 显示/隐藏加载动画
function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

// 通知系统
function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type} show`;
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// 显示冠军抢夺战通知
function showChampionBattleNotification(data) {
    // 创建特殊的冠军抢夺战通知弹窗
    const notification = document.createElement('div');
    notification.className = 'champion-battle-notification';
    notification.id = 'champion-battle-modal';
    notification.innerHTML = `
        <div class="champion-battle-content">
            <h3>${t('Champion Battle!')}</h3>
            <p>${t('Champion Battle Started')}</p>
            <p>${t('Zero card players:')} ${data.zeroCardPlayer}</p>
            <p class="champion-battle-action">${t('Quick! Press UNO button!')}</p>
            
            <!-- 集成的UNO按钮 -->
            <div class="champion-battle-uno-section">
                <button id="champion-uno-btn" class="champion-uno-button">
                    <span class="uno-text">UNO!</span>
                    <span class="uno-subtitle">${t('Click to win!')}</span>
                </button>
            </div>
        </div>
    `;
    
    // 添加样式
    notification.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #FFD700, #FF8C00);
        color: #000;
        padding: 25px;
        border-radius: 20px;
        box-shadow: 0 0 40px rgba(255, 215, 0, 0.9);
        z-index: 10000;
        text-align: center;
        font-weight: bold;
        animation: championBattleAppear 0.5s ease-out;
        border: 4px solid #FFA500;
        min-width: 350px;
    `;
    
    document.body.appendChild(notification);
    
    // 为弹窗中的UNO按钮绑定点击事件
    const championUnoBtn = document.getElementById('champion-uno-btn');
    if (championUnoBtn) {
        championUnoBtn.addEventListener('click', () => {
            // 调用原有的callUno函数
            callUno();
            
            // 添加点击反馈动画
            championUnoBtn.style.transform = 'scale(0.9)';
            championUnoBtn.style.background = 'linear-gradient(135deg, #32CD32, #228B22)';
            setTimeout(() => {
                championUnoBtn.style.transform = 'scale(1)';
            }, 150);
        });
    }
    
    // 当游戏结束或冠军争夺战结束时，移除弹窗
    // 这个弹窗会在游戏状态更新时自动处理
    
    // 播放音效提示（如果需要的话）
    // playChampionBattleSound();
}

// 移除冠军争夺战弹窗的函数
function removeChampionBattleNotification() {
    const notification = document.querySelector('.champion-battle-notification');
    if (notification) {
        notification.style.animation = 'championBattleDisappear 0.3s ease-in';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }
}

// 模态框控制
function showModal(content) {
    document.getElementById('modal-body').innerHTML = content;
    document.getElementById('modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

// 管理员相关功能
function showAdminLogin() {
    const content = `
        <h3>${t('Admin Login')}</h3>
        <div class="form-group">
            <label>${t('Please enter admin password')}:</label>
            <input type="password" id="admin-password" placeholder="Password">
        </div>
        <button onclick="adminLogin()" class="primary-btn">${t('Admin Login')}</button>
    `;
    showModal(content);
}

function adminLogin() {
    const password = document.getElementById('admin-password').value;
    if (!password) {
        showNotification(t('Please enter admin password'), 'error');
        return;
    }
    
    showLoading();
    socket.emit('adminLogin', password);
    closeModal();
}

function adminLogout() {
    isAdmin = false;
    adminToken = null;
    localStorage.removeItem('adminToken');
    updateAdminUI();
    socket.emit('adminLogout');
}

function updateAdminUI() {
    const loginBtn = document.getElementById('admin-login-btn');
    const logoutBtn = document.getElementById('admin-logout-btn');
    const status = document.getElementById('admin-status');
    const panelBtn = document.getElementById('admin-panel-btn');
    const cheatPanel = document.getElementById('admin-cheat-panel');
    
    if (isAdmin) {
        loginBtn.classList.add('hidden');
        logoutBtn.classList.remove('hidden');
        status.classList.remove('hidden');
        panelBtn.classList.remove('hidden');
        if (cheatPanel) cheatPanel.classList.remove('hidden');
    } else {
        loginBtn.classList.remove('hidden');
        logoutBtn.classList.add('hidden');
        status.classList.add('hidden');
        panelBtn.classList.add('hidden');
        if (cheatPanel) cheatPanel.classList.add('hidden');
    }
}

// 房间相关功能
function createRoom() {
    const playerCount = parseInt(document.getElementById('player-count').value);
    const nickname = document.getElementById('host-nickname').value.trim();
    
    if (!nickname) {
        showNotification(t('Please enter nickname'), 'error');
        return;
    }
    
    if (playerCount < 2 || playerCount > 10) {
        showNotification(t('Invalid player count'), 'error');
        return;
    }
    
    showLoading();
    socket.emit('createRoom', {
        maxPlayers: playerCount,
        hostNickname: nickname,
        isAdmin: isAdmin
    });
}

function joinRoom() {
    const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
    const nickname = document.getElementById('join-nickname').value.trim();
    
    if (!roomCode) {
        showNotification(t('Please enter room code'), 'error');
        return;
    }
    
    if (!nickname) {
        showNotification(t('Please enter nickname'), 'error');
        return;
    }
    
    showLoading();
    socket.emit('joinRoom', {
        roomCode: roomCode,
        nickname: nickname,
        isAdmin: isAdmin
    });
}

function updateRoomUI(roomData) {
    document.getElementById('current-room-code').textContent = roomData.roomCode;
    
    const playersContainer = document.getElementById('players-container');
    playersContainer.innerHTML = '';
    
    roomData.players.forEach(player => {
        const playerDiv = document.createElement('div');
        const isCurrentUser = player.id === currentPlayer;
        playerDiv.className = `player-item ${player.ready ? 'ready' : ''} ${player.isHost ? 'host' : ''} ${isCurrentUser ? 'current-user' : ''}`;
        playerDiv.innerHTML = `
            <div>${player.nickname}${isCurrentUser ? ' (' + t('You') + ')' : ''}</div>
            <div>${player.ready ? t('Ready') : t('Not Ready')}</div>
        `;
        playersContainer.appendChild(playerDiv);
    });
    
    // 更新按钮状态
    const readyBtn = document.getElementById('ready-btn');
    const startBtn = document.getElementById('start-game-btn');
    
    const currentPlayerData = roomData.players.find(p => p.id === currentPlayer);
    if (currentPlayerData) {
        readyBtn.textContent = currentPlayerData.ready ? t('Cancel Ready') : t('Ready');
        
        if (currentPlayerData.isHost) {
            const allReady = roomData.players.every(p => p.ready);
            const minPlayers = roomData.players.length >= 2;
            if (allReady && minPlayers) {
                startBtn.classList.remove('hidden');
            } else {
                startBtn.classList.add('hidden');
            }
        }
    }
}

function toggleReady() {
    socket.emit('toggleReady');
}

function startGame() {
    socket.emit('startGame');
}

function leaveRoom() {
    socket.emit('leaveRoom');
    showPage('home-page');
    localStorage.removeItem('currentRoom');
    localStorage.removeItem('currentPlayer');
}

// 复制房间码功能
function copyRoomCode() {
    const roomCode = document.getElementById('current-room-code').textContent;
    const copyBtn = document.getElementById('copy-room-code-btn');
    
    // 尝试使用现代 Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(roomCode).then(() => {
            showCopySuccess(copyBtn);
            showNotification(t('Room code copied'), 'success');
        }).catch(() => {
            // 如果 Clipboard API 失败，使用备用方法
            fallbackCopyTextToClipboard(roomCode, copyBtn);
        });
    } else {
        // 使用备用方法（兼容旧浏览器和非HTTPS环境）
        fallbackCopyTextToClipboard(roomCode, copyBtn);
    }
}

// 备用复制方法（兼容所有环境）
function fallbackCopyTextToClipboard(text, button) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // 避免滚动到底部
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showCopySuccess(button);
            showNotification(t('Room code copied'), 'success');
        } else {
            showNotification(t('Copy failed'), 'error');
        }
    } catch (err) {
        // 最后的备用方案：提示用户手动复制
        showManualCopyPrompt(text);
    }
    
    document.body.removeChild(textArea);
}

// 显示复制成功动画
function showCopySuccess(button) {
    button.classList.add('copied');
    button.textContent = '完成';
    
    setTimeout(() => {
        button.classList.remove('copied');
        button.textContent = '复制';
    }, 1000);
}

// 手动复制提示（最后的备用方案）
function showManualCopyPrompt(text) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>
            <h3>${t('Manual Copy')}</h3>
            <p>${t('Please manually copy the room code:')}</p>
            <div style="background: #f5f5f5; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 1.2rem; text-align: center; margin: 10px 0; user-select: all;">
                ${text}
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="primary-btn">${t('Close')}</button>
        </div>
    `;
    document.body.appendChild(modal);
}

// 分享房间链接功能
function shareRoomLink() {
    const roomCode = document.getElementById('current-room-code').textContent;
    const shareUrl = `https://uno.hubecraft.top/${roomCode}`;
    const shareBtn = document.getElementById('share-room-btn');
    
    // 尝试使用现代 Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(shareUrl).then(() => {
            showShareSuccess(shareBtn);
            showNotification(t('Room link copied'), 'success');
        }).catch(() => {
            // 如果 Clipboard API 失败，使用备用方法
            fallbackCopyShareLink(shareUrl, shareBtn);
        });
    } else {
        // 使用备用方法（兼容旧浏览器和非HTTPS环境）
        fallbackCopyShareLink(shareUrl, shareBtn);
    }
}

// 备用分享链接复制方法
function fallbackCopyShareLink(shareUrl, button) {
    const textArea = document.createElement('textarea');
    textArea.value = shareUrl;
    
    // 避免滚动到底部
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showShareSuccess(button);
            showNotification(t('Room link copied'), 'success');
        } else {
            showNotification(t('Share failed'), 'error');
        }
    } catch (err) {
        // 最后的备用方案：提示用户手动复制
        showManualSharePrompt(shareUrl);
    }
    
    document.body.removeChild(textArea);
}

// 显示分享成功动画
function showShareSuccess(button) {
    button.classList.add('copied');
    const originalText = button.textContent;
    button.textContent = '完成';
    
    setTimeout(() => {
        button.classList.remove('copied');
        button.textContent = originalText;
    }, 1000);
}

// 手动分享提示（最后的备用方案）
function showManualSharePrompt(shareUrl) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>
            <h3>${t('Manual Share')}</h3>
            <p>${t('Please manually copy the room link:')}</p>
            <div style="background: #f5f5f5; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 1.2rem; text-align: center; margin: 10px 0; user-select: all;">
                ${shareUrl}
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="primary-btn">${t('Close')}</button>
        </div>
    `;
    document.body.appendChild(modal);
}

// 游戏相关功能
function updateGameUI(gameData) {
    // 更新游戏信息
    document.getElementById('current-player-name').textContent = gameData.currentPlayer.nickname;
    document.getElementById('game-direction-indicator').textContent = gameData.direction === 1 ? '→' : '←';
    document.getElementById('deck-count').textContent = gameData.deckCount;
    
    // 更新所有玩家（按游戏顺序排列）
    const playersContainer = document.getElementById('other-players');
    playersContainer.innerHTML = '';
    
    // 按游戏顺序排列所有玩家
    gameData.players.forEach(player => {
        const playerDiv = document.createElement('div');
        
        // 设置玩家框的CSS类
        let playerClasses = 'other-player';
        
        // 当前出牌的玩家
        if (player.id === gameData.currentPlayer.id) {
            playerClasses += ' current-turn';
        }
        
        // 当前用户（自己）
        if (player.id === currentPlayer) {
            playerClasses += ' current-user';
        }
        
        // 牌数为0的玩家（抢夺胜利时突出显示）
        if (player.cardCount === 0) {
            playerClasses += ' zero-cards';
        }
        
        playerDiv.className = playerClasses;
        
        // 构建玩家信息HTML
        let playerHTML = `
            <div class="player-name">${player.nickname}`;
        
        // 为当前用户添加标识
        if (player.id === currentPlayer) {
            playerHTML += ` <span class="you-indicator">(${t('You')})</span>`;
        }
        
        playerHTML += `</div>
            <div class="card-count">${player.cardCount} ${t('cards')}</div>
        `;
        
        playerDiv.innerHTML = playerHTML;
        playersContainer.appendChild(playerDiv);
    });
    
    // 更新弃牌堆
    const discardPile = document.getElementById('discard-pile');
    if (gameData.topCard) {
        discardPile.innerHTML = createCardElement(gameData.topCard).outerHTML;
    }
    
    // 更新手牌
    updateHandCards(gameData.hand);
    
    // 更新按钮状态
    const isMyTurn = gameData.currentPlayer.id === currentPlayer;
    const hasDrawnThisTurn = gameData.hasDrawnThisTurn;
    
    // 抽牌按钮：只有轮到自己时才显示，且未抽过牌时才能点击
    const drawBtn = document.getElementById('draw-card-btn');
    if (isMyTurn) {
        drawBtn.classList.remove('hidden');
        drawBtn.disabled = hasDrawnThisTurn;
    } else {
        drawBtn.classList.add('hidden');
    }
    
    // 跳过按钮：只有轮到自己且已抽过牌时才显示
    const skipBtn = document.getElementById('skip-turn-btn');
    if (isMyTurn && hasDrawnThisTurn) {
        skipBtn.classList.remove('hidden');
    } else {
        skipBtn.classList.add('hidden');
    }
    
    // 催促按钮：只有不是自己回合时才显示
    const urgeBtn = document.getElementById('urge-btn');
    if (!isMyTurn) {
        urgeBtn.classList.remove('hidden');
    } else {
        urgeBtn.classList.add('hidden');
    }
    
    // 检查是否处于冠军抢夺战状态
    const isChampionBattle = gameData.championBattle;
    const zeroCardPlayers = gameData.zeroCardPlayers || [];
    
    // UNO按钮逻辑：在冠军争夺战期间隐藏原来的UNO按钮（因为已集成到弹窗中）
    const unoBtn = document.getElementById('uno-btn');
    
    // 始终隐藏原来的UNO按钮，因为现在UNO按钮已集成到冠军争夺战弹窗中
    unoBtn.style.display = 'none';
    unoBtn.style.background = '';
    unoBtn.style.animation = '';
    unoBtn.style.boxShadow = '';
    
    // 显示冠军抢夺战状态
    const championBattleIndicator = document.getElementById('champion-battle-indicator');
    if (championBattleIndicator) {
        if (isChampionBattle) {
            championBattleIndicator.textContent = t('Champion Battle in Progress');
            championBattleIndicator.classList.remove('hidden');
            championBattleIndicator.style.background = 'linear-gradient(135deg, #FFD700, #FF8C00)';
            championBattleIndicator.style.animation = 'pulse 1s infinite';
        } else {
            championBattleIndicator.classList.add('hidden');
            championBattleIndicator.style.animation = '';
        }
    }
    
    // 更新当前出牌玩家提示
    const currentTurnIndicator = document.getElementById('current-turn-indicator');
    
    if (currentTurnIndicator) {
        // 根据是否为当前玩家改变颜色
        if (isMyTurn) {
            currentTurnIndicator.classList.add('is-you');
        } else {
            currentTurnIndicator.classList.remove('is-you');
        }
        
        // 显示提示元素
        currentTurnIndicator.classList.remove('hidden');
    }
}

function updateHandCards(hand) {
    const handContainer = document.getElementById('hand-cards');
    handContainer.innerHTML = '';
    
    hand.forEach((card, index) => {
        const cardElement = createCardElement(card);
        cardElement.addEventListener('click', () => playCard(index));
        
        // 检查是否可以出牌
        if (canPlayCard(card)) {
            cardElement.classList.add('playable');
        }
        
        handContainer.appendChild(cardElement);
    });
}

function createCardElement(card) {
    const cardDiv = document.createElement('div');
    
    // 对于变色牌，如果已选择颜色，则使用选择的颜色，否则使用原始颜色
    const displayColor = card.chosenColor || card.color;
    cardDiv.className = `card card-${displayColor}`;
    
    if (card.type === 'number') {
        cardDiv.textContent = card.value;
    } else if (card.type === 'skip') {
        cardDiv.textContent = '⊘';
    } else if (card.type === 'reverse') {
        cardDiv.textContent = '⟲';
    } else if (card.type === 'draw2') {
        cardDiv.textContent = '+2';
    } else if (card.type === 'wild') {
        // 如果已选择颜色，显示颜色指示器，否则显示彩虹
        if (card.chosenColor) {
            cardDiv.textContent = '🌈';
            // 添加一个小的颜色指示器
            const colorIndicator = document.createElement('div');
            colorIndicator.className = 'color-indicator';
            colorIndicator.textContent = '●';
            cardDiv.appendChild(colorIndicator);
        } else {
            cardDiv.textContent = '🌈';
        }
    } else if (card.type === 'wild_draw4') {
        // 如果已选择颜色，显示+4和颜色指示器，否则只显示+4
        if (card.chosenColor) {
            cardDiv.textContent = '+4';
            const colorIndicator = document.createElement('div');
            colorIndicator.className = 'color-indicator';
            colorIndicator.textContent = '●';
            cardDiv.appendChild(colorIndicator);
        } else {
            cardDiv.textContent = '+4';
        }
    }
    
    return cardDiv;
}

function canPlayCard(card) {
    if (!gameState || !gameState.topCard) return false;
    
    const topCard = gameState.topCard;
    
    // 万能牌总是可以出
    if (card.type === 'wild' || card.type === 'wild_draw4') {
        return true;
    }
    
    // 检查颜色匹配（考虑万能牌选择的颜色）
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

function playCard(cardIndex) {
    // 检查是否轮到当前玩家
    if (!gameState || !gameState.currentPlayer || gameState.currentPlayer.id !== currentPlayer) {
        showNotification(t('Not your turn'), 'error');
        return;
    }
    
    const card = gameState.hand[cardIndex];
    if (!canPlayCard(card)) {
        showNotification(t('Cannot play this card'), 'error');
        return;
    }
    
    if (card.type === 'wild' || card.type === 'wild_draw4') {
        // 显示颜色选择
        showColorPicker(cardIndex);
    } else {
        socket.emit('playCard', { cardIndex });
    }
}

function showColorPicker(cardIndex) {
    const content = `
        <h3>${t('Choose Color')}</h3>
        <div class="color-picker">
            <button onclick="playWildCard(${cardIndex}, 'red')" class="color-btn red">Red</button>
            <button onclick="playWildCard(${cardIndex}, 'yellow')" class="color-btn yellow">Yellow</button>
            <button onclick="playWildCard(${cardIndex}, 'green')" class="color-btn green">Green</button>
            <button onclick="playWildCard(${cardIndex}, 'blue')" class="color-btn blue">Blue</button>
        </div>
    `;
    showModal(content);
}

function playWildCard(cardIndex, color) {
    socket.emit('playCard', { cardIndex, chosenColor: color });
    closeModal();
}

function drawCard() {
    socket.emit('drawCard');
}

function callUno() {
    // 新的冠军争夺战机制：只在冠军争夺战中使用UNO按钮
    // 检查是否处于冠军争夺战状态
    if (gameState && gameState.championBattle) {
        // 冠军争夺战中，直接发送UNO事件
        socket.emit('callUno');
        
        // 添加视觉反馈
        const unoBtn = document.getElementById('uno-btn');
        if (unoBtn) {
            unoBtn.style.transform = 'scale(0.95)';
            unoBtn.style.background = 'linear-gradient(135deg, #32CD32, #228B22)';
            setTimeout(() => {
                unoBtn.style.transform = 'scale(1)';
                unoBtn.style.background = 'linear-gradient(135deg, #FFD700, #FF8C00)';
            }, 150);
        }
        return;
    }
    
    // 如果不在冠军争夺战中，显示提示信息
    showNotification(t('UNO button is only available during Champion Battle'), 'info');
}

// 跳过回合功能
function skipTurn() {
    socket.emit('skipTurn');
}

// 催促功能
function urgePlayer() {
    // 检查是否在冷却中
    if (urgeRemainingTime > 0) {
        return;
    }
    
    // 发送催促事件到服务器
    socket.emit('urgePlayer');
    
    // 开始冷却倒计时
    startUrgeCooldown();
}

// 开始催促冷却倒计时
function startUrgeCooldown() {
    const urgeBtn = document.getElementById('urge-btn');
    urgeRemainingTime = 5; // 5秒冷却时间
    
    // 禁用按钮并添加冷却样式
    urgeBtn.disabled = true;
    urgeBtn.classList.add('cooldown');
    
    // 更新按钮文本显示倒计时
    updateUrgeButtonText();
    
    // 清除之前的计时器
    if (urgeCooldownTimer) {
        clearInterval(urgeCooldownTimer);
    }
    
    // 开始倒计时
    urgeCooldownTimer = setInterval(() => {
        urgeRemainingTime--;
        updateUrgeButtonText();
        
        if (urgeRemainingTime <= 0) {
            // 冷却结束
            clearInterval(urgeCooldownTimer);
            urgeCooldownTimer = null;
            urgeBtn.disabled = false;
            urgeBtn.classList.remove('cooldown');
            urgeBtn.textContent = t('Urge');
        }
    }, 1000);
}

// 更新催促按钮文本
function updateUrgeButtonText() {
    const urgeBtn = document.getElementById('urge-btn');
    if (urgeRemainingTime > 0) {
        urgeBtn.textContent = `${t('Urge cooldown')} (${urgeRemainingTime}s)`;
    } else {
        urgeBtn.textContent = t('Urge');
    }
}

// 显示功能牌特效


// 管理员作弊功能
function viewAllHands() {
    socket.emit('adminViewHands');
}

function drawSpecificCard() {
    const content = `
        <h3>${t('Draw Specific Card')}</h3>
        <div class="form-group">
            <label>${t('Card Type')}:</label>
            <select id="card-type">
                <option value="number">Number</option>
                <option value="skip">Skip</option>
                <option value="reverse">Reverse</option>
                <option value="draw2">Draw 2</option>
                <option value="wild">Wild</option>
                <option value="wild_draw4">Wild Draw 4</option>
            </select>
        </div>
        <div class="form-group" id="number-group">
            <label>${t('Number')}:</label>
            <select id="card-number">
                ${Array.from({length: 10}, (_, i) => `<option value="${i}">${i}</option>`).join('')}
            </select>
        </div>
        <div class="form-group" id="color-group">
            <label>${t('Color')}:</label>
            <select id="card-color">
                <option value="red">Red</option>
                <option value="yellow">Yellow</option>
                <option value="green">Green</option>
                <option value="blue">Blue</option>
            </select>
        </div>
        <button onclick="confirmDrawSpecific()" class="primary-btn">${t('Draw Card')}</button>
    `;
    showModal(content);
    
    // 监听卡牌类型变化
    document.getElementById('card-type').addEventListener('change', (e) => {
        const isNumber = e.target.value === 'number';
        const isWild = e.target.value === 'wild' || e.target.value === 'wild_draw4';
        document.getElementById('number-group').style.display = isNumber ? 'block' : 'none';
        document.getElementById('color-group').style.display = isWild ? 'none' : 'block';
    });
}

function confirmDrawSpecific() {
    const type = document.getElementById('card-type').value;
    const number = document.getElementById('card-number').value;
    const color = document.getElementById('card-color').value;
    
    const cardSpec = { type };
    if (type === 'number') {
        cardSpec.value = parseInt(number);
    }
    if (type !== 'wild' && type !== 'wild_draw4') {
        cardSpec.color = color;
    }
    
    socket.emit('adminDrawSpecific', cardSpec);
    closeModal();
}

// 游戏结束相关
function updateGameEndUI(gameData) {
    // 游戏结束时移除冠军争夺战弹窗
    removeChampionBattleNotification();
    
    const resultsContainer = document.getElementById('game-results');
    
    // 检查是否有冠军抢夺战信息
    const isChampionBattleWin = gameData.championBattleWinner;
    
    let championBattleInfo = '';
    if (isChampionBattleWin) {
        championBattleInfo = `
            <div class="champion-battle-result">
                <h4>🏆 ${t('Champion Battle!')}</h4>
                <p>${gameData.winner.nickname} 在冠军抢夺战中获胜！</p>
            </div>
        `;
    }
    
    // 创建领奖台（只显示前3名或前2名）
    const podiumPlayers = gameData.results.slice(0, gameData.results.length >= 3 ? 3 : 2);
    const podiumHTML = createPodiumHTML(podiumPlayers);
    
    // 创建完整排名表格
    const tableHTML = createRankingTableHTML(gameData.results);
    
    resultsContainer.innerHTML = `
        <h3>${t('Final Results')}</h3>
        ${championBattleInfo}
        ${podiumHTML}
        ${tableHTML}
    `;
}

// 创建领奖台HTML
function createPodiumHTML(podiumPlayers) {
    if (podiumPlayers.length === 0) return '';
    
    const podiumOrder = podiumPlayers.length === 3 ? [1, 0, 2] : [0, 1]; // 2-1-3 或 1-2 的顺序
    
    return `
        <div class="podium-container">
            <div class="podium-stage">
                ${podiumOrder.map(index => {
                    if (index >= podiumPlayers.length) return '';
                    const player = podiumPlayers[index];
                    const rank = index + 1;
                    const height = rank === 1 ? 'first' : (rank === 2 ? 'second' : 'third');
                    const medal = rank === 1 ? '🥇' : (rank === 2 ? '🥈' : '🥉');
                    
                    return `
                        <div class="podium-position ${height}">
                            <div class="podium-player">
                                <div class="podium-medal">${medal}</div>
                                <div class="podium-name">${player.nickname}</div>
                                ${player.id === currentPlayer.id ? '<div class="podium-you">(您)</div>' : ''}
                                <div class="podium-cards">${player.cardsLeft} ${t('cards')}</div>
                            </div>
                            <div class="podium-base">
                                <div class="podium-rank">${rank}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

// 创建排名表格HTML
function createRankingTableHTML(results) {
    return `
        <div class="ranking-table-container">
            <h4 class="ranking-title">${t('Complete Rankings')}</h4>
            <div class="ranking-table">
                <div class="ranking-header">
                    <div class="ranking-col rank-col">${t('Rank')}</div>
                    <div class="ranking-col name-col">${t('Nickname')}</div>
                    <div class="ranking-col cards-col">${t('Cards Left')}</div>
                </div>
                ${results.map((player, index) => {
                    const rank = index + 1;
                    const isFirstPlace = rank === 1;
                    
                    return `
                        <div class="ranking-row ${isFirstPlace ? 'first-place' : ''}">
                            <div class="ranking-col rank-col">
                                <span class="rank-number">${rank}</span>
                            </div>
                            <div class="ranking-col name-col">
                                <span class="player-nickname">${player.nickname}</span>
                                ${player.id === currentPlayer.id ? '<span class="you-tag">(您)</span>' : ''}
                            </div>
                            <div class="ranking-col cards-col">
                                <span class="cards-number">${player.cardsLeft}</span>
                                ${isFirstPlace ? '<span class="uno-icon">⚡UNO</span>' : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

// 格式化游戏时长
function formatGameDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}分${remainingSeconds}秒`;
}



// 规则显示
function showRules() {
    document.getElementById('rules-content').innerHTML = gameRules[currentLanguage];
    showPage('rules-page');
}

// 检查URL中的房间号并自动加入
function checkUrlForRoomCode() {
    const path = window.location.pathname;
    // 匹配 /房间号 格式，房间号可以是任意字符（但不能包含斜杠）
    const roomCodeMatch = path.match(/^\/([^\/]+)$/);
    
    if (roomCodeMatch) {
        const roomCode = roomCodeMatch[1];
        console.log('从URL检测到房间号:', roomCode);
        
        // 清除URL中的房间号，避免刷新时重复处理
        window.history.replaceState({}, document.title, '/');
        
        // 跳转到加入房间页面并自动填写房间号
        showPage('join-room-page');
        
        // 延迟一下确保页面已切换
        setTimeout(() => {
            // 自动填写房间号
            const roomCodeInput = document.getElementById('room-code-input');
            if (roomCodeInput) {
                roomCodeInput.value = roomCode;
                // 添加一个视觉提示
                showNotification(t('Room code auto-filled from URL'), 'info');
            }
        }, 100);
    }
}



// 检查游戏状态
function checkGameState() {
    const savedRoom = localStorage.getItem('currentRoom');
    const savedPlayer = localStorage.getItem('currentPlayer');
    
    if (savedRoom && savedPlayer) {
        // 显示重连提示
        showNotification(t('Reconnecting...'), 'info');
    }
}

// 管理员查看手牌模态框
function showAdminHandsModal(handsData) {
    const content = `
        <h3>${t('All Players Hands')}</h3>
        <div class="admin-hands-view">
            ${handsData.map(player => `
                <div class="player-hand-view">
                    <h4>${player.nickname}</h4>
                    <div class="hand-cards-view">
                        ${player.hand.map(card => `
                            <div class="card card-${card.color} small">
                                ${getCardDisplay(card)}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
        <style>
            .admin-hands-view { max-height: 400px; overflow-y: auto; }
            .player-hand-view { margin-bottom: 20px; padding: 15px; background: #f5f5f5; border-radius: 8px; }
            .hand-cards-view { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 10px; }
            .card.small { width: 40px; height: 60px; font-size: 0.8rem; }
        </style>
    `;
    showModal(content);
}

// 获取卡牌显示内容
function getCardDisplay(card) {
    if (card.type === 'number') {
        return card.value;
    } else if (card.type === 'skip') {
        return '⊘';
    } else if (card.type === 'reverse') {
        return '⟲';
    } else if (card.type === 'draw2') {
        return '+2';
    } else if (card.type === 'wild') {
        return '🌈';
    } else if (card.type === 'wild_draw4') {
        return '+4';
    }
    return '';
}

// 更新活跃游戏列表
function updateActiveGamesList(gamesData) {
    const container = document.getElementById('active-games-list');
    if (!container) return;

    container.innerHTML = gamesData.length === 0 ? 
        `<p>${t('No active games')}</p>` :
        gamesData.map(game => `
            <div class="game-item">
                <div class="game-info">
                    <strong>${t('Room')}: ${game.roomCode}</strong>
                    <span>${game.playerCount}/${game.maxPlayers} ${t('players')}</span>
                    <span>${game.gameStarted ? t('In Progress') : t('Waiting')}</span>
                </div>
                <div class="game-time">
                    ${t('Created')}: ${new Date(game.createdAt).toLocaleString()}
                </div>
            </div>
        `).join('');
}

// 加载管理员面板数据
function loadAdminPanel() {
    if (!isAdmin) return;
    socket.emit('getActiveGames');
}

// 修改管理员面板按钮事件
document.addEventListener('DOMContentLoaded', () => {
    const adminPanelBtn = document.getElementById('admin-panel-btn');
    if (adminPanelBtn) {
        adminPanelBtn.addEventListener('click', () => {
            showPage('admin-panel-page');
            loadAdminPanel();
        });
    }
});

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);