function addWelcomeMessage() {
    const welcomeHtml = `
        <div class="welcome-message">
            <div class="welcome-logo"></div>
            <div class="logo-message">
                <div class="logo-container">
                    <div class="logo-text">
                        <span class="brand-name">번개장터</span>
                        <span class="official-tag">공식</span>
                    </div>
                    <div class="welcome-text">번개장터의 고객센터입니다.</div>
                </div>
            </div>
            <div class="welcome-time">${formatDate(new Date())}</div>
        </div>
    `;
    messageContainer.insertAdjacentHTML('afterbegin', welcomeHtml);
}

// 获取URL参数
const path = window.location.pathname;
const pathParts = path.split('/').filter(part => part);
let userType;
let roomId;
let isAdmin = false;

// Parse the URL path
if (pathParts.length === 2) {
    // Format: /:password/:roomId (admin)
    const [password, id] = pathParts;
    const storedPassword = localStorage.getItem('adminPassword');
    if (password === storedPassword) {
        isAdmin = true;
        userType = 'admin';
        roomId = id;
    } else {
        // 密码不匹配，重定向到首页
        window.location.href = '/';
        throw new Error('Invalid admin password');
    }
} else if (pathParts.length === 1) {
    // Format: /:roomId (user)
    userType = 'user';
    roomId = pathParts[0];
} else {
    // 无效的URL格式，重定向到首页
    window.location.href = '/';
    throw new Error('Invalid URL format');
}

// Validate roomId format
if (!roomId || !roomId.match(/^[a-zA-Z0-9]{3,7}$/)) {
    window.location.href = '/';
    throw new Error('Invalid roomId format');
}

// 全局变量
const loadingPage = document.getElementById('loadingPage');
const chatPage = document.querySelector('.chat-page');
let isLoading = true;

const messageContainer = document.getElementById('messageContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const imageInput = document.getElementById('imageInput');
const roomNameElement = document.getElementById('roomName');
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const quickReplySection = document.getElementById('quickReplySection');
const quickReplyList = document.getElementById('quickReplyList');
const addQuickReplyBtn = document.getElementById('addQuickReply');
const deleteQuickReplyBtn = document.getElementById('deleteQuickReply');
const addQuickReplyModal = document.getElementById('addQuickReplyModal');
const quickReplyContent = document.getElementById('quickReplyContent');
const saveQuickReplyBtn = document.getElementById('saveQuickReply');
const cancelQuickReplyBtn = document.getElementById('cancelQuickReply');
const deleteQuickReplyModal = document.getElementById('deleteQuickReplyModal');
const quickReplyDeleteList = document.querySelector('.quick-reply-delete-list');
let currentEditingReplyId = null;

let socket = null;
let isConnected = false;
let currentReplies = [];
let onlineCount = 0;
let isDeleteMode = false;
let selectedReplies = new Set();

// 修改卡片设置结构
let cardSettings = {};     // 存储商品信息的对象
let paymentSettings = {};  // 存储支付信息的对象
let currentProductId = null;   // 当前选中的商品ID
let currentPaymentId = null;   // 当前选中的支付信息ID

// 修改全局变量，分离左右侧数据
let leftQuickReplies = [];  // 存储左侧快捷回复
let rightQuickReplies = {}; // 存储右侧快捷回复（包含不同类型）
let isLeftDeleteMode = false;
let isRightDeleteMode = false;
let selectedLeftReplies = new Set();
let selectedRightReplies = new Set();

// 格式化日期
function formatDate(date) {
    // 创建一个表示首尔时区的日期对象
    const seoulDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    
    // 格式化年月日
    const year = seoulDate.getFullYear();
    const month = seoulDate.getMonth() + 1;
    const day = seoulDate.getDate();
    const hours = seoulDate.getHours();
    const minutes = seoulDate.getMinutes();

    // 根据消息类型返回不同格式
    if (arguments.callee.caller.name === 'addWelcomeMessage') {
        // 欢迎消息只显示年月日
        return `${year}년${month}월${day}일`;
    } else {
        // 普通消息显示时分（韩国格式：오전/오후）
        const ampm = hours < 12 ? '오전' : '오후';
        const displayHours = hours % 12 || 12; // 转换为12小时制
        return `${ampm}${displayHours}:${minutes.toString().padStart(2, '0')}`;
    }
}

// 发送消息
function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !isConnected) return;

    const message = {
        content,
        type: 'text',
        sender: userType,
        createdAt: new Date()
    };

    socket.emit('message', message);
    // 本地立即显示消息
    appendMessage({...message, isSelf: true});
    messageContainer.scrollTop = messageContainer.scrollHeight;
    messageInput.value = '';
}

// 发送卡片消息
function sendCardMessage(productId) {
    const productInfo = cardSettings[productId];
    if (!productInfo || !productInfo.settings) {
        showNotification('상품 정보를 찾을 수 없습니다', 'error');
        return;
    }

    const settings = productInfo.settings;
    if (!settings.productImage || !settings.productName) {
        showNotification('상품 이미지와 상품명을 입력해주세요', 'error');
        return;
    }

    const currentTime = new Date();
    const formattedTime = formatDate(currentTime);
    
    const messageContent = {
        type: 'card',
        productImage: settings.productImage,
        productName: settings.productName,
        subtitle1: settings.subtitle1,
        subtitle2: settings.subtitle2,
        subtitle3: settings.subtitle3,
        time: formattedTime,
        isChecked: false
    };

    if (isConnected) {
        const message = {
            content: JSON.stringify(messageContent),
            type: 'text',
            sender: userType,
            createdAt: currentTime
        };
        socket.emit('message', message);
        // 本地立即显示消息
        appendMessage({...message, isSelf: true});
        messageContainer.scrollTop = messageContainer.scrollHeight;
    }
}

// 初始显示加载页面（仅用户）
if (!isAdmin) {
    showLoadingPage();
}

// 初始化函数
async function init() {
    try {
        // 确保聊天页面初始隐藏
        const chatPage = document.getElementById('chatPage');
        if (chatPage) {
            chatPage.style.display = 'none';
            chatPage.style.opacity = '0';
        }

        // 设置管理员模式
        if (isAdmin) {
            document.body.classList.add('admin-mode');
        }

        if (!isAdmin) {
            // 用户显示加载页面
            showLoadingPage();
        } else {
            // 管理员直接显示聊天页面
            const loadingPage = document.getElementById('loadingPage');
            if (loadingPage) {
                loadingPage.style.display = 'none';
            }
            showChatPage();
        }

        // 获取聊天室信息
        const response = await fetch(`/api/chat/rooms/${roomId}`);
        const room = await response.json();

        if (!room) {
            showNotification('채팅방을 찾을 수 없습니다', 'error');
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
            return;
        }

        // 设置聊天室名称
        if (roomNameElement) {
            roomNameElement.textContent = room.name;
        }

        // 添加欢迎消息
        addWelcomeMessage();

        // 加载历史消息
        await loadMessages();

        // 连接Socket
        connectSocket();

        // 如果是管理员，加载快捷回复和商品信息
        if (isAdmin) {
            try {
                // 加载左侧快捷回复
                await loadLeftQuickReplies();
                // 加载右侧快捷回复
                await loadRightQuickReplies();
                
                // 设置左右两侧的事件监听
                setupLeftQuickReplyEvents();
                setupRightQuickReplyEvents();
                
                // 设置商品编辑相关事件监听
                setupProductEditEvents();
            } catch (error) {
                console.error('Failed to load quick replies:', error);
                showNotification('데이터를 로드하지 못했습니다', 'error');
            }
        }

        // 设置基本事件监听
        setupEventListeners();

        // 设置支付信息相关事件监听
        const changePaymentImageBtn = document.getElementById('changePaymentImageBtn');
        const paymentImageInput = document.getElementById('paymentImageInput');
        const savePaymentInfoBtn = document.getElementById('savePaymentInfoBtn');
        const cancelPaymentEdit = document.getElementById('cancelPaymentEdit');

        if (changePaymentImageBtn && paymentImageInput) {
            changePaymentImageBtn.addEventListener('click', () => {
                paymentImageInput.click();
            });
            paymentImageInput.addEventListener('change', handlePaymentImageChange);
        }

        if (savePaymentInfoBtn) {
            savePaymentInfoBtn.addEventListener('click', savePaymentInfo);
        }

        if (cancelPaymentEdit) {
            cancelPaymentEdit.addEventListener('click', () => {
                const editModal = document.getElementById('editPaymentModal');
                if (editModal) {
                    editModal.style.display = 'none';
                    currentPaymentId = null;
                }
            });
        }

    } catch (error) {
        console.error('초기화 실패:', error);
        showNotification('초기화에 실패했습니다', 'error');
    }
}

// 连接Socket
function connectSocket() {
    socket = io();
    
    socket.on('connect', () => {
        isConnected = true;
        socket.emit('joinRoom', { roomId, userType });
    });

    socket.on('message', (message) => {
        // 如果消息已经在本地显示过，就不再显示
        if (message.isSelf || message.sender === userType) {
            return;
        }
        appendMessage(message);
        messageContainer.scrollTop = messageContainer.scrollHeight;
    });

    socket.on('roomDeleted', () => {
        cleanupRoom(roomId);
        showNotification('此聊天室已被删除', 'error');
        window.location.href = 'https://m.bunjang.co.kr';
    });

    socket.on('userJoined', ({ onlineCount: count }) => {
        onlineCount = count;
        // 只在管理员模式下更新显示
        if (isAdmin) {
            const onlineCountElement = document.getElementById('onlineCount');
            if (onlineCountElement) {
                onlineCountElement.textContent = `접속자 수: ${count}명`;
            }
        }
    });

    socket.on('userLeft', ({ onlineCount: count }) => {
        onlineCount = count;
        // 只在管理员模式下更新显示
        if (isAdmin) {
            const onlineCountElement = document.getElementById('onlineCount');
            if (onlineCountElement) {
                onlineCountElement.textContent = `접속자 수: ${count}명`;
            }
        }
    });

    socket.on('disconnect', () => {
        isConnected = false;
        showNotification('연결이 끊어졌습니다. 다시 연결 중...', 'error');
    });

    socket.on('orderStatusChanged', (data) => {
        const { messageId, confirmed } = data;
        
        // 更新localStorage中的状态
        const buttonStates = JSON.parse(localStorage.getItem('buttonStates') || '{}');
        buttonStates[messageId] = confirmed;
        localStorage.setItem('buttonStates', JSON.stringify(buttonStates));

        // 更新UI显示
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            if (isAdmin) {
                const statusElement = messageElement.querySelector('.order-status');
                if (statusElement) {
                    statusElement.className = `order-status ${confirmed ? 'confirmed' : 'pending'}`;
                    statusElement.textContent = confirmed ? '用户已确认' : '用户还未确认';
                }
            } else {
                const buttonElement = messageElement.querySelector('.order-button');
                if (buttonElement) {
                    buttonElement.className = `order-button ${confirmed ? 'checked' : ''}`;
                    buttonElement.textContent = confirmed ? '확인' : '주문서 확인';
                    buttonElement.disabled = confirmed;
                }
            }
        }
    });
}

// 加载历史消息
async function loadMessages() {
    try {
        const response = await fetch(`/api/chat/rooms/${roomId}/messages`);
        const messages = await response.json();
        
        messages.forEach(message => {
            // 根据发送者类型判断是否是自己发送的消息
            const isSelf = message.sender === userType;
            appendMessage({
                ...message,
                isSelf
            });
        });

        // 滚动到最新消息
        scrollToBottom();
    } catch (error) {
        console.error('加载消息失败:', error);
        showNotification('无法加载历史消息', 'error');
    }
}

// 设置事件监听
function setupEventListeners() {
    // 发送消息
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendButton.addEventListener('click', sendMessage);

    // 图片上传
    imageInput.addEventListener('change', uploadImage);
    document.getElementById('uploadImageBtn').addEventListener('click', () => {
        imageInput.click();
    });

    // 图片预览
    imageModal.addEventListener('click', () => {
        imageModal.classList.remove('active');
    });

    // 快捷回复相关
    setupQuickReplyEvents();
    
    // 添加申请模态框关闭按钮事件监听
    const closeApplicationModalBtn = document.getElementById('closeApplicationModal');
    if (closeApplicationModalBtn) {
        closeApplicationModalBtn.addEventListener('click', () => {
            const applicationModal = document.getElementById('applicationModal');
            if (applicationModal) {
                applicationModal.style.display = 'none';
            }
        });
    }
}

// 设置快捷回复相关事件监听
function setupQuickReplyEvents() {
    if (!isAdmin) return;

    // 只获取左侧的按钮和列表
    const quickReplySection = document.querySelector('.quick-reply-section.left');
    const addQuickReplyBtn = quickReplySection?.querySelector('button:first-child');
    const deleteBtn = quickReplySection?.querySelector('button:last-child');
    const quickReplyList = quickReplySection?.querySelector('.quick-reply-list');
    
    if (!quickReplySection || !addQuickReplyBtn || !deleteBtn || !quickReplyList) {
        console.error('Left quick reply elements not found');
        return;
    }

    // 添加按钮事件监听
    addQuickReplyBtn.addEventListener('click', () => {
        if (isDeleteMode) {
            exitDeleteMode();
            return;
        }
        const addQuickReplyModal = document.getElementById('addQuickReplyModal');
        if (addQuickReplyModal) {
            addQuickReplyModal.style.display = 'flex';
        }
    });

    // 删除按钮事件
    deleteBtn.addEventListener('click', () => {
        if (!isDeleteMode) {
            enterLeftDeleteMode();
        } else {
            deleteSelectedLeftItems();
        }
    });

    // 快速回复列表点击事件
    quickReplyList.addEventListener('click', handleLeftQuickReplyClick);

    // 设置模态框相关事件
    const addQuickReplyModal = document.getElementById('addQuickReplyModal');
    const cancelQuickReplyBtn = document.getElementById('cancelQuickReply');
    const saveQuickReplyBtn = document.getElementById('saveQuickReply');
    
    if (cancelQuickReplyBtn) {
        cancelQuickReplyBtn.addEventListener('click', () => {
            if (addQuickReplyModal) {
                addQuickReplyModal.style.display = 'none';
                const quickReplyContent = document.getElementById('quickReplyContent');
                if (quickReplyContent) {
                    quickReplyContent.value = '';
                }
            }
        });
    }

    if (saveQuickReplyBtn) {
        saveQuickReplyBtn.addEventListener('click', saveQuickReply);
    }

    // 编辑模态框相关事件监听
    const editModal = document.getElementById('editQuickReplyModal');
    const updateQuickReplyBtn = document.getElementById('updateQuickReply');
    const cancelEditQuickReplyBtn = document.getElementById('cancelEditQuickReply');

    if (updateQuickReplyBtn) {
        updateQuickReplyBtn.addEventListener('click', updateQuickReply);
    }

    if (cancelEditQuickReplyBtn) {
        cancelEditQuickReplyBtn.addEventListener('click', closeEditModal);
    }
}

// 加载左侧快捷回复
async function loadLeftQuickReplies() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/chat/quick-replies/left', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const replies = await response.json();
        leftQuickReplies = replies;
        renderLeftQuickReplies();
    } catch (error) {
        console.error('Failed to load left quick replies:', error);
        showNotification('왼쪽 빠른 답장을 불러오지 못했습니다', 'error');
    }
}

// 加载右侧快捷回复
async function loadRightQuickReplies() {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }
        
        // 并行加载快捷回复、商品信息和支付信息
        const [repliesResponse, productsResponse, paymentsResponse] = await Promise.all([
            fetch('/api/chat/quick-replies/right', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }),
            fetch('/api/chat/product-info/all', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }),
            fetch('/api/chat/payment-info/all', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })
        ]);

        if (!repliesResponse.ok || !productsResponse.ok || !paymentsResponse.ok) {
            throw new Error('Failed to load data');
        }

        // 获取数据
        rightQuickReplies = await repliesResponse.json();
        const products = await productsResponse.json();
        const payments = await paymentsResponse.json();
        
        // 更新商品和支付信息
        cardSettings = products;
        paymentSettings = payments;

        // 渲染右侧快捷回复列表
        renderRightQuickReplies();
    } catch (error) {
        console.error('Failed to load right quick replies:', error);
        showNotification('오른쪽 빠른 답장을 불러오지 못했습니다', 'error');
    }
}

// 渲染左侧快捷回复
function renderLeftQuickReplies() {
    const leftRepliesList = document.querySelector('.quick-reply-list.left-replies');
    if (!leftRepliesList) return;
    
    leftRepliesList.innerHTML = '';
    leftQuickReplies.forEach(reply => {
        const div = document.createElement('div');
        div.className = 'quick-reply-item';
        div.dataset.id = reply._id;
        div.dataset.content = reply.content;
        div.innerHTML = `
            <span class="reply-content">${reply.content}</span>
            <svg class="edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
        `;

        // 添加编辑图标点击事件
        const editIcon = div.querySelector('.edit-icon');
        if (editIcon) {
            editIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                openLeftEditModal(reply._id, reply.content);
            });
        }

        leftRepliesList.appendChild(div);
    });
}

// 设置左侧快捷回复事件
function setupLeftQuickReplyEvents() {
    const leftSection = document.querySelector('.quick-reply-section.left');
    const addBtn = leftSection.querySelector('button:first-child');
    const deleteBtn = leftSection.querySelector('button:last-child');
    
    // 添加按钮事件
    addBtn.addEventListener('click', () => {
        if (isLeftDeleteMode) {
            exitLeftDeleteMode();
        } else {
            document.getElementById('addQuickReplyModal').style.display = 'flex';
        }
    });

    // 删除按钮事件
    deleteBtn.addEventListener('click', () => {
        if (!isLeftDeleteMode) {
            enterLeftDeleteMode();
        } else {
            deleteSelectedLeftItems();
        }
    });

    // 快速回复列表点击事件
    const quickReplyList = leftSection.querySelector('.quick-reply-list');
    if (quickReplyList) {
        quickReplyList.addEventListener('click', handleLeftQuickReplyClick);
    }
}

// 设置右侧快捷回复事件
function setupRightQuickReplyEvents() {
    const rightAddBtn = document.getElementById('rightAddBtn');
    const rightDeleteBtn = document.getElementById('rightDeleteBtn');
    const typeSelectModal = document.getElementById('typeSelectModal');
    const itemNameModal = document.getElementById('itemNameModal');
    const confirmTypeSelect = document.getElementById('confirmTypeSelect');
    const cancelTypeSelect = document.getElementById('cancelTypeSelect');
    const saveItemName = document.getElementById('saveItemName');
    const cancelItemName = document.getElementById('cancelItemName');
    const itemNameInput = document.getElementById('itemNameInput');
    const typeSelectItems = document.querySelectorAll('.type-select-item');

    let selectedType = null;

    // 删除按钮点击事件
    rightDeleteBtn.addEventListener('click', () => {
        if (!isRightDeleteMode) {
            enterRightDeleteMode();
        } else {
            deleteSelectedRightItems();
        }
    });

    // 添加按钮点击事件
    rightAddBtn.addEventListener('click', () => {
        if (isRightDeleteMode) {
            exitRightDeleteMode();
        } else {
            typeSelectModal.style.display = 'flex';
            selectedType = null;
            typeSelectItems.forEach(item => item.classList.remove('selected'));
        }
    });

    // 类型选择事件
    typeSelectItems.forEach(item => {
        item.addEventListener('click', () => {
            typeSelectItems.forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
            selectedType = item.dataset.type;
        });
    });

    // 确认类型选择
    confirmTypeSelect.addEventListener('click', () => {
        if (!selectedType) {
            showNotification('유형을 선택해주세요', 'error');
            return;
        }

        // 设置默认名称
        itemNameInput.value = selectedType;
        
        // 隐藏类型选择模态框，显示名称编辑模态框
        typeSelectModal.style.display = 'none';
        itemNameModal.style.display = 'flex';
    });

    // 保存项目名称
    saveItemName.addEventListener('click', async () => {
        const itemName = itemNameInput.value.trim();
        if (!itemName) {
            showNotification('항목 이름을 입력해주세요', 'error');
            return;
        }

        try {
            if (selectedType === '상품정보') {
                // 初始化新商品信息的设置
                const productInfo = {
                    name: itemName,
                    settings: {
                        productImage: '',
                        productName: itemName,
                        subtitle1: '·상품금액: 500,000원',
                        subtitle2: '·거래방법: 안전거래',
                        subtitle3: '·결제확인:2025년2월13일 오후5:06분',
                        lastModified: new Date().toISOString()
                    }
                };

                await saveNewProductInfo(null, productInfo);
                itemNameModal.style.display = 'none';
                showNotification('추가되었습니다');
            } else if (selectedType === '결제정보') {
                // 初始化新支付信息的设置
                const paymentInfo = {
                    name: itemName,
                    settings: {
                        paymentImage: '',
                        paymentName: itemName,
                        paymentAmount: '',
                        paymentMethod: '',
                        paymentStatus: '',
                        lastModified: new Date().toISOString()
                    }
                };

                const token = localStorage.getItem('token');
                const response = await fetch('/api/chat/payment-info', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(paymentInfo)
                });

                if (response.ok) {
                    const savedPayment = await response.json();
                    paymentSettings[savedPayment._id] = savedPayment;
                    itemNameModal.style.display = 'none';
                    await loadRightQuickReplies();
                    showNotification('추가되었습니다');
                } else {
                    throw new Error('저장 실패');
                }
            } else {
                // 其他类型的快捷回复
                await saveRightQuickReply(selectedType, {
                    name: itemName,
                    type: selectedType
                });
                itemNameModal.style.display = 'none';
                showNotification('추가되었습니다');
            }
        } catch (error) {
            console.error('Failed to save item:', error);
            showNotification(error.message || '저장 실패', 'error');
        }
    });

    // 取消类型选择
    cancelTypeSelect.addEventListener('click', () => {
        typeSelectModal.style.display = 'none';
    });

    // 取消名称编辑
    cancelItemName.addEventListener('click', () => {
        itemNameModal.style.display = 'none';
    });
}

// 删除选中的右侧项目
async function deleteSelectedRightItems() {
    const selectedItems = document.querySelectorAll('.quick-reply-section.right .quick-reply-item.selected');
    if (selectedItems.length === 0) {
        showNotification('삭제할 항목을 선택해주세요', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        const deletePromises = Array.from(selectedItems).map(async (item) => {
            const id = item.dataset.id;
            const type = item.dataset.type;
            if (!id || !type) return false;

            try {
                if (type === '상품정보') {
                    // 对于商品信息类型，删除商品信息
                    const productResponse = await fetch(`/api/chat/product-info/${id}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    if (!productResponse.ok) {
                        throw new Error('Failed to delete product info');
                    }

                    // 从本地状态中删除
                    delete cardSettings[id];
                    return true;
                } else if (type === '결제정보') {
                    // 对于支付信息类型，删除支付信息
                    const paymentResponse = await fetch(`/api/chat/payment-info/${id}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    if (!paymentResponse.ok) {
                        throw new Error('Failed to delete payment info');
                    }

                    // 从本地状态中删除
                    delete paymentSettings[id];
                    return true;
                } else {
                    // 其他类型删除快捷回复
                    const response = await fetch(`/api/chat/quick-replies/right/${type}/${id}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    if (!response.ok) {
                        throw new Error('Failed to delete quick reply');
                    }
                    return true;
                }
            } catch (error) {
                console.error('Failed to delete item:', error);
                return false;
            }
        });

        const results = await Promise.all(deletePromises);
        const allSuccessful = results.every(result => result);

        if (allSuccessful) {
            showNotification('삭제되었습니다');
            // 重新加载数据并渲染
            await loadRightQuickReplies();
        } else {
            showNotification('일부 항목을 삭제하지 못했습니다', 'error');
        }
    } catch (error) {
        console.error('Failed to delete items:', error);
        showNotification('삭제 실패', 'error');
    } finally {
        exitRightDeleteMode();
    }
}

// 进入右侧删除模式
function enterRightDeleteMode() {
    const rightSection = document.querySelector('.quick-reply-section.right');
    const rightAddBtn = document.getElementById('rightAddBtn');
    const rightDeleteBtn = document.getElementById('rightDeleteBtn');
    
    if (!rightSection || !rightAddBtn || !rightDeleteBtn) {
        console.error('Right section elements not found');
        return;
    }
    
    isRightDeleteMode = true;
    rightSection.classList.add('delete-mode');
    
    // 更新按钮状态
    rightDeleteBtn.textContent = '삭제';
    rightDeleteBtn.classList.add('confirm-delete');
    rightAddBtn.textContent = '취소';
    rightAddBtn.classList.add('cancel-delete');
    
    // 为所有项目添加选择状态指示
    const items = rightSection.querySelectorAll('.quick-reply-item');
    items.forEach(item => {
        item.classList.add('deletable');
    });
}

// 退出右侧删除模式
function exitRightDeleteMode() {
    const rightSection = document.querySelector('.quick-reply-section.right');
    const rightAddBtn = document.getElementById('rightAddBtn');
    const rightDeleteBtn = document.getElementById('rightDeleteBtn');
    
    if (!rightSection || !rightAddBtn || !rightDeleteBtn) {
        console.error('Right section elements not found');
        return;
    }
    
    isRightDeleteMode = false;
    rightSection.classList.remove('delete-mode');
    
    // 恢复按钮状态
    rightDeleteBtn.textContent = '편집';
    rightDeleteBtn.classList.remove('confirm-delete');
    rightAddBtn.textContent = '추가';
    rightAddBtn.classList.remove('cancel-delete');
    
    // 清除所有选择状态
    const items = rightSection.querySelectorAll('.quick-reply-item');
    items.forEach(item => {
        item.classList.remove('selected', 'deletable');
    });
    
    // 清空选中集合
    selectedRightReplies.clear();
}

// 处理左侧快捷回复点击
function handleLeftQuickReplyClick(e) {
    const item = e.target.closest('.quick-reply-item');
    if (!item) return;

    if (isLeftDeleteMode) {
        item.classList.toggle('selected');
        const replyId = item.dataset.id;
        if (item.classList.contains('selected')) {
            selectedLeftReplies.add(replyId);
        } else {
            selectedLeftReplies.delete(replyId);
        }
        return;
    }

    // 发送普通文本消息
    const content = item.dataset.content;
    if (content && isConnected) {
        const message = {
            content,
            type: 'text',
            sender: userType,
            createdAt: new Date()
        };
        socket.emit('message', message);
        appendMessage(message);
        messageContainer.scrollTop = messageContainer.scrollHeight;
    }
}

// 处理右侧快捷回复点击
function handleRightQuickReplyClick(e) {
    const item = e.target.closest('.quick-reply-item');
    if (!item) return;

    if (isRightDeleteMode) {
        item.classList.toggle('selected');
        const replyId = item.dataset.id;
        if (item.classList.contains('selected')) {
            selectedRightReplies.add(replyId);
        } else {
            selectedRightReplies.delete(replyId);
        }
            return;
        }

    const type = item.dataset.type;
    const id = item.dataset.id;

    if (type === '상품정보') {
        sendCardMessage(id);
    }
    // 其他类型的处理可以在这里添加
}

// 删除选中的左侧项目
async function deleteSelectedLeftItems() {
    const selectedItems = document.querySelectorAll('.quick-reply-section.left .quick-reply-item.selected');
    if (selectedItems.length === 0) {
        showNotification('삭제할 항목을 선택해주세요', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        const deletePromises = Array.from(selectedItems).map(async (item) => {
            const id = item.dataset.id;
            if (!id) return false;

            try {
                const response = await fetch(`/api/chat/quick-replies/left/${id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.ok) {
                    item.remove();
                    return true;
                }
                return false;
            } catch (error) {
                console.error('Failed to delete item:', error);
                return false;
            }
        });

        const results = await Promise.all(deletePromises);
        const allSuccessful = results.every(result => result);

        if (allSuccessful) {
            showNotification('삭제되었습니다');
            await loadLeftQuickReplies();
        } else {
            showNotification('일부 항목을 삭제하지 못했습니다', 'error');
        }
    } catch (error) {
        console.error('Failed to delete items:', error);
        showNotification('삭제 실패', 'error');
    } finally {
        exitLeftDeleteMode();
    }
}

// 进入左侧删除模式
function enterLeftDeleteMode() {
    const leftSection = document.querySelector('.quick-reply-section.left');
    isLeftDeleteMode = true;
    leftSection.classList.add('delete-mode');
    updateLeftDeleteModeUI();
}

// 退出左侧删除模式
function exitLeftDeleteMode() {
    const leftSection = document.querySelector('.quick-reply-section.left');
    isLeftDeleteMode = false;
    leftSection.classList.remove('delete-mode');
    selectedLeftReplies.clear();
    updateLeftDeleteModeUI();
}

// 更新左侧删除模式UI
function updateLeftDeleteModeUI() {
    const leftSection = document.querySelector('.quick-reply-section.left');
    const addBtn = leftSection.querySelector('button:first-child');
    const deleteBtn = leftSection.querySelector('button:last-child');
    
    if (isLeftDeleteMode) {
        addBtn.textContent = '취소';
        deleteBtn.textContent = '삭제';
        addBtn.classList.add('cancel-delete');
        deleteBtn.classList.add('confirm-delete');
    } else {
        addBtn.textContent = '추가';
        deleteBtn.textContent = '편집';
        addBtn.classList.remove('cancel-delete');
        deleteBtn.classList.remove('confirm-delete');
    }
}

// 保存左侧快捷回复
async function saveLeftQuickReply(content) {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        const response = await fetch('/api/chat/quick-replies/left', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ content })
        });

        if (response.ok) {
            await loadLeftQuickReplies();
            showNotification('저장되었습니다');
            return true;
        } else {
            const data = await response.json();
            showNotification(data.message || '저장 실패', 'error');
            return false;
        }
    } catch (error) {
        console.error('Failed to save left quick reply:', error);
        showNotification('저장 실패', 'error');
        return false;
    }
}

// 保存右侧快捷回复
async function saveRightQuickReply(type, data) {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        const response = await fetch(`/api/chat/quick-replies/right/${type}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            await loadRightQuickReplies();
            showNotification('저장되었습니다');
            return true;
        } else {
            const data = await response.json();
            showNotification(data.message || '저장 실패', 'error');
            return false;
        }
    } catch (error) {
        console.error('Failed to save right quick reply:', error);
        showNotification('저장 실패', 'error');
        return false;
    }
}

// 打开左侧编辑模态框
function openLeftEditModal(replyId, content) {
    const editModal = document.getElementById('editQuickReplyModal');
    const editContent = document.getElementById('editQuickReplyContent');
    
    if (!editModal || !editContent) {
        console.error('Edit modal elements not found');
        return;
    }

    currentEditingReplyId = replyId;
    editContent.value = content;
    editModal.style.display = 'flex';
}

// 更新快捷回复内容
async function updateQuickReply() {
    if (!currentEditingReplyId) return;

    const editContent = document.getElementById('editQuickReplyContent');
    const content = editContent.value.trim();
    
    if (!content) {
        showNotification('내용을 입력해주세요', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        // 1. 先删除旧的记录
        const deleteResponse = await fetch(`/api/chat/quick-replies/left/${currentEditingReplyId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!deleteResponse.ok) {
            showNotification('수정 실패', 'error');
            return;
        }

        // 2. 创建新记录
        const createResponse = await fetch('/api/chat/quick-replies/left', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ content })
        });

        if (createResponse.ok) {
            await loadLeftQuickReplies();
            closeEditModal();
            showNotification('수정되었습니다');
        } else {
            const data = await createResponse.json();
            showNotification(data.message || '수정 실패', 'error');
        }
    } catch (error) {
        console.error('Failed to update quick reply:', error);
        showNotification('수정 실패', 'error');
    }
}

// 关闭编辑模态框
function closeEditModal() {
    const editModal = document.getElementById('editQuickReplyModal');
    const editContent = document.getElementById('editQuickReplyContent');
    
    if (editModal) {
        editModal.style.display = 'none';
    }
    if (editContent) {
        editContent.value = '';
    }
    currentEditingReplyId = null;
}

// 保存快捷回复
async function saveQuickReply() {
    const content = quickReplyContent.value.trim();
    if (!content) return;

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        const response = await fetch('/api/chat/quick-replies/left', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ content })
        });

        if (response.ok) {
            await loadLeftQuickReplies();  // 修改为加载左侧快捷回复
            addQuickReplyModal.style.display = 'none';
            quickReplyContent.value = '';
            showNotification('빠른 답장이 저장되었습니다');
        } else {
            const data = await response.json();
            showNotification(data.message || '저장 실패', 'error');
        }
    } catch (error) {
        console.error('Failed to save quick reply:', error);
        showNotification('저장 실패', 'error');
    }
}

// 上传图片
async function uploadImage() {
    const file = imageInput.files[0];
    if (!file || !isConnected) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
        const response = await fetch('/api/chat/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (response.ok) {
            const message = {
                content: data.imageUrl,
                type: 'image',
                sender: userType,
                createdAt: new Date()
            };
            socket.emit('message', message);
            // 本地立即显示消息
            appendMessage({...message, isSelf: true});
            messageContainer.scrollTop = messageContainer.scrollHeight;
        }
    } catch (error) {
        console.error('Upload failed:', error);
        showNotification('이미지 업로드 실패', 'error');
    }

    imageInput.value = '';
}

// 添加消息到界面
function appendMessage(message) {
    const messageElement = document.createElement('div');
    
    if (!isAdmin) {
        messageElement.className = `message ${message.sender === 'user' ? 'self' : 'other'}`;
    } else {
        messageElement.className = `message ${message.sender === 'admin' ? 'self' : 'other'}`;
    }

    const contentElement = document.createElement('div');

    try {
        // 如果消息类型是 text，尝试解析 JSON
        if (message.type === 'text' || message.type === 'card' || message.type === 'payment') {
            const parsedContent = JSON.parse(message.content);
            if (parsedContent.type === 'card') {
                // 从localStorage获取按钮状态
                const buttonStates = JSON.parse(localStorage.getItem('buttonStates') || '{}');
                const isChecked = buttonStates[message._id] || false;

                contentElement.className = 'message-content card-message';
                contentElement.dataset.messageId = message._id;
                contentElement.innerHTML = `
                    <div class="message-border"></div>
                    <div class="message-main">
                        <div class="product-image">
                            <img src="${parsedContent.productImage}" alt="상품 이미지">
                        </div>
                        <div class="message-title">${parsedContent.productName}</div>
                        <div class="message-info">
                            <div class="info-item">${parsedContent.subtitle1}</div>
                            <div class="info-item">${parsedContent.subtitle2}</div>
                            <div class="info-item">${parsedContent.subtitle3}</div>
                        </div>
                        <div class="button-time-container">
                            ${isAdmin ? 
                                `<div class="order-status ${isChecked ? 'confirmed' : 'pending'}">${isChecked ? '用户已确认' : '用户还未确认'}</div>` :
                                `<button class="action-button" ${isChecked ? 'disabled' : ''}>${isChecked ? '확인' : '주문서 확인'}</button>`
                            }
                            <div class="message-time">${parsedContent.time}</div>
                        </div>
                    </div>
                `;

                // 只为用户添加按钮点击事件（仅针对商品卡片）
                if (!isAdmin) {
                    const orderButton = contentElement.querySelector('.action-button');
                    if (orderButton && !isChecked) {
                        orderButton.addEventListener('click', function(e) {
                            e.preventDefault();
                            if (!this.classList.contains('checked')) {
                                this.classList.add('checked');
                                this.textContent = '확인';
                                this.disabled = true;
                                
                                // 保存状态到localStorage
                                const buttonStates = JSON.parse(localStorage.getItem('buttonStates') || '{}');
                                buttonStates[message._id] = true;
                                localStorage.setItem('buttonStates', JSON.stringify(buttonStates));

                                // 通过socket通知其他用户（包括管理员）状态变更
                                if (socket && socket.connected) {
                                    socket.emit('orderConfirmation', {
                                        messageId: message._id,
                                        confirmed: true
                                    });
                                }
                            }
                        });
                    }
                }
            } else if (parsedContent.type === 'payment') {
                contentElement.className = 'message-content card-message';
                contentElement.dataset.messageId = message._id;
                contentElement.innerHTML = `
                    <div class="message-border"></div>
                    <div class="message-main">
                        <div class="product-image" style="width: 220px; height: 70px;">
                            <img src="${parsedContent.paymentImage}" alt="결제 이미지" style="width: 220px; height: 70px; object-fit: contain;">
                        </div>
                        <div class="message-title">${parsedContent.paymentName}</div>
                        <div class="message-info">
                            <div class="info-item">${parsedContent.paymentAmount}</div>
                        </div>
                        <div class="payment-buttons">
                            <button class="payment-button confirm" onclick="showPaymentTitlesModal()">신청하러 가기</button>
                            <button class="payment-button cancel">자세히 보기</button>
                        </div>
                        <div class="message-time">${parsedContent.time}</div>
                    </div>
                `;
            } else {
                // 处理普通文本消息
                contentElement.className = 'message-content';
                contentElement.textContent = message.content;
            }
        } else if (message.type === 'image') {
            // 处理图片消息
            contentElement.className = 'message-content';
            const img = document.createElement('img');
            img.src = message.content;
            img.alt = '이미지';
            img.addEventListener('load', scrollToBottom);
            img.addEventListener('click', () => showImagePreview(message.content));
            contentElement.appendChild(img);
        } else {
            // 处理其他类型的消息
            contentElement.className = 'message-content';
            contentElement.textContent = message.content;
        }

        messageElement.appendChild(contentElement);

        // 为非卡片消息添加时间戳
        if (!contentElement.classList.contains('card-message')) {
            const timeElement = document.createElement('div');
            timeElement.className = 'message-time';
            timeElement.textContent = formatDate(new Date(message.createdAt));
            messageElement.appendChild(timeElement);
        }
    } catch (error) {
        // 如果JSON解析失败，按普通文本处理
        contentElement.className = 'message-content';
        contentElement.textContent = message.content;
        
        const timeElement = document.createElement('div');
        timeElement.className = 'message-time';
        timeElement.textContent = formatDate(new Date(message.createdAt));
        messageElement.appendChild(contentElement);
        messageElement.appendChild(timeElement);
    }

    messageContainer.appendChild(messageElement);
    scrollToBottom();
}

// 图片预览
function showImagePreview(src) {
    modalImage.src = src;
    imageModal.classList.add('active');
}

// 关闭图片预览
imageModal.addEventListener('click', () => {
    imageModal.classList.remove('active');
});

// 滚动到底部
function scrollToBottom() {
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

// 显示通知
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// 页面关闭前断开连接
window.addEventListener('beforeunload', () => {
    if (socket && isConnected) {
        socket.disconnect();
    }
});

// 清理函数
function cleanupRoom(roomId) {
    // 1. 清理localStorage中的所有相关数据
    const storageKeys = [
        `chat_${roomId}_messages`,    // 聊天记录
        `chat_${roomId}_settings`,    // 用户设置
        `chat_${roomId}_token`,       // 房间token
        `chat_${roomId}_quickReplies` // 快捷回复
    ];
    storageKeys.forEach(key => localStorage.removeItem(key));

    // 2. 清理WebSocket连接
    if (socket && socket.connected) {
        socket.disconnect();
    }

    // 3. 清理DOM内容
    const messageContainer = document.getElementById('messageContainer');
    if (messageContainer) {
        messageContainer.innerHTML = '';
    }

    // 4. 清理页面缓存
    if ('caches' in window) {
        caches.keys().then(cacheNames => {
            cacheNames.forEach(cacheName => {
                if (cacheName.includes(roomId)) {
                    caches.delete(cacheName);
                }
            });
        });
    }
}

// 显示加载页面
function showLoadingPage() {
    if (!loadingPage) return;
    
    // 确保聊天页面完全隐藏
    chatPage.style.display = 'none';
    chatPage.style.opacity = '0';
    
    // 显示加载页面
    loadingPage.style.display = 'block';
    loadingPage.style.opacity = '1';
    isLoading = true;
    
    // 6秒后自动隐藏（包含2秒的颜色过渡时间）
    setTimeout(() => {
        hideLoadingPage();
    }, 6000);
}

// 隐藏加载页面
function hideLoadingPage() {
    if (!loadingPage || !isLoading) return;
    
    // 淡出加载页面
    loadingPage.style.opacity = '0';
    
    setTimeout(() => {
        loadingPage.style.display = 'none';
        // 显示聊天页面
        showChatPage();
        isLoading = false;
    }, 300); // 等待淡出动画完成
}

// 显示聊天页面
function showChatPage() {
    loadingPage.style.opacity = '0';
    setTimeout(() => {
        loadingPage.style.display = 'none';
        chatPage.style.display = 'block';
        setTimeout(() => {
            chatPage.style.opacity = '1';
        }, 50);
    }, 300);
}

// 打开商品信息编辑模态框
async function openProductEditModal(productId = null) {
    const modal = document.getElementById('editProductModal');
    if (!modal) {
        console.error('Product edit modal not found');
        return;
    }

    currentProductId = productId;

    // 重置表单
    resetProductEditForm();

    try {
        if (productId) {
            // 从本地状态获取商品信息
            const productInfo = cardSettings[productId];
            if (productInfo && productInfo.settings) {
                // 填充表单数据
                document.getElementById('productName').value = productInfo.settings.productName || '';
                document.getElementById('subtitle1').value = productInfo.settings.subtitle1 || '';
                document.getElementById('subtitle2').value = productInfo.settings.subtitle2 || '';
                document.getElementById('subtitle3').value = productInfo.settings.subtitle3 || '';

                const imagePreview = document.getElementById('productImagePreview');
                if (imagePreview && productInfo.settings.productImage) {
                    imagePreview.src = productInfo.settings.productImage;
                    imagePreview.style.display = 'block';
                }
            }
        }
    } catch (error) {
        console.error('Failed to load product info:', error);
        showNotification('상품 정보를 불러오지 못했습니다', 'error');
    }

    modal.style.display = 'flex';
}

// 重置商品编辑表单
function resetProductEditForm() {
    const form = document.querySelector('.product-edit-form');
    if (!form) return;

    // 重置所有输入字段
    form.querySelectorAll('input[type="text"]').forEach(input => {
        input.value = '';
    });
    
    // 重置图片预览
    const imagePreview = document.getElementById('productImagePreview');
    if (imagePreview) {
        imagePreview.src = '';
        imagePreview.style.display = 'none';
    }
}

// 保存商品信息
async function saveProductInfo() {
    const imagePreview = document.getElementById('productImagePreview');
    const productName = document.getElementById('productName').value.trim();
    const subtitle1 = document.getElementById('subtitle1').value.trim();
    const subtitle2 = document.getElementById('subtitle2').value.trim();
    const subtitle3 = document.getElementById('subtitle3').value.trim();
    
    // 验证必填字段
    if (!productName) {
        showNotification('상품명을 입력해주세요', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        const settings = {
            productImage: imagePreview.src || '',
            productName: productName,
            subtitle1: subtitle1 || '·상품금액: 입력 필요',
            subtitle2: subtitle2 || '·거래방법: 입력 필요',
            subtitle3: subtitle3 || '·결제확인: 입력 필요',
            lastModified: new Date().toISOString()
        };

        let response;
        if (currentProductId) {
            // 更新现有商品信息
            response = await fetch(`/api/chat/product-info/${currentProductId}`, {
                method: 'PUT',
            headers: {
                    'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    settings: settings,
                    name: productName
                })
            });
        } else {
            // 创建新商品信息
            response = await fetch('/api/chat/product-info', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                    name: productName,
                    settings: settings
            })
        });
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '상품 정보 저장 실패');
        }

        const savedData = await response.json();

        // 更新本地状态
        if (savedData._id) {
            cardSettings[savedData._id] = savedData;
        
        // 关闭模态框
        const editModal = document.getElementById('editProductModal');
        if (editModal) {
            editModal.style.display = 'none';
        }

            // 重新加载数据并渲染
            await loadRightQuickReplies();

        showNotification('상품 정보가 저장되었습니다');
        } else {
            throw new Error('저장된 데이터가 올바르지 않습니다');
        }
    } catch (error) {
        console.error('Failed to save product info:', error);
        showNotification(error.message || '저장 실패', 'error');
    }
}

// 加载所有商品信息
async function loadAllProductInfo() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/chat/product-info/all', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            cardSettings = await response.json();
        }
    } catch (error) {
        console.error('Failed to load all product info:', error);
        showNotification('상품 정보를 불러오지 못했습니다', 'error');
    }
}

// 处理商品图片更改
async function handleProductImageChange() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = async function(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const formData = new FormData();
            formData.append('image', file);

            const response = await fetch('/api/chat/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (response.ok) {
                const imagePreview = document.getElementById('productImagePreview');
                if (imagePreview) {
                    imagePreview.src = data.imageUrl;
                    imagePreview.style.display = 'block';
                }
            } else {
                showNotification('이미지 업로드 실패', 'error');
            }
        } catch (error) {
            console.error('Failed to upload image:', error);
            showNotification('이미지 업로드 실패', 'error');
        }
    };

    input.click();
}

// 设置商品编辑相关事件监听
function setupProductEditEvents() {
    const editProductModal = document.getElementById('editProductModal');
    const changeProductImageBtn = document.getElementById('changeProductImage');
    const saveProductInfoBtn = document.getElementById('saveProductInfo');
    const cancelProductEditBtn = document.getElementById('cancelProductEdit');

    if (!editProductModal || !changeProductImageBtn || !saveProductInfoBtn || !cancelProductEditBtn) {
        console.error('Product edit modal elements not found');
        return;
    }

    // 图片更改按钮事件
    changeProductImageBtn.addEventListener('click', handleProductImageChange);

    // 保存按钮事件
    saveProductInfoBtn.addEventListener('click', saveProductInfo);

    // 取消按钮事件
    cancelProductEditBtn.addEventListener('click', () => {
        editProductModal.style.display = 'none';
    });
}

// 修改右侧快捷回复的渲染函数
function renderRightQuickReplies() {
    const rightRepliesList = document.querySelector('.quick-reply-list.right-replies');
    if (!rightRepliesList) return;
    
    rightRepliesList.innerHTML = '';
    
    const replyTypes = ['상품정보', '결제정보', '기타'];
    
    replyTypes.forEach(type => {
        const typeReplies = rightQuickReplies.filter(reply => reply.replyType === type);
        
        if (type === '상품정보' && cardSettings) {
            // 处理商品信息
            const sortedProducts = Object.entries(cardSettings)
                .filter(([_, product]) => product && product.settings && product.settings.productName)
                .sort((a, b) => new Date(b[1].settings.lastModified) - new Date(a[1].settings.lastModified));

            sortedProducts.forEach(([id, productInfo]) => {
                const { productName } = productInfo.settings;
                const replyHtml = `
                    <div class="quick-reply-item" data-id="${id}" data-type="상품정보">
                        <span class="reply-content">${productName}</span>
                        <svg class="edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </div>
                `;
                rightRepliesList.insertAdjacentHTML('beforeend', replyHtml);
            });
        } else if (type === '결제정보' && paymentSettings) {
            // 处理支付信息
            const sortedPayments = Object.entries(paymentSettings)
                .filter(([_, payment]) => payment && payment.settings && payment.settings.paymentName)
                .sort((a, b) => new Date(b[1].settings.lastModified) - new Date(a[1].settings.lastModified));

            sortedPayments.forEach(([id, paymentInfo]) => {
                const { paymentName } = paymentInfo.settings;
                const replyHtml = `
                    <div class="quick-reply-item" data-id="${id}" data-type="결제정보">
                        <span class="reply-content">${paymentName}</span>
                        <svg class="edit-icon payment-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </div>
                `;
                rightRepliesList.insertAdjacentHTML('beforeend', replyHtml);
            });
        } else {
            // 处理其他类型的快捷回复
            typeReplies.forEach(reply => {
                const replyHtml = `
                    <div class="quick-reply-item" data-id="${reply._id}" data-type="${type}">
                        <span class="reply-content">${reply.content}</span>
                    </div>
                `;
                rightRepliesList.insertAdjacentHTML('beforeend', replyHtml);
            });
        }
    });

    // 添加事件监听
    const editIcons = rightRepliesList.querySelectorAll('.edit-icon');
    editIcons.forEach(icon => {
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = icon.closest('.quick-reply-item');
            if (item && item.dataset.type === '상품정보') {
                openProductEditModal(item.dataset.id);
            } else if (item && item.dataset.type === '결제정보') {
                openPaymentEditModal(item.dataset.id);
            }
        });
    });

    // 添加点击事件
    const items = rightRepliesList.querySelectorAll('.quick-reply-item');
    items.forEach(item => {
        item.addEventListener('click', (e) => {
            if (isRightDeleteMode) {
                item.classList.toggle('selected');
                const replyId = item.dataset.id;
                if (item.classList.contains('selected')) {
                    selectedRightReplies.add(replyId);
                } else {
                    selectedRightReplies.delete(replyId);
                }
                return;
            }

            const type = item.dataset.type;
            const id = item.dataset.id;
            
            if (type === '상품정보') {
                if (cardSettings[id]?.settings?.productImage) {
                    sendCardMessage(id);
                } else {
                    showNotification('상품 이미지를 먼저 등록해주세요', 'error');
                    openProductEditModal(id);
                }
            } else if (type === '결제정보') {
                if (paymentSettings[id]?.settings?.paymentImage) {
                    sendPaymentMessage(id);
                } else {
                    showNotification('결제 이미지를 먼저 등록해주세요', 'error');
                    openPaymentEditModal(id);
                }
            } else {
                const content = item.querySelector('.reply-content').textContent;
                if (content && isConnected) {
                    const message = {
                        content,
                        type: 'text',
                        sender: userType,
                        createdAt: new Date()
                    };
                    socket.emit('message', message);
                    appendMessage(message);
                    messageContainer.scrollTop = messageContainer.scrollHeight;
                }
            }
        });
    });
}

// 保存新商品信息
async function saveNewProductInfo(newId, productInfo) {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('인증이 필요합니다');
        }

        const response = await fetch('/api/chat/product-info', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                name: productInfo.name,
                settings: productInfo.settings
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '저장 실패');
        }

        const savedData = await response.json();
        cardSettings[savedData._id] = savedData;
        await loadRightQuickReplies();
        return savedData;
    } catch (error) {
        console.error('Failed to save product info:', error);
        throw error;
    }
}

// 打开支付信息编辑模态框
function openPaymentEditModal(paymentId) {
    currentPaymentId = paymentId;
    const editModal = document.getElementById('editPaymentModal');
    const paymentInfo = paymentSettings[paymentId];
    
    if (!editModal) {
        console.error('Payment edit modal not found');
        return;
    }

    // 如果是编辑现有支付信息
    if (paymentId && (!paymentInfo || !paymentInfo.settings)) {
        console.error('Payment info not found');
        showNotification('결제 정보를 찾을 수 없습니다', 'error');
        return;
    }

    // 获取所有表单元素
    const formElements = {
        paymentName: document.getElementById('paymentName'),
        paymentAmount: document.getElementById('paymentAmount'),
        paymentImagePreview: document.getElementById('paymentImagePreview')
    };

    // 检查所有必需的表单元素是否存在
    if (Object.values(formElements).some(element => !element)) {
        console.error('Required payment form elements not found');
        showNotification('폼 요소를 찾을 수 없습니다', 'error');
        return;
    }

    // 重置表单
    Object.values(formElements).forEach(element => {
        if (element.tagName === 'INPUT') {
            element.value = '';
        }
    });
    formElements.paymentImagePreview.style.display = 'none';
    formElements.paymentImagePreview.src = '';

    // 如果是编辑现有支付信息，填充表单数据
    if (paymentId && paymentInfo && paymentInfo.settings) {
        const settings = paymentInfo.settings;
        formElements.paymentName.value = settings.paymentName || '';
        formElements.paymentAmount.value = settings.paymentAmount || '';
        
        if (settings.paymentImage) {
            formElements.paymentImagePreview.src = settings.paymentImage;
            formElements.paymentImagePreview.style.display = 'block';
        }
    }

    // 显示模态框
    editModal.style.display = 'flex';
}

// 处理支付信息图片更改
function handlePaymentImageChange(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const img = new Image();
        img.src = e.target.result;
        img.onload = async function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // 设置最大尺寸
            const maxWidth = 800;
            const maxHeight = 800;
            let width = img.width;
            let height = img.height;
            
            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            // 转换为base64
            const resizedImage = canvas.toDataURL('image/jpeg', 0.8);
            const paymentImagePreview = document.getElementById('paymentImagePreview');
            if (paymentImagePreview) {
                paymentImagePreview.src = resizedImage;
                paymentImagePreview.style.display = 'block';
            }
        };
    };
    reader.readAsDataURL(file);
}

// 设置支付信息相关事件监听
function setupPaymentEditEvents() {
    const changePaymentImageBtn = document.getElementById('changePaymentImageBtn');
    const paymentImageInput = document.getElementById('paymentImageInput');
    const savePaymentInfoBtn = document.getElementById('savePaymentInfoBtn');
    const cancelPaymentEditBtn = document.getElementById('cancelPaymentEdit');

    if (changePaymentImageBtn && paymentImageInput) {
        changePaymentImageBtn.addEventListener('click', () => {
            paymentImageInput.click();
        });
        paymentImageInput.addEventListener('change', handlePaymentImageChange);
    }

    if (savePaymentInfoBtn) {
        savePaymentInfoBtn.addEventListener('click', savePaymentInfo);
    }

    if (cancelPaymentEditBtn) {
        cancelPaymentEditBtn.addEventListener('click', () => {
            document.getElementById('editPaymentModal').style.display = 'none';
            currentPaymentId = null;
        });
    }
}

// 发送支付信息消息
function sendPaymentMessage(paymentId) {
    const paymentInfo = paymentSettings[paymentId];
    if (!paymentInfo || !paymentInfo.settings) {
        showNotification('결제 정보를 찾을 수 없습니다', 'error');
        return;
    }

    const settings = paymentInfo.settings;
    if (!settings.paymentImage || !settings.paymentName) {
        showNotification('결제 이미지와 결제명을 입력해주세요', 'error');
        return;
    }

    const currentTime = new Date();
    const formattedTime = formatDate(currentTime);
    
    const messageContent = {
        type: 'payment',
        paymentImage: settings.paymentImage,
        paymentName: settings.paymentName,
        paymentAmount: settings.paymentAmount,
        time: formattedTime
    };

    if (isConnected) {
        const message = {
            content: JSON.stringify(messageContent),
            type: 'payment',
            sender: userType,
            createdAt: currentTime
        };
        socket.emit('message', message);
        appendMessage(message);
        messageContainer.scrollTop = messageContainer.scrollHeight;
    }
}

// 保存支付信息
async function savePaymentInfo() {
    const paymentImagePreview = document.getElementById('paymentImagePreview');
    const paymentName = document.getElementById('paymentName').value.trim();
    const paymentAmount = document.getElementById('paymentAmount').value.trim();

    // 验证必填字段
    if (!paymentName) {
        showNotification('결제명을 입력해주세요', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        const settings = {
            paymentImage: paymentImagePreview.src || '',
            paymentName: paymentName,
            paymentAmount: paymentAmount,
            lastModified: new Date().toISOString()
        };

        let response;
        if (currentPaymentId) {
            // 更新现有支付信息
            response = await fetch(`/api/chat/payment-info/${currentPaymentId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    settings: settings,
                    name: paymentName
                })
            });
        } else {
            // 创建新支付信息
            response = await fetch('/api/chat/payment-info', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: paymentName,
                    settings: settings
                })
            });
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '결제 정보 저장 실패');
        }

        const savedData = await response.json();

        // 更新本地状态
        if (savedData._id) {
            paymentSettings[savedData._id] = savedData;

            // 关闭模态框
            const editModal = document.getElementById('editPaymentModal');
            if (editModal) {
                editModal.style.display = 'none';
            }

            // 重新加载数据并渲染
            await loadRightQuickReplies();

            showNotification('결제 정보가 저장되었습니다');
        } else {
            throw new Error('저장된 데이터가 올바르지 않습니다');
        }
    } catch (error) {
        console.error('Failed to save payment info:', error);
        showNotification(error.message || '저장 실패', 'error');
    }
}

// 定义全局变量存储银行信息
const BANK_LIST = [
    { name: '국민은행', url: 'https://www.kbstar.com', image: '/images/banks/1.png' },
    { name: '우리은행', url: 'https://www.wooribank.com', image: '/images/banks/2.png' },
    { name: '신한은행', url: 'https://www.shinhan.com', image: '/images/banks/3.png' },
    { name: '하나은행', url: 'https://www.kebhana.com', image: '/images/banks/4.png' },
    { name: '농협은행', url: 'https://www.nhbank.com', image: '/images/banks/5.png' },
    { name: '기업은행', url: 'https://www.ibk.co.kr', image: '/images/banks/6.png' },
    { name: 'SC제일은행', url: 'https://www.standardchartered.co.kr', image: '/images/banks/7.png' },
    { name: '케이뱅크', url: 'https://www.kbanknow.com', image: '/images/banks/8.png' },
    { name: '신협중앙회', url: 'https://www.cu.co.kr', image: '/images/banks/9.png' },
    { name: '산업은행', url: 'https://www.kdb.co.kr', image: '/images/banks/10.png' },
    { name: 'MG새마을금고', url: 'https://www.kfcc.co.kr', image: '/images/banks/11.png' },
    { name: '부산은행', url: 'https://www.busanbank.co.kr', image: '/images/banks/12.png' },
    { name: '광주은행', url: 'https://pib.kjbank.com', image: '/images/banks/13.png' },
    { name: '전북은행', url: 'https://www.jbbank.co.kr', image: '/images/banks/14.png' },
    { name: '경남은행', url: 'https://www.knbank.co.kr', image: '/images/banks/15.png' },
    { name: '제주은행', url: 'https://www.jejubank.co.kr', image: '/images/banks/16.png' }
];

// 修改 showPaymentTitlesModal 函数使用 BANK_LIST
async function showPaymentTitlesModal() {
    try {
        // 预加载银行图片
        BANK_LIST.forEach(bank => {
            const img = new Image();
            img.src = bank.image;
        });

        // 默认数据
        const defaultData = {
            settings: {
                title1: '국민은행',
                title2: '123-456-789012',
                title3: '번개장터(주)',
                title4: '500,000원'
            }
        };

        let data = defaultData;

        try {
            const token = localStorage.getItem('token');
            if (!token) {
                console.warn('No token found, using default data');
            } else {
                const response = await fetch('https://bunjang.pro/api/chat/payment/titles', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (response.ok) {
                    data = await response.json();
                } else {
                    console.warn('Failed to fetch data, using default data');
                }
            }
        } catch (error) {
            console.warn('API call failed, using default data:', error);
        }
        
        // 创建模态框 HTML
        const modalHtml = `
            <div id="paymentTitlesModal" class="modal">
                <div class="modal-content payment-modal">
                    <div class="modal-header">
                        <button class="close-button" onclick="closePaymentTitlesModal()"></button>
                    </div>
                    <div class="modal-body">
                        <div class="title-container">
                            <div class="main-title">입금 계좌가<br>발급되었습니다</div>
                            <div class="sub-title">지정된 시간내 입금하지 않으면 신청이 자동 취소됩니다.
입금된 금액은 번개장터에서 안전하게 보관하며
신청확인 시 고객님에게 입금금액 다시 자동 입금됩니다.</div>
                        </div>
                        <div class="table-title main-title">입금계좌정보</div>
                        <div class="payment-table">
                            <div class="table-row bank">
                                <div class="table-label">은행명</div>
                                <div class="table-value">${data.settings?.title1 || ''}</div>
                            </div>
                            <div class="table-row">
                                <div class="table-label">계좌번호</div>
                                <div class="table-value">${data.settings?.title2 || ''}</div>
                            </div>
                            <div class="table-row">
                                <div class="table-label">예금주</div>
                                <div class="table-value">${data.settings?.title3 || ''}</div>
                            </div>
                            <div class="table-row amount">
                                <div class="table-label">금액</div>
                                <div class="table-value">${data.settings?.title4 || ''}</div>
                            </div>
                        </div>
                        <div class="payment-actions">
                            <button class="deposit-button deposit-copy" onclick="copyAccountInfo()">입금하기</button>
                            <button class="deposit-button deposit-complete" onclick="completeDeposit()">입금완료</button>
                        </div>
                    </div>
                </div>
            </div>`;

        // 如果已存在模态框，先移除
        const existingModal = document.getElementById('paymentTitlesModal');
        if (existingModal) {
            existingModal.remove();
        }

        // 添加模态框到页面
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // 显示模态框
        const modal = document.getElementById('paymentTitlesModal');
        modal.style.display = 'flex';

    } catch (error) {
        console.error('Failed to show payment titles:', error);
        showNotification('제목을 불러오는데 실패했습니다', 'error');
    }
}

// 修改 copyAccountInfo 函数使用 BANK_LIST
function copyAccountInfo() {
    const data = {
        title1: document.querySelector('#paymentTitlesModal .table-row.bank .table-value').textContent,
        title2: document.querySelector('#paymentTitlesModal .table-row:nth-child(2) .table-value').textContent,
        title3: document.querySelector('#paymentTitlesModal .table-row:nth-child(3) .table-value').textContent
    };

    // 复制账户信息
    const text = `${data.title1} ${data.title2} ${data.title3}`;
    navigator.clipboard.writeText(text).then(() => {
        showNotification('계좌가 복사되었습니다');
    });

    // 创建并显示底部模态框
    const bottomSheetHtml = `
        <div class="bottom-sheet-overlay" onclick="closeBottomSheet()">
            <div class="bottom-sheet-modal" onclick="event.stopPropagation()">
                <div class="bottom-sheet-title">고객님 사용할 은행 선택해주세요</div>
                <div class="bottom-sheet-content">
                    ${BANK_LIST.map(bank => `
                        <a href="${bank.url}" 
                           class="bottom-sheet-button"
                           onclick="handleBankClick('${bank.url}')">
                            <img src="${bank.image}" class="bank-icon" alt="${bank.name}"/>
                            ${bank.name}
                        </a>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    // 如果已存在底部模态框，先移除
    const existingBottomSheet = document.querySelector('.bottom-sheet-overlay');
    if (existingBottomSheet) {
        existingBottomSheet.remove();
    }

    // 添加底部模态框到页面
    document.body.insertAdjacentHTML('beforeend', bottomSheetHtml);

    // 获取新添加的元素
    const overlay = document.querySelector('.bottom-sheet-overlay');
    const modal = document.querySelector('.bottom-sheet-modal');

    // 延迟一帧后添加 active 类，触发动画
    requestAnimationFrame(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    });
}

// 处理银行点击事件
function handleBankClick(url) {
    // 先关闭底部模态框
    closeBottomSheet();
    
    // 延迟一下再打开新窗口，让动画效果更流畅
    setTimeout(() => {
        window.open(url, '_blank');
    }, 300);
}

// 关闭底部模态框
function closeBottomSheet() {
    const overlay = document.querySelector('.bottom-sheet-overlay');
    const modal = document.querySelector('.bottom-sheet-modal');
    
    if (overlay && modal) {
        overlay.classList.remove('active');
        modal.classList.remove('active');
        
        // 等待动画结束后移除元素
        setTimeout(() => {
            overlay.remove();
        }, 300);
    }
}

// 完成存款
function completeDeposit() {
    showNotification('입금 확인중');
    setTimeout(() => {
        closePaymentTitlesModal();
    }, 2000);
}

// 关闭支付标题模态框
function closePaymentTitlesModal() {
    const modal = document.getElementById('paymentTitlesModal');
    if (modal) {
        modal.remove();
    }
}

// 修改卡片消息的处理函数
function appendCardMessage(message) {
    const data = JSON.parse(message.content);
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.sender === userType ? 'self' : 'other'}`;
    
    messageDiv.innerHTML = `
        <div class="message-content card-message">
            <div class="product-image">
                <img src="${data.productImage}" alt="상품 이미지">
            </div>
            <div class="message-main">
                <div class="product-name">${data.productName}</div>
                <div class="info-item">${data.productDescription || ''}</div>
                <div class="button-time-container">
                    <button class="action-button" onclick="showPaymentTitlesModal()">신청하러 가기</button>
                    <div class="message-time">${formatDate(new Date(message.createdAt))}</div>
                </div>
            </div>
        </div>
    `;
    
    messageContainer.appendChild(messageDiv);
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

// 初始化
init(); 